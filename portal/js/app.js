/*
 * LEGAL · Portal de Gestión de Procesos Legales (prototipo)
 * Aplicación de una sola página sin dependencias. Los datos se conservan en el
 * almacenamiento local del navegador y pueden restablecerse a los de ejemplo.
 */
(function () {
  'use strict';

  const SEMILLA = window.LEGAL_DATOS;
  const CLAVE_DATOS = 'legal.portal.datos';
  const CLAVE_PERFIL = 'legal.portal.perfil';
  const HOY = new Date(); HOY.setHours(0, 0, 0, 0);

  // ================================================================ almacén
  const almacen = {
    leer(clave) { try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; } },
    escribir(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* almacenamiento no disponible */ } }
  };
  const copiaSemilla = () => JSON.parse(JSON.stringify({
    version: SEMILLA.version, procesos: SEMILLA.procesos, actividades: SEMILLA.actividades,
    tramites: SEMILLA.tramites, plantillas: SEMILLA.plantillas, siguienteClave: SEMILLA.siguienteClave
  }));
  let D = almacen.leer(CLAVE_DATOS);
  if (!D || D.version !== SEMILLA.version) D = copiaSemilla();

  // Modo servidor: cuando el portal lo sirve el entorno de prueba LEGAL, los datos
  // se leen y guardan en su base de datos y se sincronizan las capturas del Conector.
  let servidor = null;
  let subidaPendiente = null;
  function guardar() {
    almacen.escribir(CLAVE_DATOS, D);
    if (!servidor) return;
    clearTimeout(subidaPendiente);
    subidaPendiente = setTimeout(subirAlServidor, 400);
  }
  async function subirAlServidor() {
    try {
      const r = await fetch('/api/portal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(D) });
      if (!r.ok) throw new Error(r.status);
      pintarEstadoBd(true);
    } catch (e) {
      pintarEstadoBd(false);
    }
  }

  let perfil = almacen.leer(CLAVE_PERFIL) || { rol: 'gerente', responsable: 'R01' };

  // ============================================================ utilidades
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = (t) => normal(t).replace(/[^a-z0-9]+/g, '-');
  const aFecha = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return isoDia(d); };
  // Las fechas que vienen del SGD pueden estar en formato dd/mm/aaaa: se muestran tal cual.
  const fmtFecha = (iso) => !iso ? '—' : /^\d{4}-\d{2}-\d{2}/.test(iso) ? aFecha(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : String(iso);
  const fmtFechaHora = (iso) => new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const diasHasta = (iso) => Math.round((aFecha(iso) - HOY) / 86400000);
  const pct = (n) => `${Math.round(n * 100)} %`;

  const responsable = (codigo) => SEMILLA.responsables.find((r) => r.codigo === codigo) || { nombre: codigo || '—', iniciales: '?' };
  const proceso = (codigo) => D.procesos.find((p) => p.codigo === codigo);
  const plantilla = (id) => D.plantillas.find((t) => t.id === id);
  const plantillaDe = (procedimiento) => D.plantillas.find((t) => t.procedimientos.includes(procedimiento));
  const actividadesDe = (codigo) => D.actividades.filter((a) => a.procesoCodigo === codigo);
  const tramitesDe = (codigo) => D.tramites.filter((t) => t.vinculacion.procesoCodigo === codigo);
  const abierta = (a) => a.estado !== 'Concluida';
  const enCurso = (p) => p.estado !== 'Finalizado';

  function vencimiento(a) {
    if (!abierta(a)) return { tipo: 'cumplida', texto: 'Concluida' };
    const d = diasHasta(a.fechaLimite);
    if (d < 0) return { tipo: 'vencida', texto: `Vencida hace ${-d} día${d === -1 ? '' : 's'}` };
    if (d === 0) return { tipo: 'proxima', texto: 'Vence hoy' };
    if (d <= 7) return { tipo: 'proxima', texto: `Vence en ${d} día${d === 1 ? '' : 's'}` };
    return { tipo: 'vigente', texto: `Vence el ${fmtFecha(a.fechaLimite)}` };
  }

  function avance(codigo) {
    const items = actividadesDe(codigo).flatMap((a) => a.checklist);
    if (!items.length) return 0;
    return items.filter((i) => i.hecho).length / items.length;
  }

  const chipEstado = (estado) => `<span class="chip chip--estado-${slug(estado)}">${esc(estado)}</span>`;
  const chipPrioridad = (p) => `<span class="prioridad prioridad--${slug(p)}">${esc(p)}</span>`;
  function chipVence(a) {
    const v = vencimiento(a);
    if (v.tipo === 'vencida') return `<span class="chip chip--critico" title="${esc(v.texto)}">⚠ ${esc(v.texto)}</span>`;
    if (v.tipo === 'proxima') return `<span class="chip chip--advertencia" title="${esc(v.texto)}">◷ ${esc(v.texto)}</span>`;
    return `<span class="secundario">${esc(v.texto)}</span>`;
  }

  function notificar(texto) {
    const n = $('#notificacion');
    n.textContent = texto;
    n.hidden = false;
    clearTimeout(notificar.t);
    notificar.t = setTimeout(() => { n.hidden = true; }, 3800);
  }

  function siguienteCodigoProceso() {
    const prefijo = `PL-${HOY.getFullYear()}-`;
    const max = D.procesos.map((p) => p.codigo).filter((c) => c.startsWith(prefijo)).map((c) => parseInt(c.slice(prefijo.length), 10) || 0).reduce((a, b) => Math.max(a, b), 0);
    return prefijo + String(max + 1).padStart(4, '0');
  }

  /** Instancia las actividades de una plantilla para un proceso nuevo. */
  function instanciarPlantilla(p, plt) {
    let fecha = p.fechaInicio;
    plt.fases.forEach((f) => f.actividades.forEach((act) => {
      fecha = sumarDias(fecha, act.plazoDias);
      D.actividades.push({
        clave: `LEG-${D.siguienteClave++}`, titulo: act.titulo, descripcion: `${f.nombre} · ${p.denominacion}`,
        procesoCodigo: p.codigo, fase: f.nombre, responsable: p.responsable, estado: 'Pendiente', prioridad: p.prioridad,
        fechaLimite: fecha, checklist: act.checklist.map((texto) => ({ texto, hecho: false })), comentarios: []
      });
    }));
  }

  // ================================================================ alcance
  const esGerente = () => perfil.rol === 'gerente';
  const procesosVisibles = () => esGerente() ? D.procesos : D.procesos.filter((p) => p.responsable === perfil.responsable);
  const actividadesVisibles = () => esGerente() ? D.actividades : D.actividades.filter((a) => a.responsable === perfil.responsable);
  const tramitesVisibles = () => {
    if (esGerente()) return D.tramites;
    const mios = new Set(procesosVisibles().map((p) => p.codigo));
    return D.tramites.filter((t) => mios.has(t.vinculacion.procesoCodigo));
  };

  // ================================================================ gráficos
  function barrasH(items, { unidad = '' } = {}) {
    const max = Math.max(1, ...items.map((i) => i.valor));
    if (!items.length) return '<p class="vacio">Sin datos para los filtros seleccionados.</p>';
    return `<div class="barras" role="list">${items.map((i) => `
      <div class="barra" role="listitem">
        <span class="barra__etiqueta" title="${esc(i.etiqueta)}">${esc(i.etiqueta)}</span>
        <span class="barra__pista" tabindex="0" data-tip="${esc(i.etiqueta)}" data-tip-detalle="${esc(i.detalle || `${i.valor} ${unidad}`)}">
          <span class="barra__relleno" style="width:${(i.valor / max) * 85}%"></span>
          <span class="barra__valor">${i.valor}</span>
        </span>
      </div>`).join('')}</div>`;
  }

  function columnas(items) {
    const max = Math.max(1, ...items.map((i) => i.valor));
    return `<div class="columnas" role="list">${items.map((i) => `
      <div class="columna" role="listitem" tabindex="0" data-tip="${esc(i.tip)}" data-tip-detalle="${esc(`${i.valor} trámite(s) indexado(s)`)}">
        <span class="columna__valor">${i.valor || ''}</span>
        <span class="columna__relleno" style="height:${(i.valor / max) * 82}%"></span>
      </div>`).join('')}</div>
      <div class="columnas__ejes" aria-hidden="true">${items.map((i) => `<span>${esc(i.etiqueta)}</span>`).join('')}</div>`;
  }

  function serieSemanal(tramites, semanas = 8) {
    const inicioSemana = new Date(HOY); inicioSemana.setDate(HOY.getDate() - ((HOY.getDay() + 6) % 7));
    return Array.from({ length: semanas }, (_, k) => {
      const desde = new Date(inicioSemana); desde.setDate(desde.getDate() - 7 * (semanas - 1 - k));
      const hasta = new Date(desde); hasta.setDate(desde.getDate() + 7);
      const valor = tramites.filter((t) => { const f = new Date(t.fechaCaptura); return f >= desde && f < hasta; }).length;
      const etiqueta = desde.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
      return { etiqueta, valor, tip: `Semana del ${etiqueta}` };
    });
  }

  const kpi = (etiqueta, valor, nota, mod = '') => `
    <div class="tarjeta kpi ${mod}"><span class="kpi__etiqueta">${esc(etiqueta)}</span><span class="kpi__valor">${valor}</span><span class="kpi__nota">${nota}</span></div>`;

  // ================================================================== vistas
  const vistas = {};

  // ---------- Gerencia: panel institucional
  vistas.gerencia = {
    titulo: 'Panel institucional', subtitulo: 'Situación consolidada de la cartera de procesos legales', rol: 'gerente',
    render(v) {
      const filtro = vistas.gerencia.filtro || '';
      const procs = D.procesos.filter((p) => !filtro || p.categoria === filtro);
      const codigos = new Set(procs.map((p) => p.codigo));
      const acts = D.actividades.filter((a) => codigos.has(a.procesoCodigo));
      const tram = D.tramites.filter((t) => codigos.has(t.vinculacion.procesoCodigo));
      const activos = procs.filter(enCurso);
      const abiertas = acts.filter(abierta);
      const vencidas = abiertas.filter((a) => vencimiento(a).tipo === 'vencida');
      const proximas = abiertas.filter((a) => vencimiento(a).tipo === 'proxima');
      const finalizados = procs.filter((p) => p.estado === 'Finalizado' && p.fechaFin && p.fechaFin.startsWith(String(HOY.getFullYear())));
      const tram30 = tram.filter((t) => (HOY - new Date(t.fechaCaptura)) / 86400000 <= 30);
      const enPlazo = abiertas.length ? 1 - vencidas.length / abiertas.length : 1;

      const porCategoria = SEMILLA.categorias.map((c) => ({ etiqueta: c.nombre, valor: activos.filter((p) => p.categoria === c.nombre).length }))
        .filter((i) => !filtro || i.etiqueta === filtro);
      const porEstado = SEMILLA.ESTADOS_PROCESO.map((e) => ({ etiqueta: e, valor: procs.filter((p) => p.estado === e).length }));
      const alertas = [...vencidas, ...proximas].sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite)).slice(0, 8);

      const filas = SEMILLA.responsables.map((r) => {
        const pr = activos.filter((p) => p.responsable === r.codigo);
        const ab = abiertas.filter((a) => a.responsable === r.codigo);
        const ve = ab.filter((a) => vencimiento(a).tipo === 'vencida').length;
        const items = acts.filter((a) => a.responsable === r.codigo).flatMap((a) => a.checklist);
        return { r, procesos: pr.length, abiertas: ab.length, vencidas: ve, avance: items.length ? items.filter((i) => i.hecho).length / items.length : 0 };
      });
      const maxAb = Math.max(1, ...filas.map((f) => f.abiertas));

      v.innerHTML = `
        <div class="barra-filtros">
          <label>Categoría<select id="f-categoria"><option value="">Todas las categorías</option>${SEMILLA.categorias.map((c) => `<option ${c.nombre === filtro ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
          <span class="espacio"></span>
          <span class="secundario">Corte al ${fmtFecha(isoDia(HOY))}</span>
        </div>
        <div class="rejilla rejilla--kpi">
          ${kpi('Procesos en curso', activos.length, `${procs.length} procesos registrados`)}
          ${kpi('Finalizados en el año', finalizados.length, `Ejercicio ${HOY.getFullYear()}`)}
          ${kpi('Actividades vencidas', vencidas.length, `${proximas.length} vencen en los próximos 7 días`, vencidas.length ? 'kpi--critico' : '')}
          ${kpi('Actividades dentro de plazo', pct(enPlazo), `${abiertas.length} actividades abiertas`)}
          ${kpi('Trámites SGD indexados', tram30.length, 'Últimos 30 días')}
        </div>
        <div class="rejilla rejilla--2">
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos en curso por categoría</h2><p>Excluye procesos finalizados</p></div></div>${barrasH(porCategoria, { unidad: 'procesos en curso' })}</section>
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos según estado</h2><p>Total de la cartera</p></div></div>${barrasH(porEstado, { unidad: 'procesos' })}</section>
        </div>
        <div class="rejilla rejilla--3-1">
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Trámites SGD indexados por semana</h2><p>Documentos incorporados a procesos mediante el Conector SGD · últimas 8 semanas</p></div></div>${columnas(serieSemanal(tram))}</section>
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Alertas de plazo</h2><p>Actividades vencidas y próximas a vencer</p></div></div>
            ${alertas.length ? `<ul class="lista">${alertas.map((a) => `
              <li><span class="avatar avatar--sm" title="${esc(responsable(a.responsable).nombre)}">${esc(responsable(a.responsable).iniciales)}</span>
                <div class="lista__cuerpo"><button class="enlace lista__titulo" data-actividad="${a.clave}">${esc(a.titulo)}</button>
                <div class="lista__meta">${esc(a.procesoCodigo)} · ${esc(responsable(a.responsable).nombre)}</div></div>${chipVence(a)}</li>`).join('')}</ul>`
              : '<p class="vacio">No hay alertas de plazo.</p>'}
          </section>
        </div>
        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Carga de trabajo y desempeño por responsable</h2><p>Actividades abiertas, vencidas y avance de listas de verificación</p></div></div>
          <div class="tabla-envoltura"><table class="tabla">
            <thead><tr><th>Responsable</th><th class="num">Procesos en curso</th><th style="width:30%">Actividades abiertas</th><th class="num">Vencidas</th><th style="width:18%">Avance</th></tr></thead>
            <tbody>${filas.map((f) => `<tr>
              <td><div style="display:flex;gap:10px;align-items:center"><span class="avatar avatar--sm">${esc(f.r.iniciales)}</span><div><strong>${esc(f.r.nombre)}</strong><div class="secundario">${esc(f.r.cargo)}</div></div></div></td>
              <td class="num">${f.procesos}</td>
              <td><div class="barra__pista" tabindex="0" data-tip="${esc(f.r.nombre)}" data-tip-detalle="${f.abiertas} actividades abiertas"><span class="barra__relleno" style="width:${(f.abiertas / maxAb) * 80}%"></span><span class="barra__valor">${f.abiertas}</span></div></td>
              <td class="num">${f.vencidas ? `<span class="chip chip--critico">⚠ ${f.vencidas}</span>` : '<span class="secundario">0</span>'}</td>
              <td><div class="progreso-check"><div class="progreso"><span style="width:${f.avance * 100}%"></span></div>${pct(f.avance)}</div></td>
            </tr>`).join('')}</tbody></table></div>
        </section>`;
      $('#f-categoria', v).addEventListener('change', (e) => { vistas.gerencia.filtro = e.target.value; renderizar(); });
    }
  };

  // ---------- Cartera / Mis procesos
  function vistaProcesos(v) {
    const f = vistaProcesos.f || (vistaProcesos.f = { texto: '', categoria: '', estado: '', responsable: '' });
    const lista = procesosVisibles().filter((p) =>
      (!f.categoria || p.categoria === f.categoria) && (!f.estado || p.estado === f.estado) &&
      (!f.responsable || p.responsable === f.responsable) &&
      (!f.texto || normal(`${p.codigo} ${p.denominacion} ${p.procedimiento}`).includes(normal(f.texto))));
    v.innerHTML = `
      <div class="barra-filtros">
        <label>Buscar<input type="search" id="f-texto" value="${esc(f.texto)}" placeholder="Código o denominación"></label>
        <label>Categoría<select id="f-categoria"><option value="">Todas</option>${SEMILLA.categorias.map((c) => `<option ${c.nombre === f.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
        <label>Estado<select id="f-estado"><option value="">Todos</option>${SEMILLA.ESTADOS_PROCESO.map((e) => `<option ${e === f.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
        ${esGerente() ? `<label>Responsable<select id="f-responsable"><option value="">Todos</option>${SEMILLA.responsables.map((r) => `<option value="${r.codigo}" ${r.codigo === f.responsable ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></label>` : ''}
        <span class="espacio"></span>
        ${esGerente() ? '' : '<a class="btn btn--primario" href="#plantillas">+ Generar proceso desde plantilla</a>'}
      </div>
      <section class="tarjeta"><div class="tabla-envoltura"><table class="tabla">
        <thead><tr><th>Código</th><th>Denominación</th><th>Categoría / Procedimiento</th>${esGerente() ? '<th>Responsable</th>' : ''}<th>Estado</th><th class="num">Actividades</th><th style="width:140px">Avance</th><th class="num">Trámites SGD</th></tr></thead>
        <tbody>${lista.map((p) => {
          const acts = actividadesDe(p.codigo); const ab = acts.filter(abierta); const ve = ab.filter((a) => vencimiento(a).tipo === 'vencida').length;
          return `<tr>
            <td class="mono"><button class="enlace" data-proceso="${p.codigo}">${p.codigo}</button></td>
            <td><strong>${esc(p.denominacion)}</strong><div class="secundario">Inicio: ${fmtFecha(p.fechaInicio)} · ${chipPrioridad(p.prioridad)}</div></td>
            <td>${esc(p.categoria)}<div class="secundario">${esc(p.procedimiento)}</div></td>
            ${esGerente() ? `<td>${esc(responsable(p.responsable).nombre)}</td>` : ''}
            <td>${chipEstado(p.estado)}</td>
            <td class="num">${ab.length}/${acts.length}${ve ? ` <span class="chip chip--critico" title="Actividades vencidas">⚠ ${ve}</span>` : ''}</td>
            <td><div class="progreso-check"><div class="progreso"><span style="width:${avance(p.codigo) * 100}%"></span></div>${pct(avance(p.codigo))}</div></td>
            <td class="num">${tramitesDe(p.codigo).length}</td></tr>`;
        }).join('') || '<tr><td colspan="8" class="vacio">No hay procesos con los criterios indicados.</td></tr>'}</tbody></table></div></section>`;
    const enlazar = (id, k) => { const el = $(id, v); if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', (e) => { f[k] = e.target.value; vistaProcesos(v); if (k === 'texto') { const i = $('#f-texto', v); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); };
    enlazar('#f-texto', 'texto'); enlazar('#f-categoria', 'categoria'); enlazar('#f-estado', 'estado'); enlazar('#f-responsable', 'responsable');
  }
  vistas.cartera = { titulo: 'Cartera de procesos', subtitulo: 'Todos los procesos legales de la entidad', rol: 'gerente', render: vistaProcesos };
  vistas.procesos = { titulo: 'Mis procesos', subtitulo: 'Procesos legales bajo su responsabilidad', rol: 'responsable', render: vistaProcesos };

  // ---------- Responsable: mi panel
  vistas.panel = {
    titulo: 'Mi panel', subtitulo: 'Resumen de sus procesos, actividades y trámites SGD', rol: 'responsable',
    render(v) {
      const procs = procesosVisibles(); const activos = procs.filter(enCurso);
      const abiertas = actividadesVisibles().filter(abierta);
      const vencidas = abiertas.filter((a) => vencimiento(a).tipo === 'vencida');
      const semana = abiertas.filter((a) => vencimiento(a).tipo === 'proxima');
      const tram = tramitesVisibles().slice().sort((a, b) => b.fechaCaptura.localeCompare(a.fechaCaptura));
      const tram30 = tram.filter((t) => (HOY - new Date(t.fechaCaptura)) / 86400000 <= 30);
      const prioridades = abiertas.slice().sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite)).slice(0, 7);
      const r = responsable(perfil.responsable);

      v.innerHTML = `
        <div class="rejilla rejilla--kpi">
          ${kpi('Procesos en curso', activos.length, `${procs.length - activos.length} finalizado(s)`)}
          ${kpi('Actividades abiertas', abiertas.length, `${actividadesVisibles().length} actividades en total`)}
          ${kpi('Actividades vencidas', vencidas.length, 'Requieren atención inmediata', vencidas.length ? 'kpi--critico' : '')}
          ${kpi('Vencen en 7 días', semana.length, 'Programe su atención')}
          ${kpi('Trámites SGD recibidos', tram30.length, 'Últimos 30 días')}
        </div>
        <div class="rejilla rejilla--3-1">
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Mis prioridades</h2><p>Actividades abiertas ordenadas por fecha límite</p></div><a class="btn btn--sm" href="#tablero">Ver tablero</a></div>
            ${prioridades.length ? `<ul class="lista">${prioridades.map((a) => `<li>
              <div class="lista__cuerpo"><button class="enlace lista__titulo" data-actividad="${a.clave}">${esc(a.clave)} · ${esc(a.titulo)}</button>
              <div class="lista__meta">${esc(a.procesoCodigo)} · ${esc(a.fase)} · ${chipPrioridad(a.prioridad)}</div></div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${chipEstado(a.estado)}${chipVence(a)}</div></li>`).join('')}</ul>` : '<p class="vacio">No tiene actividades abiertas.</p>'}
          </section>
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Últimos trámites SGD indexados</h2><p>Documentos vinculados a sus procesos</p></div><a class="btn btn--sm" href="#sgd">Ver todos</a></div>
            ${tram.length ? `<ul class="lista">${tram.slice(0, 6).map((t) => `<li><div class="lista__cuerpo">
              <div class="lista__titulo">${esc(t.asunto)}</div>
              <div class="lista__meta"><span class="mono">${esc(t.nroExpediente || t.nroRegistro)}</span> · ${esc(t.vinculacion.procesoCodigo)} · ${fmtFecha(t.fechaCaptura)}</div>
              <a href="${esc(t.enlaceSgd)}" target="_blank" rel="noopener" class="secundario">Abrir en el SGD ↗</a></div></li>`).join('')}</ul>` : '<p class="vacio">Sin trámites indexados.</p>'}
          </section>
        </div>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Avance de mis procesos en curso</h2><p>Porcentaje de la lista de verificación completada · ${esc(r.nombre)}</p></div></div>
          ${barrasH(activos.map((p) => ({ etiqueta: `${p.codigo} · ${p.denominacion}`, valor: Math.round(avance(p.codigo) * 100), detalle: `${pct(avance(p.codigo))} completado · ${p.estado}` })), { unidad: '%' })}
        </section>`;
    }
  };

  // ---------- Responsable: tablero kanban
  vistas.tablero = {
    titulo: 'Tablero de actividades', subtitulo: 'Gestione sus actividades por estado: arrastre las fichas entre columnas', rol: 'responsable',
    render(v) {
      const f = vistas.tablero.f || (vistas.tablero.f = { proceso: '', prioridad: '', texto: '', soloVencidas: false });
      const procs = procesosVisibles();
      const lista = actividadesVisibles().filter((a) =>
        (!f.proceso || a.procesoCodigo === f.proceso) && (!f.prioridad || a.prioridad === f.prioridad) &&
        (!f.soloVencidas || vencimiento(a).tipo === 'vencida') &&
        (!f.texto || normal(`${a.clave} ${a.titulo} ${a.procesoCodigo}`).includes(normal(f.texto))));

      v.innerHTML = `
        <div class="barra-filtros">
          <label>Buscar<input type="search" id="k-texto" value="${esc(f.texto)}" placeholder="Clave o título"></label>
          <label>Proceso<select id="k-proceso"><option value="">Todos mis procesos</option>${procs.map((p) => `<option value="${p.codigo}" ${p.codigo === f.proceso ? 'selected' : ''}>${p.codigo} · ${esc(p.denominacion.slice(0, 48))}</option>`).join('')}</select></label>
          <label>Prioridad<select id="k-prioridad"><option value="">Todas</option>${SEMILLA.PRIORIDADES.map((p) => `<option ${p === f.prioridad ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label style="flex-direction:row;align-items:center;gap:6px;padding-bottom:8px"><input type="checkbox" id="k-vencidas" ${f.soloVencidas ? 'checked' : ''}> Solo vencidas</label>
          <span class="espacio"></span>
          <button class="btn btn--primario" id="k-nueva">+ Nueva actividad</button>
        </div>
        <div class="kanban">${SEMILLA.ESTADOS_ACTIVIDAD.map((estado) => {
          const col = lista.filter((a) => a.estado === estado).sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));
          return `<section class="kanban__col" aria-label="${estado}">
            <div class="kanban__cab"><span>${estado}</span><span class="cuenta">${col.length}</span></div>
            <div class="kanban__lista" data-estado="${estado}">${col.map(ficha).join('') || ''}</div></section>`;
        }).join('')}</div>`;

      const re = (k, ev) => (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; vistas.tablero.render(v); if (ev === 'input') { const i = $('#k-texto', v); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
      $('#k-texto', v).addEventListener('input', re('texto', 'input'));
      $('#k-proceso', v).addEventListener('change', re('proceso'));
      $('#k-prioridad', v).addEventListener('change', re('prioridad'));
      $('#k-vencidas', v).addEventListener('change', re('soloVencidas'));
      $('#k-nueva', v).addEventListener('click', () => modalNuevaActividad(f.proceso));

      // Arrastrar y soltar
      $$('.ficha[draggable=true]', v).forEach((el) => {
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.actividad); el.classList.add('arrastrando'); });
        el.addEventListener('dragend', () => el.classList.remove('arrastrando'));
      });
      $$('.kanban__lista', v).forEach((zona) => {
        zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
        zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
        zona.addEventListener('drop', (e) => {
          e.preventDefault(); zona.classList.remove('sobre');
          const a = D.actividades.find((x) => x.clave === e.dataTransfer.getData('text/plain'));
          if (a) cambiarEstadoActividad(a, zona.dataset.estado, () => vistas.tablero.render(v));
        });
      });
    }
  };

  function ficha(a) {
    const p = proceso(a.procesoCodigo);
    const bloqueada = p && p.estado === 'Finalizado';
    const hechos = a.checklist.filter((i) => i.hecho).length;
    const sgd = D.tramites.filter((t) => t.vinculacion.actividadClave === a.clave).length;
    const v = vencimiento(a);
    return `<div role="button" tabindex="0" class="ficha ${bloqueada ? 'ficha--bloqueada' : ''}" data-actividad="${a.clave}" draggable="${!bloqueada}" ${bloqueada ? 'title="Proceso finalizado: solo consulta"' : ''}>
      <span class="ficha__titulo">${esc(a.titulo)}</span>
      <span class="ficha__proceso">${esc(a.procesoCodigo)} · ${esc(p ? p.denominacion : '')}</span>
      <span class="ficha__pie">
        <span class="ficha__clave">${esc(a.clave)}</span>
        ${chipPrioridad(a.prioridad)}
        <span class="espacio"></span>
        ${a.checklist.length ? `<span class="indicador" title="Lista de verificación">☑ ${hechos}/${a.checklist.length}</span>` : ''}
        ${sgd ? `<span class="indicador" title="Trámites SGD vinculados">📄 ${sgd}</span>` : ''}
        ${bloqueada ? '<span class="indicador" title="Proceso finalizado">🔒</span>' : ''}
      </span>
      ${v.tipo !== 'cumplida' ? `<span class="ficha__pie"><span class="vence--${v.tipo}">${v.tipo === 'vencida' ? '⚠ ' : v.tipo === 'proxima' ? '◷ ' : ''}${esc(v.texto)}</span></span>` : ''}
    </div>`;
  }

  /**
   * Regla: las actividades de un proceso finalizado no se modifican. Concluir con
   * ítems pendientes en la lista de verificación requiere confirmación.
   * `despues` se ejecuta cuando el cambio se aplica.
   */
  function cambiarEstadoActividad(a, estado, despues) {
    if (a.estado === estado) return;
    const p = proceso(a.procesoCodigo);
    if (p && p.estado === 'Finalizado') { notificar('El proceso está finalizado: sus actividades son de solo consulta.'); return; }
    const aplicar = () => {
      a.comentarios.push({ autor: actor(), fecha: isoDia(new Date()), texto: `Cambió el estado de «${a.estado}» a «${estado}».`, sistema: true });
      a.estado = estado;
      if (p && p.estado === 'Registrado' && estado !== 'Pendiente') p.estado = 'En trámite';
      guardar();
      if (despues) despues();
    };
    const pendientes = a.checklist.filter((i) => !i.hecho).length;
    if (estado === 'Concluida' && pendientes) {
      confirmar(`La lista de verificación de ${a.clave} tiene ${pendientes} ítem(s) pendiente(s). ¿Desea concluir la actividad de todos modos?`, 'Concluir actividad', aplicar);
      return;
    }
    aplicar();
  }

  /** Confirmación dentro de la página (los diálogos nativos no están disponibles en todos los entornos). */
  function confirmar(texto, textoAceptar, alAceptar) {
    const caja = $('#confirmacion');
    $('#confirmacion-texto').textContent = texto;
    const aceptar = $('#confirmacion-aceptar');
    aceptar.textContent = textoAceptar;
    const previo = document.activeElement;
    const cerrar = () => { caja.hidden = true; aceptar.onclick = null; if (previo && document.body.contains(previo)) previo.focus(); };
    aceptar.onclick = () => { cerrar(); alAceptar(); };
    $$('[data-cancelar]', caja).forEach((b) => { b.onclick = cerrar; });
    caja.hidden = false;
    aceptar.focus();
  }

  const actor = () => esGerente() ? SEMILLA.gerente.nombre : responsable(perfil.responsable).nombre;

  // ---------- Responsable: plantillas
  vistas.plantillas = {
    titulo: 'Plantillas de procesos', subtitulo: 'Modelos institucionales de fases, actividades y listas de verificación', rol: 'responsable',
    render(v) {
      v.innerHTML = `
        <div class="aviso aviso--info">Al generar un proceso desde una plantilla se crean automáticamente sus actividades en el tablero, con plazos calculados desde la fecha de inicio.</div>
        <div class="rejilla rejilla--plantillas">${D.plantillas.map((t) => {
          const acts = t.fases.flatMap((f) => f.actividades);
          const dias = acts.reduce((s, x) => s + x.plazoDias, 0);
          const usos = D.procesos.filter((p) => p.plantillaId === t.id).length;
          return `<article class="tarjeta plantilla">
            <div class="secundario mono">${t.id}</div>
            <h3>${esc(t.nombre)}</h3>
            <p>${esc(t.descripcion)}</p>
            <div class="plantilla__meta">
              <span class="chip">${esc(t.categoria)}</span>
              <span class="chip">${t.fases.length} fases</span>
              <span class="chip">${acts.length} actividades</span>
              <span class="chip">Plazo referencial: ${dias} días</span>
              <span class="chip">${usos} proceso(s) generados</span>
            </div>
            <div class="secundario">Procedimientos: ${t.procedimientos.map(esc).join(' · ')}</div>
            <details><summary class="enlace" style="margin-top:10px;cursor:pointer">Ver fases y actividades</summary>
              <ol class="fases">${t.fases.map((f) => `<li><strong>${esc(f.nombre)}</strong><ul>${f.actividades.map((x) => `<li>${esc(x.titulo)} <span class="secundario">· ${x.plazoDias} d · ☑ ${x.checklist.length}</span></li>`).join('')}</ul></li>`).join('')}</ol>
            </details>
            <div class="plantilla__acciones"><button class="btn btn--primario btn--sm" data-generar="${t.id}">Generar proceso</button></div>
          </article>`;
        }).join('')}</div>`;
      $$('[data-generar]', v).forEach((b) => b.addEventListener('click', () => modalGenerarProceso(b.dataset.generar)));
    }
  };

  // ---------- Trámites SGD indexados
  vistas.sgd = {
    titulo: 'Trámites SGD indexados', subtitulo: 'Documentos del Sistema de Gestión Documental vinculados a procesos, con su ruta de acceso directo',
    render(v) {
      const f = vistas.sgd.f || (vistas.sgd.f = { texto: '', proceso: '', modo: '' });
      const lista = tramitesVisibles().filter((t) =>
        (!f.proceso || t.vinculacion.procesoCodigo === f.proceso) && (!f.modo || t.vinculacion.modo === f.modo) &&
        (!f.texto || normal(`${t.nroExpediente} ${t.nroRegistro} ${t.nroDocumento} ${t.asunto} ${t.remitente}`).includes(normal(f.texto))))
        .sort((a, b) => b.fechaCaptura.localeCompare(a.fechaCaptura));
      v.innerHTML = `
        <div class="barra-filtros">
          <label>Buscar<input type="search" id="s-texto" value="${esc(f.texto)}" placeholder="Expediente, documento, asunto…"></label>
          <label>Proceso<select id="s-proceso"><option value="">Todos</option>${procesosVisibles().map((p) => `<option value="${p.codigo}" ${p.codigo === f.proceso ? 'selected' : ''}>${p.codigo}</option>`).join('')}</select></label>
          <label>Tipo de vinculación<select id="s-modo"><option value="">Todas</option><option value="nuevo" ${f.modo === 'nuevo' ? 'selected' : ''}>Generó proceso</option><option value="anexo" ${f.modo === 'anexo' ? 'selected' : ''}>Anexado a proceso</option></select></label>
          <span class="espacio"></span>
          <label class="btn archivo">Importar desde Conector SGD<input type="file" id="s-importar" accept="application/json"></label>
          <button class="btn" id="s-catalogo" title="Archivo para importar en la configuración de la extensión">Exportar catálogo para el Conector</button>
        </div>
        <section class="tarjeta"><div class="tabla-envoltura"><table class="tabla">
          <thead><tr><th>Expediente / Registro</th><th>Documento</th><th>Asunto</th><th>Proceso vinculado</th><th>Actividad</th><th>Indexado</th><th>Ruta en el SGD</th></tr></thead>
          <tbody>${lista.map((t) => {
            const p = proceso(t.vinculacion.procesoCodigo);
            const a = D.actividades.find((x) => x.clave === t.vinculacion.actividadClave);
            return `<tr>
              <td class="mono"><strong>${esc(t.nroExpediente || '—')}</strong><div class="secundario">Reg. ${esc(t.nroRegistro || '—')}</div></td>
              <td style="min-width:170px">${esc(t.tipoDocumento)}<div class="secundario">${esc(t.nroDocumento)}</div><div class="secundario">${esc(t.remitente)} · ${t.fechaDocumento ? fmtFecha(t.fechaDocumento) : ''}</div></td>
              <td style="min-width:220px">${esc(t.asunto)}<div class="secundario">“${esc(t.asuntoVinculacion)}”</div></td>
              <td><button class="enlace mono" data-proceso="${esc(t.vinculacion.procesoCodigo)}">${esc(t.vinculacion.procesoCodigo)}</button><div class="secundario">${t.vinculacion.modo === 'nuevo' ? 'Generó el proceso' : 'Anexado'}${p ? ` · ${chipEstado(p.estado)}` : ''}</div></td>
              <td>${a ? `<button class="enlace" data-actividad="${a.clave}">${esc(a.clave)}</button><div class="secundario">${esc(a.titulo)}</div>` : '<span class="secundario">—</span>'}</td>
              <td class="secundario" style="white-space:nowrap">${fmtFecha(t.fechaCaptura)}</td>
              <td><div class="ruta"><a class="btn btn--sm" href="${esc(t.enlaceSgd)}" target="_blank" rel="noopener">Abrir ↗</a><button class="btn-icono" title="Copiar ruta" data-copiar="${esc(t.enlaceSgd)}">⧉</button></div><code class="ruta__url" title="${esc(t.enlaceSgd)}">${esc(t.enlaceSgd)}</code></td>
            </tr>`;
          }).join('') || '<tr><td colspan="7" class="vacio">No hay trámites indexados con los criterios indicados.</td></tr>'}</tbody></table></div></section>`;
      const re = (k, ev) => (e) => { f[k] = e.target.value; vistas.sgd.render(v); if (ev) { const i = $('#s-texto', v); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
      $('#s-texto', v).addEventListener('input', re('texto', true));
      $('#s-proceso', v).addEventListener('change', re('proceso'));
      $('#s-modo', v).addEventListener('change', re('modo'));
      $('#s-importar', v).addEventListener('change', importarConector);
      $('#s-catalogo', v).addEventListener('click', exportarCatalogo);
    }
  };

  // ============================================================ intercambio
  /**
   * Incorpora procesos y trámites capturados por el Conector SGD (archivo JSON o
   * base de datos del servidor). Es idempotente: lo ya incorporado se omite.
   */
  function incorporarPaquete(paquete) {
    const remapeo = D.remapeoConector || (D.remapeoConector = {});
    const omitidos = D.tramitesOmitidos || (D.tramitesOmitidos = []);
    let procesosNuevos = 0, tramitesNuevos = 0, rechazados = 0;
    (paquete.procesosRegistrados || []).forEach((pr) => {
      if (remapeo[pr.codigo]) return;
      const existente = proceso(pr.codigo);
      if (existente && existente.denominacion === pr.denominacion) return;
      const codigo = existente ? siguienteCodigoProceso() : pr.codigo;
      if (existente) remapeo[pr.codigo] = codigo;
      const plt = plantillaDe(pr.procedimiento) || D.plantillas[0];
      const nuevo = { codigo, denominacion: pr.denominacion, categoria: pr.categoria, procedimiento: pr.procedimiento, responsable: pr.responsable, estado: 'Registrado', prioridad: 'Media', fechaInicio: pr.fechaInicio || isoDia(HOY), plantillaId: plt.id, origen: 'Conector SGD' };
      D.procesos.push(nuevo);
      instanciarPlantilla(nuevo, plt);
      procesosNuevos++;
    });
    (paquete.tramitesIndexados || []).forEach((t) => {
      if (D.tramites.some((x) => x.id === t.id) || omitidos.includes(t.id)) return;
      const codigo = remapeo[t.vinculacion.procesoCodigo] || t.vinculacion.procesoCodigo;
      const p = proceso(codigo);
      if (!p || (p.estado === 'Finalizado' && t.vinculacion.modo === 'anexo')) { omitidos.push(t.id); rechazados++; return; }
      const act = actividadesDe(codigo).find(abierta);
      D.tramites.push({ ...t, vinculacion: { ...t.vinculacion, procesoCodigo: codigo, actividadClave: act ? act.clave : null } });
      tramitesNuevos++;
    });
    if (procesosNuevos || tramitesNuevos || rechazados) guardar();
    return { procesosNuevos, tramitesNuevos, rechazados };
  }

  const resumenIncorporacion = (r) => `${r.tramitesNuevos} trámite(s) y ${r.procesosNuevos} proceso(s) nuevos${r.rechazados ? `; ${r.rechazados} omitido(s) por proceso inexistente o finalizado` : ''}`;

  async function importarConector(ev) {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    let paquete;
    try { paquete = JSON.parse(await archivo.text()); } catch (e) { notificar('El archivo no es un JSON válido.'); return; }
    if (paquete.formato !== 'legal-sgd-intercambio') { notificar('El archivo no corresponde a una exportación del Conector SGD.'); return; }
    const r = incorporarPaquete(paquete);
    renderizar();
    notificar(`Importación completada: ${resumenIncorporacion(r)}.`);
  }

  /** Trae de la base de datos del servidor las vinculaciones registradas por el Conector. */
  async function sincronizarConector() {
    try {
      const r = await fetch('/api/vinculaciones', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const res = incorporarPaquete(await r.json());
      pintarEstadoBd(true);
      if (res.procesosNuevos || res.tramitesNuevos) {
        renderizar();
        notificar(`Conector SGD: se incorporaron ${resumenIncorporacion(res)}.`);
      }
    } catch (e) {
      pintarEstadoBd(false);
    }
  }

  function pintarEstadoBd(ok) {
    const el = $('#estado-bd');
    if (!el) return;
    if (!servidor) { el.textContent = 'Datos guardados en este navegador'; return; }
    const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = ok ? `● BD de prueba conectada · ${hora}` : '○ BD de prueba sin conexión';
    el.title = ok ? `${servidor.nombre} · ${servidor.bd.ruta}` : 'Verifique que LEGAL-Prueba esté en ejecución';
  }

  function exportarCatalogo() {
    const catalogo = {
      categorias: SEMILLA.categorias.map(({ codigo, nombre, procedimientos }) => ({ codigo, nombre, procedimientos })),
      responsables: SEMILLA.responsables.map(({ codigo, nombre, cargo }) => ({ codigo, nombre, cargo })),
      procesos: D.procesos.map(({ codigo, denominacion, categoria, procedimiento, responsable: r, estado, fechaInicio }) => ({ codigo, denominacion, categoria, procedimiento, responsable: r, estado, fechaInicio }))
    };
    const json = JSON.stringify(catalogo, null, 2);
    const nombre = `legal-catalogo-procesos-${isoDia(HOY)}.json`;
    abrirModal(`
      <div class="modal__cab"><div><div class="modal__clave">${catalogo.procesos.length} procesos · ${catalogo.responsables.length} responsables</div><h2 id="modal-titulo">Catálogo para el Conector SGD</h2></div><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="modal__cuerpo modal__cuerpo--simple formulario">
        <p class="secundario">Importe este catálogo en la Configuración de la extensión (paso 4, «Importar catálogo»). Si la descarga no está disponible en su navegador, copie el contenido y guárdelo como <span class="mono">${nombre}</span>.</p>
        <textarea id="catalogo-json" class="mono" rows="12" readonly>${esc(json)}</textarea>
        <div class="modal__pie" style="padding:0">
          <button type="button" class="btn" id="catalogo-copiar">Copiar contenido</button>
          <button type="button" class="btn btn--primario" id="catalogo-descargar">Descargar archivo</button>
        </div>
      </div>`, true);
    $('#catalogo-copiar').addEventListener('click', () => {
      navigator.clipboard.writeText(json).then(() => notificar('Catálogo copiado al portapapeles.'))
        .catch(() => { const t = $('#catalogo-json'); t.focus(); t.select(); notificar('Seleccione y copie el contenido con Ctrl+C.'); });
    });
    $('#catalogo-descargar').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  // ================================================================= modales
  let focoPrevio = null;
  function abrirModal(html, angosta) {
    focoPrevio = document.activeElement;
    $('#modal-contenido').innerHTML = html;
    $('.modal__caja').classList.toggle('modal__caja--angosta', Boolean(angosta));
    $('#modal').hidden = false;
    const primero = $('#modal [autofocus]') || $('#modal .modal__caja button, #modal .modal__caja input');
    if (primero) primero.focus();
  }
  function cerrarModal() {
    $('#modal').hidden = true;
    $('#modal-contenido').innerHTML = '';
    if (focoPrevio && document.body.contains(focoPrevio)) focoPrevio.focus();
  }

  function modalActividad(clave) {
    const a = D.actividades.find((x) => x.clave === clave);
    if (!a) return;
    const p = proceso(a.procesoCodigo);
    const bloqueada = p && p.estado === 'Finalizado';
    const editable = !bloqueada && !esGerente();
    const hechos = a.checklist.filter((i) => i.hecho).length;
    const sgd = D.tramites.filter((t) => t.vinculacion.actividadClave === a.clave);
    const sgdProceso = tramitesDe(a.procesoCodigo).filter((t) => t.vinculacion.actividadClave !== a.clave);
    const dis = editable ? '' : 'disabled';

    abrirModal(`
      <div class="modal__cab">
        <div style="flex:1;min-width:0">
          <div class="modal__clave"><span>${esc(a.procesoCodigo)}</span>/<span>${esc(a.clave)}</span>${bloqueada ? '<span class="chip">🔒 Proceso finalizado · solo consulta</span>' : ''}</div>
          <input id="m-titulo" class="titulo-editable" value="${esc(a.titulo)}" ${dis} aria-label="Título de la actividad">
        </div>
        <button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <div class="modal__cuerpo">
        <div>
          <div class="seccion"><h3>Descripción</h3><textarea id="m-descripcion" rows="3" ${dis}>${esc(a.descripcion)}</textarea></div>
          <div class="seccion">
            <h3><span>Lista de verificación</span><span class="secundario">${hechos}/${a.checklist.length}</span></h3>
            <div class="progreso-check"><div class="progreso"><span style="width:${a.checklist.length ? (hechos / a.checklist.length) * 100 : 0}%"></span></div>${a.checklist.length ? pct(hechos / a.checklist.length) : '0 %'}</div>
            <ul class="checklist">${a.checklist.map((i, n) => `<li class="${i.hecho ? 'hecho' : ''}"><label><input type="checkbox" data-check="${n}" ${i.hecho ? 'checked' : ''} ${dis}><span>${esc(i.texto)}</span></label>${editable ? `<button class="btn-icono quitar" data-quitar-check="${n}" aria-label="Quitar ítem">✕</button>` : ''}</li>`).join('')}</ul>
            ${editable ? '<form class="agregar" id="m-agregar"><input id="m-nuevo-item" placeholder="Agregar ítem a la lista de verificación"><button class="btn btn--sm">Agregar</button></form>' : ''}
          </div>
          <div class="seccion">
            <h3>Trámites SGD vinculados</h3>
            ${sgd.length ? sgd.map(tarjetaSgd).join('') : '<p class="secundario">No hay trámites SGD vinculados a esta actividad.</p>'}
            ${sgdProceso.length ? `<details><summary class="enlace" style="cursor:pointer;margin-top:6px">Otros trámites del proceso (${sgdProceso.length})</summary>${sgdProceso.map(tarjetaSgd).join('')}</details>` : ''}
          </div>
          <div class="seccion">
            <h3>Bitácora y comentarios</h3>
            ${a.comentarios.map((c) => `<div class="comentario"><span class="avatar avatar--sm">${esc(c.autor.split(' ').filter((x) => !/\./.test(x)).slice(0, 2).map((x) => x[0]).join(''))}</span><div class="comentario__cuerpo"><div class="comentario__meta"><strong>${esc(c.autor)}</strong> · ${fmtFecha(c.fecha)}</div>${c.sistema ? `<em class="secundario">${esc(c.texto)}</em>` : esc(c.texto)}</div></div>`).join('') || '<p class="secundario">Sin comentarios.</p>'}
            ${bloqueada ? '' : '<form class="agregar" id="m-comentar"><input id="m-comentario" placeholder="Escriba un comentario u observación"><button class="btn btn--sm">Comentar</button></form>'}
          </div>
        </div>
        <aside>
          <div class="campos">
            <label>Estado<select id="m-estado" ${bloqueada || esGerente() ? 'disabled' : ''}>${SEMILLA.ESTADOS_ACTIVIDAD.map((e) => `<option ${e === a.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
            <label>Prioridad<select id="m-prioridad" ${dis}>${SEMILLA.PRIORIDADES.map((e) => `<option ${e === a.prioridad ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
            <label>Fecha límite<input type="date" id="m-limite" value="${a.fechaLimite}" ${dis}><span>${chipVence(a)}</span></label>
            <label>Responsable<span class="valor">${esc(responsable(a.responsable).nombre)}</span></label>
            <label>Proceso<span class="valor"><button class="enlace" data-proceso="${esc(a.procesoCodigo)}">${esc(a.procesoCodigo)}</button> · ${esc(p ? p.denominacion : '')}</span></label>
            <label>Fase<span class="valor">${esc(a.fase || '—')}</span></label>
            <label>Procedimiento<span class="valor">${esc(p ? p.procedimiento : '')}</span></label>
          </div>
          ${esGerente() ? '<p class="secundario" style="margin-top:10px">Perfil Gerencia: vista de consulta. Puede registrar comentarios.</p>' : ''}
        </aside>
      </div>`);

    const caja = $('#modal-contenido');
    const persistir = () => { guardar(); renderizar(); };
    const reabrir = () => { persistir(); modalActividad(clave); };
    const t = $('#m-titulo', caja); if (t) t.addEventListener('change', (e) => { a.titulo = e.target.value.trim() || a.titulo; persistir(); });
    $('#m-descripcion', caja).addEventListener('change', (e) => { a.descripcion = e.target.value; persistir(); });
    $('#m-prioridad', caja).addEventListener('change', (e) => { a.prioridad = e.target.value; reabrir(); });
    $('#m-limite', caja).addEventListener('change', (e) => { if (e.target.value) { a.fechaLimite = e.target.value; reabrir(); } });
    $('#m-estado', caja).addEventListener('change', (e) => {
      const elegido = e.target.value;
      e.target.value = a.estado;
      cambiarEstadoActividad(a, elegido, () => { renderizar(); modalActividad(clave); });
    });
    $$('[data-check]', caja).forEach((c) => c.addEventListener('change', () => { a.checklist[+c.dataset.check].hecho = c.checked; reabrir(); }));
    $$('[data-quitar-check]', caja).forEach((b) => b.addEventListener('click', () => { a.checklist.splice(+b.dataset.quitarCheck, 1); reabrir(); }));
    const ag = $('#m-agregar', caja);
    if (ag) ag.addEventListener('submit', (e) => { e.preventDefault(); const txt = $('#m-nuevo-item', caja).value.trim(); if (!txt) return; a.checklist.push({ texto: txt, hecho: false }); reabrir(); $('#m-nuevo-item').focus(); });
    const co = $('#m-comentar', caja);
    if (co) co.addEventListener('submit', (e) => { e.preventDefault(); const txt = $('#m-comentario', caja).value.trim(); if (!txt) return; a.comentarios.push({ autor: actor(), fecha: isoDia(new Date()), texto: txt }); reabrir(); });
  }

  function tarjetaSgd(t) {
    return `<div class="sgd-vinculo">
      <div style="display:flex;justify-content:space-between;gap:8px"><strong class="mono">${esc(t.nroExpediente || t.nroRegistro)}</strong><a href="${esc(t.enlaceSgd)}" target="_blank" rel="noopener">Abrir en el SGD ↗</a></div>
      <div>${esc(t.tipoDocumento)} · ${esc(t.nroDocumento)}</div>
      <div class="secundario">${esc(t.asunto)}</div>
      <div class="secundario">Indexado el ${fmtFechaHora(t.fechaCaptura)} · “${esc(t.asuntoVinculacion)}”</div>
    </div>`;
  }

  function modalProceso(codigo) {
    const p = proceso(codigo);
    if (!p) return;
    const acts = actividadesDe(codigo);
    const tram = tramitesDe(codigo);
    const abiertas = acts.filter(abierta).length;
    const puedeEditar = !esGerente() && p.responsable === perfil.responsable;
    const plt = plantilla(p.plantillaId);
    abrirModal(`
      <div class="modal__cab">
        <div><div class="modal__clave">${esc(p.codigo)} ${chipEstado(p.estado)}</div><h2 id="modal-titulo">${esc(p.denominacion)}</h2></div>
        <button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <div class="modal__cuerpo">
        <div>
          <div class="seccion"><h3><span>Actividades</span><span class="secundario">${acts.length - abiertas}/${acts.length} concluidas</span></h3>
            <div class="progreso-check"><div class="progreso"><span style="width:${avance(codigo) * 100}%"></span></div>${pct(avance(codigo))} de la lista de verificación</div>
            <ul class="lista">${acts.map((a) => `<li><div class="lista__cuerpo"><button class="enlace lista__titulo" data-actividad="${a.clave}">${esc(a.clave)} · ${esc(a.titulo)}</button><div class="lista__meta">${esc(a.fase)} · ☑ ${a.checklist.filter((i) => i.hecho).length}/${a.checklist.length}</div></div><div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${chipEstado(a.estado)}${abierta(a) ? chipVence(a) : ''}</div></li>`).join('')}</ul>
          </div>
          <div class="seccion"><h3>Trámites SGD indexados (${tram.length})</h3>${tram.map(tarjetaSgd).join('') || '<p class="secundario">Sin trámites indexados.</p>'}</div>
        </div>
        <aside><div class="campos">
          <label>Estado del proceso${puedeEditar ? `<select id="p-estado">${SEMILLA.ESTADOS_PROCESO.map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>` : `<span class="valor">${esc(p.estado)}</span>`}</label>
          <label>Categoría<span class="valor">${esc(p.categoria)}</span></label>
          <label>Procedimiento<span class="valor">${esc(p.procedimiento)}</span></label>
          <label>Responsable<span class="valor">${esc(responsable(p.responsable).nombre)}</span></label>
          <label>Prioridad<span class="valor">${chipPrioridad(p.prioridad)}</span></label>
          <label>Fecha de inicio<span class="valor">${fmtFecha(p.fechaInicio)}</span></label>
          ${p.fechaFin ? `<label>Fecha de finalización<span class="valor">${fmtFecha(p.fechaFin)}</span></label>` : ''}
          <label>Plantilla<span class="valor">${plt ? `${plt.id} · ${esc(plt.nombre)}` : '—'}</span></label>
          ${p.origen ? `<label>Origen<span class="valor">${esc(p.origen)}</span></label>` : ''}
        </div>
        ${p.estado === 'Finalizado' ? '<p class="secundario" style="margin-top:10px">🔒 Proceso finalizado: no admite nuevas actividades ni la incorporación de trámites SGD.</p>' : ''}
        </aside>
      </div>`);
    const sel = $('#p-estado');
    if (sel) sel.addEventListener('change', (e) => {
      const nuevo = e.target.value;
      if (nuevo === 'Finalizado' && abiertas) {
        notificar(`No es posible finalizar: el proceso tiene ${abiertas} actividad(es) abierta(s).`);
        e.target.value = p.estado; return;
      }
      p.estado = nuevo;
      if (nuevo === 'Finalizado') p.fechaFin = isoDia(HOY); else delete p.fechaFin;
      guardar(); renderizar(); modalProceso(codigo);
    });
  }

  function modalNuevaActividad(procesoPreferido) {
    const procs = procesosVisibles().filter(enCurso);
    if (!procs.length) { notificar('No tiene procesos en curso.'); return; }
    abrirModal(`
      <div class="modal__cab"><h2 id="modal-titulo">Nueva actividad</h2><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
      <form id="f-nueva" class="modal__cuerpo modal__cuerpo--simple formulario">
        <label>Título de la actividad<input name="titulo" required autofocus placeholder="Ej.: Absolver traslado de escrito de la parte demandante"></label>
        <label>Proceso<select name="proceso">${procs.map((p) => `<option value="${p.codigo}" ${p.codigo === procesoPreferido ? 'selected' : ''}>${p.codigo} · ${esc(p.denominacion)}</option>`).join('')}</select></label>
        <div class="doble">
          <label>Prioridad<select name="prioridad">${SEMILLA.PRIORIDADES.map((x) => `<option ${x === 'Media' ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Fecha límite<input type="date" name="limite" value="${sumarDias(isoDia(HOY), 5)}" required></label>
        </div>
        <label>Lista de verificación (un ítem por línea)<textarea name="checklist" rows="4" placeholder="Revisar antecedentes&#10;Redactar escrito&#10;Presentar escrito"></textarea></label>
        <p class="secundario">Solo se listan procesos en curso: los procesos finalizados no admiten nuevas actividades.</p>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Crear actividad</button></div>
      </form>`, true);
    $('#f-nueva').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.titulo.value.trim()) { f.titulo.focus(); return; }
      const p = proceso(f.proceso.value);
      const clave = `LEG-${D.siguienteClave++}`;
      D.actividades.push({
        clave, titulo: f.titulo.value.trim(), descripcion: `Actividad adicional · ${p.denominacion}`, procesoCodigo: p.codigo, fase: 'Actividad adicional',
        responsable: p.responsable, estado: 'Pendiente', prioridad: f.prioridad.value, fechaLimite: f.limite.value,
        checklist: f.checklist.value.split('\n').map((s) => s.trim()).filter(Boolean).map((texto) => ({ texto, hecho: false })),
        comentarios: [{ autor: actor(), fecha: isoDia(new Date()), texto: 'Creó la actividad.', sistema: true }]
      });
      guardar(); cerrarModal(); renderizar(); notificar(`Actividad ${clave} creada.`);
    });
  }

  function modalGenerarProceso(idPlantilla) {
    const t = plantilla(idPlantilla);
    const codigo = siguienteCodigoProceso();
    abrirModal(`
      <div class="modal__cab"><div><div class="modal__clave">${t.id} · ${esc(t.nombre)}</div><h2 id="modal-titulo">Generar proceso desde plantilla</h2></div><button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
      <form id="f-generar" class="modal__cuerpo modal__cuerpo--simple formulario">
        <label>Denominación del proceso<input name="denominacion" required autofocus placeholder="Ej.: Arbitraje – Contrato de servicios N.° 045-2026"></label>
        <div class="doble">
          <label>Categoría<input value="${esc(t.categoria)}" disabled></label>
          <label>Procedimiento<select name="procedimiento">${t.procedimientos.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
        </div>
        <div class="doble">
          <label>Prioridad<select name="prioridad">${SEMILLA.PRIORIDADES.map((x) => `<option ${x === 'Media' ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Fecha de inicio<input type="date" name="inicio" value="${isoDia(HOY)}" required></label>
        </div>
        <div class="aviso aviso--info">Se asignará el código <strong>${codigo}</strong> con estado <strong>Registrado</strong>, bajo responsabilidad de ${esc(responsable(perfil.responsable).nombre)}. Se crearán ${t.fases.flatMap((f) => f.actividades).length} actividades en su tablero.</div>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Generar proceso</button></div>
      </form>`, true);
    $('#f-generar').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.denominacion.value.trim()) { f.denominacion.focus(); return; }
      const p = { codigo, denominacion: f.denominacion.value.trim(), categoria: t.categoria, procedimiento: f.procedimiento.value, responsable: perfil.responsable, estado: 'Registrado', prioridad: f.prioridad.value, fechaInicio: f.inicio.value, plantillaId: t.id, origen: 'Plantilla' };
      D.procesos.push(p);
      instanciarPlantilla(p, t);
      guardar(); cerrarModal();
      vistas.tablero.f = { proceso: codigo, prioridad: '', texto: '', soloVencidas: false };
      location.hash = '#tablero';
      notificar(`Proceso ${codigo} generado con ${actividadesDe(codigo).length} actividades.`);
    });
  }

  // ================================================================== router
  const MENU = {
    gerente: [
      { grupo: 'Gerencia' },
      { ruta: 'gerencia', texto: 'Panel institucional' },
      { ruta: 'cartera', texto: 'Cartera de procesos', cuenta: () => D.procesos.filter(enCurso).length },
      { ruta: 'sgd', texto: 'Trámites SGD indexados', cuenta: () => D.tramites.length }
    ],
    responsable: [
      { grupo: 'Mi gestión' },
      { ruta: 'panel', texto: 'Mi panel' },
      { ruta: 'tablero', texto: 'Tablero de actividades', cuenta: () => actividadesVisibles().filter(abierta).length },
      { ruta: 'procesos', texto: 'Mis procesos', cuenta: () => procesosVisibles().filter(enCurso).length },
      { grupo: 'Recursos' },
      { ruta: 'plantillas', texto: 'Plantillas de procesos', cuenta: () => D.plantillas.length },
      { ruta: 'sgd', texto: 'Trámites SGD indexados', cuenta: () => tramitesVisibles().length }
    ]
  };

  function rutaActual() {
    const r = location.hash.replace(/^#\/?/, '');
    const permitidas = MENU[perfil.rol].filter((m) => m.ruta).map((m) => m.ruta);
    return permitidas.includes(r) ? r : permitidas[0];
  }

  function renderizar() {
    const ruta = rutaActual();
    if (location.hash !== `#${ruta}`) history.replaceState(null, '', `#${ruta}`);
    const vista = vistas[ruta];
    $('#menu').innerHTML = MENU[perfil.rol].map((m) => m.grupo
      ? `<div class="menu__grupo">${m.grupo}</div>`
      : `<a href="#${m.ruta}" ${m.ruta === ruta ? 'aria-current="page"' : ''}><span>${m.texto}</span>${m.cuenta ? `<span class="cuenta">${m.cuenta()}</span>` : ''}</a>`).join('');
    $('#titulo-vista').textContent = vista.titulo;
    $('#subtitulo-vista').textContent = vista.subtitulo;
    document.title = `${vista.titulo} · LEGAL`;
    const quien = esGerente() ? SEMILLA.gerente : responsable(perfil.responsable);
    $('#avatar').textContent = quien.iniciales;
    $('#avatar').title = `${quien.nombre} · ${quien.cargo}`;
    vista.render($('#vista'));
  }

  function iniciarPerfil() {
    const sel = $('#selector-perfil');
    sel.innerHTML = `<optgroup label="Gerencia"><option value="gerente">${esc(SEMILLA.gerente.cargo)} – ${esc(SEMILLA.gerente.nombre)}</option></optgroup>
      <optgroup label="Responsable de procesos">${SEMILLA.responsables.map((r) => `<option value="R:${r.codigo}">${esc(r.nombre)}</option>`).join('')}</optgroup>`;
    sel.value = esGerente() ? 'gerente' : `R:${perfil.responsable}`;
    sel.addEventListener('change', () => {
      perfil = sel.value === 'gerente' ? { rol: 'gerente', responsable: perfil.responsable } : { rol: 'responsable', responsable: sel.value.slice(2) };
      almacen.escribir(CLAVE_PERFIL, perfil);
      vistaProcesos.f = null; vistas.tablero.f = null; vistas.sgd.f = null;
      location.hash = `#${MENU[perfil.rol][1].ruta}`;
      renderizar();
    });
  }

  // ============================================================== eventos
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-actividad]');
    if (act && !act.classList.contains('arrastrando')) { modalActividad(act.dataset.actividad); return; }
    const pro = e.target.closest('[data-proceso]');
    if (pro) { modalProceso(pro.dataset.proceso); return; }
    if (e.target.closest('[data-cerrar]')) { cerrarModal(); return; }
    const cp = e.target.closest('[data-copiar]');
    if (cp) { navigator.clipboard.writeText(cp.dataset.copiar).then(() => notificar('Ruta del SGD copiada al portapapeles.')).catch(() => notificar(cp.dataset.copiar)); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#confirmacion').hidden) { $('#confirmacion [data-cancelar]').click(); return; }
    if (e.key === 'Escape' && !$('#modal').hidden) cerrarModal();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-actividad]')) { e.preventDefault(); modalActividad(e.target.dataset.actividad); }
  });

  // Tooltip de gráficos (ratón y teclado)
  const tip = $('#tooltip');
  function mostrarTip(el, x, y) {
    tip.innerHTML = `<strong>${esc(el.dataset.tip)}</strong>${esc(el.dataset.tipDetalle || '')}`;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 12)}px`;
    tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
  }
  document.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-tip]'); if (el) mostrarTip(el, e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); mostrarTip(el, r.left + r.width / 2, r.top); } else tip.hidden = true; });

  $('#btn-restablecer').addEventListener('click', () => {
    confirmar(servidor
      ? '¿Restablecer los datos de ejemplo del portal? Se perderán los cambios hechos en el portal. Las capturas del Conector guardadas en la base de datos se volverán a incorporar.'
      : '¿Restablecer los datos de ejemplo? Se perderán los cambios realizados en este navegador.', 'Restablecer datos', () => {
      D = copiaSemilla(); guardar(); renderizar(); notificar('Datos de ejemplo restablecidos.');
      if (servidor) sincronizarConector();
    });
  });
  $('#btn-menu').addEventListener('click', () => {
    const abierto = $('#lateral').classList.toggle('abierto');
    $('#btn-menu').setAttribute('aria-expanded', abierto);
  });
  $('#menu').addEventListener('click', (e) => { if (e.target.closest('a')) $('#lateral').classList.remove('abierto'); });
  window.addEventListener('hashchange', renderizar);

  async function arrancar() {
    if (/^https?:$/.test(location.protocol)) {
      try {
        const r = await fetch('/api/estado', { cache: 'no-store' });
        const e = r.ok ? await r.json() : null;
        if (e && e.servicio === 'legal-prueba') servidor = e;
      } catch (err) { /* sin servidor: modo navegador */ }
    }
    if (servidor) {
      try {
        const r = await fetch('/api/portal', { cache: 'no-store' });
        const doc = r.ok ? await r.json() : null;
        if (doc && doc.version === SEMILLA.version) D = doc; else { D = copiaSemilla(); await subirAlServidor(); }
      } catch (err) { /* se mantiene la copia local */ }
      await sincronizarConector();
      setInterval(sincronizarConector, 8000);
    }
    almacen.escribir(CLAVE_DATOS, D);
    iniciarPerfil();
    renderizar();
    pintarEstadoBd(true);
  }

  arrancar();
})();
