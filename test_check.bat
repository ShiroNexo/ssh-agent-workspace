@echo off
setlocal EnableDelayedExpansion
set "SSHKEYGEN="
where ssh-keygen >nul 2>&1
echo errorlevel after where: %errorlevel%
if not errorlevel 1 set "SSHKEYGEN=ssh-keygen"
echo SSHKEYGEN after where check: [!SSHKEYGEN!]
echo defined check: 
if defined SSHKEYGEN (echo YES) else (echo NO)
