@echo off
cd /d "%~dp0"
if exist "src-tauri\target\release\kbmbridge.exe" (
    start "" "src-tauri\target\release\kbmbridge.exe"
) else (
    set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
    npm.cmd run tauri dev
)
