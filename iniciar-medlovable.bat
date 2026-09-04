@echo off
setlocal
chcp 65001 >nul
title MedLovable
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo O Node.js nao foi encontrado neste computador.
  echo Instale o Node.js 20 ou superior em https://nodejs.org e tente novamente.
  echo.
  pause
  exit /b 1
)

if not exist "server\.env" (
  node "server\src\setup.js"
  if errorlevel 1 (
    echo.
    pause
    exit /b 1
  )
) else (
  node "server\src\setup.js"
)

echo.
echo Iniciando o MedLovable. Deixe esta janela aberta enquanto usar a extensao.
echo Para encerrar, pressione Ctrl+C.
echo.
node --env-file="server\.env" "server\src\server.js"
pause

