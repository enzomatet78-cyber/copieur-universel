# Détection d'un logiciel de bureau — `detect_app.ps1` (Windows) et `detect_app_mac.py` (macOS)

Référence de l'outil `$OUTILS/detect_app.ps1`, **Windows uniquement** (Windows PowerShell 5.1 ou PowerShell 7) ;
sous macOS, `detect_app_mac.py` (§7). `$OUTILS` = dossier `outils/` du plugin, résolu en chemin absolu. Commandes
écrites pour l'outil Bash (Git Bash sous Windows, bash/zsh sous macOS).

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
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -Path "C:/Program Files/MonAppli" -Out "$TRAVAIL/reconnaissance/detect.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -Path "C:/…/MonAppli.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -Path "$USERPROFILE/Desktop/MonAppli.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -Path code
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -ProcessName notepad
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -ProcessId 10580 -Compress
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

## 4. Frameworks reconnus → voie de capture (Windows ; macOS : §7)

| `framework` | Indices principaux | Voie de capture (skill `capture-bureau`) |
|---|---|---|
| `electron` | `resources\app.asar` ou `resources\app\`, `LICENSES.chromium.html`, « Electron/x » dans l'exe | CDP : `--remote-debugging-port=9229 --user-data-dir=<temp>` puis `cdp_eval.py` ; l'interface est du web |
| `nwjs` | `nw.dll`, `package.nw` | CDP, même principe |
| `cef` | `libcef.dll`, CefSharp | `--remote-debugging-port` si l'appli transmet ses arguments, sinon UIA + captures |
| `webview2` | `WebView2Loader.dll`, `Microsoft.Web.WebView2.*`, module `EmbeddedBrowserWebView.dll`, enfants `msedgewebview2.exe` | CDP via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` et `WEBVIEW2_USER_DATA_FOLDER=<temp>` ; le cadre natif en UIA |
| `tauri` | chaînes `__TAURI_`/`tauri.localhost` dans l'exe | comme WebView2 (Windows seulement : sous macOS, Tauri tourne en WKWebView, sans CDP → §7) |
| `wpf`, `winforms`, `winui3`, `uwp`, `maui`, `avalonia` | DLL/modules .NET et XAML, manifeste MSIX, références de l'assembly | UI Automation (`uia_dump.ps1`) + `window_shot.ps1` ; arbre UIA excellent en XAML, bon en WinForms, variable en Avalonia |
| `qt` | `Qt5Core.dll`/`Qt6Core.dll`, `platforms\qwindows.dll`, `libqt_plugin.dll` (VLC) | UIA (correct en Qt Widgets, partiel en QML) + captures ; vues Qt WebEngine : `QTWEBENGINE_REMOTE_DEBUGGING=9223` puis CDP |
| `java` | `jvm.dll`, `.jar`, runtime embarqué | captures + exploration ; UIA quasi vide sans Java Access Bridge (l'activer modifie le système : accord explicite) |
| `flutter` | `flutter_windows.dll`, `data\flutter_assets` | captures ; UIA partiel |
| `delphi`, `wx`, `gtk`, `tkinter`, `mfc`, `win32` | DLL caractéristiques, chaînes de l'exe | UIA (qualité variable) + captures |
| `gecko` | `xul.dll` | Firefox = navigateur (→ `capture-web`) ; Thunderbird & co : UIA + captures |
| `chromium-browser` | `chrome.dll`/`msedge.dll` | c'est un navigateur : → `capture-web` |
| `unity`, `unreal`, `godot` | `UnityPlayer.dll`, `*-Win64-Shipping.exe`, `.pck` | hors cœur de cible (rendu GPU) : seulement des menus recréés d'après captures, fidélité réduite annoncée |

## 5. Exemples réels (Windows, testés sur la machine de développement du plugin ; macOS : §7)
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
- **Electron/CEF/NW.js** (et, sous Windows, **WebView2/Tauri**) : une fois l'appli lancée selon `capture-bureau`,
  `cdp_eval.py list` donne les cibles (fenêtres, vues) ; dans la cible principale, injecter
  `routes-from-bundle.js` : `__stack()`, `__routes()` (souvent un routeur à hachage), `__inventory()`. En
  `file://`, `__routes` lit peu de choses : s'appuyer sur `__inventory()`, les menus et `ecransPresumes`. Sous
  macOS, les menus sont dans la barre de menus globale (pas dans le DOM) : les décrire ou les lire avec
  computer-use (`app_menu`).
- **Natif macOS** : voie images, §7.
- **Natif (Windows)** : `uia_dump.ps1` sur la fenêtre principale ; lire dans l'arbre la barre de menus (`MenuItem`), les
  onglets (`TabItem`), la barre d'outils, le volet de navigation (`ListItem`/`TreeItem`), la barre d'état. Un
  élément de menu terminé par « … » ouvre une boîte de dialogue : l'ouvrir, la relever avec `uia_dump.ps1`, la
  capturer, puis Échap. Les sous-menus s'ouvrent au clic et se referment avec Échap : ne jamais activer une
  commande qui agit (Enregistrer, Supprimer, Envoyer, Imprimer, Quitter sans enregistrer…), ni déplier les
  fichiers récents (fichiers de l'utilisateur).
- Noter pour chaque fenêtre : titre, taille de référence, thème (clair/sombre de Windows ; sous macOS,
  `defaults read -g AppleInterfaceStyle` répond `Dark`, ou une erreur en mode clair), échelle d'affichage (DPI
  sous Windows, ×2 sur un écran Retina), états (menus déroulants, onglets, panneaux repliables, infobulles, barre
  d'état).

## 7. macOS — `detect_app_mac.py`
Python standard, lecture seule : même rôle que `detect_app.ps1`, pour un paquet `.app`.
```
python3 "$OUTILS/detect_app_mac.py" --app "/Applications/Visual Studio Code.app" --out "$TRAVAIL/reconnaissance/detect.json"
python3 "$OUTILS/detect_app_mac.py" --app "Visual Studio Code"     (nom cherché dans /Applications, /System/Applications, ~/Applications, ~/Desktop, le PATH, puis Spotlight)
python3 "$OUTILS/detect_app_mac.py" --pid 12345                    (appli ouverte : ajoute ses bibliothèques chargées)
```
Options : `--out fichier.json` (UTF-8), `--compact` (JSON sur une ligne), `--max-mo 400` (taille maximale du
binaire parcouru pour les chaînes de Tauri). Un chemin à l'intérieur du paquet, ou le PID d'un `… Helper.app`,
est ramené à l'appli principale (avertissement). Durée : moins d'une seconde. Code retour 0 = framework reconnu ;
1 = `inconnu` ; 2 = erreur d'usage, avec `ok:false`, `erreur` et `pistes` (chemin introuvable, dossier sans
`.app`, PID absent ou non numérique, processus hors d'un `.app`, option inconnue). `--help` et `--version` en
français.

Ce qu'il lit, sans rien lancer ni décompiler :
- `Contents/Info.plist` : nom, `bundleId`, version, binaire principal, clés Sparkle et Java ;
- la liste de `Contents/Frameworks` : `Electron Framework.framework` (version lue dans son `Resources/Info.plist`),
  `Chromium Embedded Framework.framework` (CEF), `nwjs Framework.framework`, `Qt*.framework`,
  `FlutterMacOS.framework`, `Squirrel.framework` et `Sparkle.framework` (mises à jour), `<Navigateur>
  Framework.framework` ;
- `Contents/Resources/app.asar` (en-tête seulement : fichiers HTML, `package.json`) ou `app/`, et `product.json`
  (VS Code et dérivés) ;
- les commandes de chargement Mach-O du binaire principal : bibliothèques liées (AppKit, SwiftUI, WebKit, UIKit de
  `/System/iOSSupport`, JVM…) et plateforme (`MACOS`, `MACCATALYST`, `IOS`) — ce qu'affichent `otool -L` et
  `vtool -show-build`, sans les outils Xcode (résultats identiques vérifiés) ;
- quelques chaînes du binaire : `__TAURI__`, `tauri://localhost` (Tauri) ;
- avec `--pid` : `ps -p <PID> -o comm=` (chemin de l'exécutable) et `lsof -p <PID>` réduit aux noms des
  `.framework`/`.dylib` hors système (`processus.modulesCles`) ; le processus n'est pas touché.

Dossiers de données : **existence seulement**, lue dans la liste du dossier parent (`~/Library/Application
Support/<nom>`, `~/Library/Containers/<bundle id>`, `Group Containers`, `Caches`, `HTTPStorages`, `WebKit`,
`Preferences/<bundle id>.plist`, `~/.vscode` et équivalents) ; jamais ouverts, chemins écrits avec `~`.

Résultat (extrait, VS Code) :
```json
{
  "ok": true, "resume": "Code 1.141.0 : Electron 43.7.7 ; confiance haute ; CDP possible ; capture : capture-bureau",
  "framework": "electron", "libelle": "Electron 43.7.7", "confiance": "haute", "cdp": true,
  "indices": ["electron : Contents/Frameworks/Electron Framework.framework (version 43.7.7)", "..."],
  "app": "/Applications/Visual Studio Code.app", "nom": "Code", "bundleId": "com.microsoft.VSCode", "version": "1.141.0",
  "binaire": "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "plateforme": {"systeme": "MACOS", "minimum": "12.0", "archs": ["arm64"]},
  "electron": {"appli": "Contents/Resources/app", "format": "dossier non archivé", "version": "43.7.7", "vscode": {"dataFolderName": ".vscode", "...": "..."}},
  "ecransPresumes": {"source": "Contents/Resources/app", "liste": ["out/vs/code/electron-browser/workbench/workbench.html", "..."]},
  "misesAJour": ["Squirrel.Mac (Squirrel.framework, processus ShipIt) : ...", "..."],
  "donnees": {"dossiers": ["~/Library/Application Support/Code", "~/.vscode", "..."], "note": "Existence seulement : ne jamais lire ..."},
  "strategie": {"skill": "capture-bureau", "voie": "cdp", "commandes": [{"etape": "...", "commande": "..."}], "remarques": ["..."]},
  "avertissements": []
}
```
- `cdp` : vrai pour Electron, NW.js et CEF (si l'appli transmet ses arguments) ; faux pour tout le reste.
- `misesAJour` : Squirrel.Mac (processus `ShipIt` : `pgrep -lf ShipIt` après le lancement, **ne jamais
  l'arrêter**, le signaler), Sparkle (fenêtre « Mise à jour disponible » : jamais « Installer »), Mac App Store,
  `electron-updater`.
- `strategie.commandes` : étapes `{etape, commande}` prêtes, chemins réels. Elles **lancent** l'appli : ne les
  exécuter qu'en suivant `capture-bureau`. Voie `cdp` : profil `cu-<appli>-XXXXXXXX` créé par `mktemp -d` dans
  le dossier temporaire (VS Code et dérivés : `settings.json` avec `"update.mode": "none"` et dossier
  d'extensions vide, écrits **avant** le lancement), binaire `Contents/MacOS/<exe>` lancé avec
  `--remote-debugging-port=9229 --user-data-dir=…` puis `& echo "PID=$! PROFIL=$PROFIL"` (valeurs à noter en
  clair), `cdp_eval.py list` ; fermeture : `kill <PID>`, puis les restes de **ce** profil
  (`ps -axo pid=,command= | grep -F -- "--user-data-dir=<PROFIL noté>" | grep -v -e grep -e ShipIt`, jamais `kill -9` sur un
  arbre) et suppression du seul dossier `cu-*` du dossier temporaire. Voie `images` : binaire lancé seul
  (AppKit, SwiftUI, Catalyst : avec `-ApplePersistenceIgnoreState YES`, qui ne rouvre pas les fenêtres de la
  session précédente, pour ce lancement seulement), images de ses fenêtres, `kill <PID>`. Jamais `open -a` : pas
  de PID, et l'instance de l'utilisateur peut être réutilisée avec ses sessions.

| `framework` | Indices principaux | Voie de capture (skill `capture-bureau`) |
|---|---|---|
| `electron` | `Electron Framework.framework`, `app.asar` ou `app/` | CDP : binaire lancé avec `--remote-debugging-port` et `--user-data-dir` temporaire, puis `cdp_eval.py` |
| `nwjs` | `nwjs Framework.framework`, `app.nw` | CDP, même principe |
| `cef` | `Chromium Embedded Framework.framework` | CDP si l'appli transmet ses arguments ; `--user-data-dir` peut être ignoré (l'appli ouvrirait la session de l'utilisateur) : vérifier avec `list`, sinon images |
| `qt` | `Qt*.framework`, `libQt*.dylib` | images ; vues Qt WebEngine : `QTWEBENGINE_REMOTE_DEBUGGING=9223` au lancement, puis CDP pour ces vues |
| `flutter` | `FlutterMacOS.framework`, `flutter_assets` | images |
| `java` | `libjvm.dylib`, `*.jar`, clés Java d'`Info.plist` | images |
| `tauri` | chaînes `__TAURI__`, `tauri://localhost` ; WebKit lié | WKWebView : **pas de CDP**. L'Inspecteur web de Safari ne marche que si l'appli est construite « inspectable » : ne pas chercher à le forcer. Images |
| `catalyst` | plateforme `MACCATALYST`, UIKit de `/System/iOSSupport` | images (contrôles UIKit, aspect iPad) |
| `swiftui`, `appkit` | SwiftUI ou AppKit liés au binaire | images |
| `ios` | paquet `Wrapper/` (appli iPhone/iPad sur un Mac Apple silicon), plateforme `IOS` | hors cible, comme une appli mobile |
| `chromium-browser`, `gecko`, `webkit-browser` | bundle id, `… Framework.framework`, `Contents/MacOS/XUL` | navigateur : demander quel site → `capture-web` (`headless.py`) |
| `inconnu` (code 1) | aucun indice décisif | relancer avec `--pid` appli ouverte ; sinon images |

**Voie images (natif macOS, Tauri, Qt, Java, Flutter)** : les outils du plugin ne lisent ni l'arbre ni les
contrôles (`uia_dump.ps1`, `window_shot.ps1`, `glyphes.html` sont Windows uniquement). Inventaire et capture
d'après images : computer-use (`app_screenshot`, `app_menu` pour la barre de menus globale), ou
`screencapture -x -o -l <id de fenêtre>` sur une fenêtre du PID lancé (procédure :
`capture-bureau/references/natif.md` §9). Fidélité
réduite à annoncer, aucune mesure garantie (images ×2 sur un écran Retina). Les boutons rouge/orange/vert et les
menus sont dessinés par AppKit, hors de la fenêtre pour les menus. Les permissions Accessibilité et
Enregistrement de l'écran (Réglages Système > Confidentialité et sécurité) sont accordées par l'utilisateur
lui-même, jamais par l'agent. Pas de profil temporaire : l'appli ouvre les données de l'utilisateur ; une seule
instance (si la sienne est ouverte, lui demander de la fermer), écrans sans données personnelles ou masquées.

Exemples testés (Mac Apple silicon, macOS 26, lecture seule, aucune appli lancée) :
| Cible | Résultat | Remarque |
|---|---|---|
| `--app /System/Applications/Calculator.app` | `swiftui` (SwiftUI + AppKit), confiance moyenne, voie images | `~/Library/Containers/com.apple.calculator` signalé, jamais ouvert |
| `--app /System/Applications/Notes.app` | `swiftui`, WebKit lié, voie images | `Containers` et `Group Containers` signalés |
| `--app "/Applications/Visual Studio Code.app"` | Electron 43.7.7, haute, CDP ; `ecransPresumes` = `workbench.html`… ; Squirrel + mise à jour intégrée | stratégie avec `update.mode: none` et dossier d'extensions temporaire |
| `--app "Visual Studio Code"`, `--app calculator.app` | nom résolu (avertissement) | |
| Google Chrome rangé sur le Bureau | `chromium-browser` → `capture-web` | |
| appli Catalyst du Mac App Store | `catalyst` (plateforme `MACCATALYST`), « Mac App Store » dans `misesAJour` | |
| bundles factices : Electron + asar, VS Code factice, CEF, NW.js, Qt + WebEngine + Sparkle, Flutter, Tauri, Java, AppKit, SwiftUI, Catalyst, appli iPhone enveloppée, binaire sans indice | le bon `framework` pour chacun ; binaire sans indice → `inconnu`, code 1 | |
| `--pid` d'un `… Helper.app` factice | appli principale analysée (« processus annexe ») | |
| `--pid abc`, `--pid 999999`, PID d'un shell, dossier sans `.app`, aucune option | code 2, `ok:false`, `erreur` et `pistes` en français | |
