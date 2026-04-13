@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" server\index.js >> backend.dev.log 2>&1
