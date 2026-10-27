package sgdpruebas

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func nuevoSGD(t *testing.T) http.Handler {
	t.Helper()
	s := Nuevo(filepath.Join(t.TempDir(), "sgd-pruebas.db"))
	t.Cleanup(s.Cerrar)
	return s.Handler()
}

type peticion struct {
	metodo, ruta string
	cuerpo       []byte
	cabecera     bool   // X-SGD-Pruebas
	usuario      string // Basic (clave «prueba» salvo que se indique otra con usuario:clave)
}

func pedir(t *testing.T, h http.Handler, p peticion) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(p.metodo, p.ruta, bytes.NewReader(p.cuerpo))
	if p.cabecera {
		req.Header.Set("X-SGD-Pruebas", "1")
	}
	if p.usuario != "" {
		u, c, ok := strings.Cut(p.usuario, ":")
		if !ok {
			c = "prueba"
		}
		req.SetBasicAuth(u, c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func jsonDe(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("respuesta no JSON (%d): %s", rec.Code, rec.Body)
	}
	return m
}

func TestRutasDePaginas(t *testing.T) {
	h := nuevoSGD(t)
	for _, ruta := range []string{"/sgd-simulado/", "/sgd-simulado/pages/login", "/sgd-simulado/dashboard", "/sgd-simulado/tramites/mistramites",
		"/sgd-simulado/tramites/listadotramites", "/sgd-simulado/tramites/nuevotramiteint", "/sgd-simulado/tramites/detalletramite/250101", "/sgd-simulado/consola"} {
		rec := pedir(t, h, peticion{metodo: "GET", ruta: ruta})
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html") {
			t.Errorf("%s: %d", ruta, rec.Code)
		}
	}
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/nucleo.js"}); rec.Code != http.StatusOK {
		t.Errorf("nucleo.js: %d", rec.Code)
	}
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/pruebas/nucleo.test.js"}); rec.Code == http.StatusOK {
		t.Error("las pruebas no deben publicarse")
	}
}

func TestAlmacenEstadoCompartido(t *testing.T) {
	h := nuevoSGD(t)
	rec := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/estado"})
	if m := jsonDe(t, rec); m["version"].(float64) != 0 || m["estado"] != nil {
		t.Fatalf("estado inicial: %s", rec.Body)
	}
	if rec := pedir(t, h, peticion{metodo: "PUT", ruta: "/sgd-simulado/api/estado", cuerpo: []byte(`{"version":0,"estado":{"version":2}}`)}); rec.Code != http.StatusForbidden {
		t.Errorf("sin cabecera X-SGD-Pruebas debía rechazarse: %d", rec.Code)
	}
	if rec := pedir(t, h, peticion{metodo: "PUT", ruta: "/sgd-simulado/api/estado", cuerpo: []byte(`{"version":0,"estado":{"version":2,"a":1}}`), cabecera: true}); rec.Code != 200 {
		t.Fatalf("primera escritura: %d %s", rec.Code, rec.Body)
	}
	// Una escritura con la versión vieja es un conflicto (otro usuario escribió antes).
	if rec := pedir(t, h, peticion{metodo: "PUT", ruta: "/sgd-simulado/api/estado", cuerpo: []byte(`{"version":0,"estado":{"version":2,"a":2}}`), cabecera: true}); rec.Code != http.StatusConflict {
		t.Errorf("conflicto esperado: %d", rec.Code)
	}
	if rec := pedir(t, h, peticion{metodo: "PUT", ruta: "/sgd-simulado/api/estado", cuerpo: []byte(`{"version":1,"estado":"x"}`), cabecera: true}); rec.Code != http.StatusBadRequest {
		t.Errorf("estado inválido: %d", rec.Code)
	}
	rec = pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/estado"})
	if m := jsonDe(t, rec); m["version"].(float64) != 1 || !strings.Contains(rec.Body.String(), `"a":1`) {
		t.Errorf("estado guardado: %s", rec.Body)
	}
}

func TestAlmacenArchivos(t *testing.T) {
	h := nuevoSGD(t)
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: "/sgd-simulado/api/archivos?nombre=x.exe", cuerpo: []byte("MZ"), cabecera: true}); rec.Code != http.StatusBadRequest {
		t.Errorf("extensión prohibida: %d", rec.Code)
	}
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: "/sgd-simulado/api/archivos?nombre=vacio.txt", cabecera: true}); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("archivo vacío: %d", rec.Code)
	}
	rec := pedir(t, h, peticion{metodo: "POST", ruta: "/sgd-simulado/api/archivos?nombre=Informe%20%C3%B1.txt", cuerpo: []byte("INFORME DE PRUEBA ñ"), cabecera: true})
	id, _ := jsonDe(t, rec)["id"].(string)
	if rec.Code != http.StatusCreated || len(id) != 32 {
		t.Fatalf("subida: %d %s", rec.Code, rec.Body)
	}
	rec = pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/archivos/" + id})
	if rec.Code != 200 || rec.Body.String() != "INFORME DE PRUEBA ñ" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
		t.Errorf("descarga: %d %q", rec.Code, rec.Body)
	}
	if d := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/archivos/" + id + "?descargar=1"}).Header().Get("Content-Disposition"); !strings.HasPrefix(d, "attachment") || !strings.Contains(d, "Informe%20%C3%B1.txt") {
		t.Errorf("Content-Disposition: %s", d)
	}
	pedir(t, h, peticion{metodo: "POST", ruta: "/sgd-simulado/api/reiniciar", cabecera: true})
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/archivos/" + id}); rec.Code != http.StatusNotFound {
		t.Errorf("tras reiniciar el archivo debía desaparecer: %d", rec.Code)
	}
}

func TestAPIv1FlujoCompleto(t *testing.T) {
	h := nuevoSGD(t)
	v1 := "/sgd-simulado/api/v1"

	if m := jsonDe(t, pedir(t, h, peticion{metodo: "GET", ruta: v1})); m["version"] != "2.0.0" || len(m["reglas"].([]any)) != 22 {
		t.Fatalf("info: %v", m)
	}
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/bandeja"}); rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("sin credenciales: %d", rec.Code)
	}
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/bandeja", usuario: "usuario.prueba:mala"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("clave incorrecta: %d", rec.Code)
	}
	// Bandeja con los escenarios (se siembran en la primera operación)
	m := jsonDe(t, pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/bandeja", usuario: "usuario.prueba"}))
	if m["total"].(float64) != 18 {
		t.Errorf("bandeja inicial: %v", m["total"])
	}
	// Registrar con documento (archivo en Base64) y derivar en el mismo paso
	cuerpo, _ := json.Marshal(map[string]any{
		"tipo": "INFORME", "asunto": "INFORME DESDE OTRO SISTEMA (API)",
		"documento": map[string]any{"nombre": "informe.txt", "contenidoBase64": base64.StdEncoding.EncodeToString([]byte("Texto del informe ñ"))},
		"derivar":   map[string]any{"areaDestino": "GERENCIA DE ASESORÍA JURÍDICA", "usuarioDestino": "abogado.uno", "plazoDias": 3, "proveido": "Para opinión"},
	})
	rec := pedir(t, h, peticion{metodo: "POST", ruta: v1 + "/tramites", cuerpo: cuerpo, usuario: "logistica"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("registrar: %d %s", rec.Code, rec.Body)
	}
	t1 := jsonDe(t, rec)
	id := int(t1["id"].(float64))
	ruta := v1 + "/tramites/" + strings.TrimSpace(jsonNumero(id))
	if t1["estado"] != "DERIVADO" || t1["asignadoA"] != "abogado.uno" {
		t.Errorf("registrado: %v %v", t1["estado"], t1["asignadoA"])
	}
	// El contenido del archivo se recupera por la API
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: ruta + "/adjuntos/0?contenido=1", usuario: "abogado.uno"}); rec.Body.String() != "Texto del informe ñ" {
		t.Errorf("contenido del adjunto: %d %q", rec.Code, rec.Body)
	}
	// Reglas: otra área no puede recibir (RN-03 → 403); estado inválido (RN-04 → 422)
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: ruta + "/recibir", usuario: "comercial"}); rec.Code != http.StatusForbidden || jsonDe(t, rec)["codigo"] != "RN-03" {
		t.Errorf("RN-03: %d %s", rec.Code, rec.Body)
	}
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: ruta + "/atender", usuario: "abogado.uno"}); rec.Code != http.StatusUnprocessableEntity || jsonDe(t, rec)["codigo"] != "RN-04" {
		t.Errorf("RN-04: %d %s", rec.Code, rec.Body)
	}
	for _, paso := range []struct{ accion, cuerpo, estado string }{
		{"recibir", ``, "RECIBIDO"},
		{"iniciar", ``, "EN PROCESO"},
		{"adjuntar", `{"nombre":"OPINION.txt","texto":"Procede."}`, "EN PROCESO"},
		{"atender", `{"motivo":"Opinión emitida"}`, "ATENDIDO"},
	} {
		rec := pedir(t, h, peticion{metodo: "POST", ruta: ruta + "/" + paso.accion, cuerpo: []byte(paso.cuerpo), usuario: "abogado.uno"})
		if rec.Code != 200 || jsonDe(t, rec)["estado"] != paso.estado {
			t.Fatalf("%s: %d %s", paso.accion, rec.Code, rec.Body)
		}
	}
	// Lo hecho por la API se ve en la página (mismo estado del almacén)
	estado := pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/estado"}).Body.String()
	if !strings.Contains(estado, "OPINION.txt") || !strings.Contains(estado, "INFORME DESDE OTRO SISTEMA") {
		t.Error("el estado del almacén no refleja las acciones de la API")
	}
	// Búsqueda, por número y bitácora
	if m := jsonDe(t, pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/tramites?asunto=otro%20sistema", usuario: "consulta"})); m["total"].(float64) != 1 {
		t.Errorf("buscar: %v", m)
	}
	if rec := pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/tramites", usuario: "consulta"}); rec.Code != 422 {
		t.Errorf("RN-20: %d", rec.Code)
	}
	if m := jsonDe(t, pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/tramites/numero/2026-00871-12", usuario: "consulta"})); m["id"].(float64) != 250102 {
		t.Errorf("por número: %v", m["id"])
	}
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: ruta + "/iniciar", usuario: "consulta"}); rec.Code != http.StatusForbidden {
		t.Errorf("RN-02 consulta: %d", rec.Code)
	}
	// Registro con un error en la derivación: no queda nada registrado (todo o nada)
	malo, _ := json.Marshal(map[string]any{"tipo": "INFORME", "asunto": "NO DEBE QUEDAR", "derivar": map[string]any{"areaDestino": "ÁREA DE LOGÍSTICA", "proveido": "x"}})
	if rec := pedir(t, h, peticion{metodo: "POST", ruta: v1 + "/tramites", cuerpo: malo, usuario: "logistica"}); rec.Code != 422 {
		t.Errorf("derivar a la misma área: %d", rec.Code)
	}
	if strings.Contains(pedir(t, h, peticion{metodo: "GET", ruta: "/sgd-simulado/api/estado"}).Body.String(), "NO DEBE QUEDAR\",\"contenido") {
		t.Error("el registro fallido no debía guardarse")
	}
	bit := pedir(t, h, peticion{metodo: "GET", ruta: v1 + "/bitacora", usuario: "consulta"}).Body.String()
	if !strings.Contains(bit, "RECHAZADO") || !strings.Contains(bit, `"accion":"atender"`) {
		t.Error("bitácora incompleta")
	}
	// CORS para clientes web
	if rec := pedir(t, h, peticion{metodo: "OPTIONS", ruta: v1 + "/bandeja"}); rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("CORS: %d", rec.Code)
	}
}

func jsonNumero(n int) string { b, _ := json.Marshal(n); return string(b) }
