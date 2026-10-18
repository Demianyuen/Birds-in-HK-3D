@echo off
cd /d "%~dp0"
start "Birds HK - Vite dev" powershell -NoExit -ExecutionPolicy Bypass -Command "npm run dev 2>&1 | Tee-Object -FilePath runtime-evidence\dev-server.log"
start "Birds HK - World server" powershell -NoExit -ExecutionPolicy Bypass -Command "npm run world:server 2>&1 | Tee-Object -FilePath runtime-evidence\world-server.log"
