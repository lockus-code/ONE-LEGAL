package main

// Cómputo de plazos: días hábiles (lunes a viernes, sin feriados nacionales del
// Perú ni los días no laborables que registre el administrador) o días
// calendario. Si un plazo en días calendario vence en día inhábil, se
// prorroga al primer día hábil siguiente (TUO Ley 27444, art. 145).

import (
	"fmt"
	"sort"
	"time"
)

const formatoDia = "2006-01-02"

// feriadosFijos: feriados nacionales de fecha fija (Ley 31788 y normas anteriores).
var feriadosFijos = []string{
	"01-01",          // Año Nuevo
	"05-01",          // Día del Trabajo
	"06-07",          // Batalla de Arica y Día de la Bandera
	"06-29",          // San Pedro y San Pablo
	"07-23",          // Día de la Fuerza Aérea del Perú
	"07-28", "07-29", // Fiestas Patrias
	"08-06", // Batalla de Junín
	"08-30", // Santa Rosa de Lima
	"10-08", // Combate de Angamos
	"11-01", // Todos los Santos
	"12-08", // Inmaculada Concepción
	"12-09", // Batalla de Ayacucho
	"12-25", // Navidad
}

// domingoDePascua: algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
func domingoDePascua(anio int) time.Time {
	a := anio % 19
	b, c := anio/100, anio%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	mes := (h + l - 7*m + 114) / 31
	dia := (h+l-7*m+114)%31 + 1
	return time.Date(anio, time.Month(mes), dia, 0, 0, 0, 0, time.UTC)
}

type Calendario struct {
	feriados map[string]bool
}

func nuevoCalendario(adicionales []string) Calendario {
	cal := Calendario{feriados: map[string]bool{}}
	anio := time.Now().Year()
	for a := anio - 2; a <= anio+3; a++ {
		for _, f := range feriadosFijos {
			cal.feriados[fmt.Sprintf("%d-%s", a, f)] = true
		}
		pascua := domingoDePascua(a)
		cal.feriados[pascua.AddDate(0, 0, -3).Format(formatoDia)] = true // Jueves Santo
		cal.feriados[pascua.AddDate(0, 0, -2).Format(formatoDia)] = true // Viernes Santo
	}
	for _, f := range adicionales {
		if _, err := time.Parse(formatoDia, f); err == nil {
			cal.feriados[f] = true
		}
	}
	return cal
}

func (cal Calendario) esHabil(t time.Time) bool {
	if t.Weekday() == time.Saturday || t.Weekday() == time.Sunday {
		return false
	}
	return !cal.feriados[t.Format(formatoDia)]
}

// Sumar devuelve la fecha (AAAA-MM-DD) en que vence un plazo de n días contados desde `desde`.
func (cal Calendario) Sumar(desde string, n int, tipo string) string {
	t, err := time.Parse(formatoDia, desde)
	if err != nil {
		t, _ = time.Parse(formatoDia, hoy())
	}
	if tipo == DiasCalendario {
		t = t.AddDate(0, 0, n)
		for !cal.esHabil(t) {
			t = t.AddDate(0, 0, 1)
		}
		return t.Format(formatoDia)
	}
	for contados := 0; contados < n; {
		t = t.AddDate(0, 0, 1)
		if cal.esHabil(t) {
			contados++
		}
	}
	return t.Format(formatoDia)
}

// HabilesEntre cuenta los días hábiles desde `a` (excluido) hasta `b` (incluido); negativo si b < a.
func (cal Calendario) HabilesEntre(a, b string) int {
	ta, err1 := time.Parse(formatoDia, a)
	tb, err2 := time.Parse(formatoDia, b)
	if err1 != nil || err2 != nil {
		return 0
	}
	signo := 1
	if tb.Before(ta) {
		ta, tb, signo = tb, ta, -1
	}
	n := 0
	for t := ta.AddDate(0, 0, 1); !t.After(tb); t = t.AddDate(0, 0, 1) {
		if cal.esHabil(t) {
			n++
		}
	}
	return n * signo
}

// Lista de feriados ordenada (la usa el portal para calcular plazos).
func (cal Calendario) Lista() []string {
	l := make([]string, 0, len(cal.feriados))
	for f := range cal.feriados {
		l = append(l, f)
	}
	sort.Strings(l)
	return l
}

func hoy() string { return time.Now().Format(formatoDia) }

// diasEntre: días calendario de a a b.
func diasEntre(a, b string) int {
	ta, err1 := time.Parse(formatoDia, a[:min(10, len(a))])
	tb, err2 := time.Parse(formatoDia, b[:min(10, len(b))])
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(tb.Sub(ta).Hours() / 24)
}
