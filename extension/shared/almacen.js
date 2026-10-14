/*
 * LEGAL · Conector SGD
 * Capa de almacenamiento local (chrome.storage.local).
 *
 * Todo lo que registra la extensión se guarda únicamente en el navegador del
 * usuario. La extensión NO escribe en el SGD ni envía información a terceros.
 */
(function (global) {
  const CLAVES = {
    CONFIG: 'legal.configuracion',
    CATALOGO: 'legal.catalogo',
    PROCESOS_NUEVOS: 'legal.procesosRegistrados',
    TRAMITES: 'legal.tramitesIndexados'
  };

  const CONFIG_PREDETERMINADA = Object.assign({
    // Prefijos de URL del SGD. Ejemplo: "https://sgd.institucion.gob.pe/"
    urlsSgd: [],
    // 'indicador': el ícono se habilita solo si la página del SGD muestra un
    //              indicador de sesión (enlace de cierre de sesión).
    // 'dominio':   el ícono se habilita en cualquier página del SGD; la sesión
    //              se verifica igualmente al abrir la extensión.
    modoActivacion: 'indicador',
    // Indicadores de sesión activa: selectores CSS simples (sin combinadores),
    // usados también por el activador del ícono de la extensión.
    selectoresSesion: [
      "a[href*='logout']",
      "a[href*='Logout']",
      "a[href*='logoff']",
      "a[href*='salir']",
      "a[href*='Salir']",
      "a[href*='cerrarSesion']",
      "a[href*='CerrarSesion']",
      "[onclick*='logout']",
      "[onclick*='salir']",
      "[onclick*='cerrarSesion']"
    ],
    // Textos visibles que indican sesión activa (enlaces o botones).
    textosSesion: ['Cerrar sesión', 'Cerrar Sesión', 'Salir del sistema', 'Salir', 'Logout'],
    // Plantilla opcional de enlace directo. Variables: {nroExpediente}, {nroRegistro}, {url}
    plantillaEnlace: '',
    // Parámetros de URL que se eliminan del enlace directo (identificadores de sesión).
    parametrosSensibles: ['jsessionid', 'token', 'sid', 'sessionid', 'phpsessid', 'aspsessionid', 'csrf', '_csrf'],
    // Usuario de LEGAL que realiza la captura (solo para trazabilidad local).
    usuarioLegal: '',
    // Servidor LEGAL (opcional). Ej.: "http://localhost:8790" en el entorno de prueba.
    servidorLegal: ''
  }, global.LEGAL_ENTORNO || {});

  function obtener(clave, porDefecto) {
    return new Promise((resolve) => {
      chrome.storage.local.get([clave], (res) => {
        resolve(res[clave] === undefined ? porDefecto : res[clave]);
      });
    });
  }

  function guardar(clave, valor) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [clave]: valor }, () => resolve(valor));
    });
  }

  async function obtenerConfiguracion() {
    const guardada = await obtener(CLAVES.CONFIG, {});
    return Object.assign({}, CONFIG_PREDETERMINADA, guardada);
  }

  async function obtenerCatalogo() {
    const importado = await obtener(CLAVES.CATALOGO, null);
    const base = importado || global.LEGAL_CATALOGO;
    const nuevos = await obtener(CLAVES.PROCESOS_NUEVOS, []);
    return {
      categorias: base.categorias,
      responsables: base.responsables,
      procesos: [...base.procesos, ...nuevos],
      origen: importado ? 'importado' : 'referencial'
    };
  }

  async function registrarProceso(proceso) {
    const nuevos = await obtener(CLAVES.PROCESOS_NUEVOS, []);
    nuevos.push(proceso);
    return guardar(CLAVES.PROCESOS_NUEVOS, nuevos);
  }

  async function obtenerTramites() {
    return obtener(CLAVES.TRAMITES, []);
  }

  async function registrarTramite(tramite) {
    const lista = await obtenerTramites();
    lista.unshift(tramite);
    return guardar(CLAVES.TRAMITES, lista);
  }

  async function eliminarTramite(id) {
    const lista = await obtenerTramites();
    return guardar(CLAVES.TRAMITES, lista.filter((t) => t.id !== id));
  }

  /** Genera el siguiente código correlativo PL-AAAA-NNNN a partir del catálogo. */
  function siguienteCodigoProceso(procesos) {
    const anio = new Date().getFullYear();
    const prefijo = `PL-${anio}-`;
    const max = procesos
      .map((p) => p.codigo)
      .filter((c) => c && c.startsWith(prefijo))
      .map((c) => parseInt(c.slice(prefijo.length), 10) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return prefijo + String(max + 1).padStart(4, '0');
  }

  /** Paquete de intercambio que el Portal LEGAL puede importar. */
  async function construirExportacion() {
    const [tramites, procesosRegistrados, config] = await Promise.all([
      obtenerTramites(),
      obtener(CLAVES.PROCESOS_NUEVOS, []),
      obtenerConfiguracion()
    ]);
    return {
      formato: 'legal-sgd-intercambio',
      version: 1,
      generadoEn: new Date().toISOString(),
      generadoPor: config.usuarioLegal || null,
      procesosRegistrados,
      tramitesIndexados: tramites
    };
  }

  global.LegalAlmacen = {
    CLAVES,
    CONFIG_PREDETERMINADA,
    obtener,
    guardar,
    obtenerConfiguracion,
    obtenerCatalogo,
    registrarProceso,
    obtenerTramites,
    registrarTramite,
    eliminarTramite,
    siguienteCodigoProceso,
    construirExportacion
  };
})(typeof self !== 'undefined' ? self : this);
