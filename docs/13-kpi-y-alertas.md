# 13 · Indicadores (KPI) institucionales y alertas

Los indicadores se calculan en el portal con los datos de la base de datos; las alertas las calcula el servidor (`servidor/ciclo.go`) con las reglas de esta página. Los umbrales configurables están en **Configuración** (rol administrador).

## Conceptos

| Término | Definición |
|---|---|
| Tarea abierta | Tarea en estado *Pendiente* o *En proceso* de un proceso *Activo*. |
| Tarea vencida | Tarea abierta con fecha límite anterior a hoy. |
| Por vencer | Tarea abierta que vence dentro de N días hábiles (N = «Aviso por vencer», 3 por defecto). |
| Plazo por definir | Tarea abierta sin fecha límite ni plazo relativo, cuya antecesora está *En proceso* o *Finalizada* (o que ya inició). |
| Cumplimiento de plazos | Tareas finalizadas en o antes de su fecha límite ÷ tareas finalizadas que tenían fecha límite (año en curso). |
| Oportunidad de indexación | Días entre la fecha de ingreso del trámite al SGD y su indexación en LEGAL (mediana). |
| Días hábiles | Lunes a viernes, sin feriados nacionales del Perú (incluidos Jueves y Viernes Santo) ni los días no laborables registrados por el administrador. Un plazo en días calendario que vence en día inhábil se corre al siguiente hábil. |

## KPI del gerente (panel institucional)

| Indicador | Fórmula | Meta sugerida | Para qué sirve |
|---|---|---|---|
| Procesos activos | Procesos en estado *Activo* (+ nuevos del mes) | — | Volumen de la cartera |
| Finalizados en el año · ciclo medio | Procesos finalizados en el año; promedio de días inicio → fin | Reducir el ciclo por vía | Productividad y duración |
| Cumplimiento de plazos | Ver conceptos | ≥ 90 % (alerta visual < 80 %) | Calidad del seguimiento |
| Tareas vencidas | Conteo; y las que vencen en ≤ N días hábiles | 0 | Riesgo procesal inmediato |
| Plazos por definir | Conteo de alertas «plazo no definido» | 0 | Disciplina de planificación |
| Trámites SGD indexados · oportunidad | Indexaciones de los últimos 30 días; mediana de oportunidad | ≤ 1 día | Que ningún documento quede sin registrar |
| Procesos por categoría y por vía | Distribución de procesos activos | — | Especialización y demanda |
| Carga y desempeño por profesional | Activos, tareas abiertas, vencidas, por definir, cumplimiento, resolución media | Balance de carga | Redistribuir procesos |
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
| Avance por proceso | Tareas finalizadas ÷ total del ciclo | — |

## KPI del asistente administrativo (mi panel)

| Indicador | Fórmula | Meta sugerida |
|---|---|---|
| Indexados hoy / 7 días | Trámites que indexó | — |
| Indexados en 30 días | Propios y de toda la gerencia | — |
| Procesos creados en el mes · con ciclo base | Procesos que registró; procesos activos sin plantilla del profesional | Ciclo base → 0 |
| Oportunidad de indexación | Mediana de días ingreso SGD → indexación (propios) | ≤ 1 día (alerta visual > 2) |
| Solicitudes de plazo pendientes | Solicitudes enviadas que el profesional aún no atiende | 0 |
| Anexos sin tarea relacionada | Documentos anexados sin tarea ÷ documentos anexados | Bajo |

## Alertas

| Tipo | Nivel | Regla | Quién la ve |
|---|---|---|---|
| Tarea vencida | Crítica | Tarea abierta con fecha límite < hoy | Profesional a cargo, asistente, gerente, administrador |
| Tarea por vencer | Alta | Vence en ≤ N días hábiles | Ídem |
| Plazo no definido | Alta si la tarea está en proceso; media si solo avanzó la antecesora | Sin fecha ni plazo relativo y antecesora en proceso/finalizada | Ídem |
| Solicitud de plazo | Alta | El asistente o el gerente pidió definir el plazo; se atiende sola cuando el profesional lo define | Destinatario, remitente, gerente, administrador |
| Proceso sin movimiento | Media | Sin cambios en tareas ni documentos SGD por ≥ M días (30 por defecto) | Profesional, asistente, gerente, administrador |
| Carga crítica | Alta | Un profesional con ≥ U % de sus tareas abiertas vencidas (20 % por defecto) | Gerente, administrador |
| Ciclo generado con etapas base | Aviso | El profesional no tenía plantilla para la vía al crearse el proceso | Todos los que ven el proceso |
| Proceso sin tareas abiertas | Aviso | Proceso activo con todas sus tareas finalizadas | Ídem |
| Nuevo documento SGD | Aviso | Un tercero anexó un trámite a un proceso del profesional (últimos 3 días) | Profesional |

## Plazos que se definen sobre la marcha

1. Cada tarea de la plantilla tiene plazo fijo (N días hábiles o calendario, contados desde el inicio del proceso o desde que concluye la antecesora) o queda **por definir**.
2. Al finalizar una tarea, sus sucesoras pasan a *En proceso* y, si tienen plazo relativo, LEGAL calcula su fecha límite.
3. Si la sucesora no tiene plazo, se genera la alerta «plazo no definido». El profesional la resuelve en **Plazos por definir**, donde puede escribir varias fechas exactas o plazos en días y guardarlas de una vez, o desde la tabla del proceso.
4. El asistente o el gerente pueden **solicitar la definición del plazo**; la solicitud se cierra sola cuando el profesional lo define.
