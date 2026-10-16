/*
 * LEGAL · Conector SGD — configuración local (chrome.storage.local).
 *
 * El navegador solo guarda la configuración, la sesión con el servidor LEGAL y
 * las preferencias del panel. Los trámites indexados se guardan en la base de
 * datos del servidor LEGAL. La extensión NO escribe en el SGD.
 */
(function (global) {
  const CLAVES = {
    CONFIG: 'legal.configuracion',
    SESION: 'legal.sesion',
    PREFERENCIAS: 'legal.preferencias'
  };

  const CONFIG_PREDETERMINADA = Object.assign({
    // Prefijos de URL del SGD. Ejemplo: "https://sgd.institucion.gob.pe/"
    urlsSgd: [],
    // 'indicador': el ícono se habilita solo si la página del SGD muestra un indicador de sesión.
    // 'dominio':   el ícono se habilita en cualquier página del SGD (la sesión se verifica al abrir).
    modoActivacion: 'indicador',
    // Indicadores de sesión activa: selectores CSS simples (sin combinadores).
    selectoresSesion: [
      'app-layout',
      'sidebar-cmp',
      "a[href*='/pages/login/exit']",
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
    textosSesion: ['Cerrar sesión', 'Cerrar Sesión', 'Salir del sistema', 'Salir', 'Logout'],
    // Plantilla opcional de enlace directo. Variables: {nroTramite}, {idInterno}, {url}
    plantillaEnlace: '',
    parametrosSensibles: ['jsessionid', 'token', 'sid', 'sessionid', 'phpsessid', 'aspsessionid', 'csrf', '_csrf'],
    // Servidor LEGAL de la intranet, p. ej. "http://192.168.1.25:8790" (lo fija LEGAL.exe al generar la extensión).
    servidorLegal: ''
  }, global.LEGAL_ENTORNO || {});

  function obtener(clave, porDefecto) {
    return new Promise((resolve) => {
      chrome.storage.local.get([clave], (res) => resolve(res[clave] === undefined ? porDefecto : res[clave]));
    });
  }

  function guardar(clave, valor) {
    return new Promise((resolve) => chrome.storage.local.set({ [clave]: valor }, () => resolve(valor)));
  }

  function quitar(clave) {
    return new Promise((resolve) => chrome.storage.local.remove(clave, resolve));
  }

  async function obtenerConfiguracion() {
    const guardada = await obtener(CLAVES.CONFIG, {});
    const config = Object.assign({}, CONFIG_PREDETERMINADA, guardada);
    const delEntorno = (global.LEGAL_ENTORNO && global.LEGAL_ENTORNO.urlsSgd) || [];
    config.urlsSgd = [...new Set([...delEntorno, ...(config.urlsSgd || [])])];
    if (!config.servidorLegal && global.LEGAL_ENTORNO) config.servidorLegal = global.LEGAL_ENTORNO.servidorLegal || '';
    const sesion = await obtener(CLAVES.SESION, null);
    // La sesión vale solo para el servidor con el que se abrió.
    config.token = sesion && sesion.servidor === config.servidorLegal ? sesion.token : '';
    config.usuario = sesion && config.token ? sesion.usuario : null;
    return config;
  }

  global.LegalAlmacen = {
    CLAVES,
    CONFIG_PREDETERMINADA,
    obtener,
    guardar,
    quitar,
    obtenerConfiguracion,
    guardarSesion: (servidor, token, usuario) => guardar(CLAVES.SESION, { servidor, token, usuario }),
    cerrarSesion: () => quitar(CLAVES.SESION),
    preferencias: () => obtener(CLAVES.PREFERENCIAS, { criterioNuevo: 'profesional', criterioExistente: 'profesional' }),
    guardarPreferencias: (p) => guardar(CLAVES.PREFERENCIAS, p)
  };
})(typeof self !== 'undefined' ? self : this);
