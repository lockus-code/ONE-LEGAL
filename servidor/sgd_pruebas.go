package main

// Almacén compartido del SGD de pruebas (/sgd-simulado/api/...).
//
// Las reglas del SGD de pruebas viven en un solo lugar, el núcleo JavaScript
// (pruebas/sgd-simulado/nucleo.js). El servidor solo guarda, para que varios
// usuarios en distintos equipos trabajen sobre los mismos trámites:
//   - el estado completo (JSON) con un número de versión: una escritura con una
//     versión vieja se rechaza (409) y el navegador reintenta la acción sobre el
//     estado nuevo (control de concurrencia optimista);
//   - los archivos subidos a los trámites.
// Usa una base aparte (datos/sgd-pruebas.db): nunca se mezcla con los datos de
// LEGAL ni entra en sus respaldos. Todo lo que contiene es ficticio.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	sgdMaxEstado  = 64 << 20 // el estado incluye los documentos redactados
	sgdMaxArchivo = 20 << 20 // RN-14
)

var (
	sgdBucketEstado   = []byte("estado")
	sgdBucketArchivos = []byte("archivos")
	sgdBucketMeta     = []byte("meta")
	sgdRutaArchivo    = regexp.MustCompile(`^archivos/([0-9a-f]{32})$`)
	sgdTiposArchivo   = map[string]string{
		".txt":  "text/plain; charset=utf-8",
		".pdf":  "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".jpg":  "image/jpeg",
		".png":  "image/png",
	}
)

type almacenSGD struct {
	once sync.Once
	db   *bolt.DB
	err  error
	ruta string
}

type metaArchivoSGD struct {
	Nombre string `json:"nombre"`
	Tipo   string `json:"tipo"`
	Bytes  int    `json:"bytes"`
	Fecha  string `json:"fecha"`
}

func (a *almacenSGD) abrir() (*bolt.DB, error) {
	a.once.Do(func() {
		a.db, a.err = bolt.Open(a.ruta, 0o600, &bolt.Options{Timeout: 2 * time.Second})
		if a.err != nil {
			return
		}
		a.err = a.db.Update(func(tx *bolt.Tx) error {
			for _, b := range [][]byte{sgdBucketEstado, sgdBucketArchivos, sgdBucketMeta} {
				if _, err := tx.CreateBucketIfNotExists(b); err != nil {
					return err
				}
			}
			return nil
		})
	})
	return a.db, a.err
}

func (a *almacenSGD) cerrar() {
	if a.db != nil {
		a.db.Close()
	}
}

// manejarAPISGD atiende /sgd-simulado/api/{estado|archivos|archivos/{id}|reiniciar}.
func (s *Servidor) manejarAPISGD(w http.ResponseWriter, r *http.Request, ruta string) {
	db, err := s.sgd.abrir()
	if err != nil {
		rechazar(w, http.StatusInternalServerError, "No se pudo abrir la base del SGD de pruebas.")
		return
	}
	switch {
	case ruta == "estado" && r.Method == http.MethodGet:
		var version int
		var estado json.RawMessage
		db.View(func(tx *bolt.Tx) error {
			b := tx.Bucket(sgdBucketEstado)
			version, _ = strconv.Atoi(string(b.Get([]byte("version"))))
			if v := b.Get([]byte("actual")); v != nil {
				estado = append(json.RawMessage(nil), v...)
			}
			return nil
		})
		if estado == nil {
			estado = json.RawMessage("null")
		}
		responder(w, http.StatusOK, map[string]any{"version": version, "estado": estado})

	case ruta == "estado" && r.Method == http.MethodPut:
		var cuerpo struct {
			Version int             `json:"version"`
			Estado  json.RawMessage `json:"estado"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, sgdMaxEstado)).Decode(&cuerpo); err != nil || len(cuerpo.Estado) == 0 || cuerpo.Estado[0] != '{' {
			rechazar(w, http.StatusBadRequest, "El estado no tiene el formato esperado.")
			return
		}
		errConflicto := errors.New("conflicto")
		nueva := 0
		err := db.Update(func(tx *bolt.Tx) error {
			b := tx.Bucket(sgdBucketEstado)
			actual, _ := strconv.Atoi(string(b.Get([]byte("version"))))
			if actual != cuerpo.Version {
				nueva = actual
				return errConflicto
			}
			nueva = actual + 1
			if err := b.Put([]byte("actual"), cuerpo.Estado); err != nil {
				return err
			}
			return b.Put([]byte("version"), []byte(strconv.Itoa(nueva)))
		})
		switch {
		case errors.Is(err, errConflicto):
			responder(w, http.StatusConflict, map[string]any{"mensaje": "Otro usuario modificó los datos; se reintentará.", "version": nueva})
		case err != nil:
			rechazar(w, http.StatusInternalServerError, "No se pudo guardar el estado.")
		default:
			responder(w, http.StatusOK, map[string]any{"version": nueva})
		}

	case ruta == "archivos" && r.Method == http.MethodPost:
		nombre := strings.TrimSpace(r.URL.Query().Get("nombre"))
		if _, ok := sgdTiposArchivo[strings.ToLower(filepath.Ext(nombre))]; !ok || len(nombre) > 200 {
			rechazar(w, http.StatusBadRequest, "Extensión no permitida (RN-14).")
			return
		}
		datos, err := io.ReadAll(io.LimitReader(r.Body, sgdMaxArchivo+1))
		if err != nil || len(datos) == 0 || len(datos) > sgdMaxArchivo {
			rechazar(w, http.StatusRequestEntityTooLarge, "El archivo debe pesar entre 1 byte y 20 MB (RN-14).")
			return
		}
		aleatorio := make([]byte, 16)
		rand.Read(aleatorio)
		id := hex.EncodeToString(aleatorio)
		meta, _ := json.Marshal(metaArchivoSGD{Nombre: nombre, Tipo: sgdTiposArchivo[strings.ToLower(filepath.Ext(nombre))], Bytes: len(datos), Fecha: ahora()})
		err = db.Update(func(tx *bolt.Tx) error {
			if err := tx.Bucket(sgdBucketArchivos).Put([]byte(id), datos); err != nil {
				return err
			}
			return tx.Bucket(sgdBucketMeta).Put([]byte(id), meta)
		})
		if err != nil {
			rechazar(w, http.StatusInternalServerError, "No se pudo guardar el archivo.")
			return
		}
		responder(w, http.StatusCreated, map[string]any{"id": id, "bytes": len(datos)})

	case sgdRutaArchivo.MatchString(ruta) && r.Method == http.MethodGet:
		id := sgdRutaArchivo.FindStringSubmatch(ruta)[1]
		var datos []byte
		var meta metaArchivoSGD
		db.View(func(tx *bolt.Tx) error {
			if v := tx.Bucket(sgdBucketArchivos).Get([]byte(id)); v != nil {
				datos = append([]byte(nil), v...)
				json.Unmarshal(tx.Bucket(sgdBucketMeta).Get([]byte(id)), &meta)
			}
			return nil
		})
		if datos == nil {
			rechazar(w, http.StatusNotFound, "El archivo no existe.")
			return
		}
		disposicion := "inline"
		if r.URL.Query().Get("descargar") != "" || strings.Contains(meta.Tipo, "openxmlformats") {
			disposicion = "attachment"
		}
		w.Header().Set("Content-Type", meta.Tipo)
		w.Header().Set("Content-Disposition", disposicion+`; filename*=UTF-8''`+urlEscape(meta.Nombre))
		w.Write(datos)

	case ruta == "reiniciar" && r.Method == http.MethodPost:
		// Borra estado y archivos; el navegador vuelve a cargar los escenarios.
		err := db.Update(func(tx *bolt.Tx) error {
			for _, b := range [][]byte{sgdBucketEstado, sgdBucketArchivos, sgdBucketMeta} {
				if err := tx.DeleteBucket(b); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
					return err
				}
				if _, err := tx.CreateBucket(b); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			rechazar(w, http.StatusInternalServerError, "No se pudo reiniciar el SGD de pruebas.")
			return
		}
		responder(w, http.StatusOK, map[string]any{"version": 0})

	default:
		rechazar(w, http.StatusNotFound, "Ruta no encontrada en la API del SGD de pruebas.")
	}
}

// urlEscape codifica un nombre de archivo para Content-Disposition (RFC 5987).
func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("-._~", c) >= 0 {
			b.WriteByte(c)
		} else {
			b.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{c})))
		}
	}
	return b.String()
}
