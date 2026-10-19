/* LEGAL · Conector SGD — Página de configuración. */
(function () {
  const A = window.LegalAlmacen;
  const form = document.getElementById('form-config');
  const $ = (id) => document.getElementById(id);
  const lineas = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);

  function mensaje(tipo, texto) {
    const m = $('mensaje');
    m.className = `aviso aviso--${tipo}`;
    m.textContent = texto;
  }

  async function cargar() {
    const c = await A.obtenerConfiguracion();
    form.urlsSgd.value = c.urlsSgd.join('\n');
    form.modoActivacion.value = c.modoActivacion;
    form.selectoresSesion.value = c.selectoresSesion.join('\n');
    form.textosSesion.value = c.textosSesion.join('\n');
    form.plantillaEnlace.value = c.plantillaEnlace;
    form.parametrosSensibles.value = c.parametrosSensibles.join(', ');
    form.servidorLegal.value = c.servidorLegal;
    $('estado-sesion').textContent = c.usuario ? `Sesión abierta como ${c.usuario.nombre} (${c.usuario.usuario}).` : 'Sin sesión: ingrese desde el panel lateral.';
  }

  function normalizarPrefijo(url) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocolo');
    return u.href;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let urls;
    let servidor = form.servidorLegal.value.trim().replace(/\/+$/, '');
    try {
      urls = lineas(form.urlsSgd.value).map(normalizarPrefijo);
      if (servidor) servidor = normalizarPrefijo(servidor).replace(/\/+$/, '');
    } catch (e) {
      mensaje('error', 'Revise las direcciones: deben iniciar con https:// o http://');
      return;
    }
    const selectores = lineas(form.selectoresSesion.value);
    const invalidos = selectores.filter((s) => { try { document.createDocumentFragment().querySelector(s); return /\s|>|~|\+/.test(s.replace(/\[[^\]]*\]/g, '')); } catch (e) { return true; } });
    if (invalidos.length) {
      mensaje('error', `Selectores no válidos o con combinadores: ${invalidos.join(' | ')}`);
      return;
    }
    // Permiso de lectura sobre el SGD y de conexión con el servidor LEGAL (requiere el gesto del usuario).
    const origenes = [...new Set([...urls, ...(servidor ? [servidor + '/'] : [])].map((u) => `${new URL(u).protocol}//${new URL(u).hostname}/*`))];
    let concedido = true;
    if (origenes.length) {
      try { concedido = await chrome.permissions.request({ origins: origenes }); } catch (e) { concedido = false; }
    }
    await A.guardar(A.CLAVES.CONFIG, {
      urlsSgd: urls,
      modoActivacion: form.modoActivacion.value,
      selectoresSesion: selectores,
      textosSesion: lineas(form.textosSesion.value),
      plantillaEnlace: form.plantillaEnlace.value.trim(),
      parametrosSensibles: form.parametrosSensibles.value.split(',').map((s) => s.trim()).filter(Boolean),
      servidorLegal: servidor
    });
    mensaje(concedido ? 'exito' : 'alerta', concedido
      ? 'Configuración guardada. Recargue la pestaña del SGD para aplicarla.'
      : 'Configuración guardada, pero Chrome no concedió el permiso: el conector no podrá leer el SGD o conectarse al servidor.');
    cargar();
  });

  $('btn-probar-servidor').addEventListener('click', async () => {
    const salida = $('estado-servidor');
    const config = { servidorLegal: form.servidorLegal.value.trim() };
    if (!config.servidorLegal) { salida.textContent = 'Indique la dirección del servidor.'; return; }
    salida.textContent = 'Probando…';
    try {
      const e = await LegalServidor.estado(config);
      salida.textContent = `Conectado: ${e.nombre} ${e.version} · ${e.bd.procesos} proceso(s), ${e.bd.tramites} trámite(s) indexados.`;
    } catch (err) {
      salida.textContent = `Sin conexión: ${err.message}`;
    }
  });

  cargar();
})();
