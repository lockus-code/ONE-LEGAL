package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type cliente struct {
	t     *testing.T
	h     http.Handler
	token string
}

func entorno(t *testing.T) (*Servidor, *cliente) {
	t.Helper()
	bd, err := abrirBD(filepath.Join(t.TempDir(), "prueba.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { bd.Cerrar() })
	web, _ := fs.Sub(webEmbebido, "web")
	cfg := Config{Puerto: 8790, URLPublica: "http://192.168.1.10:8790", SGDURLs: []string{"https://sgd.sedapar.com.pe/"}, SGDSimulado: true, AdminUsuario: "admin", AdminClave: "admin", SesionHoras: 1}
	s := &Servidor{bd: bd, cfg: cfg, web: web, version: "prueba", iniciado: time.Now()}
	if err := s.inicializar(); err != nil {
		t.Fatal(err)
	}
	c := &cliente{t: t, h: s.Rutas()}
	// El administrador inicial debe cambiar la clave antes de operar.
	c.ingresar("admin", "admin")
	if cod, _ := c.llamar("POST", "/api/usuarios", map[string]any{"usuario": "x", "nombre": "X", "rol": RolAsistente, "clave": "12345678"}); cod != http.StatusForbidden {
		t.Fatalf("el administrador con clave inicial no debía poder operar: %d", cod)
	}
	if cod, r := c.llamar("POST", "/api/sesion/clave", map[string]any{"actual": "admin", "nueva": "Admin-2026!"}); cod != http.StatusOK {
		t.Fatalf("cambio de clave: %d %v", cod, r)
	}
	return s, c
}

func (c *cliente) llamar(metodo, ruta string, cuerpo any) (int, map[string]any) {
	c.t.Helper()
	var buf bytes.Buffer
	if cuerpo != nil {
		json.NewEncoder(&buf).Encode(cuerpo)
	}
	req := httptest.NewRequest(metodo, ruta, &buf)
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	rec := httptest.NewRecorder()
	c.h.ServeHTTP(rec, req)
	var res map[string]any
	json.Unmarshal(rec.Body.Bytes(), &res)
	return rec.Code, res
}

func (c *cliente) ingresar(usuario, clave string) {
	c.t.Helper()
	c.token = ""
	cod, r := c.llamar("POST", "/api/sesion", map[string]any{"usuario": usuario, "clave": clave, "origen": "extension"})
	if cod != http.StatusOK {
		c.t.Fatalf("ingreso de %s: %d %v", usuario, cod, r)
	}
	c.token = r["token"].(string)
}

func (c *cliente) como(usuario, clave string) *cliente {
	otro := &cliente{t: c.t, h: c.h}
	otro.ingresar(usuario, clave)
	otro.llamar("POST", "/api/sesion/clave", map[string]any{"actual": clave, "nueva": clave + "-nueva"})
	return otro
}

func (c *cliente) crearUsuario(usuario, rol string) string {
	c.t.Helper()
	cod, r := c.llamar("POST", "/api/usuarios", map[string]any{"usuario": usuario, "nombre": "Nombre " + usuario, "rol": rol, "clave": "clave-" + usuario})
	if cod != http.StatusCreated {
		c.t.Fatalf("alta de %s: %d %v", usuario, cod, r)
	}
	return r["usuario"].(map[string]any)["id"].(string)
}

func tramiteSGD(numero string) map[string]any {
	return map[string]any{"nroTramite": numero, "idInterno": "250101", "asuntoSgd": "Notificación de demanda contencioso administrativa", "enlaceSgd": "https://sgd.sedapar.com.pe/tramites/detalletramite/250101", "fechaIngresoSgd": "10/10/2026 09:14:22"}
}

func lista(r map[string]any, clave string) []any {
	l, _ := r[clave].([]any)
	return l
}

func TestBaseDeDatosIniciaVacia(t *testing.T) {
	s, c := entorno(t)
	_, d := c.llamar("GET", "/api/datos", nil)
	if len(lista(d, "procesos")) != 0 || len(lista(d, "tramites")) != 0 || len(lista(d, "usuarios")) != 1 {
		t.Fatalf("la BD debía iniciar vacía (solo el administrador): %d procesos, %d usuarios", len(lista(d, "procesos")), len(lista(d, "usuarios")))
	}
	if len(s.taxonomia().Categorias) < 8 {
		t.Fatalf("la taxonomía base debía cargarse")
	}
}

func TestFlujoCompletoDeIndexacion(t *testing.T) {
	_, admin := entorno(t)
	profID := admin.crearUsuario("mquispe", RolProfesional)
	admin.crearUsuario("asistente1", RolAsistente)
	prof := admin.como("mquispe", "clave-mquispe")
	asis := admin.como("asistente1", "clave-asistente1")

	// Plantilla del profesional para el proceso ordinario contencioso administrativo:
	// una tarea con plazo fijo desde el inicio y otra cuyo plazo se define después.
	diez := 10
	plantilla := map[string]any{"nombre": "Mi ordinario CA", "categoria": "CAD", "via": "CAD-ORD", "tareas": []map[string]any{
		{"nombre": "Contestar demanda", "plazoDias": diez, "tipoDias": "habiles", "desde": "inicio"},
		{"nombre": "Audiencia", "plazoDias": nil},
		{"nombre": "Alegatos", "plazoDias": 5},
	}}
	if cod, r := prof.llamar("POST", "/api/plantillas", plantilla); cod != http.StatusCreated {
		t.Fatalf("alta de plantilla: %d %v", cod, r)
	}
	if cod, _ := prof.llamar("POST", "/api/plantillas", plantilla); cod != http.StatusConflict {
		t.Fatalf("no debía permitir dos plantillas para la misma vía: %d", cod)
	}

	// El asistente indexa un trámite como proceso nuevo: sin correlativo, por categoría → vía → profesional.
	cod, r := asis.llamar("POST", "/api/indexar", map[string]any{
		"accion": "nuevo", "tramite": tramiteSGD("2026-01234-3"), "detalle": "Cédula de notificación",
		"proceso": map[string]any{"categoria": "CAD", "via": "CAD-ORD", "profesionalId": profID},
	})
	if cod != http.StatusCreated {
		t.Fatalf("indexar nuevo: %d %v", cod, r)
	}
	proc := r["proceso"].(map[string]any)
	if !strings.HasPrefix(proc["codigo"].(string), "PL-") || proc["titulo"] != "Notificación de demanda contencioso administrativa" || proc["plantillaNombre"] != "Mi ordinario CA" {
		t.Fatalf("proceso mal generado: %v", proc)
	}
	if r["tareasGeneradas"].(float64) != 3 {
		t.Fatalf("debían generarse 3 tareas de la plantilla: %v", r["tareasGeneradas"])
	}
	procID := proc["id"].(string)

	// Lo indexado es visible en el portal del profesional.
	_, d := prof.llamar("GET", "/api/datos", nil)
	if len(lista(d, "procesos")) != 1 || len(lista(d, "tramites")) != 1 || len(lista(d, "tareas")) != 3 {
		t.Fatalf("el portal debía mostrar lo indexado: %d procesos, %d trámites, %d tareas", len(lista(d, "procesos")), len(lista(d, "tramites")), len(lista(d, "tareas")))
	}
	tareas := lista(d, "tareas")
	t1, t2, t3 := tareas[0].(map[string]any), tareas[1].(map[string]any), tareas[2].(map[string]any)
	if t1["estado"] != TareaEnProceso || t1["fechaLimite"] == nil || t1["fechaLimite"] == "" {
		t.Fatalf("la primera tarea debía iniciar con fecha límite: %v", t1)
	}

	// Al finalizar la primera tarea, la audiencia (sin plazo) queda en proceso y se alerta.
	if cod, r := prof.llamar("PUT", "/api/tareas/"+t1["id"].(string), map[string]any{"estado": TareaFinalizada}); cod != http.StatusOK || len(lista(r, "sucesoras")) != 1 {
		t.Fatalf("finalizar tarea: %d %v", cod, r)
	}
	_, d = prof.llamar("GET", "/api/datos", nil)
	if !hayAlerta(d, "plazo-no-definido", t2["id"].(string)) {
		t.Fatalf("debía alertar que la audiencia no tiene plazo: %v", lista(d, "alertas"))
	}

	// El asistente solicita la definición del plazo y el profesional lo define en bloque.
	if cod, r := asis.llamar("POST", "/api/solicitudes", map[string]any{"tareaId": t2["id"], "mensaje": "Fijar fecha de audiencia"}); cod != http.StatusCreated {
		t.Fatalf("solicitud: %d %v", cod, r)
	}
	if cod, _ := asis.llamar("PUT", "/api/tareas/"+t2["id"].(string), map[string]any{"fechaLimite": "2030-01-10"}); cod != http.StatusForbidden {
		t.Fatalf("el asistente no debía editar plazos: %d", cod)
	}
	if cod, r := prof.llamar("PUT", "/api/plazos", map[string]any{"cambios": []map[string]any{{"id": t2["id"], "fechaLimite": "2030-01-10"}, {"id": t3["id"], "plazoDias": 7, "tipoDias": "calendario"}}}); cod != http.StatusOK {
		t.Fatalf("plazos en bloque: %d %v", cod, r)
	}
	_, d = prof.llamar("GET", "/api/datos", nil)
	if hayAlerta(d, "plazo-no-definido", t2["id"].(string)) || hayAlerta(d, "solicitud-plazo", t2["id"].(string)) {
		t.Fatalf("las alertas de plazo debían resolverse: %v", lista(d, "alertas"))
	}

	// Proceso existente: anexar otro trámite; duplicado pide confirmación.
	ex := map[string]any{"accion": "existente", "procesoId": procID, "tareaId": t2["id"], "tramite": tramiteSGD("2026-01300-1")}
	if cod, r := asis.llamar("POST", "/api/indexar", ex); cod != http.StatusCreated {
		t.Fatalf("anexar: %d %v", cod, r)
	}
	if cod, _ := asis.llamar("POST", "/api/indexar", ex); cod != http.StatusConflict {
		t.Fatalf("el duplicado debía pedir confirmación: %d", cod)
	}
	ex["confirmarDuplicado"] = true
	if cod, _ := asis.llamar("POST", "/api/indexar", ex); cod != http.StatusCreated {
		t.Fatalf("el duplicado confirmado debía registrarse: %d", cod)
	}

	// No se finaliza con tareas abiertas; luego sí, y ya no admite trámites.
	if cod, _ := prof.llamar("PUT", "/api/procesos/"+procID, map[string]any{"estado": ProcesoFinalizado}); cod != http.StatusConflict {
		t.Fatalf("no debía finalizar con tareas abiertas: %d", cod)
	}
	for _, x := range []any{t2["id"], t3["id"]} {
		prof.llamar("PUT", "/api/tareas/"+x.(string), map[string]any{"estado": TareaFinalizada})
	}
	if cod, r := prof.llamar("PUT", "/api/procesos/"+procID, map[string]any{"estado": ProcesoFinalizado}); cod != http.StatusOK {
		t.Fatalf("finalizar proceso: %d %v", cod, r)
	}
	ex["tramite"] = tramiteSGD("2026-01400-1")
	if cod, _ := asis.llamar("POST", "/api/indexar", ex); cod != http.StatusConflict {
		t.Fatalf("un proceso finalizado no debía admitir trámites: %d", cod)
	}
	_, cat := asis.llamar("GET", "/api/catalogo", nil)
	if len(lista(cat, "procesos")) != 0 || len(lista(cat, "profesionales")) != 1 {
		t.Fatalf("el catálogo del Conector debía excluir finalizados: %v", cat["procesos"])
	}
}

func TestCicloBaseSinPlantilla(t *testing.T) {
	_, admin := entorno(t)
	profID := admin.crearUsuario("jsalazar", RolProfesional)
	cod, r := admin.llamar("POST", "/api/procesos", map[string]any{"titulo": "Demanda de obligación de dar suma de dinero", "categoria": "CIV", "via": "CIV-CON", "profesionalId": profID})
	if cod != http.StatusCreated {
		t.Fatalf("alta de proceso: %d %v", cod, r)
	}
	if r["proceso"].(map[string]any)["cicloBase"] != true || len(lista(r, "tareas")) != 7 {
		t.Fatalf("sin plantilla debía usar las 7 etapas del proceso de conocimiento: %v", r["proceso"])
	}
	if cod, _ := admin.llamar("POST", "/api/procesos", map[string]any{"titulo": "X", "categoria": "CIV", "via": "PEN-COM", "profesionalId": profID}); cod != http.StatusUnprocessableEntity {
		t.Fatalf("la vía debía pertenecer a la categoría: %d", cod)
	}
}

func TestAdministracionDeBD(t *testing.T) {
	_, admin := entorno(t)
	profID := admin.crearUsuario("prof1", RolProfesional)
	admin.llamar("POST", "/api/procesos", map[string]any{"titulo": "P", "categoria": "LAB", "via": "LAB-ORD", "profesionalId": profID})
	_, bd := admin.llamar("GET", "/api/admin/bd", nil)
	if len(lista(bd, "colecciones")) != len(colecciones) {
		t.Fatalf("debía listar las colecciones: %v", bd)
	}
	_, docs := admin.llamar("GET", "/api/admin/bd/usuarios", nil)
	for _, d := range lista(docs, "documentos") {
		if strings.Contains(string(mustJSON(d)), "pbkdf2") {
			t.Fatal("no debía exponer huellas de contraseña")
		}
	}
	if cod, _ := admin.llamar("POST", "/api/admin/vaciar", map[string]any{"modo": "operativos", "confirmacion": "no"}); cod != http.StatusUnprocessableEntity {
		t.Fatalf("debía exigir la confirmación VACIAR: %d", cod)
	}
	if cod, _ := admin.llamar("POST", "/api/admin/vaciar", map[string]any{"modo": "operativos", "confirmacion": "VACIAR"}); cod != http.StatusOK {
		t.Fatalf("vaciar operativos: %d", cod)
	}
	_, d := admin.llamar("GET", "/api/datos", nil)
	if len(lista(d, "procesos")) != 0 || len(lista(d, "usuarios")) != 2 {
		t.Fatalf("debía borrar procesos y conservar usuarios")
	}
	if cod, _ := admin.llamar("POST", "/api/admin/vaciar", map[string]any{"modo": "total", "confirmacion": "VACIAR"}); cod != http.StatusOK {
		t.Fatalf("vaciar total: %d", cod)
	}
	if cod, _ := admin.llamar("GET", "/api/datos", nil); cod != http.StatusUnauthorized {
		t.Fatalf("tras el vaciado total la sesión debía cerrarse: %d", cod)
	}
	admin.ingresar("admin", "admin") // administrador recreado con la clave inicial del .env
}

func TestPermisosYCsrf(t *testing.T) {
	_, admin := entorno(t)
	admin.crearUsuario("gerente1", RolGerente)
	ger := admin.como("gerente1", "clave-gerente1")
	if cod, _ := ger.llamar("GET", "/api/admin/bd", nil); cod != http.StatusForbidden {
		t.Fatalf("el gerente no debía administrar la BD: %d", cod)
	}
	req := httptest.NewRequest("POST", "/api/sesion", strings.NewReader(`{"usuario":"admin","clave":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://sitio-externo.example")
	rec := httptest.NewRecorder()
	admin.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("debía rechazar orígenes externos: %d", rec.Code)
	}
	req = httptest.NewRequest("GET", "/api/estado", nil)
	req.Header.Set("Origin", "chrome-extension://abc")
	rec = httptest.NewRecorder()
	admin.h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "chrome-extension://abc" {
		t.Fatal("debía permitir CORS a la extensión")
	}
}

func TestDiasHabiles(t *testing.T) {
	cal := nuevoCalendario(nil)
	// Viernes 24/07/2026 + 3 hábiles: cuenta 27, 30 y 31 (28 y 29 son Fiestas Patrias).
	if f := cal.Sumar("2026-07-24", 3, DiasHabiles); f != "2026-07-31" {
		t.Fatalf("esperaba 2026-07-31, obtuve %s", f)
	}
	// Pascua 2026: 5 de abril → Jueves y Viernes Santo 2 y 3 de abril.
	if !cal.feriados["2026-04-02"] || !cal.feriados["2026-04-03"] {
		t.Fatal("faltan Jueves y Viernes Santo")
	}
	// Días calendario que vencen en domingo se prorrogan al lunes.
	if f := cal.Sumar("2026-10-16", 2, DiasCalendario); f != "2026-10-19" {
		t.Fatalf("esperaba 2026-10-19, obtuve %s", f)
	}
}

func TestExtensionPreconfigurada(t *testing.T) {
	s, _ := entorno(t)
	archivos, err := s.archivosExtension()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(archivos["shared/entorno.js"]), "http://192.168.1.10:8790") {
		t.Fatalf("entorno.js debía apuntar a la URL pública: %s", archivos["shared/entorno.js"])
	}
	if !strings.Contains(string(archivos["manifest.json"]), "http://192.168.1.10/*") {
		t.Fatalf("manifest.json debía incluir el permiso del servidor: %s", archivos["manifest.json"])
	}
}

func hayAlerta(d map[string]any, tipo, tareaID string) bool {
	for _, a := range lista(d, "alertas") {
		m := a.(map[string]any)
		if m["tipo"] == tipo && m["tareaId"] == tareaID {
			return true
		}
	}
	return false
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
