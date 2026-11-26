@echo off
rem Worktrail one-click uninstall (keeps all logs). Manual: docs folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall.ps1"
