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

func servidorDePrueba(t *testing.T) http.Handler {
	t.Helper()
	bd, err := abrirBD(filepath.Join(t.TempDir(), "prueba.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { bd.Cerrar() })
	anio := time.Now().Year()
	semilla := Catalogo{
		Categorias:   []Categoria{{Codigo: "ARB", Nombre: "Arbitraje y Controversias", Procedimientos: []string{"Arbitraje de Derecho"}}},
		Responsables: []Responsable{{Codigo: "R02", Nombre: "Abg. Luis Alberto Paredes Vela"}},
		Procesos: []Proceso{
			{Codigo: codigo(anio, 4), Denominacion: "Arbitraje en curso", Categoria: "Arbitraje y Controversias", Procedimiento: "Arbitraje de Derecho", Responsable: "R02", Estado: "En trámite"},
			{Codigo: codigo(anio, 6), Denominacion: "Conciliación concluida", Categoria: "Arbitraje y Controversias", Procedimiento: "Arbitraje de Derecho", Responsable: "R02", Estado: estadoFinalizado},
		},
	}
	web, _ := fs.Sub(webEmbebido, "web")
	s := &Servidor{bd: bd, semilla: semilla, web: web, base: "http://localhost:8790/", iniciado: time.Now()}
	return s.Rutas()
}

func codigo(anio, n int) string { return "PL-" + itoa(anio) + "-" + pad4(n) }
func itoa(n int) string          { b, _ := json.Marshal(n); return string(b) }
func pad4(n int) string          { s := itoa(n); return strings.Repeat("0", 4-len(s)) + s }

func tramite(id, modo, proceso string) map[string]any {
	return map[string]any{
		"id": id, "nroExpediente": "2026-0048213", "asunto": "Solicita ampliación de plazo",
		"enlaceSgd": "http://localhost:8790/sgd-simulado/detalle.html?id=1", "asuntoVinculacion": "Se incorpora para evaluación",
		"vinculacion": map[string]any{"modo": modo, "procesoCodigo": proceso},
	}
}

func llamar(t *testing.T, h http.Handler, metodo, ruta string, cuerpo any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if cuerpo != nil {
		json.NewEncoder(&buf).Encode(cuerpo)
	}
	req := httptest.NewRequest(metodo, ruta, &buf)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var res map[string]any
	json.Unmarshal(rec.Body.Bytes(), &res)
	return rec.Code, res
}

func TestAnexarAProcesoEnCurso(t *testing.T) {
	h := servidorDePrueba(t)
	anio := time.Now().Year()
	cod, res := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T1", "anexo", codigo(anio, 4))})
	if cod != http.StatusCreated {
		t.Fatalf("esperaba 201, obtuve %d: %v", cod, res)
	}
	// Reintento idempotente
	cod, res = llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T1", "anexo", codigo(anio, 4))})
	if cod != http.StatusOK || res["duplicado"] != true {
		t.Fatalf("el reintento debía ser idempotente: %d %v", cod, res)
	}
	_, lista := llamar(t, h, "GET", "/api/vinculaciones", nil)
	if n := len(lista["tramitesIndexados"].([]any)); n != 1 {
		t.Fatalf("esperaba 1 trámite, hay %d", n)
	}
}

func TestNoSeAnexaAProcesoFinalizado(t *testing.T) {
	h := servidorDePrueba(t)
	cod, res := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T2", "anexo", codigo(time.Now().Year(), 6))})
	if cod != http.StatusConflict || !strings.Contains(res["mensaje"].(string), "finalizado") {
		t.Fatalf("esperaba 409 por proceso finalizado, obtuve %d %v", cod, res)
	}
}

func TestGenerarProcesoAsignaCodigoCorrelativo(t *testing.T) {
	h := servidorDePrueba(t)
	nuevo := map[string]any{"denominacion": "Arbitraje nuevo", "categoria": "Arbitraje y Controversias", "procedimiento": "Arbitraje de Derecho", "responsable": "R02"}
	cod, res := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T3", "nuevo", ""), "procesoNuevo": nuevo})
	if cod != http.StatusCreated {
		t.Fatalf("esperaba 201, obtuve %d %v", cod, res)
	}
	esperado := codigo(time.Now().Year(), 7)
	if res["proceso"].(map[string]any)["codigo"] != esperado {
		t.Fatalf("esperaba código %s, obtuve %v", esperado, res["proceso"])
	}
	_, cat := llamar(t, h, "GET", "/api/catalogo", nil)
	if n := len(cat["procesos"].([]any)); n != 3 {
		t.Fatalf("el catálogo debía incluir el proceso nuevo; hay %d procesos", n)
	}
}

func TestValidaciones(t *testing.T) {
	h := servidorDePrueba(t)
	sinAsunto := tramite("T4", "anexo", codigo(time.Now().Year(), 4))
	delete(sinAsunto, "asunto")
	if cod, _ := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": sinAsunto}); cod != http.StatusUnprocessableEntity {
		t.Fatalf("esperaba 422 por asunto faltante, obtuve %d", cod)
	}
	malo := map[string]any{"denominacion": "X", "categoria": "Arbitraje y Controversias", "procedimiento": "Proceso Laboral", "responsable": "R02"}
	if cod, _ := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T5", "nuevo", ""), "procesoNuevo": malo}); cod != http.StatusUnprocessableEntity {
		t.Fatalf("esperaba 422 por procedimiento ajeno a la categoría, obtuve %d", cod)
	}
	if cod, _ := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tramite("T6", "anexo", "PL-1999-0001")}); cod != http.StatusNotFound {
		t.Fatalf("esperaba 404 por proceso inexistente, obtuve %d", cod)
	}
}

func TestCorsSoloParaLaExtension(t *testing.T) {
	h := servidorDePrueba(t)
	for origen, permitido := range map[string]bool{"chrome-extension://abc": true, "https://sitio-externo.example": false} {
		req := httptest.NewRequest("GET", "/api/estado", nil)
		req.Header.Set("Origin", origen)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin") != ""; got != permitido {
			t.Errorf("origen %s: CORS permitido=%v, esperado %v", origen, got, permitido)
		}
	}
}

func TestPortalGuardaDocumento(t *testing.T) {
	h := servidorDePrueba(t)
	if cod, _ := llamar(t, h, "GET", "/api/portal", nil); cod != http.StatusNotFound {
		t.Fatalf("esperaba 404 sin datos, obtuve %d", cod)
	}
	doc := map[string]any{"version": 2, "procesos": []any{map[string]any{"codigo": "PL-2026-0100", "estado": "En trámite"}}}
	if cod, _ := llamar(t, h, "PUT", "/api/portal", doc); cod != http.StatusOK {
		t.Fatalf("esperaba 200 al guardar, obtuve %d", cod)
	}
	_, cat := llamar(t, h, "GET", "/api/catalogo", nil)
	if n := len(cat["procesos"].([]any)); n != 1 {
		t.Fatalf("el catálogo debía tomar los procesos del portal; hay %d", n)
	}
}

func TestConsultaTramiteRegistrado(t *testing.T) {
	h := servidorDePrueba(t)
	tr := tramite("T7", "anexo", codigo(time.Now().Year(), 4))
	tr["nroExpediente"] = "2026-01234-3"
	if cod, _ := llamar(t, h, "POST", "/api/vinculaciones", map[string]any{"tramite": tr}); cod != http.StatusCreated {
		t.Fatalf("esperaba 201, obtuve %d", cod)
	}
	_, res := llamar(t, h, "GET", "/api/tramites-sgd?numero=2026-01234-3", nil)
	if res["registrado"] != true || len(res["vinculaciones"].([]any)) != 1 {
		t.Fatalf("el trámite debía figurar como registrado: %v", res)
	}
	_, res = llamar(t, h, "GET", "/api/tramites-sgd?numero=2026-09999-1", nil)
	if res["registrado"] != false {
		t.Fatalf("un trámite nuevo no debía figurar como registrado: %v", res)
	}
}

func TestRutasDelSgdSimulado(t *testing.T) {
	h := servidorDePrueba(t)
	for ruta, contiene := range map[string]string{
		"/sgd-simulado/pages/login":                    "id=\"ingreso\"",
		"/sgd-simulado/tramites/mistramites":           "app-mistramites",
		"/sgd-simulado/tramites/detalletramite/250101": "app-detalletramite",
		"/sgd-simulado/estilos.css":                    "legend.title",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", ruta, nil))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), contiene) {
			t.Errorf("%s: código %d, se esperaba que contuviera %q", ruta, rec.Code, contiene)
		}
	}
}
