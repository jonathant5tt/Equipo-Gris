#!/bin/sh
# Engreídos Barbershop - inicia el servidor en macOS o Linux:  sh iniciar-servidor.sh
# La primera vez pide los datos de MySQL y crea la base de datos.
cd "$(dirname "$0")/servidor" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "No se encontró Node.js. Instala la versión LTS desde https://nodejs.org"
  exit 1
fi
if [ ! -f .env ]; then
  node scripts/configurar.js || exit 1
fi
exec node src/index.js
