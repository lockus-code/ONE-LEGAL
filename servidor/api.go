package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const limiteCuerpo = 32 << 20 // 32 MB (respaldos completos)

type Servidor struct {
	bd       *BD
	cfg      Config
	web      fs.FS
	dirExt   string
	version  string
	iniciado time.Time
	mu       sync.Mutex // serializa las escrituras que tocan varios documentos
}

// errAPI: error con el código HTTP con que se responde.
type errAPI struct {
	estado int
	msg    string
}

func (e errAPI) Error() string { return e.msg }

func fallo(estado int, formato string, args ...any) error {
	return errAPI{estado, fmt.Sprintf(formato, args...)}
}

// ------------------------------------------------------------------ rutas

func (s *Servidor) Rutas() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/estado", s.manejarEstado)
	mux.HandleFunc("/api/sesion", s.manejarSesion)
	mux.HandleFunc("/api/sesion/clave", s.con(s.manejarCambioClave))

	mux.HandleFunc("GET /api/datos", s.con(s.manejarDatos))
	mux.HandleFunc("GET /api/catalogo", s.con(s.manejarCatalogo))
	mux.HandleFunc("GET /api/config", s.con(s.manejarConfig))
	mux.HandleFunc("PUT /api/config", s.con(s.manejarConfig, RolAdmin))
	mux.HandleFunc("PUT /api/taxonomia", s.con(s.manejarTaxonomia, RolAdmin))

	mux.HandleFunc("/api/usuarios", s.con(s.manejarUsuarios, RolAdmin))
	mux.HandleFunc("/api/usuarios/{id}", s.con(s.manejarUsuario, RolAdmin))

	mux.HandleFunc("POST /api/plantillas", s.con(s.manejarPlantilla, RolProfesional, RolAdmin))
	mux.HandleFunc("/api/plantillas/{id}", s.con(s.manejarPlantilla, RolProfesional, RolAdmin))

	mux.HandleFunc("POST /api/procesos", s.con(s.manejarCrearProceso, RolAsistente, RolProfesional, RolAdmin))
	mux.HandleFunc("/api/procesos/{id}", s.con(s.manejarProceso))

	mux.HandleFunc("POST /api/tareas", s.con(s.manejarCrearTarea, RolProfesional, RolAdmin))
	mux.HandleFunc("/api/tareas/{id}", s.con(s.manejarTarea, RolProfesional, RolAdmin))
	mux.HandleFunc("PUT /api/plazos", s.con(s.manejarPlazos, RolProfesional, RolAdmin))

	mux.HandleFunc("POST /api/indexar", s.con(s.manejarIndexar, RolAsistente, RolProfesional, RolAdmin))
	mux.HandleFunc("GET /api/tramites-sgd", s.con(s.manejarConsultaTramite))
	mux.HandleFunc("GET /api/mis-indexaciones", s.con(s.manejarMisIndexaciones))
	mux.HandleFunc("DELETE /api/tramites/{id}", s.con(s.manejarBorrarTramite, RolAsistente, RolAdmin))

	mux.HandleFunc("POST /api/solicitudes", s.con(s.manejarSolicitud, RolAsistente, RolGerente, RolAdmin))
	mux.HandleFunc("PUT /api/solicitudes/{id}", s.con(s.manejarAtenderSolicitud))

	mux.HandleFunc("GET /api/admin/bd", s.con(s.manejarAdminBD, RolAdmin))
	mux.HandleFunc("GET /api/admin/bd/{col}", s.con(s.manejarAdminColeccion, RolAdmin))
	mux.HandleFunc("/api/admin/bd/{col}/{clave}", s.con(s.manejarAdminDocumento, RolAdmin))
	mux.HandleFunc("POST /api/admin/vaciar", s.con(s.manejarVaciar, RolAdmin))
	mux.HandleFunc("GET /api/admin/respaldo", s.con(s.manejarRespaldo, RolAdmin))
	mux.HandleFunc("POST /api/admin/restaurar", s.con(s.manejarRestaurar, RolAdmin))

	mux.HandleFunc("GET /descargas/conector-sgd.zip", s.manejarDescargaExtension)

	estatico := func(dir string) http.Handler {
		sub, err := fs.Sub(s.web, dir)
		if err != nil {
			panic(err)
		}
		return http.FileServer(http.FS(sub))
	}
	mux.Handle("/portal/", http.StripPrefix("/portal/", estatico("portal")))
	if s.cfg.SGDSimulado {
		mux.Handle("/sgd-simulado/", s.sgdSimulado(estatico("sgd-simulado")))
	}
	mux.Handle("/", estatico("centro"))
	return s.cabeceras(mux)
}

// cabeceras: sin caché, CORS solo para la extensión y protección CSRF básica.
func (s *Servidor) cabeceras(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			origen := r.Header.Get("Origin")
			if strings.HasPrefix(origen, "chrome-extension://") {
				w.Header().Set("Access-Control-Allow-Origin", origen)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			// Las peticiones que modifican datos deben ser JSON (un formulario de otro sitio no puede enviarlo
			// sin permiso CORS) y, si el navegador indica el origen, provenir del propio portal o de la extensión.
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
					rechazar(w, http.StatusUnsupportedMediaType, "Las solicitudes deben enviarse en formato JSON.")
					return
				}
				if origen != "" && !strings.HasPrefix(origen, "chrome-extension://") {
					if u, err := url.Parse(origen); err != nil || u.Host != r.Host {
						rechazar(w, http.StatusForbidden, "Origen no autorizado.")
						return
					}
				}
			}
		}
		h.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------ utilidades BD

func (s *Servidor) taxonomia() Taxonomia {
	t, err := obtener[Taxonomia](s.bd, colSistema, claveTaxonomia)
	if err != nil {
		return taxonomiaBase()
	}
	return t
}

func (s *Servidor) configuracion() Configuracion {
	c, err := obtener[Configuracion](s.bd, colSistema, claveConfig)
	if err != nil {
		return configuracionInicial()
	}
	if c.FeriadosAdicionales == nil {
		c.FeriadosAdicionales = []string{}
	}
	return c
}

func (s *Servidor) calendario() Calendario {
	return nuevoCalendario(s.configuracion().FeriadosAdicionales)
}

// inicializar deja la BD lista: taxonomía, configuración y administrador.
func (s *Servidor) inicializar() error {
	if _, err := s.bd.Obtener(colSistema, claveTaxonomia); errors.Is(err, errNoEncontrado) {
		t := taxonomiaBase()
		t.ActualizadaEn = ahora()
		if err := s.bd.GuardarJSON(colSistema, claveTaxonomia, t); err != nil {
			return err
		}
	}
	if _, err := s.bd.Obtener(colSistema, claveConfig); errors.Is(err, errNoEncontrado) {
		if err := s.bd.GuardarJSON(colSistema, claveConfig, configuracionInicial()); err != nil {
			return err
		}
	}
	return s.asegurarAdministrador()
}

func (s *Servidor) usuariosPorID() map[string]Usuario {
	usuarios, _ := listar[Usuario](s.bd, colUsuarios)
	m := map[string]Usuario{}
	for _, u := range usuarios {
		m[u.ID] = u
	}
	return m
}

// --------------------------------------------------------------- handlers

func (s *Servidor) manejarEstado(w http.ResponseWriter, r *http.Request) {
	responder(w, http.StatusOK, map[string]any{
		"servicio":    "legal",
		"nombre":      "LEGAL · Gestión de procesos legales",
		"version":     s.version,
		"iniciadoEn":  s.iniciado.Format(time.RFC3339),
		"urlPublica":  s.cfg.URLPublica,
		"sgdUrls":     s.cfg.SGDURLs,
		"sgdSimulado": s.cfg.SGDSimulado,
		"bd": map[string]any{
			"motor":    "bbolt (NoSQL clave-valor embebido)",
			"creadaEn": s.bd.CreadaEn(),
			"procesos": s.bd.Contar(colProcesos),
			"tramites": s.bd.Contar(colTramites),
			"usuarios": s.bd.Contar(colUsuarios),
		},
	})
}

// manejarDatos devuelve todo lo que el portal necesita para el usuario en sesión.
func (s *Servidor) manejarDatos(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	usuarios, err1 := listar[Usuario](s.bd, colUsuarios)
	procesos, err2 := listar[Proceso](s.bd, colProcesos)
	tareas, err3 := listar[Tarea](s.bd, colTareas)
	tramites, err4 := listar[TramiteSGD](s.bd, colTramites)
	solicitudes, err5 := listar[Solicitud](s.bd, colSolicitudes)
	plantillas, err6 := listar[Plantilla](s.bd, colPlantillas)
	if err := errors.Join(err1, err2, err3, err4, err5, err6); err != nil {
		errorInterno(w, err)
		return
	}
	for i := range usuarios {
		usuarios[i] = usuarios[i].Publico()
	}
	// El profesional ve solo sus procesos; los demás perfiles ven toda la cartera.
	if u.Rol == RolProfesional {
		mios := map[string]bool{}
		propios := []Proceso{}
		for _, p := range procesos {
			if p.ProfesionalID == u.ID {
				propios = append(propios, p)
				mios[p.ID] = true
			}
		}
		procesos = propios
		tareas = filtrar(tareas, func(t Tarea) bool { return mios[t.ProcesoID] })
		tramites = filtrar(tramites, func(t TramiteSGD) bool { return mios[t.ProcesoID] })
		solicitudes = filtrar(solicitudes, func(x Solicitud) bool { return mios[x.ProcesoID] })
	}
	sort.Slice(procesos, func(i, j int) bool { return procesos[i].Codigo > procesos[j].Codigo })
	sort.Slice(tareas, func(i, j int) bool {
		if tareas[i].ProcesoID != tareas[j].ProcesoID {
			return tareas[i].ProcesoID < tareas[j].ProcesoID
		}
		return tareas[i].Orden < tareas[j].Orden
	})
	sort.Slice(tramites, func(i, j int) bool { return tramites[i].IndexadoEn > tramites[j].IndexadoEn })
	cfg := s.configuracion()
	cal := nuevoCalendario(cfg.FeriadosAdicionales)
	responder(w, http.StatusOK, map[string]any{
		"usuario":     u.Publico(),
		"usuarios":    usuarios,
		"taxonomia":   s.taxonomia(),
		"plantillas":  plantillas,
		"procesos":    procesos,
		"tareas":      tareas,
		"tramites":    tramites,
		"solicitudes": solicitudes,
		"alertas":     calcularAlertas(u, procesos, tareas, tramites, solicitudes, usuarios, cfg, cal),
		"config":      cfg,
		"feriados":    cal.Lista(),
		"hoy":         hoy(),
		"servidor":    map[string]any{"version": s.version, "urlPublica": s.cfg.URLPublica, "sgdUrls": s.cfg.SGDURLs, "sgdSimulado": s.cfg.SGDSimulado},
	})
}

// manejarCatalogo: lo que necesita el Conector SGD para indexar.
func (s *Servidor) manejarCatalogo(w http.ResponseWriter, r *http.Request) {
	usuarios, _ := listar[Usuario](s.bd, colUsuarios)
	plantillas, _ := listar[Plantilla](s.bd, colPlantillas)
	procesos, _ := listar[Proceso](s.bd, colProcesos)
	type plantillaResumen struct {
		ID        string `json:"id"`
		Nombre    string `json:"nombre"`
		Via       string `json:"via"`
		Categoria string `json:"categoria"`
		Tareas    int    `json:"tareas"`
	}
	type profesional struct {
		ID         string             `json:"id"`
		Nombre     string             `json:"nombre"`
		Cargo      string             `json:"cargo"`
		Plantillas []plantillaResumen `json:"plantillas"`
	}
	profesionales := []profesional{}
	for _, u := range usuarios {
		if u.Rol != RolProfesional || !u.Activo {
			continue
		}
		p := profesional{ID: u.ID, Nombre: u.Nombre, Cargo: u.Cargo, Plantillas: []plantillaResumen{}}
		for _, pl := range plantillas {
			if pl.ProfesionalID == u.ID {
				p.Plantillas = append(p.Plantillas, plantillaResumen{pl.ID, pl.Nombre, pl.Via, pl.Categoria, len(pl.Tareas)})
			}
		}
		profesionales = append(profesionales, p)
	}
	sort.Slice(profesionales, func(i, j int) bool { return profesionales[i].Nombre < profesionales[j].Nombre })
	enCurso := []map[string]any{}
	for _, p := range procesos {
		if p.Estado == ProcesoFinalizado {
			continue
		}
		enCurso = append(enCurso, map[string]any{"id": p.ID, "codigo": p.Codigo, "titulo": p.Titulo, "categoria": p.Categoria, "via": p.Via, "profesionalId": p.ProfesionalID, "estado": p.Estado, "fechaInicio": p.FechaInicio})
	}
	sort.Slice(enCurso, func(i, j int) bool { return enCurso[i]["codigo"].(string) > enCurso[j]["codigo"].(string) })
	responder(w, http.StatusOK, map[string]any{
		"servidor":      "LEGAL · " + s.configuracion().NombreEntidad,
		"usuario":       usuarioDe(r).Publico(),
		"taxonomia":     s.taxonomia(),
		"profesionales": profesionales,
		"procesos":      enCurso,
		"urlPortal":     s.cfg.URLPublica + "/portal/",
	})
}

func (s *Servidor) manejarConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		responder(w, http.StatusOK, map[string]any{"config": s.configuracion()})
		return
	}
	var c Configuracion
	if !leerJSON(w, r, &c) {
		return
	}
	if c.DiasAlertaPorVencer < 0 || c.DiasAlertaPorVencer > 60 || c.DiasSinMovimiento < 1 || c.UmbralVencidasPct < 1 || c.UmbralVencidasPct > 100 {
		rechazar(w, http.StatusUnprocessableEntity, "Revise los valores: días de aviso (0-60), días sin movimiento (≥ 1) y umbral (1-100 %).")
		return
	}
	limpios := []string{}
	for _, f := range c.FeriadosAdicionales {
		if _, err := time.Parse(formatoDia, strings.TrimSpace(f)); err == nil {
			limpios = append(limpios, strings.TrimSpace(f))
		}
	}
	c.FeriadosAdicionales = limpios
	if strings.TrimSpace(c.NombreEntidad) == "" {
		c.NombreEntidad = configuracionInicial().NombreEntidad
	}
	if err := s.bd.GuardarJSON(colSistema, claveConfig, c); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(usuarioDe(r).Usuario, "configuración", "Parámetros de alertas y feriados actualizados")
	responder(w, http.StatusOK, map[string]any{"config": c})
}

func (s *Servidor) manejarTaxonomia(w http.ResponseWriter, r *http.Request) {
	var t Taxonomia
	if !leerJSON(w, r, &t) {
		return
	}
	codigos := map[string]bool{}
	for _, c := range t.Categorias {
		if strings.TrimSpace(c.Codigo) == "" || strings.TrimSpace(c.Nombre) == "" {
			rechazar(w, http.StatusUnprocessableEntity, "Cada categoría necesita código y nombre.")
			return
		}
		if codigos[c.Codigo] {
			rechazar(w, http.StatusUnprocessableEntity, "Código repetido: "+c.Codigo)
			return
		}
		codigos[c.Codigo] = true
		for _, v := range c.Vias {
			if strings.TrimSpace(v.Codigo) == "" || strings.TrimSpace(v.Nombre) == "" {
				rechazar(w, http.StatusUnprocessableEntity, "Cada vía necesita código y nombre ("+c.Nombre+").")
				return
			}
			if codigos[v.Codigo] {
				rechazar(w, http.StatusUnprocessableEntity, "Código repetido: "+v.Codigo)
				return
			}
			codigos[v.Codigo] = true
		}
	}
	// No se pueden quitar vías que usan procesos o plantillas.
	procesos, _ := listar[Proceso](s.bd, colProcesos)
	plantillas, _ := listar[Plantilla](s.bd, colPlantillas)
	for _, p := range procesos {
		if _, v := t.buscar(p.Categoria, p.Via); v == nil {
			rechazar(w, http.StatusConflict, fmt.Sprintf("La vía %s (categoría %s) la usa el proceso %s: no se puede quitar. Puede desactivarla.", p.Via, p.Categoria, p.Codigo))
			return
		}
	}
	for _, p := range plantillas {
		if _, v := t.buscar(p.Categoria, p.Via); v == nil {
			rechazar(w, http.StatusConflict, fmt.Sprintf("La vía %s la usa la plantilla «%s»: no se puede quitar. Puede desactivarla.", p.Via, p.Nombre))
			return
		}
	}
	t.ActualizadaEn = ahora()
	if err := s.bd.GuardarJSON(colSistema, claveTaxonomia, t); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(usuarioDe(r).Usuario, "taxonomía", "Categorías y vías actualizadas")
	responder(w, http.StatusOK, map[string]any{"taxonomia": t})
}

// ----------------------------------------------------------- plantillas

func (s *Servidor) manejarPlantilla(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	var actual *Plantilla
	if id := r.PathValue("id"); id != "" {
		p, err := obtener[Plantilla](s.bd, colPlantillas, id)
		if err != nil {
			rechazar(w, http.StatusNotFound, "La plantilla no existe.")
			return
		}
		if u.Rol != RolAdmin && p.ProfesionalID != u.ID {
			rechazar(w, http.StatusForbidden, "Solo puede modificar sus propias plantillas.")
			return
		}
		actual = &p
	}
	if r.Method == http.MethodDelete {
		s.bd.Borrar(colPlantillas, actual.ID)
		s.auditar(u.Usuario, "baja de plantilla", actual.Nombre)
		responder(w, http.StatusOK, map[string]any{"eliminada": true})
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		metodoNoPermitido(w)
		return
	}
	var p Plantilla
	if !leerJSON(w, r, &p) {
		return
	}
	p.Nombre = strings.TrimSpace(p.Nombre)
	if actual != nil {
		p.ID, p.CreadaEn, p.ProfesionalID = actual.ID, actual.CreadaEn, actual.ProfesionalID
	} else {
		p.ID, p.CreadaEn = nuevoID("PLT"), ahora()
		if u.Rol != RolAdmin || p.ProfesionalID == "" {
			p.ProfesionalID = u.ID
		}
	}
	if prof, err := obtener[Usuario](s.bd, colUsuarios, p.ProfesionalID); err != nil || prof.Rol != RolProfesional {
		rechazar(w, http.StatusUnprocessableEntity, "La plantilla debe pertenecer a un profesional.")
		return
	}
	cat, via := s.taxonomia().buscar(p.Categoria, p.Via)
	if cat == nil || via == nil {
		rechazar(w, http.StatusUnprocessableEntity, "Elija una categoría y una vía procedimental válidas.")
		return
	}
	if p.Nombre == "" {
		p.Nombre = via.Nombre
	}
	if len(p.Tareas) == 0 {
		rechazar(w, http.StatusUnprocessableEntity, "La plantilla debe tener al menos una tarea.")
		return
	}
	for i := range p.Tareas {
		t := &p.Tareas[i]
		t.Nombre = strings.TrimSpace(t.Nombre)
		if t.Nombre == "" {
			rechazar(w, http.StatusUnprocessableEntity, fmt.Sprintf("La tarea %d no tiene nombre.", i+1))
			return
		}
		if t.PlazoDias != nil && (*t.PlazoDias < 0 || *t.PlazoDias > 3650) {
			rechazar(w, http.StatusUnprocessableEntity, fmt.Sprintf("El plazo de «%s» no es válido.", t.Nombre))
			return
		}
		if t.TipoDias != DiasCalendario {
			t.TipoDias = DiasHabiles
		}
		if t.Desde != DesdeInicio {
			t.Desde = DesdeAntecesora
		}
		if t.Antecesora != nil && (*t.Antecesora < -1 || *t.Antecesora >= i) {
			rechazar(w, http.StatusUnprocessableEntity, fmt.Sprintf("La antecesora de «%s» debe ser una tarea anterior.", t.Nombre))
			return
		}
	}
	plantillas, _ := listar[Plantilla](s.bd, colPlantillas)
	for _, x := range plantillas {
		if x.ID != p.ID && x.ProfesionalID == p.ProfesionalID && x.Via == p.Via {
			rechazar(w, http.StatusConflict, fmt.Sprintf("Ya tiene la plantilla «%s» para %s. Edítela en lugar de crear otra.", x.Nombre, via.Nombre))
			return
		}
	}
	p.ActualizadaEn = ahora()
	if err := s.bd.GuardarJSON(colPlantillas, p.ID, p); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(u.Usuario, "plantilla", p.Nombre)
	estado := http.StatusOK
	if actual == nil {
		estado = http.StatusCreated
	}
	responder(w, estado, map[string]any{"plantilla": p})
}

// ------------------------------------------------------------- procesos

type entradaProceso struct {
	Titulo             string `json:"titulo"`
	Categoria          string `json:"categoria"`
	Via                string `json:"via"`
	ProfesionalID      string `json:"profesionalId"`
	FechaInicio        string `json:"fechaInicio"`
	ExpedienteJudicial string `json:"expedienteJudicial"`
	Organo             string `json:"organo"`
	Contraparte        string `json:"contraparte"`
	Observaciones      string `json:"observaciones"`
}

// crearProceso valida, asigna el código correlativo y genera el ciclo de tareas.
func (s *Servidor) crearProceso(u *Usuario, e entradaProceso, origen string) (*Proceso, []Tarea, error) {
	e.Titulo = strings.TrimSpace(e.Titulo)
	if e.Titulo == "" {
		return nil, nil, fallo(http.StatusUnprocessableEntity, "Indique el título o materia del proceso.")
	}
	_, via := s.taxonomia().buscar(e.Categoria, e.Via)
	if via == nil {
		return nil, nil, fallo(http.StatusUnprocessableEntity, "La vía procedimental no corresponde a la categoría elegida.")
	}
	if via.Desactivada {
		return nil, nil, fallo(http.StatusUnprocessableEntity, "La vía «%s» está desactivada.", via.Nombre)
	}
	if u.Rol == RolProfesional && e.ProfesionalID == "" {
		e.ProfesionalID = u.ID
	}
	if u.Rol == RolProfesional && e.ProfesionalID != u.ID {
		return nil, nil, fallo(http.StatusForbidden, "Un profesional solo puede registrar procesos a su cargo.")
	}
	prof, err := obtener[Usuario](s.bd, colUsuarios, e.ProfesionalID)
	if err != nil || prof.Rol != RolProfesional || !prof.Activo {
		return nil, nil, fallo(http.StatusUnprocessableEntity, "Elija un profesional activo.")
	}
	if e.FechaInicio == "" {
		e.FechaInicio = hoy()
	} else if _, err := time.Parse(formatoDia, e.FechaInicio); err != nil {
		return nil, nil, fallo(http.StatusUnprocessableEntity, "La fecha de inicio no es válida.")
	}
	anio := time.Now().Year()
	n, err := s.bd.Siguiente(fmt.Sprintf("proceso-%d", anio))
	if err != nil {
		return nil, nil, err
	}
	p := &Proceso{
		ID: nuevoID("PRO"), Codigo: fmt.Sprintf("PL-%d-%04d", anio, n), Titulo: e.Titulo, Categoria: e.Categoria, Via: e.Via,
		ProfesionalID: prof.ID, Estado: ProcesoActivo, FechaInicio: e.FechaInicio, Origen: origen,
		ExpedienteJudicial: strings.TrimSpace(e.ExpedienteJudicial), Organo: strings.TrimSpace(e.Organo),
		Contraparte: strings.TrimSpace(e.Contraparte), Observaciones: strings.TrimSpace(e.Observaciones),
		CreadoPor: u.Usuario, CreadoEn: ahora(), ActualizadoEn: ahora(),
	}
	tareas, err := s.generarCiclo(p, via, u.Usuario)
	if err != nil {
		return nil, nil, err
	}
	if err := s.bd.GuardarJSON(colProcesos, p.ID, p); err != nil {
		return nil, nil, err
	}
	s.auditar(u.Usuario, "alta de proceso", fmt.Sprintf("%s · %s (%d tareas, %s)", p.Codigo, p.Titulo, len(tareas), p.PlantillaNombre))
	return p, tareas, nil
}

func (s *Servidor) manejarCrearProceso(w http.ResponseWriter, r *http.Request) {
	var e entradaProceso
	if !leerJSON(w, r, &e) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, tareas, err := s.crearProceso(usuarioDe(r), e, "Portal")
	if err != nil {
		responderError(w, err)
		return
	}
	responder(w, http.StatusCreated, map[string]any{"proceso": p, "tareas": tareas})
}

func (s *Servidor) manejarProceso(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	p, err := obtener[Proceso](s.bd, colProcesos, r.PathValue("id"))
	if err != nil {
		rechazar(w, http.StatusNotFound, "El proceso no existe.")
		return
	}
	if u.Rol == RolProfesional && p.ProfesionalID != u.ID {
		rechazar(w, http.StatusForbidden, "El proceso está a cargo de otro profesional.")
		return
	}
	switch r.Method {
	case http.MethodGet:
		tramites, _ := listar[TramiteSGD](s.bd, colTramites)
		propios := filtrar(tramites, func(t TramiteSGD) bool { return t.ProcesoID == p.ID })
		responder(w, http.StatusOK, map[string]any{"proceso": p, "tareas": s.tareasDe(p.ID), "tramites": propios})
	case http.MethodPut:
		var sol struct {
			Titulo             *string `json:"titulo"`
			Estado             *string `json:"estado"`
			ProfesionalID      *string `json:"profesionalId"`
			ExpedienteJudicial *string `json:"expedienteJudicial"`
			Organo             *string `json:"organo"`
			Contraparte        *string `json:"contraparte"`
			Observaciones      *string `json:"observaciones"`
		}
		if !leerJSON(w, r, &sol) {
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		cambios := []string{}
		if sol.Titulo != nil && strings.TrimSpace(*sol.Titulo) != "" {
			p.Titulo = strings.TrimSpace(*sol.Titulo)
		}
		for destino, valor := range map[*string]*string{&p.ExpedienteJudicial: sol.ExpedienteJudicial, &p.Organo: sol.Organo, &p.Contraparte: sol.Contraparte, &p.Observaciones: sol.Observaciones} {
			if valor != nil {
				*destino = strings.TrimSpace(*valor)
			}
		}
		if sol.ProfesionalID != nil && *sol.ProfesionalID != p.ProfesionalID {
			if u.Rol == RolProfesional {
				rechazar(w, http.StatusForbidden, "La reasignación la realiza la gerencia o el asistente.")
				return
			}
			prof, err := obtener[Usuario](s.bd, colUsuarios, *sol.ProfesionalID)
			if err != nil || prof.Rol != RolProfesional || !prof.Activo {
				rechazar(w, http.StatusUnprocessableEntity, "Elija un profesional activo.")
				return
			}
			cambios = append(cambios, "reasignado a "+prof.Nombre)
			p.ProfesionalID = prof.ID
		}
		if sol.Estado != nil && *sol.Estado != p.Estado {
			nuevo := *sol.Estado
			if nuevo != ProcesoActivo && nuevo != ProcesoSuspendido && nuevo != ProcesoFinalizado {
				rechazar(w, http.StatusUnprocessableEntity, "Estado no válido.")
				return
			}
			if u.Rol == RolAsistente {
				rechazar(w, http.StatusForbidden, "El cambio de estado lo realiza el profesional a cargo o la gerencia.")
				return
			}
			if nuevo == ProcesoFinalizado {
				for _, t := range s.tareasDe(p.ID) {
					if t.Estado != TareaFinalizada {
						rechazar(w, http.StatusConflict, fmt.Sprintf("No se puede finalizar: la tarea «%s» está %s.", t.Nombre, strings.ToLower(t.Estado)))
						return
					}
				}
				p.FechaFin = hoy()
			} else {
				p.FechaFin = ""
			}
			cambios = append(cambios, p.Estado+" → "+nuevo)
			p.Estado = nuevo
		}
		p.ActualizadoEn = ahora()
		if err := s.bd.GuardarJSON(colProcesos, p.ID, p); err != nil {
			errorInterno(w, err)
			return
		}
		s.auditar(u.Usuario, "edición de proceso", p.Codigo+" "+strings.Join(cambios, ", "))
		responder(w, http.StatusOK, map[string]any{"proceso": p})
	case http.MethodDelete:
		if u.Rol != RolAdmin {
			rechazar(w, http.StatusForbidden, "Solo el administrador puede eliminar procesos.")
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, t := range s.tareasDe(p.ID) {
			s.bd.Borrar(colTareas, t.ID)
		}
		tramites, _ := listar[TramiteSGD](s.bd, colTramites)
		for _, t := range tramites {
			if t.ProcesoID == p.ID {
				s.bd.Borrar(colTramites, t.ID)
			}
		}
		solicitudes, _ := listar[Solicitud](s.bd, colSolicitudes)
		for _, x := range solicitudes {
			if x.ProcesoID == p.ID {
				s.bd.Borrar(colSolicitudes, x.ID)
			}
		}
		s.bd.Borrar(colProcesos, p.ID)
		s.auditar(u.Usuario, "baja de proceso", p.Codigo+" · "+p.Titulo)
		responder(w, http.StatusOK, map[string]any{"eliminado": true})
	default:
		metodoNoPermitido(w)
	}
}

// --------------------------------------------------------------- tareas

// procesoEditable: el profesional a cargo (o el administrador) actualiza las tareas.
func (s *Servidor) procesoEditable(u *Usuario, procesoID string) (*Proceso, error) {
	p, err := obtener[Proceso](s.bd, colProcesos, procesoID)
	if err != nil {
		return nil, fallo(http.StatusNotFound, "El proceso no existe.")
	}
	if u.Rol != RolAdmin && p.ProfesionalID != u.ID {
		return nil, fallo(http.StatusForbidden, "Solo el profesional a cargo actualiza las tareas del proceso.")
	}
	if p.Estado == ProcesoFinalizado {
		return nil, fallo(http.StatusConflict, "El proceso %s está finalizado: reactívelo para modificar sus tareas.", p.Codigo)
	}
	return &p, nil
}

type entradaPlazo struct {
	ID          string  `json:"id"`
	FechaLimite *string `json:"fechaLimite"`
	PlazoDias   *int    `json:"plazoDias"`
	TipoDias    string  `json:"tipoDias"`
}

// aplicarPlazo fija la fecha límite exacta o un plazo relativo en días.
func (s *Servidor) aplicarPlazo(t *Tarea, e entradaPlazo, usuario string, cal Calendario) error {
	switch {
	case e.FechaLimite != nil:
		f := strings.TrimSpace(*e.FechaLimite)
		if f != "" {
			if _, err := time.Parse(formatoDia, f); err != nil {
				return fallo(http.StatusUnprocessableEntity, "La fecha límite de «%s» no es válida.", t.Nombre)
			}
			if t.FechaInicio != "" && f < t.FechaInicio {
				return fallo(http.StatusUnprocessableEntity, "La fecha límite de «%s» es anterior a su inicio (%s).", t.Nombre, t.FechaInicio)
			}
		}
		t.FechaLimite = f
		if f == "" {
			t.PlazoDias = nil
		}
		t.Historial = append(t.Historial, Evento{ahora(), usuario, "Fecha límite: " + valorOGuion(f)})
	case e.PlazoDias != nil:
		if *e.PlazoDias < 0 || *e.PlazoDias > 3650 {
			return fallo(http.StatusUnprocessableEntity, "El plazo de «%s» no es válido.", t.Nombre)
		}
		dias := *e.PlazoDias
		t.PlazoDias = &dias
		if e.TipoDias == DiasCalendario {
			t.TipoDias = DiasCalendario
		} else {
			t.TipoDias = DiasHabiles
		}
		tipo := "hábiles"
		if t.TipoDias == DiasCalendario {
			tipo = "calendario"
		}
		if t.Estado != TareaPendiente {
			t.FechaLimite = cal.Sumar(valorO(t.FechaInicio, hoy()), dias, t.TipoDias)
			t.Historial = append(t.Historial, Evento{ahora(), usuario, fmt.Sprintf("Plazo: %d días %s → vence el %s", dias, tipo, t.FechaLimite)})
		} else {
			t.FechaLimite = ""
			t.Historial = append(t.Historial, Evento{ahora(), usuario, fmt.Sprintf("Plazo: %d días %s desde que inicie la tarea", dias, tipo)})
		}
	default:
		return nil
	}
	t.PlazoDefinidoPor = usuario
	t.PlazoDefinidoEn = ahora()
	t.ActualizadaEn = ahora()
	s.atenderSolicitudesDe(t.ID)
	return nil
}

func (s *Servidor) atenderSolicitudesDe(tareaID string) {
	solicitudes, _ := listar[Solicitud](s.bd, colSolicitudes)
	for _, x := range solicitudes {
		if x.TareaID == tareaID && x.Estado == "pendiente" {
			x.Estado, x.AtendidaEn = "atendida", ahora()
			s.bd.GuardarJSON(colSolicitudes, x.ID, x)
		}
	}
}

func (s *Servidor) manejarTarea(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	t, err := obtener[Tarea](s.bd, colTareas, r.PathValue("id"))
	if err != nil {
		rechazar(w, http.StatusNotFound, "La tarea no existe.")
		return
	}
	p, err := s.procesoEditable(u, t.ProcesoID)
	if err != nil {
		responderError(w, err)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var sol struct {
			entradaPlazo
			Nombre      *string `json:"nombre"`
			Descripcion *string `json:"descripcion"`
			Estado      *string `json:"estado"`
			Notas       *string `json:"notas"`
			Checklist   *[]Item `json:"checklist"`
		}
		if !leerJSON(w, r, &sol) {
			return
		}
		if sol.Nombre != nil && strings.TrimSpace(*sol.Nombre) != "" {
			t.Nombre = strings.TrimSpace(*sol.Nombre)
		}
		if sol.Descripcion != nil {
			t.Descripcion = strings.TrimSpace(*sol.Descripcion)
		}
		if sol.Notas != nil {
			t.Notas = strings.TrimSpace(*sol.Notas)
		}
		if sol.Checklist != nil {
			t.Checklist = *sol.Checklist
		}
		cal := s.calendario()
		var sucesoras []Tarea
		if sol.Estado != nil {
			if *sol.Estado != TareaPendiente && *sol.Estado != TareaEnProceso && *sol.Estado != TareaFinalizada {
				rechazar(w, http.StatusUnprocessableEntity, "Estado de tarea no válido.")
				return
			}
			sucesoras, _ = s.cambiarEstadoTarea(&t, *sol.Estado, u.Usuario)
		}
		if err := s.aplicarPlazo(&t, sol.entradaPlazo, u.Usuario, cal); err != nil {
			responderError(w, err)
			return
		}
		t.ActualizadaEn = ahora()
		if err := s.bd.GuardarJSON(colTareas, t.ID, t); err != nil {
			errorInterno(w, err)
			return
		}
		for _, x := range sucesoras {
			s.bd.GuardarJSON(colTareas, x.ID, x)
		}
		p.ActualizadoEn = ahora()
		s.bd.GuardarJSON(colProcesos, p.ID, p)
		responder(w, http.StatusOK, map[string]any{"tarea": t, "sucesoras": sucesoras})
	case http.MethodDelete:
		// Las sucesoras pasan a depender de la antecesora de la tarea eliminada.
		for _, x := range s.tareasDe(p.ID) {
			if x.AntecesoraID == t.ID {
				x.AntecesoraID = t.AntecesoraID
				s.bd.GuardarJSON(colTareas, x.ID, x)
			}
		}
		s.bd.Borrar(colTareas, t.ID)
		s.auditar(u.Usuario, "baja de tarea", p.Codigo+" · "+t.Nombre)
		responder(w, http.StatusOK, map[string]any{"eliminada": true})
	default:
		metodoNoPermitido(w)
	}
}

func (s *Servidor) manejarCrearTarea(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	var sol struct {
		entradaPlazo
		ProcesoID    string `json:"procesoId"`
		Nombre       string `json:"nombre"`
		Descripcion  string `json:"descripcion"`
		AntecesoraID string `json:"antecesoraId"`
	}
	if !leerJSON(w, r, &sol) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.procesoEditable(u, sol.ProcesoID)
	if err != nil {
		responderError(w, err)
		return
	}
	if strings.TrimSpace(sol.Nombre) == "" {
		rechazar(w, http.StatusUnprocessableEntity, "Indique el nombre de la tarea.")
		return
	}
	tareas := s.tareasDe(p.ID)
	t := Tarea{ID: nuevoID("TAR"), ProcesoID: p.ID, Orden: len(tareas) + 1, Nombre: strings.TrimSpace(sol.Nombre), Descripcion: strings.TrimSpace(sol.Descripcion),
		Estado: TareaEnProceso, TipoDias: DiasHabiles, Desde: DesdeAntecesora, FechaInicio: hoy(), ActualizadaEn: ahora(),
		Historial: []Evento{{ahora(), u.Usuario, "Tarea agregada por el profesional"}}}
	if sol.AntecesoraID != "" {
		var ant *Tarea
		for i := range tareas {
			if tareas[i].ID == sol.AntecesoraID {
				ant = &tareas[i]
			}
		}
		if ant == nil {
			rechazar(w, http.StatusUnprocessableEntity, "La tarea antecesora no pertenece al proceso.")
			return
		}
		t.AntecesoraID = ant.ID
		if ant.Estado != TareaFinalizada {
			t.Estado, t.FechaInicio = TareaPendiente, ""
		}
	}
	if err := s.aplicarPlazo(&t, sol.entradaPlazo, u.Usuario, s.calendario()); err != nil {
		responderError(w, err)
		return
	}
	if err := s.bd.GuardarJSON(colTareas, t.ID, t); err != nil {
		errorInterno(w, err)
		return
	}
	p.ActualizadoEn = ahora()
	s.bd.GuardarJSON(colProcesos, p.ID, p)
	responder(w, http.StatusCreated, map[string]any{"tarea": t})
}

// manejarPlazos: actualización en bloque de plazos (vista «Plazos por definir»).
func (s *Servidor) manejarPlazos(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	var sol struct {
		Cambios []entradaPlazo `json:"cambios"`
	}
	if !leerJSON(w, r, &sol) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cal := s.calendario()
	actualizadas := []Tarea{}
	pendientes := []Tarea{}
	for _, c := range sol.Cambios {
		t, err := obtener[Tarea](s.bd, colTareas, c.ID)
		if err != nil {
			rechazar(w, http.StatusNotFound, "Una de las tareas ya no existe; actualice la página.")
			return
		}
		if _, err := s.procesoEditable(u, t.ProcesoID); err != nil {
			responderError(w, err)
			return
		}
		if err := s.aplicarPlazo(&t, c, u.Usuario, cal); err != nil {
			responderError(w, err)
			return
		}
		pendientes = append(pendientes, t)
	}
	for _, t := range pendientes {
		if err := s.bd.GuardarJSON(colTareas, t.ID, t); err != nil {
			errorInterno(w, err)
			return
		}
		actualizadas = append(actualizadas, t)
	}
	s.auditar(u.Usuario, "plazos", fmt.Sprintf("%d plazo(s) definidos", len(actualizadas)))
	responder(w, http.StatusOK, map[string]any{"tareas": actualizadas})
}

// ------------------------------------------------------- indexación SGD

type entradaIndexar struct {
	Accion             string         `json:"accion"` // nuevo | existente
	Tramite            TramiteSGD     `json:"tramite"`
	Detalle            string         `json:"detalle"`
	ProcesoID          string         `json:"procesoId"`
	TareaID            string         `json:"tareaId"`
	Proceso            entradaProceso `json:"proceso"`
	ConfirmarDuplicado bool           `json:"confirmarDuplicado"`
}

var reTramite = regexp.MustCompile(`^\S.{0,80}$`)

func (s *Servidor) manejarIndexar(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	var e entradaIndexar
	if !leerJSON(w, r, &e) {
		return
	}
	t := e.Tramite
	t.NroTramite = strings.TrimSpace(t.NroTramite)
	t.IDInterno = strings.TrimSpace(t.IDInterno)
	t.AsuntoSGD = strings.TrimSpace(t.AsuntoSGD)
	t.EnlaceSGD = strings.TrimSpace(t.EnlaceSGD)
	var faltan []string
	if t.NroTramite == "" && t.IDInterno == "" {
		faltan = append(faltan, "n.º de trámite")
	} else if t.NroTramite != "" && !reTramite.MatchString(t.NroTramite) {
		faltan = append(faltan, "n.º de trámite válido")
	}
	if t.AsuntoSGD == "" {
		faltan = append(faltan, "asunto del trámite")
	}
	if eu, err := url.Parse(t.EnlaceSGD); t.EnlaceSGD == "" || err != nil || (eu.Scheme != "http" && eu.Scheme != "https") {
		faltan = append(faltan, "enlace al SGD")
	}
	if len(faltan) > 0 {
		rechazar(w, http.StatusUnprocessableEntity, "Faltan datos: "+strings.Join(faltan, ", ")+".")
		return
	}
	if t.NroTramite == "" {
		t.NroTramite = "ID " + t.IDInterno
	}
	if eu, err := url.Parse(t.EnlaceSGD); err == nil {
		t.SGD = eu.Host
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var p *Proceso
	var tareas []Tarea
	switch e.Accion {
	case "nuevo":
		if strings.TrimSpace(e.Proceso.Titulo) == "" {
			e.Proceso.Titulo = t.AsuntoSGD
		}
		var err error
		p, tareas, err = s.crearProceso(u, e.Proceso, "SGD")
		if err != nil {
			responderError(w, err)
			return
		}
	case "existente":
		x, err := obtener[Proceso](s.bd, colProcesos, e.ProcesoID)
		if err != nil {
			rechazar(w, http.StatusNotFound, "El proceso elegido no existe.")
			return
		}
		if x.Estado == ProcesoFinalizado {
			rechazar(w, http.StatusConflict, fmt.Sprintf("El proceso %s está finalizado y no admite nuevos documentos.", x.Codigo))
			return
		}
		if u.Rol == RolProfesional && x.ProfesionalID != u.ID {
			rechazar(w, http.StatusForbidden, "El proceso está a cargo de otro profesional.")
			return
		}
		tramites, _ := listar[TramiteSGD](s.bd, colTramites)
		for _, previo := range tramites {
			if previo.ProcesoID == x.ID && previo.NroTramite == t.NroTramite && !e.ConfirmarDuplicado {
				responder(w, http.StatusConflict, map[string]any{"mensaje": fmt.Sprintf("El trámite %s ya está indexado en %s (%s). Confirme para registrarlo otra vez.", t.NroTramite, x.Codigo, previo.IndexadoEn[:10]), "duplicado": true})
				return
			}
		}
		if e.TareaID != "" {
			ok := false
			for _, tt := range s.tareasDe(x.ID) {
				ok = ok || tt.ID == e.TareaID
			}
			if !ok {
				rechazar(w, http.StatusUnprocessableEntity, "La tarea elegida no pertenece al proceso.")
				return
			}
			t.TareaID = e.TareaID
		}
		x.ActualizadoEn = ahora()
		s.bd.GuardarJSON(colProcesos, x.ID, x)
		p = &x
	default:
		rechazar(w, http.StatusUnprocessableEntity, "Elija la acción: nuevo proceso o proceso existente.")
		return
	}

	t.ID = nuevoID("SGD")
	t.ProcesoID = p.ID
	t.Accion = e.Accion
	t.Detalle = strings.TrimSpace(e.Detalle)
	t.IndexadoPor = u.Usuario
	t.IndexadoEn = ahora()
	if err := s.bd.GuardarJSON(colTramites, t.ID, t); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(u.Usuario, "indexación SGD", fmt.Sprintf("%s → %s (%s)", t.NroTramite, p.Codigo, e.Accion))
	log.Printf("Trámite %s indexado en %s (%s) por %s", t.NroTramite, p.Codigo, e.Accion, u.Usuario)
	responder(w, http.StatusCreated, map[string]any{
		"tramite": t, "proceso": p, "tareasGeneradas": len(tareas),
		"urlProceso": fmt.Sprintf("%s/portal/#proceso/%s", s.cfg.URLPublica, p.ID),
	})
}

// manejarConsultaTramite informa si un trámite SGD ya está vinculado a procesos.
func (s *Servidor) manejarConsultaTramite(w http.ResponseWriter, r *http.Request) {
	numero := strings.TrimSpace(r.URL.Query().Get("numero"))
	interno := strings.TrimSpace(r.URL.Query().Get("idInterno"))
	if numero == "" && interno == "" {
		rechazar(w, http.StatusBadRequest, "Indique el número de trámite.")
		return
	}
	tramites, _ := listar[TramiteSGD](s.bd, colTramites)
	procesos := map[string]Proceso{}
	lista, _ := listar[Proceso](s.bd, colProcesos)
	for _, p := range lista {
		procesos[p.ID] = p
	}
	vinculos := []map[string]any{}
	for _, t := range tramites {
		if (numero != "" && t.NroTramite == numero) || (interno != "" && t.IDInterno == interno) {
			p := procesos[t.ProcesoID]
			vinculos = append(vinculos, map[string]any{"procesoId": p.ID, "codigo": p.Codigo, "titulo": p.Titulo, "estado": p.Estado, "indexadoEn": t.IndexadoEn, "accion": t.Accion})
		}
	}
	responder(w, http.StatusOK, map[string]any{"numero": numero, "registrado": len(vinculos) > 0, "vinculaciones": vinculos})
}

func (s *Servidor) manejarMisIndexaciones(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	tramites, _ := listar[TramiteSGD](s.bd, colTramites)
	procesos := map[string]Proceso{}
	lista, _ := listar[Proceso](s.bd, colProcesos)
	for _, p := range lista {
		procesos[p.ID] = p
	}
	propios := filtrar(tramites, func(t TramiteSGD) bool { return u.Rol == RolAdmin || t.IndexadoPor == u.Usuario })
	sort.Slice(propios, func(i, j int) bool { return propios[i].IndexadoEn > propios[j].IndexadoEn })
	if len(propios) > 50 {
		propios = propios[:50]
	}
	salida := []map[string]any{}
	for _, t := range propios {
		p := procesos[t.ProcesoID]
		salida = append(salida, map[string]any{"tramite": t, "proceso": map[string]any{"id": p.ID, "codigo": p.Codigo, "titulo": p.Titulo, "estado": p.Estado}})
	}
	responder(w, http.StatusOK, map[string]any{"indexaciones": salida, "urlPortal": s.cfg.URLPublica + "/portal/"})
}

func (s *Servidor) manejarBorrarTramite(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	t, err := obtener[TramiteSGD](s.bd, colTramites, r.PathValue("id"))
	if err != nil {
		rechazar(w, http.StatusNotFound, "El trámite indexado no existe.")
		return
	}
	if u.Rol != RolAdmin && t.IndexadoPor != u.Usuario {
		rechazar(w, http.StatusForbidden, "Solo puede quitar las indexaciones que registró usted.")
		return
	}
	s.bd.Borrar(colTramites, t.ID)
	s.auditar(u.Usuario, "baja de indexación", t.NroTramite)
	responder(w, http.StatusOK, map[string]any{"eliminado": true})
}

// ----------------------------------------------------------- solicitudes

func (s *Servidor) manejarSolicitud(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	var sol struct {
		TareaID string `json:"tareaId"`
		Mensaje string `json:"mensaje"`
	}
	if !leerJSON(w, r, &sol) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t, err := obtener[Tarea](s.bd, colTareas, sol.TareaID)
	if err != nil {
		rechazar(w, http.StatusNotFound, "La tarea no existe.")
		return
	}
	p, err := obtener[Proceso](s.bd, colProcesos, t.ProcesoID)
	if err != nil {
		rechazar(w, http.StatusNotFound, "El proceso no existe.")
		return
	}
	solicitudes, _ := listar[Solicitud](s.bd, colSolicitudes)
	for _, x := range solicitudes {
		if x.TareaID == t.ID && x.Estado == "pendiente" {
			rechazar(w, http.StatusConflict, "Ya hay una solicitud pendiente para esta tarea.")
			return
		}
	}
	x := Solicitud{ID: nuevoID("SOL"), Tipo: "definir-plazo", TareaID: t.ID, ProcesoID: p.ID, De: u.ID, Para: p.ProfesionalID, Mensaje: strings.TrimSpace(sol.Mensaje), Estado: "pendiente", CreadaEn: ahora()}
	if err := s.bd.GuardarJSON(colSolicitudes, x.ID, x); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(u.Usuario, "solicitud de plazo", p.Codigo+" · "+t.Nombre)
	responder(w, http.StatusCreated, map[string]any{"solicitud": x})
}

func (s *Servidor) manejarAtenderSolicitud(w http.ResponseWriter, r *http.Request) {
	u := usuarioDe(r)
	x, err := obtener[Solicitud](s.bd, colSolicitudes, r.PathValue("id"))
	if err != nil {
		rechazar(w, http.StatusNotFound, "La solicitud no existe.")
		return
	}
	if u.Rol != RolAdmin && x.Para != u.ID && x.De != u.ID {
		rechazar(w, http.StatusForbidden, "La solicitud no está dirigida a usted.")
		return
	}
	x.Estado, x.AtendidaEn = "atendida", ahora()
	s.bd.GuardarJSON(colSolicitudes, x.ID, x)
	responder(w, http.StatusOK, map[string]any{"solicitud": x})
}

// ------------------------------------------------------- SGD simulado

var rutaDetalleSimulado = regexp.MustCompile(`^tramites/detalletramite/\d+/?$`)

// sgdSimulado reproduce las rutas del SGD de SEDAPAR (enrutador HTML5 de Angular).
func (s *Servidor) sgdSimulado(archivos http.Handler) http.Handler {
	paginas := map[string]string{
		"":                     "login.html",
		"pages/login":          "login.html",
		"pages/login/exit":     "salir.html",
		"tramites/mistramites": "mistramites.html",
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ruta := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/sgd-simulado/"), "/")
		pagina, ok := paginas[ruta]
		if !ok && rutaDetalleSimulado.MatchString(ruta) {
			pagina, ok = "detalletramite.html", true
		}
		r2 := r.Clone(r.Context())
		if ok {
			r2.URL.Path = "/" + pagina
		} else {
			r2.URL.Path = "/" + path.Clean(ruta)
		}
		archivos.ServeHTTP(w, r2)
	})
}

// ------------------------------------------------------------ utilidades

func filtrar[T any](lista []T, f func(T) bool) []T {
	salida := []T{}
	for _, x := range lista {
		if f(x) {
			salida = append(salida, x)
		}
	}
	return salida
}

func valorO(v, porDefecto string) string {
	if v == "" {
		return porDefecto
	}
	return v
}

func valorOGuion(v string) string { return valorO(v, "—") }

func leerJSON(w http.ResponseWriter, r *http.Request, destino any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, limiteCuerpo)).Decode(destino); err != nil {
		rechazar(w, http.StatusBadRequest, "La solicitud no tiene el formato esperado.")
		return false
	}
	return true
}

func responder(w http.ResponseWriter, estado int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	json.NewEncoder(w).Encode(v)
}

func rechazar(w http.ResponseWriter, estado int, mensaje string) {
	responder(w, estado, map[string]any{"mensaje": mensaje})
}

func responderError(w http.ResponseWriter, err error) {
	var e errAPI
	if errors.As(err, &e) {
		rechazar(w, e.estado, e.msg)
		return
	}
	errorInterno(w, err)
}

func metodoNoPermitido(w http.ResponseWriter) {
	rechazar(w, http.StatusMethodNotAllowed, "Método no permitido.")
}

func errorInterno(w http.ResponseWriter, err error) {
	log.Printf("Error interno: %v", err)
	rechazar(w, http.StatusInternalServerError, "Error interno del servidor.")
}
