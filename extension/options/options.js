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
    form.usuarioLegal.value = c.usuarioLegal;
    await resumen();
  }

  async function resumen() {
    const cat = await A.obtenerCatalogo();
    const tramites = await A.obtenerTramites();
    const nuevos = await A.obtener(A.CLAVES.PROCESOS_NUEVOS, []);
    $('origen-catalogo').textContent = `Catálogo ${cat.origen === 'importado' ? 'importado' : 'referencial (datos de ejemplo)'}: ${cat.categorias.length} categorías, ${cat.responsables.length} responsables, ${cat.procesos.length} procesos.`;
    $('resumen-datos').textContent = `${tramites.length} trámite(s) indexado(s) y ${nuevos.length} proceso(s) generado(s) desde el conector. Los datos permanecen solo en este navegador.`;
  }

  function normalizarPrefijo(url) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocolo');
    return u.href;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    let urls;
    try {
      urls = lineas(form.urlsSgd.value).map(normalizarPrefijo);
    } catch (e) {
      mensaje('error', 'Revise las direcciones del SGD: deben iniciar con https:// o http://');
      return;
    }
    const selectores = lineas(form.selectoresSesion.value);
    const invalidos = selectores.filter((s) => { try { document.createDocumentFragment().querySelector(s); return /\s|>|~|\+/.test(s.replace(/\[[^\]]*\]/g, '')); } catch (e) { return true; } });
    if (invalidos.length) {
      mensaje('error', `Selectores no válidos o con combinadores: ${invalidos.join(' | ')}`);
      return;
    }

    // Solicitud de permiso de lectura sobre el dominio del SGD (gesto del usuario).
    const origenes = [...new Set(urls.map((u) => `${new URL(u).origin}/*`))];
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
      usuarioLegal: form.usuarioLegal.value.trim()
    });
    mensaje(concedido ? 'exito' : 'alerta', concedido
      ? 'Configuración guardada. Recargue la pestaña del SGD para aplicar la habilitación del conector.'
      : 'Configuración guardada. No se concedió el permiso de dominio: el conector leerá solo el marco principal de la página.');
  });

  $('archivo-catalogo').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    try {
      const datos = JSON.parse(await archivo.text());
      const cat = datos.catalogo || datos;
      if (!Array.isArray(cat.categorias) || !Array.isArray(cat.responsables) || !Array.isArray(cat.procesos)) throw new Error('estructura');
      await A.guardar(A.CLAVES.CATALOGO, { categorias: cat.categorias, responsables: cat.responsables, procesos: cat.procesos });
      mensaje('exito', `Catálogo importado: ${cat.procesos.length} procesos.`);
      resumen();
    } catch (e) {
      mensaje('error', 'El archivo no tiene el formato esperado { categorias, responsables, procesos }.');
    }
    ev.target.value = '';
  });

  $('btn-catalogo-ref').addEventListener('click', async () => {
    await new Promise((r) => chrome.storage.local.remove(A.CLAVES.CATALOGO, r));
    mensaje('info', 'Se restableció el catálogo referencial.');
    resumen();
  });

  $('btn-exportar').addEventListener('click', async () => {
    const paquete = await A.construirExportacion();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(paquete, null, 2)], { type: 'application/json' }));
    a.download = `legal-sgd-intercambio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  $('btn-limpiar').addEventListener('click', async () => {
    if (!confirm('¿Eliminar los trámites indexados y procesos generados en este navegador? No afecta al SGD.')) return;
    await new Promise((r) => chrome.storage.local.remove([A.CLAVES.TRAMITES, A.CLAVES.PROCESOS_NUEVOS], r));
    mensaje('info', 'Registros locales eliminados.');
    resumen();
  });

  cargar();
})();
