package sgdpruebas

// API REST v1 (/sgd-simulado/api/v1/...) para que otros sistemas usen el SGD de
// pruebas sin navegador. Cada petición ejecuta el mismo núcleo de reglas que las
// páginas (nucleo.js) con goja, sobre el estado guardado, dentro de una
// transacción de la base: las respuestas y los rechazos (RN-xx) son idénticos a
// los de la interfaz, y las escrituras de la API y de las páginas se ordenan por
// la versión del estado.
//
// Autenticación: HTTP Basic con un usuario de prueba y la clave común (RN-01).

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/dop251/goja"
	bolt "go.etcd.io/bbolt"
)

// Funciones del navegador que el núcleo usa y goja no trae.
const polyfills = `
var TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) { return { length: unescape(encodeURIComponent(s)).length }; };
`

// Despachador: recibe __entrada y __estado (JSON), ejecuta la operación y devuelve
// JSON con el resultado y, si cambió, el estado nuevo.
const despachador = `
(function () {
  var entrada = JSON.parse(__entrada);
  var inicial = __estado ? JSON.parse(__estado) : null;
  var guardado = null;
  var e = SGD.crear({ almacen: { leer: function () { return inicial; }, escribir: function (x) { guardado = x; } } });
  if (!inicial || inicial.version !== 2 || !Object.keys(inicial.tramites || {}).length) e.cargarEscenarios(SGD_ESCENARIOS);
  var d = entrada.datos || {}, id = entrada.id, u = entrada.usuario;
  function error(codigo, mensaje) { var x = new SGD.SGDError(codigo, mensaje); throw x; }
  var publicas = { info: true, catalogos: true };
  var operaciones = {
    info: function () { return { version: SGD.VERSION, reglas: SGD.REGLAS, acciones: SGD.ACCIONES, perfiles: SGD.PERFILES, contratoSgdReal: SGD.CONTRATO_REST }; },
    catalogos: function () { return { areas: SGD.CATALOGOS.areas, tipos: SGD.CATALOGOS.tipos, origenes: SGD.CATALOGOS.origenes, estados: SGD.CATALOGOS.estados, usuarios: e.usuarios(), limites: SGD.LIMITES }; },
    sesion: function () { return e.usuario(u); },
    bandeja: function () { return e.bandeja(u, d, d.pagina); },
    buscar: function () { return e.buscar(u, d, d.pagina); },
    resumen: function () { return e.resumen(u); },
    bitacora: function () { return e.bitacora(); },
    escenarios: function () { return SGD_ESCENARIOS.map(function (s) { return { id: s.id, numero: s.numero, etiquetas: s.etiquetas, descripcion: s.descripcion, esperado: s.esperado }; }); },
    detalle: function () { var t = e.detalle(id, u); if (!t) error('RN-00', 'No existe el trámite con ID interno ' + id + '.'); return t; },
    porNumero: function () { var t = e.porNumero(entrada.numero); if (!t) error('RN-00', 'No existe el trámite ' + entrada.numero + '.'); return e.detalleSinEfectos(t.id, u); },
    registrar: function () {
      // Todo o nada: registro + documento principal + derivación.
      var copia = e.exportar();
      try {
        var t = e.registrar(d, u);
        if (d.documento) e.adjuntar(t.id, d.documento, u);
        if (d.derivar) e.derivar(t.id, d.derivar, u);
        return e.detalleSinEfectos(t.id, u);
      } catch (x) { copia.bitacora = e.bitacora(); e.importar(copia); throw x; }
    },
    derivar: function () { e.derivar(id, d, u); return e.detalleSinEfectos(id, u); },
    recibir: function () { e.recibir(id, u); return e.detalleSinEfectos(id, u); },
    iniciar: function () { e.iniciar(id, d, u); return e.detalleSinEfectos(id, u); },
    observar: function () { e.observar(id, d, u); return e.detalleSinEfectos(id, u); },
    atender: function () { e.atender(id, d, u); return e.detalleSinEfectos(id, u); },
    archivar: function () { e.archivar(id, d, u); return e.detalleSinEfectos(id, u); },
    desarchivar: function () { e.desarchivar(id, d, u); return e.detalleSinEfectos(id, u); },
    anular: function () { e.anular(id, d, u); return e.detalleSinEfectos(id, u); },
    adjuntar: function () { e.adjuntar(id, d, u); return e.detalleSinEfectos(id, u); },
    asociar: function () { e.asociar(id, d.numero, u); return e.detalleSinEfectos(id, u); },
    confidencial: function () { e.marcarConfidencial(id, d.valor, u); return e.detalleSinEfectos(id, u); },
    adjunto: function () {
      var t = e.detalleSinEfectos(id, u);
      if (!t) error('RN-00', 'No existe el trámite con ID interno ' + id + '.');
      var a = t.adjuntos[entrada.indice];
      if (!a) error('RN-00', 'El trámite no tiene el adjunto ' + entrada.indice + '.');
      return a;
    },
    configurar: function () { e.configurar(d); return e.opciones(); },
    reiniciar: function () { e.cargarEscenarios(SGD_ESCENARIOS); return { ok: true }; }
  };
  try {
    if (!operaciones[entrada.operacion]) error('RN-00', 'Operación desconocida.');
    if (!publicas[entrada.operacion]) {
      var x = e.usuario(u);
      if (!x || entrada.clave !== SGD.CLAVE_PRUEBA) error('RN-01', 'Usuario o contraseña incorrectos.');
      if (!x.activo) error('RN-01', 'El usuario está inactivo.');
    }
    var r = operaciones[entrada.operacion]();
    return JSON.stringify({ ok: true, resultado: r === undefined ? null : r, estado: guardado });
  } catch (x) {
    return JSON.stringify({ ok: false, codigo: x.codigo || null, mensaje: String(x.message || x), estado: guardado });
  }
})()
`

type motor struct {
	programas []*goja.Program
	version   string
}

func nuevoMotor(web fs.FS) *motor {
	m := &motor{}
	for _, f := range []struct{ nombre, codigo string }{{"polyfills.js", polyfills}, {"nucleo.js", ""}, {"escenarios.js", ""}, {"despachador.js", despachador}} {
		codigo := f.codigo
		if codigo == "" {
			b, err := fs.ReadFile(web, f.nombre)
			if err != nil {
				panic("sgd-simulado/" + f.nombre + ": " + err.Error())
			}
			codigo = string(b)
		}
		p, err := goja.Compile(f.nombre, codigo, true)
		if err != nil {
			panic("sgd-simulado/" + f.nombre + ": " + err.Error())
		}
		m.programas = append(m.programas, p)
	}
	vm := goja.New()
	for _, p := range m.programas[:2] {
		vm.RunProgram(p)
	}
	m.version = vm.Get("SGD").ToObject(vm).Get("VERSION").String()
	return m
}

type entrada struct {
	Operacion string         `json:"operacion"`
	Usuario   string         `json:"usuario,omitempty"`
	Clave     string         `json:"clave,omitempty"`
	ID        int            `json:"id,omitempty"`
	Numero    string         `json:"numero,omitempty"`
	Indice    int            `json:"indice"`
	Datos     map[string]any `json:"datos,omitempty"`
}

type salida struct {
	OK        bool            `json:"ok"`
	Resultado json.RawMessage `json:"resultado"`
	Codigo    *string         `json:"codigo"`
	Mensaje   string          `json:"mensaje"`
	Estado    json.RawMessage `json:"estado"`
}

// ejecutar corre una operación sobre el estado actual; si el núcleo lo cambió (también
// al rechazar, por la bitácora), lo guarda con versión nueva en la misma transacción.
// antes (opcional) corre dentro de la transacción si la operación tuvo éxito.
func (s *SGD) ejecutar(e entrada, antes func(tx *bolt.Tx) error) (salida, error) {
	db, err := s.abrir()
	if err != nil {
		return salida{}, err
	}
	var res salida
	err = db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketEstado)
		estado := ""
		if v := b.Get([]byte("actual")); v != nil {
			estado = string(v)
		}
		ent, _ := json.Marshal(e)
		vm := goja.New()
		vm.Set("__entrada", string(ent))
		vm.Set("__estado", estado)
		var v goja.Value
		for _, p := range s.motor.programas {
			if v, err = vm.RunProgram(p); err != nil {
				return fmt.Errorf("núcleo: %w", err)
			}
		}
		if err := json.Unmarshal([]byte(v.String()), &res); err != nil {
			return err
		}
		if res.OK && antes != nil {
			if err := antes(tx); err != nil {
				return err
			}
		}
		if len(res.Estado) > 0 && string(res.Estado) != "null" {
			version, _ := strconv.Atoi(string(b.Get([]byte("version"))))
			if err := b.Put([]byte("actual"), res.Estado); err != nil {
				return err
			}
			return b.Put([]byte("version"), []byte(strconv.Itoa(version+1)))
		}
		return nil
	})
	return res, err
}

var rutaV1 = regexp.MustCompile(`^tramites/(\d{6})(?:/([a-z]+))?(?:/(\d+))?$`)

// Operaciones que se piden con POST /tramites/{id}/{accion}.
var accionesV1 = map[string]bool{"derivar": true, "recibir": true, "iniciar": true, "observar": true, "atender": true, "archivar": true, "desarchivar": true, "anular": true, "adjuntar": true, "asociar": true, "confidencial": true}

func (s *SGD) manejarV1(w http.ResponseWriter, r *http.Request, ruta string) {
	// CORS abierto: la API es para que otros sistemas (también páginas web) la prueben.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	usuario, clave, _ := r.BasicAuth()
	e := entrada{Usuario: strings.ToLower(usuario), Clave: clave, Datos: map[string]any{}}
	q := r.URL.Query()
	consulta := func() {
		for k := range q {
			v := q.Get(k)
			switch {
			case v == "1" || v == "true":
				e.Datos[k] = true
			default:
				e.Datos[k] = v
			}
		}
	}
	leerCuerpo := func() bool {
		if err := json.NewDecoder(io.LimitReader(r.Body, maxEstado)).Decode(&e.Datos); err != nil && !errors.Is(err, io.EOF) {
			rechazar(w, http.StatusBadRequest, "El cuerpo debe ser JSON.")
			return false
		}
		if e.Datos == nil {
			e.Datos = map[string]any{}
		}
		return true
	}
	get, post := r.Method == http.MethodGet, r.Method == http.MethodPost
	var antes func(tx *bolt.Tx) error
	m := rutaV1.FindStringSubmatch(ruta)
	switch {
	case ruta == "" && get:
		e.Operacion = "info"
	case ruta == "catalogos" && get:
		e.Operacion = "catalogos"
	case ruta == "sesion" && get:
		e.Operacion = "sesion"
	case ruta == "escenarios" && get:
		e.Operacion = "escenarios"
	case ruta == "bandeja" && get:
		e.Operacion = "bandeja"
		consulta()
	case ruta == "resumen" && get:
		e.Operacion = "resumen"
	case ruta == "bitacora" && get:
		e.Operacion = "bitacora"
	case ruta == "tramites" && get:
		e.Operacion = "buscar"
		consulta()
	case ruta == "tramites" && post:
		e.Operacion = "registrar"
		if !leerCuerpo() {
			return
		}
		if doc, ok := e.Datos["documento"].(map[string]any); ok {
			if antes = s.prepararArchivo(w, doc); antes == nil {
				return
			}
		}
	case strings.HasPrefix(ruta, "tramites/numero/") && get:
		e.Operacion = "porNumero"
		e.Numero = strings.TrimPrefix(ruta, "tramites/numero/")
	case ruta == "opciones" && post:
		e.Operacion = "configurar"
		if !leerCuerpo() {
			return
		}
	case ruta == "reiniciar" && post:
		e.Operacion = "reiniciar"
	case m != nil && m[2] == "" && get:
		e.Operacion = "detalle"
		e.ID, _ = strconv.Atoi(m[1])
	case m != nil && m[2] == "adjuntos" && m[3] != "" && get:
		e.Operacion = "adjunto"
		e.ID, _ = strconv.Atoi(m[1])
		e.Indice, _ = strconv.Atoi(m[3])
	case m != nil && accionesV1[m[2]] && m[3] == "" && post:
		e.Operacion = m[2]
		e.ID, _ = strconv.Atoi(m[1])
		if !leerCuerpo() {
			return
		}
		if m[2] == "adjuntar" {
			if antes = s.prepararArchivo(w, e.Datos); antes == nil {
				return
			}
		}
	default:
		rechazar(w, http.StatusNotFound, "Ruta o método no válido. GET "+Prefijo+"api/v1 lista las operaciones.")
		return
	}
	res, err := s.ejecutar(e, antes)
	if err != nil {
		rechazar(w, http.StatusInternalServerError, "Error interno: "+err.Error())
		return
	}
	if e.Operacion == "reiniciar" && res.OK {
		s.borrarArchivos()
	}
	if !res.OK {
		codigo := ""
		if res.Codigo != nil {
			codigo = *res.Codigo
		}
		estado := http.StatusUnprocessableEntity
		switch codigo {
		case "RN-01":
			estado = http.StatusUnauthorized
			w.Header().Set("WWW-Authenticate", `Basic realm="SGD de pruebas"`)
		case "RN-02", "RN-03", "RN-16":
			estado = http.StatusForbidden
		case "RN-00":
			estado = http.StatusNotFound
		}
		responder(w, estado, map[string]any{"codigo": codigo, "mensaje": res.Mensaje})
		return
	}
	if e.Operacion == "adjunto" && q.Get("contenido") != "" {
		s.enviarAdjunto(w, res.Resultado)
		return
	}
	estado := http.StatusOK
	if e.Operacion == "registrar" {
		estado = http.StatusCreated
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(estado)
	w.Write(res.Resultado)
}

// prepararArchivo convierte {nombre, contenidoBase64} en {nombre, bytes, archivoId} y
// devuelve la función que guarda el archivo dentro de la transacción si la regla lo
// acepta. Un documento con «texto» no necesita archivo. Devuelve nil si respondió con error.
func (s *SGD) prepararArchivo(w http.ResponseWriter, doc map[string]any) func(tx *bolt.Tx) error {
	contenido, ok := doc["contenidoBase64"].(string)
	if !ok {
		return func(*bolt.Tx) error { return nil }
	}
	nombre, _ := doc["nombre"].(string)
	tipo, permitido := tiposArchivo[strings.ToLower(filepath.Ext(nombre))]
	datos, err := base64.StdEncoding.DecodeString(contenido)
	switch {
	case !permitido:
		responder(w, http.StatusUnprocessableEntity, map[string]any{"codigo": "RN-14", "mensaje": "Extensión no permitida."})
		return nil
	case err != nil:
		rechazar(w, http.StatusBadRequest, "contenidoBase64 no es Base64 válido.")
		return nil
	}
	id := nuevoID()
	delete(doc, "contenidoBase64")
	doc["bytes"] = len(datos)
	doc["archivoId"] = id
	return func(tx *bolt.Tx) error {
		meta, _ := json.Marshal(metaArchivo{Nombre: nombre, Tipo: tipo, Bytes: len(datos), Fecha: ahora()})
		if err := tx.Bucket(bucketArchivos).Put([]byte(id), datos); err != nil {
			return err
		}
		return tx.Bucket(bucketMeta).Put([]byte(id), meta)
	}
}

// enviarAdjunto responde con el contenido de un adjunto (texto, data: URL o archivo guardado).
func (s *SGD) enviarAdjunto(w http.ResponseWriter, crudo json.RawMessage) {
	var a struct {
		Nombre    string  `json:"nombre"`
		Tipo      string  `json:"tipo"`
		Texto     *string `json:"texto"`
		Datos     string  `json:"datos"`
		ArchivoID string  `json:"archivoId"`
	}
	json.Unmarshal(crudo, &a)
	var datos []byte
	switch {
	case a.Texto != nil:
		datos = []byte(*a.Texto)
	case a.Datos != "":
		if i := strings.Index(a.Datos, ";base64,"); i >= 0 {
			datos, _ = base64.StdEncoding.DecodeString(a.Datos[i+8:])
		}
	case a.ArchivoID != "":
		datos, _ = s.leerArchivo(a.ArchivoID)
	}
	if datos == nil {
		rechazar(w, http.StatusNotFound, "El contenido del adjunto no está disponible.")
		return
	}
	tipo := tiposArchivo[strings.ToLower(filepath.Ext(a.Nombre))]
	if tipo == "" {
		tipo = "application/octet-stream"
	}
	w.Header().Set("Content-Type", tipo)
	w.Header().Set("Content-Disposition", `inline; filename*=UTF-8''`+urlEscape(a.Nombre))
	w.Write(datos)
}
