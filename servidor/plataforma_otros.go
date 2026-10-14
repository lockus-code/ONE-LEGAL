//go:build !windows

package main

import (
	"log"
	"os/exec"
	"runtime"
)

func abrirCon(arg string) {
	programa := "xdg-open"
	if runtime.GOOS == "darwin" {
		programa = "open"
	}
	if err := exec.Command(programa, arg).Start(); err != nil {
		log.Printf("No se pudo abrir %s: %v", arg, err)
	}
}

func abrirNavegador(url string)  { abrirCon(url) }
func abrirCarpeta(ruta string)   { abrirCon(ruta) }
func mostrarError(_, msg string) { log.Print(msg) }
