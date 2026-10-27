/*
 * SGD de pruebas · Escenarios (datos ficticios).
 *
 * Cada escenario es un trámite con:
 *   - los datos y el historial (movimientos, recientes primero como en pantalla);
 *   - `render`: variaciones de la plantilla para estresar a los lectores del DOM
 *     (docs/11 §3.4 y §9);
 *   - `etiquetas`: qué caso cubre;
 *   - `esperado`: lo que debe devolver un lector correcto (p. ej. leerPaginaSedapar
 *     de la extensión) viendo el detalle con el usuario «usuario.prueba».
 *
 * Variantes de `render`:
 *   separador      texto entre grupos del número (por defecto ' - ')
 *   sinCeros       muestra el correlativo sin ceros a la izquierda
 *   numeroEn       'strong' (defecto) | 'span' → rompe P y R1, solo queda R2
 *   rotulo         texto del encabezado (defecto 'DATOS DEL EXPEDIENTE')
 *   legendPrevia   número que aparece en otro legend.title .col-sm-5 > strong antes del expediente
 *   error          la «API» falla y el número nunca se pinta (NO_NODE)
 *   latenciaMs     demora de getTramite (defecto ~1100 ms, como el SGD real)
 *
 * Ningún dato es real: personas, direcciones y números son inventados.
 */
(function (raiz, fabrica) {
  const lista = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = lista;
  else raiz.SGD_ESCENARIOS = lista;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GAJ = 'GERENCIA DE ASESORÍA JURÍDICA';
  const TD = 'TRÁMITE DOCUMENTARIO';
  const registro = (fecha, area) => ({ fecha, area: area || TD, estado: 'REGISTRADO', usuario: 'USUARIO FICTICIO 1', proveido: 'Registro del trámite' });
  const derivado = (fecha, desde, hacia, limite, leido) => ({ fecha, area: hacia, estado: 'DERIVADO', usuario: 'USUARIO FICTICIO 2', desdeArea: desde, fechaLimite: limite || null, fechaLeido: leido || null, proveido: 'Para su atención' });
  // PDF mínimo de una página (texto ficticio) para probar el visor de PDF.
  const PDF_PRUEBA = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMTUgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA3MiA3NjAgVGQgKFNHRCBERSBQUlVFQkFTIC0gRE9DVU1FTlRPIEZJQ1RJQ0lPKSBUaiAwIC0yNCBUZCAvRjEgMTEgVGYgKENvbnRyYXRvIGRlIG9icmEgTiAwMTItMjAyNSAtIEFkZW5kYSBkZSBhbXBsaWFjaW9uIGRlIHBsYXpvLikgVGogMCAtMTggVGQgKEVzdGUgUERGIGVzIGRlIHBydWViYSB5IG5vIGNvbnRpZW5lIGRhdG9zIHJlYWxlcy4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTA3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTc3CiUlRU9GCg==';
  const BYTES_PDF = 760;
  const solicitante = { nombre: 'PERSONA DE PRUEBA FICTICIA', direccion: 'AV. EJEMPLO 000', email: 'persona@ejemplo.invalid', celular: '900 000 000' };

  /** Documento principal de texto para los escenarios que no declaran adjuntos. */
  const documentoPrincipal = (e) => ({
    nombre: `${e.tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}-${e.numero.replace(/\s/g, '')}.txt`,
    descripcion: 'Documento principal (de prueba)',
    texto: `${e.tipo} (FICTICIO)\nTrámite: ${e.numero}\n\nDE:     ${e.areaOrigen}\nASUNTO: ${e.asunto}\n\n${e.contenido || 'Texto de prueba del contenido del documento.'}\n\nAtentamente,\nUSUARIO FICTICIO\n\nDocumento de prueba: no contiene datos reales.`
  });

  return [
    {
      id: 250101, numero: '2026 - 01234 - 3', tipo: 'INFORME', areaOrigen: 'ÁREA DE LOGÍSTICA',
      asunto: 'SOLICITA OPINIÓN LEGAL SOBRE AMPLIACIÓN DE PLAZO DEL CONTRATO DE OBRA N° 012-2025',
      movimientos: [derivado('14/10/2026 10:05:11', 'ÁREA DE LOGÍSTICA', GAJ, '21/10/2026 23:59:59'), registro('10/10/2026 09:14:22', 'ÁREA DE LOGÍSTICA')],
      adjuntos: [
        { nombre: 'INFORME-012-2026-LOGISTICA.txt', descripcion: 'Informe de la unidad usuaria', texto: 'INFORME N.° 012-2026-AL (FICTICIO)\n\nA:      GERENCIA DE ASESORÍA JURÍDICA\nDE:     ÁREA DE LOGÍSTICA\nASUNTO: Solicita opinión legal sobre ampliación de plazo del Contrato de Obra N.° 012-2025\n\n1. ANTECEDENTES\n   1.1 El contratista solicitó una ampliación de plazo de 30 días calendario.\n   1.2 La supervisión emitió opinión favorable parcial (15 días).\n\n2. ANÁLISIS\n   Se requiere opinión legal sobre la procedencia de la ampliación conforme a la normativa de contrataciones.\n\n3. CONCLUSIÓN\n   Se deriva a la Gerencia de Asesoría Jurídica para su opinión.\n\nDocumento de prueba: no contiene datos reales.' },
        { nombre: 'ADENDA-CONTRATO-012-2025.pdf', descripcion: 'Proyecto de adenda (PDF de prueba)', datos: PDF_PRUEBA, bytes: BYTES_PDF }
      ],
      etiquetas: ['base', 'grupo3-1-digito', 'plazo-vencido', 'documento-pdf'],
      descripcion: 'Caso típico: informe interno derivado a Asesoría Jurídica, plazo vencido.',
      esperado: { numero: '2026-01234-3', motivo: null, confidencial: false, fechaIngreso: '10/10/2026 09:14:22', asunto: 'SOLICITA OPINIÓN LEGAL SOBRE AMPLIACIÓN DE PLAZO DEL CONTRATO DE OBRA N° 012-2025' }
    },
    {
      id: 250102, numero: '2026 - 00871 - 12', tipo: 'CÉDULA', origen: 'EXTERNO', areaOrigen: 'MESA DE PARTES', solicitante,
      asunto: 'NOTIFICACIÓN JUDICIAL - DEMANDA CONTENCIOSO ADMINISTRATIVA',
      contenido: 'Se notifica la demanda del expediente judicial 00123-2026-0-0401-JR-LA-01 (ficticio).',
      asociados: ['2026 - 00871 - 11', '2026 - 00871 - 10'],
      movimientos: [derivado('11/10/2026 11:30:00', 'MESA DE PARTES', GAJ, '30/10/2026 23:59:59'), registro('11/10/2026 11:02:05', 'MESA DE PARTES')],
      etiquetas: ['grupo3-2-digitos', 'asociados', 'externo', 'expediente-judicial-en-contenido', 'datos-personales'],
      descripcion: 'Cédula externa con trámites asociados (otros números en la página) y un n.º judicial en el contenido.',
      esperado: { numero: '2026-00871-12', motivo: null, confidencial: false, fechaIngreso: '11/10/2026 11:02:05', asunto: 'NOTIFICACIÓN JUDICIAL - DEMANDA CONTENCIOSO ADMINISTRATIVA' }
    },
    {
      id: 250098, numero: '2026 - 00871 - 11', tipo: 'CÉDULA', origen: 'EXTERNO', areaOrigen: 'MESA DE PARTES', solicitante,
      asunto: 'NOTIFICACIÓN JUDICIAL - AUTO ADMISORIO', asociados: ['2026 - 00871 - 12'],
      movimientos: [{ fecha: '06/10/2026 16:00:00', area: GAJ, estado: 'ATENDIDO', usuario: 'USUARIO FICTICIO 3', proveido: 'Se registró en LEGAL' }, { fecha: '05/10/2026 09:00:00', area: GAJ, estado: 'EN PROCESO', usuario: 'USUARIO FICTICIO 3' }, { fecha: '05/10/2026 08:40:00', area: GAJ, estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 3' }, derivado('02/10/2026 12:00:00', 'MESA DE PARTES', GAJ, '09/10/2026 23:59:59', '05/10/2026 08:40:00'), registro('02/10/2026 10:15:40', 'MESA DE PARTES')],
      etiquetas: ['atendido', 'mismo-expediente'],
      descripcion: 'Documento anterior del mismo expediente 2026-00871, ya atendido.',
      esperado: { numero: '2026-00871-11', motivo: null, confidencial: false, fechaIngreso: '02/10/2026 10:15:40', asunto: 'NOTIFICACIÓN JUDICIAL - AUTO ADMISORIO' }
    },
    {
      id: 250099, numero: '2026 - 00871 - 10', tipo: 'CÉDULA', origen: 'EXTERNO', areaOrigen: 'MESA DE PARTES', solicitante,
      asunto: 'NOTIFICACIÓN JUDICIAL - ADMISIÓN A TRÁMITE', asociados: ['2026 - 00871 - 12'],
      movimientos: [{ fecha: '01/10/2026 17:00:00', area: 'ARCHIVO CENTRAL', estado: 'ARCHIVADO', usuario: 'JEFE FICTICIO', proveido: 'Archivo: consolidado en el documento -11' }, { fecha: '01/10/2026 16:00:00', area: 'ARCHIVO CENTRAL', estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 4' }, derivado('30/09/2026 12:00:00', 'MESA DE PARTES', 'ARCHIVO CENTRAL', '07/10/2026 23:59:59', '01/10/2026 16:00:00'), registro('30/09/2026 10:00:00', 'MESA DE PARTES')],
      etiquetas: ['archivado', 'fuera-de-bandeja'],
      descripcion: 'Trámite archivado: no aparece en ninguna bandeja; sí en el seguimiento.',
      esperado: { numero: '2026-00871-10', motivo: null, confidencial: false, fechaIngreso: '30/09/2026 10:00:00', asunto: 'NOTIFICACIÓN JUDICIAL - ADMISIÓN A TRÁMITE' }
    },
    {
      id: 250103, numero: '2025 - 04410 - 1', tipo: 'RECURSO', origen: 'EXTERNO', areaOrigen: 'MESA DE PARTES', solicitante,
      asunto: 'RECURSO DE APELACIÓN CONTRA RESOLUCIÓN DE GERENCIA COMERCIAL',
      movimientos: [{ fecha: '05/01/2026 09:12:00', area: GAJ, estado: 'EN PROCESO', usuario: 'USUARIO FICTICIO 3', fechaLimite: '09/01/2026 23:59:59' }, { fecha: '02/01/2026 08:30:00', area: GAJ, estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 3', fechaLimite: '09/01/2026 23:59:59' }, derivado('22/12/2025 10:00:00', 'GERENCIA COMERCIAL', GAJ, '09/01/2026 23:59:59', '02/01/2026 08:30:00'), derivado('19/12/2025 09:00:00', 'MESA DE PARTES', 'GERENCIA COMERCIAL', '26/12/2025 23:59:59', '19/12/2025 11:00:00'), registro('18/12/2025 16:40:51', 'MESA DE PARTES')],
      etiquetas: ['anio-anterior', 'en-proceso'],
      descripcion: 'Trámite de 2025 (el lector no debe fijar el año).',
      esperado: { numero: '2025-04410-1', motivo: null, confidencial: false, fechaIngreso: '18/12/2025 16:40:51', asunto: 'RECURSO DE APELACIÓN CONTRA RESOLUCIÓN DE GERENCIA COMERCIAL' }
    },
    {
      id: 250104, numero: '2026 - 01301 - 1', tipo: 'OFICIO', areaOrigen: 'ÓRGANO DE CONTROL INSTITUCIONAL', confidencial: true,
      asunto: 'REQUERIMIENTO DE INFORMACIÓN PARA SERVICIO DE CONTROL (FICTICIO)',
      movimientos: [derivado('12/10/2026 09:00:00', 'ÓRGANO DE CONTROL INSTITUCIONAL', GAJ, '19/10/2026 23:59:59'), registro('12/10/2026 08:30:00', 'ÓRGANO DE CONTROL INSTITUCIONAL')],
      etiquetas: ['confidencial', 'R7'],
      descripcion: 'Trámite reservado: el lector debe detectar el indicio de confidencialidad. Otras áreas ven «TRÁMITE RESERVADO».',
      esperado: { numero: '2026-01301-1', motivo: null, confidencial: true, fechaIngreso: '12/10/2026 08:30:00', asunto: 'REQUERIMIENTO DE INFORMACIÓN PARA SERVICIO DE CONTROL (FICTICIO)' }
    },
    {
      id: 250105, numero: '2026 - 01322 - 2', tipo: 'MEMORANDO', areaOrigen: 'GERENCIA DE OPERACIONES',
      asunto: 'Difusión y cumplimiento de recomendaciones del Informe 037-2026/S-33000-WMG',
      movimientos: [derivado('13/10/2026 15:40:00', 'GERENCIA DE OPERACIONES', GAJ, '03/11/2026 23:59:59'), registro('13/10/2026 15:21:47', 'GERENCIA DE OPERACIONES')],
      etiquetas: ['asunto-minusculas', 'referencia-en-asunto'],
      descripcion: 'Asunto en minúsculas con una referencia que parece un número pero no lo es.',
      esperado: { numero: '2026-01322-2', motivo: null, confidencial: false, fechaIngreso: '13/10/2026 15:21:47', asunto: 'Difusión y cumplimiento de recomendaciones del Informe 037-2026/S-33000-WMG' }
    },
    {
      id: 250106, numero: '2026 - 00502 - 1', tipo: 'SOLICITUD', areaOrigen: 'GERENCIA COMERCIAL',
      asunto: 'SOLICITA REVISIÓN DE CONVENIO DE COOPERACIÓN INTERINSTITUCIONAL',
      movimientos: [
        { fecha: '22/10/2026 08:10:00', area: GAJ, estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 3', fechaLimite: '29/10/2026 23:59:59' },
        derivado('21/10/2026 17:00:00', 'GERENCIA COMERCIAL', GAJ, '29/10/2026 23:59:59', '22/10/2026 08:10:00'),
        { fecha: '20/10/2026 10:00:00', area: 'GERENCIA COMERCIAL', estado: 'EN PROCESO', usuario: 'USUARIO FICTICIO 5' },
        { fecha: '19/10/2026 09:00:00', area: 'GERENCIA COMERCIAL', estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 5' },
        { fecha: '16/10/2026 12:00:00', area: 'GERENCIA COMERCIAL', estado: 'OBSERVADO', usuario: 'USUARIO FICTICIO 3', desdeArea: GAJ, proveido: 'Falta el anexo 2 del convenio' },
        { fecha: '15/10/2026 11:00:00', area: GAJ, estado: 'EN PROCESO', usuario: 'USUARIO FICTICIO 3' },
        { fecha: '14/10/2026 08:00:00', area: GAJ, estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 3' },
        derivado('13/10/2026 16:00:00', 'GERENCIA COMERCIAL', GAJ, '20/10/2026 23:59:59', '14/10/2026 08:00:00'),
        { fecha: '09/10/2026 10:00:00', area: 'GERENCIA COMERCIAL', estado: 'EN PROCESO', usuario: 'USUARIO FICTICIO 5' },
        { fecha: '08/10/2026 09:30:00', area: 'GERENCIA COMERCIAL', estado: 'RECIBIDO', usuario: 'USUARIO FICTICIO 5' },
        derivado('07/10/2026 15:00:00', 'MESA DE PARTES', 'GERENCIA COMERCIAL', '14/10/2026 23:59:59', '08/10/2026 09:30:00'),
        registro('07/10/2026 14:22:09', 'GERENCIA COMERCIAL')
      ],
      etiquetas: ['muchos-movimientos', 'observado-y-reenviado'],
      descripcion: 'Más de 10 movimientos con una observación y reenvío (la fecha de ingreso es la última fila).',
      esperado: { numero: '2026-00502-1', motivo: null, confidencial: false, fechaIngreso: '07/10/2026 14:22:09', asunto: 'SOLICITA REVISIÓN DE CONVENIO DE COOPERACIÓN INTERINSTITUCIONAL' }
    },
    {
      id: 250107, numero: '2026 - 01400 - 1', tipo: 'CARTA', origen: 'EXTERNO', areaOrigen: 'MESA DE PARTES', solicitante,
      asunto: 'CARTA NOTARIAL SOBRE RESOLUCIÓN DE CONTRATO (FICTICIA)',
      render: { separador: ' – ' },
      movimientos: [derivado('20/10/2026 10:00:00', 'MESA DE PARTES', GAJ, '27/10/2026 23:59:59'), registro('20/10/2026 09:00:00', 'MESA DE PARTES')],
      etiquetas: ['render-en-dash', 'vence-hoy'],
      descripcion: 'El número se muestra con guiones largos (en dash).',
      esperado: { numero: '2026-01400-1', motivo: null, confidencial: false, fechaIngreso: '20/10/2026 09:00:00', asunto: 'CARTA NOTARIAL SOBRE RESOLUCIÓN DE CONTRATO (FICTICIA)' }
    },
    {
      id: 250108, numero: '2026 - 01401 - 2', tipo: 'INFORME', areaOrigen: 'GERENCIA DE OPERACIONES',
      asunto: 'INFORME TÉCNICO SOBRE RECLAMO DE USUARIO (FICTICIO)',
      render: { separador: '-' },
      movimientos: [derivado('21/10/2026 10:00:00', 'GERENCIA DE OPERACIONES', GAJ, '28/10/2026 23:59:59'), registro('21/10/2026 08:45:00', 'GERENCIA DE OPERACIONES')],
      etiquetas: ['render-sin-espacios'],
      descripcion: 'El número se muestra sin espacios: 2026-01401-2.',
      esperado: { numero: '2026-01401-2', motivo: null, confidencial: false, fechaIngreso: '21/10/2026 08:45:00', asunto: 'INFORME TÉCNICO SOBRE RECLAMO DE USUARIO (FICTICIO)' }
    },
    {
      id: 250109, numero: '2026 - 00077 - 4', tipo: 'MEMORANDO', areaOrigen: 'GERENCIA GENERAL',
      asunto: 'ENCARGA REVISIÓN DE DIRECTIVA DE CONTRATACIONES',
      render: { sinCeros: true },
      movimientos: [derivado('22/10/2026 11:00:00', 'GERENCIA GENERAL', GAJ, '05/11/2026 23:59:59'), registro('22/10/2026 10:30:00', 'GERENCIA GENERAL')],
      etiquetas: ['render-sin-ceros'],
      descripcion: 'El correlativo se muestra sin ceros (2026 - 77 - 4); el lector debe rellenarlos.',
      esperado: { numero: '2026-00077-4', motivo: null, confidencial: false, fechaIngreso: '22/10/2026 10:30:00', asunto: 'ENCARGA REVISIÓN DE DIRECTIVA DE CONTRATACIONES' }
    },
    {
      id: 250110, numero: '2026 - 00450 - 101', tipo: 'INFORME', areaOrigen: 'ÁREA DE LOGÍSTICA',
      asunto: 'INFORME DE CONFORMIDAD DE SERVICIO (DOCUMENTO 101 DEL EXPEDIENTE)',
      movimientos: [derivado('23/10/2026 09:00:00', 'ÁREA DE LOGÍSTICA', GAJ, '30/10/2026 23:59:59'), registro('23/10/2026 08:00:00', 'ÁREA DE LOGÍSTICA')],
      etiquetas: ['grupo3-3-digitos'],
      descripcion: 'Grupo 3 de tres dígitos (no observado en el SGD real, pero admitido).',
      esperado: { numero: '2026-00450-101', motivo: null, confidencial: false, fechaIngreso: '23/10/2026 08:00:00', asunto: 'INFORME DE CONFORMIDAD DE SERVICIO (DOCUMENTO 101 DEL EXPEDIENTE)' }
    },
    {
      id: 250111, numero: '2026 - 01500 - 1', tipo: 'OFICIO', areaOrigen: 'GERENCIA COMERCIAL',
      asunto: 'OFICIO DE PRUEBA SIN ETIQUETA STRONG',
      render: { numeroEn: 'span' },
      movimientos: [derivado('23/10/2026 12:00:00', 'GERENCIA COMERCIAL', GAJ, '30/10/2026 23:59:59'), registro('23/10/2026 11:00:00', 'GERENCIA COMERCIAL')],
      etiquetas: ['plantilla-cambiada', 'solo-R2'],
      descripcion: 'La plantilla ya no usa <strong>: fallan P y R1; el número sale por la regex acotada (R2).',
      esperado: { numero: '2026-01500-1', motivo: null, confidencial: false, fechaIngreso: '23/10/2026 11:00:00', estrategias: { P: false, R1: false, R2: true } }
    },
    {
      id: 250112, numero: '2026 - 01501 - 1', tipo: 'OFICIO', areaOrigen: 'GERENCIA COMERCIAL',
      asunto: 'OFICIO DE PRUEBA CON ENCABEZADO DUPLICADO',
      render: { legendPrevia: '2026 - 00999 - 1' },
      movimientos: [derivado('23/10/2026 12:30:00', 'GERENCIA COMERCIAL', GAJ, '30/10/2026 23:59:59'), registro('23/10/2026 11:30:00', 'GERENCIA COMERCIAL')],
      etiquetas: ['plantilla-cambiada', 'ambiguo-P-R1'],
      descripcion: 'Otro legend.title con col-sm-5 > strong aparece antes: P y R1 discrepan → AMBIGUOUS, no se envía nada.',
      esperado: { numero: null, motivo: 'AMBIGUOUS', confidencial: false }
    },
    {
      id: 250113, numero: '2026 - 01502 - 1', tipo: 'OFICIO', areaOrigen: 'GERENCIA COMERCIAL',
      asunto: 'OFICIO CUYA CARGA FALLA',
      render: { error: true },
      movimientos: [derivado('23/10/2026 13:00:00', 'GERENCIA COMERCIAL', GAJ, '30/10/2026 23:59:59'), registro('23/10/2026 12:00:00', 'GERENCIA COMERCIAL')],
      etiquetas: ['error-de-carga', 'NO_NODE'],
      descripcion: 'getTramite falla: el número nunca aparece y el lector debe rendirse al tope (NO_NODE).',
      esperado: { numero: null, motivo: 'NO_NODE', confidencial: false }
    },
    {
      id: 250114, numero: '2026 - 01503 - 1', tipo: 'INFORME', areaOrigen: 'ÁREA DE LOGÍSTICA',
      asunto: 'INFORME CON CARGA LENTA',
      render: { latenciaMs: 4000 },
      movimientos: [derivado('24/10/2026 09:00:00', 'ÁREA DE LOGÍSTICA', GAJ, '02/11/2026 23:59:59'), registro('24/10/2026 08:00:00', 'ÁREA DE LOGÍSTICA')],
      etiquetas: ['carga-lenta', 'R3'],
      descripcion: 'getTramite tarda 4 s (dentro del tope de 10 s): el lector debe esperar con MutationObserver.',
      esperado: { numero: '2026-01503-1', motivo: null, confidencial: false, fechaIngreso: '24/10/2026 08:00:00', asunto: 'INFORME CON CARGA LENTA' }
    },
    {
      id: 250115, numero: '2026 - 01504 - 3', tipo: 'MEMORANDO', areaOrigen: 'GERENCIA DE OPERACIONES',
      asunto: 'MEMORANDO QUE CITA OTRO TRÁMITE EN EL CONTENIDO',
      contenido: 'En atención al trámite 2026 - 01234 - 3, se remite la información solicitada.',
      movimientos: [derivado('24/10/2026 10:00:00', 'GERENCIA DE OPERACIONES', GAJ, '02/11/2026 23:59:59'), registro('24/10/2026 09:30:00', 'GERENCIA DE OPERACIONES')],
      etiquetas: ['otro-numero-en-contenido', 'R2-ambiguo'],
      descripcion: 'La tarjeta del expediente contiene dos números: R2 es ambiguo, pero P y R1 coinciden y mandan.',
      esperado: { numero: '2026-01504-3', motivo: null, confidencial: false, fechaIngreso: '24/10/2026 09:30:00', estrategias: { P: true, R1: true, R2: false } }
    },
    {
      id: 250116, numero: '2026 - 01505 - 1', tipo: 'INFORME', areaOrigen: 'ÁREA DE LOGÍSTICA',
      asunto: 'INFORME CON RÓTULO RENOMBRADO',
      render: { rotulo: 'DATOS DEL TRÁMITE' },
      movimientos: [derivado('24/10/2026 11:00:00', 'ÁREA DE LOGÍSTICA', GAJ, '02/11/2026 23:59:59'), registro('24/10/2026 10:30:00', 'ÁREA DE LOGÍSTICA')],
      etiquetas: ['plantilla-cambiada', 'solo-P'],
      descripcion: 'El encabezado dice «DATOS DEL TRÁMITE»: fallan R1 y R2, la estructura (P) sigue funcionando.',
      esperado: { numero: '2026-01505-1', motivo: null, confidencial: false, fechaIngreso: '24/10/2026 10:30:00', estrategias: { P: true, R1: false, R2: false } }
    },
    {
      id: 250117, numero: '2026 - 01506 - 1', tipo: 'SOLICITUD', areaOrigen: GAJ,
      asunto: 'SOLICITUD REGISTRADA Y AÚN NO DERIVADA',
      movimientos: [registro('26/10/2026 16:00:00', GAJ)],
      etiquetas: ['registrado', 'anulable'],
      descripcion: 'Registrado por Asesoría Jurídica y sin derivar: es el único estado que admite Anular.',
      esperado: { numero: '2026-01506-1', motivo: null, confidencial: false, fechaIngreso: '26/10/2026 16:00:00', asunto: 'SOLICITUD REGISTRADA Y AÚN NO DERIVADA' }
    }
  ].map((e) => Object.assign(e, { adjuntos: e.adjuntos || [documentoPrincipal(e)] }));
});
