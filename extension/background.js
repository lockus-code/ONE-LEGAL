/*
 * LEGAL · Conector SGD — Service worker.
 *
 * Regla de negocio N.° 1: la extensión se habilita únicamente cuando existe una
 * sesión activa en el SGD. El ícono permanece deshabilitado en cualquier otra
 * página; Chrome lo habilita mediante reglas declarativas (sin leer la página
 * desde aquí) cuando la URL corresponde al SGD y se observa un indicador de
 * sesión. Al abrir la extensión, la sesión se verifica nuevamente.
 */
importScripts('shared/entorno.js', 'shared/almacen.js');

async function actualizarReglasDeActivacion() {
  const config = await LegalAlmacen.obtenerConfiguracion();
  const condiciones = [];
  for (const url of config.urlsSgd) {
    if (config.modoActivacion === 'dominio') {
      condiciones.push(new chrome.declarativeContent.PageStateMatcher({ pageUrl: { urlPrefix: url } }));
      continue;
    }
    for (const selector of config.selectoresSesion) {
      condiciones.push(new chrome.declarativeContent.PageStateMatcher({ pageUrl: { urlPrefix: url }, css: [selector] }));
    }
  }

  await chrome.action.disable();
  await new Promise((r) => chrome.declarativeContent.onPageChanged.removeRules(undefined, r));
  if (condiciones.length === 0) return;
  await new Promise((r) =>
    chrome.declarativeContent.onPageChanged.addRules(
      [{ conditions: condiciones, actions: [new chrome.declarativeContent.ShowAction()] }],
      r
    )
  );
}

chrome.runtime.onInstalled.addListener(async (detalle) => {
  await actualizarReglasDeActivacion();
  const config = await LegalAlmacen.obtenerConfiguracion();
  // Sin SGD configurado, se abre Configuración (el entorno de prueba ya viene preconfigurado).
  if (config.urlsSgd.length === 0) chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(actualizarReglasDeActivacion);

// El ícono abre el panel lateral (solo está habilitado cuando hay sesión activa en el SGD).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.storage.onChanged.addListener((cambios, area) => {
  if (area === 'local' && cambios[LegalAlmacen.CLAVES.CONFIG]) actualizarReglasDeActivacion();
});
