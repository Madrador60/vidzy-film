@echo off
setlocal
cd /d "%~dp0"
title Vidzy Catalogue

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable.
  echo Installe Node.js 18 ou plus recent depuis nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo Echec de npm install.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy .env.example .env >nul
  echo Le fichier .env vient d'etre cree.
  notepad .env
  echo Enregistre le jeton TMDB puis relance start.bat.
  pause
  exit /b 0
)

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5000/api/health' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo Vidzy est deja lance. Ouverture du site...
  start "" "http://localhost:5000"
  exit /b 0
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5000'"
node server.js

echo.
if errorlevel 1 (
  echo Le serveur s'est arrete a cause d'une erreur.
) else (
  echo Le serveur Vidzy est ferme.
)
pause
