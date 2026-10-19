//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// ocultarVentana evita que los procesos auxiliares muestren una consola.
func ocultarVentana(c *exec.Cmd) *exec.Cmd {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return c
}

func abrirNavegador(url string) {
	ocultarVentana(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
}

func abrirCarpeta(ruta string) {
	exec.Command("explorer", ruta).Start()
}

func mostrarError(titulo, mensaje string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	caja := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(titulo)
	m, _ := syscall.UTF16PtrFromString(mensaje)
	const mbIconError = 0x10
	caja.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconError)
}

const finDeLinea = "\r\n"

func editarArchivo(ruta string) {
	exec.Command("notepad", ruta).Start()
}
