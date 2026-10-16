# LEGAL · Gestión de procesos legales con indexación desde el SGD

LEGAL es un único ejecutable (`LEGAL.exe`) que se instala en **un equipo de la intranet** y ofrece a toda la red:

- el **portal web** con cuatro roles (administrador, gerente, profesional y asistente administrativo);
- la **base de datos NoSQL** (un solo archivo, `datos/legal.db`, que se crea vacía al primer inicio; no hay que instalar ningún motor);
- la **extensión de Chrome «Conector SGD»**, ya configurada para ese servidor, que lee el trámite del SGD y lo indexa en LEGAL.

| Carpeta | Contenido |
|---|---|
| `descargas/` | `LEGAL.exe` listo para descargar (Windows 64 bits). |
| `servidor/` | Código Go del servidor, la API, la base de datos y el ejecutable. |
| `portal/` | Portal web (HTML/CSS/JS sin dependencias). |
| `extension/` | Extensión Chrome (Manifest V3, panel lateral). |
| `pruebas/sgd-simulado/` | SGD simulado con la estructura del SGD de SEDAPAR y datos ficticios. |
| `docs/` | Reconocimiento del SGD (11), despliegue en Hetzner (12), KPI y alertas (13). |

---

## 1. Instalación en el equipo servidor

1. Copie `descargas/LEGAL.exe` a una carpeta fija, por ejemplo `C:\LEGAL\`.
2. Doble clic. En el primer inicio LEGAL:
   - crea **`C:\LEGAL\.env`** con la configuración (dirección IP detectada, puerto 8790, SGD…);
   - crea la **base de datos vacía** `C:\LEGAL\datos\legal.db` con la taxonomía normativa y el usuario `admin` (clave inicial `admin`, se pide cambiarla);
   - prepara la extensión en `C:\LEGAL\datos\extension-conector-sgd`;
   - abre el portal y muestra un ícono **LEGAL** junto al reloj (abrir portal, SGD simulado, carpetas, **Editar configuración (.env)**, detener).
3. Windows preguntará si permite el acceso a la red: acepte **Redes privadas** para que el resto de la intranet llegue al servidor.
4. Desde otros equipos: `http://<IP-del-servidor>:8790/` (página de inicio) o `/portal/`.

### Archivo `.env`

```ini
LEGAL_HOST=0.0.0.0                        # 0.0.0.0 = toda la intranet; 127.0.0.1 = solo este equipo
LEGAL_PUERTO=8790
LEGAL_URL_PUBLICA=http://192.168.1.25:8790  # dirección con la que los demás equipos llegan aquí
LEGAL_DATOS=datos                         # carpeta de la base de datos
LEGAL_SGD_URLS=https://sgd.sedapar.com.pe/  # uno o varios SGD, separados por coma
LEGAL_SGD_SIMULADO=si                     # publica /sgd-simulado/ para pruebas
LEGAL_ADMIN_USUARIO=admin
LEGAL_ADMIN_CLAVE_INICIAL=admin           # solo al crear la BD vacía
LEGAL_ABRIR_NAVEGADOR=si
LEGAL_SESION_HORAS=12
```

Si el equipo cambia de IP, edite `LEGAL_URL_PUBLICA`, reinicie LEGAL (ícono › *Detener y salir* y doble clic) y vuelva a descargar la extensión en los equipos (o cambie la dirección en su *Configuración*). Las variables de entorno del sistema con el mismo nombre tienen prioridad sobre el archivo. Para tener varios SGD, agréguelos a `LEGAL_SGD_URLS`; el lector propio se usa en el SGD de SEDAPAR y un lector genérico (etiquetas «Asunto», «Expediente», «Remitente»…) en los demás.

---

## 2. Roles

| Rol | Puede |
|---|---|
| **Administrador** | Todo lo anterior más: usuarios y roles, taxonomía (categorías, vías y etapas base), configuración de alertas y feriados, y la **base de datos**: explorar colecciones, editar o eliminar documentos JSON, descargar/restaurar respaldos, **vaciar datos operativos** o **vaciar todo** (confirmando con «VACIAR»). |
| **Gerente** | Panel institucional con KPI, carga por profesional, cartera completa, alertas, **aprobar u observar plantillas**, reasignar procesos, solicitar plazos. |
| **Profesional** | Sus procesos y **tablero de tareas** (arrastrar entre columnas, ficha con detalle, checklist, color y comentarios), **definir plazos** (uno a uno o en bloque), finalizar procesos; **sus plantillas** de tareas por vía (enviadas a aprobación). |
| **Asistente administrativo** | Indexar trámites desde el SGD con la extensión, registrar procesos, ver la cartera, **solicitar la definición de plazos**. |

Los KPI y las reglas de alerta están en [`docs/13-kpi-y-alertas.md`](docs/13-kpi-y-alertas.md).

## 3. Categorías, vías y plantillas

La elección del proceso sigue la jerarquía normativa peruana: **Categoría** (Civil, Penal, Laboral, Contencioso administrativo, Constitucional, Arbitraje y medios alternativos, Administrativo, Ejecución coactiva, Asesoría consultiva) → **Vía procedimental** (p. ej. Civil › Conocimiento, Abreviado, Sumarísimo, Cautelar, Único de ejecución, No contencioso) → **Profesional**. Cada vía trae sus etapas normativas base con plazos referenciales (CPC, NCPP, NLPT, TUO Ley 27584, Nuevo Código Procesal Constitucional, D. Leg. 1071, TUO Ley 27444, Ley 30057, TUO Ley 26979). El administrador puede editarlas.

Cada **profesional** define su plantilla de tareas por vía (puede partir de las etapas base). Cada tarea tiene plazo fijo (días hábiles o calendario, desde el inicio del proceso o desde que concluye la antecesora) o queda **por definir**.

**Aprobación:** cada versión que guarda el profesional queda *por aprobar*; la gerencia (o el administrador) la **aprueba** o la **observa** con un comentario. Solo las vías con plantilla aprobada se ofrecen para crear procesos (portal y extensión), y el ciclo se genera con la última versión aprobada aunque haya una nueva en revisión.

## Tablero de tareas (profesional)

- Columnas **Por hacer · En proceso · En revisión · Finalizada**; las fichas se **arrastran con el mouse**.
- Solo se muestran las tareas **habilitadas**: sin antecesora o con la antecesora finalizada. El servidor rechaza avanzar una tarea cuya antecesora no finalizó.
- **Retroceder** una ficha a una columna anterior pide una **justificación**, que queda en los comentarios y el historial.
- Al hacer clic se abre la **ficha de la tarea**: título y descripción editables, estado, fecha límite o plazo en días, **lista de verificación**, **color**, **comentarios**, historial, antecesora/sucesoras y documentos del SGD relacionados.
- Cada ficha muestra su vencimiento (vencida, por vencer, vigente o por definir).

## 4. Extensión Conector SGD

**Instalación en cada equipo:** en el portal, *Cuenta › Instalar la extensión* (o `http://<servidor>:8790/descargas/conector-sgd.zip`), descomprimir, `chrome://extensions` › *Modo de desarrollador* › *Cargar descomprimida*. La extensión ya apunta al servidor.

**Uso:** abrir el detalle de un trámite en el SGD (con sesión iniciada) y pulsar el ícono LEGAL. En el panel lateral:

1. Ingresar con el usuario del portal (una vez por semana).
2. **Trámite del SGD**: n.º de trámite, ID interno, **asunto** (leído del SGD — en SEDAPAR, el `<p class="text-muted">` que sigue al rótulo ASUNTO — y corregible), **fecha de ingreso** (será la fecha de inicio del proceso) y enlace directo.
3. **¿Qué desea hacer?** (desplegable):
   - *Crear un proceso nuevo* → **Elegir primero**: *el profesional* (Profesional → Vía, agrupadas por categoría) o *la categoría* (Categoría → Vía → Profesional). **Solo aparecen vías con plantilla aprobada.** Muestra qué ciclo se generará. **No se pide correlativo**: el código `PL-AAAA-NNNN` lo asigna LEGAL.
   - *Anexar a un proceso existente* → **Buscar por**: *profesional* o *categoría y vía*; el desplegable de procesos se agrupa por Categoría › Vía, muestra su fecha de inicio y excluye los finalizados. Opcional: **tarea relacionada**.
   - Si quien ingresa es un **profesional**, solo se ve a sí mismo y solo ve sus propios procesos.
4. **Detalle de la indexación** (opcional): un asunto propio, distinto del asunto del trámite.
5. **Indexar en LEGAL**. Se guarda en la base de datos del servidor y aparece en el portal (proceso, Trámites SGD, paneles) en segundos.

La pestaña **Mis indexaciones** lista lo registrado, con un desplegable de acciones (abrir en el SGD, ver en el portal, copiar enlace, quitar). El conector solo lee la página: no hace clics en el SGD, no lee la tarjeta del solicitante, el contenido ni las cookies, y no actúa en trámites con indicador de confidencialidad.

## 5. Pruebas con el SGD simulado

Con `LEGAL_SGD_SIMULADO=si`, `http://<servidor>:8790/sgd-simulado/` reproduce las rutas del SGD de SEDAPAR con 5 trámites ficticios (acepta cualquier usuario). La extensión descargada ya lo incluye entre los SGD habilitados.

Recorrido sugerido con la BD vacía: `admin` crea un profesional, un asistente y un gerente → el profesional crea su plantilla (p. ej. Contencioso administrativo › Proceso ordinario) → el gerente la aprueba → el asistente indexa el trámite 2026-00871-12 como proceso nuevo y anexa el 2026-01234-3 → el profesional mueve la primera tarea en *Mis tareas* hasta *Finalizada* y define en *Plazos por definir* el plazo que quedó pendiente → el gerente revisa el panel institucional.

## 6. Construir

Requiere Go 1.24+:

```bash
servidor/construir.sh   # go vet, pruebas y servidor/dist/LEGAL.exe + servidor/dist/legal-linux
```

En Linux: `legal-linux -sin-bandeja` (en ese modo el `.env` nuevo escucha en 127.0.0.1); opciones `-datos`, `-config`, `-host`, `-no-abrir`. El despliegue en Hetzner Cloud (Caddy + HTTPS) está en [`docs/12-despliegue-hetzner.md`](docs/12-despliegue-hetzner.md).
