# Voie A — logiciels à interface web (Electron, WebView2, Tauri, CEF, NW.js, Qt WebEngine)

Ces logiciels affichent une page web dans une fenêtre. Lancés avec un **port de débogage**, ils se pilotent
exactement comme un Chrome headless : `cdp_eval.py` liste leurs fenêtres, évalue le kit de capture, écrit le DOM
nettoyé et fait les images. C'est la voie la plus fidèle : textes exacts, classes, styles calculés, SVG d'icônes.

`OUTILS` = dossier des outils du plugin (voir `SKILL.md`), `CAPTURE` = dossier de capture de l'unité,
`TRAVAIL` = dossier de travail hors du clone.

---

## 1. Lancer avec un port de débogage et un profil temporaire

Principe commun : **un port** (`--remote-debugging-port`), **un dossier de données neuf** (pour ne pas ouvrir la
session, les comptes et les fichiers de l'utilisateur), **le PID noté**. Les commandes prêtes à adapter sont
aussi dans `detect.json` → `strategie.commandes` (`detect_app.ps1`).

### Electron (cas général)
```powershell
$d = Join-Path $env:TEMP 'cu-monappli'                       # profil temporaire, propre à la capture
$p = Start-Process -FilePath 'C:\…\MonAppli.exe' -ArgumentList '--remote-debugging-port=9229', "--user-data-dir=`"$d`"" -PassThru
$p.Id                                                         # à noter dans notes.md
```
```
py "%OUTILS%\cdp_eval.py" --port 9229 --wait-port 20 list
```
Options Chromium utiles, transmises par Electron :
- `--disable-features=CalculateNativeWinOcclusion` : la fenêtre continue de se dessiner quand elle est cachée
  derrière d'autres (sinon `shot` peut attendre indéfiniment) ;
- `--force-device-scale-factor=1` : rendu à l'échelle 1, images directement en px CSS (la fenêtre paraît plus
  petite sur un écran à 125 % : c'est attendu).

**Mises à jour automatiques : les bloquer AVANT le lancement.** Une appli lancée pour la capture peut
télécharger puis installer sa nouvelle version : c'est arrivé avec VS Code sur profil temporaire (le processus
a lancé `CodeSetup-…exe /verysilent /update=…`, et l'installation de l'utilisateur est passée de 1.139 à 1.141).
Le profil temporaire ne protège pas l'installation elle-même. Bloquer la mise à jour dans les réglages du profil
quand l'appli en a (VS Code et dérivés : ci-dessous), et ne jamais arrêter un processus `*Setup*`,
`Update.exe` (Squirrel) ou `inno_updater` en cours : le laisser finir, puis le signaler à l'utilisateur.

Exemple testé (Visual Studio Code 1.139, Electron 43 ; installé dans `%LOCALAPPDATA%\Programs\Microsoft VS Code\`
ou `C:\Program Files\Microsoft VS Code\`), avec dossier d'extensions séparé (vide), sans télémétrie ni mise à
jour :
```powershell
$d = Join-Path $env:TEMP 'cu-vscode'; $x = Join-Path $env:TEMP 'cu-vscode-ext'
New-Item -ItemType Directory -Force -Path (Join-Path $d 'User'), $x | Out-Null
[IO.File]::WriteAllText((Join-Path $d 'User\settings.json'), '{"update.mode": "none", "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false, "telemetry.telemetryLevel": "off", "workbench.enableExperiments": false}')
$p = Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" -ArgumentList '--remote-debugging-port=9229',
  "--user-data-dir=`"$d`"", "--extensions-dir=`"$x`"", '--disable-telemetry',
  '--disable-features=CalculateNativeWinOcclusion', '--new-window' -PassThru; $p.Id
```
(`detect_app.ps1` génère ces commandes, chemins réels compris.) Pas de `--disable-extensions` : avec un dossier
d'extensions vide il n'apporte rien, et il ajoute une notification « All installed extensions are temporarily
disabled » qui n'existe pas dans l'appli normale et salit les images.

Résultat : une seule cible `page` (URL `…/workbench/workbench.html`, d'où `--target workbench`), `size` refusé
(Electron n'expose pas `Browser.getWindowForTarget` : utiliser `--viewport`), DPR 1,25 sur un écran à 125 %, et
le profil neuf affiche la fenêtre d'accueil « Welcome to VS Code » (connexion GitHub). C'est une **couche
modale** (`div.onboarding-a-overlay`, indice 1 de `__overlays()`) posée sur la page Welcome : la capturer, puis la
fermer par sa croix (`.onboarding-a-close-btn`, action autorisée) — jamais par « Continue without Signing In »
ni par un bouton de connexion.

### Applis installées par Squirrel (Slack, Discord, GitHub Desktop, anciennes versions de Teams…)
Le raccourci lance `Update.exe --processStart`, qui démarre `app-<version>\<Appli>.exe` puis disparaît. Deux
façons :
- lancer directement `%LOCALAPPDATA%\<Appli>\app-<version>\<Appli>.exe` avec les arguments ci-dessus ;
- ou `Update.exe --processStart "<Appli>.exe" --process-start-args "--remote-debugging-port=9229 --user-data-dir=<temp>"`.
Dans les deux cas, retrouver le vrai PID par la ligne de commande :
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*cu-monappli*' } | Select-Object ProcessId, ParentProcessId, Name
```
Le processus principal est celui dont la ligne de commande ne contient **pas** `--type=` (les autres sont ses
processus de rendu, GPU, utilitaires : `--type=renderer`, `--type=gpu-process`…).

### WebView2 (et Tauri sous Windows)
Les arguments passent par des variables d'environnement, lues au lancement par le processus et ses enfants :
```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP 'cu-monappli-wv2'
$p = Start-Process -FilePath 'C:\…\MonAppli.exe' -PassThru; $p.Id
```
Elles ne valent que pour les processus lancés depuis cette session PowerShell ; une instance déjà ouverte ne les
voit pas. Une appli qui impose son propre dossier de données peut ignorer la seconde : vérifier avec `list` que
l'on voit bien un écran vierge (non connecté) et non la session de l'utilisateur ; sinon s'arrêter et lui en
parler.

### CEF, NW.js, Qt WebEngine
- CEF : `--remote-debugging-port=9222` marche si l'appli transmet ses arguments à CEF (souvent pas avec CefSharp).
- NW.js : `--remote-debugging-port=9222`.
- Qt WebEngine : variable `QTWEBENGINE_REMOTE_DEBUGGING=9223` avant le lancement (seules les vues web sont
  inspectables ; le reste de l'appli est du Qt natif → voie B).

### Quand le port ne s'ouvre pas
`cdp_eval.py list` répond « aucun navigateur ni appli n'écoute » après `--wait-port 20` :
1. une instance était déjà ouverte et a reçu les arguments (instance unique) → profil temporaire, ou demander à
   l'utilisateur de fermer la sienne ;
2. l'appli filtre ses arguments ou refuse le débogage (choix de l'éditeur, fusibles Electron, contrôle au
   démarrage) → **ne pas contourner** : voie B (`natif.md`), fidélité moindre à annoncer ;
3. appli du Microsoft Store (dossier `WindowsApps`) : l'exe ne se lance souvent pas directement avec des
   arguments → voie B.

---

## 2. Choisir la bonne cible

```
py "%OUTILS%\cdp_eval.py" --port 9229 list
3 cible(s) sur 127.0.0.1:9229 (index ou id utilisable par --target) :
[0] page            Bienvenue - MonAppli | app://./index.html#/accueil | id=…
[1] page            (sans titre) | app://./background.html | id=…
[2] service_worker  … | id=…
```
- Les **pages** sont listées d'abord : `--target 0` est la première fenêtre, mais une appli peut avoir des
  fenêtres cachées (page de fond, fenêtre de mise à jour). Préférer un **morceau d'URL ou de titre** stable :
  `--target "index.html"`, `--target "workbench"`. L'index peut changer d'un appel à l'autre ; l'id ne change pas
  tant que la fenêtre existe.
- `webview` (balises `<webview>`), `iframe` hors processus, `service_worker` sont des cibles séparées : un
  panneau intégré (aperçu Markdown, extension) s'inspecte dans sa propre cible.
- `py "%OUTILS%\cdp_eval.py" --port 9229 version` donne la version d'Electron/Chromium (à noter).

---

## 3. Capturer avec le kit (mode raw)

Le kit et ses fonctions sont décrits dans `capture-web` (section 3). Différence avec Claude in Chrome : pas de
filtre de sortie, donc **mode raw** et fichiers écrits directement, sans morceaux de 900 caractères.

Chaque appel `eval` reprend `--file capture-kit.js` (réévalué à chaque fois, sans coût) :
```
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__config({raw:true, keep:['Prénom Nom'], owner:'titulaire@domaine.fr'})"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__info()" --out "%CAPTURE%\accueil\info.json"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__guessNames('body')"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__addNames(['Nom Réel 1','Nom Réel 2']); __anonLive()"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__styles('body')" --out "%CAPTURE%\styles.css"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__icons('body')" --out "%CAPTURE%\icones.txt"
py "%OUTILS%\cdp_eval.py" --port 9229 shot --target "index.html" --out "%CAPTURE%\accueil\01-fenetre.png"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "index.html" --file "%OUTILS%\capture-kit.js" --expr "__dump('body', 8)" --out "%CAPTURE%\accueil\dom-initial.html"
```
(Bash : mêmes commandes avec `"$OUTILS/cdp_eval.py"` ; PowerShell : `py "$env:OUTILS\cdp_eval.py"` si la variable
est définie, ou le chemin absolu.)
- `__guessNames` sans `--out` : le résultat (de vrais noms) s'affiche dans la conversation, on le relit, et il
  n'est **jamais écrit sur disque** — comme pour une appli web (`capture-web` §4).
- `__styles` et `__icons` d'abord, **dans l'état initial** : les styles calculés gardent la trace d'un panneau
  ouvert puis refermé (vu sur VS Code : l'icône Explorer restée « active » après un aller-retour).
- La configuration, le dictionnaire d'anonymisation et la surveillance de `__anonLive` vivent dans la page (et
  son `sessionStorage`) : ils restent valables d'un appel à l'autre tant que la fenêtre n'est pas rechargée.
  Après un rechargement ou une navigation, relancer `__anonLive()` avant toute image.
- Chemins locaux : le DOM d'une appli Electron cite ses fichiers (`vscode-file://vscode-app/c:/Users/<nom>/…`) ;
  le kit remplace le nom de session par `utilisateur` dans les dumps, `info.json` et `styles.css`, et
  `scan_pii.py` signale tout chemin `C:\Users\<nom>` resté dans le clone.
- L'expression peut utiliser `await` (attente de premier niveau acceptée) :
  `--expr "document.querySelector('[aria-label=Paramètres]').click(); await __wait(800); __info()"`.
- Les écrans d'une appli Electron sont souvent des routes à hachage (`#/reglages`) ou des états internes : pour
  changer d'écran, cliquer comme le ferait l'utilisateur (même liste autorisé/interdit qu'une appli web, voir
  `capture-web` → `references/chrome-connecte.md`), ou `nav` vers une URL **de l'appli elle-même**
  (`app://…#/reglages`) si elle le supporte. Pas de `history.pushState` scripté.

### Taille et échelle
- La taille de référence est celle de la fenêtre de l'appli (`__info().vw × vh`). `cdp_eval.py size --viewport
  1280x800` redimensionne la fenêtre quand l'appli le permet (sinon message clair) ; `--viewport 1280x800@1` sur
  `eval`/`shot` impose une taille et une échelle le temps de la commande, sans toucher à la fenêtre.
- Sur un écran à 125 %, `devicePixelRatio` vaut 1,25 et les images sont 1,25 fois plus grandes que les px CSS :
  le noter, ou capturer avec `--viewport <largeur>x<hauteur>@1`.
- `shot --full` ne sert que si le **document** défile ; une appli dont le contenu défile dans un conteneur
  interne se capture par `__steps()` / `__scroll(y)` + `shot` à chaque position, comme sur le web.

### Thème, polices et icônes embarquées
- `__styles()` (mode raw : rien n'est tronqué) liste les `@font-face`, et en section 3 les variables CSS de
  `:root` **et des ancêtres du conteneur principal**, couleurs d'abord : c'est là qu'est le thème d'une appli
  Electron (VS Code : les ~940 variables `--vscode-*` posées sur `.monaco-workbench`). La section 7 donne les
  règles par identifiant et par élément.
- `__icons()` relève aussi les **polices d'icônes** : pour VS Code, chaque `codicon` avec son code
  (`/* police codicon : files x2 | U+EAF0 | … */`). VS Code définit ses icônes par des alias
  (`--vscode-icon-<nom>-content`, ex. `explorer-view-icon`) résolus dans `styles.css`.
- Les fichiers de police et d'icônes livrés avec l'appli font partie de son code : ne pas les extraire de
  `app.asar`. Utiliser les polices système (Segoe UI…), des équivalents libres, ou le paquet public
  équivalent : pour VS Code, `@vscode/codicons` depuis jsDelivr, **version épinglée** — la version publique
  n'a pas forcément les glyphes les plus récents (manquaient `\eceb` et `\ecee`, remplacés par des glyphes
  voisins, écart à signaler). Un SVG présent dans le DOM rendu peut être recopié (usage personnel), comme sur
  le web.

---

## 4. Le cadre natif, les menus et ce qui n'est pas dans le DOM

| Élément | Où il vit | Comment le relever |
|---|---|---|
| Barre de titre Windows (appli non « frameless ») | fenêtre native | `uia_dump.ps1 -ProcessId <PID>` + `window_shot.ps1` |
| Barre de menus « Fichier, Édition… » (`Menu.setApplicationMenu`) | menu natif | `uia_dump.ps1 -ProcessId <PID> -Expand "Fichier"` ; image : `-KeepOpen` puis `window_shot.ps1 -IncludePopups`, puis `-CloseMenus` |
| Barre de titre dessinée en HTML (VS Code, Discord…) | DOM | voie A normale |
| Boutons Réduire/Agrandir/Fermer d'une appli sans cadre (Window Controls Overlay) | dessinés par Windows | absents du DOM **et** de `shot` (zone vide) ; seul `window_shot.ps1` les montre |
| Menus contextuels (clic droit) | souvent natifs (`Menu.popup`) | computer-use (clic droit, image, Échap) ou description |
| Boîtes « Ouvrir/Enregistrer », messages système | natives | voie B ; ne jamais valider |
| Icône de zone de notification, notifications | système | décrire ; hors du périmètre habituel |

Le PID à donner à `uia_dump.ps1` et `window_shot.ps1` est celui du processus **principal** (celui qui possède la
fenêtre, sans `--type=` dans sa ligne de commande) ; `uia_dump.ps1 -ProcessId <PID> -ListWindows` le confirme.
Plutôt que `-ProcessName`, qui viserait aussi une instance ouverte par l'utilisateur. Testé sur VS Code :
`window_shot.ps1` (PrintWindow) rend la fenêtre entière, boutons de fenêtre compris ; l'arbre UIA de la partie web
reste très court (Chromium n'active son accessibilité qu'à la demande) : pour le contenu, la voie A suffit.

---

## 5. Données, connexion et profil temporaire

- Un profil temporaire montre l'appli **non connectée** : écrans d'accueil, de connexion, d'intégration. C'est
  voulu ; ces écrans se capturent tels quels (le clone n'aura pas de formulaire de connexion fonctionnel).
- Si l'utilisateur veut les écrans connectés, c'est **lui** qui se connecte dans cette instance (l'agent ne tape
  jamais d'identifiants). Le compte est alors exploré en lecture seule stricte, comme une appli web connectée,
  avec anonymisation avant chaque image.
- À la fin, ce profil contient sa session (jetons) : le **supprimer** après fermeture de l'appli.

---

## 6. Fermer

```powershell
Get-CimInstance Win32_Process -Filter "ParentProcessId=<PID principal>" | Select-Object ProcessId, Name   # un *Setup* ? le laisser finir
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*cu-monappli*' -and $_.Name -notmatch 'setup|update|inno' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }        # notre profil seulement
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*cu-monappli*' }   # doit être vide (après 10 à 20 s)
```
Pas de `taskkill /PID <pid> /T` à l'aveugle : il emmène tous les enfants, y compris un installeur de mise à
jour lancé par l'appli, tué en pleine installation (risque d'abîmer l'installation de l'utilisateur). Le
processus principal peut rester visible 10 à 20 s après l'arrêt (VS Code sur une machine chargée) : revérifier,
puis arrêter ce qui reste **de notre profil**, avant de supprimer le dossier — chemin écrit **en entier**
(l'outil PowerShell de Claude Code bloque `Remove-Item` sur un chemin contenu dans une variable) : Git Bash
`rm -rf "C:/Users/…/Temp/cu-monappli"`, ou, pour des chemins trop longs (extensions installées d'office par une
stratégie de la machine), `[IO.Directory]::Delete('\\?\C:\Users\…\Temp\cu-monappli', $true)`. Les variables
`WEBVIEW2_*` disparaissent avec la session PowerShell qui les a définies ; dans une session réutilisée, les
retirer (`Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`).

---

## 7. Pièges

| Symptôme | Cause | Solution |
|---|---|---|
| `shot` attend puis « délai dépassé » | fenêtre minimisée ou cachée : Chromium ne dessine plus | `shot --front`, ou relancer avec `--disable-features=CalculateNativeWinOcclusion` |
| Première image uniforme (grise ou noire) alors que le DOM répond | fenêtre pas encore dessinée juste après le lancement (vu sur VS Code) | attendre que `document.title` soit renseigné, refaire `shot` |
| « HTTP 404 … pas un port de débogage CDP » | `--port` vise un autre serveur (serveur web local, autre appli) | vérifier le port de la ligne de commande |
| « connexion WebSocket interrompue » / « la cible s'est détachée » | appli fermée, fenêtre rechargée ou plantée pendant l'appel | `list`, puis recommencer sur la bonne cible |
| `list` montre la session de l'utilisateur (connecté, ses fichiers) | profil temporaire ignoré, instance existante réutilisée | arrêter la capture de cet état, fermer **notre** PID, en parler à l'utilisateur |
| `eval` renvoie `{}` | l'expression renvoie un objet non sérialisable | renvoyer une chaîne ou un objet simple ; un élément DOM est renvoyé sous forme d'`outerHTML` |
| Exception « … is not defined » sur une fonction du kit | `--file capture-kit.js` oublié dans la commande | chaque appel `eval` doit inclure `--file` |
| Les faux noms changent d'un écran à l'autre | fenêtre rechargée, `sessionStorage` vidé, autre cible | toujours la même cible ; `__addNames` à nouveau après un rechargement |
| Deux fenêtres identiques dans `list` | appli multi-fenêtres ou fenêtre cachée | choisir par titre/URL ; vérifier avec `shot` |
| `size` refusé | l'appli ne permet pas de redimensionner via CDP | `--viewport` sur `eval`/`shot`, ou taille d'origine |
| Images floues ou 1,25× trop grandes | `devicePixelRatio` de l'écran | `--viewport LxH@1` ou noter le DPR |
| Port déjà utilisé | une autre appli (ou une capture précédente) écoute | choisir un autre port (9230, 9231…) |
| Un processus `*Setup*` / `Update.exe` apparaît, l'appli change de version | mise à jour automatique au lancement | la bloquer dans le profil avant le lancement (§1) ; ne pas tuer l'installeur ; prévenir l'utilisateur |
| Notification « All installed extensions are temporarily disabled » sur les images | `--disable-extensions` | ne pas l'utiliser (dossier d'extensions vide), ou effacer la notification (croix) avant l'image |
| Mesures du clone 1 à 2 px plus courtes que l'original | original à DPR 1,25, clone mesuré à DPR 1 : les hauteurs de ligne s'arrondissent autrement | mesurer le clone au même DPR (`--viewport LxH@1.25`) ou l'original à `@1` |
| Une icône de l'état initial paraît « active » | styles relevés après une interaction | `__styles`/`__rects` avant toute interaction (§3) |
