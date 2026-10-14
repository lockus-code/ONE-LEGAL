#!/usr/bin/env bash
# Construye LEGAL-Prueba (Windows sin consola y Linux) con la extensión, el portal
# y el SGD simulado embebidos. Requiere Go 1.22+ y Node.js (solo para generar el catálogo semilla).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-0.2.0}"

rm -rf web && mkdir -p web dist
cp -r ../portal web/portal
cp -r ../pruebas/sgd-simulado web/sgd-simulado
cp -r ../extension web/extension
cp -r centro web/centro
node -e '
  global.self = global;
  require("../extension/shared/catalogo.js");
  const { categorias, responsables, procesos } = global.LEGAL_CATALOGO;
  process.stdout.write(JSON.stringify({ categorias, responsables, procesos }, null, 2));
' > web/catalogo-semilla.json

# Ícono del ejecutable de Windows (recurso .syso)
if [ ! -f rsrc_windows_amd64.syso ]; then
  go run github.com/tc-hib/go-winres@v0.3.3 simply --icon ../extension/icons/icon-128.png --arch amd64 \
    --product-name "LEGAL Entorno de prueba" --file-description "LEGAL - Entorno de prueba del Conector SGD" \
    --product-version "$VERSION" --file-version "$VERSION" --original-filename "LEGAL-Prueba.exe"
fi

go vet ./...
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H=windowsgui -s -w -X main.version=$VERSION" -o dist/LEGAL-Prueba.exe .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o dist/legal-prueba-linux .
ls -la dist
