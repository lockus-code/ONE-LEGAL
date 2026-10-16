#!/usr/bin/env bash
# Construye LEGAL (Windows sin consola y Linux) con el portal, la extensión y el
# SGD simulado embebidos. Requiere Go 1.24+.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-1.1.0}"

rm -rf web && mkdir -p web dist
cp -r ../portal web/portal
cp -r ../pruebas/sgd-simulado web/sgd-simulado
cp -r ../extension web/extension
cp -r centro web/centro

# Ícono y datos del ejecutable de Windows (recurso .syso)
if [ ! -f rsrc_windows_amd64.syso ] || [ "${REGENERAR_RECURSOS:-}" = 1 ]; then
  go run github.com/tc-hib/go-winres@v0.3.3 simply --icon ../extension/icons/icon-128.png --arch amd64 \
    --product-name "LEGAL" --file-description "LEGAL - Gestión de procesos legales" \
    --product-version "$VERSION" --file-version "$VERSION" --original-filename "LEGAL.exe"
fi

go vet ./...
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w -X main.version=$VERSION" -o dist/LEGAL.exe .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o dist/legal-linux .
ls -la dist
