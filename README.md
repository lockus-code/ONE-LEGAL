# LEGAL · Prototipos de captura SGD y gestión de procesos

Este repositorio contiene dos prototipos:

| Carpeta | Contenido |
|---|---|
| `extension/` | **LEGAL · Conector SGD**: extensión de Chrome (Manifest V3) que lee los datos de un trámite del SGD y los vincula a un proceso legal. Solo lee. |
| `portal/` | **Portal LEGAL**: portal web estático con el panel institucional (Gerencia) y las vistas del Responsable: Mi panel, Tablero de actividades (kanban), Mis procesos, Plantillas de procesos y Trámites SGD indexados. |
| `pruebas/sgd-simulado/` | Página que imita una vista de detalle de expediente del SGD, para probar la extensión sin entrar al sistema real. |

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
5. Recargar la pestaña del SGD, iniciar sesión, abrir un trámite y pulsar el ícono **LEGAL**.

### Prueba sin el SGD real

```bash
python3 -m http.server 8765      # desde la raíz del repositorio
```

En Configuración, registrar `http://localhost:8765/pruebas/sgd-simulado/` y abrir `http://localhost:8765/pruebas/sgd-simulado/index.html`. Con `?sesion=0` se simula la pantalla de ingreso, y el conector no se habilita.

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
