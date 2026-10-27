// LEGAL: servidor de gestión de procesos legales para la intranet.
//
// Al ejecutarse (doble clic, sin consola):
//   - crea el archivo .env junto al ejecutable si no existe (dirección, puerto, SGD…);
//   - crea la base de datos NoSQL vacía (datos/legal.db) si no existe;
//   - prepara la extensión Conector SGD apuntando a este servidor;
//   - levanta el portal y la API en la intranet y muestra un ícono en la bandeja del sistema.
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"fyne.io/systray"
)

const puertoPredeterminado = 8790

//go:embed all:web
var webEmbebido embed.FS

//go:embed recursos/icono.ico
var iconoICO []byte

//go:embed recursos/icono.png
var iconoPNG []byte

var version = "1.2.0"

func main() {
	sinBandeja := flag.Bool("sin-bandeja", false, "no mostrar el ícono en la bandeja del sistema")
	noAbrir := flag.Bool("no-abrir", false, "no abrir el navegador al iniciar")
	dirDatos := flag.String("datos", "", "carpeta de datos (por defecto, la indicada en .env)")
	dirConfig := flag.String("config", "", "carpeta del archivo .env (por defecto, la del ejecutable)")
	host := flag.String("host", "", "interfaz de escucha (por defecto, la indicada en .env)")
	flag.Parse()

	// En modo servicio (-sin-bandeja, p. ej. detrás de un proxy HTTPS) el .env va en la carpeta de
	// datos y, si se crea, escucha solo en este equipo. En Windows (con bandeja) escucha en la intranet.
	base := *dirConfig
	hostPredeterminado := "0.0.0.0"
	if *sinBandeja {
		hostPredeterminado = "127.0.0.1"
	}
	if base == "" && *sinBandeja && *dirDatos != "" {
		base = *dirDatos
		os.MkdirAll(base, 0o755)
	}
	if base == "" {
		base = carpetaEjecutable()
	}
	if !escribible(base) {
		base = directorioUsuario()
		os.MkdirAll(base, 0o755)
	}
	cfg := cargarConfig(base, hostPredeterminado)
	if *dirDatos != "" {
		cfg.DirDatos = *dirDatos
	}
	if *host != "" {
		cfg.Host = *host
	}
	if *noAbrir {
		cfg.AbrirNavegador = false
	}
	if err := os.MkdirAll(cfg.DirDatos, 0o755); err != nil {
		fallar("No se pudo crear la carpeta de datos "+cfg.DirDatos, err)
	}
	if f, err := os.OpenFile(filepath.Join(cfg.DirDatos, "registro.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}

	direccion := net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.Puerto))
	ln, err := net.Listen("tcp", direccion)
	if err != nil {
		// Ya hay una instancia en ejecución (o el puerto está ocupado): se abre el portal.
		log.Printf("No se pudo escuchar en %s (%v); se abre la instancia existente", direccion, err)
		if cfg.AbrirNavegador {
			abrirNavegador(cfg.urlLocal() + "/portal/")
		}
		return
	}

	bd, err := abrirBD(filepath.Join(cfg.DirDatos, "legal.db"))
	if err != nil {
		fallar("No se pudo abrir la base de datos", err)
	}
	web, _ := fs.Sub(webEmbebido, "web")
	dirExt := filepath.Join(cfg.DirDatos, "extension-conector-sgd")
	srv := &Servidor{bd: bd, cfg: cfg, web: web, dirExt: dirExt, version: version, iniciado: time.Now()}
	if err := srv.inicializar(); err != nil {
		fallar("No se pudo preparar la base de datos", err)
	}
	if err := srv.extraerExtension(dirExt); err != nil {
		log.Printf("No se pudo preparar la extensión: %v", err)
	}

	httpSrv := &http.Server{Handler: srv.Rutas(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("Servidor detenido: %v", err)
		}
	}()
	log.Printf("LEGAL %s escuchando en %s · URL pública %s · datos en %s · configuración %s", version, direccion, cfg.URLPublica, cfg.DirDatos, cfg.RutaEnv)

	if cfg.AbrirNavegador {
		abrirNavegador(cfg.urlLocal() + "/portal/")
	}

	detener := func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancelar()
		httpSrv.Shutdown(ctx)
		if srv.sgd != nil {
			srv.sgd.Cerrar()
		}
		bd.Cerrar()
		log.Print("LEGAL detenido")
	}

	if *sinBandeja {
		señal := make(chan os.Signal, 1)
		signal.Notify(señal, os.Interrupt, syscall.SIGTERM)
		<-señal
		detener()
		return
	}
	systray.Run(func() { menuBandeja(cfg, dirExt) }, detener)
}

func menuBandeja(cfg Config, dirExt string) {
	if runtime.GOOS == "windows" {
		systray.SetIcon(iconoICO)
	} else {
		systray.SetIcon(iconoPNG)
	}
	systray.SetTitle("LEGAL")
	systray.SetTooltip("LEGAL · " + cfg.URLPublica)

	estado := systray.AddMenuItem("LEGAL activo en "+cfg.URLPublica, "")
	estado.Disable()
	systray.AddSeparator()
	portal := systray.AddMenuItem("Abrir portal", "")
	inicio := systray.AddMenuItem("Página de inicio e instalación de la extensión", "")
	var sgd *systray.MenuItem
	if cfg.SGDSimulado {
		sgd = systray.AddMenuItem("Abrir SGD simulado (pruebas)", "")
	} else {
		sgd = systray.AddMenuItem("SGD simulado desactivado", "")
		sgd.Disable()
	}
	ext := systray.AddMenuItem("Abrir carpeta de la extensión", "")
	datos := systray.AddMenuItem("Abrir carpeta de datos", "")
	env := systray.AddMenuItem("Editar configuración (.env)", "")
	systray.AddSeparator()
	salir := systray.AddMenuItem("Detener y salir", "")

	go func() {
		for {
			select {
			case <-portal.ClickedCh:
				abrirNavegador(cfg.urlLocal() + "/portal/")
			case <-inicio.ClickedCh:
				abrirNavegador(cfg.urlLocal() + "/")
			case <-sgd.ClickedCh:
				abrirNavegador(cfg.urlLocal() + "/sgd-simulado/")
			case <-ext.ClickedCh:
				abrirCarpeta(dirExt)
			case <-datos.ClickedCh:
				abrirCarpeta(cfg.DirDatos)
			case <-env.ClickedCh:
				editarArchivo(cfg.RutaEnv)
			case <-salir.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func carpetaEjecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r
	}
	return filepath.Dir(exe)
}

func escribible(dir string) bool {
	f, err := os.CreateTemp(dir, ".legal-prueba-escritura-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// directorioUsuario: %LOCALAPPDATA%\LEGAL en Windows; equivalente en otros sistemas.
func directorioUsuario() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "LEGAL")
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "LEGAL")
	}
	return "LEGAL-datos"
}

func fallar(mensaje string, err error) {
	log.Printf("%s: %v", mensaje, err)
	mostrarError("LEGAL", fmt.Sprintf("%s.\n\n%v", mensaje, err))
	os.Exit(1)
}
