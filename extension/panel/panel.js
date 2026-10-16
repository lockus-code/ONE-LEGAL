/*
 * LEGAL · Conector SGD — Panel lateral de Chrome.
 * Flujo: ingresar a LEGAL → verificar sesión SGD → leer el trámite (solo lectura)
 * → elegir la acción en desplegables (proceso nuevo o existente) → indexar en la
 * base de datos del servidor LEGAL (se ve de inmediato en el portal).
 * El panel sigue a la pestaña activa: al cambiar de trámite o de pestaña se vuelve a leer.
 */
(function () {
  const A = window.LegalAlmacen;
  const S = window.LegalServidor;
  const $ = (sel) => document.querySelector(sel);
  const form = $('#form-registro');
  const campo = (nombre) => form.elements[nombre];

  const CAMPOS_TRAMITE = ['nroTramite', 'idInterno', 'asuntoSgd', 'fechaIngresoSgd', 'tipoDocumento', 'nroDocumento', 'remitente', 'dependencia'];
  const estado = { config: null, catalogo: null, lectura: null, urlDepurada: '', perfil: 'generico', claveTramite: null, preferencias: null, tareasProceso: {} };
  const RE_TRAMITE_SEDAPAR = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;
  const normalizarTramite = (t) => { const m = String(t || '').match(RE_TRAMITE_SEDAPAR); return m ? `${m[1]}-${m[2].padStart(5, '0')}-${parseInt(m[3], 10)}` : null; };
  const MOTIVOS = {
    NO_NODE: 'no apareció el n.º de trámite en 10 segundos',
    AMBIGUOUS: 'la página muestra números distintos y no se puede decidir cuál es'
  };

  // ---------------------------------------------------------------- utilidades
  const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const formatoFecha = (iso) => new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

  function perfilPara(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'sgd.sedapar.com.pe' || u.pathname.startsWith('/sgd-simulado/')) return 'sedapar';
    } catch (e) { /* URL no válida */ }
    return 'generico';
  }

  function mostrarEstado(tipo, titulo, detalle, conBotonConfig) {
    const caja = $('#estado');
    caja.classList.remove('oculto');
    caja.className = `estado estado--${tipo}`;
    $('#estado-titulo').textContent = titulo;
    $('#estado-detalle').textContent = detalle || '';
    $('#btn-configurar').classList.toggle('oculto', !conBotonConfig);
  }

  function mostrarMensaje(tipo, html) {
    const m = $('#mensaje');
    m.className = `aviso aviso--${tipo}`;
    m.innerHTML = html;
  }

  function depurarUrl(url, sensibles) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/;jsessionid=[^/?#]*/i, '');
      const lista = sensibles.map((s) => s.toLowerCase());
      [...u.searchParams.keys()].forEach((k) => { if (lista.includes(k.toLowerCase())) u.searchParams.delete(k); });
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function construirEnlace() {
    const plantilla = (estado.config.plantillaEnlace || '').trim();
    const valores = { nroTramite: campo('nroTramite').value.trim(), idInterno: campo('idInterno').value.trim(), url: estado.urlDepurada };
    if (plantilla) {
      const faltantes = (plantilla.match(/\{(\w+)\}/g) || []).map((v) => v.slice(1, -1)).filter((v) => !valores[v]);
      if (faltantes.length === 0) return { enlace: plantilla.replace(/\{(\w+)\}/g, (_, v) => encodeURIComponent(valores[v])), origen: 'Enlace generado con la plantilla configurada.' };
    }
    return { enlace: estado.urlDepurada, origen: 'Dirección de la página del SGD (sin identificadores de sesión).' };
  }

  // -------------------------------------------------- 0. sesión en el servidor LEGAL
  function mostrarIngreso(mensaje) {
    $('#form-ingreso').classList.remove('oculto');
    $('#principal').classList.add('oculto');
    $('#estado').classList.add('oculto');
    $('#menu-cuenta').classList.add('oculto');
    $('#cabecera-usuario').textContent = 'Indexación de trámites del SGD';
    $('#ingreso-servidor').textContent = S.configurado(estado.config)
      ? `Servidor LEGAL: ${estado.config.servidorLegal}`
      : 'Falta la dirección del servidor LEGAL: indíquela en Configuración.';
    const m = $('#ingreso-mensaje');
    m.classList.toggle('oculto', !mensaje);
    m.className = `aviso aviso--error${mensaje ? '' : ' oculto'}`;
    m.textContent = mensaje || '';
  }

  async function ingresar(ev) {
    ev.preventDefault();
    const f = ev.target;
    if (!S.configurado(estado.config)) { chrome.runtime.openOptionsPage(); return; }
    try {
      const r = await S.ingresar(estado.config, f.usuario.value.trim(), f.clave.value);
      await A.guardarSesion(estado.config.servidorLegal, r.token, r.usuario);
      f.clave.value = '';
      $('#form-ingreso').classList.add('oculto');
      actualizar(true);
    } catch (e) {
      mostrarIngreso(e.estado === 401 ? 'Usuario o contraseña incorrectos.' : `No se pudo ingresar: ${e.message}.`);
    }
  }

  function pintarConexion(error) {
    const caja = $('#conexion');
    if (!error) {
      caja.className = 'conexion conexion--ok';
      caja.textContent = `Conectado a ${estado.catalogo.servidor}. Lo que indexe se ve en el portal.`;
      return;
    }
    caja.className = 'conexion conexion--error';
    caja.textContent = `Sin conexión con el servidor LEGAL (${error}). No se puede indexar hasta recuperar la conexión.`;
  }

  /** Carga el catálogo del servidor; devuelve false si hay que ingresar o no hay conexión. */
  async function cargarCatalogo() {
    if (!S.configurado(estado.config)) {
      mostrarEstado('advertencia', 'Configuración pendiente', 'Indique la dirección del servidor LEGAL de la intranet.', true);
      return false;
    }
    if (!estado.config.token) { mostrarIngreso(); return false; }
    try {
      estado.catalogo = await S.catalogo(estado.config);
      const u = estado.catalogo.usuario;
      $('#cabecera-usuario').textContent = `${u.nombre} · ${({ admin: 'Administrador', gerente: 'Gerente', profesional: 'Profesional', asistente: 'Asistente administrativo' })[u.rol] || u.rol}`;
      $('#menu-cuenta').classList.remove('oculto');
      pintarConexion();
      return true;
    } catch (e) {
      if (e.estado === 401) {
        await A.cerrarSesion();
        estado.config.token = '';
        mostrarIngreso('La sesión expiró. Vuelva a ingresar.');
      } else {
        pintarConexion(e.message);
        mostrarEstado('inactiva', 'Servidor LEGAL no disponible', `Verifique que LEGAL esté en ejecución en ${estado.config.servidorLegal} y que este equipo esté en la intranet.`, true);
      }
      return false;
    }
  }

  // ------------------------------------------------------- 1. sesión SGD y lectura
  async function leerPestana(tabId, url) {
    if (perfilPara(url) === 'sedapar') {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: leerPaginaSedapar, args: [{ topeMs: 10000 }] });
      const l = r.result;
      const datos = {};
      if (l.numero) datos.nroTramite = l.numero;
      if (l.idInterno) datos.idInterno = l.idInterno;
      if (l.asunto) datos.asuntoSgd = l.asunto;
      if (l.fechaIngreso) datos.fechaIngresoSgd = l.fechaIngreso;
      return { url: l.url, datos, indicadorSesion: l.sesion.indicador, formularioIngreso: l.sesion.formularioIngreso, sedapar: l };
    }
    const args = [{ selectoresSesion: estado.config.selectoresSesion, textosSesion: estado.config.textosSesion }];
    let resultados;
    try {
      resultados = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: leerPaginaSgd, args });
    } catch (e) {
      resultados = await chrome.scripting.executeScript({ target: { tabId }, func: leerPaginaSgd, args });
    }
    const marcos = resultados.map((r) => r.result).filter(Boolean);
    const principal = marcos.find((m) => m.esPrincipal) || marcos[0];
    const leidos = {};
    [principal, ...marcos.filter((m) => m !== principal)].forEach((m) => {
      Object.entries(m.datos).forEach(([k, v]) => { if (!leidos[k]) leidos[k] = v; });
    });
    // Correspondencia del lector genérico con los campos de LEGAL.
    const datos = {
      nroTramite: leidos.nroExpediente || leidos.nroRegistro, idInterno: leidos.nroExpediente ? leidos.nroRegistro : '',
      asuntoSgd: leidos.asunto, fechaIngresoSgd: leidos.fechaDocumento, tipoDocumento: leidos.tipoDocumento,
      nroDocumento: leidos.nroDocumento, remitente: leidos.remitente, dependencia: leidos.dependencia
    };
    return {
      url: principal.url,
      datos,
      indicadorSesion: (marcos.find((m) => m.sesion.indicador) || {}).sesion?.indicador || null,
      formularioIngreso: principal.sesion.formularioIngreso
    };
  }

  async function verificarSesionSgd() {
    if (estado.config.urlsSgd.length === 0) {
      mostrarEstado('advertencia', 'Configuración pendiente', 'Registre la dirección del SGD institucional.', true);
      return false;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tab && tab.url ? tab.url : '';
    if (!estado.config.urlsSgd.some((base) => url.startsWith(base))) {
      mostrarEstado('inactiva', 'La pestaña activa no es el SGD', 'Abra el SGD e inicie sesión. El panel se actualiza solo al cambiar de pestaña.', true);
      return false;
    }
    estado.perfil = perfilPara(url);
    document.body.dataset.perfil = estado.perfil;
    mostrarEstado('verificando', 'Leyendo la página del SGD…', estado.perfil === 'sedapar' ? 'Esperando a que el SGD termine de cargar el trámite (hasta 10 s).' : '');
    try {
      estado.lectura = await leerPestana(tab.id, url);
    } catch (e) {
      mostrarEstado('inactiva', 'No fue posible leer la página del SGD', `${e.message} Recargue la pestaña del SGD.`);
      return false;
    }
    const l = estado.lectura;
    if (!l.indicadorSesion || l.formularioIngreso) {
      mostrarEstado('inactiva', 'Sin sesión activa en el SGD', 'Inicie sesión en el SGD: la indexación solo procede con sesión vigente.');
      return false;
    }
    if (l.sedapar) {
      if (!l.sedapar.esDetalle) {
        mostrarEstado('activa', 'Sesión SGD activa', 'Abra el detalle de un trámite («Ingresar al Trámite») para indexarlo.');
        return false;
      }
      if (l.sedapar.confidencial) {
        mostrarEstado('advertencia', 'Trámite con indicador de confidencialidad', 'Por precaución no se lee ni se registra ningún dato de este trámite.');
        return false;
      }
    }
    mostrarEstado('activa', 'Sesión SGD activa', l.sedapar ? `Trámite ${l.sedapar.numero || 'sin número detectado'} · ID interno ${l.sedapar.idInterno}` : `Indicador detectado: ${l.indicadorSesion}`);
    return true;
  }

  function volcarLectura() {
    const { datos } = estado.lectura;
    CAMPOS_TRAMITE.forEach((k) => {
      const input = campo(k);
      input.value = datos[k] || '';
      input.classList.toggle('leido', Boolean(datos[k]));
      input.title = datos[k] ? 'Leído del SGD (puede corregirlo)' : 'No identificado: complételo manualmente';
    });
    const sp = estado.lectura.sedapar;
    campo('idInterno').readOnly = Boolean(sp);
    if (sp) {
      campo('nroTramite').readOnly = Boolean(sp.numero);
      $('#resumen-lectura').textContent = sp.numero
        ? `Leído del SGD en ${(sp.msDeteccion / 1000).toFixed(1)} s: n.º de trámite${sp.asunto ? ', asunto' : ''}${sp.fechaIngreso ? ' y fecha de ingreso' : ''}.${sp.asunto ? '' : ' No se encontró el asunto: escríbalo.'}`
        : `Registro manual: ${MOTIVOS[sp.motivo] || 'no se pudo leer el n.º de trámite'}. Escriba el número (AAAA - ##### - S).`;
    } else {
      const n = CAMPOS_TRAMITE.filter((k) => datos[k]).length;
      $('#resumen-lectura').textContent = `Lectura automática: ${n} dato(s) identificados. Verifique y complete antes de indexar.`;
    }
    estado.urlDepurada = depurarUrl(estado.lectura.url, estado.config.parametrosSensibles);
    const { enlace, origen } = construirEnlace();
    campo('enlaceSgd').value = enlace;
    $('#origen-enlace').textContent = origen;
  }

  // ------------------------------------------------ 2. acción mediante desplegables
  const cat = () => estado.catalogo;
  const categorias = () => cat().taxonomia.categorias;
  const viasActivas = (c) => (c.vias || []).filter((v) => !v.desactivada);
  const buscarVia = (codigo) => { for (const c of categorias()) { const v = (c.vias || []).find((x) => x.codigo === codigo); if (v) return { c, v }; } return {}; };
  const profesional = (id) => cat().profesionales.find((p) => p.id === id);
  const nombreProfesional = (id) => (profesional(id) || {}).nombre || 'Sin profesional activo';
  const plantillaDe = (profId, via) => ((profesional(profId) || {}).plantillas || []).find((p) => p.via === via);

  function llenar(select, opciones, vacio) {
    const previo = select.value;
    select.innerHTML = '';
    if (vacio) select.add(new Option(vacio, ''));
    opciones.forEach((o) => {
      if (o.grupo) {
        const g = document.createElement('optgroup');
        g.label = o.grupo;
        o.opciones.forEach(([v, t]) => g.appendChild(new Option(t, v)));
        if (o.opciones.length) select.appendChild(g);
      } else {
        select.add(new Option(o[1], o[0]));
      }
    });
    if ([...select.options].some((x) => x.value === previo)) select.value = previo;
  }

  function pintarAccion() {
    const accion = campo('accion').value;
    $('#bloque-nuevo').classList.toggle('oculto', accion !== 'nuevo');
    $('#bloque-existente').classList.toggle('oculto', accion !== 'existente');
    $('#btn-registrar').disabled = !accion;
    if (accion === 'nuevo') pintarNuevo();
    if (accion === 'existente') pintarExistente();
  }

  // -- proceso nuevo: Profesional → Vía, o Categoría → Vía → Profesional
  function pintarNuevo() {
    const criterio = campo('criterioNuevo').value;
    document.querySelectorAll('#cascada-nuevo > label').forEach((l) => {
      l.style.order = l.dataset[criterio === 'profesional' ? 'ordenProfesional' : 'ordenCategoria'];
      if (l.dataset.soloCriterio) l.classList.toggle('oculto', l.dataset.soloCriterio !== criterio);
    });
    const profs = cat().profesionales;
    if (criterio === 'profesional') {
      llenar(campo('profesionalNuevo'), profs.map((p) => [p.id, `${p.nombre}${p.plantillas.length ? ` · ${p.plantillas.length} plantilla(s)` : ''}`]), 'Seleccione el profesional…');
      const prof = profesional(campo('profesionalNuevo').value);
      const conPlantilla = prof ? new Set(prof.plantillas.map((p) => p.via)) : new Set();
      // Las vías se agrupan por categoría (jerarquía normativa); primero las que tienen plantilla del profesional.
      const grupos = [];
      if (prof && prof.plantillas.length) {
        grupos.push({ grupo: 'Con plantilla del profesional', opciones: prof.plantillas.map((p) => { const { c, v } = buscarVia(p.via); return [p.via, `${c ? c.nombre : ''} › ${v ? v.nombre : p.via}`]; }) });
      }
      categorias().forEach((c) => grupos.push({ grupo: c.nombre, opciones: viasActivas(c).filter((v) => !conPlantilla.has(v.codigo)).map((v) => [v.codigo, v.nombre]) }));
      llenar(campo('viaNuevo'), prof ? grupos : [], prof ? 'Seleccione la vía procedimental…' : 'Primero elija el profesional');
    } else {
      llenar(campo('categoriaNuevo'), categorias().map((c) => [c.codigo, c.nombre]), 'Seleccione la categoría…');
      const c = categorias().find((x) => x.codigo === campo('categoriaNuevo').value);
      llenar(campo('viaNuevo'), c ? viasActivas(c).map((v) => [v.codigo, v.nombre]) : [], c ? 'Seleccione la vía procedimental…' : 'Primero elija la categoría');
      const via = campo('viaNuevo').value;
      const ordenados = [...profs].sort((a, b) => Number(Boolean(plantillaDe(b.id, via))) - Number(Boolean(plantillaDe(a.id, via))));
      llenar(campo('profesionalNuevo'), via ? ordenados.map((p) => [p.id, `${p.nombre} · ${plantillaDe(p.id, via) ? '✓ con plantilla' : 'ciclo base'}`]) : [], via ? 'Seleccione el profesional…' : 'Primero elija la vía');
    }
    if (!profs.length) llenar(campo('profesionalNuevo'), [], 'No hay profesionales activos (créelos en el portal)');
    pintarResumenCiclo();
  }

  function pintarResumenCiclo() {
    const via = campo('viaNuevo').value;
    const profId = campo('profesionalNuevo').value;
    const caja = $('#resumen-ciclo');
    if (!via || !profId) { caja.textContent = ''; return; }
    const pl = plantillaDe(profId, via);
    const { v } = buscarVia(via);
    caja.innerHTML = pl
      ? `Se generará el ciclo con la plantilla <strong>${escapar(pl.nombre)}</strong> (${pl.tareas} tareas) de ${escapar(nombreProfesional(profId))}.`
      : `${escapar(nombreProfesional(profId))} no tiene plantilla para esta vía: se usarán las <strong>${v ? v.etapas.length : 0} etapas normativas base</strong> y se le avisará para revisarlas.`;
  }

  // -- proceso existente: Profesional → procesos (agrupados por categoría › vía), o Categoría → Vía → procesos
  function pintarExistente() {
    const criterio = campo('criterioExistente').value;
    document.querySelectorAll('#bloque-existente [data-criterio]').forEach((l) => l.classList.toggle('oculto', l.dataset.criterio !== criterio));
    const procesos = cat().procesos;
    const conProcesos = new Set(procesos.map((p) => p.profesionalId));
    llenar(campo('profesionalExistente'), cat().profesionales.filter((p) => conProcesos.has(p.id)).map((p) => [p.id, `${p.nombre} (${procesos.filter((x) => x.profesionalId === p.id).length})`]), 'Todos los profesionales');
    llenar(campo('categoriaExistente'), categorias().filter((c) => procesos.some((p) => p.categoria === c.codigo)).map((c) => [c.codigo, c.nombre]), 'Todas las categorías');
    const c = categorias().find((x) => x.codigo === campo('categoriaExistente').value);
    llenar(campo('viaExistente'), c ? viasActivas(c).filter((v) => procesos.some((p) => p.via === v.codigo)).map((v) => [v.codigo, v.nombre]) : [], 'Todas las vías');

    const texto = normal(campo('busqueda').value.trim());
    const filtrados = procesos.filter((p) =>
      (criterio !== 'profesional' || !campo('profesionalExistente').value || p.profesionalId === campo('profesionalExistente').value) &&
      (criterio !== 'categoria' || ((!campo('categoriaExistente').value || p.categoria === campo('categoriaExistente').value) && (!campo('viaExistente').value || p.via === campo('viaExistente').value))) &&
      (!texto || normal(`${p.codigo} ${p.titulo}`).includes(texto)));
    // Agrupación jerárquica: Categoría › Vía.
    const grupos = new Map();
    filtrados.forEach((p) => {
      const { c: cc, v } = buscarVia(p.via);
      const g = `${cc ? cc.nombre : p.categoria} › ${v ? v.nombre : p.via}`;
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push([p.id, `${p.codigo} · ${p.titulo}${criterio === 'categoria' ? ` — ${nombreProfesional(p.profesionalId)}` : ''}${p.estado !== 'Activo' ? ` (${p.estado})` : ''}`]);
    });
    llenar(campo('proceso'), [...grupos.entries()].sort().map(([grupo, opciones]) => ({ grupo, opciones })), filtrados.length ? 'Seleccione el proceso…' : 'Sin procesos en curso con estos criterios');
    $('#resumen-busqueda').textContent = `${filtrados.length} proceso(s) en curso. Los procesos finalizados no se muestran porque no admiten documentos.`;
    pintarTareas();
  }

  async function pintarTareas() {
    const id = campo('proceso').value;
    const select = campo('tarea');
    if (!id) { llenar(select, [], 'Primero elija el proceso'); return; }
    if (!estado.tareasProceso[id]) {
      llenar(select, [], 'Cargando tareas…');
      try { estado.tareasProceso[id] = (await S.proceso(estado.config, id)).tareas; } catch (e) { estado.tareasProceso[id] = []; }
      if (campo('proceso').value !== id) return;
    }
    const tareas = estado.tareasProceso[id];
    const abiertas = tareas.filter((t) => t.estado !== 'Finalizada');
    llenar(select, [
      { grupo: 'Tareas abiertas', opciones: abiertas.map((t) => [t.id, `${t.orden}. ${t.nombre} · ${t.estado}${t.fechaLimite ? ` · vence ${t.fechaLimite}` : ' · sin plazo'}`]) },
      { grupo: 'Concluidas', opciones: tareas.filter((t) => t.estado === 'Finalizada').map((t) => [t.id, `${t.orden}. ${t.nombre}`]) }
    ], 'Sin tarea relacionada');
  }

  // ------------------------------------------------------------ 3. indexación
  function validar() {
    form.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
    const errores = [];
    const exigir = (nombre, texto) => { if (!campo(nombre).value.trim()) { campo(nombre).classList.add('invalido'); errores.push(texto); } };
    if (!campo('nroTramite').value.trim() && !campo('idInterno').value.trim()) { campo('nroTramite').classList.add('invalido'); errores.push('n.º de trámite'); }
    if (estado.perfil === 'sedapar' && campo('nroTramite').value.trim()) {
      const canon = normalizarTramite(campo('nroTramite').value);
      if (!canon) { campo('nroTramite').classList.add('invalido'); errores.push('n.º de trámite con formato AAAA - ##### - S'); } else campo('nroTramite').value = canon;
    }
    exigir('asuntoSgd', 'asunto del trámite');
    exigir('enlaceSgd', 'enlace al SGD');
    const accion = campo('accion').value;
    if (!accion) { campo('accion').classList.add('invalido'); errores.push('acción'); }
    if (accion === 'nuevo') { exigir('viaNuevo', 'vía procedimental'); exigir('profesionalNuevo', 'profesional'); }
    if (accion === 'existente') exigir('proceso', 'proceso');
    return errores;
  }

  async function registrar(ev, confirmarDuplicado) {
    if (ev) ev.preventDefault();
    const errores = validar();
    if (errores.length) { mostrarMensaje('error', `Complete: ${escapar(errores.join(', '))}.`); return; }
    const accion = campo('accion').value;
    const tramite = Object.fromEntries(CAMPOS_TRAMITE.map((k) => [k, campo(k).value.trim()]));
    tramite.enlaceSgd = campo('enlaceSgd').value.trim();
    const datos = { accion, tramite, detalle: campo('detalle').value.trim(), confirmarDuplicado: Boolean(confirmarDuplicado) };
    if (accion === 'nuevo') {
      const { c } = buscarVia(campo('viaNuevo').value);
      datos.proceso = { titulo: campo('titulo').value.trim() || tramite.asuntoSgd, categoria: c ? c.codigo : '', via: campo('viaNuevo').value, profesionalId: campo('profesionalNuevo').value };
    } else {
      datos.procesoId = campo('proceso').value;
      datos.tareaId = campo('tarea').value;
    }
    const boton = $('#btn-registrar');
    boton.disabled = true;
    try {
      const r = await S.indexar(estado.config, datos);
      const p = r.proceso;
      mostrarMensaje('exito', `${accion === 'nuevo' ? `Se creó el proceso <strong>${escapar(p.codigo)}</strong> con ${r.tareasGeneradas} tarea(s)` : `Trámite anexado a <strong>${escapar(p.codigo)}</strong>`} y quedó registrado en la base de datos LEGAL. <a href="${escapar(r.urlProceso)}" target="_blank" rel="noopener">Ver en el portal</a>`);
      campo('detalle').value = '';
      campo('titulo').value = '';
      estado.tareasProceso = {};
      await cargarCatalogo();
      pintarAccion();
      consultarRegistro();
      pintarIndexados();
    } catch (e) {
      if (e.estado === 409 && e.cuerpo && e.cuerpo.duplicado) {
        mostrarMensaje('alerta', `${escapar(e.message)} <button type="button" class="enlace" id="btn-confirmar-duplicado">Registrar de todos modos</button>`);
        $('#btn-confirmar-duplicado').addEventListener('click', () => registrar(null, true));
      } else if (e.estado === 401) {
        await A.cerrarSesion();
        estado.config.token = '';
        mostrarIngreso('La sesión expiró. Vuelva a ingresar.');
      } else {
        mostrarMensaje('error', `LEGAL no registró la indexación: ${escapar(e.message)}`);
      }
    } finally {
      boton.disabled = false;
    }
  }

  async function consultarRegistro() {
    const caja = $('#aviso-tramite');
    caja.classList.add('oculto');
    const numero = campo('nroTramite').value.trim();
    const interno = campo('idInterno').value.trim();
    if (!numero && !interno) return;
    let vinculos = [];
    try { vinculos = (await S.consultarTramite(estado.config, normalizarTramite(numero) || numero, interno)).vinculaciones; } catch (e) { return; }
    if (!vinculos.length) return;
    caja.className = 'aviso aviso--alerta';
    caja.innerHTML = `<span>Este trámite ya está indexado en ${vinculos.map((v) => `<strong>${escapar(v.codigo)}</strong>`).join(', ')}. Puede anexarlo a otro proceso si corresponde.</span>`;
  }

  // ------------------------------------------------------ mis indexaciones
  let indexaciones = [];
  async function pintarIndexados(recargar = true) {
    if (recargar) {
      try { indexaciones = (await S.misIndexaciones(estado.config)).indexaciones; } catch (e) { indexaciones = []; }
    }
    $('#contador-indexados').textContent = indexaciones.length;
    const f = normal($('#filtro-indexados').value.trim());
    const lista = indexaciones.filter(({ tramite: t, proceso: p }) => !f || normal(`${t.nroTramite} ${t.asuntoSgd} ${t.detalle} ${p.codigo} ${p.titulo}`).includes(f));
    const ul = $('#lista-indexados');
    if (!lista.length) { ul.innerHTML = `<li class="vacio">${indexaciones.length ? 'Sin coincidencias.' : 'Aún no ha indexado trámites.'}</li>`; return; }
    ul.innerHTML = lista.map(({ tramite: t, proceso: p }) => `
      <li>
        <div class="ix__cab"><span class="ix__exp">${escapar(t.nroTramite)}</span><span>${escapar(formatoFecha(t.indexadoEn))}</span></div>
        <div class="ix__asunto">${escapar(t.asuntoSgd)}</div>
        ${t.detalle ? `<div class="ix__vinc">${escapar(t.detalle)}</div>` : ''}
        <div class="ix__vinc">${t.accion === 'nuevo' ? 'Creó' : 'Anexado a'} <strong>${escapar(p.codigo)}</strong> · ${escapar(p.titulo)}</div>
        <select class="ix__acciones" data-id="${escapar(t.id)}" aria-label="Acciones sobre ${escapar(t.nroTramite)}">
          <option value="">Acciones…</option>
          <option value="sgd">Abrir el trámite en el SGD</option>
          <option value="portal">Ver el proceso en el portal</option>
          <option value="copiar">Copiar enlace al SGD</option>
          <option value="quitar">Quitar esta indexación</option>
        </select>
      </li>`).join('');
  }

  async function accionIndexado(ev) {
    const sel = ev.target;
    if (!sel.matches('.ix__acciones') || !sel.value) return;
    const item = indexaciones.find((x) => x.tramite.id === sel.dataset.id);
    const accion = sel.value;
    sel.value = '';
    if (!item) return;
    if (accion === 'sgd') chrome.tabs.create({ url: item.tramite.enlaceSgd });
    if (accion === 'portal') chrome.tabs.create({ url: `${S.urlPortal(estado.config)}#proceso/${item.proceso.id}` });
    if (accion === 'copiar') { await navigator.clipboard.writeText(item.tramite.enlaceSgd); sel.options[0].textContent = 'Enlace copiado ✓'; }
    if (accion === 'quitar' && confirm(`¿Quitar la indexación de ${item.tramite.nroTramite} en ${item.proceso.codigo}? No afecta al SGD.`)) {
      try { await S.quitarIndexacion(estado.config, item.tramite.id); pintarIndexados(); } catch (e) { alert(e.message); }
    }
  }

  // ------------------------------------------------------------------ eventos
  function enlazarEventos() {
    $('#form-ingreso').addEventListener('submit', ingresar);
    $('#btn-configurar').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('#accion-cuenta').addEventListener('change', async (ev) => {
      const v = ev.target.value;
      ev.target.value = '';
      if (v === 'portal') chrome.tabs.create({ url: S.urlPortal(estado.config) });
      if (v === 'config') chrome.runtime.openOptionsPage();
      if (v === 'salir') { try { await S.salir(estado.config); } catch (e) { /* sin conexión */ } await A.cerrarSesion(); estado.config.token = ''; mostrarIngreso(); }
    });
    document.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.pestana').forEach((x) => { x.classList.toggle('activa', x === b); x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('oculto', p.dataset.panel !== b.dataset.pestana));
    }));
    form.addEventListener('submit', registrar);
    campo('accion').addEventListener('change', pintarAccion);
    ['criterioNuevo', 'criterioExistente'].forEach((n) => campo(n).addEventListener('change', () => {
      estado.preferencias[n] = campo(n).value;
      A.guardarPreferencias(estado.preferencias);
      pintarAccion();
    }));
    ['profesionalNuevo', 'categoriaNuevo', 'viaNuevo'].forEach((n) => campo(n).addEventListener('change', pintarNuevo));
    ['profesionalExistente', 'categoriaExistente', 'viaExistente'].forEach((n) => campo(n).addEventListener('change', pintarExistente));
    campo('busqueda').addEventListener('input', pintarExistente);
    campo('proceso').addEventListener('change', pintarTareas);
    $('#btn-reverificar').addEventListener('click', () => actualizar(true));
    $('#filtro-indexados').addEventListener('input', () => pintarIndexados(false));
    $('#lista-indexados').addEventListener('change', accionIndexado);
  }

  // ------------------------------------------- seguimiento de la pestaña activa
  let ejecucion = 0;
  async function actualizar(forzar) {
    const mia = ++ejecucion;
    estado.config = await A.obtenerConfiguracion();
    estado.preferencias = estado.preferencias || await A.preferencias();
    campo('criterioNuevo').value = estado.preferencias.criterioNuevo || 'profesional';
    campo('criterioExistente').value = estado.preferencias.criterioExistente || 'profesional';
    const okServidor = await cargarCatalogo();
    if (mia !== ejecucion) return;
    if (!okServidor) { $('#principal').classList.add('oculto'); estado.claveTramite = null; return; }
    $('#form-ingreso').classList.add('oculto');
    const ok = await verificarSesionSgd();
    if (mia !== ejecucion) return;
    if (!ok) { $('#principal').classList.add('oculto'); estado.claveTramite = null; return; }
    const clave = `${estado.lectura.url}|${estado.lectura.datos.nroTramite || ''}`;
    $('#principal').classList.remove('oculto');
    if (forzar || clave !== estado.claveTramite) {
      if (clave !== estado.claveTramite) {
        campo('detalle').value = '';
        campo('titulo').value = '';
        $('#mensaje').className = 'aviso oculto';
      }
      estado.claveTramite = clave;
      volcarLectura();
      pintarAccion();
      consultarRegistro();
    }
    pintarIndexados();
  }

  let temporizador = null;
  const programar = () => { clearTimeout(temporizador); temporizador = setTimeout(() => actualizar(false), 350); };
  chrome.tabs.onActivated.addListener(programar);
  chrome.tabs.onUpdated.addListener((tabId, cambio, tab) => { if (tab.active && (cambio.url || cambio.status === 'complete')) programar(); });
  chrome.windows.onFocusChanged.addListener((id) => { if (id !== chrome.windows.WINDOW_ID_NONE) programar(); });
  chrome.storage.onChanged.addListener((cambios, area) => { if (area === 'local' && cambios[A.CLAVES.CONFIG]) actualizar(true); });

  enlazarEventos();
  actualizar(true);
})();
