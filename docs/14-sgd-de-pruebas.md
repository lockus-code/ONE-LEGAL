# 14 · SGD de pruebas (especificación funcional y banco de pruebas)

| | |
|---|---|
| **Versión** | 2.0.0 (`SGD.VERSION` en `pruebas/sgd-simulado/nucleo.js`) |
| **Para qué sirve** | Entorno de pruebas **funcional y multiusuario** con la forma del SGD de SEDAPAR (docs/11): registrar, derivar entre áreas y usuarios, recibir, atender, observar, archivar, asociar trámites, subir y ver documentos. Sirve para probar LEGAL, la extensión «Conector SGD» y cualquier software futuro que lea o se integre con un SGD. |
| **Datos** | Todos ficticios. No usar datos reales. |
| **Dónde** | `http://<servidor>:8790/sgd-simulado/` (LEGAL.exe con `LEGAL_SGD_SIMULADO=si`) o `node pruebas/sgd-simulado/pruebas/servidor-local.js` |

Donde el SGD real no está determinado (docs/11 §7.3), aquí se elige un **supuesto** y se marca así. Si sistemas aclara la duda, se cambia la regla en `nucleo.js` y su prueba.

---

## 1. Arquitectura

```
pruebas/sgd-simulado/
  nucleo.js        Motor de reglas sin DOM (navegador y Node): modelo, reglas RN-xx, acciones, consultas.
  escenarios.js    Trámites ficticios + resultado esperado de un lector del DOM.
  datos.js         Capa del navegador: persistencia, sesión, diseño de página.
  rutas.json       Rutas (las usan servidor/api.go y pruebas/servidor-local.js).
  *.html           Páginas: login, dashboard, mistramites, listadotramites, nuevotramiteint, detalletramite, consola.
  pruebas/         nucleo.test.js (node --test) · navegador.e2e.js (Playwright) · servidor-local.js
servidor/sgd_pruebas.go   Almacén compartido: /sgd-simulado/api/… (base aparte datos/sgd-pruebas.db)
```

**Una sola fuente de reglas.** Todas las reglas viven en `nucleo.js`. El servidor solo guarda:

- el **estado** completo (JSON) con número de **versión**. Cada acción del navegador lee el estado más reciente, aplica la regla y escribe con la versión que leyó; si otro usuario escribió antes, el servidor responde `409` y el navegador repite la acción sobre el estado nuevo (concurrencia optimista). Así varios usuarios en distintos equipos trabajan sobre los mismos trámites;
- los **archivos** subidos (hasta 20 MB cada uno).

Sin servidor (página abierta de otro modo), el estado queda en `localStorage` del navegador (modo «local», archivos hasta 2 MB). La barra lateral indica el modo.

La base `datos/sgd-pruebas.db` **no se mezcla** con `legal.db`: no entra en los respaldos de LEGAL ni se borra con «vaciar». Se restablece desde la consola.

### API del almacén (`/sgd-simulado/api/`)

Las escrituras exigen la cabecera `X-SGD-Pruebas: 1` (fuerza una consulta previa CORS: otra página no puede escribir aquí desde el navegador).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET estado` | — | `{version, estado}` (`estado` = `null` si está vacío) |
| `PUT estado` | `{version, estado}` | `200 {version}` · `409 {mensaje, version}` si la versión no es la actual |
| `POST archivos?nombre=…` | bytes del archivo | `201 {id, bytes}` · `400` extensión no permitida · `413` vacío o > 20 MB |
| `GET archivos/{id}` | — | el archivo (`inline`; `?descargar=1` → `attachment`) |
| `POST reiniciar` | — | borra estado y archivos; el navegador vuelve a cargar los escenarios |

---

## 2. Modelo de datos

**Trámite**

| Campo | Descripción |
|---|---|
| `id` | ID interno de 6 dígitos (va en la URL `/tramites/detalletramite/{id}`). **No** es el n.º de trámite (docs/11 §3.1) |
| `numero` | Forma canónica `AAAA-#####-S`; en pantalla `AAAA - ##### - S` |
| `tipo` | CARTA, CÉDULA, INFORME, MEMORANDO, OFICIO, RECURSO, RESOLUCIÓN, SOLICITUD |
| `origen` | INTERNO o EXTERNO (Mesa de Partes, con `solicitante`) |
| `areaOrigen`, `areaActual`, `asignadoA` | Dónde nació, dónde está y a qué usuario se derivó (opcional) |
| `estado` | Ver §4 |
| `asunto`, `contenido`, `confidencial` | — |
| `asociados` | N.º de trámites asociados (relación simétrica) |
| `adjuntos[]` | `{nombre, extension, tipo, bytes, descripcion, publico, fecha, area, usuario}` + `texto` (documento redactado) o `archivoId` (en el servidor) o `datos` (data: URL, modo local) |
| `movimientos[]` | Filas inmutables `{fecha, area, estado, usuario, proveido, fechaLimite, fechaLeido, desdeArea, desdeUsuario, paraUsuario}` |
| `render` | Solo escenarios: variantes de plantilla (§7) |

Las fechas se guardan y muestran como en el SGD: `dd/mm/aaaa HH:mm:ss`.

---

## 3. Usuarios y perfiles de prueba

Contraseña común: **`prueba`**. La página de ingreso y la consola listan todos.

| Perfil | Puede |
|---|---|
| `MESA_PARTES` | registrar (externos), derivar, recibir, adjuntar, asociar, anular |
| `OPERADOR` | registrar (internos), derivar, recibir, iniciar, observar, atender, adjuntar, asociar, anular |
| `JEFE` | lo del operador + archivar, desarchivar y cambiar la confidencialidad |
| `CONSULTA` | solo lectura |

| Usuario | Área | Perfil |
|---|---|---|
| `usuario.prueba`, `abogado.uno`, `abogado.dos` | Gerencia de Asesoría Jurídica | OPERADOR |
| `jefe.juridico` | Gerencia de Asesoría Jurídica | JEFE |
| `mesa.partes` | Mesa de Partes | MESA_PARTES |
| `tramite.doc` | Trámite Documentario | OPERADOR |
| `gerente.general` | Gerencia General | JEFE |
| `comercial` / `jefe.comercial` | Gerencia Comercial | OPERADOR / JEFE |
| `operaciones` | Gerencia de Operaciones | OPERADOR |
| `logistica` / `jefe.logistica` | Área de Logística | OPERADOR / JEFE |
| `control` | Órgano de Control Institucional | OPERADOR |
| `archivo` | Archivo Central | JEFE |
| `consulta` | Gerencia de Asesoría Jurídica | CONSULTA |
| `inactivo` | — | dado de baja (para probar RN-01) |

---

## 4. Estados y acciones

| Acción | Desde | Hacia | Notas |
|---|---|---|---|
| Registrar | — | REGISTRADO | Opcional: agregar a un expediente existente, asociar a otro trámite, adjuntar el documento principal y derivar en el mismo paso (todo o nada) |
| Derivar | REGISTRADO, RECIBIDO, EN PROCESO, OBSERVADO, ATENDIDO | DERIVADO | A un área y, opcionalmente, a un usuario de esa área; plazo en días hábiles; proveído |
| Recibir | DERIVADO | RECIBIDO | Registra «Fecha leído» en la derivación |
| Iniciar atención | RECIBIDO | EN PROCESO | |
| Observar y devolver | RECIBIDO, EN PROCESO | OBSERVADO | Vuelve al área y usuario que derivó, con motivo |
| Atender | EN PROCESO | ATENDIDO | Respuesta opcional |
| Archivar | RECIBIDO, EN PROCESO, ATENDIDO, OBSERVADO | ARCHIVADO | JEFE, con motivo |
| Desarchivar | ARCHIVADO | EN PROCESO | JEFE, con motivo |
| Anular | REGISTRADO (nunca derivado) | ANULADO (final) | Área que registró, con motivo |
| Adjuntar | cualquiera menos ARCHIVADO/ANULADO | — | Subir archivo o redactar documento de texto |
| Asociar | cualquiera | — | Relación simétrica |
| Confidencialidad | cualquiera | — | JEFE del área de origen o actual |

Todas las acciones (salvo registrar) exigen que el trámite esté en el **área del usuario** (RN-03).

**Documentos:** se admiten `txt, pdf, docx, xlsx, jpg, png` (hasta 20 MB). El visor del detalle muestra texto, PDF e imágenes; Word y Excel se descargan. «Redactar documento» guarda un `.txt` escrito en la propia página. Cada escenario trae al menos un documento de texto, y el 250101 además un PDF.

---

## 5. Reglas de negocio

Cada acción rechazada lanza `SGDError` con uno de estos códigos, que la interfaz muestra tal cual. La consola los lista desde `SGD.REGLAS`.

| Código | Regla |
|---|---|
| RN-00 | El trámite existe |
| RN-01 | Usuario de prueba existente y activo; contraseña `prueba` |
| RN-02 | Cada perfil solo ejecuta sus acciones; CONSULTA es solo lectura; solo Mesa de Partes registra externos |
| RN-03 | Solo el área actual actúa sobre el trámite |
| RN-04 | Solo las transiciones de §4; ANULADO es final |
| RN-05 | Asunto de 5 a 1000 caracteres |
| RN-06 | Tipo, origen y áreas del catálogo |
| RN-07 | N.º `AAAA - ##### - S`: correlativo anual de 5 dígitos; `S = 1` en expediente nuevo; `S = máx + 1` al agregar un documento a un expediente (**supuesto**: docs/11 §3.1 no determina el significado del grupo 3). El número no cambia |
| RN-08 | ID interno de 6 dígitos, secuencial, distinto del número, nunca reutilizado |
| RN-09 | Derivación: área del catálogo y distinta de la actual; usuario destino (opcional) activo y de esa área; plazo de 1 a 30 días hábiles; proveído obligatorio |
| RN-10 | Plazos en días hábiles (lunes a viernes sin feriados nacionales, mismo cálculo que `servidor/fechas.go`). Semáforo: vencido = rojo; ≤ 2 días = ámbar; resto = verde |
| RN-11 | Abrir el detalle **no** registra «Fecha leído»; lo hace Recibir. La consola permite activar lo contrario para probar la hipótesis R9 de docs/11 |
| RN-12 | Archivar y desarchivar: perfil JEFE y motivo |
| RN-13 | Anular: solo REGISTRADO sin derivar, por el área que registró, con motivo |
| RN-14 | Adjuntos: extensiones permitidas, ≤ 20 MB, nombre único por trámite, no en trámites cerrados |
| RN-15 | Asociación entre trámites existentes y distintos, sin duplicados, simétrica |
| RN-16 | Confidencial: fuera de las áreas de origen y actual el asunto se muestra como «TRÁMITE RESERVADO» y no se ven contenido, solicitante ni adjuntos |
| RN-17 | Cada acción agrega una fila de movimiento; se muestran en orden descendente y la última es el registro inicial |
| RN-18 | Observar devuelve al área y usuario anteriores, con motivo |
| RN-19 | Bandeja: trámites del área del usuario, sin cerrados salvo filtro, 20 por página, recientes primero; filtro «asignados a mí» |
| RN-20 | Seguimiento: exige al menos un filtro, como el SGD real |
| RN-21 | Bitácora de toda acción (también inicios de sesión y rechazos): quién, qué, cuándo, resultado |

---

## 6. Páginas y estructura del DOM

| Ruta | Componente | Contenido |
|---|---|---|
| `/pages/login` | — | Ingreso; tabla de usuarios de prueba |
| `/dashboard` | `app-dashboard` | Indicadores del área (por recibir, en proceso, vencidos) |
| `/tramites/mistramites` | `app-mistramites` | Bandeja con los encabezados del SGD real (docs/11 §3.3), filtros, paginación, «Recibir» |
| `/tramites/listadotramites` | `app-listadotramites` | Seguimiento: número, asunto, estado, tipo, área y fechas |
| `/tramites/nuevotramiteint` | `app-nuevotramiteint` | Registro (`?expediente=AAAA-#####`, `?asociarA=n.º`) |
| `/tramites/detalletramite/{id}` | `app-detalletramite` | Detalle con la estructura de docs/11 §3.2, acciones, archivos y visor, movimientos y asociados |
| `/pages/login/exit` | — | Cierra la sesión |
| `/consola` | — | Banco de pruebas (§8) |

El detalle conserva lo que leen los lectores: `app-root > app-layout > … > app-detalletramite`, `legend.title .col-sm-5 > strong` con el número, la tarjeta «DATOS DEL EXPEDIENTE» con `ASUNTO` en `p.text-muted`, «MOVIMIENTO DEL EXPEDIENTE» con la fecha en la primera celda, `tramites-detalle-tramite-confidential` y la tarjeta «DATOS DEL SOLICITANTE» (datos ficticios, para comprobar que un lector **no** la lee). Las acciones van en tarjetas aparte para no contaminar la tarjeta del expediente.

---

## 7. Escenarios

`escenarios.js` define 19 trámites. Cada uno trae `etiquetas`, `descripcion` y `esperado` (lo que debe devolver un lector correcto como `leerPaginaSedapar`, viendo el detalle con `usuario.prueba`).

| ID | Caso | Esperado |
|---|---|---|
| 250101 | Base, grupo 3 de 1 dígito, plazo vencido, documento de texto y PDF | `2026-01234-3` |
| 250102 | Grupo 3 de 2 dígitos, asociados, externo, n.º judicial en el contenido | `2026-00871-12` |
| 250098 / 250099 | Mismo expediente: atendido / archivado | `2026-00871-11` / `-10` |
| 250103 | Año anterior (2025), en proceso | `2025-04410-1` |
| 250104 | Confidencial (R7) | número + `confidencial: true` |
| 250105 | Asunto en minúsculas con una referencia parecida a un número | `2026-01322-2` |
| 250106 | Más de 10 movimientos, observado y reenviado | `2026-00502-1` |
| 250107 | Número con guion largo (en dash) | `2026-01400-1` |
| 250108 | Número sin espacios | `2026-01401-2` |
| 250109 | Correlativo sin ceros | `2026-00077-4` |
| 250110 | Grupo 3 de tres dígitos | `2026-00450-101` |
| 250111 | Plantilla sin `<strong>`: solo funciona R2 | `2026-01500-1` |
| 250112 | Otro `legend.title .col-sm-5 > strong` antes: P ≠ R1 | `AMBIGUOUS` |
| 250113 | La carga falla: el número nunca aparece | `NO_NODE` |
| 250114 | Carga lenta (4 s) | `2026-01503-1` |
| 250115 | Otro número dentro de la tarjeta: R2 ambiguo, P y R1 mandan | `2026-01504-3` |
| 250116 | Rótulo «DATOS DEL TRÁMITE»: solo funciona P | `2026-01505-1` |
| 250117 | Registrado sin derivar (para probar Anular) | `2026-01506-1` |

Para agregar un caso: añadir un objeto a `escenarios.js` con un ID y número nuevos, sus `movimientos` (recientes primero), `etiquetas`, `descripcion` y `esperado`. `nucleo.test.js` valida su coherencia y `navegador.e2e.js` lo prueba con el lector.

---

## 8. Consola de pruebas (`/sgd-simulado/consola`)

- **Opciones:** «abrir el detalle registra Fecha leído» (hipótesis R9), expiración de la sesión por inactividad (prueba R5: la página vuelve al login) y factor de latencia de las llamadas simuladas.
- **Restablecer escenarios:** vuelve al estado inicial para todos los usuarios (borra cambios y archivos).
- **Exportar / importar** el estado en JSON (los archivos subidos al servidor no viajan en el JSON; los documentos redactados sí).
- Tablas de escenarios, usuarios, reglas, máquina de estados, bitácora y la correspondencia con los endpoints del SGD real (docs/11 §5).

---

## 9. Pruebas automáticas

```bash
# Reglas y flujos del núcleo (sin dependencias; corre también en CI)
node --test pruebas/sgd-simulado/pruebas/*.test.js

# Navegador real (Playwright): lector de la extensión contra los 19 escenarios,
# flujo multiusuario con archivos y expiración de sesión
node pruebas/sgd-simulado/pruebas/navegador.e2e.js
SGD_URL=http://127.0.0.1:8790/sgd-simulado node pruebas/sgd-simulado/pruebas/navegador.e2e.js   # contra LEGAL.exe

# API del almacén en Go
cd servidor && go test ./...
```

Criterio de aceptación para un lector (docs/11 §9): todos los escenarios con su `esperado` y **0 falsos positivos**. Estado actual del lector de la extensión: 19/19.

## 10. Uso por otros sistemas

- **Leer el DOM** (como la extensión): apuntar a `/sgd-simulado/tramites/detalletramite/{id}` y comparar con `esperado`.
- **Usar las reglas sin navegador:** `const SGD = require('pruebas/sgd-simulado/nucleo.js'); const sgd = SGD.crear({ reloj }); sgd.cargarEscenarios(require('…/escenarios.js'));` y llamar a `registrar`, `derivar`, `recibir`, `bandeja`, `buscar`, etc. El reloj se inyecta para fijar fechas en las pruebas.
- **Adaptador del SGD real:** `SGD.CONTRATO_REST` relaciona cada endpoint observado en el SGD real con la función equivalente del núcleo, para cuando sistemas publique una API documentada.

> El SGD de pruebas no protege nada real: la autenticación es del lado del navegador y la contraseña es común. No lo publique en Internet sin la protección de acceso de docs/12, y no cargue datos reales.
