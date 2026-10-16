package main

// Modelo de datos de LEGAL. Cada tipo se guarda como un documento JSON en su
// colección de la base de datos NoSQL (bbolt).

const (
	RolAdmin       = "admin"
	RolGerente     = "gerente"
	RolProfesional = "profesional"
	RolAsistente   = "asistente"

	ProcesoActivo     = "Activo"
	ProcesoSuspendido = "Suspendido"
	ProcesoFinalizado = "Finalizado"

	TareaPendiente  = "Pendiente" // «Por hacer» en el tablero
	TareaEnProceso  = "En proceso"
	TareaEnRevision = "En revisión"
	TareaFinalizada = "Finalizada"

	PlantillaPendiente = "pendiente" // enviada a aprobación
	PlantillaAprobada  = "aprobada"
	PlantillaObservada = "observada"

	DiasHabiles    = "habiles"
	DiasCalendario = "calendario"

	DesdeInicio     = "inicio"     // el plazo corre desde el inicio del proceso
	DesdeAntecesora = "antecesora" // el plazo corre desde que concluye la tarea antecesora
)

var rolesValidos = map[string]string{
	RolAdmin:       "Administrador",
	RolGerente:     "Gerente",
	RolProfesional: "Profesional",
	RolAsistente:   "Asistente administrativo",
}

type Usuario struct {
	ID               string `json:"id"`
	Usuario          string `json:"usuario"`
	Nombre           string `json:"nombre"`
	Rol              string `json:"rol"`
	Cargo            string `json:"cargo,omitempty"`
	Correo           string `json:"correo,omitempty"`
	Activo           bool   `json:"activo"`
	DebeCambiarClave bool   `json:"debeCambiarClave,omitempty"`
	ClaveHash        string `json:"claveHash,omitempty"`
	CreadoEn         string `json:"creadoEn"`
	UltimoIngreso    string `json:"ultimoIngreso,omitempty"`
}

// Publico devuelve el usuario sin la huella de la contraseña.
func (u Usuario) Publico() Usuario {
	u.ClaveHash = ""
	return u
}

type Sesion struct {
	Token     string `json:"token"`
	UsuarioID string `json:"usuarioId"`
	CreadaEn  string `json:"creadaEn"`
	ExpiraEn  string `json:"expiraEn"`
	Origen    string `json:"origen"` // portal | extension
}

// ------------------------------------------------------------- taxonomía

// Etapa: tarea tipo de una vía procedimental (base normativa) o de una plantilla.
type Etapa struct {
	Nombre      string   `json:"nombre"`
	PlazoDias   *int     `json:"plazoDias"` // nil: el plazo se define conforme avanza el proceso
	TipoDias    string   `json:"tipoDias,omitempty"`
	Desde       string   `json:"desde,omitempty"`
	Antecesora  *int     `json:"antecesora,omitempty"` // índice de la tarea antecesora; nil: la anterior
	Referencia  string   `json:"referencia,omitempty"`
	Descripcion string   `json:"descripcion,omitempty"`
	Checklist   []string `json:"checklist,omitempty"`
}

type Via struct {
	Codigo      string  `json:"codigo"`
	Nombre      string  `json:"nombre"`
	BaseLegal   string  `json:"baseLegal,omitempty"`
	Etapas      []Etapa `json:"etapas"`
	Desactivada bool    `json:"desactivada,omitempty"`
}

type Categoria struct {
	Codigo    string `json:"codigo"`
	Nombre    string `json:"nombre"`
	BaseLegal string `json:"baseLegal,omitempty"`
	Vias      []Via  `json:"vias"`
}

type Taxonomia struct {
	Categorias    []Categoria `json:"categorias"`
	ActualizadaEn string      `json:"actualizadaEn,omitempty"`
}

func (t Taxonomia) buscar(categoria, via string) (*Categoria, *Via) {
	for i := range t.Categorias {
		c := &t.Categorias[i]
		if c.Codigo != categoria {
			continue
		}
		for j := range c.Vias {
			if c.Vias[j].Codigo == via {
				return c, &c.Vias[j]
			}
		}
		return c, nil
	}
	return nil, nil
}

// ----------------------------------------------------------- plantillas

type Plantilla struct {
	ID            string  `json:"id"`
	ProfesionalID string  `json:"profesionalId"`
	Nombre        string  `json:"nombre"`
	Categoria     string  `json:"categoria"`
	Via           string  `json:"via"`
	Tareas        []Etapa `json:"tareas"` // versión en edición (la última enviada)
	// Aprobación: solo la versión aprobada genera ciclos de procesos.
	Estado          string  `json:"estado"`
	TareasAprobadas []Etapa `json:"tareasAprobadas,omitempty"`
	NombreAprobado  string  `json:"nombreAprobado,omitempty"`
	AprobadaPor     string  `json:"aprobadaPor,omitempty"`
	AprobadaEn      string  `json:"aprobadaEn,omitempty"`
	Observacion     string  `json:"observacion,omitempty"`
	Version         int     `json:"version"`
	CreadaEn        string  `json:"creadaEn"`
	ActualizadaEn   string  `json:"actualizadaEn"`
}

func (p Plantilla) Aprobada() bool { return len(p.TareasAprobadas) > 0 }

// --------------------------------------------------- procesos y tareas

type Proceso struct {
	ID                 string `json:"id"`
	Codigo             string `json:"codigo"`
	Titulo             string `json:"titulo"`
	Categoria          string `json:"categoria"`
	Via                string `json:"via"`
	ProfesionalID      string `json:"profesionalId"`
	Estado             string `json:"estado"`
	FechaInicio        string `json:"fechaInicio"`
	FechaFin           string `json:"fechaFin,omitempty"`
	Origen             string `json:"origen"` // SGD | Portal
	PlantillaID        string `json:"plantillaId,omitempty"`
	PlantillaNombre    string `json:"plantillaNombre,omitempty"`
	CicloBase          bool   `json:"cicloBase,omitempty"` // se generó con las etapas normativas base (sin plantilla del profesional)
	ExpedienteJudicial string `json:"expedienteJudicial,omitempty"`
	Organo             string `json:"organo,omitempty"`
	Contraparte        string `json:"contraparte,omitempty"`
	Observaciones      string `json:"observaciones,omitempty"`
	CreadoPor          string `json:"creadoPor"`
	CreadoEn           string `json:"creadoEn"`
	ActualizadoEn      string `json:"actualizadoEn"`
}

type Evento struct {
	Fecha   string `json:"fecha"`
	Usuario string `json:"usuario"`
	Texto   string `json:"texto"`
}

type Tarea struct {
	ID               string   `json:"id"`
	ProcesoID        string   `json:"procesoId"`
	Orden            int      `json:"orden"`
	Nombre           string   `json:"nombre"`
	Descripcion      string   `json:"descripcion,omitempty"`
	Estado           string   `json:"estado"`
	PlazoDias        *int     `json:"plazoDias"`
	TipoDias         string   `json:"tipoDias"`
	Desde            string   `json:"desde"`
	AntecesoraID     string   `json:"antecesoraId,omitempty"`
	FechaInicio      string   `json:"fechaInicio,omitempty"`
	FechaLimite      string   `json:"fechaLimite,omitempty"`
	FechaFin         string   `json:"fechaFin,omitempty"`
	PlazoDefinidoPor string   `json:"plazoDefinidoPor,omitempty"`
	PlazoDefinidoEn  string   `json:"plazoDefinidoEn,omitempty"`
	Referencia       string   `json:"referencia,omitempty"`
	Checklist        []Item   `json:"checklist,omitempty"`
	Notas            string   `json:"notas,omitempty"`
	Color            string   `json:"color,omitempty"`
	Comentarios      []Evento `json:"comentarios,omitempty"`
	Historial        []Evento `json:"historial,omitempty"`
	ActualizadaEn    string   `json:"actualizadaEn"`
}

type Item struct {
	Texto string `json:"texto"`
	Hecho bool   `json:"hecho"`
}

// TramiteSGD: documento del SGD indexado a un proceso desde el Conector.
type TramiteSGD struct {
	ID              string `json:"id"`
	ProcesoID       string `json:"procesoId"`
	TareaID         string `json:"tareaId,omitempty"`
	Accion          string `json:"accion"` // nuevo | existente
	NroTramite      string `json:"nroTramite"`
	IDInterno       string `json:"idInterno,omitempty"`
	AsuntoSGD       string `json:"asuntoSgd"`
	Detalle         string `json:"detalle,omitempty"` // asunto/detalle propio de la indexación
	FechaIngresoSGD string `json:"fechaIngresoSgd,omitempty"`
	EnlaceSGD       string `json:"enlaceSgd"`
	SGD             string `json:"sgd,omitempty"` // dominio del SGD de origen
	TipoDocumento   string `json:"tipoDocumento,omitempty"`
	NroDocumento    string `json:"nroDocumento,omitempty"`
	Remitente       string `json:"remitente,omitempty"`
	Dependencia     string `json:"dependencia,omitempty"`
	EstadoSGD       string `json:"estadoSgd,omitempty"`
	IndexadoPor     string `json:"indexadoPor"`
	IndexadoEn      string `json:"indexadoEn"`
}

type Solicitud struct {
	ID         string `json:"id"`
	Tipo       string `json:"tipo"` // definir-plazo
	TareaID    string `json:"tareaId"`
	ProcesoID  string `json:"procesoId"`
	De         string `json:"de"`
	Para       string `json:"para"`
	Mensaje    string `json:"mensaje,omitempty"`
	Estado     string `json:"estado"` // pendiente | atendida
	CreadaEn   string `json:"creadaEn"`
	AtendidaEn string `json:"atendidaEn,omitempty"`
}

type Configuracion struct {
	DiasAlertaPorVencer int      `json:"diasAlertaPorVencer"` // días hábiles
	DiasSinMovimiento   int      `json:"diasSinMovimiento"`
	UmbralVencidasPct   int      `json:"umbralVencidasPct"`
	FeriadosAdicionales []string `json:"feriadosAdicionales"`
	NombreEntidad       string   `json:"nombreEntidad"`
}

func configuracionInicial() Configuracion {
	return Configuracion{DiasAlertaPorVencer: 3, DiasSinMovimiento: 30, UmbralVencidasPct: 20, FeriadosAdicionales: []string{}, NombreEntidad: "Gerencia de Asesoría Jurídica"}
}

type Auditoria struct {
	ID      string `json:"id"`
	Fecha   string `json:"fecha"`
	Usuario string `json:"usuario"`
	Accion  string `json:"accion"`
	Detalle string `json:"detalle"`
}
