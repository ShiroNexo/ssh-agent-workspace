@echo off
setlocal EnableDelayedExpansion
set BAR=worked
echo NORMAL: [%BAR%]
echo DELAYED: [!BAR!]
echo WHERE: 
where ssh-keygen >nul 2>&1 && echo FOUND || echo NOTFOUND
set SSHKEYGEN=
where ssh-keygen >nul 2>&1 && set "SSHKEYGEN=ssh-keygen"
if defined SSHKEYGEN (echo SSHKEYGEN defined: [!SSHKEYGEN!]) else (echo SSHKEYGEN NOT defined)
echo.
if exist "%SYSTEMROOT%\System32\OpenSSH\ssh-keygen.exe" (echo FILE EXISTS) else (echo FILE NOT EXISTS)
