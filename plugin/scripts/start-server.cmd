@echo off
rem Starts the VibeSchem MCP server for the plugin on Windows (see ..\.mcp.json, which names
rem scripts/start-server without an extension: Windows runs this file, macOS and Linux the sh one).
rem
rem A Minecraft player may have no Node, so this script makes the server start anyway:
rem
rem   1. Find Node 22 or newer: PATH, then the usual install places (nodejs.org installer, nvm-windows,
rem      Volta, fnm, Scoop), then a private copy. None? Download the official Node LTS build pinned
rem      below from nodejs.org into the user folder, .minecraft-schematic-lab\runtime\node, with the
rem      curl and tar of Windows 10/11 (checked against its SHA-256, no admin rights, nothing else on
rem      the system changes).
rem   2. Run launch.mjs with it: it installs the server's npm dependencies when Claude Code didn't,
rem      then starts the bundled server in MCP mode.
rem
rem stdout is the MCP channel: everything this script says goes to stderr.
rem `start-server.cmd --check` prepares everything and reports, without starting the server.
rem
rem No ( ) blocks around variables holding paths: a ")" in a folder name would end the block.
rem Keep the CRLF line endings: cmd.exe misreads labels in a file without them.

setlocal EnableExtensions DisableDelayedExpansion

set "NEED_MAJOR=22"
rem The Node LTS build downloaded when no suitable Node is installed, and its SHA-256 per CPU
rem (from https://nodejs.org/dist/VERSION/SHASUMS256.txt; start-server has the macOS and Linux ones).
set "NODE_VERSION=v24.22.0"
set "NODE_SHA256_x64=f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3"
set "NODE_SHA256_arm64=3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61"
for %%r in ("%~dp0..") do set "ROOT=%%~fr"
set "RUNTIME=%USERPROFILE%\.minecraft-schematic-lab\runtime"
if defined MSL_HOME set "RUNTIME=%MSL_HOME%\runtime"

rem --- 1) Node -----------------------------------------------------------------------------------

set "NODE="
set "NODE_BEST=0"
call :find_node
if not defined NODE call :download_node || exit /b 1
if not defined NODE call :find_node
if not defined NODE call :log "Node %NEED_MAJOR%+ is still missing after the download." & exit /b 1

rem --- 2) Dependencies and start (the same on every OS) -----------------------------------------

set "VIBESCHEM_NODE=%NODE%"
"%NODE%" "%ROOT%\scripts\launch.mjs" %*
exit /b %errorlevel%

rem -----------------------------------------------------------------------------------------------

:find_node
for /f "delims=" %%p in ('where node.exe 2^>nul') do call :consider "%%p"
call :consider "%ProgramFiles%\nodejs\node.exe"
call :consider "%LOCALAPPDATA%\Programs\nodejs\node.exe"
call :consider "%NVM_SYMLINK%\node.exe"
call :consider "C:\nvm4w\nodejs\node.exe"
call :consider "%LOCALAPPDATA%\Volta\bin\node.exe"
for /d %%d in ("%APPDATA%\fnm\node-versions\*") do call :consider "%%d\installation\node.exe"
call :consider "%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe"
call :consider "%USERPROFILE%\scoop\apps\nodejs\current\node.exe"
call :consider "%RUNTIME%\node\node.exe"
exit /b 0

rem Argument: a node.exe. Keeps the newest one of version NEED_MAJOR or later (its exit code is the
rem major version).
:consider
if not exist "%~1" exit /b 0
"%~1" -e "process.exit(parseInt(process.versions.node))" >nul 2>nul
set "M=%errorlevel%"
if %M% LSS %NEED_MAJOR% exit /b 0
if %M% GTR 200 exit /b 0
if %M% LEQ %NODE_BEST% exit /b 0
set "NODE=%~1"
set "NODE_BEST=%M%"
exit /b 0

:download_node
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 call :need_node & exit /b 1
where curl.exe >nul 2>nul || call :need_node || exit /b 1
where tar.exe >nul 2>nul || call :need_node || exit /b 1
set "FILE=node-%NODE_VERSION%-win-%ARCH%.zip"
set "SUM=%NODE_SHA256_x64%"
if /i "%ARCH%"=="arm64" set "SUM=%NODE_SHA256_arm64%"
set "DL=%RUNTIME%\node-download-%RANDOM%%RANDOM%"
mkdir "%DL%" 2>nul
if not exist "%DL%" call :log "Cannot create a folder in %RUNTIME%." & exit /b 1
call :log "Node %NEED_MAJOR%+ not found: downloading Node %NODE_VERSION% from nodejs.org into %RUNTIME% (one time)."
curl.exe -fsSL "https://nodejs.org/dist/%NODE_VERSION%/%FILE%" -o "%DL%\%FILE%"
if errorlevel 1 call :fail "Node download failed. The first start needs internet." & exit /b 1
set "GOT="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%DL%\%FILE%" SHA256') do (
  if not defined GOT set "GOT=%%h"
)
if defined GOT set "GOT=%GOT: =%"
if /i not "%GOT%"=="%SUM%" call :fail "The downloaded Node failed its checksum; try again." & exit /b 1
tar.exe -xf "%DL%\%FILE%" -C "%DL%"
if errorlevel 1 call :fail "Could not unpack %FILE%." & exit /b 1
if exist "%RUNTIME%\node" rmdir /s /q "%RUNTIME%\node"
move "%DL%\%FILE:.zip=%" "%RUNTIME%\node" >nul
if errorlevel 1 call :fail "Could not install Node into %RUNTIME%\node." & exit /b 1
rmdir /s /q "%DL%"
call :log "Node installed in %RUNTIME%\node."
exit /b 0

:need_node
call :log "Node %NEED_MAJOR%+ is needed: install it from https://nodejs.org and restart Claude."
exit /b 1

:fail
rmdir /s /q "%DL%" 2>nul
call :log "%~1"
exit /b 1

:log
>&2 echo vibeschem: %~1
exit /b 0
