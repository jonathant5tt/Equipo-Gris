## ¿Qué cambia?
<!-- Resumen en 2 o 3 líneas. -->

## Caso(s) de uso relacionados
<!-- Ej. CU-05 Registrar cobro y emitir ticket -->

## ¿Cómo se probó?
- [ ] `cd servidor && npm test` pasa en local (captura en el reporte)
- [ ] Pruebas nuevas o actualizadas para el código que cambió
- [ ] (Si toca la BD) `node scripts/probar-happy-path.js --base-de-pruebas …` contra MySQL de pruebas

## Lista de revisión (la llena quien revisa)
- [ ] El código hace lo que dice el caso de uso y no rompe el Happy Path
- [ ] Las consultas usan marcadores `?` (sin concatenar datos del usuario)
- [ ] Los errores devuelven `ErrorApi` con un mensaje claro para el usuario
- [ ] No se suben `.env`, contraseñas ni fotos de clientes
- [ ] El check «Pruebas» de GitHub Actions está en verde
