package main

// Base de datos de LEGAL: bbolt, un almacén NoSQL clave-valor embebido en un
// único archivo (datos/legal.db). Se crea vacía la primera vez que se inicia el
// ejecutable; no requiere instalar ningún motor de base de datos.
// Cada colección es un «bucket» y cada documento un JSON con su clave.

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	colUsuarios    = "usuarios"
	colSesiones    = "sesiones"
	colPlantillas  = "plantillas"
	colProcesos    = "procesos"
	colTareas      = "tareas"
	colTramites    = "tramites"
	colSolicitudes = "solicitudes"
	colAuditoria   = "auditoria"
	colSistema     = "sistema" // taxonomía, configuración, contadores y metadatos

	claveTaxonomia = "taxonomia"
	claveConfig    = "configuracion"
	claveCreada    = "creada_en"
)

var colecciones = []string{colUsuarios, colSesiones, colPlantillas, colProcesos, colTareas, colTramites, colSolicitudes, colAuditoria, colSistema}

// coleccionesOperativas: lo que se borra al «vaciar datos operativos».
var coleccionesOperativas = []string{colProcesos, colTareas, colTramites, colSolicitudes, colAuditoria}

var errNoEncontrado = errors.New("no encontrado")

type BD struct {
	db   *bolt.DB
	ruta string
}

func abrirBD(ruta string) (*BD, error) {
	db, err := bolt.Open(ruta, 0o600, &bolt.Options{Timeout: 2 * time.Second})
	if err != nil {
		return nil, err
	}
	bd := &BD{db: db, ruta: ruta}
	if err := bd.prepararColecciones(); err != nil {
		db.Close()
		return nil, err
	}
	return bd, nil
}

func (bd *BD) prepararColecciones() error {
	return bd.db.Update(func(tx *bolt.Tx) error {
		for _, c := range colecciones {
			if _, err := tx.CreateBucketIfNotExists([]byte(c)); err != nil {
				return err
			}
		}
		sis := tx.Bucket([]byte(colSistema))
		if sis.Get([]byte(claveCreada)) == nil {
			b, _ := json.Marshal(ahora())
			return sis.Put([]byte(claveCreada), b)
		}
		return nil
	})
}

func (bd *BD) Cerrar() error { return bd.db.Close() }

func (bd *BD) Obtener(col, clave string) ([]byte, error) {
	var v []byte
	err := bd.db.View(func(tx *bolt.Tx) error {
		dato := tx.Bucket([]byte(col)).Get([]byte(clave))
		if dato == nil {
			return errNoEncontrado
		}
		v = append([]byte(nil), dato...)
		return nil
	})
	return v, err
}

func (bd *BD) Guardar(col, clave string, valor []byte) error {
	return bd.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(col)).Put([]byte(clave), valor)
	})
}

func (bd *BD) GuardarJSON(col, clave string, valor any) error {
	b, err := json.Marshal(valor)
	if err != nil {
		return err
	}
	return bd.Guardar(col, clave, b)
}

func (bd *BD) Borrar(col, clave string) error {
	return bd.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(col))
		if b.Get([]byte(clave)) == nil {
			return errNoEncontrado
		}
		return b.Delete([]byte(clave))
	})
}

// Documento: clave y contenido de un documento (para la administración de la BD).
type Documento struct {
	Clave string          `json:"clave"`
	Valor json.RawMessage `json:"valor"`
}

func (bd *BD) ListarDocumentos(col string) ([]Documento, error) {
	lista := []Documento{}
	err := bd.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(col))
		if b == nil {
			return errNoEncontrado
		}
		return b.ForEach(func(k, v []byte) error {
			valor := json.RawMessage(append([]byte(nil), v...))
			if !json.Valid(valor) {
				valor, _ = json.Marshal(string(v))
			}
			lista = append(lista, Documento{Clave: string(k), Valor: valor})
			return nil
		})
	})
	return lista, err
}

func (bd *BD) Contar(col string) int {
	n := 0
	bd.db.View(func(tx *bolt.Tx) error {
		if b := tx.Bucket([]byte(col)); b != nil {
			n = b.Stats().KeyN
		}
		return nil
	})
	return n
}

func (bd *BD) CreadaEn() string {
	var s string
	if v, err := bd.Obtener(colSistema, claveCreada); err == nil {
		json.Unmarshal(v, &s)
	}
	return s
}

// Siguiente incrementa y devuelve un contador persistente (p. ej. el correlativo anual de procesos).
func (bd *BD) Siguiente(contador string) (int, error) {
	n := 0
	err := bd.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(colSistema))
		clave := []byte("contador:" + contador)
		if v := b.Get(clave); v != nil {
			json.Unmarshal(v, &n)
		}
		n++
		v, _ := json.Marshal(n)
		return b.Put(clave, v)
	})
	return n, err
}

// Vaciar elimina por completo las colecciones indicadas.
func (bd *BD) Vaciar(cols []string) error {
	err := bd.db.Update(func(tx *bolt.Tx) error {
		for _, c := range cols {
			if err := tx.DeleteBucket([]byte(c)); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return bd.prepararColecciones()
}

// Respaldo devuelve todas las colecciones con sus documentos.
func (bd *BD) Respaldo() (map[string]map[string]json.RawMessage, error) {
	salida := map[string]map[string]json.RawMessage{}
	err := bd.db.View(func(tx *bolt.Tx) error {
		for _, c := range colecciones {
			docs := map[string]json.RawMessage{}
			tx.Bucket([]byte(c)).ForEach(func(k, v []byte) error {
				docs[string(k)] = append(json.RawMessage(nil), v...)
				return nil
			})
			salida[c] = docs
		}
		return nil
	})
	return salida, err
}

// Restaurar reemplaza toda la base de datos con el contenido de un respaldo.
func (bd *BD) Restaurar(datos map[string]map[string]json.RawMessage) error {
	for c := range datos {
		if !coleccionValida(c) {
			return fmt.Errorf("colección desconocida: %s", c)
		}
	}
	return bd.db.Update(func(tx *bolt.Tx) error {
		for _, c := range colecciones {
			if err := tx.DeleteBucket([]byte(c)); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
				return err
			}
			b, err := tx.CreateBucket([]byte(c))
			if err != nil {
				return err
			}
			claves := make([]string, 0, len(datos[c]))
			for k := range datos[c] {
				claves = append(claves, k)
			}
			sort.Strings(claves)
			for _, k := range claves {
				if err := b.Put([]byte(k), datos[c][k]); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func coleccionValida(c string) bool {
	for _, x := range colecciones {
		if x == c {
			return true
		}
	}
	return false
}

// ------------------------------------------------- acceso tipado genérico

func listar[T any](bd *BD, col string) ([]T, error) {
	lista := []T{}
	err := bd.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(col)).ForEach(func(_, v []byte) error {
			var x T
			if err := json.Unmarshal(v, &x); err != nil {
				return nil // documento editado a mano con otra forma: se ignora
			}
			lista = append(lista, x)
			return nil
		})
	})
	return lista, err
}

func obtener[T any](bd *BD, col, clave string) (T, error) {
	var x T
	b, err := bd.Obtener(col, clave)
	if err != nil {
		return x, err
	}
	err = json.Unmarshal(b, &x)
	return x, err
}

func ahora() string { return time.Now().Format(time.RFC3339) }
