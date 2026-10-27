/*
 * SGD de pruebas · capa del navegador.
 *
 * Une el núcleo (nucleo.js, todas las reglas) y los escenarios (escenarios.js)
 * con las páginas. Persistencia:
 *   - modo «servidor» (LEGAL.exe o pruebas/servidor-local.js): el estado y los
 *     archivos se guardan en /sgd-simulado/api/, compartidos por todos los
 *     usuarios de la red. Cada acción se ejecuta sobre el estado más reciente y,
 *     si otro usuario escribió antes (409), se repite sobre el nuevo estado.
 *   - modo «local» (sin servidor): localStorage de este navegador.
 * La sesión vive en sessionStorage (por pestaña) con expiración configurable.
 *
 * Diseño autenticado con la estructura del SGD de SEDAPAR (docs/11):
 *   app-root > app-layout > div.wrapper > (div.sidebar > sidebar-cmp) + (div.main-panel > componente)
 * Todos los datos son ficticios.
 */
window.SGD_BASE = '/sgd-simulado';

(function () {
  const API = SGD_BASE + '/api/';
  const CLAVE_LOCAL = 'sgd.v2.datos';
  const CLAVE_SESION = 'sgd.sesion';
  const MAX_LOCAL = 2 * 1024 * 1024;
  let modo = null; // 'servidor' | 'local'
  let version = 0;

  async function traerEstado() {
    if (modo !== 'local') {
      try {
        const r = await fetch(API + 'estado', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); modo = 'servidor'; version = j.version; return j.estado; }
      } catch (e) { /* sin servidor */ }
      modo = 'local';
    }
    try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL)); } catch (e) { return null; }
  }

  /** Devuelve false si otro usuario escribió antes (conflicto de versión). */
  async function guardarEstado(estado) {
    if (modo === 'local') {
      try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado)); } catch (e) { throw new Error('No hay espacio en el navegador (modo local). Reinicie los datos en la consola.'); }
      return true;
    }
    const r = await fetch(API + 'estado', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-SGD-Pruebas': '1' }, body: JSON.stringify({ version, estado }) });
    if (r.status === 409) return false;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.mensaje || 'No se pudo guardar.');
    version = j.version;
    return true;
  }

  function motor(estado) {
    let pendiente = null;
    const e = SGD.crear({ almacen: { leer: () => estado, escribir: (x) => { pendiente = x; } } });
    return { e, pendiente: () => pendiente };
  }

  /**
   * Ejecuta `fn(motor)` sobre el estado más reciente y guarda el resultado.
   * Si la acción viola una regla, se guarda la bitácora y se relanza el SGDError.
   */
  async function accion(fn) {
    for (let intento = 0; intento < 5; intento++) {
      const m = motor(await traerEstado());
      let resultado, error;
      try { resultado = fn(m.e); } catch (x) { error = x; }
      if (m.pendiente() && !(await guardarEstado(m.pendiente()))) continue;
      window.SGD_APP = m.e;
      if (error) throw error;
      return resultado;
    }
    throw new Error('Demasiados usuarios escribiendo a la vez. Intente de nuevo.');
  }
  window.SGD_ACCION = accion;

  /** Carga el estado (sembrando los escenarios la primera vez) y deja el motor en SGD_APP. */
  window.SGD_INICIAR = async function () {
    const estado = await traerEstado();
    if (estado && estado.version === 2) { window.SGD_APP = motor(estado).e; return SGD_APP; }
    await accion((e) => { if (!e.exportar().tramites || !Object.keys(e.exportar().tramites).length) e.cargarEscenarios(SGD_ESCENARIOS); });
    return SGD_APP;
  };
  window.SGD_MODO = () => modo;

  /** Vuelve a los escenarios iniciales (borra también los archivos subidos). */
  window.SGD_REINICIAR = async function () {
    if (modo === 'servidor') {
      const r = await fetch(API + 'reiniciar', { method: 'POST', headers: { 'X-SGD-Pruebas': '1' } });
      if (!r.ok) throw new Error('No se pudo reiniciar.');
      version = 0;
    } else {
      localStorage.removeItem(CLAVE_LOCAL);
    }
    return accion((e) => { e.cargarEscenarios(SGD_ESCENARIOS); });
  };

  /** Sube un File: en modo servidor devuelve { archivoId }, en modo local { datos } (data: URL). */
  window.SGD_SUBIR = async function (archivo) {
    if (modo === 'servidor') {
      const r = await fetch(API + 'archivos?nombre=' + encodeURIComponent(archivo.name), { method: 'POST', headers: { 'X-SGD-Pruebas': '1', 'Content-Type': 'application/octet-stream' }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new SGD.SGDError('RN-14', j.mensaje || 'No se pudo subir el archivo.');
      return { archivoId: j.id };
    }
    if (archivo.size > MAX_LOCAL) throw new SGD.SGDError('RN-14', 'En modo local (sin servidor) solo se admiten archivos de hasta 2 MB.');
    const datos = await new Promise((ok, mal) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = mal; l.readAsDataURL(archivo); });
    return { datos };
  };

  /** URL para ver o descargar un adjunto, sea cual sea su origen. */
  window.SGD_URL_ADJUNTO = function (a, descargar) {
    if (a.archivoId) return API + 'archivos/' + a.archivoId + (descargar ? '?descargar=1' : '');
    if (a.datos) return a.datos;
    return URL.createObjectURL(new Blob([a.texto || ''], { type: 'text/plain;charset=utf-8' }));
  };

  /** Opciones del banco de pruebas (guardadas con los datos). */
  const opcion = (clave, porDefecto) => { const v = window.SGD_APP ? SGD_APP.opciones()[clave] : undefined; return v === undefined ? porDefecto : v; };
  window.SGD_OPCION = opcion;

  window.SGD_SESION = {
    obtener() {
      let s = null;
      try { s = JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch (e) { /* sin sesión */ }
      if (s && s.expira && Date.now() > s.expira) { this.cerrar(); return null; }
      return s;
    },
    async iniciar(usuario, clave) {
      const u = await accion((e) => e.autenticar(usuario, clave));
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ usuario: u.usuario, inicio: Date.now(), expira: this.vencimiento() }));
      return u;
    },
    /** KeepAlive: cada carga de página renueva el plazo de inactividad. */
    renovar() {
      const s = this.obtener();
      if (s) { s.expira = this.vencimiento(); sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s)); }
      return s;
    },
    vencimiento() { const m = Number(opcion('ttlMinutos', 0)); return m > 0 ? Date.now() + m * 60000 : null; },
    cerrar() { sessionStorage.removeItem(CLAVE_SESION); },
    /** Exige sesión: si no hay, expiró o el usuario ya no es válido, va al login (docs/11 R5). */
    exigir() {
      const s = this.renovar();
      const datos = s && SGD_APP.usuario(s.usuario);
      if (!s || !datos || !datos.activo) { this.cerrar(); location.replace(SGD_BASE + '/pages/login'); return null; }
      setInterval(() => { if (!SGD_SESION.obtener()) location.replace(SGD_BASE + '/pages/login'); }, 5000);
      return Object.assign({}, s, { datos });
    }
  };

  /** Escapa texto para insertarlo como HTML. */
  window.esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Demora que imita las llamadas /Rest/... (multiplicada por la opción factorLatencia). */
  window.SGD_DEMORA = (ms, fn) => setTimeout(fn, Math.round(ms * Number(opcion('factorLatencia', 1))));

  window.SGD_CARD = (titulo, cuerpo, extra) =>
    `<div class="card${extra ? ' ' + extra : ''}"><div class="header"><legend class="title">${titulo}</legend></div><div class="content">${cuerpo}</div></div>`;

  window.SGD_SEMAFORO = (s) => s ? `<span class="semaforo semaforo--${s.toLowerCase()}" title="Plazo: ${s}"></span>` : '';

  window.SGD_OPCIONES = (lista, elegido, vacio) =>
    (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map((x) => { const v = typeof x === 'object' ? x : { valor: x, texto: x }; return `<option value="${esc(v.valor)}"${v.valor === elegido ? ' selected' : ''}>${esc(v.texto)}</option>`; }).join('');

  /** Mensaje de resultado: SGDError (regla incumplida), Error o texto de éxito. */
  window.SGD_MENSAJE = (e) => e instanceof Error
    ? `<div class="error">${e.codigo ? `<b>${esc(e.codigo)}</b> · ` : ''}${esc(e.message)}</div>`
    : `<div class="exito">${esc(e)}</div>`;

  window.SGD_BYTES = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

  /** Pinta el diseño autenticado (app-layout + sidebar-cmp) y devuelve el contenedor del componente. */
  window.SGD_LAYOUT = function (sesion, componente) {
    const raiz = document.querySelector('app-root');
    const u = sesion.datos;
    const enlace = (ruta, texto) => `<li><a href="${SGD_BASE}${ruta}"${location.pathname.startsWith(SGD_BASE + ruta) ? ' class="activo"' : ''}>${texto}</a></li>`;
    raiz.innerHTML =
      '<app-layout><div class="wrapper">' +
        '<div class="sidebar" data-color="azure"><sidebar-cmp>' +
          '<div class="logo">SGD · Pruebas</div>' +
          `<div class="usuario-sesion">${esc(u.nombre)}<br><small>${esc(u.area)} · ${esc(u.perfil)}</small></div>` +
          '<ul class="nav">' +
            enlace('/dashboard', 'Inicio') +
            enlace('/tramites/mistramites', 'Mis Trámites') +
            enlace('/tramites/listadotramites', 'Seg. de Trámites') +
            (SGD.PERFILES[u.perfil].acciones.includes('registrar') ? enlace('/tramites/nuevotramiteint', 'Nuevo trámite') : '') +
            enlace('/consola', 'Consola de pruebas') +
            enlace('/pages/login/exit', 'Salir') +
          '</ul>' +
          `<div class="modo">Datos: ${modo === 'servidor' ? 'compartidos (servidor)' : 'solo este navegador'}</div>` +
        '</sidebar-cmp></div>' +
        `<div class="main-panel"><${componente}></${componente}></div>` +
      '</div></app-layout>';
    return raiz.querySelector(componente);
  };

  /** Parámetros de la URL (?pagina=2&asunto=...). */
  window.SGD_PARAMETROS = () => Object.fromEntries(new URLSearchParams(location.search));
})();
