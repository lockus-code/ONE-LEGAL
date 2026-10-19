/*
 * SGD simulado con la estructura del SGD de SEDAPAR (ver docs/11-reconocimiento-sgd.md).
 * Todos los datos son ficticios. Las rutas imitan el enrutador de Angular:
 *   /sgd-simulado/pages/login · /tramites/mistramites · /tramites/detalletramite/{ID_INTERNO} · /pages/login/exit
 */
window.SGD_BASE = '/sgd-simulado';
window.SGD_TRAMITES = [
  { id: 250101, numero: '2026 - 01234 - 3', fecha: '10/10/2026 09:14:22', remitente: 'ÁREA DE LOGÍSTICA', derivado: 'GERENCIA DE ASESORÍA JURÍDICA', asunto: 'SOLICITA OPINIÓN LEGAL SOBRE AMPLIACIÓN DE PLAZO DEL CONTRATO DE OBRA N° 012-2025', estado: 'DERIVADO', tipo: 'INFORME', asociados: [] },
  { id: 250102, numero: '2026 - 00871 - 12', fecha: '11/10/2026 11:02:05', remitente: 'MESA DE PARTES', derivado: 'GERENCIA DE ASESORÍA JURÍDICA', asunto: 'NOTIFICACIÓN JUDICIAL - DEMANDA CONTENCIOSO ADMINISTRATIVA', estado: 'DERIVADO', tipo: 'CÉDULA', asociados: ['2026 - 00871 - 11', '2026 - 00871 - 10'] },
  { id: 250103, numero: '2025 - 04410 - 1', fecha: '18/12/2025 16:40:51', remitente: 'GERENCIA COMERCIAL', derivado: 'GERENCIA DE ASESORÍA JURÍDICA', asunto: 'RECURSO DE APELACIÓN CONTRA RESOLUCIÓN DE GERENCIA COMERCIAL', estado: 'EN PROCESO', tipo: 'RECURSO', asociados: [] },
  { id: 250104, numero: '2026 - 01301 - 1', fecha: '12/10/2026 08:30:00', remitente: 'ÓRGANO DE CONTROL INSTITUCIONAL', derivado: 'GERENCIA DE ASESORÍA JURÍDICA', asunto: 'TRÁMITE RESERVADO', estado: 'DERIVADO', tipo: 'OFICIO', asociados: [], confidencial: true },
  { id: 250105, numero: '2026 - 01322 - 2', fecha: '13/10/2026 15:21:47', remitente: 'GERENCIA DE OPERACIONES', derivado: 'GERENCIA DE ASESORÍA JURÍDICA', asunto: 'Difusión y cumplimiento de recomendaciones del Informe 037-2026/S-33000-WMG', estado: 'DERIVADO', tipo: 'MEMORANDO', asociados: [] }
];
window.SGD_SESION = {
  obtener() { try { return JSON.parse(sessionStorage.getItem('sgd.sesion')); } catch (e) { return null; } },
  iniciar(usuario) { sessionStorage.setItem('sgd.sesion', JSON.stringify({ usuario: usuario.toUpperCase() })); },
  cerrar() { sessionStorage.removeItem('sgd.sesion'); },
  exigir() { const s = this.obtener(); if (!s) location.replace(SGD_BASE + '/pages/login'); return s; }
};
/** Pinta el diseño autenticado (app-layout + sidebar-cmp) y devuelve el contenedor principal. */
window.SGD_LAYOUT = function (sesion, componente) {
  const raiz = document.querySelector('app-root');
  raiz.innerHTML =
    '<app-layout><div class="wrapper">' +
      '<div class="sidebar" data-color="azure"><sidebar-cmp>' +
        '<div class="logo">SGD · Simulado</div>' +
        '<div class="usuario-sesion">' + sesion.usuario + '</div>' +
        '<ul class="nav"><li><a href="' + SGD_BASE + '/tramites/mistramites">Mis Trámites</a></li>' +
        '<li><a href="' + SGD_BASE + '/tramites/mistramites">Seg. de Trámites</a></li>' +
        '<li><a href="' + SGD_BASE + '/pages/login/exit">Salir</a></li></ul>' +
      '</sidebar-cmp></div>' +
      '<div class="main-panel"><' + componente + '></' + componente + '></div>' +
    '</div></app-layout>';
  return raiz.querySelector(componente);
};
