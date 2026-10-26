---
name: reconstruire-appli
description: "Reconstruction fidèle, en local, d'une appli web ou d'un logiciel de bureau à partir de sa capture : fondation d'abord (page de référence validée deux fois, puis coque partagée et données fictives), une page par route ou par écran avec le gabarit, coque générique shell-base.js (icônes, menus, modales, onglets, infobulles, formats fr-FR), Tailwind et palette, polices, graphiques SVG, pièges CSS, lanceur Edge --app pour les logiciels. À utiliser dès qu'il faut écrire ou corriger le HTML/CSS/JS d'un clone ou d'une réplique — phase de construction de copier-une-appli, ou demande directe sur une capture existante — même si la demande ne dit pas « reconstruire » : « recrée cette page à partir de la capture », « refais cet écran à l'identique », « construis le clone », « reproduis ce tableau de bord », « corrige la page du clone », « copie pixel près ». Si rien n'est encore capturé (« copie l'appli X »), commencer par copier-une-appli. EN: Use whenever HTML/CSS/JS must be written or fixed to recreate, rebuild, replicate or clone a web page, dashboard or desktop screen locally from a capture — the build phase of copier-une-appli or a direct request on an existing capture: foundation first (reference page verified twice, then shared shell and fake data), page template, generic shell, fidelity rules (Tailwind, palette, fonts, icons, SVG charts), Edge --app launcher — even when the user only says 'rebuild this page' or 'pixel-perfect copy'. Nothing captured yet: start with copier-une-appli."
---

# Reconstruire une appli — fondation, coque, pages

Ce skill transforme une **capture** (DOM nettoyé, images, styles, icônes, notes) en un clone local fidèle :
des pages HTML statiques, une coque partagée, des données fictives, servies par un petit serveur local.
Il ne capture rien lui-même (voir `capture-web` / `capture-bureau`) et ne se juge pas lui-même (voir
`verifier-copie`) ; il est enchaîné par `copier-une-appli`. Si la demande arrive ici sans capture ni cadrage
(« copie l'appli X »), commencer par `copier-une-appli` : sans capture, on dessinerait de mémoire, et le
cadrage fixe ce qui est permis (compte réel en lecture seule, données gardées ou fictives).

Pourquoi une méthode plutôt que « coder ce qu'on voit » : sur la recréation complète de l'appli iClosed,
ce qui a fait la qualité n'est pas l'habileté de chaque page mais trois choix de structure.
1. **La fondation d'abord** : une seule page de référence, vérifiée deux fois, d'où l'on extrait la coque.
   Chaque défaut de la coque se répète sur toutes les pages ; corrigé avant la construction parallèle, il
   coûte une correction, après, des dizaines (et chaque agent le contourne à sa façon).
2. **La capture est la référence**, pas l'imagination : classes recopiées du DOM, textes caractère par
   caractère, valeurs calculées relevées. Les images tranchent en cas de doute.
3. **Une coque générique + une coque propre à l'appli** : les utilitaires (icônes, infobulles, menus…) ne
   changent pas d'une appli à l'autre ; la navigation, elle, s'écrit pour l'appli copiée, à partir de sa capture.

**Outils** : dossier `outils/` du plugin = `${CLAUDE_PLUGIN_ROOT}/outils/` ; si cette variable n'est pas
remplacée, utiliser `<Base directory de ce skill>\..\..\outils\` (résoudre en chemin absolu avant de lancer
une commande). Dans la suite, `OUTILS` désigne ce chemin absolu et `SKILL` le Base directory de ce skill.

| Fichier du skill | Rôle |
|---|---|
| `references/conventions.md` | arborescence du clone, route → fichier, liens, nommage, coque propre à l'appli (exemple complet), fichiers de section, qui modifie quoi, **modèle de GUIDE.md**, conversions depuis la capture |
| `references/fidelite.md` | Tailwind (v3, v4, sans), palette, polices, icônes, images, graphiques SVG, textes et formats, mesures, pièges CSS, logiciels de bureau, scripts de contrôle |
| `assets/page-template.html` | gabarit de page (web : `app/<route>/index.html` ; bureau : `ecrans/<ecran>/index.html`) |
| `assets/shell-base.js` | coque **générique** (API `window.Shell`), copiée telle quelle dans le clone |
| `assets/shell-base.css` | styles génériques (infobulle, squelette, barre fine, mode bureau) réglables par variables |
| `assets/fake-data-template.js` | générateur de données fictives déterministes (`window.FAKE`) |
| `assets/tailwind-config.js` | configuration Tailwind v3 (police, palette) avec la palette par défaut en rappel |
| `assets/lancer-app.cmd` | lanceur Windows : démarre le serveur local si besoin et ouvre le clone en fenêtre d'appli (Edge `--app`) |

Outils partagés utiles ici (dans `OUTILS`) : `dom2page.py` (dump de capture → contenu de page),
`verif.js` + `cdp_eval.py` + `headless.ps1` (se vérifier sans navigateur intégré), `png_diff.py` (comparer à
l'image de capture, couleur d'un pixel), `glyphes.html` (identifier une icône Windows dans Segoe Fluent Icons),
`check_links.py`, `scan_pii.py`.

**Règles pendant la construction** (détail et justification : `copier-une-appli/references/regles.md`) :
- **Usage personnel et local** : le clone est servi sur `127.0.0.1` et n'est ni publié ni présenté comme
  l'original ; marques, logos et textes restent à leur éditeur. Une copie fidèle n'est utile que parce qu'elle
  ressemble à l'original — c'est aussi ce qui la rendrait trompeuse hors de la machine de l'utilisateur.
- **On reconstruit ce qu'on a observé** (DOM rendu, styles calculés, captures), jamais le code de l'original
  (bundles JS, fichiers internes d'un logiciel) ; les bibliothèques publiques (Tailwind, Bootstrap, Google
  Fonts) se chargent depuis leur CDN public.
- **Le clone ne contacte jamais l'original** : ni API, ni jeton, ni formulaire qui envoie quelque chose ;
  seules des ressources statiques publiques (images, logos, polices) peuvent être chargées par URL absolue.
  Écrans de connexion ou de paiement recréés : inertes — une page qui fonctionnerait comme la vraie serait
  un outil d'hameçonnage.
- **Données** : toute donnée personnelle de tiers devient fictive (`FAKE`), les secrets sont masqués, les
  captures brutes (`dom-*.html`, images) restent dans le dossier de travail, hors du clone servi.
- **Le compte réel n'est pas rouvert pour « vérifier un détail »** : seule la capture fait foi, et le
  navigateur de l'utilisateur appartient aux agents de capture (lecture seule). Un état manquant se signale ;
  seul l'agent principal peut confier une recapture, toujours selon les règles de `capture-web`.
- **On ne ferme que ce qu'on a lancé** (onglet de vérification, navigateur headless, serveur de test).

---

## 1. Avant d'écrire une ligne : les entrées

- **La capture de l'unité** (dossier de travail, hors du clone) — format défini par `capture-web` §6 :
  au niveau de l'unité `notes.md`, `styles.css` (`__styles`), `icones.txt` (`__icons`) ; par page
  (`<unité>\<slug>\`) `notes.md` (route finale, titre exact, viewport, structure, états, liens, données,
  mesures), `dom-<etat>.html`, images `01-haut.png…`, `graphique-<nom>.txt` (`__chart`). Logiciel
  (`capture-bureau` §8) : un dossier par écran (`fenetre-principale`, `dialogue-<nom>`…) avec `uia-*.json`
  (natif) ou `dom-*.html` (Electron) et les images de fenêtre ; le GUIDE fixe l'écran du clone
  correspondant (`fenetre-principale` → `ecrans/principal/`).
- **Le GUIDE du projet** (s'il existe déjà : on construit une page après la fondation) — il prime sur ce
  skill pour tout ce qu'il fixe (gabarit exact, clés de navigation, ce qu'on garde des données).
- **La page de référence validée** : l'ouvrir et lire sa source avant toute nouvelle page ; c'est le modèle
  de qualité et de style de code. Lire aussi le fichier de section (`assets/sections/<s>.js`) et les pages
  déjà construites de la même section : un en-tête refait « à sa façon » se verrait d'une page à l'autre.

Tout lire avant de commencer : notes, **tous** les `dom-*.html`, **toutes** les images (outil Read). Une page
écrite d'après la seule vue initiale oublie les états (onglets, modales, menus) qui font la moitié du travail.

---

## 2. Mettre en place le dossier du clone

Arborescence (détail et cas particuliers : `references/conventions.md` §1–3) :

```
<CLONE>/                         racine du serveur local
  index.html                     redirection vers la page d'accueil (/app/... ou /ecrans/principal/)
  app/<route>/index.html         appli web : une page par route   (/app/x/y → app/x/y/index.html)
  ecrans/<ecran>/index.html      logiciel de bureau : un écran par fenêtre/vue principale
  assets/shell-base.js|css       coque GÉNÉRIQUE — copiée telle quelle depuis ce skill, jamais modifiée
  assets/shell.js|css            coque PROPRE À L'APPLI — navigation, menus, config, icônes, classes perso
  assets/tailwind-config.js      police + palette relevées
  assets/fake-data.js            données fictives déterministes
  assets/sections/<s>.js|css     éléments communs d'une section (un seul propriétaire)
  lancer-app.cmd                 (bureau, facultatif pour le web) fenêtre d'appli Edge --app
```

Copier les gabarits (bash ; remplacer les chemins) :
```bash
SKILL="<Base directory de ce skill>"; CLONE="<dossier du clone>"
mkdir -p "$CLONE/assets/sections" "$CLONE/app"
cp "$SKILL/assets/shell-base.js" "$SKILL/assets/shell-base.css" "$CLONE/assets/"
cp "$SKILL/assets/tailwind-config.js" "$CLONE/assets/"   # seulement si l'original utilise Tailwind
cp "$SKILL/assets/fake-data-template.js" "$CLONE/assets/fake-data.js"
cp "$SKILL/assets/lancer-app.cmd" "$CLONE/"          # logiciel de bureau
touch "$CLONE/assets/shell.js" "$CLONE/assets/shell.css"   # coque propre à l'appli, écrite pendant la fondation
```
(PowerShell : `Copy-Item "$SKILL\assets\shell-base.js" "$CLONE\assets\"`, etc.)

**Variante « sans Tailwind »** — logiciel Windows natif, ou appli Electron à CSS sémantique (VS Code :
classes `monaco-*`) : pas de `tailwind-config.js`, et dans chaque page retirer le CDN Tailwind et Google Fonts
du gabarit ; recopier les règles de `styles.css` (sections 1 et 7) dans `shell.css` avec des sélecteurs
simplifiés, y définir `.hidden { display: none }`, et `window.SHELL_CONFIG = { tabler: false }` avant
`shell-base.js`. Mesuré sur VS Code : recopier les règles exactes (grille `1fr 6fr 1fr 6fr 1fr`,
`top: 3px`…) a ramené les écarts de position de 2–9 px à ±1 px. Détails : `fidelite.md` §3 et §11.

Servir le clone (boucle locale uniquement, port libre) :
`py -m http.server 8770 --bind 127.0.0.1 --directory "<CLONE>"` — en arrière-plan (Bash `run_in_background`).
Toujours ouvrir le clone par `http://localhost:<port>/…`, jamais en `file://` : les chemins absolus
(`/assets/…`, `/app/…`) et le stockage local en dépendent.

---

## 3. La fondation : une page de référence, puis la coque

1. **Choisir la page de référence** : celle qui montre le plus de coque (navigation complète, en-tête, menu
   utilisateur, états replié/déplié) — souvent l'accueil.
2. **La construire dans la structure finale** : `assets/shell.js` (navigation de l'appli, écrite à partir du
   dump de la coque), `assets/shell.css` (classes personnalisées de `styles.css`), `tailwind-config.js`
   (police, palette), `fake-data.js` (titulaire du compte, jeux communs), et la page elle-même à partir du
   gabarit. Variante acceptable (c'est ce qui a été fait pour iClosed) : une page autonome d'un seul fichier
   d'abord, puis la factoriser — à condition de **re-mesurer après factorisation** (même `scrollHeight` du
   conteneur principal, mêmes positions clés, mêmes images) : une factorisation casse souvent un détail.
3. **Deux vérifications indépendantes** (`verifier-copie`) : relecteurs par angle (coque, contenu, textes,
   comportement, petits écrans) puis vérificateurs adverses qui tentent de réfuter chaque écart ; corriger,
   puis seconde passe complète depuis zéro, qui confirme les corrections et cherche les régressions.
4. **Geler** : `shell-base.*`, `shell.*`, `tailwind-config.js`, `fake-data.js` et la page de référence ne sont
   plus modifiés par les constructeurs ; leurs besoins passent par `shellIssues` (format : `conventions.md` §8).
5. **Écrire le GUIDE du projet** à partir du modèle de `conventions.md` §9 (gabarit exact, API de la coque,
   clés de navigation, données, règles) : c'est le seul document que liront les agents suivants.
6. **Montrer la page de référence à l'utilisateur** et attendre son accord avant toute construction parallèle.

Ce qui va où :

| Élément | Où | Pourquoi |
|---|---|---|
| navigation latérale, barre du haut, menu utilisateur, lanceur de chat | `assets/shell.js` (+ `shell.css`) | identique sur toutes les pages ; une seule source |
| en-tête/onglets communs à une section | `assets/sections/<section>.js` | partagé par quelques pages ; un propriétaire unique |
| contenu, états, modales propres à une page | la page | ne sert qu'à elle |
| icônes, infobulles, menus, modales, onglets (comportement) | `shell-base.js` (déclaratif) | même mécanique partout, aspect venu des classes capturées |

---

## 4. Construire une page

1. **Lire la capture** de la page (section 1) et noter : route finale, titre exact, viewport, clé de navigation.
2. **Copier le gabarit** `assets/page-template.html` vers `app/<route>/index.html` (web) ou
   `ecrans/<ecran>/index.html` (bureau) — correspondances exactes, redirections, routes dynamiques :
   `conventions.md` §2. Si la disposition générale diffère de la page de référence, partir de celle-ci.
3. **`<title>`** = `document.title` exact de l'original ; `body[data-nav]` = clé du GUIDE ; icône de l'onglet.
4. **Recopier `dom-initial.html` dans `<main>`** : même structure, mêmes classes, textes mot pour mot (accents,
   espaces insécables, majuscules, fautes de l'original comprises). Conversions mécaniques
   (`py "%OUTILS%\dom2page.py" dom-initial.html main.html`, détail : `conventions.md` §10) :
   `<svg icon="lib:nom" …/>` → `<svg data-icon="lib:nom" …></svg>` ; échappements
   du kit (`§`, `(AMP)`, `(Q)`, `(SECT)`) déjà inversés — sinon les inverser ; commentaires du kit
   (`<!--IFRAME …-->`, `<!--SVG complexe …-->`, `<!--CANVAS …-->`) remplacés par l'élément reconstruit.
   Logiciel natif (pas de DOM) : structure et positions tirées de `uia-*.json`, aspect des images de fenêtre
   (`conventions.md` §10, `fidelite.md` §11).
5. **Données** : chiffres agrégés et réglages du compte relevés tels quels ; toute donnée personnelle → `FAKE`
   (section 7). Le rendu dynamique passe par `Shell.html` (échappement automatique).
6. **États et interactions** : chaque `dom-<etat>.html` devient un état atteignable par le même geste que
   dans l'original — onglets (`data-tabs`), menus (`data-menu`), modales et tiroirs (`data-modal-open`),
   accordéons (`data-toggle`), interrupteurs (`data-switch`), infobulles (`data-tip-text`), squelettes de
   chargement, états vides, filtres/tri/recherche/pagination sur les données fictives. Ce que l'original
   rend dans un « portail » (modales, menus flottants) se place en fin de `<body>`.
7. **Graphiques** en SVG inline à partir de `graphique-<nom>.txt` (mêmes valeurs, axes, couleurs) :
   `fidelite.md` §7.
8. **Liens** : routes internes → pages locales (même si un autre agent les construit) ; liens externes comme
   l'original ; images → URL publiques absolues de l'original (ressources statiques), jamais de
   téléchargement de contenu protégé ni d'image derrière connexion (avatar à initiales à la place).
9. **Aucun effet réel** : aucun appel d'API ni requête de données (`fetch`, `XMLHttpRequest`, `action` de
   formulaire) vers l'original ou ailleurs, pas d'`alert()`/`confirm()` ; « Enregistrer / Envoyer / Supprimer /
   Connecter » ouvrent et ferment l'interface comme l'original, sans rien persister (sauf choix d'affichage de
   l'utilisateur via `Shell.store`). Pas de formulaire de connexion ou de paiement fonctionnel.
10. **Vérifier soi-même** dans le navigateur intégré (outils `mcp__Claude_Browser__*`, **son propre onglet**,
    `tabId` partout, onglet fermé à la fin) : viewport de la capture (`resize_window`), zéro erreur console
    (`read_console_messages` ; seul l'avertissement « cdn.tailwindcss.com should not be used in production »
    est attendu), comparaison avec les images (`computer` screenshot), `scrollHeight` de `#main` et positions
    clés (`getBoundingClientRect`) contre les mesures de `notes.md`, chaque état, 375 px sans défilement
    horizontal. Attendre `document.documentElement.dataset.shell === 'ready'` avant de mesurer. Navigateur
    intégré absent ou plein (« Tab cap reached » : les onglets des autres agents ne se ferment pas) : Edge ou
    Chrome **headless** sur profil temporaire (`headless.ps1 -Action lancer`), puis `cdp_eval.py nav --console`
    (erreurs console), `eval --file verif.js`, `shot`, `hover`, et `png_diff.py diff` contre l'image de capture
    (`verifier-copie/references/methode.md` §2 et §6) ; à la fin `headless.ps1 -Action fermer`. Jamais le Chrome
    de l'utilisateur.
11. **Rendre compte** : pages construites (route, fichier, statut), écarts connus, `shellIssues`,
    `sectionIssues` — précis (fichier, problème, changement proposé).

---

## 5. La coque générique `shell-base.js`

Copiée telle quelle dans chaque clone (testée dans Edge sur une page de démonstration : icônes, liaisons,
formats, menus, modales, onglets, infobulles, stockage, mode bureau). Elle ne dessine rien : l'aspect vient
toujours des classes recopiées de l'original ; elle apporte le comportement.
Tous ses comportements sont **délégués** au document : un contenu injecté après coup (tableau rendu en JS,
modale, infobulle) fonctionne sans rien rappeler, et un observateur hydrate automatiquement ses icônes et liaisons.

| API | Usage |
|---|---|
| `Shell.configure({ appName, locale, currency, timeZone, today, user, org, bureau, hiddenClass, tipDelay })` | dans `shell.js` ; `locale` = langue d'affichage de l'**original** (fr-FR par défaut) ; `tabler` et `observe` se règlent avant le chargement (`window.SHELL_CONFIG`) |
| `<svg data-icon="nom" class="w-4 h-4"></svg>` | remplacé par l'icône ; les attributs posés (class, style, stroke-width, aria-label…) l'emportent |
| `Shell.icon(nom, classes, { attrs, label })` | chaîne `<svg>` pour le HTML généré en JS |
| `Shell.registerIconsText(texte d'icones.txt)` | enregistre d'un coup les icônes capturées (`lib:nom` + alias `nom`) |
| `Shell.registerIcons({ nom: '<path…/>' \| '<svg…>…</svg>' \| { body, vb, sw, fill, lock } }, défauts)` | icônes à la main ; `lock: true` = trait en style inline (une classe `stroke-2` ne l'écrase plus) |
| `Shell.esc(s)`, ``Shell.html`…${v}…` ``, `Shell.raw(s)` | échappement ; `html` échappe les valeurs, insère tels quels `html` imbriqués, tableaux et icônes |
| `Shell.fmt(n)`, `fmtMoney(n, 'EUR')`, `fmtPct(0.125, 1)`, `fmtDate(d, 'court'\|'moyen'\|'long'\|'jour'\|'heure'\|'complet')`, `fmtRel(d)`, `today()` | formats `Intl` de la langue configurée ; `today()` = `FAKE.TODAY` figé |
| `Shell.codes(s)` | codes caractère (`U+202F`, `U+00A0`…) pour comparer des textes « identiques » |
| `Shell.store.get(clé, défaut)` / `set` / `remove` / `clear()` | `localStorage` préfixé (`clone-<appli>:`) et protégé (jamais d'erreur) |
| `data-tip-text="…"` / `data-tip="id-template"` (+ `data-tip-pos`, `data-tip-delay`) | infobulle ; aspect par variables `--tip-*` dans `shell.css` |
| `data-menu="id"` + `#id.hidden` (+ `data-float="bottom-end"`, `data-menu-close`, `data-chevron`) | menu déroulant : clic extérieur, Échap, un seul ouvert ; `data-float` = position fixe (échappe aux `overflow-hidden`) |
| `data-modal-open="id"`, `data-modal-close`, `data-modal-backdrop`, `[autofocus]`, `iframe[data-lazy-src]` | modale/tiroir : Échap, clic sur le fond, focus rendu ; vidéos chargées à l'ouverture, déchargées à la fermeture |
| `data-tabs` (+ `data-active-class`, `data-inactive-class`, `data-tabs-param`, `data-tabs-store`), `data-tab`, `data-tab-panel` | onglets ; `data-tabs-param="tab"` synchronise `?tab=` |
| `data-toggle="id"` (+ `data-toggle-group`) | dépliant / accordéon (un seul ouvert par groupe) |
| `data-switch` + `data-on-class` / `data-off-class` | interrupteur visuel (`aria-checked`) |
| `data-bind="user.fullName"` (`user.initial`, `user.initials`, `org.name`, `appName`…) | texte tiré de `Shell.CONFIG` |
| `data-nav-key="clé"` + `data-active-class` / `data-inactive-class` | élément de navigation actif quand `body[data-nav]` = clé ; ses descendants qui portent aussi `data-active-class` / `data-inactive-class` (icône, libellé) suivent le même état |
| `data-menubar` (+ `data-accel="f"` sur chaque titre `[data-menu]`, `role="menuitem"` dans les menus) | barre de menus de logiciel : Alt+lettre, flèches haut/bas/gauche/droite, Origine/Fin, Entrée ; au clavier, classes `clavier` (menu) et `is-focused` (élément) posées par script (réglables : `data-kbd-class`, `data-focus-class`) ; à la souris, aucune ; survol d'un autre titre pendant qu'un menu est ouvert = bascule |
| `Shell.ready(fn)`, `Shell.hydrate(el)`, `Shell.setNav(clé)` | démarrage (`<html data-shell="ready">`), hydratation explicite, changement d'élément actif |
| `Shell.menu`, `Shell.modal`, `Shell.tabs.select`, `Shell.toggle.set`, `Shell.switchTo`, `Shell.tip` | pilotage en JS ; évènements `shell:menu`, `shell:modal`, `shell:tab`, `shell:toggle`, `shell:switch`, `shell:ready` |
| `Shell.keys({ 'ctrl+s': fn })`, `Shell.noTransition(el, fn)`, `Shell.copy(texte)`, `Shell.$`, `Shell.$$`, `Shell.on`, `Shell.show/hide/isHidden` | raccourcis, état initial sans animation, presse-papiers, utilitaires DOM |

Points qui évitent des heures de correction :
- Le jeu **Tabler** de base n'est utile que si l'original utilise Tabler. Sinon `window.SHELL_CONFIG =
  { tabler: false }` avant `shell-base.js` et enregistrer les icônes capturées : une icône d'un autre jeu
  « presque pareille » se voit au premier coup d'œil.
- Dans du HTML généré en JS, préférer `Shell.icon()` (vrai SVG tout de suite) aux espaces réservés : une
  référence gardée sur un `<svg data-icon>` deviendrait obsolète après l'hydratation. Écrire
  ``Shell.html`${Shell.icon('plus')} Ajouter` `` et jamais `${Shell.icon('plus') + ' Ajouter'}` : la chaîne
  concaténée n'est plus reconnue comme icône, elle est échappée et le code SVG s'affiche en texte.
- Icône inconnue : SVG vide + avertissement console `[Shell] icône inconnue « x »` — à traiter comme un défaut.
- La classe qui masque est `hidden` (Tailwind) ; clone sans Tailwind : définir `.hidden { display: none }`
  dans `shell.css` ou `Shell.configure({ hiddenClass: '…' })`.

---

## 6. La coque propre à l'appli `shell.js`

Écrite pendant la fondation, pour l'appli copiée, à partir du dump de sa coque (barre latérale, en-tête) :
`Shell.configure(...)`, icônes capturées, rendu de la navigation dans `#nav-slot` (et `#topbar-slot`),
menu utilisateur, repli. Exemple complet et testé : `conventions.md` §6. Règles qui viennent de l'expérience :
- **Liste de navigation en données** (`NAV = [{ key, label, icon, href, badge }]`) + classes de l'élément
  actif et inactif **recopiées du DOM capturé** (`data-active-class` / `data-inactive-class`), y compris sur
  l'icône et le libellé quand l'état actif change aussi leur couleur ou leur graisse.
- Si la coque d'origine est une enveloppe stylée par son identifiant (`#sidebar-wrap { width: 240px }`, enfant
  direct du conteneur flex), donner `class="contents"` à `#nav-slot` : l'enveloppe recopiée reste l'enfant
  direct, comme dans l'original (règles par identifiant : section 7 de `styles.css`).
- **Ne mémoriser que les choix de l'utilisateur** (clic sur « replier »), jamais un état appliqué
  automatiquement (repli sur petit écran) : sinon le clone « se souvient » d'un état que l'original n'a pas.
- **État initial sans animation** : `Shell.noTransition(el, fn)` ; sinon la barre « s'ouvre » à chaque page.
- Les pages ne touchent jamais à la navigation : elles posent `data-nav` et laissent `#nav-slot` vide.
- Lanceur de chat, carrousel promotionnel, bandeaux : dans la coque s'ils sont sur toutes les pages.

---

## 7. Données fictives `fake-data.js`

Partir de `assets/fake-data-template.js` et adapter la section « À ADAPTER » :
- `TODAY` = date de la capture : tout « il y a 3 jours », calendrier ou graphique en dépend.
- `OWNER` : fictif par défaut ; les vraies valeurs du titulaire seulement si l'utilisateur l'a demandé.
- Jeux partagés (membres, contacts…) avec les **colonnes et valeurs possibles relevées** (noms exacts des
  étapes, sources, rôles) ; générateurs : `FAKE.person(r)`, `people(n, 'graine')`, `company`, `address`,
  `sentence`, `series` (graphiques), `split` (parts qui somment au total), `masked('sk_live_', r)` (secrets).
- **Déterminisme** : une graine par usage (`FAKE.rng('contacts-table')`), jamais `Math.random()` ni
  `new Date()` sans argument — sinon deux vérifications ne mesurent pas la même page.
- Emails `@exemple.com|fr|org`, téléphones `+33 6 39 98 xx xx` (plage réservée à la fiction) : `scan_pii.py`
  les reconnaît comme fictifs (`--allow-domain "exemple.*"` ; la plage de fiction est admise d'office). Un
  « 06 12 34 56 78 » appartient peut-être à quelqu'un : jamais de numéro inventé hors de cette plage.
- On garde tels quels les chiffres agrégés (totaux, %) et les réglages du compte (noms d'évènements,
  d'étapes, de produits) : ce ne sont pas des données personnelles de tiers.

---

## 8. Logiciels de bureau

Le clone d'un logiciel est un site local ouvert dans une **fenêtre d'appli** (Edge `--app`) : pas de barre
d'adresse ni d'onglets, la barre de titre Windows affiche `document.title`.
- **Écrans** : `ecrans/<ecran>/index.html` (`principal`, `preferences`, `a-propos`…) ; boîtes de dialogue
  modales de l'original → modales dans l'écran ; fenêtres indépendantes → écrans séparés ouverts par
  `window.open(url, nom, 'popup,width=…,height=…')`. Détails : `conventions.md` §3.
- **Mode bureau** : `Shell.configure({ bureau: true })` → pas de menu contextuel du navigateur hors des champs,
  pas de sélection de texte hors des champs, pas de glisser d'images ; raccourcis par `Shell.keys`
  (certains restent au navigateur : Ctrl+W, Ctrl+N, Ctrl+T).
- **Aspect Windows** : polices système (`"Segoe UI Variable Text", "Segoe UI"`), icônes **Segoe Fluent Icons**
  (police installée sur Windows 11 ; glyphe identifié par `OUTILS\glyphes.html`), mesures de `uia-*.json`
  converties en px CSS (diviser par l'échelle d'affichage), barre de titre native non redessinée ; la couleur de
  celle d'Edge suit `<meta name="theme-color">` (thème sombre : la barre devient sombre). Les onglets qu'un
  logiciel place dans sa barre de titre (Bloc-notes, Terminal) se reproduisent en HTML juste en dessous, sans
  redessiner Réduire/Agrandir/Fermer. Barre de menus : `data-menubar` (section 5) ; Alt+F peut être pris par
  Edge dans une vraie fenêtre (limite à vérifier et à dire). Détails et codes de glyphes : `fidelite.md` §11.
- **Lanceur** : copier `assets/lancer-app.cmd` à la racine du clone et régler en tête `CU_TITRE`, `CU_ID`,
  `CU_PORT`, `CU_PAGE` (chemin sans paramètres : `/ecrans/principal/`, la barre finale est ajoutée si elle
  manque), `CU_LARGEUR`, `CU_HAUTEUR`. Ces deux-là fixent la taille **extérieure** de la fenêtre Edge (cadre
  et barre de titre d'Edge compris) : pour une zone de contenu égale à celle de l'original (px CSS =
  `cadreEcran ÷ echelle`), ajouter environ 14 px en largeur et 37 en hauteur (mesuré à 125 % : 1155×695 →
  contenu 1142×658), puis le vérifier : `set CU_NAV_EXTRA=--remote-debugging-port=9230`, lancer, et
  `py "%OUTILS%\cdp_eval.py" --port 9230 eval --expr "[innerWidth, innerHeight]"`. Il démarre
  `py -m http.server` (fenêtre réduite « Serveur - … ») si la page ne répond pas, puis ouvre Edge (Chrome à
  défaut) avec un **profil dédié** (`%LOCALAPPDATA%\copieur-universel\profils\<CU_ID>`) : fenêtre
  indépendante, taille respectée, `localStorage` du clone conservé. Options : `--verifier` (diagnostic sans
  effet), `--serveur`, `--arreter` (n'arrête qu'un serveur Python **qui sert ce clone** — la page renvoyée
  doit être identique au fichier — pour ne jamais couper le serveur d'un autre projet), `--aide`. Tester
  avec `--verifier` avant de livrer ; depuis Git Bash, avec le chemin complet :
  `cmd //c "<CLONE>\lancer-app.cmd" --verifier`.
  **Modifier les réglages** avec un outil qui garde les fins de ligne CRLF (outil Edit, Bloc-notes,
  PowerShell), jamais `sed -i` de Git Bash : en LF seules, cmd saute aux mauvaises étiquettes (vu : il lançait
  `py` sans argument) ; le lanceur le détecte au démarrage et s'arrête. Les réglages peuvent aussi venir de
  variables d'environnement du même nom (`set CU_PORT=8771`). Raccourci sur le Bureau (facultatif) :
  ```powershell
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\<Nom> (clone).lnk")
  $s.TargetPath = "<CLONE>\lancer-app.cmd"; $s.WorkingDirectory = "<CLONE>"; $s.WindowStyle = 7; $s.Save()
  ```
- **macOS / Linux** (pas de `.cmd`) : `python3 -m http.server 8770 --bind 127.0.0.1 --directory "<CLONE>" &`
  puis `"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --app=http://127.0.0.1:8770/ecrans/principal/
  --user-data-dir="$HOME/.copieur-universel/<id>"` (ou `google-chrome --app=…` sous Linux).

---

## 9. Critères de fin

Une page (ou un écran) est terminée quand :
- [ ] titre exact, `data-nav` correct, structure et classes du DOM capturé, textes identiques caractère par caractère ;
- [ ] chaque état capturé est atteignable par le même geste ; aucune interaction n'a d'effet réel ;
- [ ] icônes du bon jeu (aucun avertissement « icône inconnue ») ; graphiques aux bonnes valeurs ;
- [ ] mesures : `scrollHeight` de `#main` et positions clés à ±2 px de `notes.md` au viewport de la capture ;
- [ ] zéro erreur console ; aucun espace réservé `svg[data-icon]` restant ; 375 px sans défilement horizontal ;
- [ ] aucune donnée personnelle réelle ni secret (seul ce que l'utilisateur a choisi de garder) ;
- [ ] liens internes vers des pages locales existantes ou en construction.

La fondation est terminée quand la page de référence a passé **deux** vérifications, que la coque, les
données et la configuration sont gelées, que le GUIDE est écrit et que l'utilisateur a validé.
Contrôle rapide de ses propres pages avant de rendre la main (serveur local lancé) :
```bash
py "$OUTILS/check_links.py" --root "<CLONE>" --base http://localhost:<PORT> --original <hôte de l'original>
py "$OUTILS/scan_pii.py" --root "<CLONE>" --allow-domain "exemple.*"
```
(`check_links.py` liste toute référence à l'original : navigation, scripts ou API sont à corriger, seules les
ressources statiques publiques admises par le GUIDE restent. `scan_pii.py` renvoie un code non nul s'il trouve
quelque chose : lire le rapport ; ajouter `--allow "<email>"` seulement pour ce que l'utilisateur a choisi de
garder.) Le clone est livrable après `verifier-copie` (deux passes par unité + contrôle final du site).

---

## 10. Pièges les plus fréquents (liste complète : `references/fidelite.md` §10)

- Barre de défilement fine devenue épaisse : `scrollbar-width` désactive `::-webkit-scrollbar` dans Chromium →
  classe `scrollbar-thin` de `shell-base.css` (repli standard sous `@supports not selector(::-webkit-scrollbar)`).
- Icônes fines devenues épaisses : une classe `stroke-2` écrase l'attribut → `lock: true` (style inline).
- « 1 007 » ≠ « 1 007 » : espace fine insécable U+202F en fr-FR → `Shell.codes()` pour comparer.
- Palette « presque » juste : une teinte personnalisée → contrôle de palette (`fidelite.md` §12) avant de copier 30 pages.
- Menu coupé par un conteneur `overflow-hidden` → `data-float` ou menu placé en fin de `<body>`.
- Vidéo qui continue de jouer après fermeture → `iframe[data-lazy-src]` ; `allow="autoplay; fullscreen"`
  sans l'attribut `allowfullscreen` (avertissement console).
- Valeurs différentes à chaque chargement → `Math.random()`/`new Date()` dans une page : passer par `FAKE`.
- Page testée en `file://` : chemins absolus cassés → toujours via le serveur local.

---

## Renvois

- `copier-une-appli` : orchestration, règles (`references/regles.md`), leçons (`references/lecons.md`),
  gabarit de Workflow (les constructeurs y reçoivent ce skill).
- `reconnaissance-appli` : inventaire des routes/écrans et découpage en unités.
- `capture-web` / `capture-bureau` : format exact de la capture (kit `capture-kit.js`, `uia_dump.ps1`, `window_shot.ps1`).
- `verifier-copie` : double vérification, vérificateurs adverses, contrôle final (`check_links.py`, `scan_pii.py`).
