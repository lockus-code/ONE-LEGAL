/*
 * LEGAL · Portal — plantillas de tareas de cada profesional por vía procedimental.
 * Cada tarea puede tener plazo fijo (días hábiles o calendario, desde el inicio
 * del proceso o desde que concluye su antecesora) o quedar «por definir».
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  /** Editor de lista de tareas/etapas. Devuelve { valor() } con el arreglo normalizado. */
  L.editorTareas = function (raiz, tareasIniciales) {
    let tareas = (tareasIniciales || []).map((t) => ({ ...t }));
    function pintar() {
      raiz.innerHTML = `<div class="tabla-envoltura"><table class="tabla tabla--editor">
        <thead><tr><th>#</th><th>Tarea</th><th>Plazo</th><th>Cuenta desde</th><th>Antecesora</th><th>Base legal</th><th></th></tr></thead>
        <tbody>${tareas.map((t, i) => `<tr data-i="${i}">
          <td class="num">${i + 1}</td>
          <td><input data-k="nombre" value="${esc(t.nombre)}" aria-label="Nombre de la tarea" required></td>
          <td class="plazo-dias"><input type="number" min="0" max="3650" data-k="plazoDias" value="${t.plazoDias ?? ''}" placeholder="por definir" aria-label="Días">
            <select data-k="tipoDias" aria-label="Tipo de días">${L.opciones([['habiles', 'hábiles'], ['calendario', 'calendario']], t.tipoDias || 'habiles')}</select></td>
          <td><select data-k="desde" aria-label="Desde">${L.opciones([['antecesora', 'Fin de la antecesora'], ['inicio', 'Inicio del proceso']], t.desde || 'antecesora')}</select></td>
          <td><select data-k="antecesora" aria-label="Antecesora">${L.opciones([['', i ? `La anterior (${i})` : '—'], ['-1', 'Ninguna (en paralelo)'], ...tareas.slice(0, Math.max(0, i - 1)).map((x, j) => [String(j), `${j + 1}. ${x.nombre}`])], t.antecesora === undefined || t.antecesora === null || t.antecesora === i - 1 ? '' : String(t.antecesora))}</select></td>
          <td><input data-k="referencia" value="${esc(t.referencia || '')}" placeholder="Ej.: CPC art. 478" aria-label="Base legal"></td>
          <td class="acciones-fila"><select data-k="accion" aria-label="Acciones">${L.opciones([['subir', 'Subir'], ['bajar', 'Bajar'], ['duplicar', 'Duplicar'], ['quitar', 'Quitar']], '', '⋯')}</select></td></tr>`).join('')}</tbody></table></div>
        <button type="button" class="btn btn--sm" data-agregar>+ Agregar tarea</button>
        <p class="secundario">Deje el plazo vacío si se conoce recién durante el proceso (p. ej. fecha de audiencia): LEGAL alertará al profesional cuando la tarea antecesora esté en proceso o concluida.</p>`;
    }
    raiz.addEventListener('input', (ev) => {
      const tr = ev.target.closest('tr[data-i]');
      if (!tr || ev.target.dataset.k === 'accion') return;
      const t = tareas[Number(tr.dataset.i)];
      const k = ev.target.dataset.k;
      if (k === 'plazoDias') t.plazoDias = ev.target.value === '' ? null : parseInt(ev.target.value, 10);
      else if (k === 'antecesora') t.antecesora = ev.target.value === '' ? null : parseInt(ev.target.value, 10);
      else t[k] = ev.target.value;
    });
    raiz.addEventListener('change', (ev) => {
      if (ev.target.dataset.k !== 'accion') return;
      const i = Number(ev.target.closest('tr').dataset.i);
      const a = ev.target.value;
      if (a === 'subir' && i > 0) [tareas[i - 1], tareas[i]] = [tareas[i], tareas[i - 1]];
      if (a === 'bajar' && i < tareas.length - 1) [tareas[i + 1], tareas[i]] = [tareas[i], tareas[i + 1]];
      if (a === 'duplicar') tareas.splice(i + 1, 0, { ...tareas[i], nombre: `${tareas[i].nombre} (copia)` });
      if (a === 'quitar') tareas.splice(i, 1);
      if (a) tareas.forEach((t) => { t.antecesora = null; }); // al reordenar, cada tarea vuelve a depender de la anterior
      pintar();
    });
    raiz.addEventListener('click', (ev) => {
      if (!ev.target.hasAttribute('data-agregar')) return;
      tareas.push({ nombre: '', plazoDias: null, tipoDias: 'habiles', desde: 'antecesora' });
      pintar();
      const inputs = L.$$('input[data-k=nombre]', raiz);
      inputs[inputs.length - 1].focus();
    });
    pintar();
    return {
      valor: () => tareas.map((t) => ({ nombre: (t.nombre || '').trim(), plazoDias: t.plazoDias ?? null, tipoDias: t.tipoDias || 'habiles', desde: t.desde || 'antecesora', antecesora: t.antecesora ?? undefined, referencia: t.referencia || '', descripcion: t.descripcion || '' })),
      reemplazar: (nuevas) => { tareas = nuevas.map((t) => ({ ...t })); pintar(); }
    };
  };

  const ESTADOS_PLT = { pendiente: 'Por aprobar', aprobada: 'Aprobada', observada: 'Observada' };
  const chipPlantilla = (p) => ({
    aprobada: `<span class="chip chip--estado-finalizada">✓ Aprobada · v${p.version}</span>`,
    pendiente: `<span class="chip chip--advertencia">◷ Por aprobar · v${p.version}</span>`,
    observada: `<span class="chip chip--critico">✎ Observada · v${p.version}</span>`
  }[p.estado] || '');
  const plazoTxt = (t) => (t.plazoDias === null || t.plazoDias === undefined ? 'por definir' : `${t.plazoDias} d. ${t.tipoDias === 'calendario' ? 'cal.' : 'háb.'}`);
  const listaTareas = (tareas) => `<ol class="ciclo-lista">${tareas.map((t) => `<li>${esc(t.nombre)} <span class="secundario">· ${plazoTxt(t)}</span></li>`).join('')}</ol>`;

  L.vistas.plantillas = {
    titulo: () => ({ admin: 'Plantillas de los profesionales', gerente: 'Plantillas', profesional: 'Mis plantillas' })[L.rol()],
    subtitulo: () => (L.es('gerente', 'admin') ? 'Revise y apruebe las plantillas: solo las aprobadas generan procesos' : 'Su ciclo de tareas por vía procedimental. Cada cambio se envía a aprobación de la gerencia'),
    filtroProfesional: '',
    filtroEstado: null,
    render(v) {
      const revisor = L.es('gerente', 'admin');
      if (this.filtroEstado === null) this.filtroEstado = revisor && L.D.plantillas.some((x) => x.estado === 'pendiente') ? 'pendiente' : '';
      const propias = L.es('profesional');
      const lista = L.D.plantillas.filter((p) => (propias ? p.profesionalId === L.yo().id : !this.filtroProfesional || p.profesionalId === this.filtroProfesional) && (!this.filtroEstado || p.estado === this.filtroEstado))
        .sort((a, b) => (a.estado === 'pendiente' ? -1 : 0) - (b.estado === 'pendiente' ? -1 : 0) || a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
      const cuenta = (e) => L.D.plantillas.filter((p) => (!propias || p.profesionalId === L.yo().id) && p.estado === e).length;
      v.innerHTML = `
        <div class="barra-filtros">
          ${propias ? '' : `<label>Profesional<select id="f-prof">${L.opciones(L.profesionales(false).map((u) => [u.id, u.nombre]), this.filtroProfesional, 'Todos')}</select></label>`}
          <label>Estado<select id="f-estado">${L.opciones(Object.entries(ESTADOS_PLT).map(([k, t]) => [k, `${t} (${cuenta(k)})`]), this.filtroEstado, 'Todas')}</select></label>
          <span class="espacio"></span>
          ${L.es('profesional', 'admin') ? `<button class="btn btn--primario" id="btn-nueva" ${L.es('admin') && !L.profesionales().length ? 'disabled title="Primero cree profesionales"' : ''}>+ Nueva plantilla</button>` : ''}
        </div>
        ${propias ? '<div class="aviso aviso--info"><span>Al guardar, la plantilla queda <strong>por aprobar</strong>. Mientras la gerencia la revisa, los procesos nuevos usan la última versión aprobada; las vías sin versión aprobada no se ofrecen en la extensión.</span></div>' : ''}
        ${lista.length ? `<div class="rejilla rejilla--plantillas">${lista.map((p) => {
          const acciones = [];
          if (revisor && p.estado === 'pendiente') acciones.push(['revisar', 'Revisar y aprobar…']);
          if (L.es('profesional', 'admin')) acciones.push(['editar', 'Editar'], ['copiar', 'Usar como base para otra vía'], ['eliminar', 'Eliminar']);
          if (!acciones.length || (revisor && p.estado !== 'pendiente')) acciones.push(['ver', 'Ver detalle']);
          return `<article class="tarjeta plantilla plantilla--${esc(p.estado)}">
            <div class="plantilla__meta">${esc(L.nombreCategoria(p.categoria))} › ${esc(L.nombreVia(p.via))}</div>
            <div class="plantilla__titulo"><h3>${esc(p.nombre)}</h3>${chipPlantilla(p)}</div>
            ${propias ? '' : `<p class="secundario">${esc(L.nombre(p.profesionalId))}</p>`}
            ${p.observacion && p.estado === 'observada' ? `<div class="nota">Observación: ${esc(p.observacion)}</div>` : ''}
            ${p.estado !== 'aprobada' && (p.tareasAprobadas || []).length ? `<p class="secundario">En uso: versión aprobada el ${L.fmtFecha(p.aprobadaEn)} (${p.tareasAprobadas.length} tareas).</p>` : ''}
            ${p.estado !== 'aprobada' && !(p.tareasAprobadas || []).length ? '<p class="secundario">Aún sin versión aprobada: esta vía no está disponible para crear procesos.</p>' : ''}
            ${listaTareas(p.tareas)}
            <div class="plantilla__acciones"><span class="secundario">Actualizada ${L.fmtFecha(p.actualizadaEn)}</span>
              <select data-plantilla="${esc(p.id)}" aria-label="Acciones de la plantilla">${L.opciones(acciones, '', 'Acciones…')}</select></div>
          </article>`;
        }).join('')}</div>` : `<section class="tarjeta"><p class="vacio">${propias ? (L.D.plantillas.some((x) => x.profesionalId === L.yo().id) ? 'No hay plantillas con este estado.' : 'Aún no tiene plantillas. Cree una por cada vía que atiende: puede partir de las etapas normativas base y ajustar tareas y plazos.') : (this.filtroEstado === 'pendiente' ? 'No hay plantillas por aprobar. ✓' : 'No hay plantillas con estos filtros.')}</p></section>`}`;
      const fp = L.$('#f-prof', v); if (fp) fp.addEventListener('change', (ev) => { this.filtroProfesional = ev.target.value; L.pintar(); });
      L.$('#f-estado', v).addEventListener('change', (ev) => { this.filtroEstado = ev.target.value; L.pintar(); });
      const bn = L.$('#btn-nueva', v); if (bn) bn.addEventListener('click', () => editarPlantilla(null));
      v.addEventListener('change', async (ev) => {
        const id = ev.target.dataset.plantilla;
        if (!id) return;
        const a = ev.target.value; ev.target.value = '';
        const p = L.D.plantillas.find((x) => x.id === id);
        if (a === 'revisar' || a === 'ver') revisarPlantilla(p, a === 'revisar');
        if (a === 'editar') editarPlantilla(p);
        if (a === 'copiar') editarPlantilla({ ...p, id: null, nombre: `${p.nombre} (copia)`, via: '', categoria: p.categoria });
        if (a === 'eliminar' && (await L.confirmar(`¿Eliminar la plantilla «${p.nombre}»? Los procesos ya creados conservan sus tareas.`, { peligro: true, aceptar: 'Eliminar' }))) {
          try { await L.api('DELETE', `/api/plantillas/${p.id}`); await L.refrescar(); } catch (e) { L.error(e); }
        }
      });
    }
  };

  function revisarPlantilla(p, decidir) {
    const aprobada = p.tareasAprobadas || [];
    const tabla = (tareas) => `<table class="tabla"><thead><tr><th class="num">#</th><th>Tarea</th><th>Plazo</th><th>Desde</th></tr></thead><tbody>${tareas.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.nombre)}${t.referencia ? `<div class="secundario">${esc(t.referencia)}</div>` : ''}</td><td>${plazoTxt(t)}</td><td>${t.desde === 'inicio' ? 'Inicio del proceso' : 'Fin de la antecesora'}</td></tr>`).join('')}</tbody></table>`;
    const c = L.modal(`${L.cabModal(esc(p.nombre), `${esc(L.nombre(p.profesionalId))} · ${esc(L.nombreCategoria(p.categoria))} › ${esc(L.nombreVia(p.via))} · ${chipPlantilla(p)}`)}
      <div class="modal__cuerpo modal__cuerpo--simple">
        <div class="${aprobada.length && p.estado !== 'aprobada' ? 'rejilla rejilla--2' : ''}">
          <section><h3 class="subtitulo">${p.estado === 'aprobada' ? 'Versión aprobada' : `Versión propuesta (v${p.version})`}</h3><div class="tabla-envoltura">${tabla(p.tareas)}</div></section>
          ${aprobada.length && p.estado !== 'aprobada' ? `<section><h3 class="subtitulo">Versión aprobada vigente</h3><div class="tabla-envoltura">${tabla(aprobada)}</div></section>` : ''}
        </div>
        ${p.aprobadaPor ? `<p class="secundario">Última aprobación: ${esc(p.aprobadaPor)} · ${L.fmtFechaHora(p.aprobadaEn)}</p>` : ''}
        ${decidir ? `<form id="f-rev" class="formulario">
          <label>Observación (obligatoria para observar; opcional al aprobar)<textarea name="obs" rows="3" placeholder="Ej.: Defina el plazo de la etapa de alegatos."></textarea></label>
          <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button type="button" class="btn" data-decision="observar">Observar</button><button type="button" class="btn btn--primario" data-decision="aprobar">Aprobar</button></div>
        </form>` : ''}
      </div>`);
    L.$$('[data-decision]', c).forEach((b) => b.addEventListener('click', async () => {
      const obs = L.$('#f-rev', c).obs.value;
      try {
        await L.api('POST', `/api/plantillas/${p.id}/revision`, { decision: b.dataset.decision, observacion: obs });
        L.cerrarModal();
        L.notificar(b.dataset.decision === 'aprobar' ? 'Plantilla aprobada: ya puede usarse para crear procesos.' : 'Plantilla observada: el profesional verá la observación.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    }));
  }

  function editarPlantilla(p) {
    const nueva = !p || !p.id;
    const esAdmin = L.es('admin');
    const st = { categoria: (p && p.categoria) || '', via: (p && p.via) || '', profesionalId: (p && p.profesionalId) || (esAdmin ? '' : L.yo().id) };
    const c = L.modal(`${L.cabModal(nueva ? 'Nueva plantilla' : 'Editar plantilla', nueva ? 'Una plantilla por vía procedimental' : esc(L.nombreVia(p.via)))}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-plt" novalidate>
        ${esAdmin ? `<label>Profesional<select name="prof" ${nueva ? '' : 'disabled'}>${L.opciones(L.profesionales().map((u) => [u.id, u.nombre]), st.profesionalId, 'Seleccione…')}</select></label>` : ''}
        <div class="doble">
          <label>Categoría<select name="categoria" ${nueva ? '' : 'disabled'}>${L.opciones(L.categorias().map((x) => [x.codigo, x.nombre]), st.categoria, 'Seleccione…')}</select></label>
          <label>Vía procedimental<select name="via" ${nueva ? '' : 'disabled'}></select></label>
        </div>
        <label>Nombre de la plantilla<input name="nombre" value="${esc((p && p.nombre) || '')}" placeholder="Por defecto, el nombre de la vía"></label>
        <div class="acciones-linea"><select id="cargar" aria-label="Cargar tareas">${L.opciones([['base', 'Reemplazar por las etapas normativas base de la vía'], ...L.D.plantillas.filter((x) => !p || x.id !== p.id).map((x) => [x.id, `Copiar tareas de «${x.nombre}»${esAdmin ? ` (${L.nombre(x.profesionalId)})` : ''}`])], '', 'Cargar tareas desde…')}</select></div>
        <div id="editor"></div>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar y enviar a aprobación</button></div>
      </form>`);
    const f = L.$('#f-plt', c);
    const editor = L.editorTareas(L.$('#editor', c), (p && p.tareas) || []);
    const pintarVias = () => {
      const cat = L.categorias().find((x) => x.codigo === f.categoria.value);
      const ocupadas = new Set(L.D.plantillas.filter((x) => x.profesionalId === (esAdmin ? f.prof.value : L.yo().id) && (!p || x.id !== p.id)).map((x) => x.via));
      f.via.innerHTML = L.opciones(cat ? L.viasActivas(cat).map((x) => [x.codigo, `${x.nombre}${ocupadas.has(x.codigo) ? ' (ya tiene plantilla)' : ''}`]) : [], st.via, cat ? 'Seleccione…' : 'Primero la categoría');
    };
    pintarVias();
    f.categoria.addEventListener('change', () => { st.via = ''; pintarVias(); });
    if (esAdmin && nueva) f.prof.addEventListener('change', pintarVias);
    f.via.addEventListener('change', () => {
      st.via = f.via.value;
      // Plantilla vacía: se precargan las etapas base de la vía como punto de partida.
      if (st.via && !editor.valor().length) editor.reemplazar((L.buscarVia(st.via).v || { etapas: [] }).etapas);
    });
    L.$('#cargar', c).addEventListener('change', (ev) => {
      const v = ev.target.value; ev.target.value = '';
      if (v === 'base') { if (!f.via.value) { L.notificar('Primero elija la vía.', 'error'); return; } editor.reemplazar((L.buscarVia(f.via.value).v || { etapas: [] }).etapas); }
      else if (v) editor.reemplazar(L.D.plantillas.find((x) => x.id === v).tareas);
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const tareas = editor.valor();
      if (!f.via.value) { L.notificar('Elija la vía procedimental.', 'error'); return; }
      if (!tareas.length || tareas.some((t) => !t.nombre)) { L.notificar('Todas las tareas deben tener nombre (y al menos una tarea).', 'error'); return; }
      const cuerpo = { nombre: f.nombre.value, categoria: f.categoria.value, via: f.via.value, tareas };
      if (esAdmin && nueva) cuerpo.profesionalId = f.prof.value;
      try {
        await L.api(nueva ? 'POST' : 'PUT', nueva ? '/api/plantillas' : `/api/plantillas/${p.id}`, cuerpo);
        L.cerrarModal();
        L.notificar('Plantilla enviada a aprobación de la gerencia.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    });
  }
})();
