@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
)
echo.
echo Starting Springfield Peptide site...
echo.
start http://localhost:8080/
start http://localhost:8080/qr.html
node server.js