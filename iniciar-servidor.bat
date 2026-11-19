@echo off
REM ============================================================
REM  Engreidos Barbershop - inicia el servidor (doble clic)
REM  1a vez: pide los datos de MySQL y crea la base de datos.
REM ============================================================

REM Rutas de Windows y de Node.js (funciona aunque PATH este danado
REM o Windows no haya refrescado PATH despues de instalar Node.js).
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%ProgramFiles%\nodejs;%PATH%"
chcp 65001 >nul 2>nul
title Engreidos Barbershop - Servidor
cd /d "%~dp0servidor"

REM ---- Buscar node.exe ----
set "NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramW6432%\nodejs\node.exe" set "NODE=%ProgramW6432%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE for %%N in (node.exe) do if not "%%~$PATH:N"=="" set "NODE=%%~$PATH:N"
if not defined NODE goto sinnode

REM ---- Primera vez: asistente de MySQL ----
if exist .env goto iniciar
"%NODE%" scripts\configurar.js
if errorlevel 1 goto fin

:iniciar
"%NODE%" src\index.js
REM Codigo 2 = usuario o contrasena de MySQL incorrectos
if errorlevel 2 goto reconfigurar
goto fin

:reconfigurar
echo.
echo  Vamos a escribir de nuevo los datos de MySQL...
"%NODE%" scripts\configurar.js
if errorlevel 1 goto fin
goto iniciar

:sinnode
echo.
echo  No se encontro Node.js en esta computadora.
echo  Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
echo.
start "" https://nodejs.org

:fin
echo.
pause
