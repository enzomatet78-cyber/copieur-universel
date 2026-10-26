# Fidélité — faire « pareil », mesures à l'appui (skill reconstruire-appli)

Règle d'or : la **capture** est la référence (DOM, `styles.css`, `icones.txt`, `graphique-*.txt`, mesures de
`notes.md`), les **images** tranchent en cas de doute, et rien ne se devine — ni une couleur, ni une marge, ni
un libellé. Quand une valeur manque, on la mesure sur l'image ou on la note comme écart connu.

---

## 1. Principe de mesure

- Comparer au **viewport de la capture** (noté dans `notes.md`, ex. 1536×791, DPR 1) : `resize_window` dans le
  navigateur intégré. Puis vérifier 375 px (aucun défilement horizontal de page).
- Mesures parlantes, dans cet ordre : `scrollHeight` du conteneur qui défile (`#main`) — s'il est identique,
  la page est presque toujours juste ; positions/tailles des blocs (`getBoundingClientRect`, comparées à
  `__rects` de la capture) ; textes caractère par caractère ; couleurs calculées (`getComputedStyle`).
- Tolérance : ±2 px ; ignorer les artefacts JPEG. Au-delà : chercher la classe ou la valeur qui diffère.
- Mesurer après `document.documentElement.dataset.shell === 'ready'`, `await document.fonts.ready` et la fin
  des squelettes de chargement simulés ; une police de repli décale tout de quelques pixels.

---

## 2. Tailwind v3 (cas le plus courant)

Le DOM capturé contient les classes utilitaires : les **recopier telles quelles** et charger le CDN
`https://cdn.tailwindcss.com/3.4.16?plugins=forms` + `assets/tailwind-config.js`.
- **Version** : `styles.css` indique « Tailwind : v3 probable / v4 probable / non détecté ». v3 : variables
  `--tw-ring-offset-width` sur les éléments ; v4 : `--spacing`, `--default-font-family`, couleurs `oklch(…)`.
- **Plugin forms** : seulement si l'original stylise radios, cases, champs, `select` (classes `form-*`, ou
  cases à cocher sans apparence native). Sans lui, champs et cases ont l'aspect natif ; avec lui à tort, ils
  changent de bordure et de taille.
- **Palette** : section 6 de `styles.css` (« classe = valeur calculée »). Lancer le contrôle de palette (§12)
  dans le clone avec ces paires ; toute différence → redéfinir la teinte dans `tailwind-config.js`
  (`colors: { blue: { 600: '#…' } }`, `extend` fusionne nuance par nuance). Couleurs nommées de l'appli
  (`bg-primary`, `text-brand-500`) : à déclarer avec la valeur relevée.
- **Classes personnalisées** (section 1 de `styles.css`, ex. `.bg-gradient-blue`, `.smart-view-thin-scrollbar`) :
  copier la règle dans `assets/shell.css` sous le même nom ; `@keyframes` (section 2) avec.
- **Valeurs arbitraires** (`w-[444px]`, `bg-[linear-gradient(to_right,#F0F6FD_0%,#FFF_70%)]`,
  `[overflow-wrap:anywhere]`) : le CDN les comprend, les recopier sans les « simplifier ».
- **Classes générées dynamiquement** : le CDN surveille le DOM et génère les classes nouvelles juste après leur
  apparition (un ou deux cadres) — attendre un peu avant de mesurer un élément injecté.
- **Avertissement console** « cdn.tailwindcss.com should not be used in production » : normal pour un clone
  local ; ce n'est pas une erreur.
- `preflight` (reset de Tailwind) : à désactiver (`corePlugins: { preflight: false }`) seulement si l'original
  n'utilise pas Tailwind comme base (ex. Bootstrap + quelques utilitaires).

## 3. Tailwind v4, et applis sans Tailwind

- **Tailwind v4** : `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>` et le thème en
  CSS : `<style type="text/tailwindcss">@theme { --font-sans: "Inter", sans-serif; --color-primary: #2563eb; }</style>`.
  La palette v4 par défaut est en `oklch` et diffère légèrement de la v3 : ne pas mélanger les deux. Les
  variables relevées (section 3 de `styles.css`) se recopient dans `@theme` ou `:root`. Le plugin forms ne
  s'ajoute pas de la même façon : reproduire l'aspect des champs d'après les valeurs calculées.
- **CSS-in-JS / CSS Modules** (classes `css-1x2y3z`, `sc-aBcD`, `Button_root__3kd9`) : les noms sont générés,
  inutiles à recopier. Relever les styles calculés des éléments clés (`__styles`, `getComputedStyle`) et les
  réécrire soit en utilitaires Tailwind à valeurs arbitraires, soit en CSS sémantique dans `shell.css`/section.
- **Framework CSS public** (Bootstrap, Bulma, Material UI en CSS, Ant Design) : charger la **même version**
  depuis un CDN public (cdnjs, jsdelivr) et recopier les classes — c'est la bibliothèque publique, pas le code
  de l'appli. Le thème personnalisé de l'appli se reprend depuis les variables relevées.
- **CSS sémantique d'une appli Electron** (VS Code : `monaco-workbench`, `part`, `activitybar`…) ou **logiciel
  natif** : pas de Tailwind du tout. Retirer du gabarit le CDN Tailwind et Google Fonts, ne pas copier
  `tailwind-config.js`, définir `.hidden { display: none }` dans `shell.css` (les comportements de la coque
  l'utilisent), `SHELL_CONFIG.tabler = false`. Recopier les règles relevées (sections 1 et 7 de `styles.css`)
  avec des sélecteurs simplifiés mais les **mêmes valeurs** (grilles, `top: 3px`, hauteurs de ligne) : sur
  VS Code, c'est ce qui a fait passer les écarts de position de 2–9 px à ±1 px. Les variables du thème
  (section 3, ex. `--vscode-*`) se recopient telles quelles sur le conteneur racine.

---

## 4. Polices

- Lire la police réelle (`styles.css` : « Polices », `@font-face`, `<link>`) puis vérifier dans le clone
  `getComputedStyle(el).fontFamily` **et** que la police est chargée (`document.fonts.check('16px Inter')`
  après `document.fonts.ready`).
- **Google Fonts** : même famille, mêmes graisses (`wght@400;500;600;700`), même `display=swap` ; si
  l'original active des variantes (`font-feature-settings: "cv11", "ss01"`, chiffres tabulaires
  `tabular-nums`), les recopier : elles changent la largeur des chiffres et des lettres.
- **Police propriétaire** (Circular, Graphik, Proxima Nova, Gilroy, SF Pro…) : ne pas aller chercher ses
  fichiers chez l'original ; prendre l'équivalent libre le plus proche et le signaler comme écart :
  Circular → DM Sans ; Graphik, Söhne → Inter ; Proxima Nova → Figtree ou Montserrat ; Gilroy → Manrope ;
  Avenir → Nunito Sans ; Helvetica Neue → Arimo ; SF Pro → `system-ui` sur Mac, Inter ailleurs.
- **Logiciel Windows** : polices système, rien à charger : `"Segoe UI Variable Text", "Segoe UI", system-ui`
  (Windows 11), `"Segoe UI"` (Windows 10), `Consolas`/`"Cascadia Mono"` pour le texte à chasse fixe.
- `-webkit-font-smoothing: antialiased` (classe `antialiased`) rend le texte plus fin : le reprendre si
  l'original l'a, sinon les graisses semblent différentes.

## 5. Couleurs, dégradés, ombres, rayons

- Reprendre les **valeurs calculées** exactes (`rgb(…)`, dégradés complets avec angles et pourcentages, ombres
  multiples) depuis `styles.css` ou `getComputedStyle` — jamais une teinte « approchante ».
- Couleur lue sur une image (logiciel natif, canvas) : pixel exact avec `png_diff.py couleur` (§8), pas à l'œil.
- `ring-*` (ombre en anneau) ≠ `border` (occupe de la place) : vérifier lequel l'original utilise avant de
  comparer les tailles.

---

## 6. Icônes

- **Identifier le jeu** dans le dump : `icon="tabler:…"`, `lucide:…`, `feather:…`, `heroicons…`
  (`viewBox` 20 ou 24, `stroke-width="1.5"`), Font Awesome (`svg-inline--fa`, `<i class="fa-solid fa-…">`),
  Material Symbols (`<span class="material-symbols-outlined">home</span>`), Bootstrap Icons (`bi bi-…`),
  Iconify, sprites `<use href="#…">`.
- **SVG** : enregistrer le contenu exact relevé (`Shell.registerIconsText(icones.txt)`) — le SVG rendu fait
  partie de ce qu'on observe. Jeu Tabler de `shell-base.js` : seulement si l'original utilise Tabler
  (sinon `SHELL_CONFIG.tabler = false`).
- **Polices d'icônes** : `icones.txt` les liste en fin de fichier (`/* police codicon : files x2 | U+EAF0 | … */`,
  lignes ignorées par `Shell.registerIconsText`) avec le code du glyphe, la taille et la couleur ; dans le clone,
  même élément et mêmes classes que l'original, police chargée depuis un CDN public. VS Code :
  `@vscode/codicons` sur jsDelivr, version épinglée (`…/npm/@vscode/codicons@<version>/dist/codicon.css`) ; les
  noms propres à VS Code (`explorer-view-icon`) sont des alias résolus par les variables
  `--vscode-icon-<nom>-content` de `styles.css` ; un glyphe absent de la version publique se remplace par le
  plus proche, écart signalé.
- **Polices d'icônes publiques** : charger la même police depuis son CDN public — Material Symbols :
  `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200`
  (reprendre `font-variation-settings` relevé) ; Font Awesome Free : cdnjs, même version majeure. Icônes
  Font Awesome Pro (payantes) : seulement si elles sont rendues en SVG dans le DOM (alors on recopie le SVG
  observé) ; sinon l'équivalent gratuit, signalé.
- **Taille et trait** : les attributs du dump (`class="w-4 h-4"`, `stroke-width="1.5"`, `width`, `height`)
  restent sur l'espace réservé et l'emportent sur la définition. Trait fin écrasé par une classe `stroke-2`
  → définition avec `lock: true`. Couleur : `currentColor` + classe `text-*` comme l'original.
- **Emoji** : rendus par la police du système (Segoe UI Emoji sous Windows, Apple Color Emoji sur Mac) —
  différence normale entre systèmes, pas un défaut du clone.
- Contrôle : aucun `svg[data-icon]` restant, aucune icône vide (§12), aucun avertissement « icône inconnue ».

---

## 7. Graphiques en SVG

La capture fournit `graphique-<nom>.txt` (`__chart(i)`) : type, taille, `viewBox`, et chaque élément avec sa
position relative au coin du SVG, sa couleur et ses textes. Le clone dessine un **SVG inline** aux mêmes
dimensions, aux mêmes valeurs.
- Même `viewBox` et même taille d'affichage que l'original ; graduations, libellés d'axes et légendes **recopiés**
  (pas recalculés : les arrondis « jolis » diffèrent d'une bibliothèque à l'autre).
- Barres et points : positions directement reprises de la capture (`RECT x,y largeur x hauteur`), ou recalculées
  depuis les valeurs avec la même échelle. Chemins : le `d` capturé est tronqué à 160 caractères — pour une
  courbe complète, recalculer à partir des valeurs (polyligne, ou courbe « monotone » si l'original est lissé).
- Anneau (donut) le plus simple et exact : un cercle par part, longueur normalisée à 100 :
  ```html
  <svg viewBox="0 0 120 120" class="w-[120px] h-[120px]">
    <g transform="rotate(-90 60 60)" fill="none" stroke-width="16">
      <circle cx="60" cy="60" r="50" pathLength="100" stroke="#2563eb" stroke-dasharray="45 55" stroke-dashoffset="0"/>
      <circle cx="60" cy="60" r="50" pathLength="100" stroke="#93c5fd" stroke-dasharray="30 70" stroke-dashoffset="-45"/>
      <circle cx="60" cy="60" r="50" pathLength="100" stroke="#e5e7eb" stroke-dasharray="25 75" stroke-dashoffset="-75"/>
    </g>
  </svg>
  ```
  (`stroke-dasharray` = part, reste ; `stroke-dashoffset` = −somme des parts précédentes ; `FAKE.split(r, 100, n)`
  donne des parts entières qui somment à 100.)
- Infobulles de survol : `data-tip-text` sur chaque barre ou point (fonctionne sur du SVG injecté) ; pour un
  réticule qui suit la souris (style Recharts), un `rect` transparent couvrant la zone + `mousemove`.
- Données : agrégats relevés tels quels ; séries de données personnelles → `FAKE.series(r, n, {…})`.
- Graphique en **canvas** : `__chart` donne les données si Chart.js ou ECharts est accessible ; sinon relever les
  valeurs sur l'image et les infobulles, et le dire. Reproduire quand même en SVG (net, mesurable).
- Texte SVG : `font-size`, `font-weight`, `fill` et `text-anchor` explicites, comme relevés.

---

## 8. Images, logos, vidéos

- Images et logos : URL **publiques absolues** de l'original, avec les mêmes `width`/`height`/classes (sinon la
  mise en page saute au chargement) ; `srcset` recopié si présent. Images de fond CSS : URL absolue dans la règle.
- Avatars et photos de tiers : jamais les vraies → avatar à initiales (`FAKE.avatarColor(nom)`) ou image neutre.
- Vidéos intégrées (YouTube, Vimeo, Wistia) : `iframe` avec `data-lazy-src` (chargée à l'ouverture de la modale
  ou du dépliant, déchargée à la fermeture, sinon le son continue) et `allow="autoplay; fullscreen"` **sans**
  l'attribut `allowfullscreen` (doublon qui produit un avertissement console).
- **Logiciel de bureau** — couleur exacte d'un pixel : `py "%OUTILS%\png_diff.py" couleur <png> 5,5` ; recadrer
  une icône dans une capture de fenêtre (Windows, PowerShell, sans dépendance ; coordonnées en px de l'image) —
  regarder ensuite l'image recadrée : `scan_pii.py` ne lit pas les images, une donnée réelle n'y serait pas vue :
  ```powershell
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::FromFile("<TRAVAIL>\capture\principal\01-fenetre.png")
  $src.Clone((New-Object System.Drawing.Rectangle 12, 40, 24, 24), $src.PixelFormat).Save("<CLONE>\assets\img\ouvrir.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $p = $src.GetPixel(5, 5); "rgb({0}, {1}, {2})" -f $p.R, $p.G, $p.B
  $src.Dispose()
  ```
  Une capture prise à 125 % d'échelle contient des icônes 1,25 fois plus grandes : les afficher à leur taille
  CSS (`width="16"` pour une image de 20 px).

---

## 9. Textes et formats

- **Mot pour mot**, y compris les fautes, les traductions bancales et les incohérences de casse de l'original :
  le clone copie, il ne corrige pas.
- Texte **du DOM**, pas de l'image : `uppercase`, `capitalize`, `truncate`, `line-clamp-*` transforment
  l'affichage — garder le texte source et la classe (« lundi » + `capitalize` s'affiche « Lundi »).
- **Espaces** : en français, l'original peut mettre U+00A0 (insécable), U+202F (fine insécable) ou une espace
  simple avant `: ; ! ? %` et dans « … ». Les dumps du kit v2 les conservent ; vérifier avec `Shell.codes(texte)`
  (`['1','U+202F','0','0','7']`). Un dump de l'ancien kit les avait remplacées par des espaces simples.
- **Ponctuation** : apostrophe ’ ou ', guillemets « » ou " ", points de suspension … ou ..., tirets – ou - :
  recopier le caractère exact.
- **Nombres** (`Shell.fmt`, `fmtMoney`, `fmtPct`) : fr-FR donne `1 007` (U+202F), `905 000 €` (U+202F +
  U+00A0), `12,5 %` (U+00A0). Si l'original formate autrement (`$905 000`, `905K`, `1.2k`), composer la même
  chaîne (`'$' + Shell.fmt(n)`) plutôt que d'imposer le format « correct ».
- **Dates** (`Shell.fmtDate`) : `court` 12/10/2026, `moyen` 12 oct. 2026, `long` 12 octobre 2026, `jour`
  lundi 12 octobre, `heure` 10:00, `complet` 12 oct. 2026, 10:00. La forme exacte dépend de la version
  d'ICU du navigateur (« , » ou « à ») : comparer à la capture et composer à la main si besoin. Fuseau :
  `Shell.configure({ timeZone: 'Europe/Paris' })` pour figer l'affichage des heures.
- **Relatif** (`Shell.fmtRel`) : « hier », « il y a 3 jours », calculé par rapport à `FAKE.TODAY`.
- Attributs textuels aussi : `title`, `placeholder`, `aria-label`, `alt`, texte des infobulles.

---

## 10. Pièges CSS et comportement (symptôme → cause → solution)

| Symptôme | Cause | Solution |
|---|---|---|
| Barre de défilement fine de 4 px affichée à 10 px | `scrollbar-width`/`scrollbar-color` désactivent `::-webkit-scrollbar` dans Chromium | classe `scrollbar-thin` de `shell-base.css` (repli standard sous `@supports not selector(::-webkit-scrollbar)`) |
| Icônes fines devenues épaisses | une classe `stroke-2` écrase l'attribut `stroke-width` | définition `lock: true` (style inline) |
| Menu ou liste déroulante coupé(e) | ancêtre en `overflow-hidden`/`overflow-auto` | `data-float` sur le menu, ou menu en fin de `<body>` (comme le portail de l'original) |
| Élément `fixed` mal placé | ancêtre avec `transform`, `filter` ou `will-change` : `fixed` devient relatif à lui | sortir l'élément en fin de `<body>` |
| `sticky` qui ne colle pas | conteneur qui défile différent de celui de l'original, ou parent trop court | même hiérarchie de défilement que l'original (`#main` qui défile, `body` en `overflow:hidden`) |
| La barre latérale « s'anime » à chaque chargement | état initial appliqué avec la transition active | `Shell.noTransition(el, fn)` |
| État restauré à tort (barre repliée sur grand écran) | état automatique (petit écran) mémorisé | ne mémoriser que les clics de l'utilisateur |
| Élément masqué qui reste visible | règle `display` plus spécifique que `.hidden` (ex. `#bloc { display:flex }`) | mettre l'affichage en classe utilitaire, ou masquer avec une classe aussi spécifique |
| Mise en page décalée de quelques px | police de repli pendant la mesure, ou `antialiased` absent | mesurer après `document.fonts.ready` ; recopier les classes de `body` |
| Page plus haute/basse que l'original | classe de hauteur ou d'espacement oubliée, squelette resté, `space-y-*` avec enfants masqués | comparer `scrollHeight` bloc par bloc (`getBoundingClientRect`) |
| Défilement horizontal à 375 px | largeur fixe (`w-[1036px]`, tableau) sans `overflow-x-auto` | reprendre les classes responsive de l'original ; trouver le coupable (§12) |
| Valeurs différentes à chaque chargement | `Math.random()`, `new Date()` | `FAKE.rng(graine)`, `Shell.today()` |
| Son d'une vidéo qui continue | iframe laissée chargée à la fermeture | `iframe[data-lazy-src]` |
| Avertissement « Allow attribute will take precedence over 'allowfullscreen' » | `allow="fullscreen"` + `allowfullscreen` | garder seulement `allow` |
| Requête 404 dans la console | icône d'onglet, image ou script à un chemin inexistant | `<link rel="icon" href="data:,">` par défaut ; chemins absolus depuis la racine |
| `alert()` ou navigation réelle au clic sur « Enregistrer » | action recopiée telle quelle | ouvrir/fermer l'interface comme l'original, sans effet |
| Mesures fausses juste après une injection | le CDN Tailwind génère les nouvelles classes un ou deux cadres plus tard | attendre `requestAnimationFrame` ×2 ou 100 ms |

---

## 11. Logiciels de bureau

- **Échelle d'affichage** : les rectangles de `uia-*.json` et les captures de fenêtre sont en pixels
  **physiques**. px CSS = px physiques ÷ (échelle/100). Échelle Windows :
  `(Get-ItemProperty 'HKCU:\Control Panel\Desktop\WindowMetrics').AppliedDPI` (96 = 100 %, 120 = 125 %,
  144 = 150 %).
- **Taille de la fenêtre du clone** : `CU_LARGEUR`/`CU_HAUTEUR` de `lancer-app.cmd` (= `--window-size` d'Edge)
  fixent la taille **extérieure**, bordures invisibles et barre de titre d'Edge comprises. Mesuré à 125 % :
  `1141×658` donne une zone de contenu de 1128×622 ; `1155×695` donne 1142×658, la taille de l'original
  (Bloc-notes). Règle : zone voulue + ~14 px en largeur et + ~37 px en hauteur, puis **vérifier**
  `innerWidth`/`innerHeight` (lancer avec `CU_NAV_EXTRA=--remote-debugging-port=9230`, puis
  `cdp_eval.py --port 9230 eval --expr "[innerWidth, innerHeight]"`). Même règle pour une appli Electron sans
  cadre : sa zone de contenu est toute sa fenêtre.
- **Barre de titre** : celle de Windows (fenêtre d'appli Edge) affiche `document.title` ; ne pas en redessiner
  une en HTML. Sa couleur suit `<meta name="theme-color" content="#202020">` (testé : barre sombre comme un
  original en thème sombre). Applis sans cadre (Electron avec barre de titre personnalisée : VS Code, Discord,
  Teams) et applis qui mettent leurs onglets dans la barre de titre (Bloc-notes, Terminal) : la partie
  intérieure se reproduit en HTML juste sous la barre d'Edge, **sans** redessiner Réduire/Agrandir/Fermer ;
  la barre native d'Edge reste au-dessus (écart à signaler).
- **Mesurer le clone à l'échelle de la capture** : pour superposer une image de `window_shot.ps1` prise à 125 %,
  rendre le clone au même facteur — Edge headless + `cdp_eval.py shot --viewport 1141x658@1.25` donne une image
  1426×823 superposable, à comparer par `png_diff.py diff` (l'anticrénelage ClearType de l'original diffère
  du lissage du navigateur : regarder les zones, pas seulement le pourcentage). Le volet du navigateur intégré,
  plus étroit, réduit le viewport émulé : il ne convient pas à cette comparaison.
- **Contrôles** : HTML sémantique (`button`, `input`, `select`, `textarea`, `[role=menu]`, `[role=tree]`) stylé
  d'après les images : hauteurs, rayons, bordures et couleurs **mesurés** (§8 pour la couleur exacte d'un pixel).
- **Menus** : barre de menus `<div role="menubar" data-menubar>` dont les titres sont des `[data-menu]`
  (+ `data-accel="f"`) et les éléments des `role="menuitem"` : un menu ouvert à la fois, Échap, clic extérieur,
  Alt+lettre, flèches, survol d'un titre voisin ; le cadre de focus n'apparaît qu'à l'ouverture au clavier
  (classes `clavier` / `is-focused`, comme Windows). Raccourcis affichés et branchés avec `Shell.keys` ;
  Ctrl+W, Ctrl+N, Ctrl+T restent au navigateur, et Alt+F peut être pris par Edge dans une vraie fenêtre
  (limites à vérifier et à signaler).
- **Mode bureau** (`Shell.configure({ bureau: true })`) : pas de menu contextuel du navigateur hors champs
  (un menu contextuel maison reste possible : gérer `contextmenu` soi-même), pas de sélection hors champs
  (classe `.selectable` pour en autoriser), pas de glisser d'images.
- **Icônes Windows** : la police **Segoe Fluent Icons** (Windows 11 ; Segoe MDL2 Assets sous Windows 10) contient
  les glyphes des applis natives : `<span class="glyph" aria-hidden="true">&#xE713;</span>` avec
  `.glyph { font-family: "Segoe Fluent Icons", "Segoe MDL2 Assets"; font-size: 14.4px; line-height: 1; }`
  (barre d'outils du Bloc-notes : 18 px physiques à 125 % = 14,4 px CSS, pas 16 : mesurer).
  **Identifier plutôt que deviner** : `OUTILS\glyphes.html` corrèle chaque zone de la capture avec les ~4 600
  glyphes de la police (mode d'emploi en tête du fichier) ; le bon glyphe obtient 0,8 à 0,9 et figure parmi
  les 3 premiers, à départager à l'œil avec ses voisins. Une icône absente de la police (« Tableau » et
  « Effacer la mise en forme » du Bloc-notes) se recadre dans la capture (§8).
  Codes confirmés sur le Bloc-notes 11.2607 : E713 paramètres, E76C chevron droit, E711 fermer l'onglet,
  F8AA ajouter (nouvel onglet ; E710 et E948 sont des « plus » voisins), E972 chevron de liste déroulante
  (plus proche que E70D), E8FD liste à puces, E8DD gras, E8DB italique, EDE0 barré, E71B lien, E789
  nouveautés, E77B compte, F6C7 outils d'écriture. Autres codes courants (à confirmer de la même façon) :
  E700 menu ☰, E721 rechercher, E70F modifier, E74D supprimer, E74E enregistrer, E8C8 copier, E77F coller,
  E8C6 couper, E7A7 annuler (undo), E7A6 rétablir, E72B précédent, E72A suivant, E70D/E70E chevrons bas/haut,
  E76B chevron gauche, E712 plus (…), E72C actualiser, E80F accueil, E946 info, E8A3 zoom avant,
  E8BB/E921/E922/E923 fermer/réduire/agrandir/restaurer (barre de titre). Hors Windows, ces polices n'existent
  pas : prévoir un SVG si le clone doit tourner ailleurs.
- **Electron / WebView2** : l'interface est du web → mêmes règles que les applis web (dump CDP, classes, SVG).
  Les polices et images embarquées dans l'appli sont des fichiers de l'éditeur : équivalent libre ou police
  système, signalé.

---

## 12. Scripts de contrôle (à lancer dans le CLONE, `javascript_tool`)

**Palette** — paires relevées dans `styles.css` section 6 :
```js
(async function (attendu) {
  var box = document.createElement('div'), cles = Object.keys(attendu);
  document.body.appendChild(box);
  cles.forEach(function (c) { var e = document.createElement('div'); e.className = c + ' border'; box.appendChild(e); });
  await new Promise(function (r) { setTimeout(r, 200); });          // génération des classes par le CDN
  var ecarts = cles.map(function (c, i) {
    var s = getComputedStyle(box.children[i]);
    var v = /^bg-/.test(c) ? s.backgroundColor : /^border/.test(c) ? s.borderTopColor : s.color;
    return v === attendu[c] ? null : c + ' : clone ' + v + ' / original ' + attendu[c];
  }).filter(Boolean);
  box.remove();
  return ecarts.length ? ecarts : 'palette conforme';
})({ 'bg-blue-600': 'rgb(37, 99, 235)', 'text-gray-500': 'rgb(107, 114, 128)', 'border-gray-200': 'rgb(229, 231, 235)' });
```

**Mesures** (à comparer aux `__rects` et au `scrollHeight` de `notes.md`) :
```js
JSON.stringify({ scrollHeight: document.getElementById('main').scrollHeight,
  blocs: [...document.querySelectorAll('#main > div > *')].map(function (e) { var r = e.getBoundingClientRect();
    return [e.tagName.toLowerCase(), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }) })
```

**Défilement horizontal** — qui dépasse ?
```js
[...document.querySelectorAll('body *')].filter(function (e) { return e.getBoundingClientRect().right > innerWidth + 1; })
  .slice(0, 10).map(function (e) { return e.tagName + '.' + [...e.classList].slice(0, 4).join('.') + ' → ' + Math.round(e.getBoundingClientRect().right); })
```

**Icônes** — espaces réservés restants et icônes vides (nom inconnu) :
```js
({ restants: document.querySelectorAll('svg[data-icon]').length,
   vides: [...document.querySelectorAll('svg[data-icon-name]')].filter(function (s) { return !s.innerHTML.trim(); }).map(function (s) { return s.dataset.iconName; }) })
```

**Liens internes** (requêtes vers le serveur local uniquement) :
```js
(async function () {
  var out = [], vus = new Set([...document.querySelectorAll('a[href^="/"]')].map(function (a) { return a.getAttribute('href').split(/[?#]/)[0]; }));
  for (const h of vus) { const r = await fetch(h, { method: 'HEAD' }); if (!r.ok) out.push(h + ' → ' + r.status); }
  return out.length ? out : vus.size + ' liens internes OK';
})()
```

**Caractères** : `Shell.codes(document.querySelector('#kpi').textContent)`.

Le contrôle de tout le site (toutes les pages, liens, confidentialité) se fait avec les outils
`check_links.py` et `scan_pii.py` : voir le skill `verifier-copie`.
