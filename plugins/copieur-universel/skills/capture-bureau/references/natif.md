# Voie B — logiciels Windows natifs (UI Automation + images)

UI Automation (UIA) est l'interface d'accessibilité de Windows : celle que lit un lecteur d'écran. Elle décrit
ce que l'appli **montre** — types de contrôles, libellés, positions, états — sans toucher à son code. C'est donc
la bonne source pour recréer une interface native : on observe, on ne décompile pas.

Ce qu'elle donne : la structure complète (menus, barres d'outils, onglets, champs, listes, tableaux, barre
d'état), les textes affichés, les positions au pixel près, les états (coché, déplié, sélectionné, désactivé),
les raccourcis clavier. Ce qu'elle ne donne pas : couleurs, polices, marges internes, icônes. Ceux-là se
mesurent sur les images de `window_shot.ps1`, qui partagent la même origine de coordonnées.

`OUTILS` = dossier des outils du plugin, `CAPTURE` = dossier de capture de l'unité (voir `SKILL.md`).
Abréviations ci-dessous : `UIA` = `powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\uia_dump.ps1"`,
`SHOT` = `powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\window_shot.ps1"`.

---

## 1. Déroulé type d'un écran

```
UIA -ProcessId <PID> -ListWindows                                       fenêtres visibles : handle, titre, classe, cadre, échelle
UIA -ProcessId <PID> -Out "<CAPTURE>\principale\uia-initial.json"        arbre complet de la fenêtre principale
SHOT -ProcessId <PID> -Out "<CAPTURE>\principale\01-fenetre.png"         image (PrintWindow, même en arrière-plan)
UIA -ProcessId <PID> -Expand "Fichier" -Out "<CAPTURE>\principale\uia-menu-fichier.json"
UIA -ProcessId <PID> -Expand "Fichier" -KeepOpen -Depth 0 -Out "<TRAVAIL>\tmp.json"
SHOT -ProcessId <PID> -IncludePopups -Out "<CAPTURE>\principale\10-menu-fichier.png"
UIA -ProcessId <PID> -CloseMenus -Depth 0 -Out "<TRAVAIL>\tmp.json"
UIA -ProcessId <PID> -Expand "Fichier" -Invoke "Options…" -Out "<CAPTURE>\dialogue-options\uia-initial.json"
SHOT -ProcessId <PID> -WindowTitle "Options" -Out "<CAPTURE>\dialogue-options\01-fenetre.png"
UIA -ProcessId <PID> -WindowTitle "Options" -SelectTab "Affichage" -Out "<CAPTURE>\dialogue-options\uia-onglet-affichage.json"
SHOT -ProcessId <PID> -WindowTitle "Options" -Out "<CAPTURE>\dialogue-options\30-onglet-affichage.png"
UIA -ProcessId <PID> -CloseWindow "Options" -Depth 0 -Out "<TRAVAIL>\tmp.json"
```
Répéter pour chaque menu de la barre de menus, chaque boîte de dialogue de la mission, chaque onglet. Le relevé
d'un menu ouvert (`-Expand`) contient le menu dans `autresFenetres` (fenêtre surgissante `#32768` pour un menu
Win32, `PopupWindowSiteBridge` pour un menu WinUI 3) ; le menu apparaît parfois aussi dans l'arbre principal.

Pourquoi `-Depth 0` pour les commandes de service : elles ne servent qu'à agir (ouvrir, fermer) ; inutile de
relever tout l'arbre.

Pourquoi `-ProcessId` plutôt que `-ProcessName` : le nom désignerait aussi une instance ouverte par l'utilisateur.
Et même avec le bon PID, certaines applis ouvrent toutes leurs fenêtres dans un seul processus : les actions
(`-Expand`, `-Invoke`, `-CloseMenus`…) et `autresFenetres` ne visent donc que la fenêtre choisie, ce qu'elle
possède (menus, boîtes de dialogue), les fenêtres surgissantes et celles apparues pendant l'appel. Une boîte de
dialogue **non possédée** déjà ouverte (WPF sans `Owner`) se vise par son titre : `-ProcessId <PID> -WindowTitle "Options"`.

---

## 2. Lire le JSON

```json
{
  "dpi": {"processus": "per-monitor-v2", "fenetre": 120, "ecran": 120, "echelle": 1.25},
  "fenetre": {"handle": "0x2B05FA", "titre": "…", "processus": "Notepad", "pid": 18864, "classe": "Notepad",
              "cadreEcran": {"x": 327, "y": 320, "w": 1426, "h": 823}, "echelle": 1.25},
  "actions": ["Expand « Fichier » : ok -> MenuItem « Fichier »", "Repli après relevé : ok"],
  "stats": {"noeuds": 108, "profondeurMax": 6, "tronque": false, "elementsNonAffiches": 0, "masquages": 0},
  "arbre": {"ControlType": "Window", "Name": "…", "BoundingRectangle": {"x": -7, "y": 0, "w": 1440, "h": 830}, "Children": [
    {"ControlType": "TabItem", "Name": "style.css. Non modifié.", "ClassName": "ListViewItem", "FrameworkId": "XAML",
     "BoundingRectangle": {"x": 61, "y": 12, "w": 298, "h": 40}, "IsEnabled": true, "IsOffscreen": false,
     "Patterns": ["SelectionItem", "ScrollItem"], "States": {"Selected": false}}
  ]},
  "autresFenetres": [{"fenetre": {…, "position": {"x": 1, "y": 63, "w": 193, "h": 101}}, "arbre": {…}}]
}
```
- **Coordonnées** : pixels physiques, relatives au coin haut-gauche du **cadre visible** de la fenêtre principale
  (les fenêtres surgissantes et boîtes de dialogue aussi, d'où des positions comparables sur une même image).
  Un `x` négatif sur le nœud `Window` est normal : UIA inclut les bordures invisibles de Windows 10/11.
- **Px CSS = px ÷ `echelle`** (échelle de l'**écran**). `agrandieParWindows: true` : appli non DPI-aware, que
  Windows agrandit ; ses dimensions « logiques » sont les px CSS.
- **Ce que l'arbre dit mal** (WinUI 3, mesuré sur le Bloc-notes 11.2607 à 125 %) :
  - `Name` = nom **accessible**, pas toujours le texte affiché : « Ligne 1, colonne 1 » s'affiche
    « Ln 1, Col 1 », « Zoom » s'affiche « 100% », « Titres » s'affiche « H1 ». Le texte affiché se lit sur
    l'image ; le `Name` devient l'`aria-label` du clone ;
  - le rectangle d'un `TextBlock` ne suit pas l'encre (« Ln 1, Col 1 » : UIA x = 21, encre x = 31) :
    `py "<OUTILS>\png_diff.py" encre <png> --zone x,y,l,h` ;
  - un menu déroulant WinUI (`PopupWindowSiteBridge`) annonce 278 px de large pour des éléments qui en
    occupent 339 (colonne des raccourcis non comptée) : largeur des menus WinUI à mesurer sur l'image.
- `Patterns` dit ce que le contrôle sait faire (Invoke = bouton, Toggle = case, ExpandCollapse = menu ou liste
  déroulante, SelectionItem = onglet/élément sélectionnable, Value = champ, RangeValue = curseur/progression,
  Grid/Table = tableau) ; `States` donne l'état affiché (`Toggle: On`, `ExpandCollapse: Collapsed`,
  `Selected`, `Focused`, `Range`, `Rows/Columns`, `Modal`).
- `Value` : `[masquée : 13 caractères]` (défaut) ; `-IncludeValues` relève le texte (masquage des emails, etc.
  toujours actif) — seulement sur un document fictif.
- `ChildrenNotShown` / `ItemsNotShown` : enfants non relevés (profondeur, `-MaxNodes`, ou lignes au-delà de
  `-MaxItems` 10 / `-MaxListItems` 40). La structure suffit ; les données du clone seront fictives.
- `AcceleratorKey` (Ctrl+S) et `AccessKey` (lettre soulignée) : à reproduire dans les menus du clone.

### Correspondance contrôles → HTML

| ControlType | Dans le clone | À relever en plus sur l'image |
|---|---|---|
| `Window`, `TitleBar` | cadre de la fenêtre d'appli ; barre de titre (natif : hauteur 30–32 px CSS sous Windows 11) | couleur de fond, icône, boutons |
| `MenuBar`, `MenuItem`, `Menu` | barre de menus, menus déroulants (raccourcis à droite, séparateurs) | hauteur des lignes, survol |
| `ToolBar`, `Button`, `SplitButton` | `<button>` avec icône (Fluent UI System Icons, Segoe Fluent Icons) | taille d'icône, espacement |
| `Tab`, `TabItem` | onglets (`role="tab"`) | onglet actif, soulignement |
| `Edit`, `Document` | `<input>`, `<textarea>`, zone d'édition | bordure, police, placeholder |
| `ComboBox`, `List`, `ListItem` | liste déroulante / liste (`<select>` stylé ou composant) | flèche, hauteur des éléments |
| `CheckBox`, `RadioButton` | cases et boutons radio (état `Toggle`/`Selected`) | style Windows 11 arrondi |
| `Slider`, `ProgressBar`, `Spinner` | `<input type="range">`, barre de progression | couleur d'accent |
| `Tree`, `TreeItem` | arbre dépliable | indentation, chevrons |
| `DataGrid`, `Table`, `Header`, `HeaderItem`, `DataItem` | `<table>` (en-têtes exacts, lignes fictives) | lignes alternées, grille |
| `StatusBar` | barre d'état | séparateurs |
| `Group` | cadre titré (`<fieldset>`) | bordure |
| `Hyperlink`, `Text` | lien, libellé | couleur |
| `Pane`, `Custom` | conteneurs (`<div>`) ; `Custom` = contrôle maison, à regarder sur l'image | tout |

---

## 3. Navigation prudente, cas par cas

- **Menus** : `-Expand "Fichier"` (plusieurs niveaux : `-Expand "Affichage,Zoom"` ; avec `powershell -File`,
  `"Affichage","Zoom"` arrive aussi en une seule chaîne, découpée à la virgule par l'outil). Repli automatique
  après le relevé ; `-KeepOpen` pour l'image puis `-CloseMenus`. Un menu Win32 classique qui résiste au repli
  UIA est fermé par `WM_CANCELMODE` (fait par l'outil). Testé : sous-menu WinForms relevé et composé sur l'image
  (trois fenêtres : principale, menu, sous-menu).
- **Jamais les fichiers récents** : « Récent », « Ouvrir récent », « Fichiers récents », « Open Recent »
  listent les fichiers de l'utilisateur (noms, dossiers). L'outil refuse de les déplier (code 2) ; on relève le
  libellé et la flèche › du menu parent, et le clone montre une liste fictive. `-AllowRecent` seulement si la
  liste est forcément fictive (profil temporaire d'une appli qui en a un).
- **Boîtes de dialogue** : `-Invoke` n'active qu'un élément qui **ouvre** quelque chose : nom terminé par « … »
  (convention Windows) ou liste blanche (Options, Paramètres, Préférences, Propriétés, À propos, Mise en page,
  Police, Rechercher, Remplacer, Atteindre et équivalents anglais). Tout autre nom est refusé (code de sortie 2) :
  « Enregistrer », « Imprimer », « Envoyer », « Supprimer », « Quitter », « Aide » (ouvrirait le navigateur)…
  Certaines actions restent refusées **même avec « … »** : Enregistrer (sous), Ouvrir, Parcourir, Imprimer,
  Exporter, Importer (boîtes système qui montrent les fichiers et imprimantes de l'utilisateur), Supprimer,
  Envoyer, Partager, Quitter, Fermer, Se déconnecter, Réinitialiser, Mettre à jour, Renommer, Déplacer…
  Rechercher, Remplacer, Atteindre, Police et Mise en page ne sont activés que comme **élément de menu** : dans la
  boîte « Remplacer », le bouton du même nom remplacerait le texte du document (testé : refusé, texte intact).
  Une commande Win32 qui ouvre une boîte **modale** peut ne pas « répondre » à UIA : l'action est notée
  « lancé, sans réponse en 3 s », c'est normal, la boîte est ouverte.
- **Fermer une boîte** : `-CloseWindow "<titre>"` envoie WM_CLOSE (équivalent d'Annuler / croix). Refusé sur une
  fenêtre principale, qui pourrait demander « Enregistrer ? » (message « REFUSÉ : c'est la fenêtre principale »,
  code 2) ; une autre fenêtre principale du même processus n'est même pas candidate.
- **Onglets** : `-SelectTab "<nom>"` (TabItem seulement). Dans une boîte de dialogue, viser la boîte :
  `-ProcessId <PID> -WindowTitle "Options" -SelectTab "Affichage"`.
- **Listes déroulantes** : `-Expand "<nom de la liste>"` les ouvre sans changer la sélection.
- **Menus contextuels, survols, infobulles, glisser** : pas de moyen sûr par UIA → computer-use (section 5) ou
  description dans `notes.md`.
- Jamais : saisir du texte, cocher une case, changer une sélection qui modifie un réglage, valider une boîte
  (OK, Appliquer, Enregistrer). Une case à cocher n'est **pas** un onglet : on la relève, on ne la bascule pas.

---

## 4. Images : méthodes et limites

| Situation | Ce que fait `window_shot.ps1` | À faire |
|---|---|---|
| Fenêtre classique (Win32, WinForms, WPF) | PrintWindow : image exacte, même derrière d'autres fenêtres, sans l'activer | rien |
| Appli non DPI-aware (`agrandieParWindows`) | rendu à la taille logique puis agrandi comme Windows l'affiche | rien (léger flou normal) |
| Îlots WinUI 3 / XAML / UWP (`composition` non vide dans la réponse) | Auto passe à la capture d'écran si la fenêtre est dégagée **et** entièrement au-dessus de la barre des tâches ; sinon garde PrintWindow (une capture d'écran rendrait transparente la partie sous la barre : barre d'état perdue, vu sur le Bloc-notes) | regarder l'image ; zone vide → l'autre méthode : `-Activate` (la fenêtre passe devant, attente `-DelayMs`, puis le premier plan est rendu), ou `-Method PrintWindow` si c'est la capture d'écran qui a échoué (PrintWindow rend les îlots XAML de façon inégale : complet lors d'un essai sur le Bloc-notes 11.2607, vide lors d'un autre) |
| Fenêtre recouverte (mode Screen) | **refus** : l'image contiendrait une autre fenêtre de l'utilisateur (y compris une autre fenêtre principale du même processus ; les menus et boîtes de l'appli passent) ; la barre des tâches est simplement rendue transparente | `-Activate`, ou la mettre devant ; `-Force` seulement en regardant l'image |
| Menu ou liste ouverte | `-IncludePopups` compose les fenêtres surgissantes au-dessus ; le reste est transparent. La **marge d'ombre** d'un menu WinUI (~7 px, noire avec PrintWindow, et qui laisse voir à l'écran les fenêtres de derrière) est retirée hors de la fenêtre ; au-dessus de la fenêtre, l'ombre reste visible comme à l'écran | ouvrir avec `-Expand … -KeepOpen` d'abord ; vérifier `"fenetres": 2` (ou plus) dans la réponse : un menu peut s'être refermé entre les deux commandes (vu une fois sur un menu WPF) → recommencer. Si le menu déborde à gauche/en haut, l'image commence avant le cadre : `"decalage": {"x", "y"}` = position du cadre dans l'image, à ajouter aux rectangles UIA |
| Fenêtre minimisée | refus explicite | `-Restore` (restaure sans activer) |
| `-NoCrop` | garde les bordures invisibles (rarement utile) | — |

Chaque réponse est une ligne JSON (`methode`, `largeur`, `hauteur`, `cadreEcran`, `echelle`, `composition`,
`decalage`, `origine`) : la recopier dans `notes.md`. Puis **regarder l'image** (Read sur le PNG).

`-Activate` change brièvement la fenêtre au premier plan de l'utilisateur : l'utiliser avec parcimonie, une
fois par état, et jamais pendant qu'il tape (prévenir si la session est partagée).

---

## 5. computer-use

Si la session dispose de computer-use (application de bureau Claude), charger d'abord le skill `computer-use`,
puis demander l'accès à l'appli à capturer. Il sert à ce que UIA ne fait pas : clic droit (menus contextuels),
survol (infobulles, états « hover »), raccourcis clavier d'affichage, défilement d'une zone. Règles :
- mêmes interdits que partout : ni saisie, ni validation, ni réglage ; Échap pour refermer ;
- ses captures montrent **tout l'écran** (autres fenêtres de l'utilisateur comprises) : s'en servir pour voir et
  piloter, mais verser au dossier les images de `window_shot.ps1` (cadrées sur la fenêtre) ;
- s'il n'est pas disponible (agent de Workflow, session sans bureau), décrire ces états dans `notes.md`.

---

## 6. Cas réels testés (octobre 2026, Windows 11, écran à 125 %)

**Bloc-notes de Windows 11** (WinUI 3, paquet Microsoft Store, version 11.2607) :
- Détection sans lancer l'appli : `detect_app.ps1 -Path C:\Windows\System32\notepad.exe` reconnaît le lanceur
  et analyse le paquet installé (WinUI 3, confiance moyenne).
- `Start-Process notepad.exe` (**sans fichier**) renvoie le PID d'un **lanceur** qui disparaît ; le vrai
  processus `Notepad` (dans `WindowsApps`) a un autre PID → le retrouver par différence avant/après. Si un
  Bloc-notes de l'utilisateur est déjà ouvert, le lancement peut ajouter un onglet ou une fenêtre à **son**
  processus (aucun nouveau PID) : ne pas capturer, ne rien arrêter, lui demander de fermer le sien.
- Il **restaure les onglets** de la session précédente : les noms de fichiers ouverts auparavant apparaissent
  (titre de fenêtre, onglets). Ce sont des données de l'utilisateur : ne pas les verser telles quelles (les
  remplacer par des noms fictifs dans les notes), ou demander à l'utilisateur de fermer ces onglets lui-même.
  Pour la même raison, ne jamais lui ouvrir un fichier de test : il réapparaîtrait dans **sa** session au
  lancement suivant ; pas de profil temporaire possible pour une appli MSIX.
- Titre exact de la fenêtre : « <nom> – Bloc-notes », avec un tiret demi-cadratin U+2013 entouré d'espaces.
- L'arbre UIA est excellent (onglets `TabItem` avec « Non modifié », boutons « Ajouter un nouvel onglet »,
  « Fermer l'onglet », menu Fichier/Modifier/Affichage dont le menu déroulant WinUI est une fenêtre
  `PopupWindowSiteBridge` possédée par la fenêtre principale).
- Ses menus n'ont pas de « … » : `-Expand "Fichier" -Invoke "Mise en page"` (liste blanche) ouvre la boîte
  `#32770` « Mise en page », capturée nettement par PrintWindow, refermée par `-CloseWindow "Mise en page"`.
- Images : PrintWindow rend les zones WinUI (onglets, barre de menus, barre d'état) de façon **inégale** —
  vides lors d'un premier essai, toutes rendues lors d'un second, de nouveau vides lors d'une vérification
  ultérieure (fenêtre lancée derrière d'autres fenêtres, mode Auto resté sur PrintWindow parce que la fenêtre
  était recouverte ; l'outil l'a signalé par un avertissement). La capture d'écran (mode Auto, fenêtre
  dégagée) perdait la barre d'état passée sous la barre des tâches (corrigé : Auto garde PrintWindow dans ce
  cas). Toujours regarder l'image ; zone vide → `-Activate`. Menu Fichier ouvert : `-Expand
  "Fichier" -KeepOpen` puis `window_shot.ps1 -IncludePopups` → `"fenetres": 2` ; le sous-menu Récent n'est
  pas ouvert (fichiers de l'utilisateur).
- Icônes de la barre d'outils : glyphes de Segoe Fluent Icons identifiés par corrélation (`glyphes.html`),
  18 px physiques = 14,4 px CSS à 125 % ; deux icônes (« Tableau », « Effacer la mise en forme ») ne sont pas
  dans la police : recadrées dans la capture. Codes relevés : `reconstruire-appli`, `fidelite.md` §11.
- `Process.CloseMainWindow()` a visé une infobulle (fenêtre sans titre du même processus) : fermer par
  `Stop-Process -Id <PID>` (rien n'est enregistré) ou WM_CLOSE au handle noté.

**WinForms** (appli non DPI-aware, menu Win32 `MainMenu`) : barre de menus `MenuBar` « Application », menu
ouvert `#32768` avec ses `MenuItem`, onglets, champs masqués, `Toggle: On`, curseur `Range` ; images corrigées de
l'agrandissement Windows ; boîte modale ouverte par « Options... » (`Modal: true`), capturée puis fermée.

**WPF** (DPI-aware) : menus `MenuItem` avec `AutomationId`, `DataGrid` (`Rows`, `Columns`, `HeaderItem`, lignes
`DataItem` limitées à 10), `TreeView`, `Slider`, `PasswordBox` (`IsPassword`, aucune valeur) ; PrintWindow exact.

---

## 7. Limites par framework

| Framework | Arbre UIA | Images | Remarques |
|---|---|---|---|
| WPF, WinUI 3, UWP, MAUI | excellent (noms, `AutomationId`, états) | PrintWindow exact en WPF ; WinUI/UWP : zones parfois vides (voir §4) | fidélité haute |
| WinForms | bon (noms parfois vides : libellé voisin) | exact | contrôles tiers (DevExpress, Telerik) variables |
| Win32 / MFC | bon pour les contrôles standard ; contrôles dessinés à la main = `Pane` sans détail | exact | regarder l'image pour tout `Pane`/`Custom` |
| Qt Widgets | correct (plugin d'accessibilité) ; QML partiel | exact en général | vues Qt WebEngine : voie A |
| Delphi/VCL, wxWidgets, Avalonia | variable | exact | fidélité moyenne |
| Java Swing/JavaFX | quasi vide sans Java Access Bridge | exact | activer l'Access Bridge (`jabswitch -enable`) modifie Windows : seulement avec l'accord explicite de l'utilisateur ; sinon images + description |
| Flutter | arbre sémantique partiel | exact | mesurer sur les images |
| Jeux, moteurs 3D, canvas | rien d'exploitable | souvent noir avec PrintWindow → `-Activate` | hors cœur de cible ; menus seulement, fidélité réduite annoncée |

---

## 8. Rendre la reconstruction fidèle

- **Fenêtre** : le clone s'ouvre via `lancer-app.cmd` (skill `reconstruire-appli`). `CU_LARGEUR`/`CU_HAUTEUR`
  fixent la taille **extérieure** de la fenêtre Edge : pour une zone de contenu égale à `cadreEcran ÷ echelle`,
  ajouter les bordures et la barre de titre d'Edge (mesuré à 125 % : +14 px CSS en largeur, +37 en hauteur) et
  vérifier `innerWidth`/`innerHeight` (`fidelite.md` §11). La barre de titre native n'est pas reproductible dans
  une fenêtre Edge `--app` (Edge dessine la sienne, colorée par `<meta name="theme-color">`) : les onglets que
  l'original place dans sa barre de titre se reproduisent juste en dessous, sans redessiner
  Réduire/Agrandir/Fermer.
- **Polices** : Microsoft Sans Serif 8,25 pt (≈ 11 px) en WinForms .NET Framework (menus et barre de titre :
  Segoe UI 9 pt), Segoe UI 9 pt (12 px) en Win32 récent et WinForms .NET 6+, 12 px en WPF, Segoe UI Variable
  14 px en WinUI 3 ; vérifier sur l'image (hauteur des capitales, graisse).
- **Couleurs** : pipette sur l'image (`py "<OUTILS>\png_diff.py" couleur <png> x,y`) ; thème Windows clair ou
  sombre noté — ne jamais changer le thème de Windows pour capturer l'autre (réglage système).
- **Windows 11** : coins arrondis 8 px, matériau Mica (approximer par une couleur unie : `#f3f3f3` clair,
  `#202020` sombre, ou la couleur mesurée), couleur d'accent de l'utilisateur (la noter, la rendre configurable).
- **Icônes** : Fluent UI System Icons (libre) ou la police Segoe Fluent Icons installée avec Windows, glyphe
  identifié par `OUTILS\glyphes.html` (mode d'emploi en tête du fichier) ; ne pas extraire les icônes de l'exe.
- **États** : chaque `States` relevé (coché, déplié, sélectionné, désactivé) doit exister dans le clone ; chaque
  `AcceleratorKey` aussi, au moins affiché dans les menus.
