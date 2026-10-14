package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	estadoFinalizado = "Finalizado"
	estadoRegistrado = "Registrado"
	limiteCuerpo     = 8 << 20 // 8 MB
)

type Categoria struct {
	Codigo         string   `json:"codigo"`
	Nombre         string   `json:"nombre"`
	Procedimientos []string `json:"procedimientos"`
}

type Responsable struct {
	Codigo string `json:"codigo"`
	Nombre string `json:"nombre"`
	Cargo  string `json:"cargo"`
}

type Proceso struct {
	Codigo        string `json:"codigo"`
	Denominacion  string `json:"denominacion"`
	Categoria     string `json:"categoria"`
	Procedimiento string `json:"procedimiento"`
	Responsable   string `json:"responsable"`
	Estado        string `json:"estado"`
	FechaInicio   string `json:"fechaInicio,omitempty"`
	Origen        string `json:"origen,omitempty"`
}

type Catalogo struct {
	Categorias   []Categoria   `json:"categorias"`
	Responsables []Responsable `json:"responsables"`
	Procesos     []Proceso     `json:"procesos"`
}

type Servidor struct {
	bd        *BD
	semilla   Catalogo
	web       fs.FS
	base      string
	dirExt    string
	version   string
	iniciado  time.Time
	mu        sync.Mutex // serializa la asignación de códigos de proceso
}

// ------------------------------------------------------------------ rutas

func (s *Servidor) Rutas() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/estado", s.manejarEstado)
	mux.HandleFunc("/api/catalogo", s.manejarCatalogo)
	mux.HandleFunc("/api/vinculaciones", s.manejarVinculaciones)
	mux.HandleFunc("/api/portal", s.manejarPortal)
	mux.HandleFunc("/api/reiniciar", s.manejarReiniciar)

	estatico := func(dir string) http.Handler {
		sub, err := fs.Sub(s.web, dir)
		if err != nil {
			panic(err)
		}
		return http.FileServer(http.FS(sub))
	}
	mux.Handle("/portal/", http.StripPrefix("/portal/", estatico("portal")))
	mux.Handle("/sgd-simulado/", http.StripPrefix("/sgd-simulado/", estatico("sgd-simulado")))
	mux.Handle("/", estatico("centro"))
	return s.cabeceras(mux)
}

// cabeceras: sin caché para los archivos de prueba y CORS solo para la extensión.
func (s *Servidor) cabeceras(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if origen := r.Header.Get("Origin"); strings.HasPrefix(origen, "chrome-extension://") {
				w.Header().Set("Access-Control-Allow-Origin", origen)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------- handlers

func (s *Servidor) manejarEstado(w http.ResponseWriter, r *http.Request) {
	_, errPortal := s.bd.Obtener(colPortal, claveDatos)
	responder(w, http.StatusOK, map[string]any{
		"servicio":   "legal-prueba",
		"nombre":     "LEGAL · Entorno de prueba",
		"version":    s.version,
		"iniciadoEn": s.iniciado.Format(time.RFC3339),
		"bd": map[string]any{
			"motor":              "bbolt (NoSQL clave-valor embebido)",
			"ruta":               s.bd.ruta,
			"creadaEn":           s.bd.CreadaEn(),
			"tramites":           s.bd.Contar(colTramites),
			"procesosConector":   s.bd.Contar(colProcesos),
			"portalInicializado": errPortal == nil,
		},
		"extension": map[string]any{"ruta": s.dirExt},
		"urls": map[string]any{
			"centro":      s.base,
			"portal":      s.base + "portal/",
			"sgdSimulado": s.base + "sgd-simulado/",
		},
	})
}

func (s *Servidor) manejarCatalogo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		metodoNoPermitido(w)
		return
	}
	cat, err := s.catalogoActual()
	if err != nil {
		errorInterno(w, err)
		return
	}
	responder(w, http.StatusOK, map[string]any{
		"servidor":     "LEGAL · Entorno de prueba",
		"categorias":   cat.Categorias,
		"responsables": cat.Responsables,
		"procesos":     cat.Procesos,
	})
}

func (s *Servidor) manejarVinculaciones(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tramites, err1 := s.bd.Listar(colTramites)
		procesos, err2 := s.bd.Listar(colProcesos)
		if err := errors.Join(err1, err2); err != nil {
			errorInterno(w, err)
			return
		}
		ordenarPorCampo(tramites, "fechaCaptura")
		responder(w, http.StatusOK, map[string]any{
			"formato":             "legal-sgd-intercambio",
			"version":             1,
			"generadoEn":          time.Now().Format(time.RFC3339),
			"procesosRegistrados": vacioSiNulo(procesos),
			"tramitesIndexados":   vacioSiNulo(tramites),
		})
	case http.MethodPost:
		s.registrarVinculacion(w, r)
	default:
		metodoNoPermitido(w)
	}
}

type solicitudVinculacion struct {
	Tramite      map[string]any `json:"tramite"`
	ProcesoNuevo *Proceso       `json:"procesoNuevo"`
}

// registrarVinculacion aplica las reglas de negocio del lado del servidor.
func (s *Servidor) registrarVinculacion(w http.ResponseWriter, r *http.Request) {
	var sol solicitudVinculacion
	if err := json.NewDecoder(io.LimitReader(r.Body, limiteCuerpo)).Decode(&sol); err != nil || sol.Tramite == nil {
		rechazar(w, http.StatusBadRequest, "La solicitud no tiene el formato esperado.")
		return
	}
	t := sol.Tramite
	id := texto(t, "id")
	if id == "" {
		rechazar(w, http.StatusBadRequest, "Falta el identificador del trámite.")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Idempotencia: un reintento devuelve lo ya registrado.
	if previo, err := s.bd.Obtener(colTramites, id); err == nil {
		var tr map[string]any
		json.Unmarshal(previo, &tr)
		cod := texto(mapa(tr, "vinculacion"), "procesoCodigo")
		cat, _ := s.catalogoActual()
		responder(w, http.StatusOK, map[string]any{"tramite": tr, "proceso": buscarProceso(cat.Procesos, cod), "duplicado": true})
		return
	}

	var faltantes []string
	if texto(t, "nroExpediente") == "" && texto(t, "nroRegistro") == "" {
		faltantes = append(faltantes, "N.° de expediente o de registro")
	}
	for campo, nombre := range map[string]string{"asunto": "asunto del documento", "enlaceSgd": "enlace directo", "asuntoVinculacion": "descripción de la actuación"} {
		if texto(t, campo) == "" {
			faltantes = append(faltantes, nombre)
		}
	}
	if len(faltantes) > 0 {
		sort.Strings(faltantes)
		rechazar(w, http.StatusUnprocessableEntity, "Faltan datos obligatorios: "+strings.Join(faltantes, ", ")+".")
		return
	}

	cat, err := s.catalogoActual()
	if err != nil {
		errorInterno(w, err)
		return
	}
	vinc := mapa(t, "vinculacion")
	if vinc == nil {
		vinc = map[string]any{}
	}

	var proceso *Proceso
	if texto(vinc, "modo") == "nuevo" {
		p := sol.ProcesoNuevo
		if p == nil || strings.TrimSpace(p.Denominacion) == "" {
			rechazar(w, http.StatusUnprocessableEntity, "Falta la denominación del nuevo proceso.")
			return
		}
		if !s.procedimientoValido(p.Categoria, p.Procedimiento) {
			rechazar(w, http.StatusUnprocessableEntity, fmt.Sprintf("El procedimiento «%s» no pertenece a la categoría «%s».", p.Procedimiento, p.Categoria))
			return
		}
		if !s.responsableValido(p.Responsable) {
			rechazar(w, http.StatusUnprocessableEntity, "El responsable indicado no existe en el catálogo.")
			return
		}
		nuevo := Proceso{
			Codigo:        siguienteCodigo(cat.Procesos),
			Denominacion:  strings.TrimSpace(p.Denominacion),
			Categoria:     p.Categoria,
			Procedimiento: p.Procedimiento,
			Responsable:   p.Responsable,
			Estado:        estadoRegistrado,
			FechaInicio:   time.Now().Format("2006-01-02"),
			Origen:        "Conector SGD",
		}
		if err := s.bd.GuardarJSON(colProcesos, nuevo.Codigo, nuevo); err != nil {
			errorInterno(w, err)
			return
		}
		proceso = &nuevo
	} else {
		proceso = buscarProceso(cat.Procesos, texto(vinc, "procesoCodigo"))
		if proceso == nil {
			rechazar(w, http.StatusNotFound, fmt.Sprintf("El proceso %s no existe en LEGAL.", texto(vinc, "procesoCodigo")))
			return
		}
		if proceso.Estado == estadoFinalizado {
			rechazar(w, http.StatusConflict, fmt.Sprintf("El proceso %s está finalizado y no admite nuevas incorporaciones.", proceso.Codigo))
			return
		}
	}

	vinc["procesoCodigo"] = proceso.Codigo
	vinc["procesoDenominacion"] = proceso.Denominacion
	vinc["categoria"] = proceso.Categoria
	vinc["procedimiento"] = proceso.Procedimiento
	vinc["responsable"] = proceso.Responsable
	t["vinculacion"] = vinc
	t["registradoEnBd"] = time.Now().Format(time.RFC3339)
	if err := s.bd.GuardarJSON(colTramites, id, t); err != nil {
		errorInterno(w, err)
		return
	}
	log.Printf("Vinculación registrada: %s → %s (%s)", id, proceso.Codigo, texto(vinc, "modo"))
	responder(w, http.StatusCreated, map[string]any{"tramite": t, "proceso": proceso})
}

func (s *Servidor) manejarPortal(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		doc, err := s.bd.Obtener(colPortal, claveDatos)
		if errors.Is(err, errNoEncontrado) {
			rechazar(w, http.StatusNotFound, "El portal aún no tiene datos.")
			return
		}
		if err != nil {
			errorInterno(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(doc)
	case http.MethodPut:
		cuerpo, err := io.ReadAll(io.LimitReader(r.Body, limiteCuerpo+1))
		if err != nil || len(cuerpo) > limiteCuerpo || !json.Valid(cuerpo) {
			rechazar(w, http.StatusBadRequest, "El documento del portal no es válido.")
			return
		}
		if err := s.bd.Guardar(colPortal, claveDatos, cuerpo); err != nil {
			errorInterno(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]any{"guardado": true})
	default:
		metodoNoPermitido(w)
	}
}

func (s *Servidor) manejarReiniciar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		metodoNoPermitido(w)
		return
	}
	if err := s.bd.Reiniciar(); err != nil {
		errorInterno(w, err)
		return
	}
	log.Print("Base de datos de prueba reiniciada")
	responder(w, http.StatusOK, map[string]any{"reiniciada": true})
}

// ------------------------------------------------------------- catálogo

// catalogoActual combina los procesos del portal (o los de la semilla, si el
// portal aún no se abrió) con los procesos generados desde el Conector.
func (s *Servidor) catalogoActual() (Catalogo, error) {
	cat := Catalogo{Categorias: s.semilla.Categorias, Responsables: s.semilla.Responsables}
	procesos := append([]Proceso(nil), s.semilla.Procesos...)
	if doc, err := s.bd.Obtener(colPortal, claveDatos); err == nil {
		var portal struct {
			Procesos []Proceso `json:"procesos"`
		}
		if json.Unmarshal(doc, &portal) == nil && len(portal.Procesos) > 0 {
			procesos = portal.Procesos
		}
	} else if !errors.Is(err, errNoEncontrado) {
		return cat, err
	}
	existentes := map[string]bool{}
	for _, p := range procesos {
		existentes[p.Codigo] = true
	}
	delConector, err := s.bd.Listar(colProcesos)
	if err != nil {
		return cat, err
	}
	for _, raw := range delConector {
		var p Proceso
		if json.Unmarshal(raw, &p) == nil && !existentes[p.Codigo] {
			procesos = append(procesos, p)
		}
	}
	cat.Procesos = procesos
	return cat, nil
}

func (s *Servidor) procedimientoValido(categoria, procedimiento string) bool {
	for _, c := range s.semilla.Categorias {
		if c.Nombre == categoria {
			for _, p := range c.Procedimientos {
				if p == procedimiento {
					return true
				}
			}
		}
	}
	return false
}

func (s *Servidor) responsableValido(codigo string) bool {
	for _, r := range s.semilla.Responsables {
		if r.Codigo == codigo {
			return true
		}
	}
	return false
}

func siguienteCodigo(procesos []Proceso) string {
	prefijo := fmt.Sprintf("PL-%d-", time.Now().Year())
	max := 0
	for _, p := range procesos {
		if strings.HasPrefix(p.Codigo, prefijo) {
			if n, err := strconv.Atoi(strings.TrimPrefix(p.Codigo, prefijo)); err == nil && n > max {
				max = n
			}
		}
	}
	return fmt.Sprintf("%s%04d", prefijo, max+1)
}

func buscarProceso(procesos []Proceso, codigo string) *Proceso {
	for i := range procesos {
		if procesos[i].Codigo == codigo {
			return &procesos[i]
		}
	}
	return nil
}

// ------------------------------------------------------------ utilidades

func texto(m map[string]any, clave string) string {
	if m == nil {
		return ""
	}
	v, _ := m[clave].(string)
	return strings.TrimSpace(v)
}

func mapa(m map[string]any, clave string) map[string]any {
	if m == nil {
		return nil
	}
	v, _ := m[clave].(map[string]any)
	return v
}

func ordenarPorCampo(lista []json.RawMessage, campo string) {
	valor := func(raw json.RawMessage) string {
		var m map[string]any
		json.Unmarshal(raw, &m)
		return texto(m, campo)
	}
	sort.SliceStable(lista, func(i, j int) bool { return valor(lista[i]) > valor(lista[j]) })
}

func vacioSiNulo(l []json.RawMessage) []json.RawMessage {
	if l == nil {
		return []json.RawMessage{}
	}
	return l
}

func responder(w http.ResponseWriter, estado int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	json.NewEncoder(w).Encode(v)
}

func rechazar(w http.ResponseWriter, estado int, mensaje string) {
	responder(w, estado, map[string]any{"mensaje": mensaje})
}

func metodoNoPermitido(w http.ResponseWriter) {
	rechazar(w, http.StatusMethodNotAllowed, "Método no permitido.")
}

func errorInterno(w http.ResponseWriter, err error) {
	log.Printf("Error interno: %v", err)
	rechazar(w, http.StatusInternalServerError, "Error interno del servidor de prueba.")
}
