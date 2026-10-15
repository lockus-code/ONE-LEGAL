# LEGAL · Prototipos de captura SGD y gestión de procesos

Este repositorio contiene dos prototipos:

| Carpeta | Contenido |
|---|---|
| `extension/` | **LEGAL · Conector SGD**: extensión de Chrome (Manifest V3) que lee los datos de un trámite del SGD y los vincula a un proceso legal. Solo lee. |
| `portal/` | **Portal LEGAL**: portal web estático con el panel institucional (Gerencia) y las vistas del Responsable: Mi panel, Tablero de actividades (kanban), Mis procesos, Plantillas de procesos y Trámites SGD indexados. |
| `pruebas/sgd-simulado/` | SGD simulado (inicio de sesión, bandeja y detalle de 6 expedientes ficticios) para probar la extensión sin entrar al sistema real. |
| `servidor/` | **LEGAL-Prueba**: ejecutable que levanta el entorno de prueba completo con una base de datos NoSQL embebida. |

---

## 1. Conector SGD (extensión de Chrome)

### Reglas de negocio implementadas

1. **Solo con sesión activa en el SGD.** El ícono está deshabilitado en cualquier otra página. Chrome lo habilita mediante reglas declarativas cuando la URL corresponde al SGD configurado **y** la página muestra un indicador de sesión (por ejemplo, un enlace de "Cerrar sesión"). Al abrir la extensión, la sesión se vuelve a verificar: tiene que haber un indicador de sesión y no puede verse el formulario de ingreso con contraseña. Si la verificación falla, no se muestra ningún formulario.
2. **Solo lectura.** El lector (`shared/lector.js`) solo consulta el DOM (`querySelector`, `innerText`, `value`). No hace clics, no envía formularios, no cambia valores y no hace peticiones de red. La extensión no pide los permisos `cookies`, `webRequest` ni `tabs`. Lo que se registra se guarda solo en el navegador (`chrome.storage.local`).
3. **Vinculación del trámite**:
   - **Anexar a proceso existente**: se busca por **Categoría → Procedimiento → Responsable** y por texto (código o denominación). La lista **excluye los procesos finalizados**.
   - **Generar nuevo proceso**: Categoría, Procedimiento, Responsable y Denominación. Se le asigna un código correlativo `PL-AAAA-NNNN` y queda en estado *Registrado*.
   - **Asunto de la vinculación**: descripción obligatoria de la actuación.
   - Si el mismo documento ya se indexó en el mismo proceso, se pide confirmación antes de registrarlo de nuevo.
4. **Enlace directo al trámite.** Se guarda la URL de la página del SGD sin los identificadores de sesión (`jsessionid`, `token`, `sid`…). Si hay una *plantilla de enlace permanente* configurada (por ejemplo `https://sgd…/consulta?expediente={nroExpediente}`), se usa esa.

### Datos que se leen

N.° de expediente, N.° de registro / CUT / hoja de ruta, tipo y N.° de documento, asunto, remitente, dependencia de origen, fecha del documento, estado en el SGD y usuario SGD. El lector busca etiquetas institucionales comunes ("N° Expediente", "Asunto", "Remitente", "Sumilla", etc.) en tablas, `label`, `dt/dd` y textos del tipo "Etiqueta: valor". También revisa los controles de formulario cuyo `id` o `name` identifica el dato, y como último recurso aplica un patrón de búsqueda sobre el texto de la página. Todos los campos se pueden corregir antes de registrar. Si el usuario selecciona texto en el SGD, puede usarlo como asunto.

### Instalación (modo desarrollador)

1. Descargar este repositorio.
2. En Chrome, abrir `chrome://extensions` y activar **Modo de desarrollador**.
3. Pulsar **Cargar descomprimida** y elegir la carpeta `extension/`.
4. Se abrirá **Configuración** (también disponible con clic derecho sobre el ícono → *Opciones*):
   - **Dirección(es) del SGD**: el prefijo de la URL del SGD institucional, por ejemplo `https://sgd.institucion.gob.pe/`. Al guardar, Chrome pide permiso de lectura sobre ese dominio, que hace falta para leer los marcos internos (iframes) del SGD.
   - **Indicadores de sesión**: los selectores que vienen por defecto (`a[href*='logout']`, `a[href*='salir']`…) cubren los casos más comunes. Si el ícono no se habilita con la sesión abierta, inspeccione el botón *Cerrar sesión* del SGD y agregue un selector simple, por ejemplo `#lnkSalir`. También puede usar el modo *En cualquier página del SGD*; la sesión se sigue verificando al abrir la extensión.
5. Recargar la pestaña del SGD, iniciar sesión, abrir un trámite y pulsar el ícono **LEGAL**: se abre el **panel lateral de Chrome**, que sigue a la pestaña activa y vuelve a leer la página al cambiar de trámite.

### SGD de SEDAPAR (`https://sgd.sedapar.com.pe`)

Viene configurado de fábrica (`shared/entorno.js` y `host_permissions`) y usa un lector propio, `shared/lector-sedapar.js`, construido a partir del reconocimiento estructural (`docs/11-reconocimiento-sgd.md`):

- Actúa en la página de detalle `/tramites/detalletramite/{ID}`. En la bandeja y en otras páginas el panel pide abrir un trámite.
- Espera hasta 10 s a que Angular pinte el trámite (MutationObserver).
- Lee **solo** el n.º de trámite y el ID interno de la URL. El n.º se obtiene con las estrategias P → R1 → R2 y la regla de consenso, y se normaliza a `AAAA-#####-S`. También toma la fecha de ingreso de la última fila de «MOVIMIENTO DEL EXPEDIENTE». El enlace directo es `https://sgd.sedapar.com.pe/tramites/detalletramite/{ID}`.
- **No lee** la tarjeta «DATOS DEL SOLICITANTE», el asunto, el contenido, los nombres de servidores, el menú lateral, el almacenamiento web ni las cookies. El asunto lo redacta el usuario.
- Si el número es ambiguo o no aparece, pasa a registro manual con validación del formato.
- Si el trámite muestra el componente de confidencialidad con contenido (riesgo R7), no lee ni registra nada.
- La sesión se reconoce por el diseño autenticado (`app-layout`, `sidebar-cmp`) fuera de `/pages/login`.
- Si el trámite ya está vinculado a algún proceso, el panel lo avisa.

### Prueba sin el SGD real

La forma más simple es el **entorno de prueba `LEGAL-Prueba.exe`** (sección 3). Para hacerlo a mano, sirva la raíz del repositorio con `python3 -m http.server 8765`, configure `http://localhost:8765/pruebas/sgd-simulado/` como dirección del SGD y abra esa dirección. El SGD simulado acepta cualquier usuario y contraseña; sin sesión, el conector no se habilita.

### Intercambio con el portal

- **Trámites indexados → Exportar para LEGAL** genera `legal-sgd-intercambio-AAAA-MM-DD.json` (formato `legal-sgd-intercambio`, versión 1). Ese archivo se importa en el portal desde *Trámites SGD indexados → Importar desde Conector SGD*.
- En el portal, **Exportar catálogo para el Conector** genera el catálogo de categorías, responsables y procesos, que se importa en la Configuración de la extensión.

---

## 2. Portal LEGAL

Basta con abrir `portal/index.html` en el navegador; no tiene dependencias ni necesita compilación. El selector **Perfil de acceso** cambia entre:

- **Gerente de Asesoría Jurídica**
  - *Panel institucional*: indicadores de procesos en curso, finalizados en el año, actividades vencidas, cumplimiento de plazos y trámites SGD de los últimos 30 días; procesos por categoría y por estado; trámites SGD indexados por semana; alertas de plazo; carga de trabajo por responsable. Se puede filtrar por categoría.
  - *Cartera de procesos* y *Trámites SGD indexados* de toda la entidad. El gerente solo consulta y puede comentar.
- **Responsable de procesos**
  - *Mi panel*: indicadores propios, prioridades por fecha límite, últimos trámites SGD y avance de cada proceso.
  - *Tablero de actividades*: kanban con las columnas Pendiente, En ejecución, En revisión, Observada y Concluida. Las fichas se arrastran entre columnas. Cada actividad (clave `LEG-NNN`, al estilo Jira) tiene descripción, **lista de verificación**, prioridad, fecha límite, trámites SGD vinculados con su enlace y una bitácora de comentarios.
  - *Mis procesos*: estado, avance y trámites de cada proceso.
  - *Plantillas de procesos*: 8 plantillas institucionales, organizadas en fases → actividades → lista de verificación, con plazos referenciales. **Generar proceso** crea el proceso y todas sus actividades en el tablero.
  - *Trámites SGD indexados*: expediente, documento, asunto, proceso y actividad vinculados, con la **ruta directa al SGD** (botón *Abrir* y opción de copiar la ruta).

Reglas del portal:

- Un proceso **Finalizado** no admite actividades nuevas, sus actividades no se pueden editar y no recibe trámites anexados.
- Un proceso no se puede finalizar mientras tenga actividades abiertas.
- Para concluir una actividad con ítems pendientes en la lista de verificación hay que confirmarlo.
- Las actividades vencidas y las que vencen en 7 días o menos se marcan con un ícono y una etiqueta, nunca solo con color.

Los datos de ejemplo se calculan a partir de la fecha actual. Los cambios se guardan en el `localStorage` del navegador y se pueden borrar con **Restablecer datos de ejemplo**.

---

## 3. Entorno de prueba `LEGAL-Prueba.exe`

Un único ejecutable de Windows que se inicia con **doble clic, sin ventana de consola**:

1. Crea la **base de datos de prueba** si no existe: `%LOCALAPPDATA%\LEGAL-Prueba\legal-prueba.db`. Es [bbolt](https://github.com/etcd-io/bbolt), un almacén NoSQL clave-valor embebido en un solo archivo; no hay que instalar ningún motor.
2. Copia la **extensión ya configurada** en `%LOCALAPPDATA%\LEGAL-Prueba\extension-conector-sgd`, apuntando al SGD simulado y al servidor local.
3. Levanta el servidor en `http://localhost:8790`, accesible solo desde el propio equipo:
   - `/`: Centro de pruebas, con los pasos, el estado de la BD, las últimas vinculaciones y el botón para reiniciar la BD.
   - `/sgd-simulado/`: SGD simulado con la estructura y las rutas del SGD de SEDAPAR (`/pages/login`, `/tramites/mistramites`, `/tramites/detalletramite/{ID}`), con carga asíncrona, trámites asociados, un trámite confidencial y datos ficticios.
   - `/portal/`: Portal LEGAL. Lee y guarda en la BD e incorpora cada 8 segundos lo que registra el Conector.
   - `/api/…`: API que usa el Conector (catálogo, registro de vinculaciones con las reglas de negocio) y el portal.
4. Abre el Centro de pruebas en el navegador y muestra un ícono **LEGAL** en la bandeja del sistema, junto al reloj. Desde ese ícono se abren el portal, el SGD simulado y las carpetas, o se detiene con **Detener y salir**.

Si se vuelve a hacer doble clic con el entorno ya en ejecución, solo se abre el Centro de pruebas. El registro de actividad queda en `%LOCALAPPDATA%\LEGAL-Prueba\registro.log`.

Con el servidor, el Conector muestra «Conectado a LEGAL · Entorno de prueba» y cada vinculación se valida y guarda en la BD:

- Anexar a un proceso finalizado → rechazado (409).
- Proceso inexistente → 404.
- Datos obligatorios faltantes o un procedimiento que no corresponde a la categoría → 422.
- Para los procesos nuevos, el servidor asigna el código correlativo.

Si el servidor no responde, el Conector sigue funcionando en modo local.

**Construir** (requiere Go 1.22+ y Node.js):

```bash
servidor/construir.sh     # genera servidor/dist/LEGAL-Prueba.exe y servidor/dist/legal-prueba-linux
```

El script empaqueta `portal/`, `pruebas/sgd-simulado/` y `extension/` dentro del ejecutable y corre `go vet` y las pruebas de la API (`servidor/api_test.go`). En Linux o macOS puede ejecutarse con `-sin-bandeja` y `-datos <carpeta>`.

---

## 4. Despliegue en Hetzner Cloud

El instructivo completo está en [`docs/12-despliegue-hetzner.md`](docs/12-despliegue-hetzner.md). Usa:

- `despliegue/cloud-init.yml`: deja el servidor Ubuntu 24.04 listo (Caddy con HTTPS, servicio `legal`, usuario de despliegue limitado, respaldo diario y fail2ban).
- `despliegue/Caddyfile`: proxy HTTPS con filtro por IP institucional, contraseña para el portal y bloqueo de `/api/reiniciar`.
- `.github/workflows/desplegar-hetzner.yml`: construye y prueba en cada pull request; en cada push a `main` despliega por SSH y vuelve a la versión anterior si la nueva no responde.
