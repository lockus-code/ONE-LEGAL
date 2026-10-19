/*
 * LEGAL · Portal — paneles de indicadores (KPI) por rol y vista de alertas.
 * Las definiciones de los indicadores están en docs/13-kpi-y-alertas.md.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  // ---------------------------------------------------------- cálculos
  /**
   * Índice de desempeño del cronograma (SPI, aproximación por tareas): de las tareas cuya
   * fecha límite ya llegó (valor planificado), cuántas están finalizadas (valor ganado).
   */
  L.spi = function (tareas) {
    const hoy = L.hoy();
    const planificadas = tareas.filter((t) => t.fechaLimite && t.fechaLimite <= hoy);
    return planificadas.length ? planificadas.filter((t) => !L.abierta(t)).length / planificadas.length : null;
  };

  /** Avance planificado a la fecha: tareas con fecha límite ya cumplida ÷ total del ciclo. */
  L.avancePlan = function (pid) {
    const ts = L.tareasDe(pid);
    return ts.length ? ts.filter((t) => t.fechaLimite && t.fechaLimite <= L.hoy()).length / ts.length : 0;
  };

  /** Tarea en curso del proceso: la que está en proceso o en revisión; si no, la primera habilitada. */
  L.tareaActual = (pid) => L.tareasDe(pid).find((t) => t.estado === 'En proceso' || t.estado === 'En revisión') || L.tareasDe(pid).find((t) => L.abierta(t) && L.habilitada(t));

  /**
   * Semáforo del proceso (estado de salud, a la manera de un informe de estado de proyecto):
   * rojo = tareas vencidas o antecesora finalizada sin plazo por más de N días; ámbar = por vencer,
   * plazo por definir, solicitud pendiente o sin movimiento; verde = en plazo; gris = suspendido o finalizado.
   */
  L.salud = function (p) {
    if (p.estado !== 'Activo') return { nivel: 'gris', texto: p.estado, motivos: [] };
    const alertas = L.D.alertas.filter((a) => a.procesoId === p.id);
    const motivos = [];
    const vencidas = L.tareasDe(p.id).filter((t) => L.abierta(t) && L.vencimiento(t).tipo === 'vencida').length;
    if (vencidas) motivos.push(`${vencidas} tarea(s) vencida(s)`);
    if (alertas.some((a) => a.tipo === 'sucesora-sin-plazo' && a.nivel === 'critica')) motivos.push('antecesora finalizada sin plazo definido');
    if (motivos.length) return { nivel: 'rojo', texto: 'En riesgo', motivos };
    const n = (tipo) => alertas.filter((a) => (typeof tipo === 'function' ? tipo(a) : a.tipo === tipo)).length;
    if (n('tarea-por-vencer')) motivos.push(`${n('tarea-por-vencer')} por vencer`);
    if (n(L.esAlertaPlazo)) motivos.push(`${n(L.esAlertaPlazo)} sin plazo`);
    if (n('solicitud-plazo')) motivos.push('solicitud de plazo');
    if (n('sin-movimiento')) motivos.push('sin movimiento');
    if (motivos.length) return { nivel: 'ambar', texto: 'Atención', motivos };
    return { nivel: 'verde', texto: 'En plazo', motivos: [] };
  };
  L.chipSalud = (s) => `<span class="salud salud--${s.nivel}" title="${esc(s.motivos.join(' · ') || s.texto)}">${esc(s.texto)}</span>`;

  /** Indicadores de cumplimiento sobre un conjunto de procesos. */
  L.indicadores = function (procesos) {
    const ids = new Set(procesos.map((p) => p.id));
    const tareas = L.D.tareas.filter((t) => ids.has(t.procesoId));
    const activos = procesos.filter((p) => p.estado === 'Activo');
    const idsActivos = new Set(activos.map((p) => p.id));
    const abiertas = tareas.filter((t) => L.abierta(t) && idsActivos.has(t.procesoId));
    const vencidas = abiertas.filter((t) => L.vencimiento(t).tipo === 'vencida');
    const proximas = abiertas.filter((t) => L.vencimiento(t).tipo === 'proxima');
    const sinPlazo = L.D.alertas.filter((a) => L.esAlertaPlazo(a) && ids.has(a.procesoId));
    const anio = L.hoy().slice(0, 4);
    const conPlazoCerradas = tareas.filter((t) => !L.abierta(t) && t.fechaLimite && t.fechaFin && t.fechaFin.startsWith(anio));
    const enPlazo = conPlazoCerradas.filter((t) => t.fechaFin <= t.fechaLimite);
    const finalizados = procesos.filter((p) => p.estado === 'Finalizado' && (p.fechaFin || '').startsWith(anio));
    const ciclo = finalizados.map((p) => L.diasEntre(p.fechaInicio, p.fechaFin));
    const resolucion = tareas.filter((t) => !L.abierta(t) && t.fechaInicio && t.fechaFin).map((t) => L.diasEntre(t.fechaInicio, t.fechaFin));
    const mes = L.hoy().slice(0, 7);
    const tramites = L.D.tramites.filter((t) => ids.has(t.procesoId));
    const oportunidad = tramites.map((t) => { const f = L.fechaSgd(t.fechaIngresoSgd); return f ? Math.max(0, L.diasEntre(f, t.indexadoEn.slice(0, 10))) : null; }).filter((x) => x !== null);
    const salud = { rojo: [], ambar: [], verde: [] };
    activos.forEach((p) => salud[L.salud(p).nivel].push(p));
    return {
      procesos, tareas, activos, abiertas, vencidas, proximas, sinPlazo, finalizados, tramites, salud,
      suspendidos: procesos.filter((p) => p.estado === 'Suspendido'),
      nuevosMes: procesos.filter((p) => p.fechaInicio.startsWith(mes)),
      cumplimiento: conPlazoCerradas.length ? enPlazo.length / conPlazoCerradas.length : null,
      cerradasConPlazo: conPlazoCerradas.length,
      spi: L.spi(tareas.filter((t) => idsActivos.has(t.procesoId))),
      cicloMedio: L.promedio(ciclo),
      resolucionMedia: L.promedio(resolucion),
      oportunidadMediana: L.mediana(oportunidad),
      tramites30: tramites.filter((t) => L.diasEntre(t.indexadoEn.slice(0, 10), L.hoy()) <= 30)
    };
  };

  // ------------------------------------------------------------ componentes
  const NIVELES = [['critica', 'Críticas'], ['alta', 'Altas'], ['media', 'Medias'], ['info', 'Avisos']];

  const accionAlerta = (a) => `${a.notificacionId ? `<button type="button" class="enlace" data-visto="${esc(a.notificacionId)}" title="Marcar como visto">✓ Visto</button>` : ''}
    ${a.tareaId ? `<a class="enlace" href="#" data-abrir="${esc(a.tareaId)}">Abrir</a>` : a.procesoId ? `<a class="enlace" href="#proceso/${esc(a.procesoId)}">Ver</a>` : a.tipo.startsWith('plantilla') ? '<a class="enlace" href="#plantillas">Ver</a>' : ''}`;

  const alertasLista = (alertas, max = 8) => alertas.length
    ? `<ul class="lista">${alertas.slice(0, max).map((a) => `
        <li><div class="lista__cuerpo">
          <div class="lista__titulo">${L.chipNivel(a.nivel)} ${esc(a.titulo)}</div>
          <div class="lista__meta">${esc(a.detalle)}</div></div>${accionAlerta(a)}</li>`).join('')}</ul>
       ${alertas.length > max ? `<p><a href="#alertas" class="enlace">Ver las ${alertas.length} alertas</a></p>` : ''}`
    : '<p class="vacio">Sin alertas. ✓</p>';

  /** Alertas agrupadas por nivel en desplegables; críticas y altas abiertas. */
  const alertasPorNivel = (alertas, { conProfesional = false, max = 6 } = {}) => {
    if (!alertas.length) return '<p class="vacio">Sin alertas. ✓</p>';
    return NIVELES.map(([nivel, nombre]) => {
      const grupo = alertas.filter((a) => a.nivel === nivel);
      if (!grupo.length) return '';
      return `<details class="desplegable desplegable--${nivel}" ${nivel === 'critica' || nivel === 'alta' ? 'open' : ''}>
        <summary><span class="desplegable__titulo">${L.chipNivel(nivel)} ${nombre}</span><span class="cuenta">${grupo.length}</span></summary>
        <ul class="lista">${grupo.slice(0, max).map((a) => `<li><div class="lista__cuerpo"><div class="lista__titulo">${esc(a.titulo)}</div>
          <div class="lista__meta">${conProfesional && a.profesionalId ? `<strong>${esc(L.nombre(a.profesionalId))}</strong> · ` : ''}${esc(a.detalle)}</div></div>${accionAlerta(a)}</li>`).join('')}</ul>
        ${grupo.length > max ? `<p class="desplegable__mas"><a href="#alertas" class="enlace">Ver las ${grupo.length} alertas ${nombre.toLowerCase()}</a></p>` : ''}
      </details>`;
    }).join('');
  };

  /** Barra apilada del semáforo de la cartera. */
  const barraSalud = (s) => {
    const total = s.rojo.length + s.ambar.length + s.verde.length;
    if (!total) return '<p class="vacio">Sin procesos activos.</p>';
    const tramo = (nivel, n, texto) => (n ? `<span class="semaforo__tramo semaforo__tramo--${nivel}" style="flex:${n}" data-tip="${texto}" data-tip-detalle="${n} proceso(s) · ${Math.round((n / total) * 100)} %" tabindex="0"></span>` : '');
    return `<div class="semaforo" role="img" aria-label="${s.rojo.length} en riesgo, ${s.ambar.length} en atención, ${s.verde.length} en plazo">
        ${tramo('rojo', s.rojo.length, 'En riesgo')}${tramo('ambar', s.ambar.length, 'Atención')}${tramo('verde', s.verde.length, 'En plazo')}</div>
      <div class="semaforo__leyenda">
        <span><i class="punto punto--rojo"></i><strong>${s.rojo.length}</strong> en riesgo</span>
        <span><i class="punto punto--ambar"></i><strong>${s.ambar.length}</strong> en atención</span>
        <span><i class="punto punto--verde"></i><strong>${s.verde.length}</strong> en plazo</span></div>`;
  };

  /** Grupo de indicadores con su título. */
  const grupoKpi = (titulo, html) => `<section class="grupo-kpi"><h2 class="grupo-kpi__titulo">${esc(titulo)}</h2><div class="rejilla rejilla--kpi">${html}</div></section>`;

  const fmtDias = (x) => (x === null ? '—' : `${L.redondear(x)} d`);
  const fmtSpi = (x) => (x === null ? '—' : L.redondear(x, 2));
  const claseSpi = (x) => (x !== null && x < 0.9 ? 'kpi--critico' : '');
  const textoSpi = 'Índice de desempeño del cronograma (SPI): tareas finalizadas ÷ tareas que, según su fecha límite, ya debían estar finalizadas. 1,00 = al día; < 0,90 = atraso.';

  /** Tabla de procesos con salud, avance real frente al planificado y tarea en curso. */
  const tablaProcesos = (procesos, { conProfesional = false } = {}) => procesos.length ? `<div class="tabla-envoltura"><table class="tabla tabla--cartera">
      <thead><tr><th>Proceso</th>${conProfesional ? '<th>Profesional</th>' : ''}<th>Salud</th><th>Avance real / plan</th><th>Tarea en curso</th><th>Próximo vencimiento</th></tr></thead>
      <tbody>${procesos.map((p) => {
        const actual = L.tareaActual(p.id);
        const prox = L.tareasDe(p.id).filter((t) => L.abierta(t) && t.fechaLimite).sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))[0];
        const real = L.avance(p.id), plan = L.avancePlan(p.id);
        return `<tr>
          <td><a href="#proceso/${esc(p.id)}" class="mono"><strong>${esc(p.codigo)}</strong></a><div>${esc(p.titulo)}</div><div class="secundario">${esc(L.nombreVia(p.via))}</div></td>
          ${conProfesional ? `<td>${esc(L.nombre(p.profesionalId))}</td>` : ''}
          <td>${L.chipSalud(L.salud(p))}</td>
          <td>${L.avanceHtml(real)}<div class="secundario">Plan: ${L.pct(plan)}${real + 0.001 < plan ? ' · <span class="texto-critico">atrasado</span>' : ''}</div></td>
          <td>${actual ? `<a href="#" data-abrir="${esc(actual.id)}">${esc(actual.nombre)}</a><div>${L.chipEstado(L.estadoTarea(actual))} ${L.chipPlazo(actual)}</div>` : '<span class="secundario">—</span>'}</td>
          <td>${prox ? `${esc(prox.nombre)}<div>${L.chipVence(prox)}</div>` : '<span class="secundario">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="vacio">Sin procesos activos.</p>';

  /** Plazos de los próximos días en toda la selección (agenda). */
  const agendaItems = (tareas, conProfesional) => `<ul class="lista">${tareas.map((t) => { const p = L.D.porProceso[t.procesoId]; return `<li>
      <div class="lista__cuerpo"><div class="lista__titulo">${esc(t.nombre)}</div>
      <div class="lista__meta"><span class="mono">${esc(p.codigo)}</span> · ${esc(p.titulo)}${conProfesional ? ` · <strong>${esc(L.nombre(p.profesionalId))}</strong>` : ''}</div></div>
      ${L.chipPlazo(t)} <a class="enlace" href="#" data-abrir="${esc(t.id)}">Abrir</a></li>`; }).join('')}</ul>`;

  function agenda(k, { conProfesional = false } = {}) {
    const hoy = L.hoy();
    const limite30 = L.isoDia(new Date(L.aFecha(hoy).getTime() + 30 * 86400000));
    const idsSinPlazo = new Set(k.sinPlazo.map((a) => a.tareaId));
    const porFecha = (a, b) => (a.fechaLimite || '').localeCompare(b.fechaLimite || '');
    const grupos = [
      ['critica', 'Vencidas', k.vencidas.slice().sort(porFecha), true],
      ['alta', `Vencen en ≤ ${L.D.config.diasAlertaPorVencer} días hábiles`, k.proximas.slice().sort(porFecha), true],
      ['media', 'Sin plazo definido', k.abiertas.filter((t) => idsSinPlazo.has(t.id)), true],
      ['info', 'Próximos 30 días', k.abiertas.filter((t) => t.fechaLimite && L.vencimiento(t).tipo === 'vigente' && t.fechaLimite <= limite30).sort(porFecha), false]
    ];
    if (grupos.every((g) => !g[2].length)) return '<p class="vacio">No hay plazos por atender. ✓</p>';
    return grupos.map(([nivel, titulo, lista, abierto]) => (lista.length ? `<details class="desplegable desplegable--${nivel}" ${abierto ? 'open' : ''}>
      <summary><span class="desplegable__titulo">${esc(titulo)}</span><span class="cuenta">${lista.length}</span></summary>${agendaItems(lista.slice(0, 12), conProfesional)}
      ${lista.length > 12 ? `<p class="desplegable__mas secundario">y ${lista.length - 12} más…</p>` : ''}</details>` : '')).join('');
  }

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

  /** Encabezado institucional del tablero con el semáforo global. */
  const cabeceraTablero = (titulo, detalle, k) => `<section class="tarjeta tablero-cab">
      <div class="tablero-cab__texto"><span class="tablero-cab__entidad">${esc(L.D.config.nombreEntidad)}</span><h2>${esc(titulo)}</h2><p>${detalle}</p></div>
      <div class="tablero-cab__salud"><span class="secundario">Salud de los procesos activos</span>${barraSalud(k.salud)}</div>
    </section>`;

  // ------------------------------------------------- panel institucional
  L.vistas.panel = {
    titulo: () => ({ admin: 'Panel institucional', gerente: 'Panel institucional', profesional: 'Mi panel', asistente: 'Mi panel' })[L.rol()],
    subtitulo: () => ({ admin: 'Tablero de control de toda la cartera', gerente: 'Tablero de control de la cartera de procesos legales', profesional: 'Mis procesos, plazos y alertas', asistente: 'Indexación de trámites y seguimiento de plazos' })[L.rol()],
    filtro: '', filtroProfesional: '',
    render(v) {
      if (L.es('profesional')) return panelProfesional(v);
      if (L.es('asistente')) return panelAsistente(v);
      return panelGerente(v);
    }
  };

  function panelGerente(v) {
    const vista = L.vistas.panel;
    const filtro = vista.filtro || '';
    const filtroProf = vista.filtroProfesional || '';
    const procs = L.D.procesos.filter((p) => (!filtro || p.categoria === filtro) && (!filtroProf || p.profesionalId === filtroProf));
    const ids = new Set(procs.map((p) => p.id));
    const k = L.indicadores(procs);
    const porCategoria = L.categorias().map((c) => ({ etiqueta: c.nombre, valor: k.activos.filter((p) => p.categoria === c.codigo).length }))
      .filter((i) => i.valor).sort((a, b) => b.valor - a.valor);
    const viasCuenta = {};
    k.activos.forEach((p) => { viasCuenta[p.via] = (viasCuenta[p.via] || 0) + 1; });
    const porVia = Object.entries(viasCuenta).map(([via, n]) => ({ etiqueta: L.nombreVia(via), valor: n, detalle: `${n} proceso(s) · ${L.nombreCategoria((L.buscarVia(via).c || {}).codigo)}` })).sort((a, b) => b.valor - a.valor).slice(0, 8);
    const filas = L.profesionales(false).filter((u) => !filtroProf || u.id === filtroProf).map((u) => ({ u, k: L.indicadores(procs.filter((p) => p.profesionalId === u.id)) }))
      .filter((f) => f.k.procesos.length || f.u.activo)
      .sort((a, b) => b.k.salud.rojo.length - a.k.salud.rojo.length || b.k.vencidas.length - a.k.vencidas.length || b.k.abiertas.length - a.k.abiertas.length);
    const maxAb = Math.max(1, ...filas.map((f) => f.k.abiertas.length));
    const alertas = L.D.alertas.filter((a) => a.nivel !== 'info' && (!a.procesoId ? !filtro && (!filtroProf || a.profesionalId === filtroProf) : ids.has(a.procesoId)));
    const porAprobar = L.D.plantillas.filter((x) => x.estado === 'pendiente').length;
    const detalle = `Corte al <strong>${L.fmtFecha(L.hoy())}</strong> · ${k.activos.length} proceso(s) activo(s) · ${filas.length} profesional(es)${filtro ? ` · categoría ${esc(L.nombreCategoria(filtro))}` : ''}`;

    v.innerHTML = `${cartaVacia()}
      <div class="barra-filtros barra-filtros--panel">
        <label>Categoría<select id="f-categoria">${L.opciones(L.categorias().map((c) => [c.codigo, c.nombre]), filtro, 'Todas las categorías')}</select></label>
        <label>Profesional<select id="f-prof">${L.opciones(L.profesionales(false).map((u) => [u.id, u.nombre]), filtroProf, 'Todos los profesionales')}</select></label>
        <span class="espacio"></span>
        <button type="button" class="btn btn--sm no-imprimir" id="btn-imprimir">Imprimir / PDF</button>
      </div>
      ${cabeceraTablero('Tablero de control de la cartera legal', detalle, k)}
      ${grupoKpi('Cartera', `
        ${L.kpi('Procesos activos', k.activos.length, `${k.nuevosMes.length} nuevo(s) este mes · ${k.suspendidos.length} suspendido(s)`)}
        ${L.kpi('En riesgo', k.salud.rojo.length, `${k.salud.ambar.length} requieren atención`, k.salud.rojo.length ? 'kpi--critico' : '', 'Procesos activos con tareas vencidas o con una antecesora finalizada sin plazo definido')}
        ${L.kpi('Finalizados en el año', k.finalizados.length, k.cicloMedio === null ? 'Sin cierres aún' : `Ciclo medio: ${L.redondear(k.cicloMedio, 0)} días`)}
        ${L.kpi('Plantillas por aprobar', porAprobar, porAprobar ? '<a href="#plantillas">Revisar ahora</a>' : 'Al día', porAprobar ? 'kpi--alerta' : '')}`)}
      ${grupoKpi('Cronograma y plazos', `
        ${L.kpi('Cumplimiento de plazos', L.pct(k.cumplimiento), `${k.cerradasConPlazo} tarea(s) cerradas con plazo · meta ≥ 90 %`, k.cumplimiento !== null && k.cumplimiento < 0.8 ? 'kpi--critico' : '', 'Tareas finalizadas en o antes de su fecha límite ÷ tareas finalizadas con fecha límite (año en curso). Meta: ≥ 90 %')}
        ${L.kpi('Desempeño del cronograma (SPI)', fmtSpi(k.spi), k.spi === null ? 'Aún sin fechas cumplidas' : k.spi >= 0.9 ? 'Al día' : 'Atraso respecto del plan', claseSpi(k.spi), textoSpi)}
        ${L.kpi('Tareas vencidas', k.vencidas.length, `${k.proximas.length} vencen en ≤ ${L.D.config.diasAlertaPorVencer} días hábiles`, k.vencidas.length ? 'kpi--critico' : '')}
        ${L.kpi('Tareas sin plazo', k.sinPlazo.length, `${k.sinPlazo.filter((a) => a.tipo === 'sucesora-sin-plazo').length} con la antecesora ya finalizada`, k.sinPlazo.length ? 'kpi--critico' : '', 'Tareas sin fecha límite cuya antecesora está en proceso o ya finalizó')}`)}
      ${grupoKpi('Gestión documental', `
        ${L.kpi('Trámites SGD indexados', k.tramites30.length, 'Últimos 30 días')}
        ${L.kpi('Oportunidad de indexación', k.oportunidadMediana === null ? '—' : `${L.redondear(k.oportunidadMediana, 0)} d`, 'Mediana ingreso SGD → indexación · meta ≤ 1 día', k.oportunidadMediana !== null && k.oportunidadMediana > 2 ? 'kpi--critico' : '', 'Días entre el ingreso del trámite al SGD y su indexación en LEGAL (mediana).')}
        ${L.kpi('Resolución media de tareas', fmtDias(k.resolucionMedia), 'Días desde que una tarea inicia hasta que concluye')}`)}

      <section class="tarjeta">
        <div class="tarjeta__cab"><div><h2>Desempeño por profesional</h2><p>Despliegue cada profesional para ver sus procesos, su salud, el avance frente al plan y la tarea en curso. Ordenado por riesgo.</p></div>
          <div class="acciones-cab no-imprimir"><button type="button" class="btn btn--sm" data-desplegar="abrir">Desplegar todo</button><button type="button" class="btn btn--sm" data-desplegar="cerrar">Contraer</button></div></div>
        ${filas.length ? `<div class="jerarquia" role="list">
          <div class="jerarquia__cab" aria-hidden="true"><span>Profesional</span><span>Salud de sus procesos</span><span class="num">Activos</span><span>Tareas abiertas</span><span class="num">Vencidas</span><span class="num">Sin plazo</span><span class="num">Cumplim.</span><span class="num">SPI</span></div>
          ${filas.map(({ u, k: x }) => `<details class="jerarquia__fila" role="listitem" data-prof="${esc(u.id)}" ${filtroProf ? 'open' : ''}>
            <summary>
              <span class="jerarquia__nombre"><span class="avatar avatar--sm" aria-hidden="true">${esc(L.iniciales(u.nombre))}</span><span><strong>${esc(u.nombre)}</strong>${u.activo ? '' : ' <span class="chip">Inactivo</span>'}<span class="secundario">${esc(u.cargo || 'Profesional')}</span></span></span>
              <span class="jerarquia__salud" data-label="Salud">${x.activos.length ? `<span class="mini-semaforo"><span class="salud salud--rojo" title="En riesgo">${x.salud.rojo.length}</span><span class="salud salud--ambar" title="Atención">${x.salud.ambar.length}</span><span class="salud salud--verde" title="En plazo">${x.salud.verde.length}</span></span>` : '<span class="secundario">—</span>'}</span>
              <span class="num" data-label="Activos">${x.activos.length}</span>
              <span data-label="Tareas abiertas">${L.avanceHtml(x.abiertas.length / maxAb, x.abiertas.length)}</span>
              <span class="num" data-label="Vencidas">${x.vencidas.length ? `<span class="chip chip--critico">${x.vencidas.length}</span>` : 0}</span>
              <span class="num" data-label="Sin plazo">${x.sinPlazo.length ? `<span class="chip chip--advertencia">${x.sinPlazo.length}</span>` : 0}</span>
              <span class="num" data-label="Cumplimiento">${L.pct(x.cumplimiento)}</span>
              <span class="num ${x.spi !== null && x.spi < 0.9 ? 'texto-critico' : ''}" data-label="SPI">${fmtSpi(x.spi)}</span>
            </summary>
            <div class="jerarquia__detalle">
              <div class="jerarquia__resumen secundario">Resolución media ${fmtDias(x.resolucionMedia)} · ${x.finalizados.length} finalizado(s) en el año · ${x.tramites30.length} trámite(s) SGD en 30 días · ${x.suspendidos.length} suspendido(s)</div>
              ${tablaProcesos(x.activos)}
            </div>
          </details>`).join('')}</div>` : '<p class="vacio">No hay profesionales registrados.</p>'}
      </section>

      <div class="rejilla rejilla--2">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Alertas por prioridad</h2><p>Críticas y altas desplegadas · ${alertas.length} en total</p></div>${alertas.length ? `<a class="btn btn--sm" href="#alertas">Ver todas</a>` : ''}</div>${alertasPorNivel(alertas, { conProfesional: true })}</section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Agenda de plazos de la cartera</h2><p>Vencidas, por vencer, sin plazo y próximos 30 días</p></div></div>${agenda(k, { conProfesional: true })}</section>
      </div>
      <div class="rejilla rejilla--3">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos activos por categoría</h2><p>Según la taxonomía normativa</p></div></div>${L.barrasH(porCategoria, { unidad: 'procesos activos' })}</section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Procesos activos por vía procedimental</h2><p>Las 8 vías con más procesos</p></div></div>${L.barrasH(porVia, { unidad: 'procesos' })}</section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Trámites SGD indexados por semana</h2><p>Últimas 8 semanas</p></div></div>${L.columnas(L.serieSemanal(k.tramites.map((t) => t.indexadoEn)))}</section>
      </div>`;
    L.$('#f-categoria', v).addEventListener('change', (ev) => { vista.filtro = ev.target.value; L.pintar(); });
    L.$('#f-prof', v).addEventListener('change', (ev) => { vista.filtroProfesional = ev.target.value; L.pintar(); });
    enlazarComunes(v);
  }

  /** Imprimir y desplegar/contraer todos los grupos. */
  function enlazarComunes(v) {
    const imp = L.$('#btn-imprimir', v);
    if (imp) imp.addEventListener('click', () => { L.$$('details', v).forEach((d) => { d.open = true; }); window.print(); });
    L.$$('[data-desplegar]', v).forEach((b) => b.addEventListener('click', () => {
      const abrir = b.dataset.desplegar === 'abrir';
      L.$$('details', b.closest('.tarjeta')).forEach((d) => { d.open = abrir; });
    }));
  }

  function panelProfesional(v) {
    const k = L.indicadores(L.D.procesos);
    const misSolicitudes = L.D.alertas.filter((a) => a.tipo === 'solicitud-plazo');
    const alertas = L.D.alertas;
    const tableroCuenta = (e) => k.abiertas.filter((t) => t.estado === e && L.habilitada(t)).length;
    const bloqueadas = k.abiertas.filter((t) => !L.habilitada(t)).length;
    const procesosOrdenados = k.activos.slice().sort((a, b) => ({ rojo: 0, ambar: 1, verde: 2 }[L.salud(a).nivel] - { rojo: 0, ambar: 1, verde: 2 }[L.salud(b).nivel]) || a.codigo.localeCompare(b.codigo));
    const detalle = `Corte al <strong>${L.fmtFecha(L.hoy())}</strong> · ${esc(L.yo().nombre)} · ${k.activos.length} proceso(s) activo(s)`;
    v.innerHTML = `${cartaVacia()}
      ${cabeceraTablero('Mi tablero de control', detalle, k)}
      ${grupoKpi('Mi cartera', `
        ${L.kpi('Procesos activos', k.activos.length, `${k.suspendidos.length} suspendido(s) · ${k.finalizados.length} finalizado(s) en el año`)}
        ${L.kpi('En riesgo', k.salud.rojo.length, `${k.salud.ambar.length} requieren atención`, k.salud.rojo.length ? 'kpi--critico' : '', 'Procesos con tareas vencidas o con una antecesora finalizada sin plazo definido')}
        ${L.kpi('Tareas abiertas', k.abiertas.length, `${bloqueadas} esperan a su antecesora`)}`)}
      ${grupoKpi('Mis plazos', `
        ${L.kpi('Tareas vencidas', k.vencidas.length, 'Requieren atención inmediata', k.vencidas.length ? 'kpi--critico' : '')}
        ${L.kpi('Por vencer', k.proximas.length, `En ≤ ${L.D.config.diasAlertaPorVencer} días hábiles`, k.proximas.length ? 'kpi--alerta' : '')}
        ${L.kpi('Tareas sin plazo', k.sinPlazo.length, `<a href="#plazos">Definir ahora</a> · ${misSolicitudes.length} solicitud(es)`, k.sinPlazo.length ? 'kpi--critico' : '')}`)}
      ${grupoKpi('Mi desempeño', `
        ${L.kpi('Cumplimiento de plazos', L.pct(k.cumplimiento), `${k.cerradasConPlazo} tarea(s) cerradas con plazo · meta ≥ 90 %`, k.cumplimiento !== null && k.cumplimiento < 0.8 ? 'kpi--critico' : '', 'Tareas finalizadas a tiempo ÷ tareas finalizadas con fecha límite (año en curso)')}
        ${L.kpi('Desempeño del cronograma (SPI)', fmtSpi(k.spi), k.spi === null ? 'Aún sin fechas cumplidas' : k.spi >= 0.9 ? 'Al día' : 'Atraso respecto del plan', claseSpi(k.spi), textoSpi)}
        ${L.kpi('Resolución media', fmtDias(k.resolucionMedia), 'Días desde que una tarea inicia hasta que concluye')}`)}

      <div class="rejilla rejilla--3-1">
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Agenda de plazos</h2><p>Lo que debe atender, por urgencia</p></div><a class="btn btn--sm" href="#tareas">Ir al tablero</a></div>${agenda(k)}</section>
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Alertas</h2><p>Lo que requiere su acción, por prioridad</p></div>${alertas.length ? '<a class="btn btn--sm" href="#alertas">Ver todas</a>' : ''}</div>${alertasPorNivel(alertas)}</section>
      </div>

      <section class="tarjeta">
        <div class="tarjeta__cab"><div><h2>Mis procesos activos</h2><p>Ordenados por riesgo. Despliegue un proceso para ver su ciclo de tareas completo.</p></div>
          <div class="acciones-cab"><span class="secundario">Tablero: ${tableroCuenta('Pendiente')} por hacer · ${tableroCuenta('En proceso')} en proceso · ${tableroCuenta('En revisión')} en revisión</span><button type="button" class="btn btn--sm" data-desplegar="abrir">Desplegar todo</button><button type="button" class="btn btn--sm" data-desplegar="cerrar">Contraer</button></div></div>
        ${procesosOrdenados.length ? procesosOrdenados.map((p) => {
          const s = L.salud(p);
          const actual = L.tareaActual(p.id);
          const tareas = L.tareasDe(p.id);
          const real = L.avance(p.id), plan = L.avancePlan(p.id);
          return `<details class="desplegable desplegable--proceso">
            <summary>
              <span class="proceso-resumen">
                <span class="proceso-resumen__id"><span class="mono"><strong>${esc(p.codigo)}</strong></span> ${L.chipSalud(s)}</span>
                <span class="proceso-resumen__titulo">${esc(p.titulo)}<span class="secundario">${esc(L.nombreVia(p.via))}${s.motivos.length ? ` · ${esc(s.motivos.join(' · '))}` : ''}</span></span>
                <span class="proceso-resumen__avance">${L.avanceHtml(real)}<span class="secundario">Plan ${L.pct(plan)}</span></span>
                <span class="proceso-resumen__actual">${actual ? `${esc(actual.nombre)}<span>${L.chipPlazo(actual)}</span>` : '<span class="secundario">Sin tarea en curso</span>'}</span>
              </span>
            </summary>
            <div class="desplegable__cuerpo">
              <ol class="ciclo">${tareas.map((t) => `<li class="ciclo__paso ciclo__paso--${L.slug(L.estadoTarea(t))}">
                <span class="ciclo__n">${t.orden}</span>
                <span class="ciclo__nombre"><a href="#" data-abrir="${esc(t.id)}">${esc(t.nombre)}</a>${t.referencia ? `<span class="secundario">${esc(t.referencia)}</span>` : ''}</span>
                <span>${L.chipEstado(L.estadoTarea(t))}</span><span>${L.chipPlazo(t)}</span></li>`).join('')}</ol>
              <p class="secundario"><a href="#proceso/${esc(p.id)}">Ver el proceso completo</a> · ${L.tramitesDe(p.id).length} documento(s) SGD · inicio ${L.fmtFecha(p.fechaInicio)}</p>
            </div></details>`;
        }).join('') : '<p class="vacio">Sin procesos activos.</p>'}
      </section>`;
    enlazarComunes(v);
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
    const alertas = L.D.alertas.filter((a) => L.esAlertaPlazo(a) || ['solicitud-plazo', 'tarea-vencida', 'tarea-por-vencer'].includes(a.tipo));
    v.innerHTML = `${cartaVacia()}
      <div class="rejilla rejilla--kpi">
        ${L.kpi('Indexados hoy', mios.filter((t) => dias(t) === 0).length, `${mios.filter((t) => dias(t) <= 6).length} en los últimos 7 días`)}
        ${L.kpi('Indexados en 30 días', mios.filter((t) => dias(t) <= 30).length, `${L.D.tramites.filter((t) => dias(t) <= 30).length} en toda la gerencia`)}
        ${L.kpi('Procesos creados este mes', misProcesos.length, `${new Set(L.D.plantillas.filter((x) => (x.tareasAprobadas || []).length).map((x) => x.via)).size} vía(s) con plantilla aprobada`)}
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
      const tipos = { 'tarea-vencida': 'Tarea vencida', 'tarea-por-vencer': 'Tarea por vencer', 'sucesora-sin-plazo': 'Antecesora finalizada sin plazo', 'plazo-no-definido': 'Plazo no definido', 'solicitud-plazo': 'Solicitud de plazo', 'sin-movimiento': 'Proceso sin movimiento', 'retroceso-tarea': 'Retroceso de tarea', 'plantilla-por-aprobar': 'Plantilla por aprobar', 'plantilla-observada': 'Plantilla observada', 'listo-para-finalizar': 'Proceso sin tareas abiertas', 'tramite-nuevo': 'Nuevo documento SGD', 'carga-critica': 'Carga crítica' };
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
            <td><select class="accion-alerta" data-proceso="${esc(a.procesoId || '')}" data-tarea="${esc(a.tareaId || '')}" data-notificacion="${esc(a.notificacionId || '')}" aria-label="Acciones">
              ${L.opciones([
                ...(a.procesoId ? [['ver', 'Ver el proceso']] : []),
                ...(a.tareaId ? [['tarea', 'Abrir la tarea']] : []),
                ...(a.notificacionId ? [['visto', 'Marcar como visto']] : []),
                ...(a.tipo.startsWith('plantilla') ? [['plantillas', a.tipo === 'plantilla-por-aprobar' ? 'Revisar la plantilla' : 'Corregir la plantilla']] : []),
                ...(L.esAlertaPlazo(a) && puedeSolicitar && !pendiente.has(a.tareaId) ? [['solicitar', 'Solicitar definición de plazo']] : []),
                ...((L.esAlertaPlazo(a) || a.tipo === 'solicitud-plazo') && L.es('profesional', 'admin') ? [['plazos', 'Definir el plazo']] : [])
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
        if (accion === 'plantillas') location.hash = '#plantillas';
        if (accion === 'tarea') L.abrirTarea(s.dataset.tarea);
        if (accion === 'visto') L.marcarVisto(s.dataset.notificacion);
        if (accion === 'solicitar') L.solicitarPlazo(s.dataset.tarea);
      });
    }
  };

  L.marcarVisto = async function (id) {
    try { await L.api('POST', `/api/notificaciones/${id}/vista`, {}); L.notificar('Aviso marcado como visto.'); await L.refrescar(); } catch (e) { L.error(e); }
  };

  L.solicitarPlazo = function (tareaId) {
    const t = L.D.porTarea[tareaId];
    const p = L.D.porProceso[t.procesoId];
    const ant = L.D.porTarea[t.antecesoraId];
    const c = L.modal(`${L.cabModal('Solicitar definición de plazo', `${esc(p.codigo)} · ${esc(L.nombre(p.profesionalId))}`)}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-sol">
        <div class="contexto"><dl class="datos">
          <dt>Proceso</dt><dd>${esc(p.codigo)} · ${esc(p.titulo)}</dd>
          <dt>Tarea</dt><dd><strong>${esc(t.nombre)}</strong> ${L.chipEstado(L.estadoTarea(t))}</dd>
          <dt>Antecesora</dt><dd>${ant ? `${esc(ant.nombre)} ${L.chipEstado(L.estadoTarea(ant))}${ant.fechaFin ? ` · finalizó el ${L.fmtFecha(ant.fechaFin)}` : ''}` : '—'}</dd>
          <dt>Profesional</dt><dd>${esc(L.nombre(p.profesionalId))}</dd></dl></div>
        <label>Mensaje para el profesional<textarea name="mensaje" rows="4" placeholder="Ej.: Llegó la resolución que fija la audiencia para el 12 de noviembre."></textarea>${L.ayuda('Opcional. El profesional verá la solicitud en sus alertas; se cierra sola cuando define el plazo.')}</label>
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Enviar solicitud</button></div>
      </form>`, { medio: true });
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
