//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func abrirNavegador(url string) {
	c := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	c.Start()
}

func abrirCarpeta(ruta string)  { exec.Command("explorer", ruta).Start() }
func editarArchivo(ruta string) { exec.Command("notepad", ruta).Start() }

func mostrarError(titulo, mensaje string) {
	caja := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(titulo)
	m, _ := syscall.UTF16PtrFromString(mensaje)
	const mbIconError = 0x10
	caja.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconError)
}

const finDeLinea = "\r\n"
