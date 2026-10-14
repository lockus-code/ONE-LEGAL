/*
 * LEGAL · Portal de Gestión de Procesos Legales
 * Datos de ejemplo construidos con las reglas de negocio vigentes:
 *   - Un proceso pertenece a una Categoría → Procedimiento y tiene un Responsable.
 *   - Estados de proceso: Registrado, En trámite, En revisión, Suspendido, Finalizado.
 *   - Un proceso Finalizado no admite nuevas incorporaciones (trámites ni actividades).
 *   - Los procesos se generan a partir de Plantillas (fases → actividades → lista de verificación).
 *   - Los trámites del SGD se indexan a un proceso (y opcionalmente a una actividad)
 *     conservando el enlace directo al SGD.
 * Las fechas se calculan en relación con la fecha actual para que la demostración
 * siempre muestre plazos vigentes, próximos y vencidos.
 */
(function (global) {
  const HOY = new Date();
  HOY.setHours(0, 0, 0, 0);
  const dia = (offset) => {
    const d = new Date(HOY);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const ESTADOS_PROCESO = ['Registrado', 'En trámite', 'En revisión', 'Suspendido', 'Finalizado'];
  const ESTADOS_ACTIVIDAD = ['Pendiente', 'En ejecución', 'En revisión', 'Observada', 'Concluida'];
  const PRIORIDADES = ['Alta', 'Media', 'Baja'];

  const categorias = [
    { codigo: 'CON', nombre: 'Contencioso Judicial', procedimientos: ['Proceso Contencioso Administrativo', 'Proceso Civil', 'Proceso Laboral', 'Proceso Constitucional de Amparo'] },
    { codigo: 'ARB', nombre: 'Arbitraje y Controversias', procedimientos: ['Arbitraje de Derecho', 'Junta de Resolución de Disputas', 'Conciliación Extrajudicial'] },
    { codigo: 'ADM', nombre: 'Procedimiento Administrativo', procedimientos: ['Procedimiento Administrativo Sancionador', 'Recurso Administrativo de Apelación', 'Procedimiento Administrativo Disciplinario'] },
    { codigo: 'CNS', nombre: 'Asesoría Consultiva', procedimientos: ['Emisión de Opinión Legal', 'Revisión de Proyecto Normativo', 'Revisión de Contratos y Convenios'] },
    { codigo: 'PEN', nombre: 'Defensa Penal Institucional', procedimientos: ['Denuncia Penal', 'Investigación Fiscal Preliminar'] }
  ];

  const responsables = [
    { codigo: 'R01', nombre: 'Dra. María Fernanda Quispe Rojas', iniciales: 'MQ', cargo: 'Coordinadora de Asuntos Contenciosos' },
    { codigo: 'R02', nombre: 'Abg. Luis Alberto Paredes Vela', iniciales: 'LP', cargo: 'Especialista Legal en Arbitraje' },
    { codigo: 'R03', nombre: 'Abg. Carmen Rosa Huamán Díaz', iniciales: 'CH', cargo: 'Especialista en Derecho Administrativo' },
    { codigo: 'R04', nombre: 'Abg. Jorge Enrique Salazar Tello', iniciales: 'JS', cargo: 'Especialista en Contratación Pública' },
    { codigo: 'R05', nombre: 'Abg. Ana Lucía Torres Medina', iniciales: 'AT', cargo: 'Analista Legal Consultiva' }
  ];

  const gerente = { nombre: 'Dr. Ricardo Alonso Benavides Cáceres', iniciales: 'RB', cargo: 'Gerente de Asesoría Jurídica' };

  // ------------------------------------------------------------- plantillas
  const a = (titulo, plazoDias, checklist) => ({ titulo, plazoDias, checklist });
  const plantillas = [
    {
      id: 'PLT-01', nombre: 'Defensa en proceso judicial', categoria: 'Contencioso Judicial',
      procedimientos: ['Proceso Contencioso Administrativo', 'Proceso Civil', 'Proceso Laboral', 'Proceso Constitucional de Amparo'],
      descripcion: 'Ejercicio de la defensa institucional desde la notificación de la demanda hasta la ejecución de sentencia.',
      fases: [
        { nombre: 'Calificación y contestación', actividades: [
          a('Registro y evaluación de la notificación judicial', 2, ['Verificar plazo procesal', 'Registrar expediente judicial', 'Solicitar antecedentes al área usuaria']),
          a('Elaboración de la contestación de demanda', 8, ['Analizar pretensiones', 'Redactar fundamentos de hecho y derecho', 'Adjuntar medios probatorios', 'Visación de la coordinación']),
          a('Presentación del escrito ante el juzgado', 1, ['Firmar escrito', 'Presentar por Mesa de Partes Electrónica', 'Archivar cargo de presentación'])
        ] },
        { nombre: 'Actuación probatoria y audiencias', actividades: [
          a('Preparación y asistencia a audiencia', 5, ['Preparar alegatos', 'Coordinar asistencia de testigos', 'Elaborar acta interna de audiencia']),
          a('Seguimiento de resoluciones judiciales', 30, ['Revisar casilla electrónica', 'Registrar resoluciones', 'Informar a la Gerencia'])
        ] },
        { nombre: 'Sentencia e impugnación', actividades: [
          a('Análisis de sentencia', 3, ['Evaluar fundamentos', 'Determinar viabilidad de impugnación']),
          a('Interposición de recurso impugnatorio', 5, ['Redactar recurso', 'Presentar recurso', 'Comunicar a la entidad'])
        ] },
        { nombre: 'Ejecución y archivo', actividades: [
          a('Ejecución de lo resuelto y archivo del expediente', 10, ['Coordinar cumplimiento con el área usuaria', 'Elaborar informe final', 'Archivar expediente'])
        ] }
      ]
    },
    {
      id: 'PLT-02', nombre: 'Defensa arbitral', categoria: 'Arbitraje y Controversias',
      procedimientos: ['Arbitraje de Derecho', 'Junta de Resolución de Disputas'],
      descripcion: 'Gestión de controversias contractuales ante tribunal arbitral o junta de resolución de disputas.',
      fases: [
        { nombre: 'Instalación', actividades: [
          a('Evaluación de la solicitud de arbitraje', 5, ['Revisar cláusula arbitral', 'Identificar pretensiones', 'Solicitar informe técnico al área usuaria']),
          a('Designación de árbitro y respuesta a la solicitud', 10, ['Proponer terna de árbitros', 'Elaborar respuesta', 'Verificar conflictos de interés'])
        ] },
        { nombre: 'Postulatoria', actividades: [
          a('Contestación de demanda arbitral', 15, ['Analizar demanda', 'Redactar contestación', 'Ofrecer medios probatorios', 'Visación de la Gerencia']),
          a('Reconvención y excepciones', 10, ['Evaluar reconvención', 'Plantear excepciones procedentes'])
        ] },
        { nombre: 'Audiencias y laudo', actividades: [
          a('Audiencia de ilustración de hechos', 5, ['Preparar presentación', 'Coordinar peritos']),
          a('Alegatos finales', 7, ['Redactar alegatos', 'Presentar escrito']),
          a('Evaluación del laudo arbitral', 5, ['Analizar laudo', 'Evaluar recurso de anulación', 'Informar a la Alta Dirección'])
        ] }
      ]
    },
    {
      id: 'PLT-03', nombre: 'Conciliación extrajudicial', categoria: 'Arbitraje y Controversias',
      procedimientos: ['Conciliación Extrajudicial'],
      descripcion: 'Atención de invitaciones a conciliar y gestión del acuerdo conciliatorio.',
      fases: [
        { nombre: 'Evaluación', actividades: [
          a('Evaluación de la invitación a conciliar', 3, ['Revisar solicitud', 'Solicitar informe técnico']),
          a('Informe de viabilidad de acuerdo', 5, ['Elaborar informe legal', 'Obtener autorización del Titular'])
        ] },
        { nombre: 'Audiencia', actividades: [
          a('Asistencia a audiencia de conciliación', 1, ['Preparar propuesta', 'Firmar acta']),
          a('Seguimiento del acuerdo conciliatorio', 15, ['Comunicar acuerdo al área usuaria', 'Verificar cumplimiento'])
        ] }
      ]
    },
    {
      id: 'PLT-04', nombre: 'Procedimiento sancionador o disciplinario', categoria: 'Procedimiento Administrativo',
      procedimientos: ['Procedimiento Administrativo Sancionador', 'Procedimiento Administrativo Disciplinario'],
      descripcion: 'Asesoría en las fases instructiva y sancionadora con observancia del debido procedimiento.',
      fases: [
        { nombre: 'Fase instructiva', actividades: [
          a('Revisión del informe de precalificación', 5, ['Verificar plazo de prescripción', 'Evaluar tipificación', 'Identificar presuntos responsables']),
          a('Proyecto de resolución de inicio', 5, ['Redactar resolución', 'Notificar al administrado'])
        ] },
        { nombre: 'Descargos', actividades: [
          a('Evaluación de descargos', 7, ['Analizar descargos', 'Actuar pruebas de oficio']),
          a('Informe final de instrucción', 5, ['Redactar informe final', 'Remitir al órgano sancionador'])
        ] },
        { nombre: 'Fase sancionadora', actividades: [
          a('Proyecto de resolución final', 5, ['Determinar sanción', 'Visación legal', 'Notificación de la resolución'])
        ] }
      ]
    },
    {
      id: 'PLT-05', nombre: 'Atención de recurso de apelación', categoria: 'Procedimiento Administrativo',
      procedimientos: ['Recurso Administrativo de Apelación'],
      descripcion: 'Evaluación de admisibilidad y emisión de pronunciamiento de segunda instancia.',
      fases: [
        { nombre: 'Admisibilidad', actividades: [
          a('Verificación de requisitos de admisibilidad', 2, ['Verificar plazo de interposición', 'Verificar firma y requisitos']),
          a('Solicitud de antecedentes', 3, ['Requerir expediente de primera instancia'])
        ] },
        { nombre: 'Pronunciamiento', actividades: [
          a('Elaboración de informe legal', 10, ['Analizar fundamentos del recurso', 'Revisar jurisprudencia aplicable', 'Redactar informe']),
          a('Proyecto de resolución de segunda instancia', 5, ['Redactar resolución', 'Visación de la Gerencia', 'Notificar al recurrente'])
        ] }
      ]
    },
    {
      id: 'PLT-06', nombre: 'Opinión legal y revisión normativa', categoria: 'Asesoría Consultiva',
      procedimientos: ['Emisión de Opinión Legal', 'Revisión de Proyecto Normativo'],
      descripcion: 'Atención de consultas jurídicas de los órganos de la entidad y revisión de dispositivos normativos.',
      fases: [
        { nombre: 'Análisis', actividades: [
          a('Admisión de la consulta y requerimiento de información', 2, ['Verificar competencia', 'Solicitar información complementaria']),
          a('Análisis jurídico', 7, ['Identificar marco normativo', 'Revisar opiniones previas', 'Revisar jurisprudencia'])
        ] },
        { nombre: 'Pronunciamiento', actividades: [
          a('Elaboración del informe legal', 5, ['Redactar conclusiones', 'Redactar recomendaciones']),
          a('Visación y remisión del informe', 2, ['Visación de la Gerencia', 'Remitir por SGD al órgano consultante'])
        ] }
      ]
    },
    {
      id: 'PLT-07', nombre: 'Revisión de contratos y convenios', categoria: 'Asesoría Consultiva',
      procedimientos: ['Revisión de Contratos y Convenios'],
      descripcion: 'Revisión legal de contratos, adendas y convenios previa a su suscripción.',
      fases: [
        { nombre: 'Revisión', actividades: [
          a('Verificación de antecedentes y competencias', 3, ['Verificar informe técnico', 'Verificar disponibilidad presupuestal', 'Verificar facultades de los firmantes']),
          a('Revisión de cláusulas', 5, ['Revisar obligaciones', 'Revisar penalidades y garantías', 'Revisar solución de controversias'])
        ] },
        { nombre: 'Conformidad', actividades: [
          a('Informe legal de conformidad', 3, ['Redactar informe', 'Proponer modificaciones']),
          a('Visación del documento final', 1, ['Visar versión final', 'Remitir para suscripción'])
        ] }
      ]
    },
    {
      id: 'PLT-08', nombre: 'Defensa penal institucional', categoria: 'Defensa Penal Institucional',
      procedimientos: ['Denuncia Penal', 'Investigación Fiscal Preliminar'],
      descripcion: 'Formulación de denuncias y seguimiento de investigaciones fiscales en defensa de la entidad.',
      fases: [
        { nombre: 'Formulación', actividades: [
          a('Evaluación de indicios', 5, ['Revisar informe de control', 'Identificar tipo penal']),
          a('Redacción y presentación de denuncia', 7, ['Redactar denuncia', 'Adjuntar medios probatorios', 'Presentar ante Fiscalía'])
        ] },
        { nombre: 'Investigación', actividades: [
          a('Seguimiento de diligencias fiscales', 30, ['Asistir a declaraciones', 'Presentar escritos', 'Informar avances']),
          a('Constitución en actor civil', 10, ['Elaborar solicitud', 'Cuantificar reparación civil'])
        ] }
      ]
    }
  ];

  // -------------------------------------------------------------- procesos
  // [codigo, denominacion, categoria, procedimiento, responsable, estado, inicioOffset, prioridad, avance(0-1)]
  const P = [
    ['PL-2026-0001', 'Demanda contencioso administrativa – Resolución de multa N.° 045-2025', 'Contencioso Judicial', 'Proceso Contencioso Administrativo', 'R01', 'En trámite', -120, 'Alta', 0.45],
    ['PL-2026-0002', 'Proceso laboral – Reposición de ex servidor CAS', 'Contencioso Judicial', 'Proceso Laboral', 'R01', 'En revisión', -95, 'Media', 0.6],
    ['PL-2026-0003', 'Proceso de amparo – Acceso a la información pública', 'Contencioso Judicial', 'Proceso Constitucional de Amparo', 'R01', 'Finalizado', -200, 'Media', 1],
    ['PL-2026-0004', 'Arbitraje – Contrato de obra N.° 012-2025 (ampliación de plazo)', 'Arbitraje y Controversias', 'Arbitraje de Derecho', 'R02', 'En trámite', -60, 'Alta', 0.35],
    ['PL-2026-0005', 'Junta de Resolución de Disputas – Supervisión de obra', 'Arbitraje y Controversias', 'Junta de Resolución de Disputas', 'R02', 'Suspendido', -45, 'Media', 0.2],
    ['PL-2026-0006', 'Conciliación extrajudicial – Penalidades contrato de servicios', 'Arbitraje y Controversias', 'Conciliación Extrajudicial', 'R02', 'Finalizado', -150, 'Baja', 1],
    ['PL-2026-0007', 'PAS – Incumplimiento de obligaciones de proveedor', 'Procedimiento Administrativo', 'Procedimiento Administrativo Sancionador', 'R03', 'En trámite', -40, 'Media', 0.4],
    ['PL-2026-0008', 'Recurso de apelación – Resolución Gerencial N.° 210-2026', 'Procedimiento Administrativo', 'Recurso Administrativo de Apelación', 'R03', 'Registrado', -6, 'Alta', 0.05],
    ['PL-2026-0009', 'Procedimiento disciplinario – Informe de precalificación 018-2026', 'Procedimiento Administrativo', 'Procedimiento Administrativo Disciplinario', 'R03', 'En revisión', -70, 'Media', 0.7],
    ['PL-2026-0010', 'Revisión de convenio interinstitucional con Gobierno Regional', 'Asesoría Consultiva', 'Revisión de Contratos y Convenios', 'R04', 'En trámite', -20, 'Media', 0.5],
    ['PL-2026-0011', 'Adenda N.° 2 – Contrato de servicio de vigilancia', 'Asesoría Consultiva', 'Revisión de Contratos y Convenios', 'R04', 'Registrado', -4, 'Alta', 0.1],
    ['PL-2026-0012', 'Opinión legal – Aplicación de directiva de viáticos', 'Asesoría Consultiva', 'Emisión de Opinión Legal', 'R05', 'En trámite', -12, 'Baja', 0.5],
    ['PL-2026-0013', 'Proyecto de Reglamento Interno de Servidores Civiles', 'Asesoría Consultiva', 'Revisión de Proyecto Normativo', 'R05', 'En revisión', -35, 'Media', 0.75],
    ['PL-2026-0014', 'Denuncia penal – Presunta falsificación de documentos', 'Defensa Penal Institucional', 'Denuncia Penal', 'R01', 'En trámite', -80, 'Alta', 0.4],
    ['PL-2026-0015', 'Investigación fiscal – Colusión en proceso de selección', 'Defensa Penal Institucional', 'Investigación Fiscal Preliminar', 'R02', 'Finalizado', -240, 'Alta', 1],
    ['PL-2026-0016', 'Proceso civil – Obligación de dar suma de dinero (proveedor)', 'Contencioso Judicial', 'Proceso Civil', 'R01', 'En trámite', -25, 'Media', 0.25],
    ['PL-2026-0017', 'Opinión legal – Régimen de teletrabajo', 'Asesoría Consultiva', 'Emisión de Opinión Legal', 'R05', 'Finalizado', -90, 'Baja', 1]
  ];

  const plantillaDe = (procedimiento) => plantillas.find((t) => t.procedimientos.includes(procedimiento));

  // Generador determinista (para que los datos de ejemplo sean estables).
  let semilla = 7;
  const azar = () => { semilla = (semilla * 9301 + 49297) % 233280; return semilla / 233280; };

  const procesos = [];
  const actividades = [];
  let correlativo = 101;

  P.forEach(([codigo, denominacion, categoria, procedimiento, responsable, estado, inicio, prioridad, avance]) => {
    const plantilla = plantillaDe(procedimiento);
    const proceso = { codigo, denominacion, categoria, procedimiento, responsable, estado, prioridad, fechaInicio: dia(inicio), plantillaId: plantilla.id };
    if (estado === 'Finalizado') proceso.fechaFin = dia(Math.min(-3, inicio + 60 + Math.round(azar() * 40)));
    procesos.push(proceso);

    const lista = plantilla.fases.flatMap((f) => f.actividades.map((act) => ({ ...act, fase: f.nombre })));
    const total = lista.length;
    const hechas = Math.round(total * avance);
    let cursor = inicio;
    lista.forEach((act, i) => {
      cursor += Math.max(2, Math.round(act.plazoDias * 0.8));
      let estadoAct;
      if (i < hechas) estadoAct = 'Concluida';
      else if (i === hechas && estado !== 'Registrado') estadoAct = estado === 'En revisión' ? 'En revisión' : estado === 'Suspendido' ? 'Observada' : 'En ejecución';
      else if (i === hechas + 1 && azar() > 0.6 && estado !== 'Suspendido') estadoAct = 'En revisión';
      else estadoAct = 'Pendiente';

      // Plazos: concluidas en el pasado; la actual cerca de hoy (algunas vencidas); futuras hacia adelante.
      let limite;
      if (estadoAct === 'Concluida') limite = dia(Math.min(cursor, -2));
      else if (i === hechas) limite = dia(Math.round(azar() * 12) - 4);
      else limite = dia(Math.max(cursor, 3 + (i - hechas) * 6));

      const checklist = act.checklist.map((texto, j) => ({
        texto,
        hecho: estadoAct === 'Concluida' || (estadoAct !== 'Pendiente' && j < Math.ceil(act.checklist.length * 0.5))
      }));

      actividades.push({
        clave: `LEG-${correlativo++}`,
        titulo: act.titulo,
        descripcion: `${act.fase} · ${denominacion}`,
        procesoCodigo: codigo,
        fase: act.fase,
        responsable,
        estado: estadoAct,
        prioridad: i === hechas ? prioridad : PRIORIDADES[Math.min(2, Math.floor(azar() * 3))],
        fechaLimite: limite,
        checklist,
        comentarios: estadoAct === 'Observada'
          ? [{ autor: gerente.nombre, fecha: dia(-2), texto: 'Se observa la actividad hasta contar con el informe técnico del área usuaria.' }]
          : []
      });
    });
  });

  // ------------------------------------------------------ trámites indexados
  const BASE_SGD = 'https://sgd.institucion.gob.pe/sgd/expediente/detalle?nroExpediente=';
  // [nroExpediente, nroRegistro, tipoDocumento, nroDocumento, asunto, remitente, dependencia, offsetFecha, proceso, modo, asuntoVinculacion]
  const T = [
    ['2026-0012044', '000098211', 'CÉDULA DE NOTIFICACIÓN', 'EXP. 01452-2026-0-1801-JR-CA-04', 'Notificación de demanda contencioso administrativa y anexos', '4.° JUZGADO CONTENCIOSO ADMINISTRATIVO', 'Mesa de Partes Central', -118, 'PL-2026-0001', 'nuevo', 'Se genera proceso por notificación de demanda contra la Resolución de multa N.° 045-2025.'],
    ['2026-0012044', '000101876', 'INFORME', 'INFORME N.° 210-2026-OGA', 'Remite antecedentes administrativos de la multa impuesta', 'Oficina General de Administración', 'Oficina General de Administración', -110, 'PL-2026-0001', 'anexo', 'Antecedentes para la contestación de demanda.'],
    ['2026-0012044', '000143552', 'RESOLUCIÓN JUDICIAL', 'RESOLUCIÓN N.° 04', 'Cita a audiencia única', '4.° JUZGADO CONTENCIOSO ADMINISTRATIVO', 'Mesa de Partes Central', -9, 'PL-2026-0001', 'anexo', 'Programación de audiencia única: preparar alegatos.'],
    ['2026-0018370', '000106554', 'CÉDULA DE NOTIFICACIÓN', 'EXP. 00877-2026-0-1801-JR-LA-02', 'Demanda de reposición laboral', '2.° JUZGADO DE TRABAJO PERMANENTE', 'Mesa de Partes Central', -94, 'PL-2026-0002', 'nuevo', 'Se genera proceso laboral por demanda de reposición.'],
    ['2026-0018370', '000139900', 'ESCRITO', 'ESCRITO S/N', 'Demandante absuelve contestación', 'ESTUDIO JURÍDICO RAMÍREZ & ASOCIADOS', 'Mesa de Partes Central', -14, 'PL-2026-0002', 'anexo', 'Revisar absolución para alegatos finales.'],
    ['2026-0031195', '000124310', 'SOLICITUD', 'SOLICITUD DE ARBITRAJE', 'Solicitud de arbitraje por denegatoria de ampliación de plazo N.° 02', 'CONSORCIO VIAL SUR', 'Mesa de Partes Central', -58, 'PL-2026-0004', 'nuevo', 'Se genera proceso arbitral por solicitud del contratista.'],
    ['2026-0031195', '000146021', 'CARTA', 'CARTA N.° 117-2026-CONSORCIO VIAL SUR', 'Solicita ampliación de plazo N.° 03 y mayores gastos generales', 'CONSORCIO VIAL SUR', 'Mesa de Partes Central', -4, 'PL-2026-0004', 'anexo', 'Nueva pretensión del contratista; evaluar acumulación en el arbitraje.'],
    ['2026-0034410', '000127743', 'INFORME', 'INFORME N.° 033-2026-SUPERVISIÓN', 'Informe de supervisión sobre controversia en partidas', 'SUPERVISIÓN DE OBRA', 'Dirección de Infraestructura', -44, 'PL-2026-0005', 'nuevo', 'Se genera proceso ante la Junta de Resolución de Disputas.'],
    ['2026-0040022', '000131198', 'INFORME', 'INFORME N.° 088-2026-OA', 'Comunica incumplimiento de obligaciones contractuales del proveedor', 'Oficina de Abastecimiento', 'Oficina de Abastecimiento', -39, 'PL-2026-0007', 'nuevo', 'Inicio de evaluación para procedimiento sancionador.'],
    ['2026-0040022', '000144873', 'ESCRITO', 'DESCARGOS S/N', 'Presenta descargos al inicio del procedimiento sancionador', 'SERVICIOS GENERALES ANDINOS S.A.C.', 'Mesa de Partes Central', -7, 'PL-2026-0007', 'anexo', 'Descargos para evaluación en la fase instructiva.'],
    ['2026-0051987', '000147550', 'RECURSO', 'RECURSO DE APELACIÓN S/N', 'Interpone recurso de apelación contra la Resolución Gerencial N.° 210-2026', 'JUAN CARLOS MENDOZA PRADO', 'Mesa de Partes Virtual', -6, 'PL-2026-0008', 'nuevo', 'Se genera proceso de segunda instancia.'],
    ['2026-0029001', '000122987', 'INFORME', 'INFORME DE PRECALIFICACIÓN N.° 018-2026', 'Remite informe de precalificación para inicio de PAD', 'Secretaría Técnica de PAD', 'Secretaría Técnica de PAD', -69, 'PL-2026-0009', 'nuevo', 'Se genera proceso disciplinario.'],
    ['2026-0049311', '000145120', 'OFICIO', 'OFICIO N.° 412-2026-GR', 'Remite propuesta de convenio de cooperación interinstitucional', 'GOBIERNO REGIONAL', 'Gerencia General', -19, 'PL-2026-0010', 'nuevo', 'Se genera revisión del convenio propuesto.'],
    ['2026-0049311', '000146788', 'INFORME', 'INFORME TÉCNICO N.° 054-2026-DPP', 'Informe técnico favorable al convenio', 'Dirección de Planeamiento y Presupuesto', 'Dirección de Planeamiento y Presupuesto', -8, 'PL-2026-0010', 'anexo', 'Sustento técnico para la conformidad legal.'],
    ['2026-0052240', '000147901', 'MEMORANDO', 'MEMORANDO N.° 301-2026-OA', 'Solicita revisión legal de la Adenda N.° 2', 'Oficina de Abastecimiento', 'Oficina de Abastecimiento', -4, 'PL-2026-0011', 'nuevo', 'Se genera revisión de adenda.'],
    ['2026-0050118', '000146002', 'MEMORANDO', 'MEMORANDO N.° 145-2026-ORH', 'Consulta sobre aplicación de la directiva de viáticos', 'Oficina de Recursos Humanos', 'Oficina de Recursos Humanos', -12, 'PL-2026-0012', 'nuevo', 'Se genera proceso de opinión legal.'],
    ['2026-0044780', '000134665', 'MEMORANDO', 'MEMORANDO N.° 098-2026-ORH', 'Remite proyecto de Reglamento Interno de Servidores Civiles', 'Oficina de Recursos Humanos', 'Oficina de Recursos Humanos', -34, 'PL-2026-0013', 'nuevo', 'Se genera revisión del proyecto normativo.'],
    ['2026-0025601', '000117432', 'INFORME', 'INFORME DE CONTROL N.° 007-2026-OCI', 'Informe de control con presunta responsabilidad penal', 'Órgano de Control Institucional', 'Órgano de Control Institucional', -79, 'PL-2026-0014', 'nuevo', 'Se genera proceso para formulación de denuncia penal.'],
    ['2026-0025601', '000145998', 'NOTIFICACIÓN', 'DISPOSICIÓN FISCAL N.° 02', 'Disposición de formalización de investigación preparatoria', 'FISCALÍA PROVINCIAL ANTICORRUPCIÓN', 'Mesa de Partes Central', -5, 'PL-2026-0014', 'anexo', 'Evaluar constitución en actor civil.'],
    ['2026-0047730', '000141076', 'DEMANDA', 'EXP. 02210-2026-0-1801-JR-CI-11', 'Demanda de obligación de dar suma de dinero', '11.° JUZGADO CIVIL', 'Mesa de Partes Central', -24, 'PL-2026-0016', 'nuevo', 'Se genera proceso civil.']
  ];

  const tramites = T.map(([nroExpediente, nroRegistro, tipoDocumento, nroDocumento, asunto, remitente, dependencia, off, procesoCodigo, modo, asuntoVinculacion], i) => {
    const deProceso = actividades.filter((x) => x.procesoCodigo === procesoCodigo);
    const actividad = modo === 'nuevo' ? deProceso[0] : deProceso.find((x) => x.estado !== 'Concluida') || deProceso[0];
    return {
      id: `TSGD-EJ${String(i + 1).padStart(3, '0')}`,
      nroExpediente, nroRegistro, tipoDocumento, nroDocumento, asunto, remitente, dependencia,
      fechaDocumento: dia(off),
      estadoSgd: 'RECIBIDO',
      enlaceSgd: BASE_SGD + nroExpediente + '&registro=' + nroRegistro,
      vinculacion: { modo, procesoCodigo, actividadClave: actividad ? actividad.clave : null },
      asuntoVinculacion,
      usuarioLegal: (procesos.find((p) => p.codigo === procesoCodigo) || {}).responsable,
      fechaCaptura: new Date(new Date(dia(off)).getTime() + 15 * 3600 * 1000).toISOString()
    };
  });

  global.LEGAL_DATOS = {
    version: 2,
    hoy: dia(0),
    ESTADOS_PROCESO, ESTADOS_ACTIVIDAD, PRIORIDADES,
    categorias, responsables, gerente, plantillas, procesos, actividades, tramites,
    siguienteClave: correlativo
  };
})(window);
