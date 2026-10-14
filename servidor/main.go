// LEGAL-Prueba: entorno de prueba local del Conector SGD.
//
// Al ejecutarse (doble clic, sin consola):
//   - crea la base de datos NoSQL de prueba si no existe;
//   - prepara la carpeta de la extensión preconfigurada;
//   - levanta el servidor en http://localhost:8790 (solo accesible desde este equipo);
//   - abre el Centro de pruebas en el navegador y muestra un ícono en la bandeja del sistema.
package main

import (
	"context"
	"embed"
	"encoding/json"
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
	"strings"
	"syscall"
	"time"

	"fyne.io/systray"
)

const puerto = 8790

//go:embed all:web
var webEmbebido embed.FS

//go:embed recursos/icono.ico
var iconoICO []byte

//go:embed recursos/icono.png
var iconoPNG []byte

var version = "0.3.0"

func main() {
	sinBandeja := flag.Bool("sin-bandeja", false, "no mostrar el ícono en la bandeja del sistema")
	noAbrir := flag.Bool("no-abrir", false, "no abrir el navegador al iniciar")
	dirDatos := flag.String("datos", "", "carpeta de datos (por defecto en el perfil del usuario)")
	flag.Parse()

	dir := *dirDatos
	if dir == "" {
		dir = directorioDatos()
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fallar("No se pudo crear la carpeta de datos", err)
	}
	if f, err := os.OpenFile(filepath.Join(dir, "registro.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(io.MultiWriter(f, os.Stderr))
	}

	base := fmt.Sprintf("http://localhost:%d/", puerto)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", puerto))
	if err != nil {
		// Ya hay una instancia en ejecución: solo se abre el Centro de pruebas.
		log.Printf("El puerto %d está en uso; se abre la instancia existente", puerto)
		if !*noAbrir {
			abrirNavegador(base)
		}
		return
	}

	bd, err := abrirBD(filepath.Join(dir, "legal-prueba.db"))
	if err != nil {
		fallar("No se pudo abrir la base de datos de prueba", err)
	}

	web, _ := fs.Sub(webEmbebido, "web")
	semilla, err := leerSemilla(web)
	if err != nil {
		fallar("El catálogo de referencia embebido no es válido", err)
	}

	dirExt := filepath.Join(dir, "extension-conector-sgd")
	if err := extraerExtension(web, dirExt, base); err != nil {
		log.Printf("No se pudo preparar la extensión: %v", err)
	}

	srv := &Servidor{bd: bd, semilla: semilla, web: web, base: base, dirExt: dirExt, version: version, iniciado: time.Now()}
	httpSrv := &http.Server{Handler: srv.Rutas(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("Servidor detenido: %v", err)
		}
	}()
	log.Printf("LEGAL-Prueba %s en %s · datos en %s", version, base, dir)

	if !*noAbrir {
		abrirNavegador(base)
	}

	detener := func() {
		ctx, cancelar := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancelar()
		httpSrv.Shutdown(ctx)
		bd.Cerrar()
		log.Print("LEGAL-Prueba detenido")
	}

	if *sinBandeja {
		señal := make(chan os.Signal, 1)
		signal.Notify(señal, os.Interrupt, syscall.SIGTERM)
		<-señal
		detener()
		return
	}
	systray.Run(func() { menuBandeja(base, dirExt, dir) }, detener)
}

func menuBandeja(base, dirExt, dirDatos string) {
	if runtime.GOOS == "windows" {
		systray.SetIcon(iconoICO)
	} else {
		systray.SetIcon(iconoPNG)
	}
	systray.SetTitle("LEGAL")
	systray.SetTooltip(fmt.Sprintf("LEGAL · Entorno de prueba (%s)", base))

	estado := systray.AddMenuItem("LEGAL · Entorno de prueba activo", "")
	estado.Disable()
	systray.AddSeparator()
	centro := systray.AddMenuItem("Abrir Centro de pruebas", "")
	portal := systray.AddMenuItem("Abrir Portal LEGAL", "")
	sgd := systray.AddMenuItem("Abrir SGD simulado", "")
	ext := systray.AddMenuItem("Abrir carpeta de la extensión", "")
	datos := systray.AddMenuItem("Abrir carpeta de datos", "")
	systray.AddSeparator()
	salir := systray.AddMenuItem("Detener y salir", "")

	go func() {
		for {
			select {
			case <-centro.ClickedCh:
				abrirNavegador(base)
			case <-portal.ClickedCh:
				abrirNavegador(base + "portal/")
			case <-sgd.ClickedCh:
				abrirNavegador(base + "sgd-simulado/")
			case <-ext.ClickedCh:
				abrirCarpeta(dirExt)
			case <-datos.ClickedCh:
				abrirCarpeta(dirDatos)
			case <-salir.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

// directorioDatos: %LOCALAPPDATA%\LEGAL-Prueba en Windows; equivalente en otros sistemas.
func directorioDatos() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "LEGAL-Prueba")
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "LEGAL-Prueba")
	}
	return "LEGAL-Prueba-datos"
}

func leerSemilla(web fs.FS) (Catalogo, error) {
	var c Catalogo
	b, err := fs.ReadFile(web, "catalogo-semilla.json")
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	return c, err
}

// extraerExtension copia la extensión embebida a una carpeta del usuario y la
// preconfigura para el entorno de prueba (SGD simulado y servidor local).
func extraerExtension(web fs.FS, destino, base string) error {
	err := fs.WalkDir(web, "extension", func(ruta string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		salida := filepath.Join(destino, filepath.FromSlash(strings.TrimPrefix(ruta, "extension")))
		if d.IsDir() {
			return os.MkdirAll(salida, 0o755)
		}
		b, err := fs.ReadFile(web, ruta)
		if err != nil {
			return err
		}
		return os.WriteFile(salida, b, 0o644)
	})
	if err != nil {
		return err
	}
	entorno := map[string]any{
		"urlsSgd":        []string{base + "sgd-simulado/", "https://sgd.sedapar.com.pe/"},
		"servidorLegal":  strings.TrimSuffix(base, "/"),
		"usuarioLegal":   "usuario.prueba",
		"modoActivacion": "indicador",
	}
	b, _ := json.MarshalIndent(entorno, "", "  ")
	contenido := "/* Generado por LEGAL-Prueba: configuración del entorno de prueba. */\nself.LEGAL_ENTORNO = " + string(b) + ";\n"
	return os.WriteFile(filepath.Join(destino, "shared", "entorno.js"), []byte(contenido), 0o644)
}

func fallar(mensaje string, err error) {
	log.Printf("%s: %v", mensaje, err)
	mostrarError("LEGAL-Prueba", fmt.Sprintf("%s.\n\n%v", mensaje, err))
	os.Exit(1)
}
