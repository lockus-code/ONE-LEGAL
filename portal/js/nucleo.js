/*
 * LEGAL · Portal — núcleo: API del servidor, datos en memoria, utilidades,
 * cómputo de plazos (días hábiles del Perú) y componentes comunes.
 * Todo se guarda en la base de datos del servidor LEGAL; el navegador no guarda datos.
 */
(function () {
  'use strict';
  const L = (window.LEGAL = { vistas: {}, D: null });

  // ================================================================ API
  L.api = async function (metodo, ruta, cuerpo) {
    const opciones = { method: metodo, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);
    let res;
    try {
      res = await fetch(ruta, opciones);
    } catch (e) {
      const x = new Error('No hay conexión con el servidor LEGAL.');
      x.estado = 0;
      throw x;
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      const x = new Error(datos.mensaje || `Error ${res.status}`);
      x.estado = res.status;
      x.cuerpo = datos;
      if (res.status === 401 && ruta !== '/api/sesion') L.alExpirar && L.alExpirar();
      throw x;
    }
    return datos;
  };

  L.recargar = async function () {
    L.D = await L.api('GET', '/api/datos');
    L.indexar();
    return L.D;
  };

  // Índices para búsquedas rápidas.
  L.indexar = function () {
    const D = L.D;
    D.porUsuario = Object.fromEntries(D.usuarios.map((u) => [u.id, u]));
    D.porProceso = Object.fromEntries(D.procesos.map((p) => [p.id, p]));
    D.porTarea = Object.fromEntries(D.tareas.map((t) => [t.id, t]));
    D.tareasPor = {};
    D.tareas.forEach((t) => (D.tareasPor[t.procesoId] = D.tareasPor[t.procesoId] || []).push(t));
    D.tramitesPor = {};
    D.tramites.forEach((t) => (D.tramitesPor[t.procesoId] = D.tramitesPor[t.procesoId] || []).push(t));
    D.feriadosSet = new Set(D.feriados);
  };

  // ============================================================ utilidades
  L.$ = (s, r = document) => r.querySelector(s);
  L.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  L.esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  L.normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  L.slug = (t) => L.normal(t).replace(/[^a-z0-9]+/g, '-');
  L.pct = (n) => (n === null || Number.isNaN(n) ? '—' : `${Math.round(n * 100)} %`);
  L.ROLES = { admin: 'Administrador', gerente: 'Gerente', profesional: 'Profesional', asistente: 'Asistente administrativo' };

  const aFecha = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  L.aFecha = aFecha;
  L.isoDia = isoDia;
  L.hoy = () => L.D ? L.D.hoy : isoDia(new Date());
  L.fmtFecha = (iso) => !iso ? '—' : /^\d{4}-\d{2}-\d{2}/.test(iso) ? aFecha(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : String(iso);
  L.fmtFechaHora = (iso) => !iso ? '—' : new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  L.diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 86400000);
  /** Fecha del SGD «dd/mm/aaaa hh:mm:ss» → ISO (AAAA-MM-DD) o null. */
  L.fechaSgd = (t) => { const m = String(t || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(t || '') ? t.slice(0, 10) : null); };

  // Plazos: mismas reglas que el servidor (días hábiles sin feriados; calendario prorrogado a hábil).
  L.esHabil = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !L.D.feriadosSet.has(isoDia(d));
  L.sumarDias = function (desde, n, tipo) {
    const d = aFecha(desde || L.hoy());
    if (tipo === 'calendario') {
      d.setDate(d.getDate() + n);
      while (!L.esHabil(d)) d.setDate(d.getDate() + 1);
      return isoDia(d);
    }
    for (let c = 0; c < n;) { d.setDate(d.getDate() + 1); if (L.esHabil(d)) c++; }
    return isoDia(d);
  };
  L.habilesHasta = function (iso) {
    const a = aFecha(L.hoy()), b = aFecha(iso);
    const signo = b < a ? -1 : 1;
    const [ini, fin] = signo > 0 ? [a, b] : [b, a];
    let n = 0;
    for (const d = new Date(ini); d < fin;) { d.setDate(d.getDate() + 1); if (L.esHabil(d)) n++; }
    return n * signo;
  };

  // ============================================================ dominio
  L.usuario = (id) => L.D.porUsuario[id] || { nombre: '—', iniciales: '?' };
  L.nombre = (id) => (L.D.porUsuario[id] || {}).nombre || '—';
  L.profesionales = (soloActivos = true) => L.D.usuarios.filter((u) => u.rol === 'profesional' && (!soloActivos || u.activo)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  L.categorias = () => L.D.taxonomia.categorias;
  L.viasActivas = (c) => (c.vias || []).filter((v) => !v.desactivada);
  L.buscarVia = (codigo) => { for (const c of L.categorias()) { const v = (c.vias || []).find((x) => x.codigo === codigo); if (v) return { c, v }; } return { c: null, v: null }; };
  L.nombreCategoria = (codigo) => (L.categorias().find((c) => c.codigo === codigo) || {}).nombre || codigo;
  L.nombreVia = (codigo) => (L.buscarVia(codigo).v || {}).nombre || codigo;
  L.plantillaDe = (profId, via) => L.D.plantillas.find((p) => p.profesionalId === profId && p.via === via);
  L.tareasDe = (pid) => (L.D.tareasPor[pid] || []).slice().sort((a, b) => a.orden - b.orden);
  L.tramitesDe = (pid) => L.D.tramitesPor[pid] || [];
  L.yo = () => L.D.usuario;
  L.rol = () => L.D.usuario.rol;
  L.es = (...roles) => roles.includes(L.D.usuario.rol);
  L.puedeEditarTareas = (p) => p && p.estado !== 'Finalizado' && (L.es('admin') || (L.es('profesional') && p.profesionalId === L.yo().id));
  L.abierta = (t) => t.estado !== 'Finalizada';

  L.avance = function (pid) {
    const ts = L.tareasDe(pid);
    return ts.length ? ts.filter((t) => !L.abierta(t)).length / ts.length : 0;
  };

  /** Situación del plazo de una tarea. */
  L.vencimiento = function (t) {
    if (!L.abierta(t)) {
      if (t.fechaLimite && t.fechaFin) return t.fechaFin <= t.fechaLimite ? { tipo: 'cumplida', texto: 'Cumplida en plazo' } : { tipo: 'tarde', texto: 'Cumplida fuera de plazo' };
      return { tipo: 'cumplida', texto: 'Finalizada' };
    }
    if (!t.fechaLimite) {
      if (t.plazoDias !== null && t.plazoDias !== undefined) return { tipo: 'relativo', texto: `${t.plazoDias} días ${t.tipoDias === 'calendario' ? 'calendario' : 'hábiles'} al iniciar` };
      return { tipo: 'sin-plazo', texto: 'Plazo por definir' };
    }
    const h = L.habilesHasta(t.fechaLimite);
    if (t.fechaLimite < L.hoy()) return { tipo: 'vencida', texto: `Vencida hace ${L.diasEntre(t.fechaLimite, L.hoy())} día(s)` };
    if (h === 0) return { tipo: 'proxima', texto: 'Vence hoy' };
    if (h <= L.D.config.diasAlertaPorVencer) return { tipo: 'proxima', texto: `Vence en ${h} día(s) hábil(es)` };
    return { tipo: 'vigente', texto: `Vence el ${L.fmtFecha(t.fechaLimite)}` };
  };

  // ============================================================ chips
  L.chipEstado = (estado) => `<span class="chip chip--estado-${L.slug(estado)}">${L.esc(estado)}</span>`;
  L.chipVence = function (t) {
    const v = L.vencimiento(t);
    if (v.tipo === 'vencida' || v.tipo === 'tarde') return `<span class="chip chip--critico">⚠ ${L.esc(v.texto)}</span>`;
    if (v.tipo === 'proxima') return `<span class="chip chip--advertencia">◷ ${L.esc(v.texto)}</span>`;
    if (v.tipo === 'sin-plazo') return `<span class="chip chip--advertencia">? ${L.esc(v.texto)}</span>`;
    return `<span class="secundario">${L.esc(v.texto)}</span>`;
  };
  L.chipNivel = (n) => ({ critica: '<span class="chip chip--critico">⚠ Crítica</span>', alta: '<span class="chip chip--advertencia">▲ Alta</span>', media: '<span class="chip chip--estado-suspendido">● Media</span>', info: '<span class="chip">ℹ Aviso</span>' }[n] || '');
  L.iniciales = (nombre) => String(nombre || '?').split(/\s+/).filter((p) => !/^(dr|dra|abg|lic|ing)\.?$/i.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  // ============================================================ interfaz
  L.notificar = function (texto, tipo) {
    const n = L.$('#notificacion');
    n.textContent = texto;
    n.className = `notificacion${tipo === 'error' ? ' notificacion--error' : ''}`;
    n.hidden = false;
    clearTimeout(L.notificar.t);
    L.notificar.t = setTimeout(() => { n.hidden = true; }, tipo === 'error' ? 6000 : 3800);
  };

  L.error = (e) => L.notificar(e.message || String(e), 'error');

  L.confirmar = function (texto, { aceptar = 'Aceptar', peligro = false } = {}) {
    return new Promise((resolve) => {
      const caja = L.$('#confirmacion');
      L.$('#confirmacion-texto').textContent = texto;
      const btn = L.$('#confirmacion-aceptar');
      btn.textContent = aceptar;
      btn.classList.toggle('btn--peligro', peligro);
      caja.hidden = false;
      btn.focus();
      const cerrar = (v) => { caja.hidden = true; caja.removeEventListener('click', alClic); document.removeEventListener('keydown', alTecla); resolve(v); };
      const alClic = (ev) => { if (ev.target === btn) cerrar(true); else if (ev.target.hasAttribute('data-cancelar')) cerrar(false); };
      const alTecla = (ev) => { if (ev.key === 'Escape') cerrar(false); };
      caja.addEventListener('click', alClic);
      document.addEventListener('keydown', alTecla);
    });
  };

  /** Abre un modal. `html` incluye cabecera y cuerpo; devuelve el contenedor. */
  L.modal = function (html, { angosto = false } = {}) {
    const m = L.$('#modal');
    L.$('.modal__caja', m).classList.toggle('modal__caja--angosta', angosto);
    L.$('#modal-contenido').innerHTML = html;
    m.hidden = false;
    const primero = L.$('#modal-contenido input, #modal-contenido select, #modal-contenido textarea');
    if (primero) primero.focus();
    return L.$('#modal-contenido');
  };
  L.cerrarModal = () => { L.$('#modal').hidden = true; L.$('#modal-contenido').innerHTML = ''; };
  L.cabModal = (titulo, sub) => `<div class="modal__cab"><div>${sub ? `<div class="modal__clave">${sub}</div>` : ''}<h2 id="modal-titulo">${titulo}</h2></div><button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>`;

  L.opciones = (lista, actual, vacio) => `${vacio !== undefined ? `<option value="">${L.esc(vacio)}</option>` : ''}${lista.map(([v, t]) => `<option value="${L.esc(v)}" ${String(v) === String(actual ?? '') ? 'selected' : ''}>${L.esc(t)}</option>`).join('')}`;
  L.grupos = (grupos, actual, vacio) => `${vacio !== undefined ? `<option value="">${L.esc(vacio)}</option>` : ''}${grupos.filter((g) => g.opciones.length).map((g) => `<optgroup label="${L.esc(g.grupo)}">${L.opciones(g.opciones, actual)}</optgroup>`).join('')}`;

  const kpiTip = (t) => (t ? ` title="${L.esc(t)}"` : '');
  L.kpi = (etiqueta, valor, nota, mod = '', tip = '') => `
    <div class="tarjeta kpi ${mod}"${kpiTip(tip)}><span class="kpi__etiqueta">${L.esc(etiqueta)}</span><span class="kpi__valor">${valor}</span><span class="kpi__nota">${nota}</span></div>`;

  L.barrasH = function (items, { unidad = '' } = {}) {
    if (!items.length || items.every((i) => !i.valor)) return '<p class="vacio">Sin datos todavía.</p>';
    const max = Math.max(1, ...items.map((i) => i.valor));
    return `<div class="barras" role="list">${items.map((i) => `
      <div class="barra" role="listitem">
        <span class="barra__etiqueta" title="${L.esc(i.etiqueta)}">${L.esc(i.etiqueta)}</span>
        <span class="barra__pista" tabindex="0" data-tip="${L.esc(i.etiqueta)}" data-tip-detalle="${L.esc(i.detalle || `${i.valor} ${unidad}`)}">
          <span class="barra__relleno" style="width:${(i.valor / max) * 85}%"></span>
          <span class="barra__valor">${i.valor}</span>
        </span>
      </div>`).join('')}</div>`;
  };

  L.columnas = function (items) {
    const max = Math.max(1, ...items.map((i) => i.valor));
    return `<div class="columnas" role="list">${items.map((i) => `
      <div class="columna" role="listitem" tabindex="0" data-tip="${L.esc(i.tip)}" data-tip-detalle="${L.esc(`${i.valor} trámite(s) indexado(s)`)}">
        <span class="columna__valor">${i.valor || ''}</span>
        <span class="columna__relleno" style="height:${(i.valor / max) * 82}%"></span>
      </div>`).join('')}</div>
      <div class="columnas__ejes" aria-hidden="true">${items.map((i) => `<span>${L.esc(i.etiqueta)}</span>`).join('')}</div>`;
  };

  L.serieSemanal = function (fechas, semanas = 8) {
    const hoy = aFecha(L.hoy());
    const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    return Array.from({ length: semanas }, (_, k) => {
      const desde = new Date(inicio); desde.setDate(desde.getDate() - 7 * (semanas - 1 - k));
      const hasta = new Date(desde); hasta.setDate(desde.getDate() + 7);
      const valor = fechas.filter((f) => { const d = new Date(f); return d >= desde && d < hasta; }).length;
      const etiqueta = desde.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
      return { etiqueta, valor, tip: `Semana del ${etiqueta}` };
    });
  };

  L.mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  L.promedio = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  L.redondear = (n, d = 1) => (n === null ? '—' : Number(n.toFixed(d)).toLocaleString('es-PE'));

  /**
   * Selector en cascada para asignar un proceso nuevo.
   * criterio 'profesional': Profesional → Vía (agrupada por categoría; primero las vías con plantilla).
   * criterio 'categoria':   Categoría → Vía → Profesional (marca quién tiene plantilla).
   */
  L.cascadaProceso = function (raiz, estadoInicial = {}) {
    const st = { criterio: estadoInicial.criterio || 'profesional', profesionalId: estadoInicial.profesionalId || '', categoria: '', via: '' };
    if (L.es('profesional')) { st.profesionalId = L.yo().id; }
    function pintar() {
      const profs = L.profesionales();
      const soloYo = L.es('profesional');
      let html = '';
      if (!soloYo) {
        html += `<label>Elegir primero<select data-c="criterio">${L.opciones([['profesional', 'El profesional (luego sus vías)'], ['categoria', 'La categoría y la vía (luego el profesional)']], st.criterio)}</select></label>`;
      }
      const selProf = (lista, vacio) => `<label>Profesional a cargo<select data-c="profesionalId" ${soloYo ? 'disabled' : ''}>${L.opciones(lista, st.profesionalId, vacio)}</select></label>`;
      if (st.criterio === 'profesional' || soloYo) {
        html += selProf(profs.map((p) => { const n = L.D.plantillas.filter((x) => x.profesionalId === p.id).length; return [p.id, `${p.nombre}${n ? ` · ${n} plantilla(s)` : ''}`]; }), profs.length ? 'Seleccione el profesional…' : 'No hay profesionales: créelos en Usuarios');
        const propias = L.D.plantillas.filter((x) => x.profesionalId === st.profesionalId);
        const conPlt = new Set(propias.map((x) => x.via));
        const grupos = [];
        if (propias.length) grupos.push({ grupo: 'Con plantilla del profesional', opciones: propias.map((x) => [x.via, `${L.nombreCategoria(x.categoria)} › ${L.nombreVia(x.via)}`]) });
        L.categorias().forEach((c) => grupos.push({ grupo: c.nombre, opciones: L.viasActivas(c).filter((v) => !conPlt.has(v.codigo)).map((v) => [v.codigo, v.nombre]) }));
        html += `<label>Vía procedimental<select data-c="via" ${st.profesionalId ? '' : 'disabled'}>${L.grupos(st.profesionalId ? grupos : [], st.via, st.profesionalId ? 'Seleccione la vía…' : 'Primero elija el profesional')}</select></label>`;
      } else {
        html += `<label>Categoría<select data-c="categoria">${L.opciones(L.categorias().map((c) => [c.codigo, c.nombre]), st.categoria, 'Seleccione la categoría…')}</select></label>`;
        const c = L.categorias().find((x) => x.codigo === st.categoria);
        html += `<label>Vía procedimental<select data-c="via" ${c ? '' : 'disabled'}>${L.opciones(c ? L.viasActivas(c).map((v) => [v.codigo, v.nombre]) : [], st.via, c ? 'Seleccione la vía…' : 'Primero elija la categoría')}</select></label>`;
        const ordenados = [...profs].sort((a, b) => Number(Boolean(L.plantillaDe(b.id, st.via))) - Number(Boolean(L.plantillaDe(a.id, st.via))));
        html += selProf(st.via ? ordenados.map((p) => [p.id, `${p.nombre} · ${L.plantillaDe(p.id, st.via) ? '✓ con plantilla' : 'ciclo base'}`]) : [], st.via ? 'Seleccione el profesional…' : 'Primero elija la vía');
      }
      html += `<div class="ciclo-previo" data-c="previo">${previo()}</div>`;
      raiz.innerHTML = html;
    }
    function previo() {
      if (!st.via || !st.profesionalId) return '';
      const pl = L.plantillaDe(st.profesionalId, st.via);
      const { v } = L.buscarVia(st.via);
      const etapas = pl ? pl.tareas : (v ? v.etapas : []);
      const plazo = (e) => (e.plazoDias === null || e.plazoDias === undefined ? 'por definir' : `${e.plazoDias} d. ${e.tipoDias === 'calendario' ? 'cal.' : 'háb.'}${e.desde === 'inicio' ? ' desde el inicio' : ''}`);
      return `<p class="secundario">${pl ? `Ciclo según la plantilla <strong>${L.esc(pl.nombre)}</strong> de ${L.esc(L.nombre(st.profesionalId))}:` : `${L.esc(L.nombre(st.profesionalId))} no tiene plantilla para esta vía; se usarán las <strong>etapas normativas base</strong>:`}</p>
        <ol class="ciclo-lista">${etapas.map((e) => `<li>${L.esc(e.nombre)} <span class="secundario">· ${plazo(e)}</span></li>`).join('')}</ol>`;
    }
    raiz.addEventListener('change', (ev) => {
      const c = ev.target.dataset.c;
      if (!c) return;
      st[c] = ev.target.value;
      if (c === 'criterio') { st.via = ''; st.categoria = ''; if (!L.es('profesional')) st.profesionalId = ''; }
      if (c === 'categoria') st.via = '';
      if (c === 'profesionalId' && st.criterio === 'profesional') st.via = '';
      if (c === 'via' && st.via) st.categoria = (L.buscarVia(st.via).c || {}).codigo || '';
      pintar();
    });
    pintar();
    return { valor: () => ({ ...st, categoria: st.via ? (L.buscarVia(st.via).c || {}).codigo : '' }) };
  };
})();
