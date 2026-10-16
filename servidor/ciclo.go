package main

// Ciclo del proceso: generación de tareas a partir de la plantilla del
// profesional (o de las etapas normativas base), avance de tareas, cómputo de
// plazos y alertas.

import (
	"fmt"
	"sort"
	"strings"
)

// plantillaPara busca la plantilla del profesional para la vía.
func (s *Servidor) plantillaPara(profesionalID, via string) *Plantilla {
	plantillas, _ := listar[Plantilla](s.bd, colPlantillas)
	for i := range plantillas {
		if plantillas[i].ProfesionalID == profesionalID && plantillas[i].Via == via {
			return &plantillas[i]
		}
	}
	return nil
}

// generarCiclo crea las tareas del proceso. Devuelve las tareas creadas.
func (s *Servidor) generarCiclo(p *Proceso, via *Via, usuario string) ([]Tarea, error) {
	etapas := via.Etapas
	p.CicloBase = true
	p.PlantillaNombre = "Etapas normativas base · " + via.Nombre
	if plt := s.plantillaPara(p.ProfesionalID, p.Via); plt != nil && len(plt.Tareas) > 0 {
		etapas = plt.Tareas
		p.CicloBase = false
		p.PlantillaID = plt.ID
		p.PlantillaNombre = plt.Nombre
	}
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
		// Sin antecesora: la tarea empieza con el proceso.
		if t.AntecesoraID == "" {
			t.Estado = TareaEnProceso
			t.FechaInicio = p.FechaInicio
		}
		if t.PlazoDias != nil && (t.Desde == DesdeInicio || t.AntecesoraID == "") {
			t.FechaLimite = cal.Sumar(p.FechaInicio, *t.PlazoDias, t.TipoDias)
			t.PlazoDefinidoPor = "plantilla"
		}
		t.Historial = []Evento{{Fecha: ahora(), Usuario: usuario, Texto: "Tarea generada desde «" + p.PlantillaNombre + "»"}}
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

// cambiarEstadoTarea aplica la transición y propaga el avance a las tareas sucesoras.
func (s *Servidor) cambiarEstadoTarea(t *Tarea, estado, usuario string) ([]Tarea, error) {
	if t.Estado == estado {
		return nil, nil
	}
	cal := s.calendario()
	anterior := t.Estado
	t.Estado = estado
	switch estado {
	case TareaEnProceso:
		if t.FechaInicio == "" {
			t.FechaInicio = hoy()
		}
		t.FechaFin = ""
		if t.FechaLimite == "" && t.PlazoDias != nil {
			t.FechaLimite = cal.Sumar(t.FechaInicio, *t.PlazoDias, t.TipoDias)
			t.PlazoDefinidoPor = "plantilla"
		}
	case TareaFinalizada:
		if t.FechaInicio == "" {
			t.FechaInicio = hoy()
		}
		t.FechaFin = hoy()
	case TareaPendiente:
		t.FechaFin = ""
	}
	t.Historial = append(t.Historial, Evento{Fecha: ahora(), Usuario: usuario, Texto: fmt.Sprintf("Estado: %s → %s", anterior, estado)})
	t.ActualizadaEn = ahora()

	// Al finalizar, las sucesoras pendientes pasan a «En proceso» y su plazo empieza a correr.
	var sucesoras []Tarea
	if estado == TareaFinalizada {
		for _, x := range s.tareasDe(t.ProcesoID) {
			if x.AntecesoraID != t.ID || x.Estado != TareaPendiente {
				continue
			}
			x.Estado = TareaEnProceso
			x.FechaInicio = t.FechaFin
			if x.FechaLimite == "" && x.PlazoDias != nil {
				x.FechaLimite = cal.Sumar(t.FechaFin, *x.PlazoDias, x.TipoDias)
				x.PlazoDefinidoPor = "plantilla"
			}
			x.Historial = append(x.Historial, Evento{Fecha: ahora(), Usuario: usuario, Texto: "Inicia al concluir «" + t.Nombre + "»"})
			x.ActualizadaEn = ahora()
			sucesoras = append(sucesoras, x)
		}
	}
	return sucesoras, nil
}

// ----------------------------------------------------------------- alertas

type Alerta struct {
	ID            string `json:"id"`
	Tipo          string `json:"tipo"`
	Nivel         string `json:"nivel"` // critica | alta | media | info
	Titulo        string `json:"titulo"`
	Detalle       string `json:"detalle"`
	ProcesoID     string `json:"procesoId,omitempty"`
	TareaID       string `json:"tareaId,omitempty"`
	ProfesionalID string `json:"profesionalId,omitempty"`
	Fecha         string `json:"fecha,omitempty"`
}

var ordenNivel = map[string]int{"critica": 0, "alta": 1, "media": 2, "info": 3}

// calcularAlertas evalúa las reglas de alerta sobre los datos visibles para el usuario.
func calcularAlertas(u *Usuario, procesos []Proceso, tareas []Tarea, tramites []TramiteSGD, solicitudes []Solicitud, usuarios []Usuario, cfg Configuracion, cal Calendario) []Alerta {
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
		a.ID = a.Tipo + ":" + a.TareaID + a.ProcesoID + ":" + a.ProfesionalID
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
		// Plazo relativo ya definido: la fecha se calcula sola cuando la tarea empiece.
		if t.PlazoDias != nil && t.Estado == TareaPendiente {
			continue
		}
		// Sin plazo: se alerta cuando la antecesora está en proceso o finalizada (o la tarea ya empezó).
		ant := porTarea[t.AntecesoraID]
		if t.Estado == TareaEnProceso || t.AntecesoraID == "" || (ant != nil && ant.Estado != TareaPendiente) {
			a := base
			a.Tipo, a.Nivel = "plazo-no-definido", "media"
			if t.Estado == TareaEnProceso {
				a.Nivel = "alta"
			}
			a.Titulo = "Plazo no definido: " + t.Nombre
			motivo := "la tarea está en proceso"
			if t.Estado != TareaEnProceso && ant != nil {
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
		if p.CicloBase {
			agregar(Alerta{Tipo: "sin-plantilla", Nivel: "info", ProcesoID: p.ID, ProfesionalID: p.ProfesionalID,
				Titulo: "Ciclo generado con etapas base", Detalle: etiqueta(p) + " · el profesional no tenía plantilla propia para esta vía; revise las tareas."})
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
