package main

// Base de datos de prueba: bbolt, un almacén NoSQL clave-valor embebido.
// Se crea automáticamente (un único archivo) la primera vez que se inicia
// LEGAL-Prueba; no requiere instalar ningún motor de base de datos.

import (
	"encoding/json"
	"errors"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	colPortal    = "portal"            // documento completo del portal (clave "datos")
	colTramites  = "tramites"          // trámites SGD indexados por el Conector (clave: id)
	colProcesos  = "procesos_conector" // procesos generados desde el Conector (clave: código)
	colMeta      = "meta"
	claveDatos   = "datos"
	claveCreada  = "creada_en"
)

var colecciones = []string{colPortal, colTramites, colProcesos, colMeta}

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
		meta := tx.Bucket([]byte(colMeta))
		if meta.Get([]byte(claveCreada)) == nil {
			return meta.Put([]byte(claveCreada), []byte(time.Now().Format(time.RFC3339)))
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

// Listar devuelve los documentos de una colección como JSON sin procesar.
func (bd *BD) Listar(col string) ([]json.RawMessage, error) {
	var lista []json.RawMessage
	err := bd.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(col)).ForEach(func(_, v []byte) error {
			lista = append(lista, append(json.RawMessage(nil), v...))
			return nil
		})
	})
	return lista, err
}

func (bd *BD) Contar(col string) int {
	n := 0
	bd.db.View(func(tx *bolt.Tx) error {
		n = tx.Bucket([]byte(col)).Stats().KeyN
		return nil
	})
	return n
}

func (bd *BD) CreadaEn() string {
	v, _ := bd.Obtener(colMeta, claveCreada)
	return string(v)
}

// Reiniciar elimina todos los documentos y deja la base de datos vacía.
func (bd *BD) Reiniciar() error {
	err := bd.db.Update(func(tx *bolt.Tx) error {
		for _, c := range colecciones {
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
