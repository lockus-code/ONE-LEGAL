package main

// Extensión «LEGAL · Conector SGD» preconfigurada con la dirección de este
// servidor: se copia a la carpeta de datos (para este equipo) y se ofrece como
// .zip en /descargas/conector-sgd.zip (para los demás equipos de la intranet).

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// archivosExtension devuelve los archivos de la extensión con entorno.js y manifest.json ajustados.
func (s *Servidor) archivosExtension() (map[string][]byte, error) {
	archivos := map[string][]byte{}
	err := fs.WalkDir(s.web, "extension", func(ruta string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(s.web, ruta)
		if err != nil {
			return err
		}
		archivos[strings.TrimPrefix(ruta, "extension/")] = b
		return nil
	})
	if err != nil {
		return nil, err
	}
	urls := append([]string{}, s.cfg.SGDURLs...)
	if s.cfg.SGDSimulado {
		urls = append(urls, s.cfg.URLPublica+"/sgd-simulado/", s.cfg.urlLocal()+"/sgd-simulado/")
	}
	entorno := map[string]any{"urlsSgd": urls, "servidorLegal": s.cfg.URLPublica, "modoActivacion": "indicador"}
	b, _ := json.MarshalIndent(entorno, "", "  ")
	archivos["shared/entorno.js"] = []byte("/* Generado por LEGAL: configuración de este servidor (" + s.cfg.URLPublica + "). */\nself.LEGAL_ENTORNO = " + string(b) + ";\n")

	var manifest map[string]any
	if err := json.Unmarshal(archivos["manifest.json"], &manifest); err == nil {
		permisos, _ := manifest["host_permissions"].([]any)
		existentes := map[string]bool{}
		for _, p := range permisos {
			existentes[p.(string)] = true
		}
		for _, u := range append(urls, s.cfg.URLPublica+"/", s.cfg.urlLocal()+"/") {
			if pu, err := url.Parse(u); err == nil && pu.Host != "" {
				patron := pu.Scheme + "://" + pu.Hostname() + "/*"
				if !existentes[patron] {
					permisos = append(permisos, patron)
					existentes[patron] = true
				}
			}
		}
		manifest["host_permissions"] = permisos
		if mb, err := json.MarshalIndent(manifest, "", "  "); err == nil {
			archivos["manifest.json"] = mb
		}
	}
	return archivos, nil
}

func (s *Servidor) extraerExtension(destino string) error {
	archivos, err := s.archivosExtension()
	if err != nil {
		return err
	}
	for ruta, b := range archivos {
		salida := filepath.Join(destino, filepath.FromSlash(ruta))
		if err := os.MkdirAll(filepath.Dir(salida), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(salida, b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (s *Servidor) manejarDescargaExtension(w http.ResponseWriter, r *http.Request) {
	archivos, err := s.archivosExtension()
	if err != nil {
		errorInterno(w, err)
		return
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for ruta, b := range archivos {
		f, err := z.Create("legal-conector-sgd/" + ruta)
		if err != nil {
			errorInterno(w, err)
			return
		}
		f.Write(b)
	}
	z.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="legal-conector-sgd.zip"`)
	w.Write(buf.Bytes())
}
