/*
 * LEGAL · Conector SGD — cliente del servidor LEGAL.
 *
 * Todo lo que se indexa se guarda en la base de datos del servidor LEGAL (el
 * ejecutable LEGAL.exe de la intranet), de modo que se ve de inmediato en el
 * portal. La sesión se abre con el usuario del portal y se envía como token.
 * Estas peticiones van solo al servidor LEGAL, nunca al SGD.
 */
(function (global) {
  const base = (config) => (config.servidorLegal || '').replace(/\/+$/, '');

  async function pedir(config, ruta, opciones = {}, espera = 6000) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), espera);
    const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (config.token) cabeceras.Authorization = `Bearer ${config.token}`;
    try {
      const res = await fetch(base(config) + ruta, { ...opciones, signal: control.signal, headers: cabeceras });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(cuerpo.mensaje || `El servidor respondió ${res.status}.`);
        error.estado = res.status;
        error.cuerpo = cuerpo;
        throw error;
      }
      return cuerpo;
    } catch (e) {
      if (e.name === 'AbortError') { const x = new Error('el servidor LEGAL no respondió a tiempo'); x.estado = 0; throw x; }
      if (e.estado === undefined) { const x = new Error(`no se pudo conectar con ${base(config) || 'el servidor LEGAL'}`); x.estado = 0; throw x; }
      throw e;
    } finally {
      clearTimeout(temporizador);
    }
  }

  const json = (metodo, cuerpo) => ({ method: metodo, body: JSON.stringify(cuerpo) });

  global.LegalServidor = {
    configurado: (config) => Boolean(base(config)),
    urlPortal: (config) => `${base(config)}/portal/`,
    estado: (config) => pedir(config, '/api/estado'),
    ingresar: (config, usuario, clave) => pedir(config, '/api/sesion', json('POST', { usuario, clave, origen: 'extension' })),
    salir: (config) => pedir(config, '/api/sesion', { method: 'DELETE', body: '{}' }),
    sesion: (config) => pedir(config, '/api/sesion'),
    catalogo: (config) => pedir(config, '/api/catalogo'),
    proceso: (config, id) => pedir(config, `/api/procesos/${encodeURIComponent(id)}`),
    consultarTramite: (config, numero, idInterno) => pedir(config, `/api/tramites-sgd?numero=${encodeURIComponent(numero || '')}&idInterno=${encodeURIComponent(idInterno || '')}`),
    indexar: (config, datos) => pedir(config, '/api/indexar', json('POST', datos), 10000),
    misIndexaciones: (config) => pedir(config, '/api/mis-indexaciones'),
    quitarIndexacion: (config, id) => pedir(config, `/api/tramites/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })
  };
})(typeof self !== 'undefined' ? self : this);
