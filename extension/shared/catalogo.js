/*
 * LEGAL · Conector SGD
 * Catálogo institucional de referencia (datos de ejemplo para la prueba piloto).
 *
 * En producción este catálogo será provisto por el aplicativo LEGAL. Durante la
 * prueba puede reemplazarse importando un archivo JSON desde la página de
 * Configuración de la extensión (formato: { categorias, responsables, procesos }).
 */
(function (global) {
  const ESTADOS_PROCESO = {
    REGISTRADO: 'Registrado',
    EN_TRAMITE: 'En trámite',
    EN_REVISION: 'En revisión',
    SUSPENDIDO: 'Suspendido',
    FINALIZADO: 'Finalizado'
  };

  const categorias = [
    {
      codigo: 'CON',
      nombre: 'Contencioso Judicial',
      procedimientos: [
        'Proceso Contencioso Administrativo',
        'Proceso Civil',
        'Proceso Laboral',
        'Proceso Constitucional de Amparo'
      ]
    },
    {
      codigo: 'ARB',
      nombre: 'Arbitraje y Controversias',
      procedimientos: [
        'Arbitraje de Derecho',
        'Junta de Resolución de Disputas',
        'Conciliación Extrajudicial'
      ]
    },
    {
      codigo: 'ADM',
      nombre: 'Procedimiento Administrativo',
      procedimientos: [
        'Procedimiento Administrativo Sancionador',
        'Recurso Administrativo de Apelación',
        'Procedimiento Administrativo Disciplinario'
      ]
    },
    {
      codigo: 'CNS',
      nombre: 'Asesoría Consultiva',
      procedimientos: [
        'Emisión de Opinión Legal',
        'Revisión de Proyecto Normativo',
        'Revisión de Contratos y Convenios'
      ]
    },
    {
      codigo: 'PEN',
      nombre: 'Defensa Penal Institucional',
      procedimientos: [
        'Denuncia Penal',
        'Investigación Fiscal Preliminar'
      ]
    }
  ];

  const responsables = [
    { codigo: 'R01', nombre: 'Dra. María Fernanda Quispe Rojas', cargo: 'Coordinadora de Asuntos Contenciosos' },
    { codigo: 'R02', nombre: 'Abg. Luis Alberto Paredes Vela', cargo: 'Especialista Legal en Arbitraje' },
    { codigo: 'R03', nombre: 'Abg. Carmen Rosa Huamán Díaz', cargo: 'Especialista en Derecho Administrativo' },
    { codigo: 'R04', nombre: 'Abg. Jorge Enrique Salazar Tello', cargo: 'Especialista en Contratación Pública' },
    { codigo: 'R05', nombre: 'Abg. Ana Lucía Torres Medina', cargo: 'Analista Legal Consultiva' }
  ];

  const procesos = [
    { codigo: 'PL-2026-0001', denominacion: 'Demanda contencioso administrativa – Resolución de multa N.° 045-2025', categoria: 'Contencioso Judicial', procedimiento: 'Proceso Contencioso Administrativo', responsable: 'R01', estado: 'En trámite', fechaInicio: '2026-01-12' },
    { codigo: 'PL-2026-0002', denominacion: 'Proceso laboral – Reposición de ex servidor CAS', categoria: 'Contencioso Judicial', procedimiento: 'Proceso Laboral', responsable: 'R01', estado: 'En revisión', fechaInicio: '2026-02-03' },
    { codigo: 'PL-2026-0003', denominacion: 'Proceso de amparo – Acceso a la información pública', categoria: 'Contencioso Judicial', procedimiento: 'Proceso Constitucional de Amparo', responsable: 'R01', estado: 'Finalizado', fechaInicio: '2025-11-20' },
    { codigo: 'PL-2026-0004', denominacion: 'Arbitraje – Contrato de obra N.° 012-2025 (ampliación de plazo)', categoria: 'Arbitraje y Controversias', procedimiento: 'Arbitraje de Derecho', responsable: 'R02', estado: 'En trámite', fechaInicio: '2026-03-15' },
    { codigo: 'PL-2026-0005', denominacion: 'Junta de Resolución de Disputas – Supervisión de obra', categoria: 'Arbitraje y Controversias', procedimiento: 'Junta de Resolución de Disputas', responsable: 'R02', estado: 'Suspendido', fechaInicio: '2026-04-02' },
    { codigo: 'PL-2026-0006', denominacion: 'Conciliación extrajudicial – Penalidades contrato de servicios', categoria: 'Arbitraje y Controversias', procedimiento: 'Conciliación Extrajudicial', responsable: 'R02', estado: 'Finalizado', fechaInicio: '2026-01-28' },
    { codigo: 'PL-2026-0007', denominacion: 'PAS – Incumplimiento de obligaciones de proveedor', categoria: 'Procedimiento Administrativo', procedimiento: 'Procedimiento Administrativo Sancionador', responsable: 'R03', estado: 'En trámite', fechaInicio: '2026-05-06' },
    { codigo: 'PL-2026-0008', denominacion: 'Recurso de apelación – Resolución Gerencial N.° 210-2026', categoria: 'Procedimiento Administrativo', procedimiento: 'Recurso Administrativo de Apelación', responsable: 'R03', estado: 'Registrado', fechaInicio: '2026-09-22' },
    { codigo: 'PL-2026-0009', denominacion: 'Procedimiento disciplinario – Informe de precalificación 018-2026', categoria: 'Procedimiento Administrativo', procedimiento: 'Procedimiento Administrativo Disciplinario', responsable: 'R03', estado: 'En revisión', fechaInicio: '2026-06-17' },
    { codigo: 'PL-2026-0010', denominacion: 'Revisión de convenio interinstitucional con Gobierno Regional', categoria: 'Asesoría Consultiva', procedimiento: 'Revisión de Contratos y Convenios', responsable: 'R04', estado: 'En trámite', fechaInicio: '2026-08-04' },
    { codigo: 'PL-2026-0011', denominacion: 'Adenda N.° 2 – Contrato de servicio de vigilancia', categoria: 'Asesoría Consultiva', procedimiento: 'Revisión de Contratos y Convenios', responsable: 'R04', estado: 'Registrado', fechaInicio: '2026-10-01' },
    { codigo: 'PL-2026-0012', denominacion: 'Opinión legal – Aplicación de directiva de viáticos', categoria: 'Asesoría Consultiva', procedimiento: 'Emisión de Opinión Legal', responsable: 'R05', estado: 'En trámite', fechaInicio: '2026-09-09' },
    { codigo: 'PL-2026-0013', denominacion: 'Proyecto de Reglamento Interno de Servidores Civiles', categoria: 'Asesoría Consultiva', procedimiento: 'Revisión de Proyecto Normativo', responsable: 'R05', estado: 'En revisión', fechaInicio: '2026-07-21' },
    { codigo: 'PL-2026-0014', denominacion: 'Denuncia penal – Presunta falsificación de documentos', categoria: 'Defensa Penal Institucional', procedimiento: 'Denuncia Penal', responsable: 'R01', estado: 'En trámite', fechaInicio: '2026-04-28' },
    { codigo: 'PL-2026-0015', denominacion: 'Investigación fiscal – Colusión en proceso de selección', categoria: 'Defensa Penal Institucional', procedimiento: 'Investigación Fiscal Preliminar', responsable: 'R02', estado: 'Finalizado', fechaInicio: '2025-12-10' },
    { codigo: 'PL-2026-0016', denominacion: 'Proceso civil – Obligación de dar suma de dinero (proveedor)', categoria: 'Contencioso Judicial', procedimiento: 'Proceso Civil', responsable: 'R01', estado: 'En trámite', fechaInicio: '2026-09-19' },
    { codigo: 'PL-2026-0017', denominacion: 'Opinión legal – Régimen de teletrabajo', categoria: 'Asesoría Consultiva', procedimiento: 'Emisión de Opinión Legal', responsable: 'R05', estado: 'Finalizado', fechaInicio: '2026-07-16' }
  ];

  global.LEGAL_CATALOGO = { ESTADOS_PROCESO, categorias, responsables, procesos };
})(typeof self !== 'undefined' ? self : this);
