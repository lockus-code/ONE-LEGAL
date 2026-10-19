package main

// Administración de la base de datos (solo rol administrador): explorar y
// editar documentos, respaldar, restaurar y vaciar.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var descripcionColecciones = map[string]string{
	colUsuarios:       "Usuarios y roles",
	colSesiones:       "Sesiones abiertas (portal y extensión)",
	colPlantillas:     "Plantillas de tareas de cada profesional",
	colProcesos:       "Procesos legales",
	colTareas:         "Tareas (ciclo) de cada proceso",
	colTramites:       "Trámites SGD indexados",
	colSolicitudes:    "Solicitudes de definición de plazo",
	colNotificaciones: "Avisos a la gerencia (retrocesos de tareas)",
	colAuditoria:      "Registro de auditoría",
	colSistema:        "Taxonomía, configuración y contadores",
}

func (s *Servidor) manejarAdminBD(w http.ResponseWriter, r *http.Request) {
	cols := []map[string]any{}
	for _, c := range colecciones {
		cols = append(cols, map[string]any{"nombre": c, "descripcion": descripcionColecciones[c], "documentos": s.bd.Contar(c)})
	}
	responder(w, http.StatusOK, map[string]any{
		"motor": "bbolt (NoSQL clave-valor embebido)", "ruta": s.bd.ruta, "creadaEn": s.bd.CreadaEn(),
		"rutaEnv": s.cfg.RutaEnv, "colecciones": cols,
	})
}

func (s *Servidor) manejarAdminColeccion(w http.ResponseWriter, r *http.Request) {
	col := r.PathValue("col")
	if !coleccionValida(col) {
		rechazar(w, http.StatusNotFound, "La colección no existe.")
		return
	}
	docs, err := s.bd.ListarDocumentos(col)
	if err != nil {
		errorInterno(w, err)
		return
	}
	if col == colUsuarios || col == colSesiones { // no se exponen huellas de contraseña ni tokens completos
		for i := range docs {
			var m map[string]any
			if json.Unmarshal(docs[i].Valor, &m) == nil {
				if _, ok := m["claveHash"]; ok {
					m["claveHash"] = "(oculta)"
				}
				if t, ok := m["token"].(string); ok && len(t) > 8 {
					m["token"] = t[:8] + "…"
				}
				docs[i].Valor, _ = json.Marshal(m)
			}
			if col == colSesiones && len(docs[i].Clave) > 8 {
				docs[i].Clave = docs[i].Clave[:8] + "…"
			}
		}
	}
	responder(w, http.StatusOK, map[string]any{"coleccion": col, "documentos": docs})
}

func (s *Servidor) manejarAdminDocumento(w http.ResponseWriter, r *http.Request) {
	col, clave := r.PathValue("col"), r.PathValue("clave")
	u := usuarioDe(r)
	if !coleccionValida(col) || clave == "" {
		rechazar(w, http.StatusNotFound, "La colección no existe.")
		return
	}
	if col == colSesiones && r.Method != http.MethodDelete {
		rechazar(w, http.StatusForbidden, "Las sesiones solo se pueden eliminar.")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		b, err := s.bd.Obtener(col, clave)
		if err != nil {
			rechazar(w, http.StatusNotFound, "El documento no existe.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(b)
	case http.MethodPut:
		cuerpo, err := io.ReadAll(io.LimitReader(r.Body, limiteCuerpo+1))
		if err != nil || len(cuerpo) > limiteCuerpo || !json.Valid(cuerpo) {
			rechazar(w, http.StatusBadRequest, "El documento no es un JSON válido.")
			return
		}
		if col == colUsuarios { // se conserva la huella de la contraseña si se editó la versión oculta
			var nuevo map[string]any
			json.Unmarshal(cuerpo, &nuevo)
			if h, _ := nuevo["claveHash"].(string); h == "" || h == "(oculta)" {
				if previo, err := obtener[Usuario](s.bd, colUsuarios, clave); err == nil {
					nuevo["claveHash"] = previo.ClaveHash
				} else {
					delete(nuevo, "claveHash")
				}
			}
			cuerpo, _ = json.Marshal(nuevo)
		}
		if err := s.bd.Guardar(col, clave, cuerpo); err != nil {
			errorInterno(w, err)
			return
		}
		s.auditar(u.Usuario, "BD: edición manual", col+"/"+clave)
		responder(w, http.StatusOK, map[string]any{"guardado": true})
	case http.MethodDelete:
		if col == colSesiones && strings.HasSuffix(clave, "…") {
			prefijo := strings.TrimSuffix(clave, "…")
			sesiones, _ := listar[Sesion](s.bd, colSesiones)
			for _, ses := range sesiones {
				if strings.HasPrefix(ses.Token, prefijo) {
					clave = ses.Token
				}
			}
		}
		if err := s.bd.Borrar(col, clave); err != nil {
			rechazar(w, http.StatusNotFound, "El documento no existe.")
			return
		}
		if col == colUsuarios {
			s.asegurarAdministrador()
		}
		s.auditar(u.Usuario, "BD: eliminación manual", col+"/"+clave)
		responder(w, http.StatusOK, map[string]any{"eliminado": true})
	default:
		metodoNoPermitido(w)
	}
}

// manejarVaciar: «operativos» borra procesos, tareas, trámites, solicitudes y auditoría;
// «total» deja la base de datos como recién creada (taxonomía base y administrador del .env).
func (s *Servidor) manejarVaciar(w http.ResponseWriter, r *http.Request) {
	var sol struct {
		Modo         string `json:"modo"`
		Confirmacion string `json:"confirmacion"`
	}
	if !leerJSON(w, r, &sol) {
		return
	}
	if sol.Confirmacion != "VACIAR" {
		rechazar(w, http.StatusUnprocessableEntity, "Escriba VACIAR para confirmar.")
		return
	}
	u := usuarioDe(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	cols := coleccionesOperativas
	if sol.Modo == "total" {
		cols = colecciones
	} else if sol.Modo != "operativos" {
		rechazar(w, http.StatusUnprocessableEntity, "Modo no válido.")
		return
	}
	if err := s.bd.Vaciar(cols); err != nil {
		errorInterno(w, err)
		return
	}
	if sol.Modo == "total" {
		if err := s.inicializar(); err != nil {
			errorInterno(w, err)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: cookieSesion, Value: "", Path: "/", MaxAge: -1})
	}
	s.auditar(u.Usuario, "BD: vaciado", sol.Modo)
	responder(w, http.StatusOK, map[string]any{"vaciada": true, "modo": sol.Modo, "sesionCerrada": sol.Modo == "total"})
}

type respaldo struct {
	Formato     string                                `json:"formato"`
	Version     string                                `json:"version"`
	GeneradoEn  string                                `json:"generadoEn"`
	Colecciones map[string]map[string]json.RawMessage `json:"colecciones"`
}

func (s *Servidor) manejarRespaldo(w http.ResponseWriter, r *http.Request) {
	datos, err := s.bd.Respaldo()
	if err != nil {
		errorInterno(w, err)
		return
	}
	delete(datos, colSesiones)
	nombre := fmt.Sprintf("legal-respaldo-%s.json", time.Now().Format("2006-01-02-1504"))
	w.Header().Set("Content-Disposition", `attachment; filename="`+nombre+`"`)
	s.auditar(usuarioDe(r).Usuario, "BD: respaldo", nombre)
	responder(w, http.StatusOK, respaldo{Formato: "legal-respaldo", Version: s.version, GeneradoEn: ahora(), Colecciones: datos})
}

func (s *Servidor) manejarRestaurar(w http.ResponseWriter, r *http.Request) {
	var rs respaldo
	if !leerJSON(w, r, &rs) {
		return
	}
	if rs.Formato != "legal-respaldo" || rs.Colecciones == nil {
		rechazar(w, http.StatusUnprocessableEntity, "El archivo no es un respaldo de LEGAL.")
		return
	}
	u := usuarioDe(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.bd.Restaurar(rs.Colecciones); err != nil {
		rechazar(w, http.StatusUnprocessableEntity, "No se pudo restaurar: "+err.Error())
		return
	}
	if err := s.inicializar(); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(u.Usuario, "BD: restauración", "Respaldo del "+rs.GeneradoEn)
	http.SetCookie(w, &http.Cookie{Name: cookieSesion, Value: "", Path: "/", MaxAge: -1})
	responder(w, http.StatusOK, map[string]any{"restaurada": true, "sesionCerrada": true})
}
