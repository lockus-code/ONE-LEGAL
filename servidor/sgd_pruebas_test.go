package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func pedirSGD(t *testing.T, h http.Handler, metodo, ruta string, cuerpo []byte, cabecera bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(metodo, ruta, bytes.NewReader(cuerpo))
	if cabecera {
		req.Header.Set("X-SGD-Pruebas", "1")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSGDPruebasRutas(t *testing.T) {
	s, _ := entorno(t)
	h := s.Rutas()
	for _, ruta := range []string{"/sgd-simulado/", "/sgd-simulado/pages/login", "/sgd-simulado/dashboard", "/sgd-simulado/tramites/mistramites",
		"/sgd-simulado/tramites/listadotramites", "/sgd-simulado/tramites/nuevotramiteint", "/sgd-simulado/tramites/detalletramite/250101", "/sgd-simulado/consola"} {
		rec := pedirSGD(t, h, "GET", ruta, nil, false)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<app-root") && !strings.Contains(rec.Body.String(), "consola") {
			t.Errorf("%s: %d", ruta, rec.Code)
		}
	}
	if rec := pedirSGD(t, h, "GET", "/sgd-simulado/nucleo.js", nil, false); rec.Code != http.StatusOK {
		t.Errorf("nucleo.js: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "GET", "/sgd-simulado/pruebas/nucleo.test.js", nil, false); rec.Code == http.StatusOK {
		t.Error("las pruebas no deben publicarse")
	}
}

func TestSGDPruebasEstadoCompartido(t *testing.T) {
	s, _ := entorno(t)
	h := s.Rutas()
	var r struct {
		Version int             `json:"version"`
		Estado  json.RawMessage `json:"estado"`
	}
	rec := pedirSGD(t, h, "GET", "/sgd-simulado/api/estado", nil, false)
	json.Unmarshal(rec.Body.Bytes(), &r)
	if rec.Code != 200 || r.Version != 0 || string(r.Estado) != "null" {
		t.Fatalf("estado inicial: %d %s", rec.Code, rec.Body)
	}
	if rec := pedirSGD(t, h, "PUT", "/sgd-simulado/api/estado", []byte(`{"version":0,"estado":{"version":2}}`), false); rec.Code != http.StatusForbidden {
		t.Errorf("sin cabecera X-SGD-Pruebas debía rechazarse: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "PUT", "/sgd-simulado/api/estado", []byte(`{"version":0,"estado":{"version":2,"a":1}}`), true); rec.Code != 200 {
		t.Fatalf("primera escritura: %d %s", rec.Code, rec.Body)
	}
	// Una escritura con la versión vieja es un conflicto (otro usuario escribió antes).
	if rec := pedirSGD(t, h, "PUT", "/sgd-simulado/api/estado", []byte(`{"version":0,"estado":{"version":2,"a":2}}`), true); rec.Code != http.StatusConflict {
		t.Errorf("conflicto esperado: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "PUT", "/sgd-simulado/api/estado", []byte(`{"version":1,"estado":"x"}`), true); rec.Code != http.StatusBadRequest {
		t.Errorf("estado inválido: %d", rec.Code)
	}
	rec = pedirSGD(t, h, "GET", "/sgd-simulado/api/estado", nil, false)
	json.Unmarshal(rec.Body.Bytes(), &r)
	if r.Version != 1 || !strings.Contains(string(r.Estado), `"a":1`) {
		t.Errorf("estado guardado: %s", rec.Body)
	}
}

func TestSGDPruebasArchivos(t *testing.T) {
	s, _ := entorno(t)
	h := s.Rutas()
	if rec := pedirSGD(t, h, "POST", "/sgd-simulado/api/archivos?nombre=x.exe", []byte("MZ"), true); rec.Code != http.StatusBadRequest {
		t.Errorf("extensión prohibida: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "POST", "/sgd-simulado/api/archivos?nombre=vacio.txt", nil, true); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("archivo vacío: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "POST", "/sgd-simulado/api/archivos?nombre=x.txt", []byte("hola"), false); rec.Code != http.StatusForbidden {
		t.Errorf("sin cabecera: %d", rec.Code)
	}
	rec := pedirSGD(t, h, "POST", "/sgd-simulado/api/archivos?nombre=Informe%20%C3%B1.txt", []byte("INFORME DE PRUEBA ñ"), true)
	var r struct{ ID string }
	json.Unmarshal(rec.Body.Bytes(), &r)
	if rec.Code != http.StatusCreated || len(r.ID) != 32 {
		t.Fatalf("subida: %d %s", rec.Code, rec.Body)
	}
	rec = pedirSGD(t, h, "GET", "/sgd-simulado/api/archivos/"+r.ID, nil, false)
	if rec.Code != 200 || rec.Body.String() != "INFORME DE PRUEBA ñ" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline") {
		t.Errorf("descarga: %d %q %v", rec.Code, rec.Body, rec.Header())
	}
	if d := pedirSGD(t, h, "GET", "/sgd-simulado/api/archivos/"+r.ID+"?descargar=1", nil, false).Header().Get("Content-Disposition"); !strings.HasPrefix(d, "attachment") || !strings.Contains(d, "Informe%20%C3%B1.txt") {
		t.Errorf("Content-Disposition: %s", d)
	}
	if rec := pedirSGD(t, h, "POST", "/sgd-simulado/api/reiniciar", nil, true); rec.Code != 200 {
		t.Fatalf("reiniciar: %d", rec.Code)
	}
	if rec := pedirSGD(t, h, "GET", "/sgd-simulado/api/archivos/"+r.ID, nil, false); rec.Code != http.StatusNotFound {
		t.Errorf("tras reiniciar el archivo debía desaparecer: %d", rec.Code)
	}
}
