/*
 * LEGAL · Portal — paneles de indicadores (KPI) por rol y vista de alertas.
 * Las definiciones de los indicadores están en docs/13-kpi-y-alertas.md.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  // ---------------------------------------------------------- cálculos
  /** Indicadores de cumplimiento sobre un conjunto de procesos. */
  L.indicadores = function (procesos) {
    const ids = new Set(procesos.map((p) => p.id));
    const tareas = L.D.tareas.filter((t) => ids.has(t.procesoId));
    const activos = procesos.filter((p) => p.estado === 'Activo');
    const idsActivos = new Set(activos.map((p) => p.id));
    const abiertas = tareas.filter((t) => L.abierta(t) && idsActivos.has(t.procesoId));
    const vencidas = abiertas.filter((t) => L.vencimiento(t).tipo === 'vencida');
    const proximas = abiertas.filter((t) => L.vencimiento(t).tipo === 'proxima');
    const sinPlazo = L.D.alertas.filter((a) => a.tipo === 'plazo-no-definido' && ids.has(a.procesoId));
    const anio = L.hoy().slice(0, 4);
    const conPlazoCerradas = tareas.filter((t) => !L.abierta(t) && t.fechaLimite && t.fechaFin && t.fechaFin.startsWith(anio));
    const enPlazo = conPlazoCerradas.filter((t) => t.fechaFin <= t.fechaLimite);
    const finalizados = procesos.filter((p) => p.estado === 'Finalizado' && (p.fechaFin || '').startsWith(anio));
    const ciclo = finalizados.map((p) => L.diasEntre(p.fechaInicio, p.fechaFin));
    const resolucion = tareas.filter((t) => !L.abierta(t) && t.fechaInicio && t.fechaFin).map((t) => L.diasEntre(t.fechaInicio, t.fechaFin));
    const mes = L.hoy().slice(0, 7);
    const tramites = L.D.tramites.filter((t) => ids.has(t.procesoId));
    const oportunidad = tramites.map((t) => { const f = L.fechaSgd(t.fechaIngresoSgd); return f ? Math.max(0, L.diasEntre(f, t.indexadoEn.slice(0, 10))) : null; }).filter((x) => x !== null);
    return {
      procesos, tareas, activos, abiertas, vencidas, proximas, sinPlazo, finalizados, tramites,
      nuevosMes: procesos.filter((p) => p.fechaInicio.startsWith(mes)),
      cumplimiento: conPlazoCerradas.length ? enPlazo.length / conPlazoCerradas.length : null,
      cerradasConPlazo: conPlazoCerradas.length,
      cicloMedio: L.promedio(ciclo),
      resolucionMedia: L.promedio(resolucion),
      oportunidadMediana: L.mediana(oportunidad),
      tramites30: tramites.filter((t) => L.diasEntre(t.indexadoEn.slice(0, 10), L.hoy()) <= 30),
      cicloBase: activos.filter((p) => p.cicloBase)
    };
  };

  const alertasLista = (alertas, max = 8) => alertas.length
    ? `<ul class="lista">${alertas.slice(0, max).map((a) => `
        <li><div class="lista__cuerpo">
          <div class="lista__titulo">${L.chipNivel(a.nivel)} ${esc(a.titulo)}</div>
          <div class="lista__meta">${esc(a.detalle)}</div></div>
          ${a.procesoId ? `<a class="enlace" href="#proceso/${esc(a.procesoId)}">Ver</a>` : ''}</li>`).join('')}</ul>
       ${alertas.length > max ? `<p><a href="#alertas" class="enlace">Ver las ${alertas.length} alertas</a></p>` : ''}`
    : '<p class="vacio">Sin alertas. ✓</p>';

  function cartaVacia() {
    if (L.D.procesos.length) return '';
    const pasos = {
      admin: 'La base de datos está vacía. Cree los usuarios (profesionales, asistentes y gerentes) en <a href="#usuarios">Usuarios</a>; luego cada profesional define sus <a href="#plantillas">plantillas</a> y el asistente indexa trámites desde el SGD con la extensión.',
      gerente: 'Aún no hay procesos registrados. Los indicadores se llenarán conforme se indexen trámites del SGD.',
      profesional: 'Aún no tiene procesos. Defina sus <a href="#plantillas">plantillas de tareas</a> por vía procedimental: se usarán al crear sus procesos.',
      asistente: 'Aún no hay procesos. Indexe un trámite desde el SGD con la <a href="#extension">extensión Conector SGD</a> o registre un proceso en <a href="#procesos">Procesos</a>.'
    }[L.rol()];
    return `<div class="aviso aviso--info bienvenida"><span>${pasos}</span></div>`;
  }

  // ------------------------------------------------- panel institucional
  L.vistas.panel = {
    titulo: () => ({ admin: 'Panel institucional', gerente: 'Panel institucional', profesional: 'Mi panel', asistente: 'Mi panel' })[L.rol()],
    subtitulo: () => ({ admin: 'Indicadores de toda la cartera', gerente: 'Indicadores de gestión de la cartera de procesos legales', profesional: 'Mis procesos, plazos y alertas', asistente: 'Indexación de trámites y seguimiento de plazos' })[L.rol()],
    render(v) {
      if (L.es('profesional')) return panelProfesional(v);
      if (L.es('asistente')) return panelAsistente(v);
      return panelGerente(v);
    }
  };

  function panelGerente(v) {
    const filtro = L.vistas.panel.filtro || '';
    const procs = L.D.procesos.filter((p) => !filtro || p.categoria === filtro);
    const k = L.indicadores(procs);
    const porCategoria = L.categorias().map((c) => ({ etiqueta: c.nombre, valor: k.activos.filter((p) => p.categoria === c.codigo).length }))
      .filter((i) => i.valor || !filtro).sort((a, b) => b.valor - a.valor);
    const viasCuenta = {};
    k.activos.forEach((p) => { viasCuenta[p.via] = (viasCuenta[p.via] || 0) + 1; });
    const porVia = Object.entries(viasCuenta).map(([via, n]) => ({ etiqueta: L.nombreVia(via), valor: n, detalle: `${n} proceso(s) · ${L.nombreCategoria((L.buscarVia(via).c || {}).codigo)}` })).sort((a, b) => b.valor - a.valor).slice(0, 8);
    const filas = L.profesionales(false).map((u) => {
      const kp = L.indicadores(procs.filter((p) => p.profesionalId === u.id));
      return { u, k: kp };
    }).filter((f) => f.k.procesos.length || f.u.activo);
    const maxAb = Math.max(1, ...filas.map((f) => f.k.abiertas.length));
    const alertas = L.D.alertas.filter((a) => a.nivel !== 'info' && (!filtro || !a.procesoId || (L.D.porProceso[a.procesoId] || {}).categoria === filtro));

    v.innerHTML = `${cartaVacia()}
      <div class="barra-filtros">
        <label>Categoría<select id="f-categoria">${L.opciones(L.categorias().map((c) => [c.codigo, c.nombre]), filtro, 'Todas las categorías')}</select></label>
        <span class="espacio"></span><span class="secundario">Corte al ${L.fmtFecha(L.hoy())}</span>
      </div>
      <div class="rejilla rejilla--kpi">
        ${L.kpi('Procesos activos', k.activos.length, `${k.nuevosMes.length} nuevo(s) este mes`)}
        ${L.kpi('Finalizados en el año', k.finalizados.length, k.cicloMedio === null ? 'Sin cierres aún' : `Ciclo medio: ${L.redondear(k.cicloMedio, 0)} días`)}
        ${L.kpi('Cumplimiento de plazos', L.pct(k.cumplimiento), `${k.cerradasConPlazo} tarea(s) cerradas con plazo en el año`, k.cumplimiento !== null && k.cumplimiento < 0.8 ? 'kpi--critico' : '', 'Tareas finalizadas en o antes de su fecha límite ÷ tareas finalizadas con fecha límite (año en curso). Meta: ≥ 90 %')}
        ${L.kpi('Tareas vencidas', k.vencidas.length, `${k.proximas.length} vencen en ≤ ${L.D.config.diasAlertaPorVencer} días hábiles`, k.vencidas.length ? 'kpi--critico' : '')}
        ${L.kpi('Plazos por definir', k.sinPlazo.length, 'Tareas cuya antecesora avanzó sin fecha límite', k.sinPlazo.length ? 'kpi--critico' : '')}
        ${L.kpi('Trámites SGD indexados', k.tramites30.length, `Últimos 30 días · oportunidad ${k.oportunidadMediana === null ? '—' : `${L.redondear(k.oportunidadMediana, 0)} d (mediana)`}`, '', 'Oportunidad: días entre el ingreso del trámite al SGD y su indexación en LEGAL (mediana).')}
      </div>
      <div class="rejilla rejilla--2">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos activos por categoría</h2><p>Según la taxonomía normativa</p></div></div>${L.barrasH(porCategoria, { unidad: 'procesos activos' })}</section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos activos por vía procedimental</h2><p>Las 8 vías con más procesos</p></div></div>${L.barrasH(porVia, { unidad: 'procesos' })}</section>
      </div>
      <div class="rejilla rejilla--3-1">
        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Carga y desempeño por profesional</h2><p>Procesos activos, tareas abiertas y cumplimiento</p></div></div>
          <div class="tabla-envoltura"><table class="tabla">
            <thead><tr><th>Profesional</th><th class="num">Activos</th><th>Tareas abiertas</th><th class="num">Vencidas</th><th class="num">Por definir</th><th class="num">Cumplimiento</th><th class="num">Resolución media</th></tr></thead>
            <tbody>${filas.length ? filas.map(({ u, k: x }) => `<tr>
              <td><strong>${esc(u.nombre)}</strong>${u.activo ? '' : ' <span class="chip">Inactivo</span>'}<div class="secundario">${esc(u.cargo || '')}</div></td>
              <td class="num">${x.activos.length}</td>
              <td><div class="progreso" title="${x.abiertas.length} tareas abiertas"><span style="width:${(x.abiertas.length / maxAb) * 100}%"></span></div> ${x.abiertas.length}</td>
              <td class="num">${x.vencidas.length ? `<span class="chip chip--critico">${x.vencidas.length}</span>` : 0}</td>
              <td class="num">${x.sinPlazo.length ? `<span class="chip chip--advertencia">${x.sinPlazo.length}</span>` : 0}</td>
              <td class="num">${L.pct(x.cumplimiento)}</td>
              <td class="num">${x.resolucionMedia === null ? '—' : `${L.redondear(x.resolucionMedia)} d`}</td></tr>`).join('') : '<tr><td colspan="7" class="vacio">No hay profesionales registrados.</td></tr>'}</tbody>
          </table></div>
        </section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Alertas</h2><p>Críticas, altas y medias</p></div></div>${alertasLista(alertas)}</section>
      </div>
      <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Trámites SGD indexados por semana</h2><p>Últimas 8 semanas</p></div></div>${L.columnas(L.serieSemanal(k.tramites.map((t) => t.indexadoEn)))}</section>`;
    L.$('#f-categoria', v).addEventListener('change', (ev) => { L.vistas.panel.filtro = ev.target.value; L.pintar(); });
  }

  function panelProfesional(v) {
    const k = L.indicadores(L.D.procesos);
    const misSolicitudes = L.D.alertas.filter((a) => a.tipo === 'solicitud-plazo');
    const prioridades = k.abiertas.filter((t) => t.fechaLimite).sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite)).slice(0, 8);
    v.innerHTML = `${cartaVacia()}
      <div class="rejilla rejilla--kpi">
        ${L.kpi('Mis procesos activos', k.activos.length, `${k.finalizados.length} finalizado(s) en el año`)}
        ${L.kpi('Tareas abiertas', k.abiertas.length, `${k.proximas.length} vencen en ≤ ${L.D.config.diasAlertaPorVencer} días hábiles`)}
        ${L.kpi('Tareas vencidas', k.vencidas.length, 'Requieren atención inmediata', k.vencidas.length ? 'kpi--critico' : '')}
        ${L.kpi('Plazos por definir', k.sinPlazo.length, `<a href="#plazos">Definir ahora</a> · ${misSolicitudes.length} solicitud(es)`, k.sinPlazo.length ? 'kpi--critico' : '')}
        ${L.kpi('Cumplimiento de plazos', L.pct(k.cumplimiento), `${k.cerradasConPlazo} tarea(s) cerradas con plazo`, '', 'Tareas finalizadas a tiempo ÷ tareas finalizadas con fecha límite (año en curso)')}
        ${L.kpi('Resolución media', k.resolucionMedia === null ? '—' : `${L.redondear(k.resolucionMedia)} d`, 'Días desde que una tarea inicia hasta que concluye')}
      </div>
      <div class="rejilla rejilla--3-1">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Próximos vencimientos</h2><p>Tareas abiertas por fecha límite</p></div><a class="btn btn--sm" href="#tareas">Mis tareas</a></div>
          ${prioridades.length ? `<ul class="lista">${prioridades.map((t) => { const p = L.D.porProceso[t.procesoId]; return `<li><div class="lista__cuerpo"><div class="lista__titulo">${esc(t.nombre)}</div><div class="lista__meta">${esc(p.codigo)} · ${esc(p.titulo)}</div></div>${L.chipVence(t)} <a class="enlace" href="#proceso/${esc(p.id)}">Ver</a></li>`; }).join('')}</ul>` : '<p class="vacio">No hay tareas con fecha límite.</p>'}
        </section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Alertas</h2><p>Lo que requiere su acción</p></div></div>${alertasLista(L.D.alertas)}</section>
      </div>
      <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Avance de mis procesos activos</h2><p>Tareas finalizadas sobre el total del ciclo</p></div></div>
        ${k.activos.length ? `<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Proceso</th><th>Vía</th><th>Avance</th><th>Tarea en curso</th></tr></thead><tbody>${k.activos.map((p) => {
          const actual = L.tareasDe(p.id).find((t) => t.estado === 'En proceso');
          return `<tr><td><a href="#proceso/${esc(p.id)}"><strong>${esc(p.codigo)}</strong></a> ${esc(p.titulo)}</td><td>${esc(L.nombreVia(p.via))}</td><td><div class="progreso"><span style="width:${L.avance(p.id) * 100}%"></span></div> ${L.pct(L.avance(p.id))}</td><td>${actual ? `${esc(actual.nombre)} ${L.chipVence(actual)}` : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="vacio">Sin procesos activos.</p>'}
      </section>`;
  }

  function panelAsistente(v) {
    const yo = L.yo().usuario;
    const mios = L.D.tramites.filter((t) => t.indexadoPor === yo);
    const hoy = L.hoy();
    const dias = (t) => L.diasEntre(t.indexadoEn.slice(0, 10), hoy);
    const k = L.indicadores(L.D.procesos);
    const misProcesos = L.D.procesos.filter((p) => p.creadoPor === yo && p.fechaInicio.startsWith(hoy.slice(0, 7)));
    const oportunidad = L.mediana(mios.map((t) => { const f = L.fechaSgd(t.fechaIngresoSgd); return f ? Math.max(0, L.diasEntre(f, t.indexadoEn.slice(0, 10))) : null; }).filter((x) => x !== null));
    const solicitudes = L.D.solicitudes.filter((s) => s.de === L.yo().id && s.estado === 'pendiente');
    const sinTarea = mios.filter((t) => t.accion === 'existente' && !t.tareaId).length;
    const existentes = mios.filter((t) => t.accion === 'existente').length;
    const alertas = L.D.alertas.filter((a) => ['plazo-no-definido', 'solicitud-plazo', 'tarea-vencida', 'sin-plantilla'].includes(a.tipo));
    v.innerHTML = `${cartaVacia()}
      <div class="rejilla rejilla--kpi">
        ${L.kpi('Indexados hoy', mios.filter((t) => dias(t) === 0).length, `${mios.filter((t) => dias(t) <= 6).length} en los últimos 7 días`)}
        ${L.kpi('Indexados en 30 días', mios.filter((t) => dias(t) <= 30).length, `${L.D.tramites.filter((t) => dias(t) <= 30).length} en toda la gerencia`)}
        ${L.kpi('Procesos creados este mes', misProcesos.length, `${k.cicloBase.length} activo(s) con ciclo base (sin plantilla)`)}
        ${L.kpi('Oportunidad de indexación', oportunidad === null ? '—' : `${L.redondear(oportunidad, 0)} d`, 'Mediana: ingreso al SGD → indexación. Meta: ≤ 1 día', oportunidad !== null && oportunidad > 2 ? 'kpi--critico' : '')}
        ${L.kpi('Solicitudes de plazo pendientes', solicitudes.length, `${k.sinPlazo.length} tarea(s) con plazo por definir`, '', 'Solicitudes enviadas a profesionales que aún no definen el plazo')}
        ${L.kpi('Anexos sin tarea relacionada', existentes ? L.pct(sinTarea / existentes) : '—', `${sinTarea} de ${existentes} documentos anexados`, '', 'Relacionar el documento con su tarea ayuda al profesional a ubicarlo')}
      </div>
      <div class="rejilla rejilla--3-1">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Mis últimas indexaciones</h2><p>Registradas desde el Conector SGD</p></div><a class="btn btn--sm" href="#tramites">Ver todas</a></div>
          ${mios.length ? `<ul class="lista">${mios.slice(0, 8).map((t) => { const p = L.D.porProceso[t.procesoId] || {}; return `<li><div class="lista__cuerpo"><div class="lista__titulo">${esc(t.nroTramite)} · ${esc(t.asuntoSgd)}</div><div class="lista__meta">${t.accion === 'nuevo' ? 'Creó' : 'Anexado a'} ${esc(p.codigo || '')} · ${L.fmtFechaHora(t.indexadoEn)}</div></div><a class="enlace" href="#proceso/${esc(p.id)}">Ver</a></li>`; }).join('')}</ul>` : '<p class="vacio">Aún no ha indexado trámites. Use la <a href="#extension">extensión Conector SGD</a>.</p>'}
        </section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Plazos y solicitudes</h2><p>Puede pedir al profesional que defina el plazo</p></div></div>${alertasLista(alertas)}</section>
      </div>
      <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Trámites indexados por semana</h2><p>Toda la gerencia · últimas 8 semanas</p></div></div>${L.columnas(L.serieSemanal(L.D.tramites.map((t) => t.indexadoEn)))}</section>`;
  }

  // ---------------------------------------------------------------- alertas
  L.vistas.alertas = {
    titulo: 'Alertas', subtitulo: 'Calculadas en el servidor con las reglas institucionales',
    render(v) {
      const filtro = L.vistas.alertas.filtro || '';
      const tipos = { 'tarea-vencida': 'Tarea vencida', 'tarea-por-vencer': 'Tarea por vencer', 'plazo-no-definido': 'Plazo no definido', 'solicitud-plazo': 'Solicitud de plazo', 'sin-movimiento': 'Proceso sin movimiento', 'sin-plantilla': 'Ciclo base sin plantilla', 'listo-para-finalizar': 'Proceso sin tareas abiertas', 'tramite-nuevo': 'Nuevo documento SGD', 'carga-critica': 'Carga crítica' };
      const lista = L.D.alertas.filter((a) => !filtro || a.tipo === filtro);
      const puedeSolicitar = L.es('asistente', 'gerente', 'admin');
      const pendiente = new Set(L.D.solicitudes.filter((s) => s.estado === 'pendiente').map((s) => s.tareaId));
      v.innerHTML = `
        <div class="barra-filtros">
          <label>Tipo<select id="f-tipo">${L.opciones(Object.entries(tipos).map(([k, t]) => [k, `${t} (${L.D.alertas.filter((a) => a.tipo === k).length})`]), filtro, `Todas (${L.D.alertas.length})`)}</select></label>
          ${L.es('profesional') ? '<a class="btn btn--primario" href="#plazos">Definir plazos pendientes</a>' : ''}
        </div>
        <section class="tarjeta">${lista.length ? `<div class="tabla-envoltura"><table class="tabla">
          <thead><tr><th>Nivel</th><th>Alerta</th><th>Profesional</th><th>Acción</th></tr></thead>
          <tbody>${lista.map((a) => `<tr>
            <td>${L.chipNivel(a.nivel)}</td>
            <td><strong>${esc(a.titulo)}</strong><div class="secundario">${esc(a.detalle)}</div></td>
            <td>${esc(L.nombre(a.profesionalId))}</td>
            <td><select class="accion-alerta" data-proceso="${esc(a.procesoId || '')}" data-tarea="${esc(a.tareaId || '')}" aria-label="Acciones">
              ${L.opciones([
                ...(a.procesoId ? [['ver', 'Ver el proceso']] : []),
                ...(a.tipo === 'plazo-no-definido' && puedeSolicitar && !pendiente.has(a.tareaId) ? [['solicitar', 'Solicitar definición de plazo']] : []),
                ...(['plazo-no-definido', 'solicitud-plazo'].includes(a.tipo) && L.es('profesional', 'admin') ? [['plazos', 'Definir el plazo']] : [])
              ], '', 'Acciones…')}</select></td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">No hay alertas. ✓</p>'}
        </section>`;
      L.$('#f-tipo', v).addEventListener('change', (ev) => { L.vistas.alertas.filtro = ev.target.value; L.pintar(); });
      v.addEventListener('change', async (ev) => {
        const s = ev.target;
        if (!s.matches('.accion-alerta') || !s.value) return;
        const accion = s.value;
        s.value = '';
        if (accion === 'ver') location.hash = `#proceso/${s.dataset.proceso}`;
        if (accion === 'plazos') location.hash = '#plazos';
        if (accion === 'solicitar') L.solicitarPlazo(s.dataset.tarea);
      });
    }
  };

  L.solicitarPlazo = function (tareaId) {
    const t = L.D.porTarea[tareaId];
    const p = L.D.porProceso[t.procesoId];
    const c = L.modal(`${L.cabModal('Solicitar definición de plazo', `${esc(p.codigo)} · ${esc(L.nombre(p.profesionalId))}`)}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-sol">
        <p>Tarea: <strong>${esc(t.nombre)}</strong></p>
        <label>Mensaje para el profesional (opcional)<textarea name="mensaje" rows="3" placeholder="Ej.: Llegó la resolución que fija la audiencia."></textarea></label>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Enviar solicitud</button></div>
      </form>`, { angosto: true });
    L.$('#f-sol', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await L.api('POST', '/api/solicitudes', { tareaId, mensaje: ev.target.mensaje.value });
        L.cerrarModal();
        L.notificar('Solicitud enviada: el profesional la verá en sus alertas.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    });
  };
})();
