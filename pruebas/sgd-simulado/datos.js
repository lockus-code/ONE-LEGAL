/* Documentos de ejemplo del SGD simulado. Datos ficticios. */
window.SGD_DOCUMENTOS = [
  { id: 1, expediente: '2026-0048213', registro: '000154872', tipo: 'CARTA', numero: 'CARTA N° 117-2026-CONSORCIO VIAL SUR', asunto: 'Solicita ampliación de plazo N° 03 y reconocimiento de mayores gastos generales – Contrato de obra N° 012-2025', remitente: 'CONSORCIO VIAL SUR', dependencia: 'Mesa de Partes Central', fecha: '10/10/2026', estado: 'RECIBIDO', folios: 24 },
  { id: 2, expediente: '2026-0048391', registro: '000154990', tipo: 'CÉDULA DE NOTIFICACIÓN', numero: 'EXP. 01452-2026-0-1801-JR-CA-04', asunto: 'Notifica Resolución N° 05 que fija fecha para audiencia de pruebas', remitente: '4° JUZGADO CONTENCIOSO ADMINISTRATIVO', dependencia: 'Mesa de Partes Central', fecha: '11/10/2026', estado: 'RECIBIDO', folios: 3 },
  { id: 3, expediente: '2026-0048455', registro: '000155021', tipo: 'MEMORANDO', numero: 'MEMORANDO N° 322-2026-OA', asunto: 'Solicita opinión legal sobre resolución de contrato por incumplimiento del proveedor', remitente: 'Oficina de Abastecimiento', dependencia: 'Oficina de Abastecimiento', fecha: '12/10/2026', estado: 'DERIVADO', folios: 12 },
  { id: 4, expediente: '2026-0048502', registro: '000155077', tipo: 'RECURSO', numero: 'RECURSO DE APELACIÓN S/N', asunto: 'Interpone recurso de apelación contra la Resolución Gerencial N° 233-2026', remitente: 'ROSA ELENA CÁRDENAS VILLANUEVA', dependencia: 'Mesa de Partes Virtual', fecha: '13/10/2026', estado: 'RECIBIDO', folios: 8 },
  { id: 5, expediente: '2026-0048560', registro: '000155103', tipo: 'OFICIO', numero: 'OFICIO N° 0981-2026-MP-FPCEDCF', asunto: 'Requiere información para investigación fiscal preliminar', remitente: 'FISCALÍA PROVINCIAL ANTICORRUPCIÓN', dependencia: 'Mesa de Partes Central', fecha: '14/10/2026', estado: 'RECIBIDO', folios: 2 },
  { id: 6, expediente: '2026-0048577', registro: '000155118', tipo: 'INFORME', numero: 'INFORME TÉCNICO N° 061-2026-DPP', asunto: 'Remite informe técnico favorable para la Adenda N° 2 del contrato de vigilancia', remitente: 'Dirección de Planeamiento y Presupuesto', dependencia: 'Dirección de Planeamiento y Presupuesto', fecha: '14/10/2026', estado: 'EN TRÁMITE', folios: 6 }
];
window.SGD_SESION = {
  obtener() { try { return JSON.parse(sessionStorage.getItem('sgd.sesion')); } catch (e) { return null; } },
  iniciar(usuario) { sessionStorage.setItem('sgd.sesion', JSON.stringify({ usuario: usuario.toUpperCase(), inicio: new Date().toISOString() })); },
  cerrar() { sessionStorage.removeItem('sgd.sesion'); },
  exigir() { const s = this.obtener(); if (!s) location.replace('index.html'); return s; }
};
window.SGD_CABECERA = function (sesion) {
  return '<div class="barra"><span>Sistema de Gestión Documental · Entorno simulado</span>' +
    '<span>Usuario: <span class="usuario-nombre">' + sesion.usuario + '</span> · <a href="logout.html">Cerrar sesión</a></span></div>' +
    '<div class="menu"><a href="bandeja.html">Bandeja de documentos recibidos</a><a href="bandeja.html">Documentos emitidos</a><a href="bandeja.html">Consulta de expedientes</a></div>';
};
