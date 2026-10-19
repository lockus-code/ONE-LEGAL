# 13 · Indicadores (KPI) institucionales y alertas

Los indicadores se calculan en el portal con los datos de la base de datos; las alertas las calcula el servidor (`servidor/ciclo.go`) con las reglas de esta página. Los umbrales configurables están en **Configuración** (rol administrador).

## Conceptos

| Término | Definición |
|---|---|
| Tarea abierta | Tarea en estado *Pendiente* o *En proceso* de un proceso *Activo*. |
| Tarea vencida | Tarea abierta con fecha límite anterior a hoy. |
| Por vencer | Tarea abierta que vence dentro de N días hábiles (N = «Aviso por vencer», 3 por defecto). |
| Tarea habilitada | Tarea sin antecesora o cuya antecesora finalizó; es la única que aparece en el tablero y la única que puede avanzar. |
| Plazo por definir | Tarea abierta sin fecha límite ni plazo relativo, cuya antecesora está *En proceso*, *En revisión* o *Finalizada* (o que ya está habilitada). |
| Cumplimiento de plazos | Tareas finalizadas en o antes de su fecha límite ÷ tareas finalizadas que tenían fecha límite (año en curso). |
| Desempeño del cronograma (SPI) | Aproximación por tareas del índice del PMBOK: tareas finalizadas ÷ tareas cuya fecha límite ya llegó (valor ganado ÷ valor planificado). 1,00 = al día; < 0,90 = atraso. |
| Avance real / plan | Real: tareas finalizadas ÷ total del ciclo. Plan: tareas cuya fecha límite ya llegó ÷ total del ciclo. Real < plan = proceso atrasado. |
| Salud del proceso (semáforo) | **Rojo · en riesgo**: tareas vencidas o antecesora finalizada sin plazo por más de N días hábiles. **Ámbar · atención**: por vencer, sin plazo, solicitud de plazo o sin movimiento. **Verde · en plazo**: ninguna de las anteriores. Gris: suspendido o finalizado. |
| Oportunidad de indexación | Días entre la fecha de ingreso del trámite al SGD y su indexación en LEGAL (mediana). |
| Días hábiles | Lunes a viernes, sin feriados nacionales del Perú (incluidos Jueves y Viernes Santo) ni los días no laborables registrados por el administrador. Un plazo en días calendario que vence en día inhábil se corre al siguiente hábil. |

## KPI del gerente (panel institucional)

| Indicador | Fórmula | Meta sugerida | Para qué sirve |
|---|---|---|---|
| Salud de la cartera | Procesos activos en rojo / ámbar / verde (barra apilada en la cabecera) | 0 en rojo | Lectura ejecutiva del estado |
| Procesos activos · en riesgo | Procesos *Activos* (+ nuevos del mes, suspendidos); los que están en rojo | — | Volumen y exposición |
| Desempeño del cronograma (SPI) | Ver conceptos | ≥ 0,90 | Atraso de la cartera frente a su plan |
| Plantillas por aprobar | Plantillas enviadas pendientes de revisión | 0 | Que los profesionales no esperen |
| Finalizados en el año · ciclo medio | Procesos finalizados en el año; promedio de días inicio → fin | Reducir el ciclo por vía | Productividad y duración |
| Cumplimiento de plazos | Ver conceptos | ≥ 90 % (alerta visual < 80 %) | Calidad del seguimiento |
| Tareas vencidas | Conteo; y las que vencen en ≤ N días hábiles | 0 | Riesgo procesal inmediato |
| Plazos por definir | Conteo de alertas «plazo no definido» | 0 | Disciplina de planificación |
| Trámites SGD indexados · oportunidad | Indexaciones de los últimos 30 días; mediana de oportunidad | ≤ 1 día | Que ningún documento quede sin registrar |
| Procesos por categoría y por vía | Distribución de procesos activos | — | Especialización y demanda |
| Desempeño por profesional (desplegable) | Por profesional: semáforo de sus procesos, activos, tareas abiertas, vencidas, sin plazo, cumplimiento y SPI; al desplegarlo, cada proceso con su salud, avance real/plan, tarea en curso y próximo vencimiento. Ordenado por riesgo | Balance de carga | Redistribuir procesos y priorizar seguimiento |
| Alertas por prioridad · agenda de la cartera | Alertas agrupadas por nivel; plazos vencidos, por vencer, sin plazo y próximos 30 días con su profesional | — | Seguimiento semanal |
| Trámites por semana | Indexaciones por semana (8 semanas) | — | Tendencia de ingreso |

## KPI del profesional (mi panel)

| Indicador | Fórmula | Meta sugerida |
|---|---|---|
| Mis procesos activos | Procesos a su cargo en estado *Activo* | — |
| Tareas abiertas · por vencer | Tareas abiertas; las que vencen en ≤ N días hábiles | — |
| Tareas vencidas | Conteo | 0 |
| Plazos por definir · solicitudes | Alertas «plazo no definido»; solicitudes del asistente pendientes | 0 |
| Cumplimiento de plazos | Ver conceptos (solo sus tareas) | ≥ 90 % |
| Resolución media | Promedio de días entre inicio y fin de sus tareas finalizadas | Reducir |
| Desempeño del cronograma (SPI) | Ver conceptos (solo sus tareas) | ≥ 0,90 |
| Agenda de plazos | Vencidas, por vencer, sin plazo y próximos 30 días (desplegables) | — |
| Mis procesos activos (desplegable) | Salud, avance real/plan y tarea en curso; al desplegar, el ciclo completo de tareas | — |

## KPI del asistente administrativo (mi panel)

| Indicador | Fórmula | Meta sugerida |
|---|---|---|
| Indexados hoy / 7 días | Trámites que indexó | — |
| Indexados en 30 días | Propios y de toda la gerencia | — |
| Procesos creados en el mes | Procesos que registró; vías con plantilla aprobada disponibles | — |
| Oportunidad de indexación | Mediana de días ingreso SGD → indexación (propios) | ≤ 1 día (alerta visual > 2) |
| Solicitudes de plazo pendientes | Solicitudes enviadas que el profesional aún no atiende | 0 |
| Anexos sin tarea relacionada | Documentos anexados sin tarea ÷ documentos anexados | Bajo |

## Alertas

| Tipo | Nivel | Regla | Quién la ve |
|---|---|---|---|
| Tarea vencida | Crítica | Tarea abierta con fecha límite < hoy | Profesional a cargo, asistente, gerente, administrador |
| Tarea por vencer | Alta | Vence en ≤ N días hábiles | Ídem |
| Antecesora finalizada, tarea sin plazo | Alta; **crítica** si lleva más de N días hábiles así | La antecesora finalizó y la tarea que la continúa no tiene fecha límite ni plazo relativo | Ídem |
| Plazo no definido | Alta si la tarea ya está habilitada (p. ej. la primera del ciclo); media si la antecesora está en proceso | Sin fecha ni plazo relativo | Ídem |
| Solicitud de plazo | Alta | El asistente o el gerente pidió definir el plazo; se atiende sola cuando el profesional lo define | Destinatario, remitente, gerente, administrador |
| Proceso sin movimiento | Media | Sin cambios en tareas ni documentos SGD por ≥ M días (30 por defecto) | Profesional, asistente, gerente, administrador |
| Carga crítica | Alta | Un profesional con ≥ U % de sus tareas abiertas vencidas (20 % por defecto) | Gerente, administrador |
| Retroceso de tarea | Alta | Un profesional devolvió una tarea a una columna anterior; muestra la justificación. Permanece hasta que el gerente la marque como vista (*✓ Visto*) | Gerente, administrador |
| Plantilla por aprobar | Media | Un profesional envió una versión nueva de su plantilla | Gerente, administrador |
| Plantilla observada | Alta | La gerencia observó la plantilla (muestra la observación) | Profesional dueño |
| Proceso sin tareas abiertas | Aviso | Proceso activo con todas sus tareas finalizadas | Ídem |
| Nuevo documento SGD | Aviso | Un tercero anexó un trámite a un proceso del profesional (últimos 3 días) | Profesional |

## Plazos que se definen sobre la marcha

1. Cada tarea de la plantilla tiene plazo fijo (N días hábiles o calendario, contados desde el inicio del proceso o desde que concluye la antecesora) o queda **por definir**.
2. Al finalizar una tarea, sus sucesoras quedan **habilitadas** (*Por hacer*) desde esa fecha y, si tienen plazo relativo, LEGAL calcula su fecha límite.
3. Mientras la antecesora está en proceso, una sucesora sin plazo genera la alerta «plazo no definido» (aviso anticipado). Cuando la antecesora **finaliza** y la sucesora sigue sin plazo, la alerta pasa a «antecesora finalizada, tarea sin plazo» (alta; crítica tras N días hábiles) y la ficha del tablero lo destaca en rojo. El profesional la resuelve en **Plazos por definir**, donde puede escribir varias fechas exactas o plazos en días y guardarlas de una vez, o desde la tabla del proceso.
4. El asistente o el gerente pueden **solicitar la definición del plazo**; la solicitud se cierra sola cuando el profesional lo define.
