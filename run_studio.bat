@echo off
cd /d "%~dp0"
start "" http://localhost:8765
python tools\studio_server.py
