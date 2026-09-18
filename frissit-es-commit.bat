@echo off
REM ============================================================
REM  Kemence DEMO - frissites a fejlesztoi projektbol + commit
REM    1) A szomszedos kemence-akademia\web tartalmat idemasolja
REM       (a config.js-t KIHAGYVA, hogy a demo sajat Supabase-e maradjon)
REM    2) Commitol es pushol a GitHubra
REM  Hasznalat: dupla katt, vagy:  frissit-es-commit.bat "sajat uzenet"
REM ============================================================
setlocal
cd /d "%~dp0"
set FORRAS=%~dp0..\kemence-akademia\web

if not exist "%FORRAS%\index.html" (
  echo [HIBA] Nem talalom a fejlesztoi web mappat: %FORRAS%
  pause & exit /b 1
)

echo [1/2] Masolas a fejlesztoi projektbol (config.js kihagyva)...
robocopy "%FORRAS%" "." /E /XF config.js /NFL /NDL /NJH /NJS /NC /NS
echo    Masolas kesz.
echo.
echo [2/2] Commit + push...
call "%~dp0commit.bat" %*
