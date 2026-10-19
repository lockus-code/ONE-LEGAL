package main

// Configuración del servidor desde el archivo .env, que se crea junto al
// ejecutable la primera vez que se inicia. Las variables de entorno del
// sistema con el mismo nombre tienen prioridad sobre el archivo.

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Host           string   // interfaz de escucha (0.0.0.0 = toda la intranet)
	Puerto         int      //
	URLPublica     string   // dirección con la que los demás equipos llegan a este servidor
	DirDatos       string   // carpeta de la base de datos
	SGDURLs        []string // prefijos del SGD que habilitan el Conector
	SGDSimulado    bool     // publica el SGD simulado de pruebas en /sgd-simulado/
	AdminUsuario   string
	AdminClave     string // solo se usa al crear la base de datos
	AbrirNavegador bool
	SesionHoras    int
	RutaEnv        string
}

const plantillaEnv = `# LEGAL · Configuración del servidor
# Se creó automáticamente en la primera ejecución. Después de editarlo,
# cierre LEGAL (ícono junto al reloj › Detener y salir) y vuelva a abrirlo.

# Interfaz de red donde escucha el servidor.
#   0.0.0.0   = accesible para toda la intranet (recomendado)
#   127.0.0.1 = solo este equipo
LEGAL_HOST=%s

# Puerto del servidor.
LEGAL_PUERTO=%d

# Dirección con la que los demás equipos de la intranet llegan a este servidor.
# Es la que usan el portal y la extensión. Cambie la IP si este equipo cambia
# de dirección o si se usa un nombre de equipo (p. ej. http://srv-legal:8790).
LEGAL_URL_PUBLICA=%s

# Carpeta de la base de datos (relativa a este archivo o ruta completa).
LEGAL_DATOS=datos

# Dirección(es) del SGD institucional, separadas por coma.
LEGAL_SGD_URLS=https://sgd.sedapar.com.pe/

# Publica un SGD simulado con datos ficticios en /sgd-simulado/ para pruebas (si / no).
LEGAL_SGD_SIMULADO=si

# Usuario administrador que se crea con la base de datos vacía.
# La clave inicial se debe cambiar en el primer ingreso.
LEGAL_ADMIN_USUARIO=admin
LEGAL_ADMIN_CLAVE_INICIAL=admin

# Abrir el portal en el navegador al iniciar (si / no).
LEGAL_ABRIR_NAVEGADOR=si

# Horas de vigencia de una sesión.
LEGAL_SESION_HORAS=12
`

// cargarConfig lee (o crea) el .env de la carpeta indicada.
func cargarConfig(dirBase, hostPredeterminado string) Config {
	ruta := filepath.Join(dirBase, ".env")
	if _, err := os.Stat(ruta); os.IsNotExist(err) {
		contenido := fmt.Sprintf(plantillaEnv, hostPredeterminado, puertoPredeterminado, fmt.Sprintf("http://%s:%d", ipLocal(), puertoPredeterminado))
		if err := os.WriteFile(ruta, []byte(strings.ReplaceAll(contenido, "\n", finDeLinea)), 0o644); err != nil {
			log.Printf("No se pudo crear %s: %v (se usan valores por defecto)", ruta, err)
		} else {
			log.Printf("Se creó la configuración %s", ruta)
		}
	}
	valores := leerEnv(ruta)
	obtener := func(clave, porDefecto string) string {
		if v, ok := os.LookupEnv(clave); ok {
			return strings.TrimSpace(v)
		}
		if v, ok := valores[clave]; ok && v != "" {
			return v
		}
		return porDefecto
	}
	si := func(v string) bool {
		v = strings.ToLower(v)
		return v == "si" || v == "sí" || v == "true" || v == "1" || v == "yes"
	}

	c := Config{RutaEnv: ruta}
	c.Host = obtener("LEGAL_HOST", hostPredeterminado)
	c.Puerto, _ = strconv.Atoi(obtener("LEGAL_PUERTO", strconv.Itoa(puertoPredeterminado)))
	if c.Puerto <= 0 || c.Puerto > 65535 {
		c.Puerto = puertoPredeterminado
	}
	c.URLPublica = strings.TrimRight(obtener("LEGAL_URL_PUBLICA", ""), "/")
	if u, err := url.Parse(c.URLPublica); c.URLPublica == "" || err != nil || u.Host == "" {
		host := ipLocal()
		if c.Host == "127.0.0.1" || c.Host == "localhost" {
			host = "localhost"
		}
		c.URLPublica = fmt.Sprintf("http://%s:%d", host, c.Puerto)
	}
	c.DirDatos = obtener("LEGAL_DATOS", "datos")
	if !filepath.IsAbs(c.DirDatos) {
		c.DirDatos = filepath.Join(dirBase, c.DirDatos)
	}
	for _, u := range strings.Split(obtener("LEGAL_SGD_URLS", "https://sgd.sedapar.com.pe/"), ",") {
		if u = strings.TrimSpace(u); u != "" {
			if !strings.HasSuffix(u, "/") {
				u += "/"
			}
			c.SGDURLs = append(c.SGDURLs, u)
		}
	}
	c.SGDSimulado = si(obtener("LEGAL_SGD_SIMULADO", "si"))
	c.AdminUsuario = strings.ToLower(obtener("LEGAL_ADMIN_USUARIO", "admin"))
	c.AdminClave = obtener("LEGAL_ADMIN_CLAVE_INICIAL", "admin")
	c.AbrirNavegador = si(obtener("LEGAL_ABRIR_NAVEGADOR", "si"))
	c.SesionHoras, _ = strconv.Atoi(obtener("LEGAL_SESION_HORAS", "12"))
	if c.SesionHoras <= 0 {
		c.SesionHoras = 12
	}
	return c
}

func leerEnv(ruta string) map[string]string {
	valores := map[string]string{}
	f, err := os.Open(ruta)
	if err != nil {
		return valores
	}
	defer f.Close()
	esc := bufio.NewScanner(f)
	for esc.Scan() {
		linea := strings.TrimSpace(strings.TrimPrefix(esc.Text(), "\ufeff"))
		if linea == "" || strings.HasPrefix(linea, "#") {
			continue
		}
		clave, valor, ok := strings.Cut(linea, "=")
		if !ok {
			continue
		}
		valor = strings.TrimSpace(valor)
		valor = strings.Trim(valor, `"'`)
		valores[strings.TrimSpace(clave)] = valor
	}
	return valores
}

// ipLocal devuelve la IPv4 de la interfaz con la que el equipo sale a la red.
func ipLocal() string {
	if con, err := net.Dial("udp", "10.255.255.255:9"); err == nil {
		defer con.Close()
		if a, ok := con.LocalAddr().(*net.UDPAddr); ok && a.IP.To4() != nil && !a.IP.IsLoopback() {
			return a.IP.String()
		}
	}
	direcciones, _ := net.InterfaceAddrs()
	for _, d := range direcciones {
		if ip, ok := d.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() && ip.IP.IsPrivate() {
			return ip.IP.String()
		}
	}
	return "localhost"
}

// urlLocal: dirección del portal desde este mismo equipo.
func (c Config) urlLocal() string {
	return fmt.Sprintf("http://localhost:%d", c.Puerto)
}
