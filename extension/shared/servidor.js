/*
 * LEGAL · Conector SGD — cliente del servidor LEGAL.
 *
 * Opcional: si en Configuración se indica la dirección del servidor LEGAL, el
 * conector obtiene de allí el catálogo de procesos y registra las vinculaciones.
 * Sin servidor, el conector trabaja en modo local (exportación JSON).
 * Estas peticiones van solo al servidor LEGAL, nunca al SGD.
 */
(function (global) {
  const base = (config) => (config.servidorLegal || '').replace(/\/+$/, '');

  async function pedir(config, ruta, opciones = {}, espera = 2500) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), espera);
    try {
      const res = await fetch(base(config) + ruta, {
        ...opciones,
        signal: control.signal,
        headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) }
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(cuerpo.mensaje || `El servidor respondió ${res.status}.`);
        error.estado = res.status;
        throw error;
      }
      return cuerpo;
    } finally {
      clearTimeout(temporizador);
    }
  }

  global.LegalServidor = {
    configurado: (config) => Boolean(base(config)),
    estado: (config) => pedir(config, '/api/estado'),
    catalogo: (config) => pedir(config, '/api/catalogo'),
    registrarVinculacion: (config, datos) => pedir(config, '/api/vinculaciones', { method: 'POST', body: JSON.stringify(datos) }, 5000)
  };
})(typeof self !== 'undefined' ? self : this);
