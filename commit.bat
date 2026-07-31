@echo off
REM ============================================================
REM  Kemence DEMO - commit + push a GitHubra
REM  Repo: https://github.com/farjan86/kemence-demo
REM  Hasznalat: dupla katt, vagy:  commit.bat "sajat uzenet"
REM ============================================================
setlocal
cd /d "%~dp0"
set REPO=https://github.com/farjan86/kemence-demo.git

where git >nul 2>nul || ( echo [HIBA] A git nincs telepitve vagy nincs a PATH-ban. & pause & exit /b 1 )

if not exist ".git" (
  git init
  git branch -M main
)
git remote get-url origin >nul 2>nul || git remote add origin %REPO%
git branch -M main

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Frissites %DATE% %TIME%"

echo [1/3] Valtozasok hozzaadasa (a .gitignore kizarja a titkokat)...
git add -A
echo    --- Ami felkerul (ellenorizd: NINCS kozte titok!): ---
git status --short
echo    ---------------------------------------------------
echo [2/3] Commit: "%MSG%"
git commit -m "%MSG%"
echo [3/3] Push a GitHubra...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [FIGYELEM] A push nem sikerult. Lehetseges okok:
  echo   - Meg nincs letrehozva a repo a GitHubon, vagy be kell jelentkezni.
  echo   - Ha a tavoli repoban regi commit van:  git push -u origin main --force
)
pause
