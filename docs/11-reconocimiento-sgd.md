# 11 · Reconocimiento estructural del SGD (extensión de solo lectura)

| | |
|---|---|
| **Proyecto** | trazabilidad-legal — extensión Chrome MV3 "panel SGD" |
| **Fecha del reconocimiento** | 2026-10-09 |
| **Modo de trabajo** | C — navegación sobre la sesión del usuario, con autorización escrita del área de sistemas (declarada por el usuario) |
| **Alcance observado** | `sgd.sedapar.com.pe`: detalle de trámite, "Mis Trámites" (bandeja), "Seguimiento de Trámites" (búsqueda) |
| **Datos reales en este documento** | Ninguno. Números, nombres y textos están sustituidos por marcadores o descritos por su forma |

## 0. Cómo se hizo y qué no se hizo

**Qué se hizo:** la estructura se leyó con scripts de inspección del DOM que devolvían solo nombres de etiquetas, clases, encabezados y la *forma* de los valores (dígitos → `9`). Las peticiones de red se observaron de forma pasiva con la API `performance` (Resource Timing), que solo lista las que la propia página ya había hecho.

**Qué no se hizo:**

- No se hizo clic en botones, no se envió ningún formulario, no se descargó nada y no se pulsó "Buscar" en la página de seguimiento.
- No se llamó a ningún endpoint `/Rest/...`.
- No se leyeron valores de cookies, tokens ni del almacenamiento web; solo los nombres de las claves.

**Única petición activa:** un `HEAD /` sin credenciales (`credentials: 'omit'`) para leer las cabeceras HTTP del documento estático. No toca la API ni la sesión.

**Navegación:** se abrió una pestaña auxiliar para visitar la bandeja y la página de seguimiento, y se cerró al terminar. La pestaña de detalle del usuario no se recargó.

**Dato personal visto y no transcrito:** el nombre de la usuaria con sesión iniciada aparece en el menú lateral (`sidebar-cmp`). No se reproduce en este documento.

---

## 1. Mapa de páginas

| Página | Patrón de URL | Componente Angular raíz | Cómo se llega | ¿Dónde va el identificador? |
|---|---|---|---|---|
| Detalle de trámite | `/tramites/detalletramite/{ID_INTERNO}` | `app-detalletramite` | Enlace `<a href="/tramites/detalletramite/{ID_INTERNO}" target="_self">` (icono `fa-mail-forward`, título "Ingresar al Tramite") en la bandeja, o URL directa | **En la URL**, pero es un **ID interno numérico de 6 dígitos que NO es el n.º de trámite** (ver §3) |
| Mis Trámites (bandeja) | `/tramites/mistramites` | `app-mistramites` | Menú lateral › Trámites › Mis Trámites | Sin identificador en la URL. Los filtros viven en el estado del componente |
| Seguimiento de Trámites (búsqueda) | `/tramites/listadotramites` | `app-listadotramites` | Menú lateral › Trámites › Seg. de Trámites | Sin identificador. Los resultados aparecen solo tras pulsar "Buscar" (no se ejecutó) |
| Nuevo trámite interno | `/tramites/nuevotramiteint` | no inspeccionado | Menú | Fuera de alcance: es una página de escritura |
| Inicio | `/dashboard` | no inspeccionado | Menú | — |
| Reportes / Estadísticas | `/reportes/mireporte`, `/estadistica/resumen`, `/estadistica/porarea` | no inspeccionado | Menú | Fuera de alcance |
| Perfil / Salida | `/account/perfil`, `/pages/login/exit` | — | Menú de usuario | **No tocar**: `/pages/login/exit` cierra la sesión |

**Seguimiento dentro de la bandeja:** el icono `fa-reorder` ("Ver Movimientos") de cada fila abre, presumiblemente, un modal de seguimiento sin cambiar de URL. **No determinado:** no se abrió.

**Navegación completa o de SPA:** **no determinado.** Las URL están en el historial del navegador (`pathname`, sin `#`), así que la app usa el enrutador HTML5 de Angular. El enlace de la bandeja al detalle es un `<a href>` con `target="_self"`. En compilación de producción no se puede saber si ese enlace lleva `routerLink` (navegación sin recarga) o provoca una carga completa. **Para determinarlo:** en DevTools › Network, marcar "Preserve log", hacer clic desde la bandeja y comprobar si aparece una petición de tipo `document`. El diseño de §6 cubre ambos casos.

**Enlaces a otros sistemas** (solo anotados, no visitados):

- `https://apps.firmaperu.gob.pe/web/clienteweb/firmaperu.min.js` es el cliente de FirmaPerú (firma digital). La CSP también lo autoriza en `frame-src`, junto con `resources.firmaperu.gob.pe`.
- No se encontraron enlaces a MEF, a la casilla del PJ ni a la intranet.

---

## 2. Tecnología de la página

| Aspecto | Hallazgo | Consecuencia para el content script |
|---|---|---|
| Renderizado | **SPA en Angular (2+)** (atributo `ng-version` en `app-root`, atributos `_nghost-*` / `_ngcontent-*`), compilada con Angular CLI/webpack (`runtime.*.js`, `polyfills-es5.*.js`, `main.*.js`, chunks con hash) | El HTML inicial está vacío. Todo se pinta después de las llamadas XHR |
| Plantilla de interfaz | Bootstrap 3, con estructura de plantilla tipo "Light Bootstrap Dashboard" (`.wrapper`, `.sidebar[data-color][data-image]`, `.main-panel`, `.card > .header > legend.title` + `.content`), `bootstrap-select`, perfect-scrollbar (`.ps-container`), Font Awesome 4, `pe-icon-7-stroke`. También carga jQuery 3.6.0 desde `code.jquery.com` | Las clases de Bootstrap son estables mientras no se cambie la plantilla |
| Atributos `_ngcontent-xxx-cNN` | **Dinámicos**: cambian con cada compilación (`neu-c45`, `bsr-c59`…) | **No usarlos nunca como selectores** |
| `id` de elementos | Casi no hay `id` útiles en el contenido. No existe el patrón `ctl00_…` | Las anclas deben ser etiquetas de componente, clases y textos de rótulo |
| Frames / iframes | **Ninguno** en las tres páginas | Todo el contenido está en el documento principal; `all_frames: false` |
| WebForms (`__VIEWSTATE`, `__EVENTTARGET`, `__doPostBack`) | **No existen** | No hay postbacks |
| Formularios | Hay muchos `<form>` en el detalle: derivar, adjuntar archivo, comentarios, firma (`select[name=firmamotivo]`), acciones. Todos llevan `method="get"`, sin `action`, y Angular los maneja | **Ignorarlos.** La extensión no debe interactuar con ninguno |
| Carga asíncrona | **Sí.** Medido en la página de detalle: `domInteractive` ≈ 0,26 s; `getTramite` termina ≈ 1,05 s; `getTramitesAsociados` termina ≈ 1,65 s; `domComplete` ≈ 1,4 s. En la bandeja, `getTramites` tarda ≈ 1,1 s y termina ≈ 1,9 s | `document_idle` **no basta**. Hace falta un `MutationObserver` sobre `app-root` hasta que aparezca el nodo del número, con un tope de 10 s |
| Evento de "carga terminada" | **No existe** un evento propio de la app | Como señal sirve la presencia del `<strong>` del número con texto que cumpla la expresión regular (§3) |
| Content-Security-Policy | `default-src 'self'`; `script-src 'self' 'unsafe-inline' 'unsafe-eval' code.jquery.com apps.firmaperu.gob.pe`; `style-src 'self' 'unsafe-inline' …`; **`connect-src 'self' http://localhost:* http://127.0.0.1:*`**; `frame-src 'self' blob: apps/resources.firmaperu.gob.pe jnlps:`; `frame-ancestors 'self'` | La llamada a nuestro servidor **debe hacerla el service worker**, no el content script ni código inyectado en la página. El panel se monta con **Shadow DOM**, no con un iframe |
| X-Frame-Options | `SAMEORIGIN` | Coherente con `frame-ancestors 'self'`. El SGD no puede embeberse en nuestra plataforma |
| Otras cabeceras | `Server: Apache`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=()`, HSTS presente | — |
| Sesión | `document.cookie` no expone cookies a JS (o son `HttpOnly` o no existen). En `localStorage` hay claves `id_usuario` y `uuid`; `sessionStorage` contiene al menos una clave marcada como sensible (probablemente el token). Hay un endpoint `Auth/v3.2/KeepAlive` que se llama 2 veces en cada carga | La extensión **no lee** ni `localStorage`, ni `sessionStorage`, ni cookies del SGD |
| Expiración de sesión | **No determinado**: no se dejó expirar. **Para determinarlo:** preguntar a sistemas el TTL del token y el intervalo de `KeepAlive`, o dejar una pestaña inactiva y anotar a los cuántos minutos se redirige a `/pages/login` | Al expirar, la app redirige al login y el número deja de aparecer. El content script debe tratarlo como "no detectado" y no reintentar |

---

## 3. Ubicación del n.º de trámite ← lo más importante

### 3.1 Qué es "el número"

Aquí hay dos identificadores distintos y no hay que confundirlos:

| | N.º de trámite / expediente SGD (visible) | ID interno (en la URL) |
|---|---|---|
| Forma observada | `AAAA - ##### - #` o `AAAA - ##### - ##` | `######` (6 dígitos) |
| Ejemplo enmascarado | `2026 - 0#### - #` | `/tramites/detalletramite/{ID_INTERNO}` |
| ¿Coincide con alguno de los grupos del número visible? | — | **No** (se verificó) |
| ¿Lo usa el personal? | Sí, es el que se cita | No |

El rótulo de la tarjeta dice "DATOS DEL **EXPEDIENTE**". En el SGD de SEDAPAR, "expediente" significa el expediente administrativo, no el judicial (`#####-2026-0-####-JR-LA-##`). El expediente judicial **no aparece** en ninguna estructura observada; si existe, estará dentro del texto libre del asunto o del contenido.

**Composición del número** (deducida de 20 filas de la bandeja y de la página de detalle):

- **Grupo 1**: año, 4 dígitos. Todas las filas observadas son de 2026.
- **Grupo 2**: correlativo de 5 dígitos **con ceros a la izquierda**. Probablemente es la "Serie" que aparece en los filtros de la bandeja.
- **Grupo 3**: entero de 1 o 2 dígitos **sin relleno**; los valores observados van de 1 a 90.
- **Un mismo grupo 2 aparece con distintos grupos 3**, así que **la clave única es la terna completa**, no el correlativo solo.
- **No determinado:** qué significa el grupo 3 (¿n.º de documento dentro del expediente, de derivación o de copia?). Es una pregunta para sistemas (§7). Esto decide si "anexar a un proceso" debe agrupar por `AAAA-#####` y no por la terna.
- Separador observado: espacio, guion ASCII (`-`, U+002D), espacio. Se probó con el detalle carácter a carácter: `dddd␠-␠ddddd␠-␠d`.

### 3.2 Página de detalle (`/tramites/detalletramite/{ID_INTERNO}`)

**Ruta DOM completa** (las clases de Bootstrap tal cual; se omiten los atributos `_ngcontent`):

```
app-root > app-layout > div.wrapper > div.main-panel > app-detalletramite
  > div.main-content > div.container-fluid > div.row:nth-of-type(1)
  > div.col-md-6:nth-of-type(2) > div.row > div.col-md-12 > div.card
  > div.header > legend.title > div.row > div.col-sm-5
      #text "DATOS DEL EXPEDIENTE "
      <strong>2026 - 0#### - #</strong>      ← nodo de texto dentro de <strong>
      <i class="fa fa-file-pdf-o"></i>        ← es clicable: NO hacer clic
```

**Tipo de nodo:** nodo de texto, hijo único de un `<strong>`. No es el `value` de un input ni un atributo.

**Aparece una sola vez** en el componente con esa forma, pero la tabla "TRÁMITES ASOCIADOS" tiene una columna "Trámite". Cuando tiene filas, contendrá **otros** números con la misma forma, así que la búsqueda por expresión regular debe acotarse (ver respaldo 2).

| # | Estrategia | Selector / algoritmo | Confianza | Qué lo rompería |
|---|---|---|---|---|
| **P** | Estructura (CSS) | `app-detalletramite legend.title .col-sm-5 > strong` | **Alta** | Cambiar la rejilla (`col-sm-5`) o el `<strong>` en la plantilla del encabezado; añadir otro `legend.title` con `col-sm-5 > strong` antes que este |
| **R1** | Rótulo vecino | Recorrer `app-detalletramite legend` y quedarse con el primero cuyo primer nodo de texto, normalizado, empiece por `DATOS DEL EXPEDIENTE`; dentro, tomar el primer `strong` | **Alta** | Cambiar el texto del rótulo (p. ej. "DATOS DEL TRÁMITE"); una versión con otro idioma o mayúsculas distintas (mitigación: comparar sin tildes ni mayúsculas) |
| **R2** | Regex acotada | Tomar `textContent` de la **primera** `.card` dentro de `app-detalletramite` cuyo `legend` contenga `EXPEDIENTE` y **no** contenga `ASOCIADOS` ni `MOVIMIENTO`; aplicar la regex de §3.4 y aceptar **una sola** coincidencia | **Media** | Que esa tarjeta llegue a contener otro número con la misma forma (p. ej. una referencia en "CONTENIDO"). Si hay más de una coincidencia, el resultado es ambiguo y no debe usarse |
| **ID** | URL (complementario, no sustituye al número) | `location.pathname.match(/^\/tramites\/detalletramite\/(\d+)\/?$/)` | **Alta** | Cambio de ruta en el enrutador |

**Regla de consenso:** se acepta el número si P o R1 devuelven un valor que cumple la regex. Si P y R1 dan valores distintos, se marca como ambiguo y se pasa a registro manual. R2 solo se usa cuando P y R1 fallan.

### 3.3 Bandeja (`/tramites/mistramites`) y búsqueda (`/tramites/listadotramites`)

No es necesaria para el caso de uso: la extensión actúa en la página de detalle. Se documenta por si en el futuro se quiere marcar visualmente en la bandeja las filas ya registradas.

| Página | Ubicación | Selector primario | Respaldo |
|---|---|---|---|
| Bandeja | Tabla `table.table.table-xs.table-hover.scroll-table`; encabezados `["", "Expediente", "Fecha de Solicitud", "Remitente", "Derivado a", "Asunto", "Estado", "Adjuntos", "Acciones"]`; 20 filas por página, con paginador | `app-mistramites table.scroll-table tbody tr > td:nth-child(2) > p.scroll-table-td-p` | Buscar el índice de la columna cuyo `th` normalizado sea `EXPEDIENTE` y leer esa celda. El ID interno de la fila está en `a[href^="/tramites/detalletramite/"]` |
| Búsqueda | Encabezados `["Tramite", "Remitente", "Asunto", "Detalle", "Tipo Tramite", "Area", "Estado", "Fecha", "Acciones"]` | **No determinado**: la tabla estaba vacía porque no se ejecutó ninguna búsqueda | Índice de la columna `th` = `TRAMITE` |

### 3.4 Expresión regular y normalización

```js
// Tolerante: espacios normales, de no separación o finos; guion ASCII, en dash o em dash; con o sin espacios; ceros opcionales
const RE_TRAMITE = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;

function normalizarTramite(texto) {
  const t = texto.replace(/[   ]/g, ' ');
  const m = t.match(RE_TRAMITE);
  if (!m) return null;
  const [, anio, serie, sub] = m;
  return `${anio}-${serie.padStart(5, '0')}-${String(parseInt(sub, 10))}`; // forma canónica: AAAA-#####-S
}
```

**Casos límite que hay que probar** (todos enmascarados):

| Entrada (forma) | Salida canónica esperada | Nota |
|---|---|---|
| `2026 - 0#### - #` | `2026-0####-#` | Caso observado |
| `2026 - ##### - ##` | `2026-#####-##` | Caso observado (grupo 3 de 2 dígitos) |
| `2026-0####-#` (sin espacios) | igual | Posible en otras vistas |
| `2026 – 0#### – #` (en dash) | igual | Por si cambia la plantilla |
| `2026 - ### - #` (sin ceros) | `2026-00###-#` | Se rellena con ceros a la izquierda |
| `2025 - ##### - #` | `2025-#####-#` | Trámites de años anteriores. **No** fijar el año en la regex |
| `2026 - ##### - ###` | `2026-#####-###` | No observado; se admite por si acaso |
| `#####-2026-0-####-JR-LA-##` | **sin coincidencia** | Expediente judicial: la regex exige el año al inicio y `(?<!\d)` evita coincidencias parciales |
| Dos números dentro del contenedor | **ambiguo → null** | Aplica a R2 |

---

## 4. Otros campos candidatos

Regla aplicada: por defecto, **no**. "Datos personales" significa que identifica o hace identificable a una persona natural (Ley 29733, art. 2).

| Campo | Dónde aparece | Formato | ¿Datos personales? | ¿Lo necesita la extensión? |
|---|---|---|---|---|
| **N.º de trámite** | Detalle: `legend.title > .col-sm-5 > strong` | `AAAA - ##### - S` | No (por sí mismo) | **Sí** |
| **Fecha/hora de ingreso** | Detalle: tabla "MOVIMIENTO DEL EXPEDIENTE", **última fila** (orden descendente, comprobado), celda 1. Bandeja: columna "Fecha de Solicitud" | `dd/mm/aaaa HH:mm:ss`, reloj de 24 h | No | **Opcional.** Además, **no determinado** si la última fila del movimiento es siempre el registro inicial; en la muestra, su columna "Area" corresponde a la unidad de trámite documentario. Confirmar con sistemas |
| ID interno | URL | 6 dígitos | No | **Opcional.** Útil para enlazar de vuelta al SGD desde la plataforma |
| Estado | Movimiento › columna "Estado"; bandeja › "Estado" (insignia, p. ej. "DERIVADO") | Texto corto en mayúsculas | No | No |
| Área remitente | Movimiento › "Area" (filas); bandeja › "Remitente" (área + **nombre y cargo del servidor**) | Texto libre | **Sí** en la bandeja (incluye nombre de persona) | No |
| Área destinataria | Bandeja › "Derivado a" (área + **nombre de servidor**); movimiento › "Area"/"Puesto" | Texto libre | **Sí** (nombre de persona) | No |
| Sumilla / asunto | Detalle › "ASUNTO"; bandeja › "Asunto" | Texto libre, una o dos líneas | **Posible** (puede nombrar personas o casos) | No |
| Contenido | Detalle › "CONTENIDO" | Texto libre | **Posible / probable** | No |
| Tipo de documento / tipo de trámite | Detalle (selects deshabilitados) | Valor de catálogo | No | No (opcional en el futuro para clasificar) |
| Con copia | Detalle › "CON COPIA" | Lista de áreas/personas | **Sí** | No |
| **Datos del solicitante** | Detalle › tarjeta "DATOS DEL SOLICITANTE": SOLICITANTE, DIRECCIÓN, EMAIL, CELULAR | Texto | **Sí: identificación y contacto** | **No. Excluir explícitamente** |
| Nro. doc. / nombre del solicitante | Filtros de bandeja y búsqueda | `[DNI]` / `[RUC]` / `[NOMBRE]` | **Sí** | **No** |
| Usuario / puesto en movimientos | Movimiento › "Usuario", "Puesto"; Archivos › "Usuario" | Nombre de servidor | **Sí** | No |
| Fecha límite / fecha leído | Movimiento | `dd/mm/aaaa HH:mm:ss` | No (pero revela la conducta del servidor) | No |
| Archivos adjuntos | Tarjeta "ARCHIVOS" (fecha, área, usuario, archivo, descripción, público) | — | Posible | **No** (y nunca descargar) |
| Usuario con sesión iniciada | Menú lateral; `localStorage.id_usuario` | Nombre / id | **Sí** | **No. No leer** |
| Indicador de confidencialidad | Componente `<tramites-detalle-tramite-confidential>` en el detalle; checkbox `checkboxconfidencialsubidaarchivo` | — | Indica tratamiento reservado | **Ver riesgo R7**: puede requerir que la extensión **no actúe** |

---

## 5. Endpoints internos observados

Solo se documentan, a partir de la lista pasiva de Resource Timing. **No se llamó a ninguno.** Resource Timing no expone el método HTTP; como ninguna llamada lleva query string, lo más probable es **POST con cuerpo JSON**, pero eso queda **no determinado**. La doble barra (`/Rest//…`) aparece tal cual en algunas llamadas.

| Método | Ruta | Página | Para qué parece servir | Duración observada |
|---|---|---|---|---|
| n/d | `/Rest//Auth/v3.2/KeepAlive` | Todas (2 veces por carga) | Renovar o validar la sesión | ~0,12 s |
| n/d | `/Rest//Auth/v3.2/getActualizarContrasenia` | Todas | Comprobar si la contraseña debe cambiarse | ~0,1 s |
| n/d | `/Rest/DetalleTramite/v1.0/getTramite` | Detalle | Cabecera y datos del trámite | ~0,18 s |
| n/d | `/Rest//DetalleTramite/v1.0/getBandeja` | Detalle | Movimientos o estado del trámite en las bandejas | ~0,17 s |
| n/d | `/Rest/DetalleTramite/v1.0/getTramitesAsociados` | Detalle | Trámites asociados | ~0,79 s |
| n/d | `/Rest/DetalleTramite/v1.0/getReferencias` | Detalle | Referencias o documentos vinculados | ~0,13 s |
| n/d | `/Rest//MisTramites/v1.0/getCatalogo` | Bandeja | Catálogos de filtros (puestos, bandejas, estados, tipos) | ~0,11 s |
| n/d | `/Rest//MisTramites/v1.0/getTramites` | Bandeja | Lista paginada de trámites | ~1,1 s |
| n/d | `/Rest/ListadoTramites/v1.0/getCatalogo` | Búsqueda | Catálogos | ~0,11 s |
| n/d | `/Rest//ListadoTramites/v1.0/getBandeja` | Búsqueda | Búsqueda o listado | ~0,12 s |

**Observación:** al cargar el detalle **no** se vio ninguna llamada que marque el trámite como "leído", aunque la tabla de movimientos tiene la columna "Fecha Leído". Hay que confirmar con sistemas qué evento la rellena: si fuera la simple visualización, abrir el detalle ya tendría efecto de escritura, también para el usuario humano.

> ⚠️ **Nota:** estos endpoints son una **API interna no documentada**. Usarlos desde la extensión, por ejemplo para leer el número en JSON en lugar del DOM, sería más robusto, pero **requiere autorización formal y por escrito del área de sistemas** y, en la práctica, un contrato de interfaz versionado. Mientras no exista, la extensión **solo lee el DOM ya renderizado** y no repite, intercepta ni monkey-patchea las llamadas XHR de la página.

---

## 6. Diseño preliminar de la extensión

### 6.1 `manifest.json` propuesto

```json
{
  "manifest_version": 3,
  "name": "trazabilidad-legal · Panel SGD",
  "version": "0.1.0",
  "description": "Muestra si el trámite SGD abierto ya está registrado en trazabilidad-legal. Solo lectura.",
  "minimum_chrome_version": "116",
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["https://sgd.sedapar.com.pe/tramites/*"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": false,
      "world": "ISOLATED"
    }
  ],
  "permissions": ["storage", "identity"],
  "host_permissions": ["https://trazabilidad.[ENTIDAD].gob.pe/api/*"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; connect-src https://trazabilidad.[ENTIDAD].gob.pe"
  }
}
```

Por qué cada elección:

- **Sin `host_permissions` para el SGD.** El content script declarado estáticamente se inyecta gracias a `content_scripts.matches`, y la extensión nunca hace `fetch` al SGD.
- **Sin `tabs`, `activeTab`, `scripting`, `webRequest`, `webNavigation`, `cookies` ni `<all_urls>`.** `activeTab` no hace falta porque la inyección es estática.
- **`matches` limitado a `/tramites/*` y no a `/tramites/detalletramite/*`,** porque no está determinado si la navegación desde la bandeja recarga la página (§1). Dentro del script, toda la lógica está protegida por la comprobación de ruta `/^\/tramites\/detalletramite\/\d+\/?$/`; en las demás rutas el script no hace nada. Cuando se confirme que siempre hay recarga completa, se reducirá a `detalletramite/*`.
- **`identity`** solo se usa si se adopta OAuth (ver 6.3). Si se usa el token de dispositivo, se elimina.
- **Sin código remoto:** todo el JS va empaquetado; nada de `eval` ni de scripts por CDN.

### 6.2 Flujo y datos que viajan

```
content.js (página SGD, mundo aislado)
  1. ¿Ruta = detalle? → esperar al nodo del número (MutationObserver sobre app-root, tope 10 s)
  2. Extraer con P → R1 → R2 y normalizar (§3.4)
  3. chrome.runtime.sendMessage({tipo:"consulta", tramite:"2026-0####-#"})
sw.js (service worker)
  4. GET https://trazabilidad.[ENTIDAD].gob.pe/api/sgd/tramites/{AAAA-#####-S}
     Authorization: Bearer <token de nuestra plataforma>
  5. Respuesta: {registrado: bool, proceso_id?, url_proceso?}
content.js
  6. Pinta el panel en un Shadow DOM cerrado (position: fixed, z-index alto)
     - "Ya registrado → ver proceso"           (abre nuestra plataforma en una pestaña nueva)
     - "Iniciar proceso" / "Anexar a un proceso" (abren nuestra plataforma con ?tramite=… prellenado)
  7. Observa cambios de ruta (popstate + MutationObserver) para quitar o recalcular el panel
```

**Por qué la llamada sale del service worker:** la CSP del SGD fija `connect-src 'self' localhost`. Las peticiones del service worker no están sujetas a ella, no dependen de CORS respecto del origen del SGD y mantienen el token de nuestra plataforma fuera del contexto de la página.

**Por qué Shadow DOM y no un iframe:** evita depender de `frame-src` y aísla los estilos frente a Bootstrap 3. Los estilos inline están permitidos (`style-src 'unsafe-inline'`), y un `<style>` dentro del shadow root no se ve afectado.

| Viaja a nuestro servidor | **No** viaja |
|---|---|
| N.º de trámite canónico | Datos del solicitante, nombres de servidores |
| (opcional) fecha/hora de ingreso | Asunto, contenido, con copia |
| (opcional) ID interno de la URL | Adjuntos o sus nombres |
| Token de **nuestra** plataforma (cabecera) | HTML del SGD, capturas, cookies, tokens o `localStorage` del SGD |
| | Identidad del usuario del SGD (nuestra plataforma ya sabe quién es por su propio token) |

En los registros de nuestro servidor: el número de trámite consultado, el usuario de nuestra plataforma y la marca de tiempo. Nada más.

### 6.3 Autenticación contra nuestro servidor (sin tocar el SGD)

**Opción A (recomendada).** OAuth 2.0 *Authorization Code + PKCE* contra el IdP de la entidad o de nuestra plataforma, usando `chrome.identity.launchWebAuthFlow`.

- El *access token* se guarda en `chrome.storage.session` (memoria, se borra al cerrar el navegador) y dura 15–60 minutos.
- El *refresh token* va solo si hace falta, rotativo, en `chrome.storage.local`.

**Opción B.** Token de dispositivo de alcance mínimo (`sgd:lookup`) que el usuario genera en su perfil de la plataforma y pega una vez en la página de opciones. Se puede revocar desde la plataforma y caduca por inactividad.

En ambas opciones el servidor **solo** expone `GET /api/sgd/tramites/{n}` con ese alcance, con limitación de frecuencia por usuario. Las credenciales del SGD nunca se leen ni se reutilizan.

### 6.4 Si el número no se detecta

| Situación | Comportamiento |
|---|---|
| Pasan 10 s y no aparece ningún nodo que cumpla la regex | Panel discreto: "No se pudo leer el n.º de trámite en esta página" + botón "Registrar manualmente", que abre la plataforma sin prellenar |
| P y R1 dan valores distintos, o R2 encuentra más de una coincidencia | Igual que el caso anterior, con el motivo "ambiguo". **No se envía nada** al servidor |
| Redirección al login (sesión expirada) | No se muestra el panel |
| Trámite marcado como confidencial (si se confirma, R7) | Según lo que decida el oficial de datos personales: no mostrar el panel, o mostrarlo sin enviar más que el número |
| Error de red o 401 contra nuestro servidor | Panel: "Sin conexión con trazabilidad-legal / inicie sesión" + botón para abrir la plataforma |

Cada fallo registra **solo** el código de motivo (`NO_NODE`, `AMBIGUOUS`, `NET`, `AUTH`) en la telemetría de nuestra plataforma, nunca el contenido de la página. Sirve para medir la tasa de detección real.

---

## 7. Riesgos y preguntas para sistemas

### 7.1 Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | **Fragilidad de selectores**: un cambio de plantilla (rejilla `col-sm-5`, `<strong>`, rótulo) rompe P o R1 | Media | Alto | Tres estrategias distintas con regla de consenso; telemetría de motivos de fallo; prueba de humo automatizada (§9) en cada versión del SGD |
| R2 | **Nueva versión del SGD**: cambian los hashes de `main.*.js` y los atributos `_ngcontent` | Alta (en cada despliegue) | Bajo, porque no se usan como selectores | No depender de ellos. Registrar el `ng-version` y el hash de `main.*.js` vistos (sin contenido) para correlacionar caídas de detección con despliegues |
| R3 | **Carga asíncrona más lenta** que el tope (red lenta, `getTramitesAsociados` tarda ~0,8 s) | Baja | Medio | `MutationObserver` + tope de 10 s; el número va en la cabecera y no depende de las tablas |
| R4 | **CSP** bloquea el panel o la llamada | Baja con el diseño propuesto | Alto | `fetch` desde el service worker y panel en Shadow DOM, sin iframe. Probar con la CSP real tras cada cambio de cabeceras |
| R5 | **Sesión expirada** o redirección al login | Media | Bajo | Detección por ruta; no mostrar el panel; no reintentar |
| R6 | **Datos personales en pantalla** (tarjeta del solicitante con dirección, correo y celular; nombres de servidores) | Cierta | Alto si se capturan | La extensión **nunca** lee esas tarjetas: los selectores se acotan al `legend` del expediente. Revisión de código con una lista de selectores permitidos. R2 se limita a la tarjeta "DATOS DEL EXPEDIENTE" |
| R7 | **Trámites confidenciales**: existe `tramites-detalle-tramite-confidential`; no se determinó si está siempre en el DOM o solo en trámites reservados | Desconocida | Alto | Hasta que se aclare, si hay indicios de confidencialidad, no enviar nada y mostrar "registro manual". **Llevarlo al oficial de datos personales** |
| R8 | **Ambigüedad del número**: el mismo correlativo con distintos grupos 3 | Cierta | Medio (registros duplicados o mal anexados) | Clave canónica = terna completa; aclarar qué significa el grupo 3 |
| R9 | **"Fecha Leído"**: podría registrarse al ver el detalle | Desconocida | Medio (efecto de escritura por la simple visita) | La extensión no causa visitas adicionales, solo actúa en páginas que el usuario ya abrió. Confirmar con sistemas |
| R10 | **Dependencias de terceros en la página** (jQuery por CDN, FirmaPerú) | — | Bajo para la extensión | La extensión no interactúa con ellas. Anotado como hallazgo para sistemas |
| R11 | **Tratamiento de datos no previsto** (Ley 29733, DS 016-2024-JUS): crear en nuestra plataforma un banco que relaciona números de trámite con procesos judiciales | Cierta | Medio | Evaluar con el oficial de datos personales si el banco de "trazabilidad-legal" debe inscribirse o declararse, su finalidad y la base legal (art. 14.1 de la Ley: ejercicio de funciones propias de la entidad pública). No hay transferencia a terceros |

### 7.2 Hallazgos para el oficial de datos personales

1. La página de detalle muestra al usuario del SGD los **datos de contacto del solicitante** (dirección, correo, celular). La extensión **no** los trata, pero conviene dejarlo documentado en la evaluación.
2. Indicador de **confidencialidad** en trámites y adjuntos (R7): definir si la extensión debe abstenerse por completo.
3. El banco de datos de trazabilidad-legal relaciona números de trámite con procesos judiciales. Esos procesos pueden identificar a personas aunque el número por sí solo no lo haga (R11).
4. El navegador guarda en `localStorage` del SGD un `id_usuario`. Es un hallazgo sobre el SGD, no sobre la extensión; puede interesar a sistemas.

### 7.3 Preguntas concretas para la reunión con sistemas

1. **Instalación centralizada:** ¿la entidad gestiona Chrome con políticas (Google Admin o GPO, `ExtensionInstallForcelist` / `ExtensionSettings`)? ¿Publicamos la extensión de forma privada en Chrome Web Store o como CRX autoalojado con `update_url`?
2. **Entorno de pruebas:** ¿existe un SGD de QA o pruebas con datos ficticios? ¿Cuál es su dominio, para añadirlo a `matches` en la compilación de pruebas?
3. **Versionado:** ¿con qué frecuencia se despliega el frontend? ¿Pueden avisarnos antes de cambios en `app-detalletramite`? ¿Hay notas de versión?
4. **Formato del número:** ¿qué significa el tercer grupo de `AAAA - ##### - S`? ¿El grupo 2 se reinicia cada año? ¿Puede el grupo 3 superar 2 dígitos? ¿Existen otros formatos (trámites externos, MPV)?
5. **Fecha de ingreso:** ¿la última fila de "MOVIMIENTO DEL EXPEDIENTE" es siempre el registro inicial? ¿Hay un campo canónico de fecha de ingreso?
6. **Navegación:** ¿el paso de la bandeja al detalle es `routerLink` (sin recarga) o carga completa?
7. **Confidencialidad:** ¿cuándo se renderiza `tramites-detalle-tramite-confidential`? ¿Cómo se identifica un trámite reservado en el DOM?
8. **"Fecha Leído":** ¿qué evento la registra?
9. **API:** ¿podrían exponer un endpoint documentado y de solo lectura (p. ej. `GET /tramites/{id}/numero`) o un webhook hacia trazabilidad-legal, en vez de depender del DOM?
10. **Sesión:** ¿cuál es el TTL del token y el intervalo de `KeepAlive`?
11. **Titularidad del banco de datos:** ¿quién es el titular del banco del SGD y quién el del banco de trazabilidad-legal? ¿Hace falta un acuerdo interno de uso del número de trámite?
12. **Seguridad:** ¿algún requisito de revisión de código o de pentest de la extensión antes del despliegue?

---

## 8. Tabla resumen de selectores

| Página | Campo | Estrategia | Selector / regla | Confianza |
|---|---|---|---|---|
| Detalle | N.º trámite | **P** · CSS | `app-detalletramite legend.title .col-sm-5 > strong` | Alta |
| Detalle | N.º trámite | **R1** · rótulo | primer `app-detalletramite legend` cuyo texto propio empieza por `DATOS DEL EXPEDIENTE` → primer `strong` | Alta |
| Detalle | N.º trámite | **R2** · regex | `RE_TRAMITE` sobre la `.card` con `legend` ⊃ "EXPEDIENTE" y ⊅ "ASOCIADOS"/"MOVIMIENTO"; exactamente una coincidencia | Media |
| Detalle | ID interno | URL | `/^\/tramites\/detalletramite\/(\d+)\/?$/` | Alta |
| Detalle | Fecha ingreso (opcional) | tabla | `.card` con `legend` ⊃ "MOVIMIENTO" → `tbody tr:last-child > td:first-child`, que debe cumplir `/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/` | Media (falta confirmar la semántica) |
| Bandeja | N.º trámite por fila | CSS / encabezado | `app-mistramites table.scroll-table tbody tr > td:nth-child(2) > p` · respaldo: índice del `th` = "Expediente" | Alta |
| Búsqueda | N.º trámite por fila | encabezado | índice del `th` = "Tramite" | No determinado |
| Todas | — | **Prohibido** | atributos `_ngcontent-*` / `_nghost-*`, tarjeta "DATOS DEL SOLICITANTE", `sidebar-cmp`, almacenamiento web, cookies | — |

---

## 9. Lista de verificación de la tasa de detección (10 trámites)

**Criterio de aceptación:** ≥ 9 de 10 detecciones correctas, y **0** falsos positivos (número equivocado).

**Preparación:**

1. Elige 10 trámites que cubran estas variantes, con al menos uno de cada:
   - grupo 3 de 1 dígito y de 2 dígitos;
   - un trámite de un año anterior a 2026;
   - un trámite con "TRÁMITES ASOCIADOS" no vacía;
   - un trámite con muchos movimientos (> 10);
   - un trámite interno y uno externo (si existen ambos tipos);
   - si es posible, uno marcado como confidencial.
2. Abre cada uno desde la bandeja (no por URL directa) para cubrir también el caso de navegación.

**Ejecución por trámite:** pega este fragmento en la consola de DevTools de la página de detalle. Solo **lee** el DOM, no hace peticiones y **no imprime datos reales**: devuelve la forma y una huella para comparar.

```js
(() => {
  const RE = /(?<!\d)(20\d{2})\s*[-‐-―]\s*(\d{1,5})\s*[-‐-―]\s*(\d{1,3})(?!\d)/;
  const norm = s => { const m = (s||'').replace(/[   ]/g,' ').match(RE); return m ? `${m[1]}-${m[2].padStart(5,'0')}-${+m[3]}` : null; };
  const root = document.querySelector('app-detalletramite');
  const P  = norm(root?.querySelector('legend.title .col-sm-5 > strong')?.textContent);
  const lg = [...(root?.querySelectorAll('legend') ?? [])].find(l => (l.textContent||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().trim().startsWith('DATOS DEL EXPEDIENTE'));
  const R1 = norm(lg?.querySelector('strong')?.textContent);
  const card = [...(root?.querySelectorAll('.card') ?? [])].find(c => { const t = c.querySelector('legend')?.textContent.toUpperCase() || ''; return t.includes('EXPEDIENTE') && !t.includes('ASOCIADOS') && !t.includes('MOVIMIENTO'); });
  const hits = card ? [...card.textContent.matchAll(new RegExp(RE, 'g'))] : [];
  const R2 = hits.length === 1 ? norm(hits[0][0]) : (hits.length > 1 ? 'AMBIGUO' : null);
  const final = (P && R1 && P !== R1) ? 'AMBIGUO' : (P || R1 || R2);
  const mask = v => v && v !== 'AMBIGUO' ? v.replace(/\d/g, '9') : v;
  const hash = v => v ? [...v].reduce((h,c) => (h*31 + c.charCodeAt(0)) >>> 0, 7).toString(16) : null;
  console.table({ P: mask(P), R1: mask(R1), R2: mask(R2), final: mask(final), huella: hash(final), coinciden: P === R1 });
})();
```

**Para cada trámite:**

1. Anota la huella y compárala con la del número que ves en pantalla. Para calcularla, sustituye `final` por el número leído a ojo en una consola aparte, o simplemente comprueba visualmente que la forma coincide y que P = R1.
2. Rellena la tabla:

| # | Variante cubierta | P ok | R1 ok | R2 ok | `final` correcto | Tiempo hasta detección (s) | Motivo si falla |
|---|---|---|---|---|---|---|---|
| 1 | grupo 3 de 1 dígito | ☐ | ☐ | ☐ | ☐ | | |
| 2 | grupo 3 de 2 dígitos | ☐ | ☐ | ☐ | ☐ | | |
| 3 | año anterior | ☐ | ☐ | ☐ | ☐ | | |
| 4 | con trámites asociados | ☐ | ☐ | ☐ | ☐ | | |
| 5 | > 10 movimientos | ☐ | ☐ | ☐ | ☐ | | |
| 6 | interno | ☐ | ☐ | ☐ | ☐ | | |
| 7 | externo | ☐ | ☐ | ☐ | ☐ | | |
| 8 | confidencial (si existe) | ☐ | ☐ | ☐ | ☐ | | |
| 9 | abierto desde la bandeja | ☐ | ☐ | ☐ | ☐ | | |
| 10 | URL directa / recarga (F5) | ☐ | ☐ | ☐ | ☐ | | |
| | **Total** | /10 | /10 | /10 | **/10** | | |

**Comprobaciones adicionales (sí/no):**

- [ ] En los 10 casos, P = R1 (sin ambigüedad).
- [ ] La fila 4 (con asociados) **no** confundió R2 con un número asociado.
- [ ] La última fila de "MOVIMIENTO" coincide con la "Fecha de Solicitud" de la bandeja en al menos 9 de 10 casos (valida el campo opcional de fecha de ingreso).
- [ ] DevTools › Network: abrir el detalle desde la bandeja genera una petición `document` → la navegación es completa (sí/no). Esto permite restringir `matches` a `detalletramite/*`.
- [ ] Ningún fragmento de la consola ni de las notas contiene datos reales. Revisar antes de guardar.
