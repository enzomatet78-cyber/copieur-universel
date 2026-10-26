@echo off
rem ==========================================================================================
rem  lancer-app.cmd : ouvre le clone dans une fenetre d'application (Edge --app), comme un logiciel.
rem  Plugin copieur-universel, skill reconstruire-appli. A placer a la RACINE du clone.
rem  Double-clic : demarre le serveur local si besoin (Python), puis ouvre la fenetre.
rem    lancer-app.cmd              ouvrir (demarre le serveur si besoin)
rem    lancer-app.cmd --verifier   afficher la configuration et l'etat, sans rien lancer
rem    lancer-app.cmd --serveur    demarrer seulement le serveur local
rem    lancer-app.cmd --arreter    arreter le serveur Python du port, s'il sert bien CE clone
rem  Windows uniquement (macOS/Linux : voir SKILL.md du skill reconstruire-appli).
rem  Encodage : UTF-8 sans BOM, fins de ligne CRLF ; commentaires sans accents, messages accentues
rem  affiches grace a chcp 65001 (restaure en sortie). Aucune variable n'est developpee dans un bloc
rem  ( ... ) : un chemin contenant ")" (ex. Program Files (x86)) casserait le bloc.
rem  Modifier les reglages avec un outil qui garde les CRLF (outil Edit, Bloc-notes, PowerShell), jamais
rem  sed -i de Git Bash : en LF seules, cmd saute aux mauvaises etiquettes (vu : il lancait « py » seul).
rem ==========================================================================================
setlocal EnableExtensions DisableDelayedExpansion

rem ---- Garde-fou : fins de ligne CRLF, verifiees AVANT toute etiquette (aucun goto avant ce test) ----
set "CU_SELF=%~f0"
powershell -NoProfile -Command "exit ([regex]::Matches([IO.File]::ReadAllText($env:CU_SELF), '(?<!\r)\n').Count)" >nul 2>&1
if errorlevel 1 if not errorlevel 9000 (echo [ERREUR] lancer-app.cmd a perdu ses fins de ligne CRLF : le reenregistrer en CRLF avant de le lancer.& exit /b 3)

rem ---- Reglages : a adapter (chacun peut aussi venir d'une variable d'environnement du meme nom) ----
if not defined CU_TITRE   set "CU_TITRE=Mon appli (clone)"
if not defined CU_ID      set "CU_ID=mon-appli"
if not defined CU_PORT    set "CU_PORT=8770"
if not defined CU_PAGE    set "CU_PAGE=/ecrans/principal/"
if not defined CU_LARGEUR set "CU_LARGEUR=1280"
if not defined CU_HAUTEUR set "CU_HAUTEUR=800"
rem Position facultative de la fenetre, ex. 100,60 (vide = choisie par Windows)
if not defined CU_POSITION set "CU_POSITION="
rem Profil de navigateur dedie au clone : fenetre independante, localStorage du clone conserve
if not defined CU_PROFIL  set "CU_PROFIL=%LOCALAPPDATA%\copieur-universel\profils\%CU_ID%"
rem Arguments supplementaires pour le navigateur (facultatif)
if not defined CU_NAV_EXTRA set "CU_NAV_EXTRA="
rem ---------------------------------------------------------------------------------------------------

set "CP_AVANT="
for /f "tokens=2 delims=:." %%a in ('chcp') do set "CP_AVANT=%%a"
chcp 65001 >nul

rem CU_PAGE = chemin d'URL d'une page du clone, sans parametres : /ecrans/principal/ (la barre finale est
rem ajoutee si elle manque, sinon http.server repond par une redirection 301) ou /ecrans/x/page.html
if not "%CU_PAGE:~0,1%"=="/" set "CU_PAGE=/%CU_PAGE%"
set "PAGE_FICHIER=%CU_PAGE%"
if /i "%CU_PAGE:~-5%"==".html" goto :page_ok
if /i "%CU_PAGE:~-4%"==".htm" goto :page_ok
if not "%CU_PAGE:~-1%"=="/" set "CU_PAGE=%CU_PAGE%/"
set "PAGE_FICHIER=%CU_PAGE%index.html"
:page_ok
set "RACINE=%~dp0."
set "URL=http://127.0.0.1:%CU_PORT%%CU_PAGE%"
set "FICHIER=%~dp0%PAGE_FICHIER:/=\%"
set "FICHIER=%FICHIER:\\=\%"
set "MODE=ouvrir"
if /i "%~1"=="--verifier" set "MODE=verifier"
if /i "%~1"=="--serveur"  set "MODE=serveur"
if /i "%~1"=="--arreter"  set "MODE=arreter"
if /i "%~1"=="--aide"     set "MODE=aide"
if "%~1"=="/?"            set "MODE=aide"
set "RC=0"

if "%MODE%"=="aide" goto :aide
if "%MODE%"=="arreter" goto :arreter

rem ---- Python (le lanceur py en priorite ; python seulement s'il fonctionne vraiment) ----
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY python -c "import http.server" >nul 2>nul && set "PY=python"

rem ---- Navigateur : Edge, sinon Chrome ----
set "PF86=%ProgramFiles(x86)%"
set "NAV="
if exist "%PF86%\Microsoft\Edge\Application\msedge.exe" set "NAV=%PF86%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set "NAV=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%PF86%\Google\Chrome\Application\chrome.exe" set "NAV=%PF86%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "NAV=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

set "POSARG="
if defined CU_POSITION set "POSARG=--window-position=%CU_POSITION%"

call :etat
if "%MODE%"=="verifier" goto :verifier

rem ---- Serveur local : deja la ? sinon le demarrer ----
if "%CODE%"=="200" goto :serveur_ok
if not "%CODE%"=="000" goto :err_port_repond
if "%PORT_PRIS%"=="1" goto :err_port_pris
if not defined PY goto :err_python
if not exist "%FICHIER%" goto :err_page
echo Démarrage du serveur local sur le port %CU_PORT%...
start "Serveur - %CU_TITRE%" /min %PY% -m http.server %CU_PORT% --bind 127.0.0.1 --directory "%RACINE%"
set /a ESSAIS=0
:attente
ping -n 2 127.0.0.1 >nul
call :etat
if "%CODE%"=="200" goto :serveur_ok
set /a ESSAIS+=1
if %ESSAIS% lss 15 goto :attente
echo [ERREUR] Le serveur ne répond pas sur %URL% (code %CODE%).
set "RC=1"
goto :fin

:serveur_ok
if "%MODE%"=="serveur" goto :serveur_pret
if not defined NAV goto :sans_nav
echo Ouverture de « %CU_TITRE% » : %URL%
start "" "%NAV%" --app="%URL%" --window-size=%CU_LARGEUR%,%CU_HAUTEUR% %POSARG% --user-data-dir="%CU_PROFIL%" --no-first-run --no-default-browser-check %CU_NAV_EXTRA%
goto :fin

:serveur_pret
echo Serveur prêt : %URL%
echo Pour l'arrêter : fermer la fenêtre « Serveur - %CU_TITRE% » ou lancer-app.cmd --arreter
goto :fin

:sans_nav
echo Edge et Chrome introuvables : ouverture dans le navigateur par défaut.
start "" "%URL%"
goto :fin

:err_port_repond
echo [ERREUR] Le port %CU_PORT% répond (HTTP %CODE%) mais pas avec la page %CU_PAGE%.
echo          Un autre programme ou un autre clone l'utilise : changer CU_PORT dans ce fichier.
set "RC=1"
goto :fin

:err_port_pris
echo [ERREUR] Le port %CU_PORT% est déjà occupé par un autre programme : changer CU_PORT dans ce fichier.
set "RC=1"
goto :fin

:err_python
echo [ERREUR] Python introuvable (ni « py » ni « python »). L'installer depuis https://www.python.org/
set "RC=1"
goto :fin

:err_page
echo [ERREUR] Page introuvable : %FICHIER%
echo          Corriger CU_PAGE dans ce fichier (chemin de l'écran principal, ex. /ecrans/principal/).
set "RC=1"
goto :fin

rem ---- --verifier : diagnostic sans effet ----
:verifier
set "T_PAGE=ABSENTE"
if exist "%FICHIER%" set "T_PAGE=présente"
set "T_PY=INTROUVABLE"
if defined PY set "T_PY=%PY%"
set "T_NAV=INTROUVABLE (navigateur par défaut)"
if defined NAV set "T_NAV=%NAV%"
echo Clone           : %RACINE%
echo Page            : %URL%
echo Fichier page    : %T_PAGE% - %FICHIER%
echo Python          : %T_PY%
echo Navigateur      : %T_NAV%
echo Profil dédié    : %CU_PROFIL%
echo Serveur         : HTTP %CODE% (200 = déjà prêt, 000 = arrêté) ; port occupé : %PORT_PRIS%
echo Commande        : "%NAV%" --app="%URL%" --window-size=%CU_LARGEUR%,%CU_HAUTEUR% %POSARG% --user-data-dir="%CU_PROFIL%" --no-first-run --no-default-browser-check %CU_NAV_EXTRA%
echo Fins de ligne   : CRLF (vérifiées au démarrage)
echo Taille          : %CU_LARGEUR%x%CU_HAUTEUR% = taille EXTÉRIEURE (cadre et barre de titre d'Edge compris) : contrôler innerWidth x innerHeight
goto :fin

rem ---- --arreter : arrete seulement le serveur Python qui ecoute sur le port ET sert ce clone ----
:arreter
set "PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%CU_PORT% .*LISTENING"') do if not defined PID set "PID=%%p"
if not defined PID goto :rien_a_arreter
set "IMAGE="
for /f "tokens=1 delims=," %%i in ('tasklist /fi "PID eq %PID%" /fo csv /nh') do set "IMAGE=%%~i"
echo.%IMAGE%| findstr /i /b /c:"python" /c:"py.exe" >nul || goto :pas_python
rem Ce serveur sert-il CE clone ? La page qu'il renvoie doit etre identique, octet pour octet, au fichier
rem du clone. Sinon c'est le serveur d'un autre projet (autre clone, autre agent) : on n'y touche pas.
set "VERIF=%TEMP%\cu-arret-%RANDOM%%RANDOM%.tmp"
set "MEME=0"
curl.exe -s -m 3 -o "%VERIF%" "%URL%" >nul 2>nul
fc /b "%VERIF%" "%FICHIER%" >nul 2>nul && set "MEME=1"
del /q "%VERIF%" >nul 2>nul
if not "%MEME%"=="1" goto :pas_ce_clone
taskkill /pid %PID% /f >nul 2>nul || goto :err_arret
echo Serveur arrêté (%IMAGE%, PID %PID%).
goto :fin

:rien_a_arreter
echo Aucun serveur n'écoute sur le port %CU_PORT%.
goto :fin

:pas_python
echo [ERREUR] Le port %CU_PORT% est tenu par « %IMAGE% » (PID %PID%), pas par Python : rien n'est arrêté.
set "RC=1"
goto :fin

:pas_ce_clone
echo [ERREUR] Le serveur Python du port %CU_PORT% (PID %PID%) ne sert pas ce clone : %URL% ne renvoie pas
echo          %FICHIER%. C'est le serveur d'un autre projet : rien n'est arrêté (vérifier CU_PORT et CU_PAGE).
set "RC=1"
goto :fin

:err_arret
echo [ERREUR] Impossible d'arrêter le PID %PID%.
set "RC=1"
goto :fin

:aide
echo lancer-app.cmd              ouvre le clone dans une fenêtre d'application (démarre le serveur si besoin)
echo lancer-app.cmd --verifier   affiche la configuration et l'état, sans rien lancer
echo lancer-app.cmd --serveur    démarre seulement le serveur local
echo lancer-app.cmd --arreter    arrête le serveur Python du port %CU_PORT%, s'il sert bien ce clone
echo Réglages en tête du fichier : CU_TITRE, CU_ID, CU_PORT, CU_PAGE, CU_LARGEUR, CU_HAUTEUR, CU_POSITION
goto :fin

rem ---- Sous-programme : CODE = code HTTP de la page (000 = rien), PORT_PRIS = 1 si le port ecoute ----
:etat
set "CODE=000"
for /f %%c in ('curl.exe -s -o nul -m 2 -w "%%{http_code}" "%URL%" 2^>nul') do set "CODE=%%c"
rem un port qui repond en HTTP est forcement pris : netstat (lent) seulement quand rien ne repond
set "PORT_PRIS=1"
if not "%CODE%"=="000" exit /b 0
set "PORT_PRIS=0"
netstat -ano -p tcp | findstr /r /c:":%CU_PORT% .*LISTENING" >nul && set "PORT_PRIS=1"
exit /b 0

:fin
if defined CP_AVANT chcp %CP_AVANT% >nul
if "%RC%"=="1" if "%MODE%"=="ouvrir" if not defined CU_SANS_PAUSE pause
endlocal & exit /b %RC%
