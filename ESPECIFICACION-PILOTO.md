# LEGAL · Especificación completa de la prueba piloto

> **Para qué sirve este documento.** Reúne en un solo lugar todas las reglas, instrucciones, decisiones y datos con los que se construyó la prueba piloto funcional de LEGAL (Conector SGD + Portal + servidor de prueba + despliegue). Está pensado para **reconstruir el sistema desde cero en un entorno local** y, sobre esa base, añadir mejoras sin perder ninguna regla ya validada.
>
> Fuentes: el código del repositorio `lockus-code/ONE-LEGAL` (versión 0.3.0), `README.md`, `docs/11-reconocimiento-sgd.md` y `docs/12-despliegue-hetzner.md`. Donde este documento y el código discrepen, el código de la versión 0.3.0 es la referencia del comportamiento de la piloto.
>
> Convención: **RN-xx** = regla de negocio; **RT-xx** = regla técnica; **RP-xx** = regla de privacidad y seguridad. Mantener la numeración al agregar reglas nuevas.

---

## Índice

1. [Objetivo y alcance](#1-objetivo-y-alcance)
2. [Arquitectura y componentes](#2-arquitectura-y-componentes)
3. [Modelo de dominio](#3-modelo-de-dominio)
4. [Datos de referencia (catálogo de la piloto)](#4-datos-de-referencia-catálogo-de-la-piloto)
5. [Reglas de negocio](#5-reglas-de-negocio)
6. [Reglas de privacidad y seguridad](#6-reglas-de-privacidad-y-seguridad)
7. [Componente 1 · Conector SGD (extensión de Chrome)](#7-componente-1--conector-sgd-extensión-de-chrome)
8. [Componente 2 · Servidor LEGAL-Prueba y API](#8-componente-2--servidor-legal-prueba-y-api)
9. [Componente 3 · Portal LEGAL](#9-componente-3--portal-legal)
10. [Componente 4 · SGD simulado](#10-componente-4--sgd-simulado)
11. [Formatos de intercambio (JSON)](#11-formatos-de-intercambio-json)
12. [Reconocimiento del SGD de SEDAPAR (resumen operativo)](#12-reconocimiento-del-sgd-de-sedapar-resumen-operativo)
13. [Construcción, pruebas y ejecución local](#13-construcción-pruebas-y-ejecución-local)
14. [Despliegue en servidor (Hetzner)](#14-despliegue-en-servidor-hetzner)
15. [Limitaciones conocidas de la piloto](#15-limitaciones-conocidas-de-la-piloto)
16. [Preguntas abiertas (sistemas y datos personales)](#16-preguntas-abiertas-sistemas-y-datos-personales)
17. [Mejoras propuestas (backlog)](#17-mejoras-propuestas-backlog)
18. [Mapa de archivos para recrear el proyecto](#18-mapa-de-archivos-para-recrear-el-proyecto)
19. [Lista de verificación de aceptación](#19-lista-de-verificación-de-aceptación)

---

## 1. Objetivo y alcance

**Problema.** La Gerencia de Asesoría Jurídica recibe documentos por el **SGD** (Sistema de Gestión Documental institucional; en la piloto, el de SEDAPAR: `https://sgd.sedapar.com.pe`). Cada documento debe vincularse a un **proceso legal** (judicial, arbitral, administrativo, consultivo o penal) y a las **actividades** que lo atienden, sin perder la ruta para volver al documento en el SGD.

**Solución de la piloto.**

| Pieza | Qué hace |
|---|---|
| **Conector SGD** | Extensión de Chrome (Manifest V3) que, **solo con sesión activa en el SGD** y **solo leyendo** la página, captura el n.º de trámite y lo vincula a un proceso existente o a uno nuevo. Trabaja desde el **panel lateral** de Chrome. |
| **Portal LEGAL** | Web estática con dos perfiles: Gerencia (indicadores y consulta) y Responsable (tablero kanban de actividades, procesos, plantillas, trámites indexados). |
| **LEGAL-Prueba** | Un ejecutable (Go) que levanta todo en local: base de datos NoSQL embebida (bbolt), API para el Conector y el Portal, SGD simulado y Centro de pruebas. |
| **Despliegue** | Servidor Ubuntu 24.04 en Hetzner con Caddy (HTTPS, filtro de IP, contraseña) y GitHub Actions (CI/CD con vuelta atrás). |

**Fuera de alcance de la piloto:** escritura en el SGD, uso de la API interna del SGD, autenticación por persona, roles reales, datos reales en producción.

---

## 2. Arquitectura y componentes

```
┌──────────────── Navegador Chrome del usuario ─────────────────┐
│                                                               │
│  Pestaña SGD (sgd.sedapar.com.pe o /sgd-simulado/)            │
│     ▲ lectura DOM bajo demanda (chrome.scripting)             │
│     │  — sin clics, sin formularios, sin red —                │
│  Panel lateral «LEGAL · Conector SGD»                         │
│     │  chrome.storage.local  (modo local)                     │
│     │  fetch → Servidor LEGAL (modo servidor, opcional)       │
└─────┼─────────────────────────────────────────────────────────┘
      ▼
┌──────── Servidor LEGAL (LEGAL-Prueba, Go, :8790) ─────────────┐
│  /api/*         API (catálogo, vinculaciones, portal, estado) │
│  /portal/       Portal LEGAL (estático)                       │
│  /sgd-simulado/ SGD simulado (estático + rutas Angular)       │
│  /              Centro de pruebas                             │
│  bbolt: legal-prueba.db (portal, tramites, procesos_conector, │
│         meta)                                                 │
└───────────────────────────────────────────────────────────────┘
      ▲
      │  cada 8 s: GET /api/vinculaciones ; al guardar: PUT /api/portal
┌─────┴───── Portal LEGAL (en el navegador) ────────────────────┐
│  localStorage (modo navegador) o BD del servidor (modo        │
│  servidor)                                                    │
└───────────────────────────────────────────────────────────────┘
```

**Modos de funcionamiento** (todos deben seguir funcionando):

| Componente | Modo sin servidor | Modo con servidor |
|---|---|---|
| Conector | Catálogo referencial o importado; registros en `chrome.storage.local`; intercambio por archivo JSON. | Catálogo desde `GET /api/catalogo`; registro con `POST /api/vinculaciones` (el servidor valida). Si el servidor no responde, cae a modo local. |
| Portal | `portal/index.html` abierto como archivo; datos en `localStorage`. | Servido por LEGAL-Prueba; documento en la BD (`/api/portal`); incorpora capturas del Conector cada 8 s. |

---

## 3. Modelo de dominio

### 3.1 Entidades

| Entidad | Campos | Notas |
|---|---|---|
| **Categoría** | `codigo` (3 letras), `nombre`, `procedimientos[]` | Agrupa procedimientos. |
| **Procedimiento** | texto | Pertenece a **una** categoría. |
| **Responsable** | `codigo` (`R01`…), `nombre`, `cargo`, `iniciales` (portal) | Abogado a cargo del proceso. |
| **Gerente** | `nombre`, `iniciales`, `cargo` | Perfil de consulta. |
| **Proceso** | `codigo` `PL-AAAA-NNNN`, `denominacion`, `categoria`, `procedimiento`, `responsable` (código), `estado`, `prioridad`, `fechaInicio`, `fechaFin?`, `plantillaId`, `origen?` (`Plantilla` · `Conector SGD`) | |
| **Actividad** | `clave` `LEG-NNN`, `titulo`, `descripcion`, `procesoCodigo`, `fase`, `responsable`, `estado`, `prioridad`, `fechaLimite`, `checklist[{texto, hecho}]`, `comentarios[{autor, fecha, texto, sistema?}]` | Ficha del kanban, estilo Jira. |
| **Plantilla** | `id` `PLT-NN`, `nombre`, `categoria`, `procedimientos[]`, `descripcion`, `fases[{nombre, actividades[{titulo, plazoDias, checklist[]}]}]` | Modelo para generar procesos. |
| **Trámite SGD indexado** | ver §11.1 | Documento del SGD vinculado a un proceso (y opcionalmente a una actividad). |
| **Vinculación** | `modo` (`anexo` · `nuevo`), `procesoCodigo`, `procesoDenominacion`, `categoria`, `procedimiento`, `responsable`, `actividadClave?` | Va dentro del trámite. |

### 3.2 Estados y valores

- **Estados de proceso:** `Registrado` → `En trámite` → `En revisión` → `Suspendido` → `Finalizado`.
- **Estados de actividad (columnas del kanban):** `Pendiente`, `En ejecución`, `En revisión`, `Observada`, `Concluida`.
- **Prioridades:** `Alta`, `Media`, `Baja` (por defecto `Media`).
- **Vencimiento de actividad** (calculado, ver RN-30): `cumplida`, `vencida`, `proxima` (0–7 días), `vigente`.

### 3.3 Códigos

| Código | Formato | Regla |
|---|---|---|
| Proceso | `PL-AAAA-NNNN` | AAAA = año actual; NNNN = máximo correlativo existente con ese prefijo + 1, con 4 dígitos y ceros a la izquierda. El año nuevo reinicia en `0001`. |
| Actividad | `LEG-NNN` | Correlativo global `siguienteClave` (la semilla empieza en 101). |
| Trámite indexado | `TSGD-<base36 de Date.now()>` | Lo genera el Conector; los de ejemplo son `TSGD-EJ001`… |
| N.º de trámite SEDAPAR (canónico) | `AAAA-#####-S` | Ver §12.3. |

---

## 4. Datos de referencia (catálogo de la piloto)

Todos los datos son **ficticios**. El catálogo vive en `extension/shared/catalogo.js` (Conector) y `portal/js/datos.js` (Portal); el servidor genera `catalogo-semilla.json` a partir del primero al construir.

### 4.1 Categorías y procedimientos

| Código | Categoría | Procedimientos |
|---|---|---|
| CON | Contencioso Judicial | Proceso Contencioso Administrativo · Proceso Civil · Proceso Laboral · Proceso Constitucional de Amparo |
| ARB | Arbitraje y Controversias | Arbitraje de Derecho · Junta de Resolución de Disputas · Conciliación Extrajudicial |
| ADM | Procedimiento Administrativo | Procedimiento Administrativo Sancionador · Recurso Administrativo de Apelación · Procedimiento Administrativo Disciplinario |
| CNS | Asesoría Consultiva | Emisión de Opinión Legal · Revisión de Proyecto Normativo · Revisión de Contratos y Convenios |
| PEN | Defensa Penal Institucional | Denuncia Penal · Investigación Fiscal Preliminar |

### 4.2 Personas

| Código | Nombre | Cargo | Iniciales |
|---|---|---|---|
| R01 | Dra. María Fernanda Quispe Rojas | Coordinadora de Asuntos Contenciosos | MQ |
| R02 | Abg. Luis Alberto Paredes Vela | Especialista Legal en Arbitraje | LP |
| R03 | Abg. Carmen Rosa Huamán Díaz | Especialista en Derecho Administrativo | CH |
| R04 | Abg. Jorge Enrique Salazar Tello | Especialista en Contratación Pública | JS |
| R05 | Abg. Ana Lucía Torres Medina | Analista Legal Consultiva | AT |
| Gerente | Dr. Ricardo Alonso Benavides Cáceres | Gerente de Asesoría Jurídica | RB |

### 4.3 Plantillas de proceso (8)

| Id | Nombre | Categoría | Procedimientos que cubre | Fases |
|---|---|---|---|---|
| PLT-01 | Defensa en proceso judicial | Contencioso Judicial | Contencioso Administrativo, Civil, Laboral, Amparo | Calificación y contestación · Actuación probatoria y audiencias · Sentencia e impugnación · Ejecución y archivo |
| PLT-02 | Defensa arbitral | Arbitraje y Controversias | Arbitraje de Derecho, Junta de Resolución de Disputas | Instalación · Postulatoria · Audiencias y laudo |
| PLT-03 | Conciliación extrajudicial | Arbitraje y Controversias | Conciliación Extrajudicial | Evaluación · Audiencia |
| PLT-04 | Procedimiento sancionador o disciplinario | Procedimiento Administrativo | Sancionador, Disciplinario | Fase instructiva · Descargos · Fase sancionadora |
| PLT-05 | Atención de recurso de apelación | Procedimiento Administrativo | Recurso Administrativo de Apelación | Admisibilidad · Pronunciamiento |
| PLT-06 | Opinión legal y revisión normativa | Asesoría Consultiva | Emisión de Opinión Legal, Revisión de Proyecto Normativo | Análisis · Pronunciamiento |
| PLT-07 | Revisión de contratos y convenios | Asesoría Consultiva | Revisión de Contratos y Convenios | Revisión · Conformidad |
| PLT-08 | Defensa penal institucional | Defensa Penal Institucional | Denuncia Penal, Investigación Fiscal Preliminar | Formulación · Investigación |

Cada actividad de plantilla tiene `titulo`, `plazoDias` y una lista de verificación. Ejemplo (PLT-01, fase 1): «Registro y evaluación de la notificación judicial» (2 días: verificar plazo procesal, registrar expediente judicial, solicitar antecedentes al área usuaria); «Elaboración de la contestación de demanda» (8 días); «Presentación del escrito ante el juzgado» (1 día). El detalle completo de todas las plantillas está en `portal/js/datos.js` y debe copiarse tal cual.

**Regla de correspondencia:** cada procedimiento pertenece a exactamente una plantilla (`plantillaDe(procedimiento)`); si no hay, se usa la primera plantilla.

### 4.4 Procesos de ejemplo

17 procesos `PL-2026-0001` … `PL-2026-0017` repartidos entre las 5 categorías y los 5 responsables, con todos los estados representados. Son finalizados: `PL-2026-0003`, `0006`, `0015`, `0017`. El Portal además genera sus actividades a partir de la plantilla con un **generador pseudoaleatorio determinista** (semilla 7, `s = (s*9301+49297) % 233280`) y un `avance` por proceso, de modo que siempre haya actividades concluidas, vencidas, próximas y vigentes.

**RT-01 · Fechas relativas.** Los datos de ejemplo del Portal se calculan **relativos a la fecha de hoy** (`dia(offset)`), para que la demostración muestre siempre plazos vigentes, próximos y vencidos. El documento lleva `version: 2`; si la versión guardada no coincide, se regenera la semilla.

El Portal trae además 20 trámites SGD indexados de ejemplo, con enlace `https://sgd.institucion.gob.pe/sgd/expediente/detalle?nroExpediente=…&registro=…`.

---

## 5. Reglas de negocio

### 5.1 Conector SGD

| # | Regla |
|---|---|
| **RN-01** | **Solo con sesión activa en el SGD.** El ícono está deshabilitado en cualquier otra página. Chrome lo habilita por reglas declarativas (`declarativeContent`) cuando la URL empieza por un prefijo del SGD configurado **y** la página contiene un indicador de sesión (selector CSS). En modo `dominio`, basta la URL. |
| **RN-02** | **Doble verificación al abrir.** Al abrir el panel se vuelve a leer la página: debe existir un indicador de sesión y **no** debe verse un `input[type=password]` visible (formulario de ingreso). Si falla, el panel muestra «Sin sesión activa en el SGD» y **no muestra ningún formulario**. |
| **RN-03** | **Solo lectura.** El lector solo consulta el DOM (`querySelector`, `textContent`/`innerText`, `value`). No hace clic, no envía formularios, no modifica valores ni estilos, no hace peticiones de red al SGD. |
| **RN-04** | **Dos modos de vinculación:** **Anexar a proceso existente** o **Generar nuevo proceso**. |
| **RN-05** | **Anexar:** filtros en cascada **Categoría → Procedimiento → Responsable** + búsqueda por texto (código o denominación, sin tildes ni mayúsculas). La lista **excluye siempre los procesos `Finalizado`** y muestra cuántos se excluyeron. |
| **RN-06** | **Nuevo proceso:** obligatorios Categoría, Procedimiento (de esa categoría), Responsable y Denominación. Se asigna código `PL-AAAA-NNNN` y estado `Registrado`, `fechaInicio` = hoy, `origen` = `Conector SGD`. La denominación se prellena con los primeros 160 caracteres del asunto. |
| **RN-07** | **Asunto de la vinculación** («descripción de la actuación») es **obligatorio**. |
| **RN-08** | **Datos obligatorios del trámite:** n.º de expediente **o** n.º de registro; asunto del documento; enlace directo. |
| **RN-09** | **Duplicado:** si el mismo documento (mismo n.º de expediente o de registro **y** mismo n.º de documento) ya se indexó **en el mismo proceso**, se avisa con fecha y se exige pulsar «Registrar vinculación» otra vez para confirmar. Cualquier edición del formulario cancela la confirmación pendiente. |
| **RN-10** | **Aviso de trámite ya vinculado:** al leer un trámite, si su n.º ya está vinculado a uno o más procesos (en el servidor o en el índice local), el panel lo avisa con los códigos y permite anexarlo a otro proceso. En modo servidor, ofrece «Ver en el portal». |
| **RN-11** | **Enlace directo estable:** se guarda la URL de la página **sin identificadores de sesión** (`;jsessionid=` en la ruta y los parámetros `jsessionid, token, sid, sessionid, phpsessid, aspsessionid, csrf, _csrf`, sin distinguir mayúsculas). Si hay **plantilla de enlace permanente** configurada (variables `{nroExpediente}`, `{nroRegistro}`, `{url}`) y todas sus variables tienen valor, se usa la plantilla (valores con `encodeURIComponent`). Si el usuario edita el enlace a mano, ya no se recalcula. |
| **RN-12** | **Todos los campos leídos se pueden corregir** antes de registrar (salvo en el perfil SEDAPAR, ver RN-14). Si el usuario selecciona texto en el SGD, puede usarlo como asunto. |
| **RN-13** | **El panel sigue a la pestaña activa:** al cambiar de pestaña, de ventana o de URL se vuelve a leer (con espera de 350 ms para agrupar eventos). Al cambiar de trámite se limpian el asunto de vinculación, la denominación y los mensajes. |
| **RN-14** | **Perfil SEDAPAR** (host `sgd.sedapar.com.pe` o ruta `/sgd-simulado/`): solo actúa en `/tramites/detalletramite/{ID}`; en otras páginas pide abrir un trámite. Lee únicamente n.º de trámite, ID interno y fecha de ingreso. N.º de registro (= ID interno) y fecha son de solo lectura; el n.º de trámite es de solo lectura si se detectó. **El asunto lo redacta el usuario.** |
| **RN-15** | **Formato obligatorio SEDAPAR:** al registrar, el n.º de trámite debe cumplir la expresión de §12.3 y se guarda en forma canónica `AAAA-#####-S`. |
| **RN-16** | **Registro manual:** si el número es ambiguo (`AMBIGUOUS`) o no aparece en 10 s (`NO_NODE`), se pasa a registro manual con validación de formato y se explica el motivo. |
| **RN-17** | **Confidencialidad (riesgo R7):** si el trámite muestra el componente `tramites-detalle-tramite-confidential` **visible y con contenido**, no se lee ni registra nada y se remite al oficial de datos personales. |
| **RN-18** | **Sin SGD configurado:** el panel muestra «Configuración pendiente» y el botón de Configuración; al instalar, si no hay URL del SGD, se abre Configuración automáticamente. |

### 5.2 Servidor (validación autoritativa)

| # | Regla |
|---|---|
| **RN-20** | Anexar a un proceso **inexistente** → **404**. |
| **RN-21** | Anexar a un proceso **Finalizado** → **409** («no admite nuevas incorporaciones»). |
| **RN-22** | Datos obligatorios faltantes (expediente o registro, `asunto`, `enlaceSgd`, `asuntoVinculacion`) → **422** con la lista ordenada alfabéticamente. |
| **RN-23** | Nuevo proceso: sin denominación → 422; procedimiento que **no pertenece** a la categoría → 422; responsable inexistente → 422. |
| **RN-24** | **El servidor asigna el código correlativo** del proceso nuevo (ignora el que propone el Conector) y lo devuelve; el Conector adopta la respuesta. La asignación está serializada con un mutex. |
| **RN-25** | **Idempotencia:** si llega un trámite con un `id` ya registrado, se devuelve lo guardado con `duplicado: true` y **200**, sin volver a validar ni crear nada. |
| **RN-26** | El servidor reescribe en la vinculación los datos del proceso real (`procesoCodigo`, `procesoDenominacion`, `categoria`, `procedimiento`, `responsable`) y añade `registradoEnBd`. |

### 5.3 Portal

| # | Regla |
|---|---|
| **RN-30** | **Vencimiento:** actividad no concluida con `fechaLimite` < hoy → «Vencida hace N días» (⚠); = hoy → «Vence hoy» (◷); 1–7 días → «Vence en N días» (◷); > 7 → «Vence el …». Concluida → `cumplida`. **Nunca se indica solo con color**: siempre ícono + texto. |
| **RN-31** | Un proceso **Finalizado**: no admite actividades nuevas (solo se listan procesos en curso), sus actividades son de **solo consulta** (no se arrastran, no se editan, no se comenta, ficha con 🔒) y **no recibe trámites anexados**. |
| **RN-32** | **No se puede finalizar** un proceso con actividades abiertas (estado ≠ Concluida); se revierte la selección y se notifica cuántas hay. Al finalizar se registra `fechaFin` = hoy; al reabrir se borra. |
| **RN-33** | **Concluir una actividad con ítems pendientes** en la lista de verificación requiere confirmación explícita («Concluir actividad»). |
| **RN-34** | **Cambio de estado de actividad** (arrastrar en el kanban o selector) deja un comentario de sistema «Cambió el estado de «X» a «Y»» con autor y fecha. |
| **RN-35** | Si un proceso está `Registrado` y una de sus actividades pasa a un estado distinto de `Pendiente`, el proceso pasa automáticamente a `En trámite`. |
| **RN-36** | **Generar proceso desde plantilla:** código correlativo, estado `Registrado`, responsable = el del perfil activo, categoría fija de la plantilla, procedimiento elegido entre los de la plantilla, prioridad (Media por defecto), fecha de inicio (hoy por defecto). Se crean **todas** las actividades: la fecha límite de cada una es la anterior + `plazoDias` (acumulativo desde la fecha de inicio), estado `Pendiente`, prioridad del proceso, checklist sin marcar. Luego se abre el tablero filtrado por ese proceso. |
| **RN-37** | **Actividad adicional:** título obligatorio, proceso en curso, prioridad, fecha límite (hoy + 5 por defecto), checklist (un ítem por línea). Fase = «Actividad adicional»; responsable = el del proceso; comentario de sistema «Creó la actividad.». |
| **RN-38** | **Avance de un proceso** = ítems de checklist marcados / ítems totales de todas sus actividades (0 si no hay ítems). |
| **RN-39** | **Incorporación de capturas del Conector** (archivo o servidor), idempotente: (a) procesos nuevos del Conector cuyo código ya existe en el portal **con otra denominación** se **remapean** a un código nuevo (se recuerda en `remapeoConector`); si existe con la misma denominación, se omite; (b) cada proceso nuevo se crea `Registrado`, prioridad Media, con la plantilla de su procedimiento y todas sus actividades; (c) los trámites ya incorporados u omitidos se saltan; (d) un trámite cuyo proceso **no existe** o que se **anexa a un proceso Finalizado** se rechaza y se recuerda en `tramitesOmitidos`; (e) el trámite se asocia a la **primera actividad abierta** del proceso. |
| **RN-40** | **Alcance por perfil:** el Gerente ve todo; el Responsable ve solo sus procesos, sus actividades y los trámites de sus procesos. |
| **RN-41** | **Gerente = consulta:** no cambia estados ni edita actividades o procesos; **sí puede comentar** (en procesos no finalizados). |
| **RN-42** | Solo el Responsable **titular** del proceso puede cambiar su estado. |

---

## 6. Reglas de privacidad y seguridad

Marco: **Ley 29733** de Protección de Datos Personales (Perú) y su reglamento (DS 016-2024-JUS). «Dato personal» = identifica o hace identificable a una persona natural (art. 2).

| # | Regla |
|---|---|
| **RP-01** | **Lista cerrada de lectura en SEDAPAR:** n.º de trámite, ID interno de la URL, fecha de ingreso, indicio de confidencialidad. Nada más. |
| **RP-02** | **Prohibido leer:** tarjeta «DATOS DEL SOLICITANTE» (solicitante, dirección, email, celular), asunto, contenido, «con copia», adjuntos (ni sus nombres), nombres de servidores, menú lateral (`sidebar-cmp`, usuario en sesión), `localStorage`, `sessionStorage`, cookies, tokens del SGD. |
| **RP-03** | **Prohibido usar como selectores** los atributos `_ngcontent-*` / `_nghost-*` (cambian en cada compilación). |
| **RP-04** | **No usar la API interna del SGD** (`/Rest/...`): no llamarla, no interceptarla, no hacer monkey-patch de XHR/fetch. Solo leer el DOM ya renderizado. Usarla requiere autorización formal escrita de sistemas y un contrato de interfaz versionado. |
| **RP-05** | **Permisos mínimos de la extensión:** `storage`, `scripting`, `declarativeContent`, `sidePanel`. **No** pedir `cookies`, `webRequest`, `tabs`, `<all_urls>` ni `webNavigation`. Host fijos: SGD de SEDAPAR y `localhost/127.0.0.1:8790`. Otros dominios del SGD se piden como **permiso opcional** con gesto del usuario al guardar Configuración. |
| **RP-06** | **Sin código remoto:** todo el JS empaquetado; sin `eval`, sin CDN. |
| **RP-07** | Las peticiones del Conector van **solo al servidor LEGAL**, nunca al SGD ni a terceros. Salen desde las páginas de la extensión (no desde el contexto de la página del SGD, cuya CSP limita `connect-src` a `'self'` y `localhost`). |
| **RP-08** | **Viaja al servidor:** n.º de trámite canónico, fecha de ingreso, ID interno, asunto **redactado por el usuario**, descripción de la actuación, enlace depurado, usuario LEGAL configurado. **No viaja:** HTML, capturas, datos del solicitante, cookies, tokens. |
| **RP-09** | **Escape de HTML** en todo lo que se pinta (`&<>"'`) en panel y portal. |
| **RP-10** | **CORS del servidor:** solo responde con `Access-Control-Allow-Origin` a orígenes `chrome-extension://…`; métodos `GET, POST, PUT, OPTIONS`; `OPTIONS` → 204. |
| **RP-11** | Servidor local escucha **solo en 127.0.0.1**. `Cache-Control: no-store` en todo. Límite de cuerpo 8 MB. |
| **RP-12** | `/api/reiniciar` exige `POST` con `Content-Type: application/json` (protección CSRF básica) y está **bloqueado** en el servidor desplegado. |
| **RP-13** | **Datos de prueba ficticios** siempre; ningún documento ni nota debe contener datos reales del SGD. |
| **RP-14** | Antes de cargar datos reales: visto bueno del oficial de datos personales (banco de datos que relaciona trámites con procesos, R11; flujo transfronterizo si el servidor está fuera del Perú). |

---

## 7. Componente 1 · Conector SGD (extensión de Chrome)

### 7.1 Manifest (MV3)

- `name`: «LEGAL · Conector SGD», `short_name`: «LEGAL SGD», `version`: `0.3.0`, `minimum_chrome_version`: `116`.
- `permissions`: `storage`, `scripting`, `declarativeContent`, `sidePanel`.
- `host_permissions`: `https://sgd.sedapar.com.pe/*`, `http://localhost:8790/*`, `http://127.0.0.1:8790/*`.
- `optional_host_permissions`: `https://*/*`, `http://*/*`.
- `background.service_worker`: `background.js`.
- `action` con título «…abre el panel lateral (requiere sesión activa en el SGD)» e íconos 16/32/48/128.
- `side_panel.default_path`: `panel/panel.html`; `options_page`: `options/options.html`.

### 7.2 Service worker (`background.js`)

1. Importa `shared/entorno.js`, `shared/catalogo.js`, `shared/almacen.js`.
2. `actualizarReglasDeActivacion()`: deshabilita el ícono (`chrome.action.disable()`), borra reglas y crea una regla `ShowAction` con un `PageStateMatcher` por cada combinación (prefijo URL × selector de sesión), o solo por prefijo en modo `dominio`.
3. Se ejecuta en `onInstalled`, `onStartup` y cuando cambia la clave de configuración en `chrome.storage.local`.
4. `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
5. En `onInstalled`, si no hay URL del SGD, abre Configuración.

> Los selectores para `declarativeContent` deben ser **simples** (sin combinadores ` `, `>`, `~`, `+`); Configuración lo valida.

### 7.3 Entorno (`shared/entorno.js`)

```js
self.LEGAL_ENTORNO = { urlsSgd: ['https://sgd.sedapar.com.pe/'] };
```

Las URL del entorno **siempre se conservan** (se unen a las configuradas). LEGAL-Prueba reemplaza este archivo en su copia de la extensión con:

```js
{ urlsSgd: ['http://localhost:8790/sgd-simulado/', 'https://sgd.sedapar.com.pe/'],
  servidorLegal: 'http://localhost:8790', usuarioLegal: 'usuario.prueba', modoActivacion: 'indicador' }
```

### 7.4 Configuración (`options/`) y valores por defecto

| Campo | Defecto | Validación |
|---|---|---|
| `urlsSgd` (una por línea) | `[]` + entorno | Debe ser URL `http(s)`. Al guardar se pide permiso de lectura sobre `origin/*` (necesario para iframes). Si se niega, se avisa que solo se leerá el marco principal. |
| `modoActivacion` | `indicador` | `indicador` · `dominio` |
| `selectoresSesion` | `app-layout`, `sidebar-cmp`, `a[href*='/pages/login/exit']`, `a[href*='logout']`, `a[href*='Logout']`, `a[href*='logoff']`, `a[href*='salir']`, `a[href*='Salir']`, `a[href*='cerrarSesion']`, `a[href*='CerrarSesion']`, `[onclick*='logout']`, `[onclick*='salir']`, `[onclick*='cerrarSesion']` | Selector válido y sin combinadores (se ignoran los corchetes al comprobar). |
| `textosSesion` | `Cerrar sesión`, `Cerrar Sesión`, `Salir del sistema`, `Salir`, `Logout` | — |
| `plantillaEnlace` | `''` | Variables `{nroExpediente}`, `{nroRegistro}`, `{url}` |
| `parametrosSensibles` (coma) | `jsessionid, token, sid, sessionid, phpsessid, aspsessionid, csrf, _csrf` | — |
| `usuarioLegal` | `''` | Solo trazabilidad |
| `servidorLegal` | `''` | Se quita la barra final. Botón **Probar conexión** → `GET /api/estado` y muestra «Conectado: {nombre} · N trámite(s)…». |

Acciones adicionales: **Importar catálogo (JSON)** `{categorias, responsables, procesos}` (o `{catalogo:{…}}`); **Restablecer catálogo referencial**; **Exportar para LEGAL** (paquete de intercambio); **Eliminar registros locales** (con confirmación; no afecta al SGD). Resumen: origen del catálogo y conteos.

### 7.5 Almacenamiento local (`shared/almacen.js`)

| Clave `chrome.storage.local` | Contenido |
|---|---|
| `legal.configuracion` | Configuración guardada |
| `legal.catalogo` | Catálogo importado (si no hay, se usa el referencial) |
| `legal.procesosRegistrados` | Procesos creados desde el Conector en modo local |
| `legal.tramitesIndexados` | Trámites indexados (más reciente primero) |

El catálogo efectivo = base (importado o referencial) + procesos creados localmente.

### 7.6 Lector genérico (`shared/lector.js` → `leerPaginaSgd`)

Función **autocontenida** (se serializa con `chrome.scripting.executeScript`), se inyecta en **todos los marcos** (`allFrames: true`); si falla por permisos, solo en el principal. Prioridad: marco principal; los demás completan lo faltante.

1. **Normalización de etiquetas:** minúsculas, sin tildes, `N°/Nº/nro/no/num/numero` → `nro`, sin signos, espacios simples.
2. **Sinónimos por campo** (`ETIQUETAS`): `nroExpediente`, `nroRegistro` (registro, trámite, CUT, hoja de ruta…), `tipoDocumento`, `nroDocumento`, `asunto` (asunto, sumilla, referencia, motivo), `remitente`, `dependencia`, `destinatario`, `fechaDocumento`, `estadoSgd`.
3. **Estrategias**, en orden, sin sobrescribir lo ya hallado:
   - a) Etiqueta independiente (≤ 40 caracteres) → valor contiguo: `label[for]`, `dt→dd`, `th/td→siguiente`, encabezado de columna **solo si la tabla tiene una única fila**, hermano siguiente o hermano del padre.
   - b) Texto en línea «Etiqueta: valor» (dos puntos en posición ≤ 35, elemento sin hijos).
   - c) Controles (`input` no oculto ni password, `textarea`, `select`) cuyo `id`/`name` contiene una clave (`CLAVES_CAMPO`).
   - d) Patrón de último recurso para el expediente: `/expediente\s*(?:n\s*[°º.]*|nro\.?|n[uú]mero)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{3,40})/i` (debe contener un dígito).
4. Límites: valores de hasta 1000 caracteres; se revisan como máximo 6000 elementos; textos > 400 se ignoran; un valor que es a su vez una etiqueta se descarta.
5. **Sesión:** primer selector de sesión presente o primer elemento accionable cuyo texto normalizado coincide con `textosSesion`; `formularioIngreso` = hay `input[type=password]` visible.
6. Usuario SGD (solo perfil genérico): primer nodo con `id/class` *usuario/username/user-name* con texto de 3–80 caracteres.
7. Devuelve `{esPrincipal, url, titulo, datos, fuentes, sesion:{indicador, formularioIngreso, usuarioSgd}, seleccion}`.

### 7.7 Lector SEDAPAR (`shared/lector-sedapar.js` → `leerPaginaSedapar`)

Asíncrono y autocontenido; solo marco principal.

1. Si la ruta es `/pages/login…` → `motivo: 'SIN_SESION'`.
2. Si no es `/tramites/detalletramite/{ID}` → espera hasta 3 s un indicador de sesión y devuelve `motivo: 'NO_DETALLE'`.
3. En detalle: espera con **MutationObserver** sobre `app-root` (`childList`, `subtree`, `characterData`), **tope 10 s**, hasta que `extraer()` devuelva algo.
4. `extraer()` — estrategias y regla de consenso (ver §12.2):
   - **P**: `app-detalletramite legend.title .col-sm-5 > strong`
   - **R1**: primer `legend` cuyo texto (sin tildes, mayúsculas) empieza por `DATOS DEL EXPEDIENTE` → su primer `strong`.
   - **R2**: primera `.card` cuyo `legend` contiene `EXPEDIENTE` y no `ASOCIADOS` ni `MOVIMIENTO`; regex global sobre su texto; **exactamente una** coincidencia (más de una = ambiguo).
   - Consenso: P y R1 distintos → `AMBIGUOUS`; si no, P ‖ R1; si no, R2 (ambiguo → `AMBIGUOUS`); si nada → aún no renderizado.
   - **Fecha de ingreso:** `.card` con `legend` ⊃ `MOVIMIENTO` → `tbody tr:last-child > td:first-child`, debe cumplir `^\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}$`.
   - **Confidencial:** `tramites-detalle-tramite-confidential` visible y con texto.
5. Indicador de sesión: fuera de login, presencia de `app-layout`, `sidebar-cmp` o `a[href*='/pages/login/exit']`.
6. La sesión se evalúa **después** de la espera (pudo redirigir al login).
7. URL devuelta: `origin + pathname` (sin query). Devuelve además `idInterno`, `numero`, `motivo` (`NO_NODE` si venció el tope), `estrategias {P,R1,R2}`, `fechaIngreso`, `confidencial`, `msDeteccion`.

En el panel: `nroExpediente` ← número; `nroRegistro` ← ID interno; `fechaDocumento` ← fecha de ingreso. El resumen muestra las estrategias que acertaron y el tiempo de detección.

### 7.8 Panel lateral (`panel/`) — flujo

```
actualizar()
 ├─ verificarSesion()
 │   ├─ ¿hay urlsSgd? no → «Configuración pendiente»
 │   ├─ ¿pestaña activa empieza por un prefijo SGD? no → «La pestaña activa no corresponde al SGD»
 │   ├─ perfil = sedapar | generico
 │   ├─ leerPestana() (error → «No fue posible leer…»)
 │   ├─ sin indicador o con formulario de ingreso → «Sin sesión activa»
 │   ├─ sedapar y no detalle → «Abra el detalle de un trámite»
 │   └─ sedapar y confidencial → aviso y fin
 ├─ cargarCatalogo()  (servidor → si falla, local; pinta estado de conexión)
 ├─ si cambió (url|nroExpediente) o se forzó: volcarLectura(), cambiarModo(), consultarRegistro()
 └─ pintarIndexados()
```

- Un contador `ejecucion` descarta actualizaciones superadas por otra más reciente.
- Pestañas del panel: **Registrar** y **Indexados** (con contador).
- **Indexados:** filtro por texto; cada ítem muestra expediente/registro, fecha, asunto, «Generó/Anexado a» + proceso, actuación y acciones **Abrir en el SGD**, **Copiar enlace**, **Quitar del índice** (con confirmación; no afecta al SGD). Botón **Exportar para LEGAL**.
- **Registro:** valida (RN-07, RN-08, RN-15, campos del modo), arma el proceso (nuevo o seleccionado; si está finalizado, error), comprueba duplicado (RN-09), construye el trámite (§11.1). Con servidor conectado: `POST /api/vinculaciones` (tope 5 s, botón deshabilitado mientras tanto); usa el trámite y el proceso devueltos; ante error muestra el mensaje del servidor o «no respondió a tiempo» y **no** guarda. Sin servidor: guarda el proceso nuevo localmente. En ambos casos el trámite se guarda también en el índice local. Luego recarga catálogo, limpia campos y muestra éxito.
- Tiempo de espera de las peticiones de lectura al servidor: 2,5 s.

### 7.9 Cliente del servidor (`shared/servidor.js`)

`LegalServidor.{configurado, estado, catalogo, consultarTramite(numero), registrarVinculacion(datos)}`; `Content-Type: application/json`; `AbortController` con tope; si `!res.ok`, lanza `Error(cuerpo.mensaje)` con `error.estado`.

---

## 8. Componente 2 · Servidor LEGAL-Prueba y API

### 8.1 Ejecutable

- Go (módulo `github.com/lockus-code/one-legal/servidor`, `go 1.24.7`), dependencias `go.etcd.io/bbolt v1.3.11` y `fyne.io/systray v1.11.0`. Versión inyectada con `-X main.version`.
- **Puerto fijo 8790**, escucha en `127.0.0.1`. Si el puerto está ocupado, asume que ya hay una instancia: solo abre el Centro de pruebas y termina.
- Banderas: `-sin-bandeja` (sin ícono; termina con SIGINT/SIGTERM), `-no-abrir` (no abre el navegador), `-datos <carpeta>`.
- Carpeta de datos: `%LOCALAPPDATA%\LEGAL-Prueba` (Windows) o `UserConfigDir/LEGAL-Prueba`. Contiene `legal-prueba.db`, `registro.log` y `extension-conector-sgd/`.
- Al iniciar: crea la BD si no existe, lee `catalogo-semilla.json` embebido, **copia la extensión embebida** y reescribe su `shared/entorno.js` (§7.3), levanta HTTP (`ReadHeaderTimeout` 10 s), abre el navegador y muestra el ícono de bandeja.
- **Bandeja del sistema:** «LEGAL · Entorno de prueba activo» (deshabilitado), Abrir Centro de pruebas, Abrir Portal LEGAL, Abrir SGD simulado, Abrir carpeta de la extensión, Abrir carpeta de datos, **Detener y salir** (apagado ordenado en 3 s y cierre de la BD).
- Windows: compilado con `-H=windowsgui` (sin consola), ícono por recurso `.syso`, errores fatales con `MessageBoxW`. Linux/macOS: `xdg-open` / `open`.
- Todo el contenido web va **embebido** (`//go:embed all:web`): `portal/`, `sgd-simulado/`, `extension/`, `centro/`, `catalogo-semilla.json`.

### 8.2 Base de datos (bbolt)

Archivo único, permisos `0600`, timeout de apertura 2 s.

| Colección (bucket) | Clave | Valor |
|---|---|---|
| `portal` | `datos` | Documento completo del portal (JSON) |
| `tramites` | `id` del trámite | Trámite indexado por el Conector |
| `procesos_conector` | código del proceso | Proceso generado desde el Conector |
| `meta` | `creada_en` | Fecha RFC 3339 de creación |

`Reiniciar()` borra y recrea todas las colecciones.

**Catálogo actual** = categorías y responsables de la semilla + procesos del documento del portal (si existe y tiene procesos; si no, los de la semilla) + procesos del Conector cuyo código no esté ya.

### 8.3 Rutas

| Método · Ruta | Función | Respuestas |
|---|---|---|
| `GET /api/estado` | Salud y metadatos | 200 `{servicio:"legal-prueba", nombre:"LEGAL · Entorno de prueba", version, iniciadoEn, bd:{motor, ruta, creadaEn, tramites, procesosConector, portalInicializado}, extension:{ruta}, urls:{centro, portal, sgdSimulado}}` |
| `GET /api/catalogo` | Catálogo para el Conector | 200 `{servidor, categorias, responsables, procesos}`; otro método 405 |
| `GET /api/vinculaciones` | Paquete de intercambio con todo lo del Conector (trámites ordenados por `fechaCaptura` desc.) | 200 formato §11.2 |
| `POST /api/vinculaciones` | Registrar vinculación `{tramite, procesoNuevo}` | 201 `{tramite, proceso}` · 200 `{…, duplicado:true}` · 400 (JSON inválido / sin `tramite` / sin `id`) · 404 · 409 · 422 · 500 |
| `GET /api/tramites-sgd?numero=…` | ¿El n.º ya está vinculado? (compara `nroExpediente` exacto) | 200 `{numero, registrado, vinculaciones:[{procesoCodigo, procesoDenominacion, modo, fechaCaptura}]}` · 400 sin número |
| `GET /api/portal` | Documento del portal | 200 JSON · 404 «El portal aún no tiene datos.» |
| `PUT /api/portal` | Guardar documento del portal | 200 `{guardado:true}` · 400 si > 8 MB o JSON inválido |
| `POST /api/reiniciar` | Vaciar la BD (exige `Content-Type: application/json`) | 200 `{reiniciada:true}` · 405 |
| `/portal/` | Portal estático | |
| `/sgd-simulado/` | SGD simulado con rutas Angular (§10) | |
| `/` | Centro de pruebas | |

Errores: siempre `{"mensaje": "…"}` en español. Errores internos: se registran en el log y se responde 500 «Error interno del servidor de prueba.».

### 8.4 Centro de pruebas (`servidor/centro/index.html`)

Página con: pasos para instalar la extensión (copiar `chrome://extensions` y la ruta de la carpeta), abrir el SGD simulado, capturar y revisar; tarjeta de la BD (motor, archivo, fecha de creación, estado del portal, contadores); tabla de últimas vinculaciones; botón **Reiniciar BD** con confirmación dentro de la página; tema claro/oscuro.

### 8.5 Pruebas automatizadas (`servidor/api_test.go`)

| Prueba | Verifica |
|---|---|
| `TestAnexarAProcesoEnCurso` | Anexar a proceso en curso → 201 |
| `TestNoSeAnexaAProcesoFinalizado` | → 409 |
| `TestGenerarProcesoAsignaCodigoCorrelativo` | Código correlativo asignado por el servidor |
| `TestValidaciones` | 400/404/422 |
| `TestCorsSoloParaLaExtension` | CORS solo para `chrome-extension://` |
| `TestPortalGuardaDocumento` | PUT/GET del portal |
| `TestConsultaTramiteRegistrado` | `/api/tramites-sgd` |
| `TestRutasDelSgdSimulado` | Mapeo de rutas del simulador |

---

## 9. Componente 3 · Portal LEGAL

### 9.1 Generalidades

- HTML/CSS/JS **sin dependencias ni compilación** (`portal/index.html`, `css/estilos.css`, `js/datos.js`, `js/app.js`). Router por `#hash`.
- Persistencia: `localStorage` claves `legal.portal.datos` (documento) y `legal.portal.perfil` (`{rol, responsable}`; por defecto `gerente`/`R01`). Lecturas y escrituras protegidas con `try/catch`.
- **Modo servidor:** si la página se sirve por http(s) y `GET /api/estado` devuelve `servicio === 'legal-prueba'`: carga `GET /api/portal` (si la versión no coincide o no existe, sube la semilla), sincroniza el Conector al iniciar y **cada 8 s**; cada `guardar()` escribe en `localStorage` y sube a `PUT /api/portal` con **debounce de 400 ms**. Indicador «● BD de prueba conectada · hh:mm:ss» / «○ BD de prueba sin conexión»; sin servidor: «Datos guardados en este navegador».
- **Confirmaciones dentro de la página** (no `confirm()` nativo), con foco en el botón de aceptar, Escape cancela y el foco vuelve al elemento previo. Notificaciones tipo *toast* de 3,8 s.
- **Restablecer datos de ejemplo** (con confirmación). En modo servidor, después vuelve a incorporar las capturas del Conector.
- Accesibilidad: fichas del kanban con `role=button`, `tabindex=0`, Enter/Espacio abren; tooltips de gráficos con ratón y teclado; menú lateral plegable en móvil; estados de vencimiento con ícono + texto.

### 9.2 Perfiles y menú

Selector **Perfil de acceso**: «Gerencia» (el gerente) o cualquiera de los 5 responsables. Al cambiar se limpian filtros y se va a la primera vista del rol. Rutas no permitidas para el rol redirigen a la primera permitida.

| Rol | Menú (con contadores) |
|---|---|
| Gerente | **Gerencia:** Panel institucional · Cartera de procesos (en curso) · Trámites SGD indexados (todos) |
| Responsable | **Mi gestión:** Mi panel · Tablero de actividades (abiertas) · Mis procesos (en curso) · **Recursos:** Plantillas de procesos · Trámites SGD indexados (de sus procesos) |

### 9.3 Vistas

**Panel institucional (Gerente)** — filtro por categoría:
- KPI: procesos en curso; finalizados en el año (`fechaFin` del año actual); actividades vencidas (con «N vencen en los próximos 7 días»; tarjeta crítica si > 0); cumplimiento de plazos = `1 − vencidas/abiertas` (1 si no hay abiertas); trámites SGD de los últimos 30 días.
- Gráficos: procesos por categoría, procesos por estado, trámites SGD indexados por semana (8 semanas).
- **Alertas de plazo:** vencidas + próximas, ordenadas por fecha límite, máximo 8.
- **Carga de trabajo por responsable:** procesos, actividades abiertas, vencidas (⚠), avance de listas de verificación.

**Cartera de procesos / Mis procesos** — filtros (texto, categoría, estado, …); columnas con código, denominación, procedimiento, responsable, estado, avance, actividades abiertas/total con ⚠ vencidas, trámites. Clic → modal del proceso.

**Mi panel (Responsable)** — KPI propios (procesos en curso, actividades abiertas, vencidas, «Vencen en 7 días»), prioridades por fecha límite, últimos trámites SGD y avance por proceso.

**Tablero de actividades (kanban)** — 5 columnas por estado; fichas ordenadas por fecha límite; filtros texto/proceso/prioridad/«Solo vencidas»; botón **+ Nueva actividad**; arrastrar y soltar entre columnas (aplica RN-31, RN-33, RN-34, RN-35). La ficha muestra título, proceso, clave, prioridad, ☑ hechos/total, 📄 trámites vinculados, 🔒 si el proceso está finalizado y el vencimiento.

**Modal de actividad** — título editable; descripción; lista de verificación con barra de progreso, marcar, quitar y agregar ítems; trámites SGD vinculados a la actividad y «Otros trámites del proceso»; bitácora y comentarios; panel lateral con estado, prioridad, fecha límite (con chip de vencimiento), responsable, proceso (enlace), fase y procedimiento. Editable solo si el proceso no está finalizado y el perfil no es Gerente.

**Modal de proceso** — datos del proceso, actividades, trámites, fechas de inicio/fin, plantilla, origen; selector de estado solo para el responsable titular (RN-32, RN-42); aviso 🔒 si está finalizado.

**Plantillas de procesos (Responsable)** — tarjeta por plantilla: id, nombre, descripción, categoría, n.º de fases, de actividades, **plazo referencial** (suma de `plazoDias`), procesos generados, procedimientos, detalle desplegable de fases y actividades, botón **Generar proceso** (RN-36).

**Trámites SGD indexados** — filtros texto (expediente, registro, documento, asunto, remitente), proceso y tipo de vinculación (Generó / Anexado); tabla: expediente/registro, documento (tipo, n.º, remitente, fecha), asunto + actuación, proceso vinculado (con estado), actividad, fecha de indexación y **ruta en el SGD** (botón **Abrir ↗** y copiar). Botones **Importar desde Conector SGD** (valida `formato === 'legal-sgd-intercambio'`) y **Exportar catálogo para el Conector** (modal con el JSON, copiar o descargar `legal-catalogo-procesos-AAAA-MM-DD.json`).

**Fechas:** las del SGD pueden venir en `dd/mm/aaaa`; se muestran tal cual. Las ISO se formatean `es-PE`.

---

## 10. Componente 4 · SGD simulado

Carpeta `pruebas/sgd-simulado/` (servida en `/sgd-simulado/`). Imita la **estructura** del SGD de SEDAPAR (Angular): `app-root > app-layout > .wrapper > .sidebar > sidebar-cmp` + `.main-panel > {componente}`.

| Ruta | Página |
|---|---|
| `/sgd-simulado/` y `/pages/login` | `login.html` — acepta **cualquier** usuario y contraseña; guarda la sesión en `sessionStorage` (`sgd.sesion`) |
| `/tramites/mistramites` | `mistramites.html` — bandeja con enlaces «Ingresar al Trámite» |
| `/tramites/detalletramite/{ID}` | `detalletramite.html` — pinta el trámite tras ~1 s (imita `getTramite`), con trámites asociados y componente de confidencialidad |
| `/pages/login/exit` | `salir.html` — cierra la sesión |

Sin sesión, las páginas internas redirigen al login (y el Conector no se habilita).

**Trámites ficticios** (`datos.js`):

| ID interno | N.º | Caso de prueba |
|---|---|---|
| 250101 | `2026 - 01234 - 3` | Caso base (grupo 3 de 1 dígito) |
| 250102 | `2026 - 00871 - 12` | Grupo 3 de 2 dígitos **con trámites asociados** del mismo correlativo (R2 no debe confundirse) |
| 250103 | `2025 - 04410 - 1` | Año anterior |
| 250104 | `2026 - 01301 - 1` | **Confidencial** → el Conector no lee nada |
| 250105 | `2026 - 01322 - 2` | Adenda de contrato |

En modo manual también puede servirse la raíz con `python3 -m http.server 8765` y configurar `http://localhost:8765/pruebas/sgd-simulado/`.

---

## 11. Formatos de intercambio (JSON)

### 11.1 Trámite indexado

```json
{
  "id": "TSGD-LZ8K3Q1A",
  "nroExpediente": "2026-01234-3",
  "nroRegistro": "250101",
  "tipoDocumento": "", "nroDocumento": "",
  "asunto": "Redactado por el usuario",
  "remitente": "", "dependencia": "",
  "fechaDocumento": "10/10/2026 09:14:22",
  "estadoSgd": "",
  "enlaceSgd": "https://sgd.sedapar.com.pe/tramites/detalletramite/250101",
  "tituloPagina": null,
  "vinculacion": {
    "modo": "anexo",
    "procesoCodigo": "PL-2026-0004",
    "procesoDenominacion": "…", "categoria": "…", "procedimiento": "…", "responsable": "R02",
    "actividadClave": "LEG-123"
  },
  "asuntoVinculacion": "Descripción de la actuación",
  "usuarioSgd": null,
  "usuarioLegal": "usuario.prueba",
  "fechaCaptura": "2026-10-16T14:05:00.000Z",
  "registradoEnBd": "2026-10-16T09:05:00-05:00"
}
```

`tituloPagina` es `null` en el perfil SEDAPAR. `actividadClave` lo añade el Portal al incorporar; `registradoEnBd` lo añade el servidor.

### 11.2 Paquete Conector → Portal (`legal-sgd-intercambio`, versión 1)

Archivo `legal-sgd-intercambio-AAAA-MM-DD.json` o respuesta de `GET /api/vinculaciones`:

```json
{
  "formato": "legal-sgd-intercambio",
  "version": 1,
  "generadoEn": "ISO-8601",
  "generadoPor": "usuarioLegal | null",
  "procesosRegistrados": [ { "codigo": "PL-2026-0018", "denominacion": "…", "categoria": "…", "procedimiento": "…", "responsable": "R01", "estado": "Registrado", "fechaInicio": "2026-10-16", "origen": "Conector SGD" } ],
  "tramitesIndexados": [ /* §11.1 */ ]
}
```

### 11.3 Catálogo Portal → Conector

Archivo `legal-catalogo-procesos-AAAA-MM-DD.json`:

```json
{
  "categorias":   [ { "codigo": "CON", "nombre": "…", "procedimientos": ["…"] } ],
  "responsables": [ { "codigo": "R01", "nombre": "…", "cargo": "…" } ],
  "procesos":     [ { "codigo": "…", "denominacion": "…", "categoria": "…", "procedimiento": "…", "responsable": "R01", "estado": "…", "fechaInicio": "…" } ]
}
```

### 11.4 Solicitud `POST /api/vinculaciones`

```json
{ "tramite": { /* §11.1 sin registradoEnBd */ }, "procesoNuevo": { /* Proceso */ } | null }
```

---

## 12. Reconocimiento del SGD de SEDAPAR (resumen operativo)

Detalle completo en `docs/11-reconocimiento-sgd.md` (2026-10-09). **Se hizo sin clics, sin formularios, sin llamar a `/Rest/…` y sin leer valores de cookies ni de almacenamiento web.**

### 12.1 Tecnología

- SPA **Angular 2+** (HTML inicial vacío; todo se pinta tras XHR), Bootstrap 3 tipo *Light Bootstrap Dashboard*, Font Awesome 4, jQuery 3.6 por CDN.
- **Sin iframes**, sin WebForms. Muchos `<form method="get">` manejados por Angular: **ignorarlos**.
- Carga asíncrona medida: `getTramite` ≈ 1,05 s; `getTramitesAsociados` ≈ 1,65 s → `document_idle` **no basta**; MutationObserver con tope de 10 s.
- **CSP:** `connect-src 'self' http://localhost:* http://127.0.0.1:*`; `frame-ancestors 'self'`; `X-Frame-Options: SAMEORIGIN` → la llamada al servidor sale de la extensión (no de la página) y si se pinta algo sobre la página, con **Shadow DOM**, nunca iframe.
- Sesión: cookies no accesibles a JS; `KeepAlive` 2 veces por carga; al expirar redirige a `/pages/login`.

### 12.2 Páginas

| Página | URL | Componente |
|---|---|---|
| Detalle | `/tramites/detalletramite/{ID_INTERNO}` (6 dígitos, **no** es el n.º de trámite) | `app-detalletramite` |
| Bandeja | `/tramites/mistramites` | `app-mistramites` (`table.scroll-table`, 20 filas) |
| Búsqueda | `/tramites/listadotramites` | `app-listadotramites` |
| Salida | `/pages/login/exit` | **No tocar**: cierra sesión |

Ruta DOM del número: `app-detalletramite … div.card > div.header > legend.title > div.row > div.col-sm-5 > strong` (nodo de texto). Al lado hay un ícono PDF clicable: **no hacer clic**.

### 12.3 Número de trámite

- Forma visible: `AAAA - ##### - S` (año, correlativo de 5 dígitos con ceros, subnúmero de 1–2 dígitos sin relleno). **La clave única es la terna completa.**
- Expresión regular (tolerante a espacios especiales y guiones Unicode):

```js
const RE_TRAMITE = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;
// Canónica: `${anio}-${serie.padStart(5,'0')}-${parseInt(sub,10)}`  → AAAA-#####-S
// Antes de aplicar, reemplazar espacios no separables / finos por espacio normal.
```

- Casos límite: sin espacios → igual; en dash → igual; sin ceros → se rellena; año anterior → válido (no fijar el año); subnúmero de 3 dígitos → admitido; expediente judicial `#####-2026-0-####-JR-LA-##` → **sin coincidencia**; dos números en la tarjeta → **ambiguo**.

### 12.4 Riesgos documentados

R1 fragilidad de selectores · R2 nuevas versiones del SGD · R3 carga lenta · R4 CSP · R5 sesión expirada · R6 datos personales en pantalla · **R7 trámites confidenciales** · R8 ambigüedad del número · R9 «Fecha Leído» podría marcarse al visitar · R10 dependencias de terceros · **R11 nuevo banco de datos** (trámites ↔ procesos). Mitigaciones en el documento 11, §7.

### 12.5 Criterio de aceptación de detección

En 10 trámites variados (subnúmero de 1 y 2 dígitos, año anterior, con asociados, > 10 movimientos, interno/externo, confidencial, desde la bandeja y por URL directa/F5): **≥ 9/10 detecciones correctas y 0 falsos positivos**. Fragmento de consola de verificación en el documento 11, §9 (no imprime datos reales: enmascara dígitos y da una huella).

---

## 13. Construcción, pruebas y ejecución local

### 13.1 Requisitos

- Go **1.22+** (el `go.mod` declara 1.24.7), Node.js (solo para generar `catalogo-semilla.json`), Chrome ≥ 116.

### 13.2 Construir

```bash
servidor/construir.sh        # VERSION=0.3.0 por defecto
```

El script: limpia y arma `servidor/web/` (copias de `portal/`, `pruebas/sgd-simulado/`, `extension/`, `servidor/centro/`), genera `web/catalogo-semilla.json` desde `extension/shared/catalogo.js`, crea el ícono Windows con `go-winres@v0.3.3` si falta, ejecuta `go vet ./...` y `go test ./...`, y compila:

- `servidor/dist/LEGAL-Prueba.exe` (Windows amd64, sin consola, `CGO_ENABLED=0`, `-trimpath -s -w`)
- `servidor/dist/legal-prueba-linux` (Linux amd64)

`servidor/.gitignore` excluye `web/` y `dist/`.

### 13.3 Ejecutar en local

- Windows: doble clic en `LEGAL-Prueba.exe` → Centro de pruebas en `http://localhost:8790`.
- Linux/macOS: `./legal-prueba-linux -sin-bandeja -datos ./datos-prueba`.
- Instalar la extensión: `chrome://extensions` → Modo de desarrollador → **Cargar descomprimida** → carpeta `extension-conector-sgd` que indica el Centro de pruebas (o `extension/` del repositorio para el modo sin servidor).
- Prueba completa: SGD simulado → iniciar sesión → Mis Trámites → Ingresar → ícono **LEGAL** → redactar asunto → anexar o generar → **Registrar vinculación** → ver en el Centro y en el Portal (≤ 8 s).

### 13.4 Prueba de reglas mínima (manual)

1. En otra web, el ícono está deshabilitado. 2. En el login del simulador, deshabilitado. 3. Con sesión en la bandeja, el panel pide abrir un trámite. 4. 250101: número leído, ID y fecha de solo lectura. 5. 250102: no confunde asociados. 6. 250104: aviso de confidencialidad, sin formulario. 7. Anexar a un finalizado: no aparece en la lista (y el servidor respondería 409). 8. Registrar dos veces el mismo documento en el mismo proceso: pide confirmación. 9. Generar nuevo: el código lo asigna el servidor. 10. Detener el servidor: el panel informa modo local y sigue funcionando.

---

## 14. Despliegue en servidor (Hetzner)

Instructivo completo: `docs/12-despliegue-hetzner.md`. Resumen:

- **Servidor:** Ubuntu 24.04, el más pequeño de Shared vCPU x86, IPv4+IPv6, Backups de Hetzner activados, preparado con `despliegue/cloud-init.yml`.
- **Firewall Hetzner:** 22 (solo llave + fail2ban), 80 (Let's Encrypt), 443; ICMP opcional.
- **Servicio `legal`** (systemd): usuario sin privilegios `legal`, `ExecStart=/opt/legal/bin/legal-prueba -sin-bandeja -no-abrir -datos /var/lib/legal`, endurecido (`ProtectSystem=strict`, `ProtectHome`, etc.), escuchando solo en `127.0.0.1:8790`.
- **Caddy** (`despliegue/Caddyfile`), en este orden: (1) IP fuera de `LEGAL_IPS_PERMITIDAS` → 403 «Acceso restringido a la red institucional.»; (2) `/api/reiniciar` → 403; (3) `/` → `/portal/`; (4) autenticación básica para todo **excepto** `/api/*` (lo usa la extensión); (5) proxy a 127.0.0.1:8790. Cabeceras HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, sin `Server`; log de accesos con 14 rotaciones.
- **Configuración fuera del repositorio:** `/etc/caddy/legal.env` (`LEGAL_DOMINIO`, `LEGAL_CORREO_ACME`, `LEGAL_IPS_PERMITIDAS`) y `/etc/caddy/legal-usuarios` (`usuario hash` generado con `caddy hash-password`).
- **Respaldo:** `legal-respaldo.timer` diario 03:30 → `/var/backups/legal`, conserva 14 días; respaldo adicional antes de cada actualización.
- **CI/CD** (`.github/workflows/desplegar-hetzner.yml`): en cada PR y push construye y prueba (`construir.sh`, Go según `go.mod`, Node 20) y publica los binarios como artefacto (14 días). En push a `main` o ejecución manual, en el entorno `produccion`, copia binario y Caddyfile por SCP con el usuario `despliegue` (que **solo** puede ejecutar `sudo /usr/local/sbin/legal-actualizar`), y ese script respalda, valida el Caddyfile, instala, reinicia, verifica `/api/estado` y **vuelve a la versión anterior** si no responde. Secretos: `HETZNER_HOST`, `HETZNER_SSH_KEY`, `HETZNER_KNOWN_HOSTS`. `StrictHostKeyChecking=yes`; la llave se borra siempre al final.
- **Sin dominio** (piloto): `IP-CON-GUIONES.sslip.io`.

---

## 15. Limitaciones conocidas de la piloto

1. **La API no identifica a cada usuario**: `/api/*` solo está protegida por el filtro de IP. Falta autenticación por persona (token de dispositivo de alcance mínimo `sgd:lookup` u OAuth 2.0 Authorization Code + PKCE con `chrome.identity.launchWebAuthFlow`; access token en `chrome.storage.session`, 15–60 min).
2. **El portal guarda un único documento compartido**: el último que guarda sobrescribe (sin control de concurrencia). Falta un modelo de datos por registro.
3. **Usuario y contraseña comunes** (basic auth de Caddy) y **sin roles reales**: el selector de perfil está disponible para todos.
4. **bbolt** en un solo archivo, sin replicación.
5. El **SGD simulado** sigue publicado en el servidor desplegado.
6. **Ubicación de los datos** fuera del Perú: requiere evaluación (Ley 29733).
7. El catálogo de categorías/responsables existe **duplicado** en `extension/shared/catalogo.js` y `portal/js/datos.js`; el servidor valida contra el de la extensión (semilla). Las categorías y responsables no se pueden editar desde el portal.
8. La validación de procedimiento/responsable del servidor usa la semilla, no el catálogo del portal.
9. La consulta `/api/tramites-sgd` recorre todos los trámites (sin índice) y compara el número exacto.
10. El índice local del Conector guarda también los trámites registrados en el servidor (doble fuente).
11. `fechaCaptura` y la verificación de duplicados del Conector se hacen solo contra el índice local, no contra el servidor.
12. No hay telemetría de motivos de fallo (`NO_NODE`, `AMBIGUOUS`, `NET`, `AUTH`) aunque el diseño la prevé.
13. No se determinó si el paso bandeja → detalle recarga la página; el panel lo resuelve siguiendo `tabs.onUpdated`.

---

## 16. Preguntas abiertas (sistemas y datos personales)

**Para sistemas:** instalación centralizada (GPO / Google Admin, `ExtensionInstallForcelist`, Web Store privada o CRX con `update_url`); ¿SGD de QA con datos ficticios?; frecuencia de despliegues y aviso de cambios en `app-detalletramite`; significado del tercer grupo `S` y si el correlativo se reinicia por año (decide si «anexar» agrupa por `AAAA-#####` o por la terna); ¿la última fila de «MOVIMIENTO» es siempre el ingreso?; navegación SPA o recarga; cuándo se renderiza el componente confidencial; qué evento registra «Fecha Leído»; ¿endpoint documentado de solo lectura o webhook?; TTL de sesión e intervalo de `KeepAlive`; titularidad de los bancos de datos; requisitos de revisión de código o pentest.

**Para el oficial de datos personales:** datos de contacto del solicitante visibles en el detalle (la extensión no los trata); política ante trámites confidenciales; inscripción/declaración del banco de datos de LEGAL (finalidad, base legal art. 14.1: funciones propias de la entidad); flujo transfronterizo si el servidor está fuera del Perú.

---

## 17. Mejoras propuestas (backlog)

Ordenadas por prioridad sugerida; cada una debe respetar las reglas RN/RP vigentes o declarar explícitamente cuál modifica.

| # | Mejora | Motivo |
|---|---|---|
| M-01 | Autenticación por persona en la API (token de dispositivo u OAuth+PKCE) y registro de auditoría por usuario | Limitación 1 |
| M-02 | Roles reales (Gerente, Responsable, Administrador) con autorización en el servidor, no solo en la interfaz | Limitación 3; RN-40–42 hoy son solo de cliente |
| M-03 | Modelo de datos por registro (procesos, actividades, trámites, comentarios) con API CRUD y control de concurrencia (versión/ETag) | Limitación 2 |
| M-04 | Mover todas las reglas del portal (RN-31–RN-37) al servidor | Hoy solo el Conector tiene validación de servidor |
| M-05 | Catálogo único administrable (categorías, procedimientos, responsables, plantillas) servido por la API a Conector y Portal | Limitación 7 y 8 |
| M-06 | Índice por n.º de trámite en la BD y detección de duplicados en el servidor | Limitaciones 9 y 11 |
| M-07 | Telemetría de motivos de fallo de lectura (solo códigos, sin contenido) | Medir tasa de detección real (R1) |
| M-08 | Base de datos de producción (PostgreSQL gestionado o similar) y respaldos fuera del servidor | Limitación 4 |
| M-09 | Marcar en la bandeja del SGD las filas ya vinculadas (Shadow DOM, solo lectura) | Selectores documentados en §12.2 / doc 11 §3.3 |
| M-10 | Vincular el trámite a una actividad concreta desde el Conector (hoy el portal elige la primera abierta) | RN-39 (e) |
| M-11 | Notificaciones de vencimiento (correo / tablero) | RN-30 |
| M-12 | Reportes exportables (CSV/PDF) de cartera, cumplimiento y carga | Panel institucional |
| M-13 | Pruebas automatizadas de la extensión (lectores contra el SGD simulado con Playwright) y del portal | Hoy solo hay pruebas de la API |
| M-14 | Publicación de la extensión gestionada por la entidad | Pregunta abierta de sistemas |
| M-15 | Retirar el SGD simulado y `/api/reiniciar` de la compilación de producción | Limitación 5 |

---

## 18. Mapa de archivos para recrear el proyecto

```
ONE-LEGAL/
├── README.md                          Guía de uso
├── ESPECIFICACION-PILOTO.md           Este documento
├── docs/
│   ├── 11-reconocimiento-sgd.md       Reconocimiento estructural del SGD de SEDAPAR
│   └── 12-despliegue-hetzner.md       Instructivo de despliegue
├── extension/                         Conector SGD (Chrome MV3)
│   ├── manifest.json
│   ├── background.js                  Activación declarativa del ícono + panel lateral
│   ├── icons/                         16, 32, 48, 128 px
│   ├── panel/panel.{html,css,js}      Panel lateral: sesión, lectura, vinculación, indexados
│   ├── options/options.{html,css,js}  Configuración, importación de catálogo, exportación
│   └── shared/
│       ├── entorno.js                 URL fijas del SGD (reemplazado por LEGAL-Prueba)
│       ├── catalogo.js                Catálogo referencial y estados de proceso
│       ├── almacen.js                 chrome.storage.local, códigos, exportación
│       ├── servidor.js                Cliente de la API LEGAL
│       ├── lector.js                  Lector genérico de SGD
│       └── lector-sedapar.js          Lector específico de SEDAPAR
├── portal/
│   ├── index.html
│   ├── css/estilos.css
│   └── js/datos.js (semilla)  js/app.js (aplicación)
├── pruebas/sgd-simulado/              login, mistramites, detalletramite, salir, datos.js, estilos.css
├── servidor/
│   ├── main.go                        Arranque, banderas, bandeja, extracción de la extensión
│   ├── api.go                         Rutas, reglas de negocio, catálogo, simulador
│   ├── bd.go                          bbolt
│   ├── api_test.go                    Pruebas de la API
│   ├── plataforma_windows.go / plataforma_otros.go
│   ├── centro/index.html              Centro de pruebas
│   ├── recursos/icono.{ico,png}
│   ├── rsrc_windows_amd64.syso        Ícono del .exe
│   ├── construir.sh
│   └── go.mod / go.sum
├── despliegue/
│   ├── cloud-init.yml  Caddyfile  legal.env.ejemplo  legal-usuarios.ejemplo
└── .github/workflows/desplegar-hetzner.yml
```

**Orden recomendado para recrear desde cero:** (1) dominio y catálogo (§3–4) → (2) SGD simulado (§10) → (3) lectores y panel del Conector en modo local (§7) → (4) Portal en modo navegador (§9) → (5) intercambio por archivo (§11) → (6) servidor y API con pruebas (§8) → (7) modo servidor en Conector y Portal → (8) empaquetado (§13) → (9) despliegue (§14).

---

## 19. Lista de verificación de aceptación

- [ ] El ícono solo se habilita en el SGD con sesión (RN-01) y el panel re-verifica (RN-02).
- [ ] El lector no hace clics, envíos ni peticiones de red (RN-03, RP-04) y no lee nada de la lista prohibida (RP-02).
- [ ] SEDAPAR: estrategias P/R1/R2 y consenso; forma canónica; registro manual con motivo; confidencial bloquea (RN-14–17).
- [ ] Anexar excluye finalizados; nuevo proceso exige sus 4 campos; actuación obligatoria; aviso de duplicado y de trámite ya vinculado (RN-05–10).
- [ ] Enlace sin identificadores de sesión o por plantilla (RN-11).
- [ ] Servidor: 404 / 409 / 422 / idempotencia / código correlativo asignado por el servidor (RN-20–26); CORS solo para la extensión (RP-10); `go test` en verde.
- [ ] Portal: vencimientos con ícono + texto; finalizado bloquea; no finaliza con actividades abiertas; confirmar concluir con pendientes; bitácora de cambios; plantillas generan todas las actividades (RN-30–38).
- [ ] Incorporación idempotente con remapeo y omitidos (RN-39); sincronización cada 8 s en modo servidor.
- [ ] Ambos modos (con y sin servidor) funcionan en Conector y Portal.
- [ ] Ningún archivo, log ni documento contiene datos reales (RP-13).
