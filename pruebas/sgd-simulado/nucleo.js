/*
 * SGD de pruebas · Núcleo (motor de reglas, sin DOM).
 *
 * Modelo, reglas de negocio (RN-xx), funciones y acciones de un Sistema de
 * Gestión Documental con la forma del SGD de SEDAPAR (docs/11). Sirve de banco
 * de pruebas para LEGAL y para cualquier software futuro que lea o integre un
 * SGD: las páginas del SGD simulado lo usan en el navegador y las pruebas
 * automáticas lo usan en Node (pruebas/sgd-simulado/pruebas/).
 *
 * Todo lo que aquí se describe es una especificación de PRUEBA: donde el SGD
 * real no está determinado (docs/11 §7.3) se elige un supuesto y se marca así.
 * Especificación completa: docs/14-sgd-de-pruebas.md.
 *
 * Uso:
 *   const sgd = SGD.crear({ almacen, reloj });   // almacen: { leer(), escribir(estado) }
 *   sgd.cargarEscenarios(SGD_ESCENARIOS);
 *   sgd.derivar(250101, { areaDestino: 'ÁREA DE LOGÍSTICA', plazoDias: 5, proveido: '…' }, 'usuario.prueba');
 * Cada acción valida sus reglas y, si alguna falla, lanza SGDError { codigo: 'RN-xx' }.
 */
(function (raiz, fabrica) {
  const SGD = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = SGD;
  else raiz.SGD = SGD;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION_ESQUEMA = 2;

  // ------------------------------------------------------------- catálogos

  const ESTADOS = ['REGISTRADO', 'DERIVADO', 'RECIBIDO', 'EN PROCESO', 'OBSERVADO', 'ATENDIDO', 'ARCHIVADO', 'ANULADO'];
  const ESTADOS_FINALES = ['ANULADO'];
  const ESTADOS_CERRADOS = ['ARCHIVADO', 'ANULADO'];

  /** Máquina de estados (RN-04): acción → estados de origen permitidos → estado resultante. */
  const ACCIONES = {
    derivar:      { desde: ['REGISTRADO', 'RECIBIDO', 'EN PROCESO', 'OBSERVADO', 'ATENDIDO'], hacia: 'DERIVADO', etiqueta: 'Derivar' },
    recibir:      { desde: ['DERIVADO'], hacia: 'RECIBIDO', etiqueta: 'Recibir' },
    iniciar:      { desde: ['RECIBIDO'], hacia: 'EN PROCESO', etiqueta: 'Iniciar atención' },
    observar:     { desde: ['RECIBIDO', 'EN PROCESO'], hacia: 'OBSERVADO', etiqueta: 'Observar y devolver' },
    atender:      { desde: ['EN PROCESO'], hacia: 'ATENDIDO', etiqueta: 'Atender' },
    archivar:     { desde: ['RECIBIDO', 'EN PROCESO', 'ATENDIDO', 'OBSERVADO'], hacia: 'ARCHIVADO', etiqueta: 'Archivar' },
    desarchivar:  { desde: ['ARCHIVADO'], hacia: 'EN PROCESO', etiqueta: 'Desarchivar' },
    anular:       { desde: ['REGISTRADO'], hacia: 'ANULADO', etiqueta: 'Anular' }
  };

  const AREAS = [
    'MESA DE PARTES',
    'TRÁMITE DOCUMENTARIO',
    'GERENCIA GENERAL',
    'GERENCIA DE ASESORÍA JURÍDICA',
    'GERENCIA COMERCIAL',
    'GERENCIA DE OPERACIONES',
    'ÁREA DE LOGÍSTICA',
    'ÓRGANO DE CONTROL INSTITUCIONAL',
    'ARCHIVO CENTRAL'
  ];

  const TIPOS_DOCUMENTO = ['CARTA', 'CÉDULA', 'INFORME', 'MEMORANDO', 'OFICIO', 'RECURSO', 'RESOLUCIÓN', 'SOLICITUD'];
  const ORIGENES = ['INTERNO', 'EXTERNO'];

  /** Perfiles y lo que puede hacer cada uno (RN-02). */
  const PERFILES = {
    MESA_PARTES: { descripcion: 'Registra trámites externos y deriva', acciones: ['registrar', 'derivar', 'recibir', 'adjuntar', 'asociar', 'anular'] },
    OPERADOR:    { descripcion: 'Atiende los trámites de su área', acciones: ['registrar', 'derivar', 'recibir', 'iniciar', 'observar', 'atender', 'adjuntar', 'asociar', 'anular'] },
    JEFE:        { descripcion: 'Operador con archivo, desarchivo y confidencialidad', acciones: ['registrar', 'derivar', 'recibir', 'iniciar', 'observar', 'atender', 'archivar', 'desarchivar', 'adjuntar', 'asociar', 'anular', 'confidencial'] },
    CONSULTA:    { descripcion: 'Solo lectura', acciones: [] }
  };

  /** Clave común de los usuarios de prueba (el SGD de pruebas no protege nada real). */
  const CLAVE_PRUEBA = 'prueba';
  const GAJ = 'GERENCIA DE ASESORÍA JURÍDICA';
  const u = (usuario, nombre, area, perfil, activo) => ({ usuario, nombre, area, perfil, activo: activo !== false });
  /** Usuarios ficticios: al menos uno por área, y todos los perfiles. */
  const USUARIOS = [
    u('usuario.prueba', 'USUARIO DE PRUEBA', GAJ, 'OPERADOR'),
    u('abogado.uno', 'ABOGADO FICTICIO UNO', GAJ, 'OPERADOR'),
    u('abogado.dos', 'ABOGADA FICTICIA DOS', GAJ, 'OPERADOR'),
    u('jefe.juridico', 'JEFE JURÍDICO FICTICIO', GAJ, 'JEFE'),
    u('mesa.partes', 'MESA DE PARTES FICTICIA', 'MESA DE PARTES', 'MESA_PARTES'),
    u('tramite.doc', 'TRÁMITE DOCUMENTARIO FICTICIO', 'TRÁMITE DOCUMENTARIO', 'OPERADOR'),
    u('gerente.general', 'GERENTE GENERAL FICTICIO', 'GERENCIA GENERAL', 'JEFE'),
    u('comercial', 'ANALISTA COMERCIAL FICTICIO', 'GERENCIA COMERCIAL', 'OPERADOR'),
    u('jefe.comercial', 'JEFE COMERCIAL FICTICIO', 'GERENCIA COMERCIAL', 'JEFE'),
    u('operaciones', 'INGENIERO FICTICIO', 'GERENCIA DE OPERACIONES', 'OPERADOR'),
    u('logistica', 'ANALISTA DE LOGÍSTICA FICTICIO', 'ÁREA DE LOGÍSTICA', 'OPERADOR'),
    u('jefe.logistica', 'JEFE DE LOGÍSTICA FICTICIO', 'ÁREA DE LOGÍSTICA', 'JEFE'),
    u('control', 'AUDITOR FICTICIO', 'ÓRGANO DE CONTROL INSTITUCIONAL', 'OPERADOR'),
    u('archivo', 'ARCHIVERO FICTICIO', 'ARCHIVO CENTRAL', 'JEFE'),
    u('consulta', 'CONSULTA FICTICIA', GAJ, 'CONSULTA'),
    u('inactivo', 'USUARIO DADO DE BAJA', GAJ, 'OPERADOR', false)
  ];

  const ADJUNTOS = { extensiones: ['txt', 'pdf', 'docx', 'xlsx', 'jpg', 'png'], maxBytes: 20 * 1024 * 1024, maxTexto: 200000 };
  const TIPOS_MIME = { txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', jpg: 'image/jpeg', png: 'image/png' };
  const PLAZO = { minDias: 1, maxDias: 30, porDefecto: 5, ambarDias: 2 };
  const LONGITUD = { asuntoMin: 5, asuntoMax: 1000, proveidoMax: 500, motivoMin: 5, motivoMax: 500 };
  const POR_PAGINA = 20;
  const ID_INICIAL = 250101;
  const ASUNTO_RESERVADO = 'TRÁMITE RESERVADO';

  /** Reglas de negocio. Cada SGDError lleva uno de estos códigos. */
  const REGLAS = [
    { codigo: 'RN-00', titulo: 'Existencia', descripcion: 'La acción se dirige a un trámite que existe (por ID interno o n.º).' },
    { codigo: 'RN-01', titulo: 'Sesión', descripcion: `Toda acción exige un usuario de prueba existente y activo (clave común «${CLAVE_PRUEBA}»).` },
    { codigo: 'RN-02', titulo: 'Perfil', descripcion: 'Cada perfil solo ejecuta sus acciones; CONSULTA es solo lectura.' },
    { codigo: 'RN-03', titulo: 'Área actual', descripcion: 'Solo el área que tiene el trámite (área actual) puede actuar sobre él.' },
    { codigo: 'RN-04', titulo: 'Estados', descripcion: 'Solo se permiten las transiciones de la máquina de estados; ANULADO es final.' },
    { codigo: 'RN-05', titulo: 'Asunto', descripcion: `Obligatorio, entre ${LONGITUD.asuntoMin} y ${LONGITUD.asuntoMax} caracteres.` },
    { codigo: 'RN-06', titulo: 'Catálogos', descripcion: 'Tipo de documento, origen y áreas deben existir en el catálogo.' },
    { codigo: 'RN-07', titulo: 'Numeración', descripcion: 'N.º AAAA - ##### - S: correlativo anual de 5 dígitos; S = 1 en expediente nuevo y S = máximo + 1 en un documento de un expediente existente (supuesto, docs/11 §3.1). El número no cambia nunca.' },
    { codigo: 'RN-08', titulo: 'ID interno', descripcion: 'Numérico de 6 dígitos, secuencial, distinto del n.º de trámite y nunca reutilizado.' },
    { codigo: 'RN-09', titulo: 'Derivación', descripcion: `Área destino del catálogo y distinta de la actual; usuario destino opcional, activo y de esa área; plazo de ${PLAZO.minDias} a ${PLAZO.maxDias} días hábiles; proveído obligatorio (máx. ${LONGITUD.proveidoMax}).` },
    { codigo: 'RN-10', titulo: 'Plazos', descripcion: `Días hábiles (lunes a viernes sin feriados nacionales). Semáforo: vencido = rojo, ≤ ${PLAZO.ambarDias} días = ámbar, resto = verde.` },
    { codigo: 'RN-11', titulo: 'Recepción', descripcion: 'Abrir el detalle NO registra «Fecha leído»; la registra la acción Recibir (configurable para probar la hipótesis R9 de docs/11).' },
    { codigo: 'RN-12', titulo: 'Archivo', descripcion: 'Archivar y desarchivar exigen perfil JEFE y motivo.' },
    { codigo: 'RN-13', titulo: 'Anulación', descripcion: 'Solo un trámite REGISTRADO (sin derivar), por el área que lo registró, con motivo.' },
    { codigo: 'RN-14', titulo: 'Adjuntos', descripcion: `Extensiones ${ADJUNTOS.extensiones.join(', ')}; máx. 20 MB (documentos redactados: ${ADJUNTOS.maxTexto} caracteres); nombre único por trámite; no en trámites cerrados.` },
    { codigo: 'RN-15', titulo: 'Asociación', descripcion: 'Ambos trámites existen, son distintos, no se duplica y la relación es simétrica.' },
    { codigo: 'RN-16', titulo: 'Confidencialidad', descripcion: `Solo un JEFE del área de origen o actual la cambia. Fuera de esas áreas el asunto se muestra como «${ASUNTO_RESERVADO}».` },
    { codigo: 'RN-17', titulo: 'Movimientos', descripcion: 'Cada acción agrega una fila inmutable; se muestran en orden descendente y la última fila es el registro inicial.' },
    { codigo: 'RN-18', titulo: 'Observación', descripcion: 'Devuelve el trámite al área anterior con motivo obligatorio.' },
    { codigo: 'RN-19', titulo: 'Bandeja', descripcion: `Muestra los trámites cuya área actual es la del usuario, sin cerrados salvo filtro, ${POR_PAGINA} por página, recientes primero.` },
    { codigo: 'RN-20', titulo: 'Seguimiento', descripcion: 'La búsqueda exige al menos un filtro (como el SGD real, que no lista nada antes de «Buscar»).' },
    { codigo: 'RN-21', titulo: 'Auditoría', descripcion: 'Toda acción, aceptada o rechazada, queda en la bitácora: quién, qué, cuándo y resultado.' }
  ];

  class SGDError extends Error {
    constructor(codigo, mensaje) {
      super(mensaje);
      this.name = 'SGDError';
      this.codigo = codigo;
    }
  }
  const fallar = (codigo, mensaje) => { throw new SGDError(codigo, mensaje); };

  // ------------------------------------------------------------ funciones puras

  const RE_TRAMITE = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;
  const RE_FECHA_SGD = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

  /** Forma canónica AAAA-#####-S (docs/11 §3.4) o null. */
  function normalizarNumero(texto) {
    const m = String(texto || '').replace(/[   ]/g, ' ').match(RE_TRAMITE);
    return m ? `${m[1]}-${m[2].padStart(5, '0')}-${parseInt(m[3], 10)}` : null;
  }

  /** Forma visible del SGD: «AAAA - ##### - S». */
  function formatearNumero(canonico, opciones) {
    const o = opciones || {};
    const [anio, serie, sub] = canonico.split('-');
    const sep = o.separador === undefined ? ' - ' : o.separador;
    return [anio, o.sinCeros ? String(parseInt(serie, 10)) : serie, sub].join(sep);
  }

  const dos = (n) => String(n).padStart(2, '0');
  /** Fecha local → «dd/mm/aaaa HH:mm:ss» (formato del SGD). */
  function formatearFecha(fecha) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
  }
  /** «dd/mm/aaaa HH:mm:ss» → Date local. */
  function leerFecha(texto) {
    const m = String(texto || '').match(RE_FECHA_SGD);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  }
  const claveDia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

  // Feriados nacionales del Perú (mismo criterio que servidor/fechas.go).
  const FERIADOS_FIJOS = ['01-01', '05-01', '06-07', '06-29', '07-23', '07-28', '07-29', '08-06', '08-30', '10-08', '11-01', '12-08', '12-09', '12-25'];
  function domingoDePascua(anio) {
    const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(anio, mes - 1, dia);
  }
  const cacheFeriados = {};
  function feriadosDe(anio) {
    if (!cacheFeriados[anio]) {
      const s = new Set(FERIADOS_FIJOS.map((f) => `${anio}-${f}`));
      const p = domingoDePascua(anio);
      for (const delta of [-3, -2]) s.add(claveDia(new Date(p.getFullYear(), p.getMonth(), p.getDate() + delta)));
      cacheFeriados[anio] = s;
    }
    return cacheFeriados[anio];
  }
  function esHabil(fecha) {
    const dia = fecha.getDay();
    return dia !== 0 && dia !== 6 && !feriadosDe(fecha.getFullYear()).has(claveDia(fecha));
  }
  /** Vencimiento de un plazo de n días hábiles contados desde el día siguiente (RN-10). Devuelve el fin de ese día. */
  function sumarDiasHabiles(desde, n) {
    const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate(), 23, 59, 59);
    let restantes = n;
    while (restantes > 0) {
      d.setDate(d.getDate() + 1);
      if (esHabil(d)) restantes--;
    }
    return d;
  }
  /** Días hábiles en el intervalo (a, b] (solo fechas). */
  function contarHabiles(a, b) {
    let n = 0;
    for (const d = new Date(a); d < b;) { d.setDate(d.getDate() + 1); if (esHabil(d)) n++; }
    return n;
  }
  /** Días hábiles que faltan hasta `limite` (0 = vence hoy; negativo si venció). */
  function diasHabilesRestantes(ahora, limite) {
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const fin = new Date(limite.getFullYear(), limite.getMonth(), limite.getDate());
    return ahora > limite ? -Math.max(1, contarHabiles(fin, hoy)) : contarHabiles(hoy, fin);
  }
  function semaforo(ahora, limite) {
    if (!limite) return null;
    const r = diasHabilesRestantes(ahora, limite);
    return r < 0 ? 'ROJO' : r <= PLAZO.ambarDias ? 'AMBAR' : 'VERDE';
  }
  const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const texto = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- instancia

  function estadoVacio() {
    return { version: VERSION_ESQUEMA, siguienteId: ID_INICIAL, correlativos: {}, tramites: {}, bitacora: [], opciones: { marcarLeidoAlAbrir: false } };
  }

  function crear(config) {
    const cfg = config || {};
    const reloj = cfg.reloj || (() => new Date());
    const almacen = cfg.almacen || null;
    let estado = (almacen && almacen.leer()) || null;
    if (!estado || estado.version !== VERSION_ESQUEMA) estado = estadoVacio();
    const usuarios = (cfg.usuarios || USUARIOS).slice();

    const guardar = () => { if (almacen) almacen.escribir(estado); };
    const ahora = () => reloj();

    function usuarioDe(nombre) {
      const clave = String(nombre || '').trim().toLowerCase();
      if (!clave) return null;
      return usuarios.find((x) => x.usuario === clave) || null;
    }
    function exigirUsuario(nombre) {
      const u = usuarioDe(nombre);
      if (!u) fallar('RN-01', 'Usuario desconocido o sin sesión.');
      if (!u.activo) fallar('RN-01', 'El usuario está inactivo.');
      return u;
    }
    /** Inicio de sesión: usuario de prueba activo y clave común. */
    function autenticar(nombre, clave) {
      const x = usuarioDe(nombre);
      if (!x || clave !== CLAVE_PRUEBA) { registrarBitacora(nombre, 'ingresar', null, 'RECHAZADO', 'RN-01: credenciales'); guardar(); fallar('RN-01', 'Usuario o contraseña incorrectos.'); }
      if (!x.activo) { registrarBitacora(nombre, 'ingresar', null, 'RECHAZADO', 'RN-01: inactivo'); guardar(); fallar('RN-01', 'El usuario está inactivo.'); }
      registrarBitacora(x.usuario, 'ingresar', null, 'OK');
      guardar();
      return copia(x);
    }
    function exigirPerfil(u, accion) {
      if (!PERFILES[u.perfil].acciones.includes(accion)) fallar('RN-02', `El perfil ${u.perfil} no puede ${accion}.`);
    }
    function exigirTramite(id) {
      const t = estado.tramites[String(id)];
      if (!t) fallar('RN-00', `No existe el trámite con ID interno ${id}.`);
      return t;
    }
    function porNumero(numero) {
      const c = normalizarNumero(numero);
      return c ? Object.values(estado.tramites).find((t) => t.numero === c) || null : null;
    }
    function exigirArea(area, campo) {
      if (!AREAS.includes(area)) fallar('RN-06', `${campo} «${area}» no existe en el catálogo de áreas.`);
    }
    function exigirMotivo(motivo, codigo) {
      const m = texto(motivo);
      if (m.length < LONGITUD.motivoMin || m.length > LONGITUD.motivoMax) fallar(codigo, `El motivo debe tener entre ${LONGITUD.motivoMin} y ${LONGITUD.motivoMax} caracteres.`);
      return m;
    }
    function exigirTransicion(t, accion) {
      if (ESTADOS_FINALES.includes(t.estado)) fallar('RN-04', `El trámite está ${t.estado}; no admite cambios.`);
      if (!ACCIONES[accion].desde.includes(t.estado)) fallar('RN-04', `No se puede ${ACCIONES[accion].etiqueta.toLowerCase()} un trámite ${t.estado}.`);
    }
    function exigirAreaActual(t, u) {
      if (t.areaActual !== u.area) fallar('RN-03', `El trámite está en ${t.areaActual}; su área es ${u.area}.`);
    }

    function registrarBitacora(usuario, accion, id, resultado, detalle) {
      estado.bitacora.unshift({ fecha: formatearFecha(ahora()), usuario: usuario || '—', accion, id: id == null ? null : Number(id), resultado, detalle: detalle || '' });
      if (estado.bitacora.length > 500) estado.bitacora.length = 500;
    }
    /** Envuelve una acción: valida, aplica, registra en bitácora (RN-21) y persiste. */
    function ejecutar(accion, id, usuario, fn) {
      try {
        const r = fn();
        registrarBitacora(usuario, accion, id != null ? id : r && r.id, 'OK');
        guardar();
        return r;
      } catch (e) {
        registrarBitacora(usuario, accion, id, 'RECHAZADO', e.codigo ? `${e.codigo}: ${e.message}` : e.message);
        guardar();
        throw e;
      }
    }
    function moverse(t, fila) {
      t.movimientos.push(Object.assign({ fecha: formatearFecha(ahora()), fechaLimite: null, fechaLeido: null, proveido: '' }, fila));
      t.estado = fila.estado;
      t.areaActual = fila.area;
      t.actualizado = formatearFecha(ahora());
    }
    const ultimaDerivacion = (t) => [...t.movimientos].reverse().find((m) => m.estado === 'DERIVADO') || null;

    // ------------------------------------------------------------ acciones

    function registrar(datos, usuario) {
      return ejecutar('registrar', null, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'registrar');
        const d = datos || {};
        const origen = d.origen || (u.perfil === 'MESA_PARTES' ? 'EXTERNO' : 'INTERNO');
        if (!ORIGENES.includes(origen)) fallar('RN-06', `Origen «${origen}» no válido.`);
        if (origen === 'EXTERNO' && u.perfil !== 'MESA_PARTES') fallar('RN-02', 'Solo Mesa de Partes registra trámites externos.');
        if (!TIPOS_DOCUMENTO.includes(d.tipo)) fallar('RN-06', `Tipo de documento «${d.tipo}» no válido.`);
        const asunto = texto(d.asunto);
        if (asunto.length < LONGITUD.asuntoMin || asunto.length > LONGITUD.asuntoMax) fallar('RN-05', `El asunto debe tener entre ${LONGITUD.asuntoMin} y ${LONGITUD.asuntoMax} caracteres.`);

        // RN-07 · numeración
        const anio = ahora().getFullYear();
        let serie, sub;
        if (d.expediente) {
          const m = String(d.expediente).match(/^(20\d{2})\s*-\s*(\d{1,5})$/);
          if (!m) fallar('RN-07', 'El expediente debe tener la forma AAAA-#####.');
          const pref = `${m[1]}-${m[2].padStart(5, '0')}-`;
          const existentes = Object.values(estado.tramites).filter((t) => t.numero.startsWith(pref));
          if (!existentes.length) fallar('RN-07', `No existe el expediente ${pref.slice(0, -1)}.`);
          serie = pref.slice(5, 10);
          sub = Math.max(...existentes.map((t) => parseInt(t.numero.split('-')[2], 10))) + 1;
          if (sub > 999) fallar('RN-07', 'El expediente alcanzó el máximo de documentos.');
          d.anioExpediente = m[1];
        } else {
          const ultimo = estado.correlativos[anio] || 0;
          if (ultimo >= 99999) fallar('RN-07', `Se agotó el correlativo de ${anio}.`);
          estado.correlativos[anio] = ultimo + 1;
          serie = String(ultimo + 1).padStart(5, '0');
          sub = 1;
        }
        const numero = `${d.anioExpediente || anio}-${serie}-${sub}`;
        // RN-08 · ID interno
        const id = estado.siguienteId++;
        if (id > 999999) fallar('RN-08', 'Se agotaron los ID internos.');

        const t = {
          id, numero, tipo: d.tipo, origen,
          areaOrigen: u.area, areaActual: u.area, estado: 'REGISTRADO',
          asunto, contenido: texto(d.contenido),
          solicitante: origen === 'EXTERNO' ? Object.assign({ nombre: 'SOLICITANTE FICTICIO', direccion: '—', email: '—', celular: '—' }, d.solicitante || {}) : null,
          confidencial: Boolean(d.confidencial),
          asociados: [], adjuntos: [], movimientos: [], render: {},
          registrado: formatearFecha(ahora()), actualizado: formatearFecha(ahora()), registradoPor: u.usuario
        };
        moverse(t, { area: u.area, estado: 'REGISTRADO', usuario: u.nombre, proveido: 'Registro del trámite' });
        if (d.asociarA) {
          const otro = porNumero(d.asociarA);
          if (!otro) fallar('RN-15', `No existe el trámite ${d.asociarA}.`);
          t.asociados.push(otro.numero);
          otro.asociados.push(numero);
        }
        estado.tramites[id] = t;
        return copia(t);
      });
    }

    function derivar(id, datos, usuario) {
      return ejecutar('derivar', id, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'derivar');
        const t = exigirTramite(id);
        exigirTransicion(t, 'derivar');
        exigirAreaActual(t, u);
        const d = datos || {};
        exigirArea(d.areaDestino, 'El área destino');
        if (d.areaDestino === t.areaActual) fallar('RN-09', 'No se puede derivar a la misma área.');
        const plazo = d.plazoDias == null ? PLAZO.porDefecto : Number(d.plazoDias);
        if (!Number.isInteger(plazo) || plazo < PLAZO.minDias || plazo > PLAZO.maxDias) fallar('RN-09', `El plazo debe ser de ${PLAZO.minDias} a ${PLAZO.maxDias} días hábiles.`);
        const proveido = texto(d.proveido);
        if (!proveido || proveido.length > LONGITUD.proveidoMax) fallar('RN-09', `El proveído es obligatorio (máx. ${LONGITUD.proveidoMax} caracteres).`);
        let destino = null;
        if (d.usuarioDestino) {
          destino = usuarioDe(d.usuarioDestino);
          if (!destino || !destino.activo || destino.area !== d.areaDestino) fallar('RN-09', 'El usuario destino debe estar activo y pertenecer al área destino.');
        }
        moverse(t, { area: d.areaDestino, estado: 'DERIVADO', usuario: u.nombre, proveido, fechaLimite: formatearFecha(sumarDiasHabiles(ahora(), plazo)), desdeArea: u.area, desdeUsuario: u.usuario, paraUsuario: destino ? destino.usuario : null });
        t.asignadoA = destino ? destino.usuario : null;
        return copia(t);
      });
    }

    function recibir(id, usuario, opciones) {
      return ejecutar('recibir', id, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'recibir');
        const t = exigirTramite(id);
        exigirTransicion(t, 'recibir');
        exigirAreaActual(t, u);
        const der = ultimaDerivacion(t);
        if (der && !der.fechaLeido) der.fechaLeido = formatearFecha(ahora());
        t.asignadoA = u.usuario;
        moverse(t, { area: u.area, estado: 'RECIBIDO', usuario: u.nombre, proveido: (opciones && opciones.automatico) ? 'Recibido al abrir el detalle' : 'Recibido', fechaLimite: der ? der.fechaLimite : null });
        return copia(t);
      });
    }

    function accionSimple(accion, codigoMotivo, exigeMotivo) {
      return function (id, datos, usuario) {
        return ejecutar(accion, id, usuario, () => {
          const u = exigirUsuario(usuario);
          if ((accion === 'archivar' || accion === 'desarchivar') && u.perfil !== 'JEFE') fallar('RN-12', `Solo un JEFE puede ${accion}.`);
          exigirPerfil(u, accion);
          const t = exigirTramite(id);
          exigirTransicion(t, accion);
          exigirAreaActual(t, u);
          const motivo = exigeMotivo ? exigirMotivo(datos && datos.motivo, codigoMotivo) : texto(datos && (datos.motivo || datos.respuesta));
          const fila = { area: t.areaActual, estado: ACCIONES[accion].hacia, usuario: u.nombre, proveido: motivo || ACCIONES[accion].etiqueta };
          if (accion === 'observar') {
            const der = ultimaDerivacion(t);
            if (!der || !der.desdeArea) fallar('RN-18', 'No hay un área anterior a la cual devolver el trámite.');
            fila.area = der.desdeArea;
            fila.desdeArea = u.area;
            t.asignadoA = der.desdeUsuario || null;
          }
          if (accion === 'anular') {
            if (t.areaOrigen !== u.area) fallar('RN-13', 'Solo el área que registró el trámite puede anularlo.');
            if (t.movimientos.some((m) => m.estado === 'DERIVADO')) fallar('RN-13', 'Un trámite ya derivado no se puede anular.');
          }
          if (accion === 'iniciar' || accion === 'atender') {
            const der = ultimaDerivacion(t);
            fila.fechaLimite = der ? der.fechaLimite : null;
          }
          moverse(t, fila);
          return copia(t);
        });
      };
    }

    /**
     * Adjunta un documento (RN-14). `archivo`: { nombre, bytes, descripcion, publico, tipo,
     *   archivoId  (archivo guardado en el servidor del SGD de pruebas) |
     *   datos      (data: URL, modo local sin servidor) |
     *   texto      (documento redactado o de escenario: se guarda el texto) }.
     */
    function adjuntar(id, archivo, usuario) {
      return ejecutar('adjuntar', id, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'adjuntar');
        const t = exigirTramite(id);
        if (ESTADOS_CERRADOS.includes(t.estado)) fallar('RN-14', `No se adjunta a un trámite ${t.estado}.`);
        exigirAreaActual(t, u);
        const a = archivo || {};
        const nombre = texto(a.nombre).replace(/[\\/:*?"<>|]/g, '_');
        const ext = ((nombre.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
        if (!ADJUNTOS.extensiones.includes(ext)) fallar('RN-14', `Extensión no permitida. Use: ${ADJUNTOS.extensiones.join(', ')}.`);
        const esTexto = typeof a.texto === 'string';
        if (esTexto && ext !== 'txt') fallar('RN-14', 'Un documento redactado se guarda como .txt.');
        if (esTexto && (!a.texto.trim() || a.texto.length > ADJUNTOS.maxTexto)) fallar('RN-14', `El documento debe tener entre 1 y ${ADJUNTOS.maxTexto} caracteres.`);
        const bytes = esTexto ? new TextEncoder().encode(a.texto).length : Number(a.bytes);
        if (!Number.isFinite(bytes) || bytes <= 0 || bytes > ADJUNTOS.maxBytes) fallar('RN-14', 'El archivo debe pesar entre 1 byte y 20 MB.');
        if (!esTexto && !a.archivoId && !a.datos) fallar('RN-14', 'Falta el contenido del archivo.');
        if (t.adjuntos.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) fallar('RN-14', 'Ya existe un adjunto con ese nombre.');
        const adj = { nombre, extension: ext, tipo: TIPOS_MIME[ext], bytes, descripcion: texto(a.descripcion), publico: a.publico !== false, fecha: formatearFecha(ahora()), area: u.area, usuario: u.nombre };
        if (esTexto) adj.texto = a.texto; else if (a.archivoId) adj.archivoId = String(a.archivoId); else adj.datos = String(a.datos);
        t.adjuntos.push(adj);
        t.actualizado = formatearFecha(ahora());
        return copia(t);
      });
    }

    function asociar(id, numeroOtro, usuario) {
      return ejecutar('asociar', id, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'asociar');
        const t = exigirTramite(id);
        exigirAreaActual(t, u);
        const otro = porNumero(numeroOtro);
        if (!otro) fallar('RN-15', `No existe el trámite ${numeroOtro}.`);
        if (otro.id === t.id) fallar('RN-15', 'Un trámite no se asocia consigo mismo.');
        if (t.asociados.includes(otro.numero)) fallar('RN-15', 'Los trámites ya están asociados.');
        t.asociados.push(otro.numero);
        if (!otro.asociados.includes(t.numero)) otro.asociados.push(t.numero);
        return copia(t);
      });
    }

    function marcarConfidencial(id, valor, usuario) {
      return ejecutar('confidencial', id, usuario, () => {
        const u = exigirUsuario(usuario);
        exigirPerfil(u, 'confidencial');
        const t = exigirTramite(id);
        if (u.area !== t.areaOrigen && u.area !== t.areaActual) fallar('RN-16', 'Solo el área de origen o la actual cambian la confidencialidad.');
        t.confidencial = Boolean(valor);
        return copia(t);
      });
    }

    // ------------------------------------------------------------- consultas

    /** Vista de un trámite para un usuario: aplica RN-16 (asunto reservado) y calcula el semáforo. */
    function vista(t, u) {
      const v = copia(t);
      v.numeroVisible = formatearNumero(t.numero);
      v.reservado = t.confidencial && !(u && (u.area === t.areaOrigen || u.area === t.areaActual));
      if (v.reservado) { v.asunto = ASUNTO_RESERVADO; v.contenido = ''; v.solicitante = null; v.adjuntos = []; }
      const ultimaConPlazo = [...t.movimientos].reverse().find((m) => m.fechaLimite);
      v.fechaLimite = ultimaConPlazo && !ESTADOS_CERRADOS.includes(t.estado) && t.estado !== 'ATENDIDO' ? ultimaConPlazo.fechaLimite : null;
      v.semaforo = v.fechaLimite ? semaforo(ahora(), leerFecha(v.fechaLimite)) : null;
      v.remitente = (ultimaDerivacion(t) || {}).desdeArea || t.areaOrigen;
      v.fechaIngreso = t.movimientos[0].fecha;
      v.movimientosDesc = [...t.movimientos].reverse(); // RN-17
      v.acciones = u ? accionesPosibles(t, u) : [];
      return v;
    }

    /** Lista de acciones que el usuario puede ejecutar ahora sobre el trámite. */
    function accionesPosibles(t, u) {
      if (!u || !u.activo) return [];
      const permitidas = PERFILES[u.perfil].acciones;
      const lista = Object.keys(ACCIONES).filter((a) => permitidas.includes(a) && ACCIONES[a].desde.includes(t.estado) && t.areaActual === u.area)
        .filter((a) => a !== 'anular' || (t.areaOrigen === u.area && !t.movimientos.some((m) => m.estado === 'DERIVADO')))
        .filter((a) => a !== 'observar' || Boolean((ultimaDerivacion(t) || {}).desdeArea));
      if (permitidas.includes('adjuntar') && t.areaActual === u.area && !ESTADOS_CERRADOS.includes(t.estado)) lista.push('adjuntar');
      if (permitidas.includes('asociar') && t.areaActual === u.area) lista.push('asociar');
      if (permitidas.includes('confidencial') && (u.area === t.areaOrigen || u.area === t.areaActual)) lista.push('confidencial');
      return lista;
    }

    /** Detalle (getTramite). Con la opción marcarLeidoAlAbrir, abrir un trámite DERIVADO lo recibe (hipótesis R9). */
    function detalle(id, usuario) {
      const u = exigirUsuario(usuario);
      const t = estado.tramites[String(id)];
      if (!t) return null;
      if (estado.opciones.marcarLeidoAlAbrir && t.estado === 'DERIVADO' && t.areaActual === u.area && PERFILES[u.perfil].acciones.includes('recibir')) {
        recibir(id, usuario, { automatico: true });
      }
      return vista(estado.tramites[String(id)], u);
    }

    /** Detalle sin efectos de escritura (para refrescar la vista o listar asociados). */
    function detalleSinEfectos(id, usuario) {
      const u = exigirUsuario(usuario);
      const t = estado.tramites[String(id)];
      return t ? vista(t, u) : null;
    }

    function paginar(lista, pagina) {
      const total = lista.length;
      const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
      const p = Math.min(Math.max(1, Number(pagina) || 1), paginas);
      return { total, pagina: p, paginas, porPagina: POR_PAGINA, filas: lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA) };
    }
    const masReciente = (a, b) => leerFecha(b.actualizado) - leerFecha(a.actualizado) || b.id - a.id;

    function coincide(v, f) {
      if (f.numero) {
        const c = normalizarNumero(f.numero);
        if (c ? v.numero !== c : !v.numero.includes(String(f.numero).replace(/\s/g, ''))) return false;
      }
      if (f.asunto && !sinTildes(v.asunto).includes(sinTildes(f.asunto))) return false;
      if (f.estado && v.estado !== f.estado) return false;
      if (f.tipo && v.tipo !== f.tipo) return false;
      if (f.area && v.areaActual !== f.area && v.areaOrigen !== f.area) return false;
      if (f.desde || f.hasta) {
        const fi = leerFecha(v.fechaIngreso);
        if (f.desde && fi < new Date(f.desde + 'T00:00:00')) return false;
        if (f.hasta && fi > new Date(f.hasta + 'T23:59:59')) return false;
      }
      return true;
    }

    /** Mis Trámites (getTramites, RN-19). */
    function bandeja(usuario, filtros, pagina) {
      const u = exigirUsuario(usuario);
      const f = filtros || {};
      const lista = Object.values(estado.tramites)
        .filter((t) => t.areaActual === u.area && (f.incluirCerrados || !ESTADOS_CERRADOS.includes(t.estado)) && (!f.asignadosAMi || t.asignadoA === u.usuario))
        .sort(masReciente)
        .map((t) => vista(t, u))
        .filter((v) => coincide(v, f));
      return paginar(lista, pagina);
    }

    /** Seguimiento de Trámites (RN-20): exige al menos un filtro. */
    function buscar(usuario, filtros, pagina) {
      const u = exigirUsuario(usuario);
      const f = filtros || {};
      if (!['numero', 'asunto', 'estado', 'tipo', 'area', 'desde', 'hasta'].some((k) => texto(f[k]))) fallar('RN-20', 'Ingrese al menos un criterio de búsqueda.');
      const lista = Object.values(estado.tramites).sort(masReciente).map((t) => vista(t, u)).filter((v) => coincide(v, f));
      return paginar(lista, pagina);
    }

    /** Resumen para el inicio (dashboard) del área del usuario. */
    function resumen(usuario) {
      const u = exigirUsuario(usuario);
      const mios = Object.values(estado.tramites).filter((t) => t.areaActual === u.area).map((t) => vista(t, u));
      const porEstado = {};
      ESTADOS.forEach((e) => { porEstado[e] = 0; });
      mios.forEach((v) => { porEstado[v.estado]++; });
      return {
        area: u.area,
        total: mios.length,
        porEstado,
        porSemaforo: { ROJO: mios.filter((v) => v.semaforo === 'ROJO').length, AMBAR: mios.filter((v) => v.semaforo === 'AMBAR').length, VERDE: mios.filter((v) => v.semaforo === 'VERDE').length },
        porRecibir: mios.filter((v) => v.estado === 'DERIVADO').length
      };
    }

    // ------------------------------------------------------------ escenarios

    /**
     * Carga escenarios declarativos (ver escenarios.js). No pasa por las acciones,
     * para poder fijar fechas pasadas; sí valida la forma de cada uno.
     */
    function cargarEscenarios(escenarios, opciones) {
      if (!(opciones && opciones.conservar)) estado = estadoVacio();
      for (const e of escenarios) {
        const numero = normalizarNumero(e.numero);
        if (!numero) throw new Error(`Escenario ${e.id}: número inválido «${e.numero}».`);
        if (!/^\d{6}$/.test(String(e.id))) throw new Error(`Escenario ${e.id}: el ID interno debe tener 6 dígitos (RN-08).`);
        if (estado.tramites[e.id]) throw new Error(`Escenario ${e.id}: ID repetido.`);
        if (Object.values(estado.tramites).some((t) => t.numero === numero)) throw new Error(`Escenario ${e.id}: número repetido ${numero}.`);
        if (!e.movimientos || !e.movimientos.length) throw new Error(`Escenario ${e.id}: sin movimientos.`);
        const movimientos = [...e.movimientos].reverse().map((m) => Object.assign({ fechaLimite: null, fechaLeido: null, proveido: '' }, m)); // en escenarios.js van recientes primero, como en pantalla
        const ultimo = movimientos[movimientos.length - 1];
        const t = {
          id: Number(e.id), numero, tipo: e.tipo, origen: e.origen || 'INTERNO',
          areaOrigen: e.areaOrigen || movimientos[0].area, areaActual: ultimo.area, estado: ultimo.estado,
          asunto: e.asunto, contenido: e.contenido || 'Texto de prueba del contenido del documento.',
          solicitante: e.solicitante || null, confidencial: Boolean(e.confidencial),
          asociados: (e.asociados || []).map(normalizarNumero), movimientos, asignadoA: e.asignadoA || null,
          adjuntos: (e.adjuntos || []).map((a) => {
            const ext = (a.nombre.match(/\.([a-z0-9]+)$/i) || [])[1].toLowerCase();
            return Object.assign({ extension: ext, tipo: TIPOS_MIME[ext], bytes: a.texto ? new TextEncoder().encode(a.texto).length : 0, publico: true, descripcion: '', fecha: movimientos[0].fecha, area: movimientos[0].area, usuario: 'USUARIO FICTICIO 1' }, a);
          }),
          render: e.render || {}, registrado: movimientos[0].fecha, actualizado: ultimo.fecha, registradoPor: 'escenario'
        };
        estado.tramites[t.id] = t;
        estado.siguienteId = Math.max(estado.siguienteId, t.id + 1);
        const [anio, serie] = numero.split('-');
        estado.correlativos[anio] = Math.max(estado.correlativos[anio] || 0, parseInt(serie, 10));
      }
      guardar();
    }

    const copia = (o) => JSON.parse(JSON.stringify(o));

    return {
      // acciones
      autenticar, registrar, derivar, recibir,
      iniciar: accionSimple('iniciar', 'RN-04', false),
      observar: accionSimple('observar', 'RN-18', true),
      atender: accionSimple('atender', 'RN-04', false),
      archivar: accionSimple('archivar', 'RN-12', true),
      desarchivar: accionSimple('desarchivar', 'RN-12', true),
      anular: accionSimple('anular', 'RN-13', true),
      adjuntar, asociar, marcarConfidencial,
      // consultas
      detalle, detalleSinEfectos, bandeja, buscar, resumen, porNumero: (n) => { const t = porNumero(n); return t ? copia(t) : null; },
      usuario: (n) => { const x = usuarioDe(n); return x ? copia(x) : null; },
      usuarios: (area) => copia(usuarios.filter((x) => !area || x.area === area)),
      bitacora: () => copia(estado.bitacora),
      // administración del banco de pruebas
      cargarEscenarios,
      opciones: () => copia(estado.opciones),
      configurar: (o) => { Object.assign(estado.opciones, o || {}); guardar(); },
      exportar: () => copia(estado),
      importar: (e) => { if (!e || e.version !== VERSION_ESQUEMA) throw new Error('Versión de datos no compatible.'); estado = copia(e); guardar(); },
      reiniciar: () => { estado = estadoVacio(); guardar(); }
    };
  }

  /**
   * Correspondencia con los endpoints internos observados en el SGD real (docs/11 §5).
   * El SGD de pruebas no expone HTTP; esta tabla sirve de contrato para un futuro
   * SGD de pruebas con API o para un adaptador del SGD real.
   */
  const CONTRATO_REST = [
    { ruta: '/Rest//Auth/v3.2/KeepAlive', funcion: 'sesion (datos.js)', descripcion: 'Renueva o valida la sesión' },
    { ruta: '/Rest/DetalleTramite/v1.0/getTramite', funcion: 'detalle(id, usuario)', descripcion: 'Cabecera y datos del trámite' },
    { ruta: '/Rest//DetalleTramite/v1.0/getBandeja', funcion: 'detalle(id).movimientosDesc', descripcion: 'Movimientos del trámite' },
    { ruta: '/Rest/DetalleTramite/v1.0/getTramitesAsociados', funcion: 'detalle(id).asociados', descripcion: 'Trámites asociados' },
    { ruta: '/Rest//MisTramites/v1.0/getCatalogo', funcion: 'SGD.CATALOGOS', descripcion: 'Áreas, estados y tipos' },
    { ruta: '/Rest//MisTramites/v1.0/getTramites', funcion: 'bandeja(usuario, filtros, pagina)', descripcion: 'Bandeja paginada' },
    { ruta: '/Rest//ListadoTramites/v1.0/getBandeja', funcion: 'buscar(usuario, filtros, pagina)', descripcion: 'Seguimiento / búsqueda' }
  ];

  return {
    VERSION: '2.0.0',
    crear, SGDError, REGLAS, ACCIONES, ESTADOS, PERFILES, USUARIOS, CLAVE_PRUEBA, TIPOS_MIME, CONTRATO_REST,
    CATALOGOS: { areas: AREAS, tipos: TIPOS_DOCUMENTO, origenes: ORIGENES, estados: ESTADOS },
    LIMITES: { adjuntos: ADJUNTOS, plazo: PLAZO, longitud: LONGITUD, porPagina: POR_PAGINA },
    ASUNTO_RESERVADO,
    utilidades: { normalizarNumero, formatearNumero, formatearFecha, leerFecha, esHabil, sumarDiasHabiles, diasHabilesRestantes, semaforo, domingoDePascua }
  };
});
