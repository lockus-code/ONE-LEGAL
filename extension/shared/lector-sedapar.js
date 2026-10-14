/*
 * LEGAL · Conector SGD — Lector del SGD de SEDAPAR (sgd.sedapar.com.pe).
 *
 * Basado en el documento «11 · Reconocimiento estructural del SGD» (2026-10-09).
 * Solo lee el DOM ya renderizado de la página de detalle (/tramites/detalletramite/{ID}).
 *
 * Datos que lee (lista cerrada):
 *   - N.º de trámite, estrategias P → R1 → R2 con regla de consenso (§3.2) y forma canónica AAAA-#####-S (§3.4).
 *   - ID interno de la URL (§3.2).
 *   - Fecha/hora de ingreso: última fila de «MOVIMIENTO DEL EXPEDIENTE» (§4, opcional).
 *   - Indicio de confidencialidad (R7).
 * Nunca lee: tarjeta «DATOS DEL SOLICITANTE», asunto, contenido, nombres de servidores,
 * menú lateral (usuario en sesión), almacenamiento web ni cookies (§8, «Prohibido»).
 * No hace clic, no envía formularios y no hace peticiones de red.
 *
 * Es asíncrona: espera con MutationObserver (tope 10 s) a que Angular pinte el número (§2).
 * Debe ser autocontenida porque chrome.scripting serializa la función.
 */
// eslint-disable-next-line no-unused-vars
async function leerPaginaSedapar(parametros) {
  const TOPE_MS = (parametros && parametros.topeMs) || 10000;
  const RE = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;
  const RE_RUTA_DETALLE = /\/tramites\/detalletramite\/(\d+)\/?$/;
  const RE_FECHA = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

  const normalizar = (texto) => {
    const m = String(texto || '').replace(/[   ]/g, ' ').match(RE);
    return m ? `${m[1]}-${m[2].padStart(5, '0')}-${parseInt(m[3], 10)}` : null;
  };
  const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const visible = (el) => Boolean(el && el.getClientRects().length);

  const ruta = location.pathname;
  const enLogin = /\/pages\/login(\/|$)/.test(ruta);
  const formularioIngreso = Array.from(document.querySelectorAll('input[type=password]')).some(visible);

  function indicadorSesion() {
    if (enLogin) return null;
    if (document.querySelector('app-layout')) return 'diseño autenticado (app-layout)';
    if (document.querySelector('sidebar-cmp')) return 'menú lateral (sidebar-cmp)';
    if (document.querySelector("a[href*='/pages/login/exit']")) return 'enlace de salida';
    return null;
  }

  function extraer() {
    const raiz = document.querySelector('app-detalletramite');
    if (!raiz) return null;
    // P · estructura
    const P = normalizar((raiz.querySelector('legend.title .col-sm-5 > strong') || {}).textContent);
    // R1 · rótulo vecino «DATOS DEL EXPEDIENTE»
    const legend = Array.from(raiz.querySelectorAll('legend')).find((l) => sinTildes(l.textContent).startsWith('DATOS DEL EXPEDIENTE'));
    const R1 = normalizar(legend && (legend.querySelector('strong') || {}).textContent);
    // R2 · regex acotada a la tarjeta del expediente (una sola coincidencia)
    const tarjeta = Array.from(raiz.querySelectorAll('.card')).find((c) => {
      const t = sinTildes((c.querySelector('legend') || {}).textContent);
      return t.includes('EXPEDIENTE') && !t.includes('ASOCIADOS') && !t.includes('MOVIMIENTO');
    });
    const coincidencias = tarjeta ? Array.from(tarjeta.textContent.replace(/[   ]/g, ' ').matchAll(new RegExp(RE.source, 'g'))) : [];
    const R2 = coincidencias.length === 1 ? normalizar(coincidencias[0][0]) : coincidencias.length > 1 ? 'AMBIGUO' : null;

    let numero = null;
    let motivo = null;
    if (P && R1 && P !== R1) motivo = 'AMBIGUOUS';
    else if (P || R1) numero = P || R1;
    else if (R2 === 'AMBIGUO') motivo = 'AMBIGUOUS';
    else if (R2) numero = R2;
    else return null; // aún no renderizado

    // Fecha de ingreso: última fila de «MOVIMIENTO DEL EXPEDIENTE»
    let fechaIngreso = null;
    const mov = Array.from(raiz.querySelectorAll('.card')).find((c) => sinTildes((c.querySelector('legend') || {}).textContent).includes('MOVIMIENTO'));
    const celda = mov && mov.querySelector('tbody tr:last-child > td:first-child');
    if (celda && RE_FECHA.test(celda.textContent.trim())) fechaIngreso = celda.textContent.trim();

    // Indicio de confidencialidad (R7): el componente existe y muestra contenido.
    const conf = raiz.querySelector('tramites-detalle-tramite-confidential');
    const confidencial = Boolean(conf && visible(conf) && conf.textContent.trim().length > 0);

    return {
      numero,
      motivo,
      estrategias: { P: Boolean(P), R1: Boolean(R1), R2: Boolean(R2 && R2 !== 'AMBIGUO') },
      fechaIngreso,
      confidencial
    };
  }

  /** Espera (MutationObserver, con tope) a que `condicion` devuelva un valor. */
  function esperar(condicion, tope) {
    const inmediato = condicion();
    if (inmediato) return Promise.resolve(inmediato);
    return new Promise((resolve) => {
      const objetivo = document.querySelector('app-root') || document.documentElement;
      const obs = new MutationObserver(() => {
        const v = condicion();
        if (v) { clearTimeout(fin); obs.disconnect(); resolve(v); }
      });
      const fin = setTimeout(() => { obs.disconnect(); resolve(null); }, tope);
      obs.observe(objetivo, { childList: true, subtree: true, characterData: true });
    });
  }

  const base = {
    perfil: 'sedapar',
    esPrincipal: true,
    url: location.origin + location.pathname,
    titulo: document.title
  };
  const sesion = () => ({ indicador: indicadorSesion(), formularioIngreso, usuarioSgd: '' });
  const m = ruta.match(RE_RUTA_DETALLE);

  if (enLogin) return { ...base, sesion: sesion(), esDetalle: false, idInterno: null, numero: null, motivo: 'SIN_SESION' };

  if (!m) {
    // Otra página del SGD (bandeja, búsqueda…): solo se verifica la sesión.
    await esperar(indicadorSesion, 3000);
    return { ...base, sesion: sesion(), esDetalle: false, idInterno: null, numero: null, motivo: 'NO_DETALLE' };
  }

  const inicio = Date.now();
  const resultado = await esperar(extraer, TOPE_MS);
  return {
    ...base,
    sesion: sesion(), // tras la espera: pudo haber redirigido al login
    esDetalle: true,
    idInterno: m[1],
    numero: resultado ? resultado.numero : null,
    motivo: resultado ? resultado.motivo : 'NO_NODE',
    estrategias: resultado ? resultado.estrategias : null,
    fechaIngreso: resultado ? resultado.fechaIngreso : null,
    confidencial: resultado ? resultado.confidencial : false,
    msDeteccion: Date.now() - inicio
  };
}
