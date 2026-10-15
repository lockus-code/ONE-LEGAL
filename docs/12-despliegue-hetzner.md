# 12 · Despliegue del servidor LEGAL en Hetzner Cloud con GitHub Actions

| | |
|---|---|
| **Qué se despliega** | El servidor LEGAL (`servidor/`): portal, API del Conector SGD y base de datos de prueba (bbolt) |
| **Dónde** | Un servidor virtual de Hetzner Cloud con Ubuntu 24.04 |
| **Cómo se actualiza** | Cada push a la rama `main` de GitHub construye, prueba y despliega solo (`.github/workflows/desplegar-hetzner.yml`) |
| **Archivos de apoyo** | `despliegue/cloud-init.yml`, `despliegue/Caddyfile`, `despliegue/legal.env.ejemplo`, `despliegue/legal-usuarios.ejemplo` |
| **Tiempo estimado** | 45–60 minutos la primera vez |

## 0. Cómo queda armado

```
 PC de la institución (Chrome + Conector SGD)          GitHub (repositorio lockus-code/ONE-LEGAL)
          │  HTTPS 443                                            │ push a main
          ▼                                                       ▼
 ┌────────────────────── Servidor Hetzner (Ubuntu 24.04) ───────────────────────┐
 │  Firewall de Hetzner: 22 (SSH con llave), 80 y 443                            │
 │                                                                              │
 │  Caddy (HTTPS automático con Let's Encrypt)                                  │
 │   1. solo deja pasar las IP de la institución (las demás reciben 403)        │
 │   2. bloquea /api/reiniciar                                                  │
 │   3. pide usuario y contraseña para el portal (/api/* no, la usa la extensión)│
 │        │                                                                     │
 │        ▼ 127.0.0.1:8790 (no expuesto a Internet)                              │
 │  Servicio «legal» (usuario sin privilegios)  ──►  /var/lib/legal/legal-prueba.db │
 │  Respaldo diario 03:30 ──► /var/backups/legal (14 días)                      │
 └──────────────────────────────────────────────────────────────────────────────┘
```

GitHub Actions entra por SSH con el usuario `despliegue`, que **solo** puede ejecutar `/usr/local/sbin/legal-actualizar`. Ese script instala la nueva versión, la verifica y, si no responde, vuelve a la anterior.

---

## 1. Antes de empezar

Tenga a mano lo siguiente:

- [ ] **Acceso de escritura al repositorio en GitHub.** Hoy el push a `lockus-code/ONE-LEGAL` falla con 403: la app de Claude no tiene permiso en esa organización. Hay que resolverlo antes del paso 7. Puede subir el código usted mismo o dar acceso a la app en https://github.com/apps/claude/installations/select_target.
- [ ] **Cuenta en Hetzner Cloud** (https://console.hetzner.cloud) con un medio de pago registrado.
- [ ] **Un dominio o subdominio** del que pueda crear un registro DNS, por ejemplo `legal.sudominio.pe`. Para el piloto, sin dominio, puede usar `sslip.io` (ver el paso 4).
- [ ] **La IP pública de salida de la red institucional.** Desde una PC de la oficina abra https://ifconfig.me y anote el número. Si hay varias sedes o VPN, anote todas.
- [ ] **Visto bueno del oficial de datos personales.** El servidor quedará fuera del Perú (Hetzner tiene centros en EE. UU., Alemania, Finlandia y Singapur). El banco de datos relaciona números de trámite con procesos legales (riesgo R11 de `docs/11-reconocimiento-sgd.md`). Esto es un **flujo transfronterizo** en términos de la Ley 29733 y debe evaluarse antes de cargar datos reales.

---

## 2. Crear las llaves SSH (en su PC con Windows)

Abra **PowerShell** (no hace falta ser administrador) y ejecute:

```powershell
# Llave para administrar el servidor (la usa usted)
ssh-keygen -t ed25519 -C "legal-admin" -f $HOME\.ssh\legal-admin

# Llave para GitHub Actions (la usa el despliegue automático). Deje la frase de paso VACÍA.
ssh-keygen -t ed25519 -C "legal-despliegue" -f $HOME\.ssh\legal-despliegue
```

Quedan cuatro archivos en `C:\Users\<usted>\.ssh\`:

| Archivo | Para qué | ¿Se comparte? |
|---|---|---|
| `legal-admin` | Su llave privada de administrador | **Nunca** |
| `legal-admin.pub` | Se carga en Hetzner (paso 3.2) | Sí |
| `legal-despliegue` | Se guarda como secreto en GitHub (paso 7) | Solo en GitHub |
| `legal-despliegue.pub` | Se pega en `cloud-init.yml` (paso 3.4) | Sí |

Para ver el contenido de un archivo: `Get-Content $HOME\.ssh\legal-despliegue.pub`.

---

## 3. Crear el servidor en Hetzner

### 3.1 Proyecto
Console de Hetzner → **New project** → nombre `LEGAL` → abrir el proyecto.

### 3.2 Llave SSH de administración
**Security → SSH keys → Add SSH key** → pegue el contenido de `legal-admin.pub` → nombre `legal-admin`.

### 3.3 Firewall
**Firewalls → Create Firewall** → nombre `legal-web`. Reglas **Inbound**:

| Protocolo | Puerto | Origen | Motivo |
|---|---|---|---|
| TCP | 22 | Any IPv4 / Any IPv6 | SSH. GitHub Actions cambia de IP en cada ejecución. Solo se entra con llave y fail2ban bloquea los intentos repetidos |
| TCP | 80 | Any IPv4 / Any IPv6 | Let's Encrypt valida el dominio por aquí. Caddy redirige a HTTPS |
| TCP | 443 | Any IPv4 / Any IPv6 | HTTPS. El filtro por IP institucional lo hace Caddy, para no bloquear la renovación del certificado |
| ICMP | — | Any | Diagnóstico (opcional) |

Deje **Outbound** sin reglas, es decir, todo permitido.

### 3.4 Preparar el cloud-config
1. Abra `despliegue/cloud-init.yml` del repositorio en un editor.
2. Reemplace `PEGUE_AQUI_LA_LLAVE_PUBLICA_DE_DESPLIEGUE` por **la línea completa** de `legal-despliegue.pub`, que empieza por `ssh-ed25519 …`.
3. Copie todo el contenido.

### 3.5 Servidor
**Servers → Add Server**:

| Opción | Valor recomendado |
|---|---|
| Location | **Ashburn, VA (us-east)**, la de menor latencia desde Lima. Si prefiere Europa, Nuremberg o Falkenstein |
| Image | **Ubuntu 24.04** |
| Type | **Shared vCPU · x86**, el más pequeño disponible en la ubicación (2 vCPU / 2–4 GB). Sobra para el piloto |
| Networking | Public IPv4 **y** IPv6 |
| SSH keys | Marque `legal-admin` |
| Firewalls | Marque `legal-web` |
| Backups | **Activar** (copia diaria de todo el disco, con costo adicional) |
| Cloud config | Pegue el contenido preparado en 3.4 |
| Name | `legal-piloto` |

Pulse **Create & Buy now** y anote la **IPv4** del servidor; en este documento aparece como `IP_SERVIDOR`.

---

## 4. Apuntar el dominio

En el proveedor del dominio, cree un registro **A**:

| Nombre | Tipo | Valor | TTL |
|---|---|---|---|
| `legal` (o el subdominio elegido) | A | `IP_SERVIDOR` | 300 |

Si además quiere IPv6, agregue un registro **AAAA** con la IPv6 del servidor.

**Sin dominio (solo piloto):** use `IP-CON-GUIONES.sslip.io`. Por ejemplo, si la IP es `203.0.113.10`, el dominio es `203-0-113-10.sslip.io`. Resuelve solo a esa IP y Let's Encrypt lo acepta.

Para comprobar el registro desde PowerShell: `Resolve-DnsName legal.sudominio.pe` (debe devolver `IP_SERVIDOR`).

---

## 5. Verificar que el servidor quedó preparado

Espere unos 3 minutos después de crearlo y conéctese:

```powershell
ssh -i $HOME\.ssh\legal-admin root@IP_SERVIDOR
```

Ya dentro del servidor:

```bash
cloud-init status --wait          # debe terminar en: status: done
systemctl is-active caddy         # active
systemctl is-enabled legal        # enabled (aún no corre: falta el primer despliegue)
systemctl list-timers legal-respaldo.timer
sudo -l -U despliegue             # debe listar solo /usr/local/sbin/legal-actualizar
```

Si `cloud-init status` dice `error`, revise con `less /var/log/cloud-init-output.log`.

---

## 6. Configurar el sitio (dominio, IP permitidas y usuarios del portal)

Sigue en la sesión SSH del paso 5.

**6.1 Datos del sitio**, a partir de `despliegue/legal.env.ejemplo`:

```bash
nano /etc/caddy/legal.env
```

```ini
LEGAL_DOMINIO=legal.sudominio.pe
LEGAL_CORREO_ACME=sistemas@sudominio.pe
LEGAL_IPS_PERMITIDAS=203.0.113.10/32 198.51.100.0/24
```

`LEGAL_IPS_PERMITIDAS` es la lista de IP institucionales del paso 1, separadas por espacio. Guarde con `Ctrl+O`, `Enter`, `Ctrl+X`.

**6.2 Usuarios del portal.** Genere el hash de cada contraseña:

```bash
caddy hash-password            # escriba la contraseña dos veces; copie el resultado ($2a$14$...)
nano /etc/caddy/legal-usuarios
```

Deje una línea por usuario, con el formato `usuario hash`:

```
legal $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
gerencia $2a$14$yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

Estos archivos **no** se suben a GitHub. El primer despliegue (paso 7) instalará el `Caddyfile` del repositorio, que los lee.

---

## 7. Conectar GitHub con el servidor

**7.1 Subir el código a `main`.** El despliegue automático se dispara con pushes a `main`. Hoy el trabajo está en la rama `claude/charming-einstein-556ruu`; súbala y luego abra un pull request hacia `main` y fusiónelo. El repositorio está vacío, así que también puede crear `main` desde esa rama.

**7.2 Huella del servidor.** En PowerShell, en su PC:

```powershell
ssh-keyscan -t ed25519 IP_SERVIDOR
```

Copie la línea que devuelve (empieza con la IP).

**7.3 Entorno y secretos en GitHub.** En el repositorio: **Settings → Environments → New environment** → nombre `produccion`. Opcional: en *Deployment protection rules* marque *Required reviewers* para aprobar cada despliegue. Luego, en **Environment secrets → Add secret**:

| Nombre | Valor |
|---|---|
| `HETZNER_HOST` | `IP_SERVIDOR` (o el dominio) |
| `HETZNER_SSH_KEY` | Contenido **completo** de `legal-despliegue`, la llave **privada**, incluidas las líneas `-----BEGIN…` y `-----END…` |
| `HETZNER_KNOWN_HOSTS` | La línea obtenida en 7.2 |

**7.4 Primer despliegue.** **Actions → Desplegar en Hetzner → Run workflow** sobre `main`. El trabajo:

1. **Construir y probar:** `go vet`, pruebas de la API y binarios para Linux y Windows. Ambos binarios quedan además como artefacto descargable de la ejecución.
2. **Desplegar en Hetzner:** copia el binario y el `Caddyfile`, valida el `Caddyfile` con su `legal.env`, respalda la base, instala, reinicia y verifica `/api/estado`. Si la nueva versión no responde, restaura la anterior.

A partir de aquí, **cada merge a `main` se despliega solo**. Los pull requests solo construyen y prueban.

---

## 8. Verificación final

Desde una PC de la red institucional:

1. Abra `https://legal.sudominio.pe`: lleva a `/portal/` y pide el usuario y la contraseña del paso 6.2. El candado del navegador debe estar en verde.
2. `https://legal.sudominio.pe/api/estado` devuelve un JSON con `"servicio":"legal-prueba"`.
3. Desde una red **fuera** de la lista (por ejemplo, datos móviles), la misma dirección responde «Acceso restringido a la red institucional».

**Conectar el Conector SGD al servidor**, en cada PC:

1. Clic derecho en el ícono **L** → **Opciones**.
2. En **Servidor LEGAL** escriba `https://legal.sudominio.pe`, sin barra final.
3. Pulse **Probar conexión**: debe decir «Conectado: LEGAL · Entorno de prueba…».
4. Pulse **Guardar configuración**.
5. En el SGD, abra un trámite y el panel lateral: debe mostrar «Conectado a LEGAL · Entorno de prueba».

Desde ese momento, lo que se registra en el panel queda en la base de datos del servidor y aparece en el portal en unos 8 segundos.

---

## 9. Operación

Todos estos comandos se ejecutan dentro del servidor (`ssh -i $HOME\.ssh\legal-admin root@IP_SERVIDOR`).

| Tarea | Comando |
|---|---|
| Estado del servicio | `systemctl status legal` |
| Registro del servidor LEGAL | `journalctl -u legal -n 100 --no-pager` (o `-f` para seguirlo en vivo) |
| Registro de accesos HTTPS | `tail -f /var/log/caddy/legal-acceso.log` |
| Reiniciar | `systemctl restart legal` |
| Cambiar IP permitidas o usuarios | Editar `/etc/caddy/legal.env` o `/etc/caddy/legal-usuarios` y luego `systemctl reload caddy` |
| Respaldo manual | `/usr/local/sbin/legal-respaldo manual` |
| Ver respaldos | `ls -lh /var/backups/legal` |
| Volver a la versión anterior | `mv /opt/legal/bin/legal-prueba.anterior /opt/legal/bin/legal-prueba && systemctl restart legal`. También puede reejecutar en GitHub Actions una ejecución anterior que salió bien |

**Restaurar un respaldo de la base de datos:**

```bash
systemctl stop legal
cp /var/backups/legal/legal-prueba-AAAAMMDD-HHMMSS-diario.db /var/lib/legal/legal-prueba.db
chown legal:legal /var/lib/legal/legal-prueba.db
systemctl start legal
```

Los respaldos locales viven en el mismo disco del servidor. Para resistir la pérdida del servidor completo están los **Backups de Hetzner** (paso 3.5). Para el piloto conviene además descargar una copia de vez en cuando:

```powershell
scp -i $HOME\.ssh\legal-admin root@IP_SERVIDOR:/var/backups/legal/<archivo>.db .
```

---

## 10. Límites de esta configuración (piloto)

Es suficiente para el piloto con datos de prueba. **Antes de cargar información real** hay que resolver lo siguiente:

1. **La API no identifica a cada usuario.** Las llamadas de la extensión a `/api/*` solo están protegidas por el filtro de IP institucional: cualquier equipo de esa red puede leer y registrar vinculaciones. Falta autenticación por persona, por ejemplo el token de dispositivo u OAuth descritos en el §6.3 de `docs/11-reconocimiento-sgd.md`.
2. **El portal guarda un único documento compartido.** Si dos personas editan a la vez, el último que guarda sobrescribe al otro. Falta un modelo de datos por registro.
3. **El usuario y la contraseña del portal son comunes** (autenticación básica de Caddy) y no hay roles reales: el selector de perfil del prototipo sigue disponible para todos.
4. **Base de datos de prueba:** bbolt en un solo archivo, sin replicación. Para producción conviene un motor gestionado o, al menos, respaldos fuera del servidor.
5. **El SGD simulado** (`/sgd-simulado/`) sigue publicado detrás de la misma protección. Se puede quitar en el `Caddyfile` cuando ya no se use.
6. **Ubicación de los datos:** ver el visto bueno del paso 1 (Ley 29733, flujo transfronterizo).
