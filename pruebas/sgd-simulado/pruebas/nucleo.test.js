/*
 * Pruebas del núcleo del SGD de pruebas (reglas RN-xx, flujos y escenarios).
 *   node --test pruebas/sgd-simulado/pruebas/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SGD = require('../nucleo.js');
const ESCENARIOS = require('../escenarios.js');

const U = SGD.utilidades;
/** Motor con reloj fijo (martes 27/10/2026 10:00) y los escenarios cargados. */
function motor(fecha) {
  let ahora = fecha || new Date(2026, 9, 27, 10, 0, 0);
  const e = SGD.crear({ reloj: () => ahora });
  e.cargarEscenarios(ESCENARIOS);
  e.avanzar = (minutos) => { ahora = new Date(ahora.getTime() + minutos * 60000); };
  return e;
}
const regla = (codigo) => (err) => err instanceof SGD.SGDError && err.codigo === codigo;
const NUEVO = { tipo: 'INFORME', asunto: 'INFORME DE PRUEBA AUTOMÁTICA' };

test('normaliza y formatea el número (docs/11 §3.4)', () => {
  const casos = [
    ['2026 - 01234 - 3', '2026-01234-3'], ['2026 - 00871 - 12', '2026-00871-12'], ['2026-01234-3', '2026-01234-3'],
    ['2026 – 01234 – 3', '2026-01234-3'], ['2026 - 871 - 4', '2026-00871-4'], ['2025 - 04410 - 1', '2025-04410-1'],
    ['2026 - 00450 - 101', '2026-00450-101'], ['00123-2026-0-0401-JR-LA-01', null], ['sin número', null]
  ];
  for (const [entrada, salida] of casos) assert.equal(U.normalizarNumero(entrada), salida, entrada);
  assert.equal(U.formatearNumero('2026-00077-4'), '2026 - 00077 - 4');
  assert.equal(U.formatearNumero('2026-00077-4', { sinCeros: true, separador: '-' }), '2026-77-4');
});

test('días hábiles: fines de semana y feriados del Perú (RN-10)', () => {
  assert.equal(U.esHabil(new Date(2026, 9, 31)), false); // sábado
  assert.equal(U.esHabil(new Date(2026, 3, 2)), false); // Jueves Santo 2026
  assert.equal(U.esHabil(new Date(2026, 6, 28)), false); // Fiestas Patrias
  assert.equal(U.esHabil(new Date(2026, 9, 27)), true);
  // Desde el viernes 30/10/2026, 1 día hábil: el 1/11 es domingo (y feriado) → lunes 2/11.
  assert.equal(U.formatearFecha(U.sumarDiasHabiles(new Date(2026, 9, 30, 9), 1)), '02/11/2026 23:59:59');
  // Desde el lunes 7/12/2026, 2 días hábiles: 8 y 9 son feriados → 10 y 11.
  assert.equal(U.formatearFecha(U.sumarDiasHabiles(new Date(2026, 11, 7, 9), 2)), '11/12/2026 23:59:59');
  const hoy = new Date(2026, 9, 27, 10);
  assert.equal(U.semaforo(hoy, new Date(2026, 9, 21, 23, 59, 59)), 'ROJO');
  assert.equal(U.semaforo(hoy, new Date(2026, 9, 27, 23, 59, 59)), 'AMBAR');
  assert.equal(U.semaforo(hoy, new Date(2026, 10, 5, 23, 59, 59)), 'VERDE');
});

test('los escenarios son coherentes con las reglas', () => {
  const e = motor();
  const ids = new Set();
  for (const s of ESCENARIOS) {
    assert.match(String(s.id), /^\d{6}$/, 'RN-08');
    assert.ok(!ids.has(s.id)); ids.add(s.id);
    assert.ok(s.esperado && s.etiquetas.length && s.descripcion, `escenario ${s.id} documentado`);
    assert.ok(s.adjuntos.length, `escenario ${s.id} con documento`);
    const t = e.porNumero(s.numero);
    assert.equal(t.id, s.id);
    if (s.esperado.numero) assert.equal(s.esperado.numero, t.numero);
    if (s.esperado.fechaIngreso) assert.equal(e.detalleSinEfectos(s.id, 'usuario.prueba').fechaIngreso, s.esperado.fechaIngreso, `fecha de ingreso ${s.id}`);
    for (const n of t.asociados) assert.ok(e.porNumero(n).asociados.includes(t.numero), 'RN-15 simétrica');
  }
});

test('inicio de sesión con usuarios de prueba (RN-01)', () => {
  const e = motor();
  assert.equal(e.autenticar('jefe.juridico', SGD.CLAVE_PRUEBA).perfil, 'JEFE');
  assert.throws(() => e.autenticar('jefe.juridico', 'otra'), regla('RN-01'));
  assert.throws(() => e.autenticar('nadie', SGD.CLAVE_PRUEBA), regla('RN-01'));
  assert.throws(() => e.autenticar('inactivo', SGD.CLAVE_PRUEBA), regla('RN-01'));
  assert.throws(() => e.registrar(NUEVO, 'inactivo'), regla('RN-01'));
  for (const area of SGD.CATALOGOS.areas) assert.ok(e.usuarios(area).some((u) => u.activo), `usuario activo en ${area}`);
});

test('numeración: correlativo anual, documento de expediente e ID interno (RN-07, RN-08)', () => {
  const e = motor();
  const a = e.registrar(NUEVO, 'usuario.prueba');
  const b = e.registrar(NUEVO, 'usuario.prueba');
  assert.equal(a.numero, '2026-01507-1'); // último correlativo de 2026 en los escenarios: 01506
  assert.equal(b.numero, '2026-01508-1');
  assert.equal(b.id, a.id + 1);
  assert.ok(a.id > 250117 && String(a.id).length === 6);
  const doc = e.registrar(Object.assign({ expediente: '2026-00871' }, NUEVO), 'usuario.prueba');
  assert.equal(doc.numero, '2026-00871-13');
  assert.throws(() => e.registrar(Object.assign({ expediente: '2026-99999' }, NUEVO), 'usuario.prueba'), regla('RN-07'));
  assert.throws(() => e.registrar({ tipo: 'INFORME', asunto: 'abc' }, 'usuario.prueba'), regla('RN-05'));
  assert.throws(() => e.registrar({ tipo: 'NOTA', asunto: 'ASUNTO VÁLIDO' }, 'usuario.prueba'), regla('RN-06'));
  assert.throws(() => e.registrar(Object.assign({ origen: 'EXTERNO' }, NUEVO), 'usuario.prueba'), regla('RN-02'));
  assert.equal(e.registrar(NUEVO, 'mesa.partes').origen, 'EXTERNO');
  assert.throws(() => e.registrar(NUEVO, 'consulta'), regla('RN-02'));
});

test('flujo completo entre áreas y usuarios: registrar → derivar → recibir → atender → archivar', () => {
  const e = motor();
  const t = e.registrar(Object.assign({ contenido: 'Pedido de opinión' }, NUEVO), 'logistica');
  assert.equal(t.estado, 'REGISTRADO');
  let d = e.derivar(t.id, { areaDestino: 'GERENCIA DE ASESORÍA JURÍDICA', usuarioDestino: 'abogado.uno', plazoDias: 3, proveido: 'Para opinión legal' }, 'logistica');
  assert.equal(d.estado, 'DERIVADO');
  assert.equal(d.asignadoA, 'abogado.uno');
  assert.equal(d.movimientos.at(-1).fechaLimite, '30/10/2026 23:59:59');
  assert.equal(e.bandeja('abogado.uno', { asignadosAMi: true }).filas.filter((x) => x.id === t.id).length, 1);
  assert.equal(e.bandeja('abogado.dos', { asignadosAMi: true }).filas.filter((x) => x.id === t.id).length, 0);
  assert.equal(e.bandeja('logistica').filas.some((x) => x.id === t.id), false, 'ya no está en la bandeja de origen');
  assert.throws(() => e.recibir(t.id, 'logistica'), regla('RN-03'));
  e.avanzar(30);
  d = e.recibir(t.id, 'abogado.uno');
  assert.equal(d.estado, 'RECIBIDO');
  assert.ok(d.movimientos.find((m) => m.estado === 'DERIVADO').fechaLeido, 'RN-11: recibir registra Fecha leído');
  d = e.iniciar(t.id, {}, 'abogado.uno');
  d = e.adjuntar(t.id, { nombre: 'OPINION-LEGAL.txt', texto: 'OPINIÓN LEGAL (FICTICIA)\n\nProcede.' }, 'abogado.uno');
  assert.equal(d.adjuntos[0].bytes, new TextEncoder().encode('OPINIÓN LEGAL (FICTICIA)\n\nProcede.').length);
  d = e.atender(t.id, { motivo: 'Opinión emitida' }, 'abogado.uno');
  assert.equal(d.estado, 'ATENDIDO');
  // devolver la respuesta al área de origen
  d = e.derivar(t.id, { areaDestino: 'ÁREA DE LOGÍSTICA', plazoDias: 2, proveido: 'Se remite opinión' }, 'abogado.uno');
  e.recibir(t.id, 'logistica');
  assert.throws(() => e.archivar(t.id, { motivo: 'Concluido' }, 'logistica'), regla('RN-12'));
  d = e.archivar(t.id, { motivo: 'Concluido el trámite' }, 'jefe.logistica');
  assert.equal(d.estado, 'ARCHIVADO');
  assert.throws(() => e.adjuntar(t.id, { nombre: 'x.txt', texto: 'x' }, 'jefe.logistica'), regla('RN-14'));
  assert.equal(e.bandeja('logistica').filas.some((x) => x.id === t.id), false, 'RN-19: archivados fuera de la bandeja');
  assert.equal(e.bandeja('logistica', { incluirCerrados: true }).filas.some((x) => x.id === t.id), true);
  d = e.desarchivar(t.id, { motivo: 'Nuevo pedido del contratista' }, 'jefe.logistica');
  assert.equal(d.estado, 'EN PROCESO');
  // RN-17: historial en orden, la primera fila es el registro
  const v = e.detalleSinEfectos(t.id, 'logistica');
  assert.equal(v.movimientosDesc.at(-1).estado, 'REGISTRADO');
  assert.deepEqual(v.movimientos.map((m) => m.estado), ['REGISTRADO', 'DERIVADO', 'RECIBIDO', 'EN PROCESO', 'ATENDIDO', 'DERIVADO', 'RECIBIDO', 'ARCHIVADO', 'EN PROCESO']);
});

test('máquina de estados y área actual (RN-03, RN-04)', () => {
  const e = motor();
  // 250101 está DERIVADO en Asesoría Jurídica
  assert.throws(() => e.atender(250101, {}, 'usuario.prueba'), regla('RN-04'));
  assert.throws(() => e.derivar(250101, { areaDestino: 'GERENCIA GENERAL', proveido: 'x' }, 'usuario.prueba'), regla('RN-04'));
  assert.throws(() => e.recibir(250101, 'comercial'), regla('RN-03'));
  e.recibir(250101, 'usuario.prueba');
  assert.throws(() => e.derivar(250101, { areaDestino: 'GERENCIA DE ASESORÍA JURÍDICA', proveido: 'x' }, 'usuario.prueba'), regla('RN-09'));
  assert.throws(() => e.derivar(250101, { areaDestino: 'GERENCIA GENERAL', plazoDias: 31, proveido: 'x' }, 'usuario.prueba'), regla('RN-09'));
  assert.throws(() => e.derivar(250101, { areaDestino: 'GERENCIA GENERAL', proveido: '' }, 'usuario.prueba'), regla('RN-09'));
  assert.throws(() => e.derivar(250101, { areaDestino: 'GERENCIA GENERAL', usuarioDestino: 'logistica', proveido: 'x' }, 'usuario.prueba'), regla('RN-09'));
  assert.throws(() => e.derivar(250101, { areaDestino: 'OTRA ÁREA', proveido: 'x' }, 'usuario.prueba'), regla('RN-06'));
  assert.throws(() => e.iniciar(250101, {}, 'consulta'), regla('RN-02'));
  assert.throws(() => e.iniciar(999999, {}, 'usuario.prueba'), regla('RN-00'));
});

test('observar devuelve al área y al usuario que derivó (RN-18)', () => {
  const e = motor();
  const t = e.registrar(NUEVO, 'comercial');
  e.derivar(t.id, { areaDestino: 'GERENCIA DE ASESORÍA JURÍDICA', proveido: 'Revisar' }, 'comercial');
  e.recibir(t.id, 'abogado.dos');
  assert.throws(() => e.observar(t.id, { motivo: 'no' }, 'abogado.dos'), regla('RN-18'));
  const d = e.observar(t.id, { motivo: 'Falta el anexo firmado' }, 'abogado.dos');
  assert.equal(d.estado, 'OBSERVADO');
  assert.equal(d.areaActual, 'GERENCIA COMERCIAL');
  assert.equal(d.asignadoA, 'comercial');
  // el área de origen corrige y vuelve a derivar
  assert.equal(e.derivar(t.id, { areaDestino: 'GERENCIA DE ASESORÍA JURÍDICA', proveido: 'Se adjunta anexo' }, 'comercial').estado, 'DERIVADO');
});

test('anulación solo antes de derivar y por el área que registró (RN-13)', () => {
  const e = motor();
  assert.throws(() => e.anular(250117, { motivo: 'x' }, 'usuario.prueba'), regla('RN-13'));
  assert.equal(e.anular(250117, { motivo: 'Registrado por error' }, 'usuario.prueba').estado, 'ANULADO');
  assert.throws(() => e.derivar(250117, { areaDestino: 'GERENCIA GENERAL', proveido: 'x' }, 'usuario.prueba'), regla('RN-04'));
  const t = e.registrar(NUEVO, 'logistica');
  e.derivar(t.id, { areaDestino: 'GERENCIA GENERAL', proveido: 'x' }, 'logistica');
  e.recibir(t.id, 'gerente.general');
  assert.ok(!e.detalleSinEfectos(t.id, 'gerente.general').acciones.includes('anular'));
});

test('adjuntos y documentos de texto (RN-14)', () => {
  const e = motor();
  e.recibir(250105, 'usuario.prueba');
  const ok = e.adjuntar(250105, { nombre: 'escaneo.pdf', bytes: 1000, archivoId: 'abc' }, 'usuario.prueba');
  assert.equal(ok.adjuntos.at(-1).tipo, 'application/pdf');
  assert.throws(() => e.adjuntar(250105, { nombre: 'ESCANEO.PDF', bytes: 10, archivoId: 'x' }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'virus.exe', bytes: 10, archivoId: 'x' }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'grande.pdf', bytes: 21 * 1024 * 1024, archivoId: 'x' }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'sin.pdf', bytes: 10 }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'nota.pdf', texto: 'hola' }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'vacio.txt', texto: '  ' }, 'usuario.prueba'), regla('RN-14'));
  assert.throws(() => e.adjuntar(250105, { nombre: 'otra.txt', texto: 'x' }, 'comercial'), regla('RN-03'));
  const docs = e.detalleSinEfectos(250101, 'usuario.prueba').adjuntos;
  assert.ok(docs.some((a) => a.extension === 'txt' && a.texto.includes('INFORME')));
  assert.ok(docs.some((a) => a.extension === 'pdf' && a.datos.startsWith('data:application/pdf;base64,')));
});

test('asociación simétrica (RN-15) y registro en respuesta', () => {
  const e = motor();
  e.recibir(250105, 'usuario.prueba');
  e.asociar(250105, '2026 - 01234 - 3', 'usuario.prueba');
  assert.ok(e.porNumero('2026-01234-3').asociados.includes('2026-01322-2'));
  assert.throws(() => e.asociar(250105, '2026-01234-3', 'usuario.prueba'), regla('RN-15'));
  assert.throws(() => e.asociar(250105, '2026-01322-2', 'usuario.prueba'), regla('RN-15'));
  assert.throws(() => e.asociar(250105, '2026-99999-1', 'usuario.prueba'), regla('RN-15'));
  const r = e.registrar(Object.assign({ asociarA: '2026 - 01322 - 2' }, NUEVO), 'usuario.prueba');
  assert.ok(e.porNumero('2026-01322-2').asociados.includes(r.numero));
});

test('confidencialidad (RN-16)', () => {
  const e = motor();
  assert.equal(e.detalleSinEfectos(250104, 'usuario.prueba').asunto, ESCENARIOS.find((s) => s.id === 250104).asunto);
  const ajeno = e.detalleSinEfectos(250104, 'comercial');
  assert.equal(ajeno.asunto, SGD.ASUNTO_RESERVADO);
  assert.deepEqual(ajeno.adjuntos, []);
  assert.equal(e.buscar('comercial', { numero: '2026-01301-1' }).filas[0].asunto, SGD.ASUNTO_RESERVADO);
  assert.throws(() => e.marcarConfidencial(250104, false, 'usuario.prueba'), regla('RN-02'));
  assert.throws(() => e.marcarConfidencial(250104, false, 'jefe.comercial'), regla('RN-16'));
  assert.equal(e.marcarConfidencial(250104, false, 'jefe.juridico').confidencial, false);
});

test('bandeja paginada y seguimiento con filtros (RN-19, RN-20)', () => {
  const e = motor();
  for (let i = 0; i < 25; i++) e.registrar(NUEVO, 'abogado.uno');
  const p1 = e.bandeja('abogado.uno');
  assert.equal(p1.filas.length, 20);
  assert.ok(p1.paginas >= 2);
  assert.equal(e.bandeja('abogado.uno', {}, 99).pagina, p1.paginas);
  assert.throws(() => e.buscar('usuario.prueba', {}), regla('RN-20'));
  assert.equal(e.buscar('usuario.prueba', { numero: '2025 - 04410 - 1' }).filas[0].id, 250103);
  assert.ok(e.buscar('usuario.prueba', { asunto: 'notificacion judicial' }).total >= 3, 'sin tildes ni mayúsculas');
  assert.equal(e.buscar('usuario.prueba', { estado: 'ARCHIVADO' }).filas[0].id, 250099);
  assert.equal(e.buscar('usuario.prueba', { desde: '2025-12-01', hasta: '2025-12-31' }).filas[0].id, 250103);
});

test('opción R9: abrir el detalle recibe el trámite solo si está activada (RN-11)', () => {
  const e = motor();
  assert.equal(e.detalle(250101, 'usuario.prueba').estado, 'DERIVADO');
  e.configurar({ marcarLeidoAlAbrir: true });
  assert.equal(e.detalle(250101, 'comercial').estado, 'DERIVADO', 'otra área no lo recibe');
  assert.equal(e.detalle(250101, 'usuario.prueba').estado, 'RECIBIDO');
});

test('bitácora de acciones aceptadas y rechazadas (RN-21) y persistencia', () => {
  let guardado = null;
  const e = SGD.crear({ almacen: { leer: () => guardado, escribir: (x) => { guardado = JSON.parse(JSON.stringify(x)); } } });
  e.cargarEscenarios(ESCENARIOS);
  e.recibir(250101, 'usuario.prueba');
  assert.throws(() => e.recibir(250101, 'usuario.prueba'));
  const b = e.bitacora();
  assert.equal(b[0].resultado, 'RECHAZADO');
  assert.match(b[0].detalle, /^RN-04/);
  assert.equal(b[1].resultado, 'OK');
  const otro = SGD.crear({ almacen: { leer: () => guardado, escribir() {} } });
  assert.equal(otro.detalleSinEfectos(250101, 'usuario.prueba').estado, 'RECIBIDO', 'el estado persiste en el almacén');
  assert.throws(() => otro.importar({ version: 1 }));
});
