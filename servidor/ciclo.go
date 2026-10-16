package main

// Ciclo del proceso: generación de tareas a partir de la plantilla aprobada
// del profesional, avance de tareas, cómputo de plazos y alertas.

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
)

// plantillaPara busca la plantilla APROBADA del profesional para la vía.
func (s *Servidor) plantillaPara(profesionalID, via string) *Plantilla {
	plantillas, _ := listar[Plantilla](s.bd, colPlantillas)
	for i := range plantillas {
		if plantillas[i].ProfesionalID == profesionalID && plantillas[i].Via == via && plantillas[i].Aprobada() {
			return &plantillas[i]
		}
	}
	return nil
}

// generarCiclo crea las tareas del proceso con la versión aprobada de la plantilla del profesional.
// Las tareas sin antecesora quedan disponibles («Por hacer») desde el inicio del proceso; las demás
// se habilitan cuando su antecesora finaliza.
func (s *Servidor) generarCiclo(p *Proceso, plt *Plantilla, usuario string) ([]Tarea, error) {
	etapas := plt.TareasAprobadas
	p.CicloBase = false
	p.PlantillaID = plt.ID
	p.PlantillaNombre = valorO(plt.NombreAprobado, plt.Nombre)
	cal := s.calendario()
	tareas := make([]Tarea, len(etapas))
	for i, e := range etapas {
		t := Tarea{
			ID: nuevoID("TAR"), ProcesoID: p.ID, Orden: i + 1, Nombre: e.Nombre, Descripcion: e.Descripcion,
			Estado: TareaPendiente, PlazoDias: e.PlazoDias, TipoDias: e.TipoDias, Desde: e.Desde, Referencia: e.Referencia,
			ActualizadaEn: ahora(),
		}
		if t.TipoDias != DiasCalendario {
			t.TipoDias = DiasHabiles
		}
		if t.Desde != DesdeInicio {
			t.Desde = DesdeAntecesora
		}
		for _, item := range e.Checklist {
			if item = strings.TrimSpace(item); item != "" {
				t.Checklist = append(t.Checklist, Item{Texto: item})
			}
		}
		ant := i - 1
		if e.Antecesora != nil && *e.Antecesora >= -1 && *e.Antecesora < i {
			ant = *e.Antecesora
		}
		if ant >= 0 {
			t.AntecesoraID = tareas[ant].ID
		}
		if t.AntecesoraID == "" {
			t.FechaInicio = p.FechaInicio // disponible desde el inicio del proceso
		}
		if t.PlazoDias != nil && (t.Desde == DesdeInicio || t.AntecesoraID == "") {
			t.FechaLimite = cal.Sumar(p.FechaInicio, *t.PlazoDias, t.TipoDias)
			t.PlazoDefinidoPor = "plantilla"
		}
		t.Historial = []Evento{{Fecha: ahora(), Usuario: usuario, Texto: "Tarea generada desde la plantilla «" + p.PlantillaNombre + "»"}}
		tareas[i] = t
	}
	for _, t := range tareas {
		if err := s.bd.GuardarJSON(colTareas, t.ID, t); err != nil {
			return nil, err
		}
	}
	return tareas, nil
}

func (s *Servidor) tareasDe(procesoID string) []Tarea {
	todas, _ := listar[Tarea](s.bd, colTareas)
	propias := []Tarea{}
	for _, t := range todas {
		if t.ProcesoID == procesoID {
			propias = append(propias, t)
		}
	}
	sort.Slice(propias, func(i, j int) bool { return propias[i].Orden < propias[j].Orden })
	return propias
}

// ordenEstado: posición de cada estado en el tablero (para detectar retrocesos).
var ordenEstado = map[string]int{TareaPendiente: 0, TareaEnProceso: 1, TareaEnRevision: 2, TareaFinalizada: 3}

// cambiarEstadoTarea aplica la transición y habilita las tareas sucesoras.
// Avanzar exige que la antecesora haya finalizado; retroceder exige una justificación.
func (s *Servidor) cambiarEstadoTarea(t *Tarea, estado, justificacion, usuario string) ([]Tarea, error) {
	if t.Estado == estado {
		return nil, nil
	}
	if _, ok := ordenEstado[estado]; !ok {
		return nil, fallo(http.StatusUnprocessableEntity, "Estado de tarea no válido.")
	}
	retroceso := ordenEstado[estado] < ordenEstado[t.Estado]
	justificacion = strings.TrimSpace(justificacion)
	if retroceso && justificacion == "" {
		return nil, fallo(http.StatusUnprocessableEntity, "Para devolver la tarea a «%s» indique la justificación.", estado)
	}
	todas := s.tareasDe(t.ProcesoID)
	if !retroceso && t.AntecesoraID != "" {
		for _, a := range todas {
			if a.ID == t.AntecesoraID && a.Estado != TareaFinalizada {
				return nil, fallo(http.StatusConflict, "La tarea antecesora «%s» aún no finaliza.", a.Nombre)
			}
		}
	}
	cal := s.calendario()
	anterior := t.Estado
	t.Estado = estado
	switch estado {
	case TareaEnProceso, TareaEnRevision:
		if t.FechaInicio == "" {
			t.FechaInicio = hoy()
		}
		t.FechaFin = ""
	case TareaFinalizada:
		if t.FechaInicio == "" {
			t.FechaInicio = hoy()
		}
		t.FechaFin = hoy()
	case TareaPendiente:
		t.FechaFin = ""
	}
	if t.FechaLimite == "" && t.PlazoDias != nil && t.FechaInicio != "" {
		t.FechaLimite = cal.Sumar(t.FechaInicio, *t.PlazoDias, t.TipoDias)
		t.PlazoDefinidoPor = "plantilla"
	}
	texto := fmt.Sprintf("Estado: %s → %s", anterior, estado)
	if retroceso {
		texto = fmt.Sprintf("Retroceso: %s → %s. Justificación: %s", anterior, estado, justificacion)
		t.Comentarios = append(t.Comentarios, Evento{Fecha: ahora(), Usuario: usuario, Texto: "↩ " + texto})
		// La gerencia recibe un aviso en su portal hasta que lo marque como visto.
		n := Notificacion{ID: nuevoID("NOT"), Tipo: "retroceso-tarea", ProcesoID: t.ProcesoID, TareaID: t.ID, De: usuario,
			Texto: fmt.Sprintf("«%s» volvió de %s a %s. Justificación: %s", t.Nombre, anterior, estado, justificacion), CreadaEn: ahora()}
		if err := s.bd.GuardarJSON(colNotificaciones, n.ID, n); err != nil {
			return nil, err
		}
	}
	t.Historial = append(t.Historial, Evento{Fecha: ahora(), Usuario: usuario, Texto: texto})
	t.ActualizadaEn = ahora()

	// Al finalizar, las sucesoras quedan disponibles («Por hacer») y su plazo empieza a correr.
	var sucesoras []Tarea
	if estado == TareaFinalizada {
		for _, x := range todas {
			if x.AntecesoraID != t.ID || x.Estado != TareaPendiente {
				continue
			}
			x.FechaInicio = t.FechaFin
			if x.FechaLimite == "" && x.PlazoDias != nil {
				x.FechaLimite = cal.Sumar(t.FechaFin, *x.PlazoDias, x.TipoDias)
				x.PlazoDefinidoPor = "plantilla"
			}
			x.Historial = append(x.Historial, Evento{Fecha: ahora(), Usuario: usuario, Texto: "Habilitada al finalizar «" + t.Nombre + "»"})
			x.ActualizadaEn = ahora()
			sucesoras = append(sucesoras, x)
		}
	}
	return sucesoras, nil
}

// ----------------------------------------------------------------- alertas

type Alerta struct {
	ID             string `json:"id"`
	Tipo           string `json:"tipo"`
	Nivel          string `json:"nivel"` // critica | alta | media | info
	Titulo         string `json:"titulo"`
	Detalle        string `json:"detalle"`
	ProcesoID      string `json:"procesoId,omitempty"`
	TareaID        string `json:"tareaId,omitempty"`
	ProfesionalID  string `json:"profesionalId,omitempty"`
	Fecha          string `json:"fecha,omitempty"`
	NotificacionID string `json:"notificacionId,omitempty"`
}

var ordenNivel = map[string]int{"critica": 0, "alta": 1, "media": 2, "info": 3}

// calcularAlertas evalúa las reglas de alerta sobre los datos visibles para el usuario.
func calcularAlertas(u *Usuario, procesos []Proceso, tareas []Tarea, tramites []TramiteSGD, solicitudes []Solicitud, usuarios []Usuario, plantillas []Plantilla, notificaciones []Notificacion, cfg Configuracion, cal Calendario) []Alerta {
	hoyISO := hoy()
	porProceso := map[string]*Proceso{}
	for i := range procesos {
		porProceso[procesos[i].ID] = &procesos[i]
	}
	porTarea := map[string]*Tarea{}
	for i := range tareas {
		porTarea[tareas[i].ID] = &tareas[i]
	}
	nombre := map[string]string{}
	for _, x := range usuarios {
		nombre[x.ID] = x.Nombre
	}
	var alertas []Alerta
	agregar := func(a Alerta) {
		a.ID = a.Tipo + ":" + a.NotificacionID + a.TareaID + a.ProcesoID + ":" + a.ProfesionalID + ":" + a.Titulo
		alertas = append(alertas, a)
	}
	etiqueta := func(p *Proceso) string { return p.Codigo + " · " + p.Titulo }

	ultimoMovimiento := map[string]string{}
	for _, t := range tareas {
		if t.ActualizadaEn > ultimoMovimiento[t.ProcesoID] {
			ultimoMovimiento[t.ProcesoID] = t.ActualizadaEn
		}
	}
	for _, tr := range tramites {
		if tr.IndexadoEn > ultimoMovimiento[tr.ProcesoID] {
			ultimoMovimiento[tr.ProcesoID] = tr.IndexadoEn
		}
	}

	for i := range tareas {
		t := &tareas[i]
		p := porProceso[t.ProcesoID]
		if p == nil || p.Estado != ProcesoActivo || t.Estado == TareaFinalizada {
			continue
		}
		base := Alerta{ProcesoID: p.ID, TareaID: t.ID, ProfesionalID: p.ProfesionalID}
		if t.FechaLimite != "" {
			restantes := cal.HabilesEntre(hoyISO, t.FechaLimite)
			switch {
			case t.FechaLimite < hoyISO:
				a := base
				a.Tipo, a.Nivel, a.Fecha = "tarea-vencida", "critica", t.FechaLimite
				a.Titulo = "Tarea vencida: " + t.Nombre
				a.Detalle = fmt.Sprintf("%s · venció el %s (%d día(s) calendario de atraso)", etiqueta(p), t.FechaLimite, diasEntre(t.FechaLimite, hoyISO))
				agregar(a)
			case restantes <= cfg.DiasAlertaPorVencer:
				a := base
				a.Tipo, a.Nivel, a.Fecha = "tarea-por-vencer", "alta", t.FechaLimite
				a.Titulo = "Tarea por vencer: " + t.Nombre
				cuando := fmt.Sprintf("vence en %d día(s) hábil(es)", restantes)
				if restantes == 0 {
					cuando = "vence hoy"
				}
				a.Detalle = fmt.Sprintf("%s · %s (%s)", etiqueta(p), cuando, t.FechaLimite)
				agregar(a)
			}
			continue
		}
		// Plazo relativo ya definido: la fecha se calcula sola cuando la tarea se habilite.
		if t.PlazoDias != nil && t.FechaInicio == "" {
			continue
		}
		// Sin plazo: se alerta cuando la antecesora está en proceso o finalizada (o la tarea ya está habilitada).
		ant := porTarea[t.AntecesoraID]
		habilitada := t.FechaInicio != "" || t.Estado != TareaPendiente
		if habilitada || (ant != nil && ant.Estado != TareaPendiente) {
			a := base
			a.Tipo, a.Nivel = "plazo-no-definido", "media"
			if habilitada {
				a.Nivel = "alta"
			}
			a.Titulo = "Plazo no definido: " + t.Nombre
			motivo := "la tarea ya está habilitada"
			if !habilitada && ant != nil {
				motivo = fmt.Sprintf("la tarea antecesora «%s» está %s", ant.Nombre, strings.ToLower(ant.Estado))
			}
			a.Detalle = fmt.Sprintf("%s · %s y aún no tiene fecha límite", etiqueta(p), motivo)
			agregar(a)
		}
	}

	for i := range procesos {
		p := &procesos[i]
		if p.Estado != ProcesoActivo {
			continue
		}
		ultimo := ultimoMovimiento[p.ID]
		if ultimo == "" {
			ultimo = p.CreadoEn
		}
		if dias := diasEntre(ultimo, hoyISO); dias >= cfg.DiasSinMovimiento {
			agregar(Alerta{Tipo: "sin-movimiento", Nivel: "media", ProcesoID: p.ID, ProfesionalID: p.ProfesionalID,
				Titulo: "Proceso sin movimiento", Detalle: fmt.Sprintf("%s · %d días sin actualizaciones", etiqueta(p), dias)})
		}
		abiertas := 0
		for _, t := range tareas {
			if t.ProcesoID == p.ID && t.Estado != TareaFinalizada {
				abiertas++
			}
		}
		if abiertas == 0 {
			agregar(Alerta{Tipo: "listo-para-finalizar", Nivel: "info", ProcesoID: p.ID, ProfesionalID: p.ProfesionalID,
				Titulo: "Proceso sin tareas abiertas", Detalle: etiqueta(p) + " · todas las tareas concluyeron: finalícelo o agregue la siguiente actuación."})
		}
	}

	for _, sol := range solicitudes {
		if sol.Estado != "pendiente" {
			continue
		}
		t, p := porTarea[sol.TareaID], porProceso[sol.ProcesoID]
		if t == nil || p == nil {
			continue
		}
		para := sol.Para == u.ID
		if !para && u.Rol != RolGerente && u.Rol != RolAdmin && sol.De != u.ID {
			continue
		}
		titulo := "Solicitud de plazo: " + t.Nombre
		detalle := fmt.Sprintf("%s · %s pide definir el plazo", etiqueta(p), nombre[sol.De])
		if !para {
			titulo = "Solicitud de plazo pendiente: " + t.Nombre
			detalle = fmt.Sprintf("%s · enviada a %s el %s", etiqueta(p), nombre[sol.Para], sol.CreadaEn[:10])
		}
		if sol.Mensaje != "" {
			detalle += ": «" + sol.Mensaje + "»"
		}
		agregar(Alerta{Tipo: "solicitud-plazo", Nivel: "alta", ProcesoID: p.ID, TareaID: t.ID, ProfesionalID: p.ProfesionalID, Titulo: titulo, Detalle: detalle, Fecha: sol.CreadaEn})
	}

	// Trámites del SGD recién anexados a procesos del profesional (últimos 3 días).
	if u.Rol == RolProfesional {
		for _, tr := range tramites {
			p := porProceso[tr.ProcesoID]
			if p == nil || p.ProfesionalID != u.ID || diasEntre(tr.IndexadoEn, hoyISO) > 3 || tr.IndexadoPor == u.Usuario {
				continue
			}
			agregar(Alerta{Tipo: "tramite-nuevo", Nivel: "info", ProcesoID: p.ID, TareaID: tr.TareaID, ProfesionalID: p.ProfesionalID, Fecha: tr.IndexadoEn,
				Titulo: "Nuevo documento SGD " + tr.NroTramite, Detalle: etiqueta(p) + " · " + tr.AsuntoSGD})
		}
	}

	// Retrocesos de tareas: aviso a la gerencia hasta que lo marque como visto.
	if u.Rol == RolGerente || u.Rol == RolAdmin {
		for _, n := range notificaciones {
			p := porProceso[n.ProcesoID]
			if n.Tipo != "retroceso-tarea" || p == nil || contiene(n.VistaPor, u.ID) {
				continue
			}
			agregar(Alerta{Tipo: "retroceso-tarea", Nivel: "alta", ProcesoID: p.ID, TareaID: n.TareaID, ProfesionalID: p.ProfesionalID, Fecha: n.CreadaEn, NotificacionID: n.ID,
				Titulo: "Retroceso de tarea en " + p.Codigo, Detalle: fmt.Sprintf("%s · %s · %s", n.Texto, n.De, n.CreadaEn[:10])})
		}
	}

	// Plantillas: pendientes de aprobación (gerencia) u observadas (profesional).
	for _, pl := range plantillas {
		switch {
		case pl.Estado == PlantillaPendiente && (u.Rol == RolGerente || u.Rol == RolAdmin):
			agregar(Alerta{Tipo: "plantilla-por-aprobar", Nivel: "media", ProfesionalID: pl.ProfesionalID, Fecha: pl.ActualizadaEn,
				Titulo: "Plantilla por aprobar: " + pl.Nombre, Detalle: fmt.Sprintf("Enviada por %s (versión %d)", nombre[pl.ProfesionalID], pl.Version)})
		case pl.Estado == PlantillaObservada && pl.ProfesionalID == u.ID:
			agregar(Alerta{Tipo: "plantilla-observada", Nivel: "alta", ProfesionalID: pl.ProfesionalID, Fecha: pl.ActualizadaEn,
				Titulo: "Plantilla observada: " + pl.Nombre, Detalle: "Observación: " + valorO(pl.Observacion, "—")})
		}
	}

	// Gerencia: profesionales con alta proporción de tareas vencidas.
	if u.Rol == RolGerente || u.Rol == RolAdmin {
		abiertas, vencidas := map[string]int{}, map[string]int{}
		for _, t := range tareas {
			p := porProceso[t.ProcesoID]
			if p == nil || p.Estado != ProcesoActivo || t.Estado == TareaFinalizada {
				continue
			}
			abiertas[p.ProfesionalID]++
			if t.FechaLimite != "" && t.FechaLimite < hoyISO {
				vencidas[p.ProfesionalID]++
			}
		}
		for prof, n := range abiertas {
			if pct := vencidas[prof] * 100 / n; vencidas[prof] > 0 && pct >= cfg.UmbralVencidasPct {
				agregar(Alerta{Tipo: "carga-critica", Nivel: "alta", ProfesionalID: prof, ProcesoID: "",
					Titulo: "Profesional con tareas vencidas: " + nombre[prof], Detalle: fmt.Sprintf("%d de %d tareas abiertas vencidas (%d %%; umbral %d %%)", vencidas[prof], n, pct, cfg.UmbralVencidasPct)})
			}
		}
	}

	sort.SliceStable(alertas, func(i, j int) bool {
		if ordenNivel[alertas[i].Nivel] != ordenNivel[alertas[j].Nivel] {
			return ordenNivel[alertas[i].Nivel] < ordenNivel[alertas[j].Nivel]
		}
		return alertas[i].Fecha < alertas[j].Fecha
	})
	if alertas == nil {
		alertas = []Alerta{}
	}
	return alertas
}
