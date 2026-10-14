/*
 * LEGAL · Conector SGD — Ventana emergente.
 * Flujo: verificar sesión SGD → leer trámite (solo lectura) → elegir vinculación
 * (proceso existente no finalizado o nuevo proceso) → registrar localmente.
 */
(function () {
  const A = window.LegalAlmacen;
  const $ = (sel) => document.querySelector(sel);
  const form = $('#form-registro');
  const campo = (nombre) => form.elements[nombre];

  const CAMPOS_TRAMITE = ['nroExpediente', 'nroRegistro', 'tipoDocumento', 'nroDocumento', 'asunto', 'remitente', 'dependencia', 'fechaDocumento', 'estadoSgd'];
  const ESTADO_FINALIZADO = window.LEGAL_CATALOGO.ESTADOS_PROCESO.FINALIZADO;

  const estado = { config: null, catalogo: null, tab: null, lectura: null, urlDepurada: '', servidor: null };
  const S = window.LegalServidor;

  // ---------------------------------------------------------------- utilidades
  const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nombreResponsable = (codigo) => (estado.catalogo.responsables.find((r) => r.codigo === codigo) || {}).nombre || codigo;
  const formatoFecha = (iso) => new Date(iso).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

  function mostrarEstado(tipo, titulo, detalle, conBotonConfig) {
    const caja = $('#estado');
    caja.className = `estado estado--${tipo}`;
    $('#estado-titulo').textContent = titulo;
    $('#estado-detalle').textContent = detalle || '';
    $('#btn-configurar').classList.toggle('oculto', !conBotonConfig);
  }

  function mostrarMensaje(tipo, texto) {
    const m = $('#mensaje');
    m.className = `aviso aviso--${tipo}`;
    m.textContent = texto;
  }

  /** Elimina identificadores de sesión del enlace para que sea un enlace estable. */
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
    const valores = { nroExpediente: campo('nroExpediente').value.trim(), nroRegistro: campo('nroRegistro').value.trim(), url: estado.urlDepurada };
    if (plantilla) {
      const faltantes = (plantilla.match(/\{(\w+)\}/g) || []).map((v) => v.slice(1, -1)).filter((v) => !valores[v]);
      if (faltantes.length === 0) {
        return { enlace: plantilla.replace(/\{(\w+)\}/g, (_, v) => encodeURIComponent(valores[v])), origen: 'Enlace generado con la plantilla institucional configurada.' };
      }
    }
    return { enlace: estado.urlDepurada, origen: 'Dirección de la página actual del SGD (se retiraron identificadores de sesión).' };
  }

  function refrescarEnlace(forzar) {
    const input = campo('enlaceSgd');
    if (!forzar && input.dataset.editado === '1') return;
    const { enlace, origen } = construirEnlace();
    input.value = enlace;
    $('#origen-enlace').textContent = origen;
  }

  // ------------------------------------------------------- 1. sesión y lectura
  async function leerPestana(tabId) {
    const args = [{ selectoresSesion: estado.config.selectoresSesion, textosSesion: estado.config.textosSesion }];
    let resultados;
    try {
      resultados = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: leerPaginaSgd, args });
    } catch (e) {
      // Sin permiso sobre marcos de otro origen: se lee solo el marco principal.
      resultados = await chrome.scripting.executeScript({ target: { tabId }, func: leerPaginaSgd, args });
    }
    const marcos = resultados.map((r) => r.result).filter(Boolean);
    const principal = marcos.find((m) => m.esPrincipal) || marcos[0];
    const datos = {};
    const fuentes = {};
    // El marco principal tiene prioridad; los marcos internos completan lo faltante.
    [principal, ...marcos.filter((m) => m !== principal)].forEach((m) => {
      Object.entries(m.datos).forEach(([k, v]) => { if (!datos[k]) { datos[k] = v; fuentes[k] = m.fuentes[k]; } });
    });
    return {
      principal,
      datos,
      fuentes,
      indicadorSesion: (marcos.find((m) => m.sesion.indicador) || {}).sesion?.indicador || null,
      usuarioSgd: (marcos.find((m) => m.sesion.usuarioSgd) || {}).sesion?.usuarioSgd || '',
      formularioIngreso: principal.sesion.formularioIngreso,
      seleccion: (marcos.find((m) => m.seleccion) || {}).seleccion || ''
    };
  }

  async function verificarSesion() {
    estado.config = await A.obtenerConfiguracion();
    if (estado.config.urlsSgd.length === 0) {
      mostrarEstado('advertencia', 'Configuración pendiente', 'Registre la dirección del SGD institucional para habilitar el conector.', true);
      return false;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    estado.tab = tab;
    const url = tab && tab.url ? tab.url : '';
    if (!estado.config.urlsSgd.some((base) => url.startsWith(base))) {
      mostrarEstado('inactiva', 'La pestaña activa no corresponde al SGD', 'Abra el Sistema de Gestión Documental en esta pestaña e inicie sesión.', true);
      return false;
    }
    try {
      estado.lectura = await leerPestana(tab.id);
    } catch (e) {
      mostrarEstado('inactiva', 'No fue posible leer la página del SGD', e.message);
      return false;
    }
    const l = estado.lectura;
    if (!l.indicadorSesion || l.formularioIngreso) {
      mostrarEstado('inactiva', 'Sin sesión activa en el SGD', 'Inicie sesión en el SGD y vuelva a abrir el conector. Por regla institucional, la captura solo procede con sesión vigente.', true);
      return false;
    }
    mostrarEstado('activa', 'Sesión SGD activa', l.usuarioSgd ? `Usuario SGD: ${l.usuarioSgd}` : `Indicador detectado: ${l.indicadorSesion}`);
    return true;
  }

  function volcarLectura() {
    const { datos, fuentes, seleccion, principal } = estado.lectura;
    CAMPOS_TRAMITE.forEach((k) => {
      const input = campo(k);
      input.value = datos[k] || '';
      input.classList.toggle('leido', Boolean(datos[k]));
      input.title = datos[k] ? `Leído automáticamente (${fuentes[k]})` : 'No identificado: puede completarlo manualmente';
    });
    const n = CAMPOS_TRAMITE.filter((k) => datos[k]).length;
    $('#resumen-lectura').textContent = `Lectura automática: ${n} de ${CAMPOS_TRAMITE.length} datos identificados. Verifique y complete antes de registrar.`;
    $('#seleccion').classList.toggle('oculto', !seleccion);
    estado.urlDepurada = depurarUrl(principal.url, estado.config.parametrosSensibles);
    campo('enlaceSgd').dataset.editado = '';
    refrescarEnlace(true);
  }

  // ------------------------------------------------- 2. vinculación a proceso
  function llenarSelect(select, opciones, textoTodos) {
    const previo = select.value;
    select.innerHTML = '';
    if (textoTodos) select.add(new Option(textoTodos, ''));
    opciones.forEach(([valor, texto]) => select.add(new Option(texto, valor)));
    if ([...select.options].some((o) => o.value === previo)) select.value = previo;
  }

  function modoActual() { return form.elements.modo.value; }

  function refrescarFiltros() {
    const nuevo = modoActual() === 'nuevo';
    const cat = estado.catalogo;
    llenarSelect(campo('categoria'), cat.categorias.map((c) => [c.nombre, c.nombre]), nuevo ? 'Seleccione categoría…' : 'Todas las categorías');
    const categoria = cat.categorias.find((c) => c.nombre === campo('categoria').value);
    const procs = categoria ? categoria.procedimientos : cat.categorias.flatMap((c) => c.procedimientos);
    llenarSelect(campo('procedimiento'), procs.map((p) => [p, p]), nuevo ? 'Seleccione procedimiento…' : 'Todos los procedimientos');
    llenarSelect(campo('responsable'), cat.responsables.map((r) => [r.codigo, r.nombre]), nuevo ? 'Seleccione responsable…' : 'Todos los responsables');
  }

  function procesosFiltrados() {
    const f = { categoria: campo('categoria').value, procedimiento: campo('procedimiento').value, responsable: campo('responsable').value, texto: normal(campo('busqueda').value.trim()) };
    return estado.catalogo.procesos.filter((p) =>
      p.estado !== ESTADO_FINALIZADO &&
      (!f.categoria || p.categoria === f.categoria) &&
      (!f.procedimiento || p.procedimiento === f.procedimiento) &&
      (!f.responsable || p.responsable === f.responsable) &&
      (!f.texto || normal(`${p.codigo} ${p.denominacion}`).includes(f.texto))
    );
  }

  function pintarProcesos() {
    const lista = $('#lista-procesos');
    const seleccionado = (form.querySelector('input[name=proceso]:checked') || {}).value;
    const procesos = procesosFiltrados();
    const finalizados = estado.catalogo.procesos.filter((p) => p.estado === ESTADO_FINALIZADO).length;
    $('#resumen-busqueda').textContent = `${procesos.length} proceso(s) en curso. Se excluyen ${finalizados} proceso(s) finalizado(s), que no admiten nuevas incorporaciones.`;
    if (procesos.length === 0) {
      lista.innerHTML = '<li class="vacio">No hay procesos en curso con los criterios indicados.</li>';
      return;
    }
    lista.innerHTML = procesos.map((p) => `
      <li><label>
        <input type="radio" name="proceso" value="${escapar(p.codigo)}" ${p.codigo === seleccionado ? 'checked' : ''}>
        <div>
          <div class="proc__codigo">${escapar(p.codigo)} <span class="etiqueta-estado" data-estado="${escapar(p.estado)}">${escapar(p.estado)}</span></div>
          <div>${escapar(p.denominacion)}</div>
          <div class="proc__meta">${escapar(p.procedimiento)} · ${escapar(nombreResponsable(p.responsable))}</div>
        </div>
      </label></li>`).join('');
  }

  function cambiarModo() {
    const nuevo = modoActual() === 'nuevo';
    $('#modo-anexo').classList.toggle('oculto', nuevo);
    $('#modo-nuevo').classList.toggle('oculto', !nuevo);
    refrescarFiltros();
    if (nuevo) {
      $('#codigo-nuevo').textContent = A.siguienteCodigoProceso(estado.catalogo.procesos);
      if (!campo('denominacion').value) campo('denominacion').value = campo('asunto').value.slice(0, 160);
    } else {
      pintarProcesos();
    }
  }

  // ------------------------------------------------------------ 3. registro
  function validar() {
    form.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
    const errores = [];
    const exigir = (nombre, texto) => { if (!campo(nombre).value.trim()) { campo(nombre).classList.add('invalido'); errores.push(texto); } };

    if (!campo('nroExpediente').value.trim() && !campo('nroRegistro').value.trim()) {
      campo('nroExpediente').classList.add('invalido');
      campo('nroRegistro').classList.add('invalido');
      errores.push('N.° de expediente o de registro');
    }
    exigir('asunto', 'asunto del documento');
    exigir('enlaceSgd', 'enlace directo');
    if (modoActual() === 'nuevo') {
      exigir('categoria', 'categoría');
      exigir('procedimiento', 'procedimiento');
      exigir('responsable', 'responsable');
      exigir('denominacion', 'denominación del proceso');
    } else if (!form.querySelector('input[name=proceso]:checked')) {
      errores.push('proceso al que se anexa');
    }
    exigir('asuntoVinculacion', 'descripción de la actuación');
    return errores;
  }

  async function registrar(ev) {
    ev.preventDefault();
    const errores = validar();
    if (errores.length) {
      mostrarMensaje('error', `Complete los datos obligatorios: ${errores.join(', ')}.`);
      return;
    }

    let proceso;
    if (modoActual() === 'nuevo') {
      proceso = {
        codigo: A.siguienteCodigoProceso(estado.catalogo.procesos),
        denominacion: campo('denominacion').value.trim(),
        categoria: campo('categoria').value,
        procedimiento: campo('procedimiento').value,
        responsable: campo('responsable').value,
        estado: window.LEGAL_CATALOGO.ESTADOS_PROCESO.REGISTRADO,
        fechaInicio: new Date().toISOString().slice(0, 10),
        origen: 'Conector SGD'
      };
    } else {
      const codigo = form.querySelector('input[name=proceso]:checked').value;
      proceso = estado.catalogo.procesos.find((p) => p.codigo === codigo);
      if (!proceso || proceso.estado === ESTADO_FINALIZADO) {
        mostrarMensaje('error', 'El proceso seleccionado está finalizado y no admite nuevas incorporaciones.');
        return;
      }
    }

    const datosTramite = Object.fromEntries(CAMPOS_TRAMITE.map((k) => [k, campo(k).value.trim()]));
    const existentes = await A.obtenerTramites();
    const duplicado = existentes.find((t) =>
      t.vinculacion.procesoCodigo === proceso.codigo &&
      ((datosTramite.nroExpediente && t.nroExpediente === datosTramite.nroExpediente) ||
       (datosTramite.nroRegistro && t.nroRegistro === datosTramite.nroRegistro)) &&
      t.nroDocumento === datosTramite.nroDocumento
    );
    if (duplicado && !form.dataset.confirmarDuplicado) {
      form.dataset.confirmarDuplicado = '1';
      mostrarMensaje('alerta', `Este trámite ya fue indexado en ${proceso.codigo} el ${formatoFecha(duplicado.fechaCaptura)}. Presione nuevamente "Registrar vinculación" para confirmar.`);
      return;
    }

    let tramite = {
      id: `TSGD-${Date.now().toString(36).toUpperCase()}`,
      ...datosTramite,
      enlaceSgd: campo('enlaceSgd').value.trim(),
      tituloPagina: estado.lectura.principal.titulo,
      vinculacion: {
        modo: modoActual(),
        procesoCodigo: proceso.codigo,
        procesoDenominacion: proceso.denominacion,
        categoria: proceso.categoria,
        procedimiento: proceso.procedimiento,
        responsable: proceso.responsable
      },
      asuntoVinculacion: campo('asuntoVinculacion').value.trim(),
      usuarioSgd: estado.lectura.usuarioSgd || null,
      usuarioLegal: estado.config.usuarioLegal || null,
      fechaCaptura: new Date().toISOString()
    };
    if (estado.servidor && estado.servidor.conectado) {
      const boton = $('#btn-registrar');
      boton.disabled = true;
      try {
        const r = await S.registrarVinculacion(estado.config, { tramite, procesoNuevo: modoActual() === 'nuevo' ? proceso : null });
        tramite = r.tramite;
        proceso = r.proceso;
      } catch (e) {
        mostrarMensaje('error', `El servidor LEGAL no registró la vinculación: ${e.name === 'AbortError' ? 'no respondió a tiempo' : e.message}`);
        return;
      } finally {
        boton.disabled = false;
      }
    } else if (modoActual() === 'nuevo') {
      await A.registrarProceso(proceso);
    }
    await A.registrarTramite(tramite);

    delete form.dataset.confirmarDuplicado;
    await cargarCatalogo();
    campo('asuntoVinculacion').value = '';
    campo('denominacion').value = '';
    cambiarModo();
    await pintarIndexados();
    mostrarMensaje('exito', tramite.vinculacion.modo === 'nuevo'
      ? `Se generó el proceso ${proceso.codigo} y se indexó el trámite${estado.servidor && estado.servidor.conectado ? ' en la base de datos LEGAL' : ''}.`
      : `Trámite indexado en el proceso ${proceso.codigo}${estado.servidor && estado.servidor.conectado ? ' (registrado en la base de datos LEGAL)' : ''}.`);
  }

  // --------------------------------------------------------- servidor LEGAL
  /** Catálogo desde el servidor LEGAL si está configurado y responde; si no, el local. */
  async function cargarCatalogo() {
    if (S.configurado(estado.config)) {
      try {
        const c = await S.catalogo(estado.config);
        estado.servidor = { conectado: true, nombre: c.servidor || 'Servidor LEGAL' };
        estado.catalogo = { categorias: c.categorias, responsables: c.responsables, procesos: c.procesos, origen: 'servidor' };
        pintarConexion();
        return;
      } catch (e) {
        estado.servidor = { conectado: false, error: e.name === 'AbortError' ? 'el servidor no respondió' : e.message };
      }
    }
    estado.catalogo = await A.obtenerCatalogo();
    pintarConexion();
  }

  function pintarConexion() {
    const caja = $('#conexion');
    const s = estado.servidor;
    if (!s) { caja.classList.add('oculto'); return; }
    caja.classList.remove('oculto');
    caja.className = `conexion conexion--${s.conectado ? 'ok' : 'error'}`;
    caja.textContent = s.conectado
      ? `Conectado a ${s.nombre}: las vinculaciones se registran en su base de datos.`
      : `Servidor LEGAL sin conexión (${s.error}). Modo local: los registros quedan en este navegador.`;
  }

  // ------------------------------------------------------ trámites indexados
  async function pintarIndexados() {
    const todos = await A.obtenerTramites();
    $('#contador-indexados').textContent = todos.length;
    const f = normal($('#filtro-indexados').value.trim());
    const lista = todos.filter((t) => !f || normal(`${t.nroExpediente} ${t.nroRegistro} ${t.asunto} ${t.vinculacion.procesoCodigo} ${t.vinculacion.procesoDenominacion}`).includes(f));
    const ul = $('#lista-indexados');
    if (lista.length === 0) {
      ul.innerHTML = `<li class="vacio">${todos.length ? 'Sin coincidencias.' : 'Aún no se han indexado trámites del SGD.'}</li>`;
      return;
    }
    ul.innerHTML = lista.map((t) => `
      <li>
        <div class="ix__cab"><span class="ix__exp">${escapar(t.nroExpediente || t.nroRegistro)}</span><span>${escapar(formatoFecha(t.fechaCaptura))}</span></div>
        <div class="ix__asunto">${escapar(t.asunto)}</div>
        <div class="ix__vinc">${t.vinculacion.modo === 'nuevo' ? 'Generó' : 'Anexado a'} <strong>${escapar(t.vinculacion.procesoCodigo)}</strong> · ${escapar(t.vinculacion.procesoDenominacion)}</div>
        <div class="ix__vinc">${escapar(t.asuntoVinculacion)}</div>
        <div class="ix__acciones">
          <a href="${escapar(t.enlaceSgd)}" target="_blank" rel="noopener">Abrir en el SGD</a>
          <button type="button" class="enlace" data-copiar="${escapar(t.enlaceSgd)}">Copiar enlace</button>
          <button type="button" class="enlace" data-quitar="${escapar(t.id)}">Quitar del índice</button>
        </div>
      </li>`).join('');
  }

  async function exportar() {
    const paquete = await A.construirExportacion();
    const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `legal-sgd-intercambio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ eventos
  function enlazarEventos() {
    $('#btn-configurar').addEventListener('click', () => chrome.runtime.openOptionsPage());
    document.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.pestana').forEach((x) => { x.classList.toggle('activa', x === b); x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('oculto', p.dataset.panel !== b.dataset.pestana));
    }));
    form.addEventListener('submit', registrar);
    form.querySelectorAll('input[name=modo]').forEach((r) => r.addEventListener('change', cambiarModo));
    campo('categoria').addEventListener('change', () => { refrescarFiltros(); if (modoActual() === 'anexo') pintarProcesos(); });
    ['procedimiento', 'responsable'].forEach((n) => campo(n).addEventListener('change', () => { if (modoActual() === 'anexo') pintarProcesos(); }));
    campo('busqueda').addEventListener('input', pintarProcesos);
    ['nroExpediente', 'nroRegistro'].forEach((n) => campo(n).addEventListener('input', () => refrescarEnlace(false)));
    campo('enlaceSgd').addEventListener('input', () => { campo('enlaceSgd').dataset.editado = '1'; });
    form.addEventListener('input', () => { delete form.dataset.confirmarDuplicado; });
    $('#btn-usar-seleccion').addEventListener('click', () => { campo('asunto').value = estado.lectura.seleccion; });
    $('#btn-releer').addEventListener('click', async () => {
      try { estado.lectura = await leerPestana(estado.tab.id); volcarLectura(); mostrarMensaje('info', 'Página leída nuevamente.'); }
      catch (e) { mostrarMensaje('error', `No fue posible leer la página: ${e.message}`); }
    });
    $('#filtro-indexados').addEventListener('input', pintarIndexados);
    $('#btn-exportar').addEventListener('click', exportar);
    $('#lista-indexados').addEventListener('click', async (ev) => {
      const copiar = ev.target.dataset.copiar;
      const quitar = ev.target.dataset.quitar;
      if (copiar) { await navigator.clipboard.writeText(copiar); ev.target.textContent = 'Enlace copiado'; }
      if (quitar && confirm('¿Quitar este trámite del índice local? Esta acción no afecta al SGD.')) { await A.eliminarTramite(quitar); pintarIndexados(); }
    });
  }

  async function iniciar() {
    enlazarEventos();
    if (!(await verificarSesion())) return;
    await cargarCatalogo();
    $('#principal').classList.remove('oculto');
    volcarLectura();
    cambiarModo();
    pintarIndexados();
  }

  iniciar();
})();
