#!/usr/bin/env bash
# Construye, para Windows (sin consola) y Linux:
#   - LEGAL, con el portal, la extensión y el SGD de pruebas embebidos;
#   - SGD-Pruebas, el SGD de pruebas como ejecutable independiente (cmd/sgd-pruebas, docs/14).
# Requiere Go 1.24+.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-1.2.0}"
VERSION_SGD="${VERSION_SGD:-2.0.0}"

rm -rf web && mkdir -p web dist
cp -r ../portal web/portal
rm -rf sgdpruebas/web && cp -r ../pruebas/sgd-simulado sgdpruebas/web && rm -rf sgdpruebas/web/pruebas
cp -r ../extension web/extension
cp -r centro web/centro

# Ícono y datos del ejecutable de Windows (recurso .syso)
if [ ! -f rsrc_windows_amd64.syso ] || [ "${REGENERAR_RECURSOS:-}" = 1 ]; then
  go run github.com/tc-hib/go-winres@v0.3.3 simply --icon ../extension/icons/icon-128.png --arch amd64 \
    --product-name "LEGAL" --file-description "LEGAL - Gestión de procesos legales" \
    --product-version "$VERSION" --file-version "$VERSION" --original-filename "LEGAL.exe"
fi

# Ícono del archivo SGD-Pruebas.exe en el Explorador (opcional: el de la bandeja ya va embebido).
if [ "${GENERAR_ICONO_SGD:-}" = 1 ]; then
  (cd cmd/sgd-pruebas && go run github.com/tc-hib/go-winres@v0.3.3 simply --icon recursos/icono.png --arch amd64 \
    --product-name "SGD de pruebas" --file-description "SGD de pruebas - Sistema de Gestión Documental ficticio" \
    --product-version "$VERSION_SGD" --file-version "$VERSION_SGD" --original-filename "SGD-Pruebas.exe")
fi

go vet ./...
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w -X main.version=$VERSION" -o dist/LEGAL.exe .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o dist/legal-linux .
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w -X main.version=$VERSION_SGD" -o dist/SGD-Pruebas.exe ./cmd/sgd-pruebas
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION_SGD" -o dist/sgd-pruebas-linux ./cmd/sgd-pruebas
ls -la dist
