package main

// Usuarios, contraseñas y sesiones. Las contraseñas se guardan como huella
// PBKDF2-SHA256 con sal aleatoria. El portal usa una cookie de sesión
// (HttpOnly); la extensión envía el mismo token en la cabecera Authorization.

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	cookieSesion   = "legal_sesion"
	iteracionesKDF = 120_000
)

type claveContexto struct{}

func huellaClave(clave string) string {
	sal := make([]byte, 16)
	rand.Read(sal)
	h, _ := pbkdf2.Key(sha256.New, clave, sal, iteracionesKDF, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iteracionesKDF, base64.RawStdEncoding.EncodeToString(sal), base64.RawStdEncoding.EncodeToString(h))
}

func verificarClave(clave, huella string) bool {
	partes := strings.Split(huella, "$")
	if len(partes) != 4 || partes[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(partes[1])
	sal, err1 := base64.RawStdEncoding.DecodeString(partes[2])
	esperado, err2 := base64.RawStdEncoding.DecodeString(partes[3])
	if err != nil || err1 != nil || err2 != nil {
		return false
	}
	h, err := pbkdf2.Key(sha256.New, clave, sal, iter, len(esperado))
	return err == nil && subtle.ConstantTimeCompare(h, esperado) == 1
}

func nuevoID(prefijo string) string {
	b := make([]byte, 6)
	rand.Read(b)
	return prefijo + "-" + strconv.FormatInt(time.Now().UnixMilli(), 36) + hex.EncodeToString(b)[:6]
}

func nuevoToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// asegurarAdministrador crea el administrador inicial si no hay ningún administrador activo.
func (s *Servidor) asegurarAdministrador() error {
	usuarios, err := listar[Usuario](s.bd, colUsuarios)
	if err != nil {
		return err
	}
	for _, u := range usuarios {
		if u.Rol == RolAdmin && u.Activo {
			return nil
		}
	}
	admin := Usuario{ID: nuevoID("USR"), Usuario: s.cfg.AdminUsuario, Nombre: "Administrador del sistema", Rol: RolAdmin, Cargo: "Administrador", Activo: true, DebeCambiarClave: true, ClaveHash: huellaClave(s.cfg.AdminClave), CreadoEn: ahora()}
	for _, u := range usuarios {
		if u.Usuario == admin.Usuario { // existe pero inactivo o sin rol: se reactiva como administrador
			admin.ID, admin.CreadoEn = u.ID, u.CreadoEn
		}
	}
	log.Printf("Se creó el usuario administrador «%s» (clave inicial definida en .env)", admin.Usuario)
	return s.bd.GuardarJSON(colUsuarios, admin.ID, admin)
}

func (s *Servidor) usuarioPorNombre(nombre string) (*Usuario, error) {
	usuarios, err := listar[Usuario](s.bd, colUsuarios)
	if err != nil {
		return nil, err
	}
	nombre = strings.ToLower(strings.TrimSpace(nombre))
	for i := range usuarios {
		if usuarios[i].Usuario == nombre {
			return &usuarios[i], nil
		}
	}
	return nil, errNoEncontrado
}

func tokenDe(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(a, "Bearer "))
	}
	if c, err := r.Cookie(cookieSesion); err == nil {
		return c.Value
	}
	return ""
}

func (s *Servidor) usuarioDeSesion(r *http.Request) *Usuario {
	token := tokenDe(r)
	if token == "" {
		return nil
	}
	ses, err := obtener[Sesion](s.bd, colSesiones, token)
	if err != nil {
		return nil
	}
	if exp, err := time.Parse(time.RFC3339, ses.ExpiraEn); err != nil || time.Now().After(exp) {
		s.bd.Borrar(colSesiones, token)
		return nil
	}
	u, err := obtener[Usuario](s.bd, colUsuarios, ses.UsuarioID)
	if err != nil || !u.Activo {
		return nil
	}
	return &u
}

func usuarioDe(r *http.Request) *Usuario {
	u, _ := r.Context().Value(claveContexto{}).(*Usuario)
	return u
}

// con exige una sesión válida y uno de los roles indicados (ninguno = cualquier rol).
func (s *Servidor) con(manejador http.HandlerFunc, roles ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := s.usuarioDeSesion(r)
		if u == nil {
			rechazar(w, http.StatusUnauthorized, "La sesión no es válida o expiró. Vuelva a ingresar.")
			return
		}
		if len(roles) > 0 && !contiene(roles, u.Rol) {
			rechazar(w, http.StatusForbidden, "Su perfil no tiene permiso para esta acción.")
			return
		}
		if u.DebeCambiarClave && r.Method != http.MethodGet && r.URL.Path != "/api/sesion/clave" && r.URL.Path != "/api/sesion" {
			rechazar(w, http.StatusForbidden, "Debe cambiar su contraseña antes de continuar.")
			return
		}
		manejador(w, r.WithContext(context.WithValue(r.Context(), claveContexto{}, u)))
	}
}

// ------------------------------------------------------------- handlers

func (s *Servidor) manejarSesion(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.con(func(w http.ResponseWriter, r *http.Request) {
			responder(w, http.StatusOK, map[string]any{"usuario": usuarioDe(r).Publico()})
		})(w, r)
	case http.MethodPost:
		var sol struct {
			Usuario string `json:"usuario"`
			Clave   string `json:"clave"`
			Origen  string `json:"origen"`
		}
		if !leerJSON(w, r, &sol) {
			return
		}
		u, err := s.usuarioPorNombre(sol.Usuario)
		if err != nil || !u.Activo || !verificarClave(sol.Clave, u.ClaveHash) {
			time.Sleep(400 * time.Millisecond)
			rechazar(w, http.StatusUnauthorized, "Usuario o contraseña incorrectos.")
			return
		}
		origen := "portal"
		if sol.Origen == "extension" {
			origen = "extension"
		}
		ses := Sesion{Token: nuevoToken(), UsuarioID: u.ID, CreadaEn: ahora(), ExpiraEn: time.Now().Add(time.Duration(s.cfg.SesionHoras) * time.Hour).Format(time.RFC3339), Origen: origen}
		if origen == "extension" { // la extensión mantiene la sesión durante la jornada de trabajo de la semana
			ses.ExpiraEn = time.Now().Add(7 * 24 * time.Hour).Format(time.RFC3339)
		}
		if err := s.bd.GuardarJSON(colSesiones, ses.Token, ses); err != nil {
			errorInterno(w, err)
			return
		}
		u.UltimoIngreso = ahora()
		s.bd.GuardarJSON(colUsuarios, u.ID, u)
		s.limpiarSesionesVencidas()
		if origen == "portal" {
			http.SetCookie(w, &http.Cookie{Name: cookieSesion, Value: ses.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(time.Duration(s.cfg.SesionHoras) * time.Hour)})
		}
		s.auditar(u.Usuario, "ingreso", "Ingreso desde "+origen)
		responder(w, http.StatusOK, map[string]any{"token": ses.Token, "usuario": u.Publico(), "expiraEn": ses.ExpiraEn})
	case http.MethodDelete:
		if t := tokenDe(r); t != "" {
			s.bd.Borrar(colSesiones, t)
		}
		http.SetCookie(w, &http.Cookie{Name: cookieSesion, Value: "", Path: "/", MaxAge: -1})
		responder(w, http.StatusOK, map[string]any{"cerrada": true})
	default:
		metodoNoPermitido(w)
	}
}

func (s *Servidor) limpiarSesionesVencidas() {
	sesiones, _ := listar[Sesion](s.bd, colSesiones)
	for _, ses := range sesiones {
		if exp, err := time.Parse(time.RFC3339, ses.ExpiraEn); err != nil || time.Now().After(exp) {
			s.bd.Borrar(colSesiones, ses.Token)
		}
	}
}

func (s *Servidor) manejarCambioClave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		metodoNoPermitido(w)
		return
	}
	var sol struct {
		Actual string `json:"actual"`
		Nueva  string `json:"nueva"`
	}
	if !leerJSON(w, r, &sol) {
		return
	}
	u := usuarioDe(r)
	if !verificarClave(sol.Actual, u.ClaveHash) {
		rechazar(w, http.StatusUnprocessableEntity, "La contraseña actual no es correcta.")
		return
	}
	if msg := validarClave(sol.Nueva); msg != "" {
		rechazar(w, http.StatusUnprocessableEntity, msg)
		return
	}
	if sol.Nueva == sol.Actual {
		rechazar(w, http.StatusUnprocessableEntity, "La nueva contraseña debe ser distinta de la actual.")
		return
	}
	u.ClaveHash = huellaClave(sol.Nueva)
	u.DebeCambiarClave = false
	if err := s.bd.GuardarJSON(colUsuarios, u.ID, u); err != nil {
		errorInterno(w, err)
		return
	}
	s.auditar(u.Usuario, "cambio de contraseña", "")
	responder(w, http.StatusOK, map[string]any{"usuario": u.Publico()})
}

func validarClave(c string) string {
	if len([]rune(c)) < 8 {
		return "La contraseña debe tener al menos 8 caracteres."
	}
	return ""
}

var reUsuario = regexp.MustCompile(`^[a-z0-9._-]{3,40}$`)

type solicitudUsuario struct {
	Usuario          string `json:"usuario"`
	Nombre           string `json:"nombre"`
	Rol              string `json:"rol"`
	Cargo            string `json:"cargo"`
	Correo           string `json:"correo"`
	Activo           *bool  `json:"activo"`
	Clave            string `json:"clave"`
	DebeCambiarClave *bool  `json:"debeCambiarClave"`
}

// manejarUsuarios: alta y listado de usuarios (solo el administrador).
func (s *Servidor) manejarUsuarios(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		usuarios, err := listar[Usuario](s.bd, colUsuarios)
		if err != nil {
			errorInterno(w, err)
			return
		}
		for i := range usuarios {
			usuarios[i] = usuarios[i].Publico()
		}
		responder(w, http.StatusOK, map[string]any{"usuarios": usuarios})
	case http.MethodPost:
		var sol solicitudUsuario
		if !leerJSON(w, r, &sol) {
			return
		}
		u := Usuario{ID: nuevoID("USR"), Usuario: strings.ToLower(strings.TrimSpace(sol.Usuario)), Nombre: strings.TrimSpace(sol.Nombre), Rol: sol.Rol, Cargo: strings.TrimSpace(sol.Cargo), Correo: strings.TrimSpace(sol.Correo), Activo: true, DebeCambiarClave: true, CreadoEn: ahora()}
		if !reUsuario.MatchString(u.Usuario) {
			rechazar(w, http.StatusUnprocessableEntity, "El usuario debe tener de 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo.")
			return
		}
		if u.Nombre == "" {
			rechazar(w, http.StatusUnprocessableEntity, "Indique el nombre completo.")
			return
		}
		if _, ok := rolesValidos[u.Rol]; !ok {
			rechazar(w, http.StatusUnprocessableEntity, "El rol no es válido.")
			return
		}
		if msg := validarClave(sol.Clave); msg != "" {
			rechazar(w, http.StatusUnprocessableEntity, msg)
			return
		}
		if _, err := s.usuarioPorNombre(u.Usuario); err == nil {
			rechazar(w, http.StatusConflict, "Ya existe un usuario con ese nombre.")
			return
		}
		u.ClaveHash = huellaClave(sol.Clave)
		if err := s.bd.GuardarJSON(colUsuarios, u.ID, u); err != nil {
			errorInterno(w, err)
			return
		}
		s.auditar(usuarioDe(r).Usuario, "alta de usuario", fmt.Sprintf("%s (%s)", u.Usuario, rolesValidos[u.Rol]))
		responder(w, http.StatusCreated, map[string]any{"usuario": u.Publico()})
	default:
		metodoNoPermitido(w)
	}
}

func (s *Servidor) manejarUsuario(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := obtener[Usuario](s.bd, colUsuarios, id)
	if err != nil {
		rechazar(w, http.StatusNotFound, "El usuario no existe.")
		return
	}
	actor := usuarioDe(r)
	switch r.Method {
	case http.MethodPut:
		var sol solicitudUsuario
		if !leerJSON(w, r, &sol) {
			return
		}
		if n := strings.TrimSpace(sol.Nombre); n != "" {
			u.Nombre = n
		}
		if sol.Rol != "" {
			if _, ok := rolesValidos[sol.Rol]; !ok {
				rechazar(w, http.StatusUnprocessableEntity, "El rol no es válido.")
				return
			}
			u.Rol = sol.Rol
		}
		u.Cargo, u.Correo = strings.TrimSpace(sol.Cargo), strings.TrimSpace(sol.Correo)
		if sol.Activo != nil {
			u.Activo = *sol.Activo
		}
		if sol.Clave != "" {
			if msg := validarClave(sol.Clave); msg != "" {
				rechazar(w, http.StatusUnprocessableEntity, msg)
				return
			}
			u.ClaveHash = huellaClave(sol.Clave)
			u.DebeCambiarClave = true
		}
		if sol.DebeCambiarClave != nil {
			u.DebeCambiarClave = *sol.DebeCambiarClave
		}
		if u.ID == actor.ID && (u.Rol != RolAdmin || !u.Activo) {
			rechazar(w, http.StatusUnprocessableEntity, "No puede quitarse a sí mismo el rol de administrador ni desactivarse.")
			return
		}
		if err := s.bd.GuardarJSON(colUsuarios, u.ID, u); err != nil {
			errorInterno(w, err)
			return
		}
		if !u.Activo || sol.Clave != "" {
			s.cerrarSesionesDe(u.ID)
		}
		s.auditar(actor.Usuario, "edición de usuario", u.Usuario)
		responder(w, http.StatusOK, map[string]any{"usuario": u.Publico()})
	case http.MethodDelete:
		if u.ID == actor.ID {
			rechazar(w, http.StatusUnprocessableEntity, "No puede eliminar su propio usuario.")
			return
		}
		procesos, _ := listar[Proceso](s.bd, colProcesos)
		for _, p := range procesos {
			if p.ProfesionalID == u.ID && p.Estado != ProcesoFinalizado {
				rechazar(w, http.StatusConflict, "El usuario tiene procesos en curso a su cargo. Reasígnelos o desactive el usuario.")
				return
			}
		}
		s.bd.Borrar(colUsuarios, u.ID)
		s.cerrarSesionesDe(u.ID)
		s.auditar(actor.Usuario, "baja de usuario", u.Usuario)
		responder(w, http.StatusOK, map[string]any{"eliminado": true})
	default:
		metodoNoPermitido(w)
	}
}

func (s *Servidor) cerrarSesionesDe(usuarioID string) {
	sesiones, _ := listar[Sesion](s.bd, colSesiones)
	for _, ses := range sesiones {
		if ses.UsuarioID == usuarioID {
			s.bd.Borrar(colSesiones, ses.Token)
		}
	}
}

func (s *Servidor) auditar(usuario, accion, detalle string) {
	a := Auditoria{ID: nuevoID("AUD"), Fecha: ahora(), Usuario: usuario, Accion: accion, Detalle: detalle}
	s.bd.GuardarJSON(colAuditoria, a.Fecha+"-"+a.ID, a)
}

func contiene(lista []string, v string) bool {
	for _, x := range lista {
		if x == v {
			return true
		}
	}
	return false
}
