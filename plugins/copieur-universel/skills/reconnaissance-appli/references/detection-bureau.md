# Détection d'un logiciel de bureau — `detect_app.ps1`

Référence de l'outil `OUTILS/detect_app.ps1` (Windows PowerShell 5.1 ou PowerShell 7). `OUTILS` = dossier `outils/`
du plugin, résolu en chemin absolu.

## 1. Ce que fait l'outil (et ce qu'il ne fait pas)
Il répond à « avec quoi ce logiciel est-il construit, et comment le capturer ? » en lisant **sans rien lancer** :
- les noms de fichiers du dossier d'installation (3 niveaux, dossiers volumineux ignorés : `node_modules`,
  `locales`, `extensions`…) ;
- l'en-tête PE et les informations de version de l'exécutable principal ;
- les manifestes : `AppxManifest.xml` (MSIX/UWP), `package.json`/`product.json` (Electron), `*.runtimeconfig.json`,
  `*.deps.json` (.NET), l'**en-tête** de `app.asar` (liste des fichiers, `package.json`) ;
- quelques chaînes dans l'exécutable : version d'Electron/Chromium, **fusibles** Electron, références d'interface
  d'une assembly .NET, noms de ressources `.baml` (vues WPF) ;
- si le programme tourne déjà (ou avec `-ProcessName`/`-ProcessId`) : la liste des **modules chargés** et des
  **processus enfants** (rien n'est injecté, rien n'est modifié).

Il ne décompile rien, n'extrait aucune ressource et **ne lit pas** les dossiers de données (il dit seulement
qu'ils existent) : ils contiennent sessions, jetons et données personnelles.

## 2. Commandes
```
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -Path "C:\Program Files\MonAppli" -Out "%TRAVAIL%\reconnaissance\detect.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -Path "C:\…\MonAppli.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -Path "%USERPROFILE%\Desktop\MonAppli.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -Path code
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -ProcessName notepad
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\detect_app.ps1" -ProcessId 10580 -Compress
```
Options : `-Out fichier.json` (UTF-8), `-NoBinaryScan` (plus rapide, sans version Electron lue dans l'exe ni
fusibles), `-MaxScanMB 600`, `-Compress` (JSON sur une ligne). Une seule cible à la fois (`-Path`,
`-ProcessName` ou `-ProcessId`). Durée : 10 à 45 s selon la machine et sa charge (dont quelques secondes pour parcourir un exe de 200 Mo).
Code retour 0 = analyse faite ; 1 = erreur, avec `ok:false`, `erreur` et des `pistes` dans le JSON — y compris
pour un PID inexistant ou non numérique, un processus absent, un chemin introuvable, plusieurs cibles à la fois
ou un raccourci sans cible. Seul un nom de paramètre inconnu donne un message PowerShell (texte rouge).

Pour `-ProcessName`/`-ProcessId`, viser de préférence une instance **déjà ouverte** par l'utilisateur : l'outil
ne fait que lire la liste de ses modules. En lancer une juste pour la détection a des effets de bord : le
Bloc-notes de Windows 11, par exemple, rouvre au démarrage suivant les onglets de la session précédente — un
fichier de test ouvert pour l'occasion réapparaîtrait chez l'utilisateur.

Résolution de la cible :
- chemin introuvable → essai automatique du même nom sous `%LOCALAPPDATA%\Programs`, `Program Files`,
  `Program Files (x86)`, `%LOCALAPPDATA%`, `%APPDATA%` (avertissement). Exemple réel : VS Code installé « par
  utilisateur » n'est pas dans `C:\Program Files\Microsoft VS Code` mais dans
  `%LOCALAPPDATA%\Programs\Microsoft VS Code` ;
- nom de commande (`code`) → exécutable trouvé dans le PATH (un `bin\code.cmd` renvoie au dossier parent) ;
- raccourci `.lnk` → sa cible ; un raccourci d'appli du Store (cible vide) ou dont la cible a disparu → erreur
  claire (ouvrir l'appli et utiliser `-ProcessName`) ;
- fichier qui n'est pas un `.exe` → analyse de son dossier (avertissement) ;
- exécutable annexe (`Update.exe` de Squirrel, désinstalleur, `*_proxy.exe`, `crashpad`…) → l'outil choisit
  l'exécutable principal (interface graphique d'abord, puis le moins profond, le nom proche du dossier, le dossier
  `app-x.y.z` le plus récent, le plus gros) ;
- lanceur d'une appli du Store dans le dossier Windows (Windows 11 : `C:\Windows\System32\notepad.exe`,
  `mspaint.exe`…) → l'outil retrouve le paquet installé (`Get-AppxPackage`) et analyse son dossier, **sans
  lancer l'appli** (avertissement « n'est qu'un lanceur… ») ; testé : Bloc-notes → WinUI 3, confiance moyenne
  (dépendance `Microsoft.WindowsAppRuntime`). À la main : `-Path (Get-AppxPackage *Notepad*).InstallLocation` ;
- autre exe d'un dossier système (`System32`, `Program Files`…) → seule la racine est examinée, sans en tirer
  d'indices ;
- Plusieurs processus du même nom (Electron, Chrome) → le **processus principal** est choisi (sans `--type=`, avec
  fenêtre, parent hors du groupe).

## 3. Lire le résultat
```json
{
  "ok": true,
  "resume": "Visual Studio Code : Electron 43.6.0 (Chromium 150.0.7871.250) ; confiance haute ; capture : capture-bureau",
  "framework": "electron", "libelle": "...", "confiance": "haute", "hybride": null,
  "candidats": [{"framework": "electron", "score": 14}],
  "indices": ["electron +5 : dossier resources\\app\\ ... ", "electron +4 : chaîne « Electron/43.6.0 » ..."],
  "cible": {"mode": "chemin", "dossier": "...", "exe": "...", "processusEnCours": 0, "pidsEnCours": []},
  "executable": {"version": {"produit": "...", "editeur": "...", "versionProduit": "..."}, "pe": {"architecture": "x64", "interfaceGraphique": true, "assemblyDotnet": false}},
  "processus": {"pid": 0, "nom": "...", "titreFenetre": "...", "modulesCles": [], "enfants": []},
  "electron": {"version": "43.6.0", "chromium": "150.0...", "fusibles": {...}, "appli": "...", "format": "archive asar | dossier non archivé", "package": {"name": "...", "bibliothequesInterface": ["react@^18..."]}},
  "dotnet": {...}, "paquet": {...}, "qt": [...], "java": [...],
  "ecransPresumes": {"source": "...", "liste": ["out/vs/code/electron-browser/workbench/workbench.html"]},
  "donnees": {"dossiers": ["C:\\Users\\…\\AppData\\Roaming\\Code"], "registre": [], "note": "Existence seulement ..."},
  "strategie": {"skill": "capture-bureau", "methode": "...", "commandes": ["..."], "remarques": ["..."]},
  "notes": [], "avertissements": [], "dureeSecondes": 9.5
}
```
- `framework` + `confiance` (haute ≥ 7 points, moyenne ≥ 4, faible sinon) : relire `indices` quand la confiance
  n'est pas haute, et relancer avec `-ProcessName` pendant que l'appli est ouverte (les modules chargés lèvent
  presque toujours le doute).
- `hybride` : cadre natif + contenu web (ex. WPF + WebView2) → deux voies de capture.
- `electron.fusibles` : interrupteurs compilés dans l'exe. Pour la capture, seul compte le fait que
  `--remote-debugging-port` est une option **Chromium**, en principe non concernée par les fusibles
  (`EnableNodeCliInspectArguments` ne bloque que `--inspect`). Absents = Electron antérieur à 12.
- `electron.package.bibliothequesInterface` : React, Vue, Tailwind, MUI… → indique comment reconstruire.
- `ecransPresumes` : fichiers HTML de l'appli Electron (une fenêtre ≈ un fichier HTML) ou noms des vues WPF
  (`.baml`) → point de départ de l'inventaire des fenêtres.
- `donnees` : où l'appli range ses données. **Ne jamais lire ni copier** ; c'est la raison du profil temporaire.
- `strategie.commandes` : commandes prêtes à l'emploi (chemins réels). Celles qui contiennent `Start-Process`
  **lancent** l'appli : ne les exécuter qu'en suivant `capture-bureau` (profil temporaire, PID noté, fermeture de
  ce seul PID). La première (`Get-Process -Name … | Select-Object Id, StartTime`, avant et après le lancement)
  repère le PID apparu ; les commandes `uia_dump.ps1` / `window_shot.ps1` visent `-ProcessId <PID>` — le PID de
  cette instance-là, pas un nom de processus qui pourrait désigner une fenêtre de l'utilisateur ;
  `-ProcessId <PID> -ListWindows` (lecture seule) confirme ses fenêtres. Pour Electron : profil et dossier
  d'extensions temporaires, mises à jour bloquées dans le profil (VS Code et dérivés : `settings.json` écrit
  avant le lancement), `--target` par morceau d'URL, kit en mode raw, et fermeture limitée à notre profil sans
  toucher un installeur de mise à jour (`remarques`). Appli du Store (MSIX) : lancer sans fichier (voir
  `remarques`).

## 4. Frameworks reconnus → voie de capture

| `framework` | Indices principaux | Voie de capture (skill `capture-bureau`) |
|---|---|---|
| `electron` | `resources\app.asar` ou `resources\app\`, `LICENSES.chromium.html`, « Electron/x » dans l'exe | CDP : `--remote-debugging-port=9229 --user-data-dir=<temp>` puis `cdp_eval.py` ; l'interface est du web |
| `nwjs` | `nw.dll`, `package.nw` | CDP, même principe |
| `cef` | `libcef.dll`, CefSharp | `--remote-debugging-port` si l'appli transmet ses arguments, sinon UIA + captures |
| `webview2` | `WebView2Loader.dll`, `Microsoft.Web.WebView2.*`, module `EmbeddedBrowserWebView.dll`, enfants `msedgewebview2.exe` | CDP via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` et `WEBVIEW2_USER_DATA_FOLDER=<temp>` ; le cadre natif en UIA |
| `tauri` | chaînes `__TAURI_`/`tauri.localhost` dans l'exe | comme WebView2 |
| `wpf`, `winforms`, `winui3`, `uwp`, `maui`, `avalonia` | DLL/modules .NET et XAML, manifeste MSIX, références de l'assembly | UI Automation (`uia_dump.ps1`) + `window_shot.ps1` ; arbre UIA excellent en XAML, bon en WinForms, variable en Avalonia |
| `qt` | `Qt5Core.dll`/`Qt6Core.dll`, `platforms\qwindows.dll`, `libqt_plugin.dll` (VLC) | UIA (correct en Qt Widgets, partiel en QML) + captures ; vues Qt WebEngine : `QTWEBENGINE_REMOTE_DEBUGGING=9223` puis CDP |
| `java` | `jvm.dll`, `.jar`, runtime embarqué | captures + exploration ; UIA quasi vide sans Java Access Bridge (l'activer modifie le système : accord explicite) |
| `flutter` | `flutter_windows.dll`, `data\flutter_assets` | captures ; UIA partiel |
| `delphi`, `wx`, `gtk`, `tkinter`, `mfc`, `win32` | DLL caractéristiques, chaînes de l'exe | UIA (qualité variable) + captures |
| `gecko` | `xul.dll` | Firefox = navigateur (→ `capture-web`) ; Thunderbird & co : UIA + captures |
| `chromium-browser` | `chrome.dll`/`msedge.dll` | c'est un navigateur : → `capture-web` |
| `unity`, `unreal`, `godot` | `UnityPlayer.dll`, `*-Win64-Shipping.exe`, `.pck` | hors cœur de cible (rendu GPU) : seulement des menus recréés d'après captures, fidélité réduite annoncée |

## 5. Exemples réels (testés sur la machine de développement du plugin)
| Cible | Résultat | Remarque |
|---|---|---|
| `-Path "C:\Program Files\Microsoft VS Code"` | Electron 43.6.0, Chromium 150, confiance haute, fusibles lus, `ecransPresumes` = `workbench.html`… | chemin corrigé automatiquement vers l'installation par utilisateur ; nouvelle disposition de VS Code (ressources dans un sous-dossier haché) |
| `-ProcessName notepad` (Bloc-notes de Windows 11 ouvert) | WinUI 3 / Windows App SDK, MSIX FullTrust, données dans `%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe` | indice décisif : module `Microsoft.UI.Xaml.dll` chargé |
| `-Path "C:\Windows\System32\notepad.exe"` | WinUI 3 / Windows App SDK, MSIX, confiance moyenne, avertissement « n'est qu'un lanceur de l'appli du Store » | paquet `Microsoft.WindowsNotepad` analysé sans lancer l'appli |
| `-Path "C:\Windows\System32\cmd.exe"` | Win32, confiance faible | dossier système : seule la racine est examinée |
| `-ProcessId 999999`, `-ProcessId abc`, `-Path code -ProcessName notepad` | code 1, JSON `ok:false` avec `erreur` et `pistes` | messages en français, jamais d'exception brute |
| `-Path "C:\Program Files\Google\Chrome\Application"` | navigateur Chromium → `capture-web` | ne pas confondre avec Electron (pas d'`app.asar`, présence de `chrome.dll`) |
| `-Path "%LOCALAPPDATA%\Discord\Update.exe"` | Electron (analyse de `app-x.y.z\Discord.exe`, archive asar lue) | `Update.exe` (Squirrel) remplacé par l'exécutable principal |
| `-Path "C:\Program Files\VideoLAN\VLC"` | Qt (module d'interface `libqt_plugin.dll`) | confiance moyenne |

## 6. Après la détection : inventorier les fenêtres
- **Electron/WebView2/Tauri/CEF** : une fois l'appli lancée selon `capture-bureau`, `cdp_eval.py list` donne les
  cibles (fenêtres, vues) ; dans la cible principale, injecter `routes-from-bundle.js` : `__stack()`,
  `__routes()` (souvent un routeur à hachage), `__inventory()`. En `file://`, `__routes` lit peu de choses :
  s'appuyer sur `__inventory()`, les menus et `ecransPresumes`.
- **Natif** : `uia_dump.ps1` sur la fenêtre principale ; lire dans l'arbre la barre de menus (`MenuItem`), les
  onglets (`TabItem`), la barre d'outils, le volet de navigation (`ListItem`/`TreeItem`), la barre d'état. Un
  élément de menu terminé par « … » ouvre une boîte de dialogue : l'ouvrir, la relever avec `uia_dump.ps1`, la
  capturer, puis Échap. Les sous-menus s'ouvrent au clic et se referment avec Échap : ne jamais activer une
  commande qui agit (Enregistrer, Supprimer, Envoyer, Imprimer, Quitter sans enregistrer…), ni déplier les
  fichiers récents (fichiers de l'utilisateur).
- Noter pour chaque fenêtre : titre, taille de référence, thème (clair/sombre de Windows), échelle d'affichage
  (DPI), états (menus déroulants, onglets, panneaux repliables, infobulles, barre d'état).
