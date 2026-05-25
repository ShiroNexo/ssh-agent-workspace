@echo off
setlocal EnableDelayedExpansion
title SSH MCP Setup
color 07
cls

:: ================================================
::  SSH MCP Setup (Windows)
::  Generates an ed25519 key and adds an SSH alias
:: ================================================

:: ------------------------------------------------
::  [0/4] Locate ssh-keygen
:: ------------------------------------------------
set "SSHKEYGEN="

for %%I in (ssh-keygen.exe) do (
    if not "%%~$PATH:I"=="" set "SSHKEYGEN=%%~$PATH:I"
)

if not defined SSHKEYGEN (
    if exist "%SystemRoot%\System32\OpenSSH\ssh-keygen.exe" (
        set "SSHKEYGEN=%SystemRoot%\System32\OpenSSH\ssh-keygen.exe"
    )
)

if not defined SSHKEYGEN (
    echo.
    echo  [X] ssh-keygen not found.
    echo.
    echo  Please install one of:
    echo    - OpenSSH Client  ^(Windows Settings ^> Optional Features^)
    echo    - Git for Windows ^(https://git-scm.com^)
    echo.
    pause
    exit /b 1
)

echo  [OK] ssh-keygen: !SSHKEYGEN!
echo.

:: ------------------------------------------------
::  Paths
:: ------------------------------------------------
set "SSHDIR=%USERPROFILE%\.ssh"
set "PRIVKEY=%SSHDIR%\id_ed25519"
set "PUBKEY=%SSHDIR%\id_ed25519.pub"
set "CONFIG=%SSHDIR%\config"

echo  ================================================
echo   SSH MCP Setup  ^(Windows^)
echo  ================================================
echo.
echo  This script will:
echo    1. Create ~/.ssh folder
echo    2. Generate ed25519 SSH key ^(if missing^)
echo    3. Add host alias to SSH config
echo.
echo  Press Ctrl+C to cancel, or
pause
echo.
echo  ------------------------------------------------

:: ------------------------------------------------
::  Prompt: Alias
:: ------------------------------------------------
:ask_alias
set "ALIAS="
set /p "ALIAS=  Alias (e.g. prod)      : "

:: Trim leading/trailing spaces via a for loop trick
for /f "tokens=* delims= " %%A in ("!ALIAS!") do set "ALIAS=%%A"

if "!ALIAS!"=="" (
    echo  [!] Alias cannot be empty.
    goto :ask_alias
)

:: Reject spaces inside alias
echo !ALIAS!| find " " >nul 2>nul && (
    echo  [!] Alias cannot contain spaces.
    goto :ask_alias
)

:: Reject characters that break SSH config or findstr: * ? \ / " < > |
echo !ALIAS!| findstr /r "[*?/\\\""<>|]" >nul 2>nul && (
    echo  [!] Alias contains invalid characters.
    goto :ask_alias
)

:: ------------------------------------------------
::  Prompt: Host
:: ------------------------------------------------
:ask_host
set "HOST="
set /p "HOST=  IP / Hostname          : "
for /f "tokens=* delims= " %%A in ("!HOST!") do set "HOST=%%A"

if "!HOST!"=="" (
    echo  [!] Host cannot be empty.
    goto :ask_host
)

echo !HOST!| find " " >nul 2>nul && (
    echo  [!] Hostname cannot contain spaces.
    goto :ask_host
)

:: ------------------------------------------------
::  Prompt: User
:: ------------------------------------------------
:ask_user
set "SSHUSER="
set /p "SSHUSER=  SSH Username           : "
for /f "tokens=* delims= " %%A in ("!SSHUSER!") do set "SSHUSER=%%A"

if "!SSHUSER!"=="" (
    echo  [!] Username cannot be empty.
    goto :ask_user
)

echo !SSHUSER!| find " " >nul 2>nul && (
    echo  [!] Username cannot contain spaces.
    goto :ask_user
)

:: ------------------------------------------------
::  Prompt: Port  (validated via PowerShell)
:: ------------------------------------------------
:ask_port
set "PORT="
set /p "PORT=  SSH Port [default 22]  : "
for /f "tokens=* delims= " %%A in ("!PORT!") do set "PORT=%%A"

if "!PORT!"=="" set "PORT=22"

:: Use PowerShell to safely validate numeric range (avoids batch integer parsing bugs)
powershell -NoProfile -Command ^
    "param([string]$p) $n=0; if(-not[int]::TryParse($p,[ref]$n)-or $n -lt 1 -or $n -gt 65535){exit 1}" ^
    -p "!PORT!" >nul 2>nul

if errorlevel 1 (
    echo  [!] Invalid port. Must be a number between 1 and 65535. Using 22.
    set "PORT=22"
)

echo.

:: ------------------------------------------------
::  [1/4] Prepare .ssh folder
:: ------------------------------------------------
echo  [1/4] Preparing .ssh folder ...
if not exist "%SSHDIR%\" (
    mkdir "%SSHDIR%"
    if errorlevel 1 (
        echo  [X] Failed to create: %SSHDIR%
        pause & exit /b 1
    )
    echo  [+] Created: %SSHDIR%
) else (
    echo  [=] Already exists: %SSHDIR%
)
echo.

:: ------------------------------------------------
::  [2/4] Generate SSH key pair
:: ------------------------------------------------
echo  [2/4] Generating SSH key pair ...
if not exist "%PRIVKEY%" (
    if exist "%PUBKEY%" (
        echo  [W] Public key found but private key is missing.
        echo      Delete %PUBKEY% manually and re-run this script.
        pause & exit /b 1
    )
    "!SSHKEYGEN!" -t ed25519 -f "%PRIVKEY%" -N "" -C "mcp-!ALIAS!"
    if errorlevel 1 (
        echo  [X] ssh-keygen failed.
        pause & exit /b 1
    )
    echo  [+] Key saved: %PRIVKEY%
) else (
    if not exist "%PUBKEY%" (
        echo  [W] Private key found but public key is missing.
        echo      Delete %PRIVKEY% manually and re-run this script.
        pause & exit /b 1
    )
    echo  [=] Key already exists, skipping.
    echo      %PRIVKEY%
)
echo.

:: ------------------------------------------------
::  [3/4] Update SSH config
:: ------------------------------------------------
echo  [3/4] Updating SSH config ...

if not exist "%CONFIG%" (
    type nul > "%CONFIG%"
    echo  [+] Config file created: %CONFIG%
)

:: Use word-boundary match: "^Host <alias>$" to avoid partial matches
:: (e.g. alias "prod" must not match "production")
findstr /r /c:"^Host !ALIAS!$" "%CONFIG%" >nul 2>nul
if not errorlevel 1 (
    echo  [=] Alias [!ALIAS!] already exists in config, skipped.
    goto :config_done
)

:: Write each line individually — parenthesised blocks are unreliable
:: with delayed expansion enabled on some Windows versions.
:: NOTE: no space before ">>" so trailing spaces are not written to the file.
>>"%CONFIG%" echo.
>>"%CONFIG%" echo Host !ALIAS!
>>"%CONFIG%" echo     HostName !HOST!
>>"%CONFIG%" echo     User !SSHUSER!
>>"%CONFIG%" echo     Port !PORT!
>>"%CONFIG%" echo     IdentityFile !PRIVKEY!
>>"%CONFIG%" echo     ServerAliveInterval 60
>>"%CONFIG%" echo     ServerAliveCountMax 3
>>"%CONFIG%" echo     StrictHostKeyChecking accept-new

if errorlevel 1 (
    echo  [X] Failed to write to: %CONFIG%
    pause & exit /b 1
)
echo  [+] Alias [!ALIAS!] added to config.

:config_done
echo.

:: ------------------------------------------------
::  [4/4] Key permission hint
:: ------------------------------------------------
echo  [4/4] Key permissions ...
echo  [i] Windows OpenSSH enforces strict ACLs.
echo      If ssh fails with "Bad permissions", run:
echo.
echo      icacls "%PRIVKEY%" /inheritance:r /grant:r "%USERNAME%:R"
echo.

:: ------------------------------------------------
::  Summary
:: ------------------------------------------------
echo  ================================================
echo   Summary
echo  ================================================
echo.
echo   Alias       : !ALIAS!
echo   Host        : !HOST!
echo   User        : !SSHUSER!
echo   Port        : !PORT!
echo   Private Key : !PRIVKEY!
echo   Config      : !CONFIG!
echo.
echo  Test your connection:
echo      ssh !ALIAS!
echo.

:: ------------------------------------------------
::  Read public key — write to temp file first
::  so we never echo a raw key string directly
::  (avoids issues with = signs and long lines)
:: ------------------------------------------------
set "PUBKEYLINE="
if exist "%PUBKEY%" (
    for /f "usebackq delims=" %%i in ("%PUBKEY%") do (
        if "!PUBKEYLINE!"=="" set "PUBKEYLINE=%%i"
    )
)

if "!PUBKEYLINE!"=="" (
    echo  [X] Could not read public key: %PUBKEY%
    echo  [i] Copy the key manually to your server.
) else (
    echo  ================================================
    echo   Add your public key to the server
    echo  ================================================
    echo.
    echo  Option A — paste this command on the server:
    echo.

    :: Write the server command to a temp file to avoid echo mangling long keys
    set "TMPFILE=%TEMP%\mcp_pubkey_cmd.txt"
    (
        echo mkdir -p ~/.ssh ^&^& echo !PUBKEYLINE! ^>^> ~/.ssh/authorized_keys ^&^& chmod 700 ~/.ssh ^&^& chmod 600 ~/.ssh/authorized_keys
    ) > "!TMPFILE!"
    type "!TMPFILE!"
    del "!TMPFILE!" >nul 2>nul

    echo.
    echo  Option B — if ssh-copy-id is available ^(e.g. via Git Bash^):
    echo.
    echo      ssh-copy-id -i "%PUBKEY%" !SSHUSER!@!HOST! -p !PORT!
)

echo.

:: ------------------------------------------------
::  Optional: Passwordless sudo
:: ------------------------------------------------
echo  ================================================
echo   OPTIONAL: Passwordless sudo for AI agent
echo  ================================================
echo.
echo  Allows the agent to run sudo without a password prompt.
echo.
powershell -NoProfile -Command "Write-Host '  WARNING: USE AT YOUR OWN RISK!' -ForegroundColor Red"
powershell -NoProfile -Command "Write-Host '  The AI agent can execute privileged commands.' -ForegroundColor Red"
powershell -NoProfile -Command "Write-Host '  Recommended only for local/dev/homelab servers.' -ForegroundColor Yellow"
echo.
echo  [FULL ACCESS — easiest, least safe]
echo  sudo bash -c "echo '!SSHUSER! ALL=(ALL) NOPASSWD: ALL' ^> /etc/sudoers.d/99-mcp-!SSHUSER!"
echo.
echo  [LIMITED ACCESS — safer, restrict to specific commands]
echo  sudo bash -c "echo '!SSHUSER! ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/bin/apt' ^> /etc/sudoers.d/99-mcp-!SSHUSER!"
echo.
echo  Validate after applying:
echo      sudo visudo -cf /etc/sudoers.d/99-mcp-!SSHUSER!
echo.
echo  ================================================
echo.

pause
endlocal