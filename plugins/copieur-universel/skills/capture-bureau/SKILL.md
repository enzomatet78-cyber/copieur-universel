---
name: capture-bureau
description: "Capture fidèle d'un LOGICIEL DE BUREAU avant de le recréer en local : appli Electron (VS Code, Slack, Discord, Notion, Teams, Obsidian…), WebView2, Tauri, CEF, NW.js, ou appli Windows native (Win32, WPF, WinForms, WinUI 3/UWP, Qt). À utiliser dès qu'il faut copier, cloner, recréer, reproduire ou refaire l'interface d'un programme installé — même si la demande ne dit pas « capture » : « copie ce logiciel », « refais l'écran principal de Notepad », « clone l'interface de mon appli Electron », « relève les menus et les boîtes de dialogue », « fais des captures de toutes les fenêtres ». Lance l'appli sur un profil temporaire, relève le DOM par le protocole de débogage (cdp_eval.py + capture-kit.js) ou l'arbre UI Automation (uia_dump.ps1), capture les fenêtres (window_shot.ps1), explore menus, onglets et dialogues sans rien valider, anonymise et range tout dans un dossier de capture. EN: Use whenever a desktop program (Electron, WebView2, Tauri, CEF, NW.js or native Windows: Win32, WPF, WinForms, WinUI/UWP, Qt) must be captured faithfully before cloning, copying, recreating or replicating its UI — DOM through the Chrome DevTools Protocol, UI Automation tree, window screenshots, menus/dialogs/tabs explored read-only on a temporary profile, anonymized output — even when the user never says 'capture'."
---

# Capture bureau — relever fidèlement un logiciel installé

Comme pour le web, la capture est le **seul moment où l'on regarde l'original** : les constructeurs puis les
vérificateurs ne verront que ce qui aura été rangé dans le dossier de capture (structure, textes, positions,
images, notes). Un logiciel de bureau ajoute trois difficultés que ce skill traite :

1. **Il faut le lancer** — sans toucher aux données ni à la session de l'utilisateur (profil temporaire, document
   fictif, PID noté, fermeture de ce seul processus).
2. **Deux familles d'interfaces** — celles qui sont du web (Electron, WebView2, Tauri, CEF : on lit le DOM comme
   pour un site) et les natives (Win32, WPF, WinForms, WinUI, Qt : on lit l'arbre d'accessibilité UI Automation).
3. **Les états sont derrière des menus et des boîtes de dialogue** — qu'il faut ouvrir sans jamais rien
   enregistrer, envoyer ni modifier.

**Outils** : dossier `outils/` du plugin = `${CLAUDE_PLUGIN_ROOT}/outils/` ; si cette variable n'est pas remplacée,
utiliser `<Base directory de ce skill>\..\..\outils\` (résoudre en chemin absolu avant de lancer une commande).
Dans la suite, `OUTILS` désigne ce chemin absolu (cmd : `%OUTILS%`, bash : `$OUTILS`) et `CAPTURE` le dossier de
capture de l'unité, dans le dossier de travail hors du clone (le scratchpad de la session s'il existe).

| Outil | Rôle |
|---|---|
| `detect_app.ps1` | framework d'un exe ou d'une appli ouverte, stratégie et commandes prêtes (skill `reconnaissance-appli`) |
| `cdp_eval.py` | Python standard : `list`, `nav`, `eval` (fichier JS + expression → fichier UTF-8), `shot`, `hover`, `console`, `size`, `new`, `close`, `version` |
| `capture-kit.js` | kit DOM du skill `capture-web` (anonymisation, dumps, styles, icônes) ; en CDP : mode `raw` |
| `uia_dump.ps1` | arbre UI Automation d'une fenêtre → JSON ; navigation prudente (déplier un menu, choisir un onglet, ouvrir une boîte de dialogue, la refermer) |
| `window_shot.ps1` | image PNG d'une fenêtre (PrintWindow, même en arrière-plan) ou de l'écran si elle est dégagée ; menus ouverts compris |
| `png_diff.py` | couleur exacte d'un pixel (`couleur`), boîte de l'« encre » d'une zone (`encre`), comparaison d'images (`diff`) |
| `glyphes.html` | identifie une icône d'une capture dans la police Segoe Fluent Icons (corrélation ; mode d'emploi en tête du fichier) |

Commandes PowerShell : `powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\uia_dump.ps1" …` (marche
aussi depuis Git Bash ; la sortie est en UTF-8). Commandes Python : `py "<OUTILS>\cdp_eval.py" …`.

Fichiers de ce skill (relatifs à son Base directory) :
- `references/electron.md` — appli à interface web : lancement avec port de débogage et profil temporaire
  (Electron, WebView2, Tauri, CEF, NW.js, Qt WebEngine), lanceurs Squirrel, cibles multiples, kit en mode raw,
  cadre natif, fermeture ;
- `references/natif.md` — appli native : lecture du JSON UIA, correspondance contrôles → HTML, navigation
  prudente pas à pas, captures (îlots WinUI, DPI, menus), computer-use, cas Notepad de Windows 11, limites par
  framework.

Skills voisins : `copier-une-appli` (point d'entrée ; règles complètes `references/regles.md`, pièges
`references/lecons.md`), `reconnaissance-appli` (détection du framework avec `detect_app.ps1`, inventaire des
écrans), `capture-web` (le kit et le format des dumps, valables aussi pour Electron), `reconstruire-appli`
(après la capture ; lanceur `lancer-app.cmd` en fenêtre d'appli), `verifier-copie`.

---

## 1. Règles propres aux logiciels (pourquoi elles existent)

Elles appliquent `copier-une-appli/references/regles.md` §6 (et §1 : usage personnel et local, clone jamais
publié ni présenté comme l'original) ; elles priment sur la fidélité.

- **Profil ou dossier de données temporaire** dès que c'est possible (`--user-data-dir`, `WEBVIEW2_USER_DATA_FOLDER`).
  Une appli lancée sur le profil de l'utilisateur ouvre ses comptes, ses fichiers récents, ses conversations : ce
  sont des données de tiers, et toute fausse manœuvre s'y enregistre.
- **Document fictif** : pour montrer un état « document ouvert », créer un fichier de test dans le dossier de
  travail. Ne jamais ouvrir un fichier de l'utilisateur. **Exception** : les applis du Store qui restaurent
  leur session (Bloc-notes de Windows 11) n'ont pas de profil temporaire, et un fichier ouvert pour l'occasion
  réapparaîtrait chez l'utilisateur au lancement suivant : les lancer **sans fichier**, et remplacer dans les
  notes les noms d'onglets restaurés par des noms fictifs.
- **Mises à jour automatiques bloquées** : une appli lancée pour la capture peut télécharger et **installer**
  sa nouvelle version (vu : VS Code a lancé son installeur et mis à jour l'installation de l'utilisateur).
  Les bloquer dans le profil temporaire avant le lancement quand l'appli le permet (VS Code :
  `references/electron.md` §1), et ne jamais arrêter un installeur en cours.
- **Pas de fichiers récents** : le sous-menu « Récent » / « Ouvrir récent » affiche les fichiers de
  l'utilisateur ; `uia_dump.ps1` refuse de l'ouvrir. On décrit sa flèche, pas son contenu.
- **Lecture seule** : ouvrir un menu, un onglet, une boîte de dialogue, puis la refermer par Échap / Annuler /
  croix. Jamais « Enregistrer », « Envoyer », « Supprimer », « Appliquer », jamais taper dans un champ, jamais
  changer un réglage (de l'appli ou de Windows : thème, accessibilité, registre).
- **Ne fermer que ce qu'on a lancé**, par son PID noté. Une instance déjà ouverte par l'utilisateur ne se ferme
  pas, ne se relance pas : on lui demande.
- **Pas de décompilation** : ni `app.asar` extrait et recopié, ni assembly désassemblée, ni ressources tirées de
  l'exe. On reconstruit ce qu'on **observe** (DOM rendu, arbre UIA, images).
- **Aucun contournement** de connexion, licence, DRM, protection anti-débogage. Une appli qui refuse le port de
  débogage passe par la voie native, pas par un correctif.

---

## 2. Choisir la voie

D'abord la détection (skill `reconnaissance-appli`) :
`powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\detect_app.ps1" -Path "<exe ou dossier>" -Out "<TRAVAIL>\reconnaissance\detect.json"`
→ `framework`, `confiance` et `strategie.commandes` (commandes de lancement prêtes à adapter).

| `framework` | Voie | Ce qu'on obtient |
|---|---|---|
| `electron`, `nwjs`, `cef`, `webview2`, `tauri` | **A — CDP** (`references/electron.md`) | DOM exact, styles calculés, icônes SVG, images de la page ; + voie B pour le cadre natif (barre de titre, menus Windows) |
| `wpf`, `winui3`, `uwp`, `maui`, `winforms` | **B — UIA + images** (`references/natif.md`) | arbre complet (types, noms, positions, états), images ; styles à mesurer sur les images |
| `qt`, `win32`, `mfc`, `delphi`, `wx`, `avalonia` | **B**, plus d'observation visuelle | arbre partiel selon les contrôles ; Qt WebEngine : CDP aussi |
| `java`, `flutter`, moteurs de jeu | **B dégradée** : surtout des images | fidélité réduite, à annoncer à l'utilisateur |

Pourquoi préférer CDP quand il existe : le DOM donne les textes exacts, les classes, les couleurs et tailles
calculées et les SVG d'icônes — la reconstruction devient une recopie. L'arbre UIA donne la structure et les
positions mais pas les couleurs, polices ni marges : il faut les mesurer sur les images.

---

## 3. Lancer proprement (toutes voies)

1. **État initial** : `Get-Process <nom> -ErrorAction SilentlyContinue | Select-Object Id, StartTime` (les PID
   existants, sans lire les titres de fenêtres de l'utilisateur). Si l'appli est déjà ouverte par l'utilisateur :
   ne rien fermer ; beaucoup d'applis à instance unique transmettent le lancement à l'instance existante (nouvel
   onglet dans **sa** fenêtre, port de débogage ignoré). Un profil temporaire suffit souvent à obtenir une
   instance séparée ; sinon, lui demander de fermer la sienne.
2. **Lancer avec `Start-Process … -PassThru`** (fenêtre normale : avec `-WindowStyle Hidden` ou `Minimized`, la
   fenêtre de l'appli reste cachée ou réduite) et noter le PID. Attention aux **lanceurs** : le PID renvoyé peut
   disparaître aussitôt (Notepad de Windows 11, applis Squirrel `Update.exe --processStart`). Retrouver alors le
   vrai processus par différence avec l'état initial, ou par sa ligne de commande :
   `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*cu-<appli>*' } | Select-Object ProcessId, Name`.
   **Aucun nouveau processus** alors qu'une fenêtre est apparue = elle est hébergée par un processus **déjà
   ouvert** (instance unique, appli qui ouvre toutes ses fenêtres dans un seul processus) : ce PID n'est pas le
   nôtre, il ne s'arrête pas ; on en parle à l'utilisateur. Noter le PID **et** le handle de la fenêtre
   principale (`uia_dump.ps1 -ProcessId <PID> -ListWindows`) dans le `notes.md` de la capture ; l'agent
   principal les reporte ensuite dans le GUIDE du projet, que liront les autres agents.
3. **Taille de fenêtre** : la capturer telle que l'appli s'ouvre (c'est la taille de référence) ; noter
   `cadreEcran` et `echelle`. Ne pas redimensionner la fenêtre d'une appli qui mémorise sa position, sauf accord.
4. **Ne pas lancer `chrome.exe`/`msedge.exe` sans `--headless` et `--user-data-dir`** : sous Windows ils
   s'ouvriraient dans le navigateur de l'utilisateur.
5. **Avant le lancement**, bloquer les mises à jour automatiques dans le profil temporaire quand l'appli le
   permet (VS Code : `references/electron.md` §1). Après le lancement, un nouveau processus `*Setup*`,
   `Update.exe` ou `inno_updater` = une mise à jour démarre : le signaler à l'utilisateur et ne pas l'arrêter.

---

## 4. Voie A — interface web par CDP (résumé ; détails `references/electron.md`)

```powershell
$d = Join-Path $env:TEMP 'cu-monappli'
$p = Start-Process -FilePath '<chemin>\MonAppli.exe' -ArgumentList '--remote-debugging-port=9229', "--user-data-dir=`"$d`"" -PassThru; $p.Id
```
```
py "%OUTILS%\cdp_eval.py" --port 9229 --wait-port 20 list
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "<morceau d'URL>" --file "%OUTILS%\capture-kit.js" --expr "__config({raw:true}); __info()" --out "%CAPTURE%\info.json"
py "%OUTILS%\cdp_eval.py" --port 9229 eval --target "<morceau d'URL>" --file "%OUTILS%\capture-kit.js" --expr "__dump('body', 8)" --out "%CAPTURE%\dom-initial.html"
py "%OUTILS%\cdp_eval.py" --port 9229 shot --target "<morceau d'URL>" --out "%CAPTURE%\01-fenetre.png"
```
- `list` numérote les cibles (pages d'abord) ; viser la fenêtre principale par un morceau de titre ou d'URL
  (`--target "workbench"` pour VS Code) plutôt que par un indice qui peut changer ; `webview`, `iframe`,
  `service_worker` sont des cibles à part.
- `__styles`, `__icons` et `__rects` se relèvent **dans l'état initial, avant toute interaction** : les styles
  calculés gardent la trace d'un panneau ouvert puis refermé (vu sur VS Code).
- Le kit (`capture-web`, section 3) s'utilise tel quel : **mode raw** (`__config({raw:true})` une fois par
  fenêtre : conservé dans son `sessionStorage`), anonymisation `__addNames` / `__anonLive` **avant** chaque
  `shot`, puis `__dump`, `__styles`, `__icons`, `__chart`. `cdp_eval.py` réinjecte le fichier à chaque appel.
- Le résultat d'`eval` est écrit tel quel s'il s'agit d'une chaîne, en JSON sinon ; les promesses sont attendues ;
  les gros résultats (plusieurs Mo) passent sans découpage.
- Juste après le lancement, le DOM peut déjà répondre alors que la fenêtre n'est pas encore dessinée : la
  première image est alors **uniforme** (vu sur VS Code). Attendre que `document.title` soit renseigné, refaire
  `shot` et toujours regarder l'image.
- Le **cadre natif** (barre de titre Windows, menus « Fichier/Édition » d'une appli non « frameless ») n'est pas
  dans le DOM : le relever avec la voie B (`uia_dump.ps1`, `window_shot.ps1`). Dans une appli sans cadre
  (VS Code), les boutons Réduire/Agrandir/Fermer sont dessinés par Windows : absents du DOM **et** de l'image
  `shot` (zone vide à droite) ; seul `window_shot.ps1` les montre.

## 5. Voie B — appli native par UI Automation (résumé ; détails `references/natif.md`)

```
powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\uia_dump.ps1" -ProcessId <PID> -ListWindows
powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\uia_dump.ps1" -ProcessId <PID> -Out "<CAPTURE>\uia-principale.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\window_shot.ps1" -ProcessId <PID> -Out "<CAPTURE>\01-principale.png"
```
- Sélection de la fenêtre : `-ProcessId` (le plus sûr), `-ProcessName` (sans `.exe`), `-WindowTitle` (morceau
  ou joker `*`), `-Handle 0x…`. Plusieurs candidates → la première au premier plan, avec un avertissement.
- Actions et `autresFenetres` se limitent à la fenêtre visée, à ce qu'elle possède (menus, boîtes de dialogue),
  aux fenêtres surgissantes et à celles ouvertes pendant l'appel : une autre fenêtre principale du même
  processus peut appartenir à l'utilisateur. `-AllWindows` l'ajoute au relevé, en connaissance de cause.
- Le JSON : `fenetre` (handle, PID, classe, `cadreEcran`, `dpi`, `dpiEcran`, `echelle`), `arbre` (chaque nœud :
  `ControlType`, `Name`, `AutomationId`, `ClassName`, `FrameworkId`, `BoundingRectangle` relatif à la fenêtre,
  `IsEnabled`, `IsOffscreen`, `Patterns`, `States`, `Children`), `autresFenetres` (menus ouverts, boîtes de
  dialogue), `stats`.
- **Coordonnées en pixels physiques**, même origine que l'image de `window_shot.ps1` (coin du cadre visible) :
  un rectangle UIA se superpose directement à la capture — sauf si un menu ouvert déborde à gauche ou en haut
  (`-IncludePopups`) : ajouter alors le `decalage` {x, y} donné par `window_shot.ps1`. Pour des px CSS : diviser
  par `echelle`.
- Ce que UIA dit mal (WinUI 3 / Windows 11, vu sur le Bloc-notes) : le `Name` est le nom **accessible**
  (« Ligne 1, colonne 1 », « Zoom »), pas toujours le texte affiché (« Ln 1, Col 1 », « 100% ») ; le rectangle
  d'un `TextBlock` ne suit pas l'encre du texte ; la largeur d'un menu déroulant ignore la colonne des
  raccourcis. Texte affiché et positions fines se lisent sur l'image (`png_diff.py encre`) ; le `Name` sert
  d'`aria-label` dans le clone.
- Valeurs des champs **non relevées** par défaut (seulement leur longueur), mots de passe jamais ; emails,
  téléphones, IBAN, cartes et clés masqués dans les noms ; lignes de tableau limitées à 10 (`-MaxItems`).

---

## 6. Explorer les états sans rien modifier

Chaque menu, onglet, boîte de dialogue et menu contextuel oublié manquera au clone. Trois moyens, du plus sûr au
plus libre :

1. **`uia_dump.ps1` — navigation prudente intégrée** (aucune ne valide quoi que ce soit) :
   | Option | Effet | Garde-fou |
   |---|---|---|
   | `-Expand "Fichier"` ou `-Expand "Affichage,Zoom"` | déplie menus, sous-menus, listes déroulantes, nœuds d'arbre puis les replie après le relevé | motif ExpandCollapse seulement : déplier n'active rien ; sous-menus de fichiers récents refusés (vie privée) |
   | `-KeepOpen` puis `-CloseMenus` | laisse le menu ouvert pour `window_shot.ps1 -IncludePopups`, puis le referme | repli UIA, et `WM_CANCELMODE` pour les menus Win32 classiques |
   | `-SelectTab "Affichage"` | sélectionne un onglet | `TabItem` uniquement |
   | `-Invoke "Options…"` | ouvre une boîte de dialogue ou une vue | nom en « … » ou liste blanche (Options, Paramètres, Propriétés, À propos, Mise en page, Police, Rechercher…) ; jamais Enregistrer, Ouvrir, Parcourir, Imprimer, Exporter, Supprimer, Envoyer, Quitter, Se déconnecter… même avec « … » ; Rechercher/Remplacer/Atteindre/Police/Mise en page en élément de **menu** seulement (le bouton « Remplacer » d'une boîte remplacerait le texte) ; refus = code 2 |
   | `-CloseWindow "Options"` | ferme une boîte de dialogue (WM_CLOSE = Annuler) | jamais la fenêtre principale |

   Exemple : `-Expand "Fichier" -Invoke "Mise en page" -Out "<CAPTURE>\uia-dialogue-mise-en-page.json"`, puis
   `window_shot.ps1 -ProcessId <PID> -WindowTitle "Mise en page"` (le PID évite de viser une fenêtre d'une autre
   appli au titre voisin), puis `uia_dump.ps1 -ProcessId <PID> -CloseWindow "Mise en page" -Depth 0`.
2. **Voie A** : cliquer par `eval` un onglet ou un bouton d'ouverture (`document.querySelector('…').click()`),
   en respectant la même liste autorisé/interdit que pour une appli web (`capture-web`,
   `references/chrome-connecte.md`) ; Échap : `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`.
3. **computer-use** (si l'outil est disponible dans la session : charger d'abord le skill `computer-use`) pour ce
   que les deux premiers ne savent pas faire : survols et infobulles, menus contextuels (clic droit), raccourcis
   clavier d'affichage, glisser une barre latérale. Mêmes interdits ; ses captures montrent **tout l'écran**
   (fenêtres de l'utilisateur comprises) : s'en servir pour piloter, et verser au dossier les images de
   `window_shot.ps1`.

Un élément qu'aucun moyen ne permet d'ouvrir sans risque est **décrit** dans `notes.md` (libellé, position,
ce qu'il ferait) — c'est la règle « en cas de doute, ne pas cliquer ».

---

## 7. Anonymiser

- **Voie A** : comme `capture-web` section 4 (le kit masque emails, téléphones, secrets ; `__addNames` pour les
  personnes), toujours avant `shot`.
- **Voie B** : `uia_dump.ps1` masque emails, téléphones, IBAN, cartes et clés et ne relève pas les valeurs
  saisies ; il ne reconnaît pas les **noms de personnes** et `window_shot.ps1` ne masque **rien** dans les images.
  D'où le profil temporaire et le document fictif : la meilleure anonymisation est de ne jamais afficher de vraie
  donnée. Si l'appli montre quand même des données réelles (compte de l'utilisateur, fichiers récents, titres
  de fenêtre) : ne pas verser l'image, décrire l'écran, ou demander à l'utilisateur un compte de démonstration.
- **Regarder chaque image** avant de la ranger (Read sur le PNG) ; une donnée réelle visible = image refaite ou
  supprimée.

---

## 8. Dossier de capture

```
<TRAVAIL>\capture\<unité>\
  notes.md                       synthèse : appli, version, framework, voie, PID/handles, taille, échelle, thème
  <ecran>\                       nom stable : fenetre-principale, dialogue-options, dialogue-options-onglet-affichage
    notes.md                     modèle ci-dessous
    01-fenetre.png               window_shot (ou cdp shot) de l'état initial
    10-menu-fichier.png          menu ouvert (-IncludePopups)        20-dialogue-<nom>.png   30-onglet-<nom>.png
    uia-initial.json  uia-menu-fichier.json  uia-dialogue-<nom>.json          (voie B)
    dom-initial.html  info.json  styles.css  icones.txt                       (voie A, kit en mode raw)
```
Modèle de `notes.md` d'un écran :
```markdown
# <ecran> — <titre exact de la fenêtre>
- Appli : <nom> <version> (<framework>) — voie A/B — PID <n>, handle 0x… — capture <date>
- Fenêtre : cadre 1426×823 px physiques, échelle 1,25 → 1141×658 px CSS ; thème Windows clair/sombre ; DPI-aware oui/non
## Structure (de haut en bas)          ## États capturés (comment les obtenir, fichiers)
## Interactions observées              ## Polices, couleurs (mesurées sur l'image), icônes
## Non capturé (et pourquoi)           ## Anonymisation (profil temporaire, document fictif, images vérifiées)
```

---

## 9. Mesures utiles à la reconstruction

- **Px CSS = px physiques ÷ `echelle`** (DPI de l'écran / 96). Le clone ouvert dans un navigateur à la même
  échelle aura alors la même taille apparente. `agrandieParWindows: true` = appli non DPI-aware, que Windows
  agrandit (texte légèrement flou) : ses dimensions logiques sont les px CSS.
- **Couleur d'un pixel** d'une capture : `py "%OUTILS%\png_diff.py" couleur "<png>" 120,40 300,12` ;
  **boîte de l'encre** d'un texte ou d'une icône (position réelle, quand le rectangle UIA ne la suit pas) :
  `py "%OUTILS%\png_diff.py" encre "<png>" --zone x,y,l,h`.
- **Icônes Windows** : identifier le glyphe de la police Segoe Fluent Icons avec `OUTILS\glyphes.html`
  (corrélation de chaque zone de la capture avec les ~4 600 glyphes ; testé sur le Bloc-notes) plutôt que de
  deviner un code ; une icône absente de la police se recadre dans la capture (`reconstruire-appli`,
  `fidelite.md` §8). Taille relevée sur le Bloc-notes : 18 px physiques à 125 % = 14,4 px CSS, pas 16.
- **Polices** (à confirmer sur l'image) : WinForms .NET Framework → Microsoft Sans Serif 8,25 pt (≈ 11 px CSS),
  sauf menus et barres de titre (police système Segoe UI 9 pt) ; Win32 récent et WinForms .NET 6+ → Segoe UI
  9 pt (12 px) ; WPF → Segoe UI 12 px ; WinUI 3 / Windows 11 → Segoe UI Variable 14 px ; icônes Windows 11 →
  police Segoe Fluent Icons (présente sur la machine) ou Fluent UI System Icons (libre). Electron : `__styles()`.
- Voie A : mêmes mesures que le web (`__rects`, `scrollHeight`, palette calculée).

---

## 10. Fermer proprement

- Refermer d'abord ce qui est ouvert (menus : `-CloseMenus` ; boîtes de dialogue : `-CloseWindow`).
- Fermer **le PID noté**, après avoir vérifié qu'il s'agit bien du nôtre (nom, ligne de commande avec le profil
  temporaire), puis les processus dont la ligne de commande contient **notre** profil :
  `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*cu-<appli>*' -and $_.Name -notmatch 'setup|update|inno' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`.
  Un arrêt par PID n'enregistre rien. **Pas de `taskkill /T` à l'aveugle** : avant, lister les enfants
  (`Get-CimInstance Win32_Process -Filter "ParentProcessId=<PID>"`) ; un installeur de mise à jour (`*Setup*`,
  `Update.exe`, `inno_updater`) lancé par l'appli serait tué en pleine installation et pourrait abîmer
  l'installation de l'utilisateur — le laisser finir et le signaler. Éviter `Process.CloseMainWindow()` : sa
  « fenêtre principale » peut être une infobulle (vu sur Notepad) ; à défaut, `WM_CLOSE` au handle noté.
- Le processus principal d'une appli Chromium (Electron, Edge `--app`, Chrome) peut rester visible **6 à
  20 secondes** après l'arrêt, même après `Stop-Process -Force` (vu avec VS Code et Edge) : revérifier par la
  ligne de commande après quelques secondes, puis arrêter ce qui reste **de notre profil**.
- Si une boîte « Enregistrer les modifications ? » apparaît : **ne pas enregistrer** (Échap / « Ne pas
  enregistrer », ou arrêt par PID).
- Supprimer le profil temporaire créé pour l'occasion (**ce** dossier seulement ; le garder court,
  `%TEMP%\cu-<appli>`), en écrivant le chemin **en entier** : l'outil PowerShell de Claude Code refuse
  `Remove-Item` sur un chemin contenu dans une variable. Git Bash : `rm -rf "C:/Users/…/Temp/cu-<appli>"`.
  Chemins trop longs (extensions installées d'office par une stratégie de la machine, même dans un profil
  neuf) : `[IO.Directory]::Delete('\\?\C:\Users\…\Temp\cu-<appli>', $true)`. Chrome/Edge headless :
  `headless.ps1 -Action fermer` fait tout cela.
- Vérifier : `Get-Process <nom>` ne montre plus notre PID ; les instances de l'utilisateur sont intactes.

---

## 11. Critères de fin (par unité)

- Chaque écran a un `notes.md`, une image par état (fenêtre, menus ouverts, boîtes de dialogue, onglets) et son
  relevé (`uia-*.json` ou `dom-*.html`) ; taille, échelle, thème et framework sont notés.
- Tous les menus de la barre de menus et les boîtes de dialogue de la mission sont relevés, ou décrits avec la
  raison (« interdit », « non atteignable sans risque »).
- Aucune image ni aucun relevé ne contient de donnée réelle ou de secret ; chaque image a été regardée.
- L'appli lancée pour la capture est fermée (son PID seul), son profil temporaire supprimé, rien n'a été
  enregistré ni modifié dans l'appli ou dans Windows.
- Le compte rendu liste écrans, statuts, fichiers, mesures clés, limites (zones vides, contrôles non exposés).

---

## 12. Pièges fréquents

| Symptôme | Cause | Solution |
|---|---|---|
| Le PID renvoyé par `Start-Process` n'existe plus | lanceur (Notepad de Windows 11, Squirrel) | retrouver le vrai processus par différence ou par ligne de commande ; noter le handle |
| `-ListWindows` vide alors que le processus tourne | lancé avec `-WindowStyle Hidden`/`Minimized`, ou fenêtre pas encore ouverte | relancer en fenêtre normale ; attendre quelques secondes |
| `cdp_eval.py` : « HTTP 404 … pas un port de débogage CDP » | mauvais port (serveur web local, autre appli) | vérifier `--port` et la ligne de commande de l'appli |
| Première image CDP uniforme (toute grise/noire) | fenêtre pas encore dessinée juste après le lancement | attendre, refaire `shot` ; regarder chaque image |
| L'appli s'ouvre dans la fenêtre déjà ouverte de l'utilisateur | instance unique | profil temporaire ; sinon demander à l'utilisateur de fermer la sienne ; ne rien fermer soi-même |
| `cdp_eval.py list` : « aucun navigateur n'écoute » | port pas encore ouvert, argument filtré, instance existante | `--wait-port 20` ; vérifier la ligne de commande ; voie B en repli |
| Zones vides (onglets, menus, barres) sur l'image | îlots WinUI/XAML que PrintWindow ne rend pas toujours (Bloc-notes 11.2607 : complet lors d'un essai, onglets, menus et barre d'état vides lors d'un autre, fenêtre lancée derrière d'autres) | `-Activate` (capture d'écran, la fenêtre passe devant puis rend la main), ou mettre la fenêtre devant et relancer en mode Auto ; sinon arbre UIA et computer-use |
| Barre d'état transparente en bas de l'image | partie de la fenêtre sous la barre des tâches, capturée à l'écran | l'outil garde désormais PrintWindow dans ce cas ; sinon `-Method PrintWindow`, ou déplacer la fenêtre |
| Image d'un menu décalée par rapport aux rectangles UIA | le menu déborde à gauche/en haut : l'image commence avant le cadre | ajouter `decalage` {x, y} de la réponse aux rectangles |
| L'appli lancée installe sa mise à jour (`*Setup*`, `Update.exe` enfant) | mise à jour automatique au démarrage | bloquer avant le lancement (§3) ; ne pas tuer l'installeur ; prévenir l'utilisateur |
| `-Expand` refusé sur « Récent » | sous-menu des fichiers de l'utilisateur | voulu : décrire la flèche ; `-AllowRecent` seulement si la liste est fictive |
| « capture d'écran refusée : recouverte par … » | une autre fenêtre (de l'utilisateur) cache la cible | `-Activate`, ou la mettre devant ; jamais `-Force` sans regarder l'image |
| Bandes noires ou image trop petite | appli non DPI-aware | déjà corrigé par l'outil (rendu logique agrandi) ; vérifier `agrandieParWindows` |
| Relevé très lent ou arbre vide | appli qui n'expose pas l'accessibilité (Java, jeux, certains Qt/Delphi) | `-RawView`, `-Depth` réduit ; sinon images + description, fidélité réduite annoncée |
| `-Expand` : « Impossible d'exécuter l'opération » | le menu est déjà ouvert | `-CloseMenus`, puis recommencer |
| `-Invoke` refusé (code 2) | nom hors liste blanche, ou action interdite même avec « … » | c'est voulu : décrire l'élément, ou computer-use pour un simple survol |
| Image du menu sans le menu (`"fenetres": 1`) | le menu s'est refermé entre `-KeepOpen` et `window_shot.ps1` | recommencer les deux commandes ; sinon relevé UIA + description |
| Fenêtre minimisée | ne se dessine pas | `window_shot.ps1 -Restore` (restaure sans activer) |
| Premier appel très lent | compilation C# (mise en cache ensuite dans `%TEMP%\copieur-universel`) et démarrage de PowerShell | normal ; les appels suivants sont plus rapides |
| Accents illisibles dans un script `.ps1` | Windows PowerShell 5.1 lit un fichier sans BOM en ANSI | garder les `.ps1` en UTF-8 avec BOM |

---

## 13. Ensuite

La capture alimente `reconstruire-appli` : fondation d'abord (fenêtre principale validée → coque partagée :
barre de titre, menus, barre latérale, barre d'état), puis les écrans et boîtes de dialogue en parallèle. Le clone
d'un logiciel s'ouvre dans une fenêtre d'appli à la taille notée (`lancer-app.cmd`, Edge `--app`). `verifier-copie`
compare ensuite clone et capture : mêmes positions (rectangles UIA ÷ échelle), mêmes textes, mêmes états.
