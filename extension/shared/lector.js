/*
 * LEGAL · Conector SGD
 * Lector de página del SGD (modo SOLO LECTURA).
 *
 * Esta función se inyecta bajo demanda (cuando el usuario abre la extensión) en
 * la pestaña activa del SGD mediante chrome.scripting.executeScript.
 *
 * Garantías de solo lectura:
 *   - Únicamente consulta el DOM (querySelector, textContent, value).
 *   - No hace clic, no envía formularios, no modifica valores ni estilos.
 *   - No realiza peticiones de red al SGD ni a ningún otro servidor.
 *
 * Debe ser autocontenida: chrome.scripting serializa la función, por lo que no
 * puede referenciar variables externas.
 */
// eslint-disable-next-line no-unused-vars
function leerPaginaSgd(parametros) {
  const LIMITE_VALOR = 1000;

  const normalizar = (t) =>
    String(t || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\b(n\s*[°º]|nro|nº|no|num|numero)(?=[\s.:]|$)\.?/g, 'nro')
      .replace(/[°º]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const limpiar = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_VALOR);

  const ETIQUETAS = {
    nroExpediente: ['nro expediente', 'expediente', 'nro de expediente', 'codigo de expediente', 'nro exp', 'exp'],
    nroRegistro: ['nro registro', 'registro', 'nro de registro', 'nro tramite', 'nro de tramite', 'codigo de tramite', 'cut', 'codigo unico de tramite', 'nro emision', 'hoja de ruta', 'nro hoja de ruta'],
    tipoDocumento: ['tipo de documento', 'tipo documento', 'tipo doc', 'clase de documento', 'documento tipo'],
    nroDocumento: ['nro documento', 'nro de documento', 'documento nro', 'nro doc'],
    asunto: ['asunto', 'sumilla', 'referencia', 'motivo'],
    remitente: ['remitente', 'emisor', 'firmado por', 'de', 'origen', 'solicitante', 'administrado', 'razon social'],
    dependencia: ['dependencia', 'unidad organica', 'oficina', 'area', 'dependencia de origen', 'unidad de origen', 'oficina de origen'],
    destinatario: ['destinatario', 'para', 'dirigido a', 'destino'],
    fechaDocumento: ['fecha', 'fecha de documento', 'fecha documento', 'fecha de registro', 'fecha de emision', 'fecha de recepcion', 'fecha de ingreso'],
    estadoSgd: ['estado', 'situacion', 'estado del tramite']
  };

  const CLAVES_CAMPO = {
    nroExpediente: ['expediente', 'nroexp', 'numexp'],
    nroRegistro: ['nroregistro', 'numregistro', 'nrotramite', 'cut', 'hojaruta'],
    tipoDocumento: ['tipodoc', 'tipodocumento'],
    nroDocumento: ['nrodoc', 'numdoc', 'nrodocumento'],
    asunto: ['asunto', 'sumilla'],
    remitente: ['remitente', 'emisor'],
    dependencia: ['dependencia', 'unidadorg'],
    destinatario: ['destinatario'],
    fechaDocumento: ['fechadoc', 'fecdoc', 'fechadocumento', 'fecharegistro'],
    estadoSgd: ['estado']
  };

  const visible = (el) => {
    if (!el || !el.getClientRects) return false;
    if (el.getClientRects().length === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };

  const valorDe = (el) => {
    if (!el) return '';
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return limpiar(el.value);
    if (tag === 'SELECT') return limpiar(el.selectedOptions[0] ? el.selectedOptions[0].textContent : '');
    const control = el.querySelector && el.querySelector('input:not([type=hidden]):not([type=button]):not([type=submit]), textarea, select');
    if (control && !limpiar(el.innerText)) return valorDe(control);
    return limpiar(el.innerText || el.textContent);
  };

  const campoPorEtiqueta = (normal) => {
    for (const [campo, sinonimos] of Object.entries(ETIQUETAS)) {
      if (sinonimos.includes(normal)) return campo;
    }
    return null;
  };

  const valorJuntoA = (el) => {
    const tag = el.tagName;
    if (tag === 'LABEL' && el.htmlFor) {
      const destino = document.getElementById(el.htmlFor);
      if (destino) return valorDe(destino);
    }
    if (tag === 'DT') {
      const dd = el.nextElementSibling;
      if (dd && dd.tagName === 'DD') return valorDe(dd);
    }
    if (tag === 'TH' || tag === 'TD') {
      const sig = el.nextElementSibling;
      // Encabezado de columna: se usa solo si la tabla tiene una única fila de datos.
      if (tag === 'TH' && (!sig || sig.tagName === 'TH')) {
        const tabla = el.closest('table');
        const indice = Array.prototype.indexOf.call(el.parentElement.children, el);
        const filas = tabla ? Array.from(tabla.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td')) : [];
        if (filas.length === 1 && filas[0].children[indice]) return valorDe(filas[0].children[indice]);
        return '';
      }
      if (sig) return valorDe(sig);
    }
    let sig = el.nextElementSibling;
    if (sig) return valorDe(sig);
    const padre = el.parentElement;
    if (padre && padre.children.length === 1 && padre.nextElementSibling) return valorDe(padre.nextElementSibling);
    return '';
  };

  // ---- 1. Lectura de datos del trámite -------------------------------------
  const datos = {};
  const fuentes = {};
  const asignar = (campo, valor, fuente) => {
    if (!campo || !valor || datos[campo]) return;
    if (normalizar(valor) === '' || campoPorEtiqueta(normalizar(valor))) return;
    datos[campo] = valor;
    fuentes[campo] = fuente;
  };

  const candidatos = document.querySelectorAll('label, th, td, dt, b, strong, span, div, p, li');
  let revisados = 0;
  for (const el of candidatos) {
    if (++revisados > 6000) break;
    const texto = (el.innerText || el.textContent || '').trim();
    if (!texto || texto.length > 400) continue;
    if (el.children.length > 2 && el.tagName !== 'TD' && el.tagName !== 'TH') continue;

    // a) Etiqueta independiente: "Asunto" | "Asunto:"
    if (texto.length <= 40) {
      const campo = campoPorEtiqueta(normalizar(texto));
      if (campo && !datos[campo]) {
        asignar(campo, valorJuntoA(el), 'etiqueta');
        continue;
      }
    }
    // b) Etiqueta en línea: "Asunto: Solicita opinión legal…"
    const pos = texto.indexOf(':');
    if (pos > 0 && pos <= 35 && el.children.length === 0) {
      const campo = campoPorEtiqueta(normalizar(texto.slice(0, pos)));
      if (campo) asignar(campo, limpiar(texto.slice(pos + 1)), 'texto');
    }
  }

  // c) Controles de formulario cuyo id/name identifica el dato (lectura de su valor)
  document.querySelectorAll('input:not([type=hidden]):not([type=password]), textarea, select').forEach((ctrl) => {
    const id = normalizar(`${ctrl.id || ''} ${ctrl.name || ''}`).replace(/ /g, '');
    if (!id) return;
    for (const [campo, claves] of Object.entries(CLAVES_CAMPO)) {
      if (!datos[campo] && claves.some((k) => id.includes(k))) asignar(campo, valorDe(ctrl), 'control');
    }
  });

  // d) Patrón en el texto de la página para el número de expediente
  const textoPagina = (document.body && document.body.innerText) || '';
  if (!datos.nroExpediente) {
    const m = textoPagina.match(/expediente\s*(?:n\s*[°º.]*|nro\.?|n[uú]mero)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{3,40})/i);
    if (m && /\d/.test(m[1])) asignar('nroExpediente', m[1].replace(/[.]+$/, ''), 'patron');
  }

  // ---- 2. Indicadores de sesión -------------------------------------------
  let indicadorSesion = null;
  for (const sel of parametros.selectoresSesion || []) {
    try {
      const el = document.querySelector(sel);
      if (el) { indicadorSesion = `selector ${sel}`; break; }
    } catch (e) { /* selector inválido: se ignora */ }
  }
  if (!indicadorSesion) {
    const textos = (parametros.textosSesion || []).map(normalizar);
    const accionables = document.querySelectorAll('a, button, input[type=button], input[type=submit], [role=button], [onclick]');
    for (const el of accionables) {
      const t = normalizar(el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent || el.title));
      if (t && textos.includes(t)) { indicadorSesion = `texto "${limpiar(el.innerText || el.value)}"`; break; }
    }
  }
  const formularioIngreso = Array.from(document.querySelectorAll('input[type=password]')).some(visible);

  let usuarioSgd = '';
  const nodosUsuario = document.querySelectorAll('[id*="usuario" i], [class*="usuario" i], [id*="username" i], [class*="user-name" i], [class*="username" i]');
  for (const el of nodosUsuario) {
    if (el.tagName === 'INPUT' || el.tagName === 'SCRIPT') continue;
    const t = limpiar(el.innerText);
    if (t && t.length >= 3 && t.length <= 80) { usuarioSgd = t; break; }
  }

  const seleccion = limpiar(String(window.getSelection ? window.getSelection() : ''));

  return {
    esPrincipal: window === window.top,
    url: location.href,
    titulo: limpiar(document.title),
    datos,
    fuentes,
    sesion: { indicador: indicadorSesion, formularioIngreso, usuarioSgd },
    seleccion
  };
}
