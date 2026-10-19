/*
 * LEGAL · Portal — procesos, ciclo de tareas, plazos por definir y trámites SGD.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  // ------------------------------------------------------------ procesos
  L.vistas.procesos = {
    titulo: () => (L.es('profesional') ? 'Mis procesos' : 'Cartera de procesos'),
    subtitulo: 'Procesos por categoría y vía procedimental',
    filtros: { texto: '', categoria: '', via: '', profesional: '', estado: 'abiertos' },
    render(v) {
      const f = this.filtros;
      const texto = L.normal(f.texto);
      const lista = L.D.procesos.filter((p) =>
        (!f.categoria || p.categoria === f.categoria) && (!f.via || p.via === f.via) &&
        (!f.profesional || p.profesionalId === f.profesional) &&
        (f.estado === 'todos' || (f.estado === 'abiertos' ? p.estado !== 'Finalizado' : p.estado === f.estado)) &&
        (!texto || L.normal(`${p.codigo} ${p.titulo} ${p.expedienteJudicial} ${p.contraparte}`).includes(texto)));
      const cat = L.categorias().find((c) => c.codigo === f.categoria);
      const alertasPor = {};
      L.D.alertas.forEach((a) => { if (a.procesoId && a.nivel !== 'info') alertasPor[a.procesoId] = (alertasPor[a.procesoId] || 0) + 1; });
      v.innerHTML = `
        <div class="barra-acciones"><span class="secundario">${lista.length} de ${L.D.procesos.length} proceso(s)</span>
          ${L.es('asistente', 'profesional', 'admin') ? '<button class="btn btn--primario" id="btn-nuevo">+ Registrar proceso</button>' : ''}</div>
        <div class="barra-filtros">
          <label>Buscar<input type="search" id="f-texto" value="${esc(f.texto)}" placeholder="Código, título, expediente…"></label>
          <label>Categoría<select id="f-categoria">${L.opciones(L.categorias().map((c) => [c.codigo, c.nombre]), f.categoria, 'Todas')}</select></label>
          <label>Vía<select id="f-via" ${cat ? '' : 'disabled'}>${L.opciones(cat ? cat.vias.map((x) => [x.codigo, x.nombre]) : [], f.via, 'Todas')}</select></label>
          ${L.es('profesional') ? '' : `<label>Profesional<select id="f-profesional">${L.opciones(L.profesionales(false).map((u) => [u.id, u.nombre]), f.profesional, 'Todos')}</select></label>`}
          <label>Estado<select id="f-estado">${L.opciones([['abiertos', 'Activos y suspendidos'], ['Activo', 'Activos'], ['Suspendido', 'Suspendidos'], ['Finalizado', 'Finalizados'], ['todos', 'Todos']], f.estado)}</select></label>
        </div>
        <section class="tarjeta">${lista.length ? `<div class="tabla-envoltura"><table class="tabla">
          <thead><tr><th>Código</th><th>Proceso</th><th>Categoría › Vía</th>${L.es('profesional') ? '' : '<th>Profesional</th>'}<th>Estado</th><th>Avance</th><th>Próximo vencimiento</th><th class="num">Docs SGD</th></tr></thead>
          <tbody>${lista.map((p) => {
            const prox = L.tareasDe(p.id).filter((t) => L.abierta(t) && t.fechaLimite).sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))[0];
            return `<tr class="fila-enlace" data-href="#proceso/${esc(p.id)}">
              <td class="mono"><a href="#proceso/${esc(p.id)}">${esc(p.codigo)}</a>${alertasPor[p.id] ? ` <span class="chip chip--critico" title="Alertas">⚠ ${alertasPor[p.id]}</span>` : ''}</td>
              <td><strong>${esc(p.titulo)}</strong>${p.expedienteJudicial ? `<div class="secundario mono">${esc(p.expedienteJudicial)}</div>` : ''}</td>
              <td>${esc(L.nombreCategoria(p.categoria))} › ${esc(L.nombreVia(p.via))}</td>
              ${L.es('profesional') ? '' : `<td>${esc(L.nombre(p.profesionalId))}</td>`}
              <td>${L.chipEstado(p.estado)}</td>
              <td>${L.avanceHtml(L.avance(p.id))}</td>
              <td>${prox ? `${esc(prox.nombre)}<br>${L.chipVence(prox)}` : '<span class="secundario">—</span>'}</td>
              <td class="num">${L.tramitesDe(p.id).length}</td></tr>`;
          }).join('')}</tbody></table></div>` : `<p class="vacio">${L.D.procesos.length ? 'No hay procesos con estos filtros.' : 'Aún no hay procesos. Se crean al indexar un trámite del SGD como «proceso nuevo» o con «Registrar proceso».'}</p>`}
        </section>`;
      const al = (id, campo, ev = 'change') => { const el = L.$(id, v); if (el) el.addEventListener(ev, () => { f[campo] = el.value; if (campo === 'categoria') f.via = ''; L.pintar(); if (ev === 'input') { const x = L.$(id); x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }); };
      al('#f-texto', 'texto', 'input'); al('#f-categoria', 'categoria'); al('#f-via', 'via'); al('#f-profesional', 'profesional'); al('#f-estado', 'estado');
      const b = L.$('#btn-nuevo', v); if (b) b.addEventListener('click', () => L.nuevoProceso());
      v.addEventListener('click', (ev) => { const tr = ev.target.closest('.fila-enlace'); if (tr && !ev.target.closest('a')) location.hash = tr.dataset.href; });
    }
  };

  L.nuevoProceso = function () {
    const c = L.modal(`${L.cabModal('Registrar proceso', 'El código se asigna automáticamente')}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-proc" novalidate>
        <div class="cascada" id="cascada"></div>
        <label>Título o materia<input name="titulo" required placeholder="Ej.: Demanda de nulidad de resolución gerencial N.° 120-2026"></label>
        <div class="doble">
          <label>Fecha de inicio<input type="date" name="fechaInicio" value="${L.hoy()}"></label>
          <label>Expediente judicial / administrativo (opcional)<input name="expedienteJudicial" placeholder="00123-2026-0-0401-JR-CI-01"></label>
        </div>
        <div class="doble">
          <label>Órgano / juzgado (opcional)<input name="organo"></label>
          <label>Contraparte (opcional)<input name="contraparte"></label>
        </div>
        <label>Observaciones (opcional)<textarea name="observaciones" rows="2"></textarea></label>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Registrar y generar ciclo</button></div>
      </form>`);
    const cascada = L.cascadaProceso(L.$('#cascada', c));
    if (!L.$('#cascada select', c)) L.$('#f-proc button.btn--primario', c).disabled = true;
    L.$('#f-proc', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const sel = cascada.valor();
      if (!sel.via || !sel.profesionalId || !f.titulo.value.trim()) { L.notificar('Complete el profesional, la vía y el título.', 'error'); return; }
      try {
        const r = await L.api('POST', '/api/procesos', { titulo: f.titulo.value, categoria: sel.categoria, via: sel.via, profesionalId: sel.profesionalId, fechaInicio: f.fechaInicio.value, expedienteJudicial: f.expedienteJudicial.value, organo: f.organo.value, contraparte: f.contraparte.value, observaciones: f.observaciones.value });
        L.cerrarModal();
        L.notificar(`Se registró ${r.proceso.codigo} con ${r.tareas.length} tarea(s).`);
        await L.refrescar();
        location.hash = `#proceso/${r.proceso.id}`;
      } catch (e) { L.error(e); }
    });
  };

  // ---------------------------------------------------- detalle del proceso
  L.vistas.proceso = {
    titulo: () => { const p = L.D.porProceso[L.parametro]; return p ? `${p.codigo}` : 'Proceso'; },
    subtitulo: () => { const p = L.D.porProceso[L.parametro]; return p ? p.titulo : ''; },
    render(v) {
      const p = L.D.porProceso[L.parametro];
      if (!p) { v.innerHTML = '<p class="vacio">El proceso no existe o no está a su cargo. <a href="#procesos">Volver</a></p>'; return; }
      const tareas = L.tareasDe(p.id);
      const editable = L.puedeEditarTareas(p);
      const tramites = L.tramitesDe(p.id);
      const pendientes = new Set(L.D.solicitudes.filter((s) => s.estado === 'pendiente').map((s) => s.tareaId));
      const acciones = [];
      if (L.es('admin', 'gerente') || (L.es('profesional') && p.profesionalId === L.yo().id)) {
        if (p.estado !== 'Activo') acciones.push(['Activo', p.estado === 'Finalizado' ? 'Reabrir el proceso' : 'Reactivar']);
        if (p.estado === 'Activo') acciones.push(['Suspendido', 'Suspender']);
        if (p.estado !== 'Finalizado') acciones.push(['Finalizado', 'Finalizar el proceso']);
      }
      acciones.push(['editar', 'Editar datos del proceso']);
      if (L.es('admin', 'gerente', 'asistente')) acciones.push(['reasignar', 'Reasignar profesional']);
      if (L.es('admin')) acciones.push(['eliminar', 'Eliminar el proceso (y sus tareas)']);
      const nombreTarea = (id) => (tareas.find((t) => t.id === id) || {}).nombre;

      v.innerHTML = `
        <p><a href="#procesos" class="enlace">← Procesos</a></p>
        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Datos del proceso</h2><p>${esc(L.nombreCategoria(p.categoria))} › ${esc(L.nombreVia(p.via))}</p></div>
            <div class="acciones-cab">${L.chipEstado(p.estado)}<select id="accion-proceso" aria-label="Acciones del proceso">${L.opciones(acciones, '', 'Acciones…')}</select></div></div>
          <div class="campos campos--rejilla">
            <div><span class="secundario">Profesional a cargo</span><div class="valor">${esc(L.nombre(p.profesionalId))}</div></div>
            <div><span class="secundario">Inicio</span><div class="valor">${L.fmtFecha(p.fechaInicio)}${p.fechaFin ? ` · fin ${L.fmtFecha(p.fechaFin)}` : ''}</div></div>
            <div><span class="secundario">Origen</span><div class="valor">${p.origen === 'SGD' ? 'Indexado desde el SGD' : 'Registrado en el portal'} por ${esc(p.creadoPor)}</div></div>
            <div><span class="secundario">Ciclo (plantilla)</span><div class="valor">${esc(p.plantillaNombre || '—')}</div></div>
            ${p.expedienteJudicial ? `<div><span class="secundario">Expediente</span><div class="valor mono">${esc(p.expedienteJudicial)}</div></div>` : ''}
            ${p.organo ? `<div><span class="secundario">Órgano</span><div class="valor">${esc(p.organo)}</div></div>` : ''}
            ${p.contraparte ? `<div><span class="secundario">Contraparte</span><div class="valor">${esc(p.contraparte)}</div></div>` : ''}
            <div><span class="secundario">Avance</span><div class="valor">${L.avanceHtml(L.avance(p.id))}</div></div>
          </div>
          ${p.observaciones ? `<p class="secundario">${esc(p.observaciones)}</p>` : ''}
        </section>

        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Ciclo de tareas</h2><p>${editable ? 'Haga clic en una tarea para ver su detalle, cambiar su estado, plazo, color o lista de verificación. También puede moverlas en <a href="#tareas">Mis tareas</a>.' : 'Haga clic en una tarea para ver su detalle. Solo el profesional a cargo la actualiza.'}</p></div>
            ${editable ? '<button class="btn btn--sm" id="btn-tarea">+ Agregar tarea</button>' : ''}</div>
          <div class="tabla-envoltura"><table class="tabla tabla--tareas">
            <thead><tr><th class="num">#</th><th>Tarea</th><th>Estado</th><th>Habilitada</th><th>Plazo</th><th>Detalle</th></tr></thead>
            <tbody>${tareas.map((t) => { const items = t.checklist || []; return `<tr class="fila-enlace ${L.habilitada(t) ? '' : 'fila-bloqueada'}" data-tarea="${esc(t.id)}" tabindex="0">
              <td class="num"><span class="punto-color" style="--c:${esc(t.color || 'var(--borde-fuerte)')}"></span>${t.orden}</td>
              <td><strong>${esc(t.nombre)}</strong>${t.referencia ? `<div class="secundario">${esc(t.referencia)}</div>` : ''}${!L.habilitada(t) ? `<div class="secundario">🔒 Espera: ${esc(nombreTarea(t.antecesoraId) || '—')}</div>` : ''}</td>
              <td>${L.chipEstado(L.estadoTarea(t))}</td>
              <td>${L.fmtFecha(t.fechaInicio)}${t.fechaFin ? `<div class="secundario">Fin: ${L.fmtFecha(t.fechaFin)}</div>` : ''}</td>
              <td>${L.chipPlazo(t)}${pendientes.has(t.id) ? '<div><span class="chip chip--advertencia">Plazo solicitado</span></div>' : ''}</td>
              <td class="nowrap">${[items.length ? `☑ ${items.filter((i) => i.hecho).length}/${items.length}` : '', (t.comentarios || []).length ? `💬 ${(t.comentarios || []).length}` : ''].filter(Boolean).join(' · ') || '<span class="secundario">—</span>'}</td></tr>`; }).join('')}</tbody>
          </table></div>
        </section>

        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Documentos del SGD</h2><p>${tramites.length} trámite(s) indexados con el Conector</p></div></div>
          ${tramites.length ? `<ul class="lista">${tramites.map((t) => `<li><div class="lista__cuerpo">
            <div class="lista__titulo"><span class="mono">${esc(t.nroTramite)}</span> · ${esc(t.asuntoSgd)}</div>
            ${t.detalle ? `<div>${esc(t.detalle)}</div>` : ''}
            <div class="lista__meta">${t.accion === 'nuevo' ? 'Originó el proceso' : 'Anexado'}${t.tareaId ? ` · tarea «${esc(nombreTarea(t.tareaId) || '—')}»` : ''} · ingreso SGD ${esc(t.fechaIngresoSgd || '—')} · indexado por ${esc(t.indexadoPor)} el ${L.fmtFechaHora(t.indexadoEn)}</div></div>
            <a class="btn btn--sm" href="${esc(t.enlaceSgd)}" target="_blank" rel="noopener">Abrir en el SGD</a></li>`).join('')}</ul>` : '<p class="vacio">Sin documentos del SGD.</p>'}
        </section>`;

      L.$('#accion-proceso', v).addEventListener('change', (ev) => { const a = ev.target.value; ev.target.value = ''; accionProceso(p, a); });
      const bt = L.$('#btn-tarea', v); if (bt) bt.addEventListener('click', () => nuevaTarea(p));
      v.addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-tarea]'); if (tr) L.abrirTarea(tr.dataset.tarea); });
      v.addEventListener('keydown', (ev) => { const tr = ev.target.closest('tr[data-tarea]'); if (tr && ev.key === 'Enter') L.abrirTarea(tr.dataset.tarea); });
    }
  };

  async function accionProceso(p, a) {
    if (!a) return;
    try {
      if (['Activo', 'Suspendido', 'Finalizado'].includes(a)) {
        if (a === 'Finalizado' && !(await L.confirmar(`¿Finalizar ${p.codigo}? Ya no admitirá documentos del SGD.`))) return;
        await L.api('PUT', `/api/procesos/${p.id}`, { estado: a });
        L.notificar(`Proceso ${a.toLowerCase()}.`);
      } else if (a === 'eliminar') {
        if (!(await L.confirmar(`¿Eliminar ${p.codigo}, sus tareas y sus documentos indexados? No se puede deshacer.`, { peligro: true, aceptar: 'Eliminar' }))) return;
        await L.api('DELETE', `/api/procesos/${p.id}`);
        location.hash = '#procesos';
      } else if (a === 'reasignar') {
        const c = L.modal(`${L.cabModal('Reasignar profesional', esc(p.codigo))}
          <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-r"><label>Profesional<select name="p">${L.opciones(L.profesionales().map((u) => [u.id, u.nombre]), p.profesionalId)}</select></label>
          <p class="secundario">Las tareas existentes se conservan; el nuevo profesional puede ajustarlas.</p>
          <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Reasignar</button></div></form>`, { angosto: true });
        L.$('#f-r', c).addEventListener('submit', async (ev) => { ev.preventDefault(); try { await L.api('PUT', `/api/procesos/${p.id}`, { profesionalId: ev.target.p.value }); L.cerrarModal(); L.notificar('Proceso reasignado.'); await L.refrescar(); } catch (e) { L.error(e); } });
        return;
      } else if (a === 'editar') {
        const c = L.modal(`${L.cabModal('Datos del proceso', esc(p.codigo))}
          <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-e">
            <label>Título<input name="titulo" value="${esc(p.titulo)}"></label>
            <div class="doble"><label>Expediente<input name="expedienteJudicial" value="${esc(p.expedienteJudicial || '')}"></label><label>Órgano<input name="organo" value="${esc(p.organo || '')}"></label></div>
            <label>Contraparte<input name="contraparte" value="${esc(p.contraparte || '')}"></label>
            <label>Observaciones<textarea name="observaciones" rows="3">${esc(p.observaciones || '')}</textarea></label>
            <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar</button></div></form>`);
        L.$('#f-e', c).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          try { await L.api('PUT', `/api/procesos/${p.id}`, { titulo: f.titulo.value, expedienteJudicial: f.expedienteJudicial.value, organo: f.organo.value, contraparte: f.contraparte.value, observaciones: f.observaciones.value }); L.cerrarModal(); L.notificar('Datos guardados.'); await L.refrescar(); } catch (e) { L.error(e); }
        });
        return;
      }
      await L.refrescar();
    } catch (e) { L.error(e); }
  }

  function nuevaTarea(p) {
    const tareas = L.tareasDe(p.id);
    const c = L.modal(`${L.cabModal('Agregar tarea', esc(p.codigo))}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-t">
        <label>Nombre<input name="nombre" required placeholder="Ej.: Absolver traslado de excepción"></label>
        <label>Después de (antecesora)<select name="ant">${L.opciones(tareas.map((t) => [t.id, `${t.orden}. ${t.nombre} (${t.estado})`]), tareas.length ? tareas[tareas.length - 1].id : '', 'Ninguna: empieza ahora')}</select></label>
        <div class="doble"><label>Fecha límite exacta<input type="date" name="fecha"></label><label>…o plazo en días hábiles<input type="number" min="0" name="dias"></label></div>
        <p class="secundario">Si no conoce el plazo, déjelo vacío: LEGAL le avisará cuando la antecesora avance.</p>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Agregar</button></div></form>`, { angosto: true });
    L.$('#f-t', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const cuerpo = { procesoId: p.id, nombre: f.nombre.value, antecesoraId: f.ant.value };
      if (f.fecha.value) cuerpo.fechaLimite = f.fecha.value;
      else if (f.dias.value !== '') { cuerpo.plazoDias = parseInt(f.dias.value, 10); cuerpo.tipoDias = 'habiles'; }
      try { await L.api('POST', '/api/tareas', cuerpo); L.cerrarModal(); L.notificar('Tarea agregada.'); await L.refrescar(); } catch (e) { L.error(e); }
    });
  }

  // ------------------------------------------------------- plazos por definir
  L.vistas.plazos = {
    titulo: 'Plazos', subtitulo: 'Defina en bloque las fechas límite pendientes de sus procesos',
    soloPendientes: true,
    render(v) {
      const activos = L.D.procesos.filter((p) => p.estado === 'Activo' && L.puedeEditarTareas(p));
      const ids = new Set(activos.map((p) => p.id));
      const alertaPor = new Set(L.D.alertas.filter(L.esAlertaPlazo).map((a) => a.tareaId));
      const solicitadas = new Set(L.D.solicitudes.filter((s) => s.estado === 'pendiente').map((s) => s.tareaId));
      const tareas = L.D.tareas.filter((t) => ids.has(t.procesoId) && L.abierta(t) && (!this.soloPendientes || (!t.fechaLimite && (t.plazoDias === null || t.plazoDias === undefined))))
        .sort((a, b) => Number(alertaPor.has(b.id) || solicitadas.has(b.id)) - Number(alertaPor.has(a.id) || solicitadas.has(a.id)) || a.procesoId.localeCompare(b.procesoId) || a.orden - b.orden);
      v.innerHTML = `
        <div class="barra-filtros">
          <label class="check"><input type="checkbox" id="f-solo" ${this.soloPendientes ? 'checked' : ''}> Solo tareas sin plazo</label>
          <span class="espacio"></span>
          <span class="secundario" id="cuenta-cambios">Sin cambios</span>
          <button class="btn btn--primario" id="btn-guardar" disabled>Guardar todos</button>
        </div>
        <div class="aviso aviso--info"><span>Para cada tarea, escriba la <strong>fecha exacta</strong> (p. ej. la fecha de audiencia notificada) o un <strong>plazo en días</strong>. Las tareas resaltadas tienen la antecesora en proceso o concluida, o una solicitud del asistente.</span></div>
        <section class="tarjeta">${tareas.length ? `<div class="tabla-envoltura"><table class="tabla tabla--plazos">
          <thead><tr><th>Proceso</th><th>Tarea</th><th>Antecesora</th><th>Fecha exacta</th><th>o plazo en días</th><th>Resultado</th></tr></thead>
          <tbody>${tareas.map((t) => {
            const p = L.D.porProceso[t.procesoId];
            const ant = L.D.porTarea[t.antecesoraId];
            const urgente = alertaPor.has(t.id) || solicitadas.has(t.id);
            return `<tr data-tarea="${esc(t.id)}" class="${urgente ? 'fila-urgente' : ''}">
              <td class="mono"><a href="#proceso/${esc(p.id)}">${esc(p.codigo)}</a><div class="secundario">${esc(L.nombreVia(p.via))}</div></td>
              <td><a href="#" class="enlace-tarea" data-abrir="${esc(t.id)}"><strong>${esc(t.nombre)}</strong></a> ${L.chipEstado(L.estadoTarea(t))}${solicitadas.has(t.id) ? ' <span class="chip chip--advertencia">Solicitado</span>' : ''}${t.referencia ? `<div class="secundario">${esc(t.referencia)}</div>` : ''}</td>
              <td>${ant ? `${esc(ant.nombre)}<br>${L.chipEstado(L.estadoTarea(ant))}` : '<span class="secundario">— (inicia con el proceso)</span>'}</td>
              <td><input type="date" data-campo="fecha" value="${esc(t.fechaLimite || '')}" min="${esc(t.fechaInicio || '')}" aria-label="Fecha límite"></td>
              <td class="plazo-dias"><input type="number" min="0" max="3650" data-campo="dias" value="${t.plazoDias ?? ''}" aria-label="Días" placeholder="días"><select data-campo="tipo" aria-label="Tipo de días">${L.opciones([['habiles', 'hábiles'], ['calendario', 'calendario']], t.tipoDias)}</select></td>
              <td data-resultado class="secundario">${esc(L.vencimiento(t).texto)}</td></tr>`;
          }).join('')}</tbody></table></div>` : `<p class="vacio">${activos.length ? 'Todas las tareas abiertas tienen plazo. ✓' : 'No tiene procesos activos.'}</p>`}
        </section>`;
      const cambios = new Map();
      const btn = L.$('#btn-guardar', v);
      L.$('#f-solo', v).addEventListener('change', (ev) => { this.soloPendientes = ev.target.checked; L.pintar(); });
      v.addEventListener('input', (ev) => {
        const tr = ev.target.closest('tr[data-tarea]');
        if (!tr) return;
        const t = L.D.porTarea[tr.dataset.tarea];
        const fecha = L.$('[data-campo=fecha]', tr);
        const dias = L.$('[data-campo=dias]', tr);
        const tipo = L.$('[data-campo=tipo]', tr).value;
        const res = L.$('[data-resultado]', tr);
        if (ev.target === fecha && fecha.value) dias.value = '';
        if (ev.target === dias && dias.value !== '') fecha.value = '';
        if (fecha.value) { cambios.set(t.id, { id: t.id, fechaLimite: fecha.value }); res.textContent = `Vence el ${L.fmtFecha(fecha.value)}`; }
        else if (dias.value !== '') {
          const n = parseInt(dias.value, 10);
          cambios.set(t.id, { id: t.id, plazoDias: n, tipoDias: tipo });
          res.textContent = !t.fechaInicio ? 'Se calculará al habilitarse la tarea' : `Vence el ${L.fmtFecha(L.sumarDias(t.fechaInicio, n, tipo))}`;
        } else { cambios.delete(t.id); res.textContent = L.vencimiento(t).texto; }
        tr.classList.toggle('fila-cambiada', cambios.has(t.id));
        btn.disabled = !cambios.size;
        L.$('#cuenta-cambios', v).textContent = cambios.size ? `${cambios.size} cambio(s) sin guardar` : 'Sin cambios';
        L.editando = cambios.size > 0;
      });
      btn.addEventListener('click', async () => {
        try {
          const r = await L.api('PUT', '/api/plazos', { cambios: [...cambios.values()] });
          L.editando = false;
          L.notificar(`${r.tareas.length} plazo(s) guardado(s).`);
          await L.refrescar();
        } catch (e) { L.error(e); }
      });
    }
  };

  // ------------------------------------------------------------ trámites SGD
  L.vistas.tramites = {
    titulo: 'Trámites SGD indexados', subtitulo: 'Documentos del SGD vinculados a procesos desde el Conector',
    filtros: { texto: '', usuario: '' },
    render(v) {
      const f = this.filtros;
      const texto = L.normal(f.texto);
      const indexadores = [...new Set(L.D.tramites.map((t) => t.indexadoPor))];
      const lista = L.D.tramites.filter((t) => { const p = L.D.porProceso[t.procesoId] || {}; return (!f.usuario || t.indexadoPor === f.usuario) && (!texto || L.normal(`${t.nroTramite} ${t.asuntoSgd} ${t.detalle} ${p.codigo} ${p.titulo}`).includes(texto)); });
      v.innerHTML = `
        <div class="barra-filtros">
          <label>Buscar<input type="search" id="f-texto" value="${esc(f.texto)}" placeholder="N.° de trámite, asunto, proceso…"></label>
          <label>Indexado por<select id="f-usuario">${L.opciones(indexadores.map((u) => [u, u]), f.usuario, 'Todos')}</select></label>
        </div>
        <section class="tarjeta">${lista.length ? `<div class="tabla-envoltura"><table class="tabla">
          <thead><tr><th>N.° trámite</th><th>Asunto del SGD</th><th>Detalle de la indexación</th><th>Proceso</th><th>Ingreso SGD</th><th>Indexado</th><th></th></tr></thead>
          <tbody>${lista.map((t) => { const p = L.D.porProceso[t.procesoId] || {}; const tarea = L.D.porTarea[t.tareaId]; return `<tr>
            <td class="mono">${esc(t.nroTramite)}${t.idInterno ? `<div class="secundario">ID ${esc(t.idInterno)}</div>` : ''}</td>
            <td>${esc(t.asuntoSgd)}</td>
            <td>${esc(t.detalle || '—')}${tarea ? `<div class="secundario">Tarea: ${esc(tarea.nombre)}</div>` : ''}</td>
            <td><a href="#proceso/${esc(p.id)}" class="mono">${esc(p.codigo || '—')}</a><div class="secundario">${t.accion === 'nuevo' ? 'Originó el proceso' : 'Anexado'}</div></td>
            <td>${esc(t.fechaIngresoSgd || '—')}</td>
            <td>${L.fmtFechaHora(t.indexadoEn)}<div class="secundario">${esc(t.indexadoPor)}</div></td>
            <td><a class="btn btn--sm" href="${esc(t.enlaceSgd)}" target="_blank" rel="noopener">Abrir</a></td></tr>`; }).join('')}</tbody></table></div>` : `<p class="vacio">${L.D.tramites.length ? 'Sin coincidencias.' : 'Aún no se indexan trámites. Use la <a href="#extension">extensión Conector SGD</a> en el SGD.'}</p>`}
        </section>`;
      L.$('#f-texto', v).addEventListener('input', (ev) => { f.texto = ev.target.value; L.pintar(); const x = L.$('#f-texto'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); });
      L.$('#f-usuario', v).addEventListener('change', (ev) => { f.usuario = ev.target.value; L.pintar(); });
    }
  };
})();
