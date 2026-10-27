// SGD-Pruebas: SGD de pruebas independiente (docs/14), en un solo ejecutable.
//
// Al ejecutarse (doble clic, sin consola):
//   - crea sgd-pruebas.env junto al ejecutable si no existe (interfaz y puerto);
//   - crea la base sgd-datos/sgd-pruebas.db con los escenarios ficticios en el primer uso;
//   - publica en la red el SGD (/sgd-simulado/), la consola de pruebas y la API REST v1
//     para probar cualquier software, y muestra un ícono en la bandeja del sistema.
//
// No necesita LEGAL ni ningún otro programa instalado.
package main

import (
	"bufio"
	"context"
	_ "embed"
	"flag"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"fyne.io/systray"

	"github.com/lockus-code/one-legal/servidor/sgdpruebas"
)

//go:embed recursos/icono.ico
var iconoICO []byte

//go:embed recursos/icono.png
var iconoPNG []byte

var version = "2.0.0"

const plantillaEnv = `# SGD de pruebas · configuración (docs/14-sgd-de-pruebas.md)
# Reinicie SGD-Pruebas después de cambiar este archivo.

# Interfaz de escucha: 0.0.0.0 = toda la red (otros equipos y sistemas); 127.0.0.1 = solo este equipo.
SGD_HOST=0.0.0.0

# Puerto (LEGAL usa 8790; el SGD de pruebas, 8791).
SGD_PUERTO=8791

# Carpeta de datos (relativa a este archivo o absoluta).
SGD_DATOS=sgd-datos

# Abrir el navegador al iniciar (si / no).
SGD_ABRIR_NAVEGADOR=si
`

type config struct {
	host, datos, rutaEnv string
	puerto               int
	abrir                bool
}

func main() {
	sinBandeja := flag.Bool("sin-bandeja", false, "no mostrar el ícono en la bandeja del sistema (modo servicio)")
	noAbrir := flag.Bool("no-abrir", false, "no abrir el navegador al iniciar")
	puerto := flag.Int("puerto", 0, "puerto (por defecto, el de sgd-pruebas.env)")
	host := flag.String("host", "", "interfaz de escucha (por defecto, la de sgd-pruebas.env)")
	datos := flag.String("datos", "", "carpeta de datos (por defecto, la de sgd-pruebas.env)")
	dirConfig := flag.String("config", "", "carpeta de sgd-pruebas.env (por defecto, la del ejecutable)")
	flag.Parse()

	base := *dirConfig
	if base == "" {
		base = carpetaEjecutable()
	}
	if !escribible(base) {
		if d, err := os.UserConfigDir(); err == nil {
			base = filepath.Join(d, "SGD-Pruebas")
		}
	}
	os.MkdirAll(base, 0o755)
	cfg := cargarConfig(base)
	if *puerto != 0 {
		cfg.puerto = *puerto
	}
	if *host != "" {
		cfg.host = *host
	}
	if *datos != "" {
		cfg.datos = *datos
	}
	if *noAbrir || *sinBandeja {
		cfg.abrir = false
	}
	if err := os.MkdirAll(cfg.datos, 0o755); err != nil {
		fallar("No se pudo crear la carpeta de datos "+cfg.datos, err)
	}
	if f, err := os.OpenFile(filepath.Join(cfg.datos, "registro.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}

	local := fmt.Sprintf("http://127.0.0.1:%d", cfg.puerto)
	direccion := net.JoinHostPort(cfg.host, strconv.Itoa(cfg.puerto))
	ln, err := net.Listen("tcp", direccion)
	if err != nil {
		// Ya hay una instancia en ejecución (o el puerto está ocupado): se abre la existente.
		log.Printf("No se pudo escuchar en %s (%v); se abre la instancia existente", direccion, err)
		if cfg.abrir {
			abrirNavegador(local + "/")
		}
		return
	}

	sgd := sgdpruebas.Nuevo(filepath.Join(cfg.datos, "sgd-pruebas.db"))
	mux := http.NewServeMux()
	mux.Handle(sgdpruebas.Prefijo, sgd.Handler())
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.Redirect(w, r, sgdpruebas.Prefijo, http.StatusFound)
			return
		}
		inicio(w, r, cfg, sgd.Version())
	})
	httpSrv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("Servidor detenido: %v", err)
		}
	}()
	log.Printf("SGD-Pruebas %s (núcleo %s) escuchando en %s · %s · datos en %s · configuración %s",
		version, sgd.Version(), direccion, strings.Join(urlsRed(cfg), " "), cfg.datos, cfg.rutaEnv)
	if cfg.abrir {
		abrirNavegador(local + "/")
	}

	detener := func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancelar()
		httpSrv.Shutdown(ctx)
		sgd.Cerrar()
		log.Print("SGD-Pruebas detenido")
	}

	if *sinBandeja || (runtime.GOOS != "windows" && os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "") {
		señales := make(chan os.Signal, 1)
		signal.Notify(señales, os.Interrupt, syscall.SIGTERM)
		<-señales
		detener()
		return
	}
	systray.Run(func() {
		if runtime.GOOS == "windows" {
			systray.SetIcon(iconoICO)
		} else {
			systray.SetIcon(iconoPNG)
		}
		systray.SetTitle("SGD-Pruebas")
		systray.SetTooltip(fmt.Sprintf("SGD de pruebas · puerto %d", cfg.puerto))
		abrirSGD := systray.AddMenuItem("Abrir el SGD de pruebas", "")
		consola := systray.AddMenuItem("Consola de pruebas", "")
		api := systray.AddMenuItem("Direcciones y API para otros sistemas", "")
		systray.AddSeparator()
		carpeta := systray.AddMenuItem("Abrir carpeta de datos", "")
		editar := systray.AddMenuItem("Editar configuración (sgd-pruebas.env)", "")
		systray.AddSeparator()
		salir := systray.AddMenuItem("Detener SGD-Pruebas", "")
		go func() {
			for {
				select {
				case <-abrirSGD.ClickedCh:
					abrirNavegador(local + sgdpruebas.Prefijo)
				case <-consola.ClickedCh:
					abrirNavegador(local + sgdpruebas.Prefijo + "consola")
				case <-api.ClickedCh:
					abrirNavegador(local + "/")
				case <-carpeta.ClickedCh:
					abrirCarpeta(cfg.datos)
				case <-editar.ClickedCh:
					editarArchivo(cfg.rutaEnv)
				case <-salir.ClickedCh:
					systray.Quit()
				}
			}
		}()
	}, detener)
}

func cargarConfig(base string) config {
	ruta := filepath.Join(base, "sgd-pruebas.env")
	if _, err := os.Stat(ruta); os.IsNotExist(err) {
		os.WriteFile(ruta, []byte(strings.ReplaceAll(plantillaEnv, "\n", finDeLinea)), 0o644)
		log.Printf("Se creó la configuración %s", ruta)
	}
	valores := map[string]string{}
	if f, err := os.Open(ruta); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			linea := strings.TrimSpace(sc.Text())
			if linea == "" || strings.HasPrefix(linea, "#") {
				continue
			}
			if k, v, ok := strings.Cut(linea, "="); ok {
				valores[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
			}
		}
		f.Close()
	}
	obtener := func(k, porDefecto string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		if v := valores[k]; v != "" {
			return v
		}
		return porDefecto
	}
	c := config{rutaEnv: ruta, host: obtener("SGD_HOST", "0.0.0.0"), datos: obtener("SGD_DATOS", "sgd-datos")}
	c.puerto, _ = strconv.Atoi(obtener("SGD_PUERTO", "8791"))
	if c.puerto <= 0 || c.puerto > 65535 {
		c.puerto = 8791
	}
	c.abrir = strings.ToLower(obtener("SGD_ABRIR_NAVEGADOR", "si")) != "no"
	if !filepath.IsAbs(c.datos) {
		c.datos = filepath.Join(base, c.datos)
	}
	return c
}

// urlsRed: direcciones con que otros equipos de la red llegan a este SGD.
func urlsRed(cfg config) []string {
	if cfg.host != "0.0.0.0" && cfg.host != "" && cfg.host != "::" {
		return []string{fmt.Sprintf("http://%s:%d", cfg.host, cfg.puerto)}
	}
	urls := []string{}
	if ifaces, err := net.Interfaces(); err == nil {
		for _, i := range ifaces {
			if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
				continue
			}
			dirs, _ := i.Addrs()
			for _, d := range dirs {
				if ip, ok := d.(*net.IPNet); ok && ip.IP.To4() != nil {
					urls = append(urls, fmt.Sprintf("http://%s:%d", ip.IP, cfg.puerto))
				}
			}
		}
	}
	return append(urls, fmt.Sprintf("http://localhost:%d", cfg.puerto))
}

var paginaInicio = template.Must(template.New("inicio").Parse(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SGD de pruebas</title><link rel="icon" href="data:,">
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f5;color:#1d2b27}
main{max-width:960px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;color:#0d6e55}h2{margin-top:28px;font-size:18px}
.botones{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.botones a{background:#0d6e55;color:#fff;text-decoration:none;padding:10px 16px;border-radius:4px}
.botones a.sec{background:#fff;color:#0d6e55;border:1px solid #0d6e55}
code,pre{background:#fff;border:1px solid #dde3e1;border-radius:4px;font-size:13px}
code{padding:1px 5px}pre{padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border-bottom:1px solid #e6ebe9;padding:6px 8px;text-align:left;vertical-align:top;font-size:14px}
.aviso{background:#fff6d5;border:1px solid #ecd78f;padding:10px;border-radius:4px}
</style></head><body><main>
<h1>SGD de pruebas</h1>
<p>Versión {{.Version}} · núcleo de reglas {{.Nucleo}} · datos ficticios.</p>
<div class="botones"><a href="/sgd-simulado/">Abrir el SGD</a><a class="sec" href="/sgd-simulado/consola">Consola de pruebas</a><a class="sec" href="/sgd-simulado/api/v1">API v1 (JSON)</a></div>
<p class="aviso">Usuarios de prueba con la contraseña <b>prueba</b> (p. ej. <code>usuario.prueba</code>, <code>mesa.partes</code>, <code>jefe.juridico</code>, <code>logistica</code>). La lista completa está en la pantalla de ingreso y en la consola. No cargue datos reales.</p>

<h2>Direcciones para otros equipos y sistemas</h2>
<table>{{range .URLs}}<tr><td><code>{{.}}/sgd-simulado/</code></td></tr>{{end}}</table>
<p>Para leer la página del SGD (como la extensión Conector SGD), use las rutas del SGD de SEDAPAR bajo <code>/sgd-simulado/</code>, p. ej. <code>/sgd-simulado/tramites/detalletramite/250101</code>.</p>

<h2>API REST v1</h2>
<p>JSON, autenticación HTTP Basic con un usuario de prueba. Aplica las mismas reglas (RN-xx) que la interfaz y comparte sus datos. Errores: <code>{"codigo":"RN-xx","mensaje":"…"}</code> con 401 (RN-01), 403 (RN-02/03/16), 404 (RN-00) o 422 (resto).</p>
<table>
<tr><th>Método y ruta (bajo <code>/sgd-simulado/api/v1</code>)</th><th>Para qué</th></tr>
<tr><td><code>GET /</code> · <code>GET /catalogos</code> · <code>GET /escenarios</code></td><td>Reglas, acciones y perfiles · áreas, tipos, estados, usuarios · escenarios con su resultado esperado (sin autenticación)</td></tr>
<tr><td><code>GET /bandeja?estado=&amp;asignadosAMi=1&amp;pagina=</code></td><td>Mis Trámites del usuario</td></tr>
<tr><td><code>GET /tramites?numero=&amp;asunto=&amp;estado=&amp;tipo=&amp;area=&amp;desde=&amp;hasta=</code></td><td>Seguimiento (al menos un filtro)</td></tr>
<tr><td><code>GET /tramites/{id}</code> · <code>GET /tramites/numero/{AAAA-#####-S}</code></td><td>Detalle con movimientos, adjuntos y acciones posibles</td></tr>
<tr><td><code>GET /tramites/{id}/adjuntos/{n}?contenido=1</code></td><td>Contenido del documento n</td></tr>
<tr><td><code>POST /tramites</code></td><td>Registrar; opcional <code>documento</code> y <code>derivar</code> en el mismo paso</td></tr>
<tr><td><code>POST /tramites/{id}/{accion}</code></td><td><code>derivar</code>, <code>recibir</code>, <code>iniciar</code>, <code>observar</code>, <code>atender</code>, <code>archivar</code>, <code>desarchivar</code>, <code>anular</code>, <code>adjuntar</code>, <code>asociar</code>, <code>confidencial</code></td></tr>
<tr><td><code>GET /resumen</code> · <code>GET /bitacora</code> · <code>GET /sesion</code></td><td>Indicadores del área · bitácora · datos del usuario</td></tr>
<tr><td><code>POST /opciones</code> · <code>POST /reiniciar</code></td><td>Opciones del banco de pruebas · volver a los escenarios iniciales</td></tr>
</table>
<h2>Ejemplos</h2>
<pre>curl -u logistica:prueba -H "Content-Type: application/json" {{.Base}}/sgd-simulado/api/v1/tramites -d '{
  "tipo": "INFORME", "asunto": "SOLICITA OPINIÓN LEGAL (PRUEBA)",
  "documento": { "nombre": "informe.txt", "texto": "Texto del informe de prueba" },
  "derivar": { "areaDestino": "GERENCIA DE ASESORÍA JURÍDICA", "usuarioDestino": "abogado.uno", "plazoDias": 5, "proveido": "Para opinión" }
}'

curl -u abogado.uno:prueba "{{.Base}}/sgd-simulado/api/v1/bandeja?asignadosAMi=1"
curl -u abogado.uno:prueba -X POST {{.Base}}/sgd-simulado/api/v1/tramites/250101/recibir
curl -u abogado.uno:prueba -H "Content-Type: application/json" {{.Base}}/sgd-simulado/api/v1/tramites/250101/adjuntar \
  -d '{"nombre":"escaneo.pdf","contenidoBase64":"JVBERi0x..."}'</pre>
<p>Especificación completa: <code>docs/14-sgd-de-pruebas.md</code>. Configuración: <code>{{.Env}}</code> · Datos: <code>{{.Datos}}</code>.</p>
</main></body></html>`))

func inicio(w http.ResponseWriter, r *http.Request, cfg config, nucleo string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	paginaInicio.Execute(w, map[string]any{
		"Version": version, "Nucleo": nucleo, "URLs": urlsRed(cfg),
		"Base": "http://" + r.Host, "Env": cfg.rutaEnv, "Datos": cfg.datos,
	})
}

func carpetaEjecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return filepath.Dir(exe)
}

func escribible(dir string) bool {
	f, err := os.CreateTemp(dir, ".prueba-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

func fallar(msg string, err error) {
	log.Printf("%s: %v", msg, err)
	mostrarError("SGD-Pruebas", fmt.Sprintf("%s:\n%v", msg, err))
	os.Exit(1)
}
