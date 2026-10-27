// Package sgdpruebas publica el SGD de pruebas (docs/14) bajo /sgd-simulado/:
// las páginas (embebidas desde pruebas/sgd-simulado), el almacén compartido que
// usan esas páginas y la API REST v1 para otros sistemas.
//
// Lo usan LEGAL (con LEGAL_SGD_SIMULADO=si) y el ejecutable independiente
// SGD-Pruebas (cmd/sgd-pruebas). Las reglas viven en un solo lugar, el núcleo
// JavaScript (nucleo.js): el navegador lo ejecuta en las páginas y este paquete
// lo ejecuta con goja en la API v1. Todo lo que guarda es ficticio.
package sgdpruebas

import (
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

// Prefijo de todas las rutas del SGD de pruebas (el mismo que esperan la extensión y docs/11).
const Prefijo = "/sgd-simulado/"

// web: copia de pruebas/sgd-simulado sin la carpeta pruebas/ (la hace servidor/construir.sh).
//
//go:embed all:web
var webEmbebido embed.FS

// SGD es una instancia del SGD de pruebas con su propia base de datos.
type SGD struct {
	ruta     string
	once     sync.Once
	db       *bolt.DB
	err      error
	web      fs.FS
	archivos http.Handler
	paginas  map[string]string
	patrones []patron
	motor    *motor
}

type patron struct {
	re     *regexp.Regexp
	pagina string
}

// Nuevo prepara el SGD de pruebas; la base (rutaBD) se abre en la primera petición a la API.
func Nuevo(rutaBD string) *SGD {
	web, err := fs.Sub(webEmbebido, "web")
	if err != nil {
		panic(err)
	}
	var rutas struct {
		Paginas  map[string]string `json:"paginas"`
		Patrones []struct {
			Patron string `json:"patron"`
			Pagina string `json:"pagina"`
		} `json:"patrones"`
	}
	b, err := fs.ReadFile(web, "rutas.json")
	if err == nil {
		err = json.Unmarshal(b, &rutas)
	}
	if err != nil {
		panic("sgd-simulado/rutas.json: " + err.Error())
	}
	s := &SGD{ruta: rutaBD, web: web, archivos: http.FileServer(http.FS(web)), paginas: rutas.Paginas}
	for _, p := range rutas.Patrones {
		s.patrones = append(s.patrones, patron{regexp.MustCompile(p.Patron), p.Pagina})
	}
	s.motor = nuevoMotor(web)
	return s
}

// Version del núcleo de reglas embebido (SGD.VERSION).
func (s *SGD) Version() string { return s.motor.version }

func (s *SGD) abrir() (*bolt.DB, error) {
	s.once.Do(func() {
		s.db, s.err = bolt.Open(s.ruta, 0o600, &bolt.Options{Timeout: 2 * time.Second})
		if s.err != nil {
			return
		}
		s.err = s.db.Update(func(tx *bolt.Tx) error {
			for _, b := range [][]byte{bucketEstado, bucketArchivos, bucketMeta} {
				if _, err := tx.CreateBucketIfNotExists(b); err != nil {
					return err
				}
			}
			return nil
		})
	})
	return s.db, s.err
}

// Cerrar libera la base de datos.
func (s *SGD) Cerrar() {
	if s.db != nil {
		s.db.Close()
	}
}

// Handler atiende todas las rutas bajo Prefijo: páginas que imitan el enrutador
// HTML5 de Angular del SGD de SEDAPAR (rutas.json), /api/ (almacén de las páginas)
// y /api/v1/ (API REST para otros sistemas).
func (s *SGD) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		ruta := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, Prefijo), "/")
		if ruta == "api/v1" || strings.HasPrefix(ruta, "api/v1/") {
			s.manejarV1(w, r, strings.TrimPrefix(strings.TrimPrefix(ruta, "api/v1"), "/"))
			return
		}
		if strings.HasPrefix(ruta, "api/") {
			// Las escrituras del almacén exigen una cabecera propia: obliga a una consulta
			// previa CORS, así que otra página no puede escribir aquí desde el navegador.
			if r.Method != http.MethodGet && r.Header.Get("X-SGD-Pruebas") != "1" {
				rechazar(w, http.StatusForbidden, "Falta la cabecera X-SGD-Pruebas.")
				return
			}
			s.manejarAlmacen(w, r, strings.TrimPrefix(ruta, "api/"))
			return
		}
		pagina, ok := s.paginas[ruta]
		for _, p := range s.patrones {
			if !ok && p.re.MatchString(ruta) {
				pagina, ok = p.pagina, true
			}
		}
		r2 := r.Clone(r.Context())
		if ok {
			r2.URL.Path = "/" + pagina
		} else {
			r2.URL.Path = "/" + path.Clean(ruta)
		}
		s.archivos.ServeHTTP(w, r2)
	})
}

func responder(w http.ResponseWriter, estado int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	json.NewEncoder(w).Encode(v)
}

func rechazar(w http.ResponseWriter, estado int, mensaje string) {
	responder(w, estado, map[string]any{"mensaje": mensaje})
}

func ahora() string { return time.Now().Format(time.RFC3339) }
