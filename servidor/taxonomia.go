package main

// Taxonomía base de procesos según la normativa peruana: Categoría (materia) →
// Vía procedimental (tipo de proceso) → etapas normativas de referencia.
//
// Las etapas son el «ciclo base» que se usa cuando el profesional aún no tiene
// una plantilla propia para la vía, y sirven de punto de partida para crearla.
// Los plazos son referenciales (días hábiles salvo indicación) y deben
// verificarse en cada caso; las etapas sin plazo se definen conforme avanza el
// proceso (p. ej. la fecha de audiencia la fija el juzgado). El administrador
// puede editar esta taxonomía desde el portal.

// etH: plazo en días hábiles; etC: plazo en días calendario; etD: plazo por definir.
func etH(nombre string, dias int, ref string) Etapa {
	return Etapa{Nombre: nombre, PlazoDias: &dias, TipoDias: DiasHabiles, Desde: DesdeAntecesora, Referencia: ref}
}
func etC(nombre string, dias int, ref string) Etapa {
	return Etapa{Nombre: nombre, PlazoDias: &dias, TipoDias: DiasCalendario, Desde: DesdeAntecesora, Referencia: ref}
}
func etD(nombre, ref string) Etapa {
	return Etapa{Nombre: nombre, TipoDias: DiasHabiles, Desde: DesdeAntecesora, Referencia: ref}
}

func taxonomiaBase() Taxonomia {
	return Taxonomia{Categorias: []Categoria{
		{Codigo: "CIV", Nombre: "Civil", BaseLegal: "Código Procesal Civil (TUO, R.M. 010-93-JUS)", Vias: []Via{
			{Codigo: "CIV-CON", Nombre: "Proceso de conocimiento", BaseLegal: "CPC arts. 475-485", Etapas: []Etapa{
				etD("Calificación y admisión de la demanda", "CPC art. 426"),
				etH("Contestación de la demanda / reconvención", 30, "CPC art. 478 inc. 5"),
				etD("Saneamiento procesal y fijación de puntos controvertidos", "CPC arts. 465, 468"),
				etD("Audiencia de pruebas", "CPC art. 478 inc. 9"),
				etH("Alegatos", 5, "CPC art. 478 inc. 11"),
				etD("Sentencia de primera instancia", "CPC art. 478 inc. 12"),
				etH("Apelación de sentencia", 10, "CPC art. 478 inc. 13"),
			}},
			{Codigo: "CIV-ABR", Nombre: "Proceso abreviado", BaseLegal: "CPC arts. 486-545", Etapas: []Etapa{
				etD("Calificación y admisión de la demanda", "CPC art. 426"),
				etH("Contestación de la demanda", 10, "CPC art. 491 inc. 5"),
				etD("Audiencia de saneamiento, conciliación y pruebas", "CPC art. 491 inc. 8"),
				etD("Sentencia de primera instancia", "CPC art. 491 inc. 11"),
				etH("Apelación de sentencia", 5, "CPC art. 491 inc. 12"),
			}},
			{Codigo: "CIV-SUM", Nombre: "Proceso sumarísimo", BaseLegal: "CPC arts. 546-607", Etapas: []Etapa{
				etD("Calificación y admisión de la demanda", "CPC art. 426"),
				etH("Contestación de la demanda", 5, "CPC art. 554"),
				etD("Audiencia única", "CPC art. 554"),
				etD("Sentencia", "CPC art. 555"),
				etH("Apelación de sentencia", 3, "CPC art. 556"),
			}},
			{Codigo: "CIV-CAU", Nombre: "Proceso cautelar", BaseLegal: "CPC arts. 608-687", Etapas: []Etapa{
				etD("Solicitud de medida cautelar", "CPC art. 610"),
				etD("Ejecución de la medida", "CPC art. 637"),
				etH("Oposición / apelación", 5, "CPC art. 637"),
			}},
			{Codigo: "CIV-EJE", Nombre: "Proceso único de ejecución", BaseLegal: "CPC arts. 688-748", Etapas: []Etapa{
				etD("Mandato ejecutivo", "CPC art. 690-C"),
				etH("Contradicción", 5, "CPC art. 690-D"),
				etD("Auto que resuelve la contradicción", "CPC art. 690-E"),
				etH("Apelación", 3, "CPC art. 691"),
				etD("Ejecución forzada", "CPC art. 725"),
			}},
			{Codigo: "CIV-NCO", Nombre: "Proceso no contencioso", BaseLegal: "CPC arts. 749-840", Etapas: []Etapa{
				etD("Solicitud", "CPC art. 751"),
				etD("Audiencia de actuación y declaración judicial", "CPC art. 754"),
				etH("Apelación", 3, "CPC art. 756"),
			}},
		}},
		{Codigo: "PEN", Nombre: "Penal", BaseLegal: "Código Procesal Penal (D. Leg. 957)", Vias: []Via{
			{Codigo: "PEN-COM", Nombre: "Proceso común", BaseLegal: "NCPP arts. 321-403", Etapas: []Etapa{
				etD("Denuncia / constitución en actor civil", "NCPP arts. 98-101, 326"),
				etC("Diligencias preliminares", 60, "NCPP art. 334.2"),
				etC("Investigación preparatoria formalizada", 120, "NCPP art. 342"),
				etD("Etapa intermedia (control de acusación)", "NCPP arts. 344-355"),
				etD("Juicio oral", "NCPP arts. 356-392"),
				etD("Sentencia", "NCPP art. 396"),
				etH("Apelación de sentencia", 5, "NCPP art. 414.1.b"),
			}},
			{Codigo: "PEN-INM", Nombre: "Proceso inmediato", BaseLegal: "NCPP arts. 446-448", Etapas: []Etapa{
				etD("Requerimiento de proceso inmediato", "NCPP art. 447"),
				etD("Audiencia única de incoación", "NCPP art. 447"),
				etD("Juicio inmediato", "NCPP art. 448"),
				etH("Apelación", 5, "NCPP art. 414"),
			}},
			{Codigo: "PEN-TAN", Nombre: "Terminación anticipada", BaseLegal: "NCPP arts. 468-471", Etapas: []Etapa{
				etD("Solicitud y acuerdo", "NCPP art. 468"),
				etD("Audiencia de terminación anticipada", "NCPP art. 468.4"),
				etD("Sentencia anticipada", "NCPP art. 468.5"),
			}},
			{Codigo: "PEN-QUE", Nombre: "Querella (ejercicio privado de la acción penal)", BaseLegal: "NCPP arts. 459-467", Etapas: []Etapa{
				etD("Querella", "NCPP art. 459"),
				etD("Audiencia de conciliación", "NCPP art. 462"),
				etD("Juicio y sentencia", "NCPP art. 462"),
			}},
			{Codigo: "PEN-FAL", Nombre: "Proceso por faltas", BaseLegal: "NCPP arts. 482-487", Etapas: []Etapa{
				etD("Denuncia", "NCPP art. 482"),
				etD("Audiencia", "NCPP art. 484"),
				etH("Apelación", 1, "NCPP art. 486"),
			}},
		}},
		{Codigo: "LAB", Nombre: "Laboral", BaseLegal: "Nueva Ley Procesal del Trabajo (Ley 29497)", Vias: []Via{
			{Codigo: "LAB-ORD", Nombre: "Proceso ordinario laboral", BaseLegal: "NLPT arts. 42-47", Etapas: []Etapa{
				etD("Calificación y emplazamiento", "NLPT art. 42"),
				etD("Audiencia de conciliación (contestación)", "NLPT art. 43"),
				etD("Audiencia de juzgamiento", "NLPT arts. 44-47"),
				etH("Notificación de sentencia", 5, "NLPT art. 47"),
				etH("Apelación de sentencia", 5, "NLPT art. 32"),
			}},
			{Codigo: "LAB-ABR", Nombre: "Proceso abreviado laboral", BaseLegal: "NLPT arts. 48-49", Etapas: []Etapa{
				etD("Calificación y emplazamiento", "NLPT art. 48"),
				etH("Contestación de la demanda", 10, "NLPT art. 48"),
				etD("Audiencia única", "NLPT art. 49"),
				etH("Apelación de sentencia", 5, "NLPT art. 32"),
			}},
			{Codigo: "LAB-ILE", Nombre: "Impugnativo de laudos arbitrales económicos", BaseLegal: "NLPT arts. 50-53", Etapas: []Etapa{
				etD("Demanda de impugnación", "NLPT art. 50"),
				etH("Contestación", 10, "NLPT art. 51"),
				etD("Sentencia", "NLPT art. 52"),
			}},
			{Codigo: "LAB-CAU", Nombre: "Proceso cautelar laboral", BaseLegal: "NLPT arts. 54-56", Etapas: []Etapa{
				etD("Solicitud de medida cautelar", "NLPT art. 54"),
				etH("Oposición / apelación", 5, "CPC art. 637 (supletorio)"),
			}},
			{Codigo: "LAB-EJE", Nombre: "Proceso de ejecución laboral", BaseLegal: "NLPT arts. 57-63", Etapas: []Etapa{
				etD("Mandato de ejecución", "NLPT art. 61"),
				etH("Contradicción", 5, "NLPT art. 61"),
				etD("Ejecución", "NLPT art. 62"),
			}},
		}},
		{Codigo: "CAD", Nombre: "Contencioso administrativo", BaseLegal: "TUO de la Ley 27584 (D.S. 011-2019-JUS)", Vias: []Via{
			{Codigo: "CAD-URG", Nombre: "Proceso urgente", BaseLegal: "TUO Ley 27584 art. 26", Etapas: []Etapa{
				etD("Calificación de la demanda", "TUO art. 26"),
				etH("Contestación de la demanda", 3, "TUO art. 26"),
				etH("Sentencia", 5, "TUO art. 26"),
				etH("Apelación", 5, "TUO art. 26"),
			}},
			{Codigo: "CAD-ORD", Nombre: "Proceso ordinario", BaseLegal: "TUO Ley 27584 art. 28", Etapas: []Etapa{
				etD("Calificación y admisión de la demanda", "TUO art. 28"),
				etH("Contestación de la demanda / excepciones", 10, "TUO art. 28.1"),
				etD("Saneamiento y fijación de puntos controvertidos", "TUO art. 28"),
				etH("Dictamen fiscal", 15, "TUO art. 28.1"),
				etH("Sentencia", 15, "TUO art. 28.1"),
				etH("Apelación de sentencia", 5, "TUO art. 28.1"),
			}},
			{Codigo: "CAD-CAU", Nombre: "Medida cautelar", BaseLegal: "TUO Ley 27584 arts. 38-40", Etapas: []Etapa{
				etD("Solicitud de medida cautelar", "TUO art. 38"),
				etH("Apelación", 5, "CPC art. 637 (supletorio)"),
			}},
		}},
		{Codigo: "CNS", Nombre: "Constitucional", BaseLegal: "Nuevo Código Procesal Constitucional (Ley 31307)", Vias: []Via{
			{Codigo: "CNS-AMP", Nombre: "Proceso de amparo", BaseLegal: "NCPCo arts. 44-60", Etapas: []Etapa{
				etD("Admisión de la demanda", "NCPCo art. 6"),
				etH("Contestación de la demanda", 10, "NCPCo art. 6"),
				etD("Audiencia única", "NCPCo art. 12"),
				etD("Sentencia", "NCPCo art. 12"),
				etH("Apelación", 3, "NCPCo art. 23"),
			}},
			{Codigo: "CNS-HDA", Nombre: "Proceso de hábeas data", BaseLegal: "NCPCo arts. 59-63", Etapas: []Etapa{
				etD("Admisión de la demanda", "NCPCo art. 6"),
				etH("Contestación de la demanda", 10, "NCPCo art. 6"),
				etD("Sentencia", "NCPCo art. 12"),
				etH("Apelación", 3, "NCPCo art. 23"),
			}},
			{Codigo: "CNS-CUM", Nombre: "Proceso de cumplimiento", BaseLegal: "NCPCo arts. 64-74", Etapas: []Etapa{
				etD("Admisión de la demanda", "NCPCo art. 6"),
				etH("Contestación de la demanda", 10, "NCPCo art. 6"),
				etD("Sentencia", "NCPCo art. 12"),
				etH("Apelación", 3, "NCPCo art. 23"),
			}},
			{Codigo: "CNS-APO", Nombre: "Proceso de acción popular", BaseLegal: "NCPCo arts. 75-96", Etapas: []Etapa{
				etD("Admisión de la demanda", "NCPCo art. 87"),
				etH("Contestación", 10, "NCPCo art. 89"),
				etD("Sentencia", "NCPCo art. 92"),
			}},
		}},
		{Codigo: "ARB", Nombre: "Arbitraje y medios alternativos", BaseLegal: "D. Leg. 1071; Ley 32069 (contrataciones del Estado); Ley 26872", Vias: []Via{
			{Codigo: "ARB-DER", Nombre: "Arbitraje de derecho", BaseLegal: "D. Leg. 1071", Etapas: []Etapa{
				etD("Solicitud / petición de arbitraje", "D. Leg. 1071 art. 33"),
				etH("Respuesta a la solicitud y designación de árbitro", 10, "Reglamento arbitral aplicable"),
				etD("Instalación del tribunal arbitral", "D. Leg. 1071 art. 27"),
				etD("Demanda / contestación arbitral", "D. Leg. 1071 art. 39"),
				etD("Audiencias", "D. Leg. 1071 art. 42"),
				etD("Laudo arbitral", "D. Leg. 1071 art. 52"),
				etH("Recurso de anulación de laudo", 20, "D. Leg. 1071 art. 64"),
			}},
			{Codigo: "ARB-JRD", Nombre: "Junta de prevención y resolución de disputas", BaseLegal: "Ley 32069 y su reglamento", Etapas: []Etapa{
				etD("Constitución de la junta", "Reglamento"),
				etD("Presentación de la controversia", "Reglamento"),
				etD("Decisión de la junta", "Reglamento"),
			}},
			{Codigo: "ARB-CON", Nombre: "Conciliación extrajudicial", BaseLegal: "Ley 26872 y D.S. 017-2021-JUS", Etapas: []Etapa{
				etD("Solicitud / invitación a conciliar", "Ley 26872 art. 12"),
				etD("Audiencia de conciliación", "Ley 26872 art. 12"),
				etD("Acta de conciliación", "Ley 26872 art. 16"),
			}},
			{Codigo: "ARB-ANU", Nombre: "Anulación de laudo (judicial)", BaseLegal: "D. Leg. 1071 arts. 62-65", Etapas: []Etapa{
				etH("Interposición del recurso de anulación", 20, "D. Leg. 1071 art. 64.1"),
				etH("Traslado y absolución", 20, "D. Leg. 1071 art. 64.3"),
				etD("Vista de la causa", "D. Leg. 1071 art. 64.4"),
				etD("Resolución", "D. Leg. 1071 art. 64.4"),
			}},
		}},
		{Codigo: "ADM", Nombre: "Administrativo", BaseLegal: "TUO de la Ley 27444 (D.S. 004-2019-JUS)", Vias: []Via{
			{Codigo: "ADM-PAS", Nombre: "Procedimiento administrativo sancionador", BaseLegal: "TUO Ley 27444 arts. 254-259", Etapas: []Etapa{
				etD("Actuaciones previas e imputación de cargos", "TUO art. 255.3"),
				etH("Descargos", 5, "TUO art. 255.3"),
				etD("Informe final de instrucción", "TUO art. 255.5"),
				etH("Descargos al informe final", 5, "TUO art. 255.5"),
				etD("Resolución de sanción o archivo", "TUO art. 255.6"),
			}},
			{Codigo: "ADM-REC", Nombre: "Recurso de reconsideración", BaseLegal: "TUO Ley 27444 art. 219", Etapas: []Etapa{
				etH("Interposición del recurso", 15, "TUO art. 218.2"),
				etH("Resolución del recurso", 30, "TUO art. 218.2"),
			}},
			{Codigo: "ADM-APE", Nombre: "Recurso de apelación", BaseLegal: "TUO Ley 27444 art. 220", Etapas: []Etapa{
				etH("Interposición del recurso", 15, "TUO art. 218.2"),
				etD("Elevación al superior jerárquico", "TUO art. 220"),
				etH("Resolución del recurso", 30, "TUO art. 218.2"),
			}},
			{Codigo: "ADM-PAD", Nombre: "Procedimiento administrativo disciplinario", BaseLegal: "Ley 30057 y D.S. 040-2014-PCM", Etapas: []Etapa{
				etD("Precalificación (Secretaría Técnica)", "Reglamento art. 92"),
				etD("Inicio del PAD", "Reglamento art. 106"),
				etH("Descargos", 5, "Reglamento art. 111"),
				etD("Informe del órgano instructor", "Reglamento art. 114"),
				etD("Informe oral", "Reglamento art. 112"),
				etD("Resolución del órgano sancionador", "Reglamento art. 115"),
			}},
			{Codigo: "ADM-NUL", Nombre: "Nulidad de oficio", BaseLegal: "TUO Ley 27444 art. 213", Etapas: []Etapa{
				etD("Evaluación de vicios", "TUO art. 10"),
				etH("Traslado al administrado", 5, "TUO art. 213.2"),
				etD("Resolución de nulidad", "TUO art. 213"),
			}},
		}},
		{Codigo: "COA", Nombre: "Ejecución coactiva", BaseLegal: "TUO de la Ley 26979 (D.S. 018-2008-JUS)", Vias: []Via{
			{Codigo: "COA-OBL", Nombre: "Procedimiento de ejecución coactiva", BaseLegal: "TUO Ley 26979 arts. 14-23", Etapas: []Etapa{
				etD("Resolución de ejecución coactiva", "TUO art. 14"),
				etH("Plazo de cumplimiento", 7, "TUO art. 14"),
				etD("Medidas cautelares", "TUO art. 17"),
				etD("Tercería / suspensión", "TUO arts. 16, 20"),
				etD("Revisión judicial", "TUO art. 23"),
			}},
		}},
		{Codigo: "CON", Nombre: "Asesoría consultiva", BaseLegal: "Reglamento de Organización y Funciones", Vias: []Via{
			{Codigo: "CON-OPI", Nombre: "Opinión legal", Etapas: []Etapa{
				etD("Análisis del requerimiento", ""),
				etD("Proyecto de informe legal", ""),
				etD("Revisión y visto bueno", ""),
				etD("Emisión del informe", ""),
			}},
			{Codigo: "CON-CTR", Nombre: "Revisión de contratos y convenios", Etapas: []Etapa{
				etD("Revisión del expediente de contratación", ""),
				etD("Observaciones / levantamiento", ""),
				etD("Visación del contrato o convenio", ""),
			}},
			{Codigo: "CON-NOR", Nombre: "Proyecto normativo o directiva", Etapas: []Etapa{
				etD("Revisión del proyecto", ""),
				etD("Informe legal", ""),
				etD("Remisión para aprobación", ""),
			}},
		}},
	}}
}
