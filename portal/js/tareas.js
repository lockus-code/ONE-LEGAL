/*
 * LEGAL · Portal — tablero de tareas (al estilo Jira) y ficha de tarea.
 * - Solo se muestran las tareas habilitadas: las que no tienen antecesora o cuya antecesora finalizó.
 * - Las fichas se arrastran con el mouse entre columnas; devolver una tarea a una columna
 *   anterior exige una justificación, que queda en los comentarios y en el historial.
 * - Al hacer clic en una ficha se abre su detalle: título, descripción, color, plazo,
 *   lista de verificación, comentarios, documentos del SGD e historial.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  L.ESTADOS_TAREA = ['Pendiente', 'En proceso', 'En revisión', 'Finalizada'];
  const COLUMNAS = { Pendiente: 'Por hacer', 'En proceso': 'En proceso', 'En revisión': 'En revisión', Finalizada: 'Finalizada' };
  L.COLORES = [['', 'Sin color'], ['#2a78d6', 'Azul'], ['#0ca30c', 'Verde'], ['#fab219', 'Ámbar'], ['#e8590c', 'Naranja'], ['#d03b3b', 'Rojo'], ['#7c4dd8', 'Morado'], ['#6b7380', 'Gris']];
  const orden = (e) => L.ESTADOS_TAREA.indexOf(e);

  /** La tarea está habilitada si no tiene antecesora o su antecesora finalizó. */
  L.habilitada = (t) => {
    if (t.estado !== 'Pendiente' || !t.antecesoraId) return true;
    const a = L.D.porTarea[t.antecesoraId];
    return !a || a.estado === 'Finalizada';
  };

  /** Cambia el estado; si es un retroceso pide la justificación. Devuelve true si se aplicó. */
  L.moverTarea = async function (t, estado) {
    if (t.estado === estado) return false;
    let justificacion = '';
    if (orden(estado) < orden(t.estado)) {
      justificacion = await pedirJustificacion(t, estado);
      if (!justificacion) return false;
    } else if (estado === 'Finalizada' && (t.checklist || []).some((i) => !i.hecho) &&
      !(await L.confirmar(`«${t.nombre}» tiene ítems pendientes en su lista de verificación. ¿Finalizarla de todos modos?`))) {
      return false;
    }
    try {
      const r = await L.api('PUT', `/api/tareas/${t.id}`, { estado, justificacion });
      L.notificar(r.sucesoras.length ? `Tarea en «${COLUMNAS[estado]}». Se habilitó: ${r.sucesoras.map((x) => x.nombre).join(', ')}.` : `Tarea movida a «${COLUMNAS[estado]}».`);
      return true;
    } catch (e) { L.error(e); return false; }
  };

  function pedirJustificacion(t, estado) {
    return new Promise((resolve) => {
      const caja = document.createElement('div');
      caja.className = 'modal modal--confirmacion';
      caja.innerHTML = `<div class="modal__fondo" data-x></div>
        <form class="modal__caja modal__caja--angosta" role="dialog" aria-modal="true" aria-labelledby="just-t">
          <div class="modal__cab"><div><div class="modal__clave">Retroceso de tarea</div><h2 id="just-t">${esc(t.nombre)}</h2></div></div>
          <div class="modal__cuerpo modal__cuerpo--simple formulario">
            <p>Pasará de <strong>${esc(COLUMNAS[t.estado])}</strong> a <strong>${esc(COLUMNAS[estado])}</strong>. Indique el motivo; quedará en los comentarios de la tarea.</p>
            <label>Justificación<textarea name="j" rows="3" required placeholder="Ej.: El escrito fue observado por el juzgado y debe subsanarse."></textarea></label>
            <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-x>Cancelar</button><button class="btn btn--primario">Devolver tarea</button></div>
          </div></form>`;
      document.body.appendChild(caja);
      const f = L.$('form', caja);
      f.j.focus();
      const cerrar = (v) => { caja.remove(); resolve(v); };
      caja.addEventListener('click', (ev) => { if (ev.target.hasAttribute('data-x')) cerrar(''); });
      caja.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(''); } });
      f.addEventListener('submit', (ev) => { ev.preventDefault(); const v = f.j.value.trim(); if (v) cerrar(v); else f.j.focus(); });
    });
  }

  // ------------------------------------------------------------ fichas
  function chipPlazo(t) {
    const v = L.vencimiento(t);
    const clase = { vencida: 'plazo--vencida', tarde: 'plazo--vencida', proxima: 'plazo--proxima', 'sin-plazo': 'plazo--sin', vigente: 'plazo--ok', cumplida: 'plazo--ok', relativo: 'plazo--sin' }[v.tipo] || '';
    const icono = { vencida: '⚠', tarde: '⚠', proxima: '◷', 'sin-plazo': '?', vigente: '📅', cumplida: '✓', relativo: '⧗' }[v.tipo] || '';
    const fecha = t.fechaLimite && L.abierta(t) ? ` · ${L.fmtFecha(t.fechaLimite)}` : '';
    return `<span class="plazo ${clase}" title="${esc(v.texto)}">${icono} ${esc(v.texto)}${v.tipo === 'proxima' || v.tipo === 'vencida' ? esc(fecha) : ''}</span>`;
  }
  L.chipPlazo = chipPlazo;

  function ficha(t, editable) {
    const p = L.D.porProceso[t.procesoId];
    const items = t.checklist || [];
    const hechos = items.filter((i) => i.hecho).length;
    const comentarios = (t.comentarios || []).length;
    const docs = L.D.tramites.filter((x) => x.tareaId === t.id).length;
    return `<article class="ficha" data-tarea="${esc(t.id)}" ${editable ? 'draggable="true"' : ''} tabindex="0" style="--color-ficha:${esc(t.color || 'transparent')}" aria-label="${esc(t.nombre)}, ${esc(L.vencimiento(t).texto)}">
      <div class="ficha__clave"><span class="mono">${esc(p.codigo)}-${t.orden}</span>${t.referencia ? `<span class="secundario">${esc(t.referencia)}</span>` : ''}</div>
      <div class="ficha__titulo">${esc(t.nombre)}</div>
      <div class="ficha__proceso">${esc(p.titulo)}</div>
      <div class="ficha__pie">${chipPlazo(t)}<span class="espacio"></span>
        ${items.length ? `<span class="ficha__dato" title="Lista de verificación">☑ ${hechos}/${items.length}</span>` : ''}
        ${comentarios ? `<span class="ficha__dato" title="Comentarios">💬 ${comentarios}</span>` : ''}
        ${docs ? `<span class="ficha__dato" title="Documentos del SGD">📎 ${docs}</span>` : ''}
      </div></article>`;
  }

  // ------------------------------------------------------------ tablero
  L.vistas.tareas = {
    titulo: 'Mis tareas', subtitulo: 'Tablero de tareas habilitadas · arrastre las fichas para cambiar su estado',
    filtros: { proceso: '', texto: '', foco: '' },
    render(v) {
      const f = this.filtros;
      const activos = L.D.procesos.filter((p) => p.estado === 'Activo');
      const ids = new Set(activos.map((p) => p.id));
      const texto = L.normal(f.texto);
      const todas = L.D.tareas.filter((t) => ids.has(t.procesoId) && (!f.proceso || t.procesoId === f.proceso));
      const bloqueadas = todas.filter((t) => !L.habilitada(t)).length;
      const visibles = todas.filter((t) => L.habilitada(t) && (t.estado !== 'Finalizada' || L.diasEntre(t.fechaFin, L.hoy()) <= 30) &&
        (!texto || L.normal(`${t.nombre} ${L.D.porProceso[t.procesoId].codigo} ${L.D.porProceso[t.procesoId].titulo}`).includes(texto)) &&
        (!f.foco || (f.foco === 'riesgo' ? ['vencida', 'proxima'].includes(L.vencimiento(t).tipo) : L.vencimiento(t).tipo === 'sin-plazo')));
      const ordenar = (a, b) => (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999') || a.orden - b.orden;
      v.innerHTML = `
        <div class="barra-filtros">
          <label>Buscar<input type="search" id="f-texto" value="${esc(f.texto)}" placeholder="Tarea o proceso…"></label>
          <label>Proceso<select id="f-proceso">${L.opciones(activos.map((p) => [p.id, `${p.codigo} · ${p.titulo}`]), f.proceso, 'Todos mis procesos activos')}</select></label>
          <label>Mostrar<select id="f-foco">${L.opciones([['riesgo', 'Vencidas y por vencer'], ['sin-plazo', 'Sin plazo definido']], f.foco, 'Todas las tareas')}</select></label>
          <span class="espacio"></span>
          <span class="secundario">${bloqueadas ? `${bloqueadas} tarea(s) esperan que finalice su antecesora` : ''}</span>
        </div>
        <div class="tablero" role="list">${L.ESTADOS_TAREA.map((e) => {
          const lista = visibles.filter((t) => t.estado === e).sort(ordenar);
          return `<section class="tablero__col" data-estado="${esc(e)}" role="listitem" aria-label="${esc(COLUMNAS[e])}">
            <header class="tablero__cab"><h2>${esc(COLUMNAS[e])}</h2><span class="cuenta">${lista.length}</span></header>
            <div class="tablero__lista">${lista.map((t) => ficha(t, L.puedeEditarTareas(L.D.porProceso[t.procesoId]))).join('') || `<p class="tablero__vacio">${e === 'Finalizada' ? 'Tareas finalizadas en los últimos 30 días' : 'Arrastre aquí'}</p>`}</div>
          </section>`;
        }).join('')}</div>`;

      L.$('#f-texto', v).addEventListener('input', (ev) => { f.texto = ev.target.value; L.pintar(); const x = L.$('#f-texto'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); });
      L.$('#f-proceso', v).addEventListener('change', (ev) => { f.proceso = ev.target.value; L.pintar(); });
      L.$('#f-foco', v).addEventListener('change', (ev) => { f.foco = ev.target.value; L.pintar(); });

      // Arrastrar y soltar con el mouse.
      let arrastrada = null;
      v.addEventListener('dragstart', (ev) => {
        const card = ev.target.closest('.ficha[draggable]');
        if (!card) return;
        arrastrada = L.D.porTarea[card.dataset.tarea];
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', arrastrada.id);
        requestAnimationFrame(() => card.classList.add('arrastrando'));
        L.$$('.tablero__col', v).forEach((c) => c.classList.toggle('tablero__col--atras', orden(c.dataset.estado) < orden(arrastrada.estado)));
      });
      v.addEventListener('dragend', () => { L.$$('.arrastrando, .sobre', v).forEach((x) => x.classList.remove('arrastrando', 'sobre')); L.$$('.tablero__col--atras', v).forEach((x) => x.classList.remove('tablero__col--atras')); });
      v.addEventListener('dragover', (ev) => {
        const col = ev.target.closest('.tablero__col');
        if (!col || !arrastrada) return;
        ev.preventDefault();
        L.$$('.tablero__col.sobre', v).forEach((c) => c !== col && c.classList.remove('sobre'));
        col.classList.add('sobre');
      });
      v.addEventListener('drop', async (ev) => {
        const col = ev.target.closest('.tablero__col');
        if (!col || !arrastrada) return;
        ev.preventDefault();
        const t = arrastrada;
        arrastrada = null;
        col.classList.remove('sobre');
        if (await L.moverTarea(t, col.dataset.estado)) await L.refrescar();
      });
      v.addEventListener('click', (ev) => { const c = ev.target.closest('.ficha'); if (c) L.abrirTarea(c.dataset.tarea); });
      v.addEventListener('keydown', (ev) => { const c = ev.target.closest('.ficha'); if (c && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); L.abrirTarea(c.dataset.tarea); } });
    }
  };

  // --------------------------------------------------------- ficha (modal)
  L.abrirTarea = function (id, pestana = 'comentarios') {
    const t = L.D.porTarea[id];
    if (!t) return;
    const p = L.D.porProceso[t.procesoId];
    const editable = L.puedeEditarTareas(p);
    const ant = L.D.porTarea[t.antecesoraId];
    const sucesoras = L.tareasDe(p.id).filter((x) => x.antecesoraId === t.id);
    const items = t.checklist || [];
    const hechos = items.filter((i) => i.hecho).length;
    const docs = L.D.tramites.filter((x) => x.tareaId === t.id);
    const solicitada = L.D.solicitudes.some((s) => s.tareaId === t.id && s.estado === 'pendiente');
    const dis = editable ? '' : 'disabled';
    const habilitada = L.habilitada(t);
    L.alCerrarModal = () => L.pintar();
    const c = L.modal(`
      <div class="modal__cab tarea-cab" style="--color-ficha:${esc(t.color || 'transparent')}">
        <div class="tarea-cab__texto">
          <div class="modal__clave"><a href="#proceso/${esc(p.id)}">${esc(p.codigo)}</a> <span>· Tarea ${t.orden}</span> ${L.chipEstado(L.estadoTarea(t))}</div>
          ${editable ? `<input class="titulo-editable" id="t-nombre" value="${esc(t.nombre)}" aria-label="Título de la tarea">` : `<h2 id="modal-titulo">${esc(t.nombre)}</h2>`}
          <p class="secundario">${esc(p.titulo)}</p>
        </div>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <div class="modal__cuerpo tarea">
        <div class="tarea__principal">
          ${!habilitada ? `<div class="aviso aviso--alerta"><span>Bloqueada: se habilita cuando finalice «${esc(ant ? ant.nombre : '')}».</span></div>` : ''}
          <section class="seccion"><h3>Descripción</h3>
            <textarea id="t-desc" rows="3" ${dis} placeholder="${editable ? 'Agregue detalles, instrucciones o el resultado esperado…' : 'Sin descripción'}">${esc(t.descripcion || '')}</textarea></section>
          <section class="seccion"><h3>Lista de verificación ${items.length ? `<span class="secundario">${hechos}/${items.length}</span>` : ''}</h3>
            ${items.length ? `<div class="progreso progreso--ancho"><span style="width:${(hechos / items.length) * 100}%"></span></div>` : ''}
            <ul class="checklist">${items.map((i, k) => `<li class="${i.hecho ? 'hecho' : ''}"><label><input type="checkbox" data-item="${k}" ${i.hecho ? 'checked' : ''} ${dis}><span>${esc(i.texto)}</span></label>${editable ? `<button type="button" class="quitar" data-quitar="${k}" aria-label="Quitar ítem">✕</button>` : ''}</li>`).join('') || '<li class="secundario">Sin ítems.</li>'}</ul>
            ${editable ? '<form class="agregar" id="t-item"><input name="texto" placeholder="Agregar ítem…" aria-label="Nuevo ítem"><button class="btn btn--sm">Agregar</button></form>' : ''}</section>
          <section class="seccion">
            <div class="pestanas-mini" role="tablist">
              <button type="button" role="tab" data-pest="comentarios" aria-selected="${pestana === 'comentarios'}">Comentarios (${(t.comentarios || []).length})</button>
              <button type="button" role="tab" data-pest="historial" aria-selected="${pestana === 'historial'}">Historial (${(t.historial || []).length})</button>
            </div>
            <div data-panel="comentarios" ${pestana === 'comentarios' ? '' : 'hidden'}>
              ${editable ? '<form id="t-com" class="comentar"><textarea name="texto" rows="2" placeholder="Escriba un comentario…"></textarea><button class="btn btn--sm btn--primario">Comentar</button></form>' : ''}
              ${(t.comentarios || []).slice().reverse().map((x) => `<div class="comentario"><span class="avatar avatar--sm">${esc(L.iniciales(x.usuario))}</span><div class="comentario__cuerpo"><div class="comentario__meta"><strong>${esc(x.usuario)}</strong> · ${L.fmtFechaHora(x.fecha)}</div><div>${esc(x.texto)}</div></div></div>`).join('') || '<p class="secundario">Sin comentarios.</p>'}
            </div>
            <div data-panel="historial" ${pestana === 'historial' ? '' : 'hidden'}>
              <ul class="lista lista--compacta">${(t.historial || []).slice().reverse().map((h) => `<li><div class="lista__cuerpo"><div>${esc(h.texto)}</div><div class="lista__meta">${esc(h.usuario)} · ${L.fmtFechaHora(h.fecha)}</div></div></li>`).join('')}</ul>
            </div>
          </section>
        </div>
        <aside class="tarea__lateral">
          <label>Estado<select id="t-estado" ${editable && habilitada ? '' : 'disabled'}>${L.opciones(L.ESTADOS_TAREA.map((e) => [e, COLUMNAS[e]]), t.estado)}</select></label>
          <div class="campo-lateral"><span>Plazo</span>${chipPlazo(t)}${solicitada ? '<span class="chip chip--advertencia">Plazo solicitado</span>' : ''}</div>
          ${editable && L.abierta(t) ? `<label>Fecha límite<input type="date" id="t-fecha" value="${esc(t.fechaLimite || '')}" min="${esc(t.fechaInicio || '')}"></label>
            <div class="doble-mini"><label>o días<input type="number" min="0" max="3650" id="t-dias" value="${t.plazoDias ?? ''}"></label>
            <label>Tipo<select id="t-tipo">${L.opciones([['habiles', 'hábiles'], ['calendario', 'calendario']], t.tipoDias)}</select></label></div>
            <button type="button" class="btn btn--sm" id="t-plazo">Aplicar plazo</button><p class="secundario" id="t-previo"></p>` : ''}
          ${!editable && L.abierta(t) && !t.fechaLimite && !solicitada && L.es('asistente', 'gerente', 'admin') && p.estado === 'Activo' ? '<button type="button" class="btn btn--sm" id="t-solicitar">Solicitar definición de plazo</button>' : ''}
          <div class="campo-lateral"><span>Color</span><div class="colores">${L.COLORES.map(([hex, n]) => `<button type="button" class="color ${(t.color || '') === hex ? 'color--activo' : ''}" data-color="${hex}" style="--c:${hex || 'var(--superficie)'}" title="${n}" aria-label="${n}" ${dis}></button>`).join('')}</div></div>
          <dl class="datos">
            <dt>Profesional</dt><dd>${esc(L.nombre(p.profesionalId))}</dd>
            <dt>Habilitada</dt><dd>${L.fmtFecha(t.fechaInicio)}</dd>
            ${t.fechaFin ? `<dt>Finalizada</dt><dd>${L.fmtFecha(t.fechaFin)}</dd>` : ''}
            <dt>Antecesora</dt><dd>${ant ? `${esc(ant.nombre)} ${L.chipEstado(L.estadoTarea(ant))}` : '—'}</dd>
            <dt>Sucesoras</dt><dd>${sucesoras.map((x) => esc(x.nombre)).join(', ') || '—'}</dd>
            ${t.referencia ? `<dt>Base legal</dt><dd>${esc(t.referencia)}</dd>` : ''}
          </dl>
          ${docs.length ? `<div class="campo-lateral"><span>Documentos del SGD</span>${docs.map((d) => `<a class="doc-sgd" href="${esc(d.enlaceSgd)}" target="_blank" rel="noopener"><span class="mono">${esc(d.nroTramite)}</span> ${esc(d.asuntoSgd)}</a>`).join('')}</div>` : ''}
          ${editable ? '<button type="button" class="btn btn--sm btn-texto-peligro" id="t-eliminar">Eliminar tarea</button>' : ''}
        </aside>
      </div>`, { foco: false });

    const guardar = async (cuerpo, mensaje) => {
      try {
        await L.api('PUT', `/api/tareas/${t.id}`, cuerpo);
        await L.recargar();
        if (mensaje) L.notificar(mensaje);
        L.abrirTarea(t.id, cuerpo.comentario ? 'comentarios' : pestana);
      } catch (e) { L.error(e); }
    };
    L.$$('[data-pest]', c).forEach((b) => b.addEventListener('click', () => {
      L.$$('[data-pest]', c).forEach((x) => x.setAttribute('aria-selected', x === b));
      L.$$('[data-panel]', c).forEach((x) => { x.hidden = x.dataset.panel !== b.dataset.pest; });
    }));
    if (!editable) {
      const s = L.$('#t-solicitar', c);
      if (s) s.addEventListener('click', () => L.solicitarPlazo(t.id));
      return;
    }
    L.$('#t-nombre', c).addEventListener('change', (ev) => ev.target.value.trim() && guardar({ nombre: ev.target.value }, 'Título actualizado.'));
    L.$('#t-desc', c).addEventListener('change', (ev) => guardar({ descripcion: ev.target.value }, 'Descripción guardada.'));
    L.$('#t-estado', c).addEventListener('change', async (ev) => { if (await L.moverTarea(t, ev.target.value)) { await L.recargar(); L.abrirTarea(t.id); } else ev.target.value = t.estado; });
    L.$$('[data-color]', c).forEach((b) => b.addEventListener('click', () => guardar({ color: b.dataset.color })));
    L.$$('[data-item]', c).forEach((x) => x.addEventListener('change', () => { const lista = items.map((i) => ({ ...i })); lista[Number(x.dataset.item)].hecho = x.checked; guardar({ checklist: lista }); }));
    L.$$('[data-quitar]', c).forEach((x) => x.addEventListener('click', () => guardar({ checklist: items.filter((_, k) => k !== Number(x.dataset.quitar)) })));
    L.$('#t-item', c).addEventListener('submit', (ev) => { ev.preventDefault(); const v = ev.target.texto.value.trim(); if (v) guardar({ checklist: [...items, { texto: v, hecho: false }] }); });
    L.$('#t-com', c).addEventListener('submit', (ev) => { ev.preventDefault(); const v = ev.target.texto.value.trim(); if (v) guardar({ comentario: v }); });
    const fecha = L.$('#t-fecha', c), dias = L.$('#t-dias', c), tipo = L.$('#t-tipo', c), previo = L.$('#t-previo', c);
    if (fecha) {
      const actualizarPrevio = () => {
        const n = parseInt(dias.value, 10);
        previo.textContent = Number.isNaN(n) ? '' : t.fechaInicio ? `Vencerá el ${L.fmtFecha(L.sumarDias(t.fechaInicio, n, tipo.value))}` : 'Se calculará cuando se habilite la tarea';
      };
      fecha.addEventListener('change', () => guardar({ fechaLimite: fecha.value }, fecha.value ? 'Fecha límite guardada.' : 'Fecha límite quitada.'));
      dias.addEventListener('input', actualizarPrevio);
      tipo.addEventListener('change', actualizarPrevio);
      L.$('#t-plazo', c).addEventListener('click', () => { const n = parseInt(dias.value, 10); if (Number.isNaN(n)) { L.notificar('Indique el número de días.', 'error'); return; } guardar({ plazoDias: n, tipoDias: tipo.value }, 'Plazo guardado.'); });
    }
    L.$('#t-eliminar', c).addEventListener('click', async () => {
      if (!(await L.confirmar(`¿Eliminar la tarea «${t.nombre}»? Sus sucesoras pasarán a depender de la tarea anterior.`, { peligro: true, aceptar: 'Eliminar' }))) return;
      try { await L.api('DELETE', `/api/tareas/${t.id}`); L.cerrarModal(); L.notificar('Tarea eliminada.'); await L.refrescar(); } catch (e) { L.error(e); }
    });
  };
})();
