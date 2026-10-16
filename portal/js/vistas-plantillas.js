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

  L.vistas.plantillas = {
    titulo: () => (L.es('admin') ? 'Plantillas de los profesionales' : 'Mis plantillas'),
    subtitulo: 'El ciclo de tareas que se genera al crear un proceso de cada vía',
    filtroProfesional: '',
    render(v) {
      const esAdmin = L.es('admin');
      const lista = L.D.plantillas.filter((p) => (esAdmin ? !this.filtroProfesional || p.profesionalId === this.filtroProfesional : p.profesionalId === L.yo().id))
        .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
      const usadas = new Set(lista.map((p) => p.via));
      const sugeridas = L.es('profesional') ? [...new Set(L.D.procesos.filter((p) => p.cicloBase && !usadas.has(p.via)).map((p) => p.via))] : [];
      v.innerHTML = `
        <div class="barra-filtros">
          ${esAdmin ? `<label>Profesional<select id="f-prof">${L.opciones(L.profesionales(false).map((u) => [u.id, u.nombre]), this.filtroProfesional, 'Todos')}</select></label>` : ''}
          <span class="espacio"></span>
          <button class="btn btn--primario" id="btn-nueva" ${esAdmin && !L.profesionales().length ? 'disabled title="Primero cree profesionales"' : ''}>+ Nueva plantilla</button>
        </div>
        ${sugeridas.length ? `<div class="aviso aviso--alerta"><span>Tiene procesos generados con el ciclo base de: ${sugeridas.map((x) => `<strong>${esc(L.nombreVia(x))}</strong>`).join(', ')}. Cree su plantilla para que los próximos usen sus propias tareas.</span></div>` : ''}
        ${lista.length ? `<div class="rejilla rejilla--plantillas">${lista.map((p) => `
          <article class="tarjeta plantilla">
            <div class="plantilla__meta">${esc(L.nombreCategoria(p.categoria))} › ${esc(L.nombreVia(p.via))}</div>
            <h3>${esc(p.nombre)}</h3>
            ${esAdmin ? `<p class="secundario">${esc(L.nombre(p.profesionalId))}</p>` : ''}
            <ol class="ciclo-lista">${p.tareas.map((t) => `<li>${esc(t.nombre)} <span class="secundario">· ${t.plazoDias === null || t.plazoDias === undefined ? 'por definir' : `${t.plazoDias} d. ${t.tipoDias === 'calendario' ? 'cal.' : 'háb.'}`}</span></li>`).join('')}</ol>
            <div class="plantilla__acciones"><select data-plantilla="${esc(p.id)}" aria-label="Acciones">${L.opciones([['editar', 'Editar'], ['copiar', 'Usar como base para otra vía'], ['eliminar', 'Eliminar']], '', 'Acciones…')}</select>
            <span class="secundario">Actualizada ${L.fmtFecha(p.actualizadaEn)}</span></div>
          </article>`).join('')}</div>` : `<section class="tarjeta"><p class="vacio">${esAdmin ? 'No hay plantillas.' : 'Aún no tiene plantillas. Cree una por cada vía que atiende: puede partir de las etapas normativas base y ajustar tareas y plazos.'}</p></section>`}`;
      const fp = L.$('#f-prof', v); if (fp) fp.addEventListener('change', (ev) => { this.filtroProfesional = ev.target.value; L.pintar(); });
      L.$('#btn-nueva', v).addEventListener('click', () => editarPlantilla(null));
      v.addEventListener('change', async (ev) => {
        const id = ev.target.dataset.plantilla;
        if (!id) return;
        const a = ev.target.value; ev.target.value = '';
        const p = L.D.plantillas.find((x) => x.id === id);
        if (a === 'editar') editarPlantilla(p);
        if (a === 'copiar') editarPlantilla({ ...p, id: null, nombre: `${p.nombre} (copia)`, via: '', categoria: p.categoria });
        if (a === 'eliminar' && (await L.confirmar(`¿Eliminar la plantilla «${p.nombre}»? Los procesos ya creados conservan sus tareas.`, { peligro: true, aceptar: 'Eliminar' }))) {
          try { await L.api('DELETE', `/api/plantillas/${p.id}`); await L.refrescar(); } catch (e) { L.error(e); }
        }
      });
    }
  };

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
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar plantilla</button></div>
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
        L.notificar('Plantilla guardada: se usará en los próximos procesos de esta vía.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    });
  }
})();
