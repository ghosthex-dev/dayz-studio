@echo off
cd /d "%~dp0"
if not exist "desktop\node_modules\electron" (
  echo First run: installing the desktop shell...
  pushd desktop
  call npm install --no-audit --no-fund
  popd
)
start "" "desktop\node_modules\electron\dist\electron.exe" desktop
