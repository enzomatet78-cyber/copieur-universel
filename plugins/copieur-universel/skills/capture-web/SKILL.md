---
name: capture-web
description: "Capture fidèle d'une appli ou d'un site WEB avant de le recréer en local : DOM nettoyé et anonymisé, captures d'écran de chaque état, styles personnalisés, icônes, graphiques, mesures et notes par page. À utiliser dès qu'il faut relever ce qu'affiche une appli web pour la copier, la cloner, la recréer ou la reproduire — appli connectée (SaaS, tableau de bord, CRM, back-office) dans le Chrome de l'utilisateur via Claude in Chrome, en lecture seule stricte, ou site public via Chrome/Edge headless + cdp_eval.py ou le navigateur intégré — même si la demande ne dit pas « capture » : « copie cette page », « clone ce dashboard », « refais cet écran à l'identique », « récupère le DOM de chaque onglet », « fais des captures de toute l'appli ». Fournit et explique le kit capture-kit.js (anonymisation avant toute image, échappements du filtre de l'extension, morceaux de 900 caractères, modales, icônes Tabler/Lucide/Heroicons, __styles). EN: Use whenever a web app or website must be captured faithfully (cleaned + anonymized DOM, screenshots of every state, custom CSS, icons, charts, measurements, per-page notes) before cloning, copying, recreating or replicating it locally — logged-in apps through Claude in Chrome (strict read-only) or public sites through headless Chrome/Edge + cdp_eval.py or the built-in browser — even when the user never says 'capture'. Ships capture-kit.js."
---

# Capture web — relever fidèlement une appli ou un site

La capture est le **seul moment où l'on regarde l'original**. Les constructeurs, puis les vérificateurs, ne
verront que ce que la capture aura rangé dans le dossier de travail : DOM, images, notes. Une capture
incomplète produit une page inventée ; une capture non anonymisée fait sortir des données de tiers ; une
capture faite sans discipline sur un compte réel peut modifier ce compte. Ce skill décrit donc trois choses :
**quoi relever** (et dans quel format), **comment le relever** selon le type d'appli, et **les garde-fous**.

C'est la méthode qui a permis de recréer entièrement l'appli iClosed (SaaS React + Tailwind, connectée), page par
page, état par état, avec un kit JavaScript injecté dans l'onglet ; elle est ici généralisée à n'importe quelle
appli web et aux sites publics.

**Outils** : dossier `outils/` du plugin = `${CLAUDE_PLUGIN_ROOT}/outils/` ; si cette variable n'est pas
remplacée, utiliser `<Base directory de ce skill>\..\..\outils\` (résoudre en chemin absolu avant de lancer une
commande). Dans la suite, `OUTILS` désigne ce chemin absolu (cmd : `%OUTILS%`, bash : `$OUTILS`). Le kit est
`OUTILS\capture-kit.js` ; le client CDP est `OUTILS\cdp_eval.py` (`nav`, `eval`, `shot`, `hover`, `console`,
`size`, `close`) ; `OUTILS\headless.ps1` lance et ferme un Chrome/Edge headless sur profil temporaire.

Fichiers de ce skill (relatifs à son Base directory) :
- `references/chrome-connecte.md` — appli **connectée** via Claude in Chrome : choix du navigateur, onglet
  unique, rendu forcé, filtre de sortie, lecture seule stricte (autorisé / interdit), déroulé exact d'une page ;
- `references/sites-publics.md` — site **public** : Chrome/Edge headless + `cdp_eval.py` (lancement, commandes,
  fermeture propre), ou navigateur intégré.

Skills voisins : `copier-une-appli` (point d'entrée, règles complètes dans `references/regles.md`, pièges dans
`references/lecons.md`), `reconnaissance-appli` (inventaire des routes et découpage en unités, avant la capture),
`capture-bureau` (Electron/WebView2 et logiciels natifs), `reconstruire-appli` (après la capture),
`verifier-copie` (compare le clone à la capture).

---

## 1. Choisir le mode

| Situation | Mode | Navigateur | Détail |
|---|---|---|---|
| Appli derrière une connexion (compte de l'utilisateur) | **connecté** | le Chrome réel de l'utilisateur, via Claude in Chrome ; **l'utilisateur s'est connecté lui-même** | `references/chrome-connecte.md` |
| Site ou appli publique (vitrine, tarifs, docs, démo sans compte) | **public** | Chrome/Edge **headless sur profil temporaire** + `cdp_eval.py` (fichiers PNG et DOM directement sur disque) ; le navigateur intégré en complément (survols, exploration) | `references/sites-publics.md` |
| Appli Electron / WebView2 | bureau | relancée avec un port de débogage, même kit via `cdp_eval.py` | skill `capture-bureau` |

Pourquoi ne pas tout faire en headless ? Parce qu'une appli connectée exigerait de saisir des identifiants dans
un navigateur piloté, ce qui est exclu : la session de l'utilisateur vit dans **son** Chrome, où il s'est connecté
lui-même. Et pourquoi ne pas tout faire dans son Chrome ? Parce que c'est son outil de travail (onglets,
cookies, comptes) : pour un site public, un profil vierge montre exactement ce que voit un visiteur, sans rien
risquer de ses sessions.

Une seule capture à la fois par navigateur : deux agents dans le même navigateur se volent la navigation, et les
onglets en arrière-plan ne dessinent pas les applis modernes. C'est pour cela que la capture est **séquentielle**
alors que la construction est parallèle (voir `copier-une-appli`).

---

## 2. Avant la première page

- **Liste des pages et des états** : issue de `reconnaissance-appli` (inventaire, unités) ou fournie par l'agent
  principal. Pour une SPA, les routes viennent du bundle (`OUTILS\routes-from-bundle.js`) puis d'une visite.
- **Dossier de travail** hors du clone (ex. scratchpad) : `<TRAVAIL>\capture\<unité>\<page>\` (section 6). Les
  captures ne doivent jamais être servies ni livrées avec le clone.
- **Ce qu'on garde tel quel** (demandé au cadrage) : en général le nom du titulaire du compte, son email, son
  organisation. Tout le reste de ce qui touche des personnes devient fictif.
- **Viewport de référence** : noter celui de la première page (`__info()`), garder le même partout ; les
  vérificateurs compareront au même format.
- **Charger les règles** : `copier-une-appli/references/regles.md`. Elles priment sur la fidélité : ce qu'on ne
  peut relever qu'en les enfreignant est décrit dans les notes, pas capturé.

---

## 3. Le kit `capture-kit.js`

Un fichier JavaScript injecté **tel quel** dans la page ; il renvoie `kit ok`. Il ne fait que **lire** le DOM ;
trois fonctions modifient l'**affichage local** pour les images (`__anonLive`, `__mask`, `__cover`), jamais le
serveur — on recharge la page ensuite. Il garde sa configuration, son dictionnaire d'anonymisation et sa propre
source dans le `sessionStorage` de l'onglet (clés `copieur-*`), ce qui permet : des faux noms **identiques d'une
page à l'autre**, et une **réinjection courte** après chaque navigation.

### Injecter
- **Claude in Chrome, navigateur intégré** : lire le fichier (Read) et passer tout son contenu comme `text` de
  `javascript_tool`. Le fichier pèse environ 85 Ko (près de 25 000 jetons) : on ne l'envoie qu'**une fois par
  onglet**. Après chaque navigation ou rechargement, la réinjection courte suffit :
  ```js
  window.__dump ? 'kit ok' : (0, eval)(sessionStorage.getItem('copieur-kit') || "'kit absent'")
  ```
  Réponse `kit absent` ou erreur → renvoyer le fichier complet. (Testé par le protocole DevTools, sur lequel
  repose aussi l'évaluation « REPL » de `javascript_tool` : sous une CSP stricte, cet `eval` passe. Si
  l'extension répond « EvalError », renvoyer le fichier complet après chaque navigation.)
- **`cdp_eval.py`** : `--file "%OUTILS%\capture-kit.js" --expr "…"` à chaque appel (gratuit, rien ne transite par
  la conversation).

### Configurer (une fois par onglet ; conservé de page en page)
```js
__config({ keep: ['Prénom Nom', 'Organisation'], owner: 'titulaire@domaine.fr' })
```
Équivalent historique, avant l'injection : `window.__KEEP = [...]` et `window.__OWNER_EMAIL = '…'`.

| Clé | Défaut | Rôle |
|---|---|---|
| `keep` | `[]` | textes jamais anonymisés (noms, organisation ; un email dans la liste est aussi gardé) |
| `owner` | `[]` | email(s) du titulaire, gardés |
| `fakeDomain` | `exemple.com` | domaine des emails fictifs (à déclarer dans `scan_pii.py --allow-domain`) |
| `raw` | `false` | `true` = sorties brutes non échappées (mode `cdp_eval`) |
| `main` | auto | sélecteur du conteneur principal si la détection se trompe |
| `rows` | `10` | lignes gardées par tableau (`tbody`, `[role=rowgroup]`) dans les dumps |
| `lists` | `0` | si > 0, tronque aussi les longues listes d'éléments identiques |
| `svgMax` | `2500` | au-delà, un SVG non-icône est remplacé par un commentaire (détail : `__chart`) |
| `iconPaths` | `false` | `true` = garder le SVG complet des icônes reconnues dans les dumps |
| `dataAttrs` | `[]` | attributs `data-*` supplémentaires à garder |
| `chunk` | `900` | taille des morceaux du mode par défaut |

### Fonctions

| Fonction | Rôle |
|---|---|
| `__info()` | route finale (paramètres sensibles masqués), titre exact (anonymisé), viewport, DPR, conteneur principal et défilant, `scrollHeight`, overlays ouverts, technos détectées (React, Vue, Tailwind v3/v4, Radix, MUI, Chart.js…), état d'anonymisation |
| `__guessNames(racine)` | noms de personnes probables (`probables` : contexte avatar/tableau/membre ; `autres`) à **relire** avant de les passer à `__addNames` |
| `__addNames([...], {prenom: true})` | associe à chaque nom réel un nom fictif stable, ses initiales d'avatar (« JD », et la lettre seule « J » dans une pastille ronde), ses variantes de lien et un email qui suit le faux nom ; `prenom: true` remplace aussi le prénom seul (« Bonjour Jean ») ; renvoie la taille du dictionnaire |
| `__addMap({réel: fictif})` | remplacements libres : adresses, sociétés clientes, intitulés personnels |
| `__anonLive(racine)` | anonymise l'**affichage** (textes, `title`/`alt`/`aria-label`/infobulles, valeurs des champs sauf celui qui a le focus, liens `mailto:`/`tel:`, avatars floutés, secrets masqués) puis **surveille** la page (contenus qui arrivent, infobulles, re-rendus) ; renvoie un résumé à lire |
| `__anonStop()` | arrête la surveillance |
| `__mask(sel, n)` / `__cover(sel, libellé)` / `__uncover()` | masquer un texte non détecté (garde `n` caractères) / couvrir une zone (éditeur, message) d'un aplat qui suit la zone quand on fait défiler / retirer les aplats |
| `__mainEl()`, `__modalEl()`, `__overlays()` | conteneur principal ; racine de la modale ouverte (portail + fond) ; liste des modales/menus/infobulles ouverts (indices utilisables comme racine) |
| `__scroll(y\|'bas')`, `__steps()` | fait défiler le vrai conteneur défilant ; positions pour couvrir toute la hauteur |
| `__rects(sel, max)` | positions et tailles (pour les notes : mesures de fidélité) ; 30 éléments au plus par défaut, `max` pour davantage |
| `__etat()` puis `__diffEtat()` | photographie de la page, puis tout ce qui a changé depuis (classes, style, visibilité, `aria-expanded`, `data-state`, éléments ajoutés ou retirés) : indispensable pour un état de la coque |
| `__dump(racine, lignes, {lists})` | DOM nettoyé + anonymisé de la racine (`'main'` par défaut, `'modal'`, `'body'`, sélecteur, élément, indice d'overlay) |
| `__styles(racine, {max, maxVars})` | 1. règles CSS des classes **non Tailwind standard** ; 2. `@keyframes` utilisés ; 3. variables CSS de `:root` **et des ancêtres du conteneur principal** (thème `--vscode-*` d'une appli Electron), couleurs d'abord ; 4. polices ; 5. palette calculée ; 6. classes de couleur → valeur calculée ; 7. règles par **identifiant** (`#sidebar-wrap`) et par **élément** (`html`, `body`, `*`, barres de défilement). Mode raw : rien n'est tronqué ; mode par défaut : 60 000 caractères, seule la section 1 est raccourcie |
| `__icons(racine)` | dictionnaire des icônes SVG reconnues (Tabler, Lucide, Feather, Heroicons, Font Awesome, Iconify, sprites `<use>`) avec leur SVG exact, puis les **polices d'icônes** (codicon, Material Symbols, Bootstrap Icons… : glyphe `::before` et son code, ou ligature) en lignes de commentaire |
| `__chart()` / `__chart(i)` | liste des graphiques (SVG/canvas) / détail : textes, barres, tracés, couleurs, positions ; données Chart.js/ECharts si présentes |
| `__html(racine, lignes)`, `__dumpText(texte)`, `__get(i, n)` | chaîne brute ; découper un texte quelconque ; morceaux `i` à `i+n` |
| `__wait(ms)` | promesse résolue après `ms` : attendre dans la même expression qu'un clic (`cdp_eval.py`, `await` dans `javascript_tool`) |
| `__forget()` | efface config, dictionnaire et source du `sessionStorage` (fin de capture) |

`__clean(el)` et `__trim(el, lignes)` restent disponibles pour la compatibilité avec le kit d'iClosed.

### Deux modes de sortie
- **Par défaut (Claude in Chrome, navigateur intégré)** : `__dump`, `__styles`, `__icons`, `__chart(i)` rangent
  le texte dans `window.__D`, **échappé** et découpé en morceaux de ≤ 900 caractères, et renvoient le nombre de
  morceaux. Raison : le filtre de sortie de l'extension tronque vers 1000 caractères et bloque ce qui ressemble à
  des cookies ou des chaînes de requête. Échappements : `§`→`(SECT)`, puis `;`→`§`, `&`→`(AMP)`, `?`→`(Q)`.
  On récupère `window.__D.slice(0, 20)`, `(20, 40)`… puis on **inverse** en écrivant le fichier (procédure
  exacte : `references/chrome-connecte.md` §7). Les textes courts de `__info()` et `__overlays()` sont échappés
  de la même façon.
- **Raw** (`__config({raw: true})`, pour `cdp_eval.py`) : les mêmes fonctions renvoient la chaîne entière, que
  `cdp_eval.py --out` écrit telle quelle en UTF-8.

### Lire un dump (conventions)
- Structure, classes, textes et attributs utiles sont gardés ; scripts, styles, `id` générés, `data-*` (sauf
  les attributs d'état : `data-state`, `data-side`, `data-headlessui-state`…), gestionnaires `on*` sont retirés.
- Infobulles : `data-tip*`, `data-tooltip*` (texte anonymisé) et `aria-describedby` vers un id lisible sont
  gardés, ainsi que les `<template id="…">` et leur contenu (texte d'infobulle, ligne type) : le lien
  élément → infobulle reste lisible sans survol.
- État **vivant** des formulaires : `value` affichée (anonymisée), `checked`, `selected` ; mots de passe et champs
  cachés absents.
- Espaces significatifs visibles : `&nbsp;` (U+00A0) et `&#8239;` (espace fine insécable U+202F des nombres fr-FR).
  `<pre>` et `white-space: pre*` gardent leurs retours à la ligne.
- `<svg icon="tabler:home" class="w-4 h-4" stroke-width="1.5"/>` : icône reconnue (SVG exact dans `__icons`).
  `<svg icon="heroicons:outline" …><path …/></svg>` : icône sans nom (Heroicons) gardée en SVG compact ;
  `heroicons?` = probable.
- `<!--SVG complexe : N caractères…-->` (graphique, illustration → `__chart`), `<!--IFRAME url?options WxH-->`
  (la requête est gardée, paramètres sensibles masqués : `seo=false&fitStrategy=cover` comptent pour la fidélité),
  `<!--CANVAS WxH-->`, `<!--WISTIA id-->`, `<!-- +N lignes non capturés -->`, `src="[AVATAR]"`, `…[DATAURI]`,
  `<template shadowrootmode="open">` (Shadow DOM), secrets `sk_live_••••••••3f9a`, `•••• 4242`.
- Paramètres d'URL sensibles (`token`, `code`, `email`…) remplacés par `•••` ; un long jeton dans le chemin d'un
  lien (`/invite/AbCd••••••••MnOp`) est masqué, mais le chemin d'une image ou d'une vidéo garde ses longs
  hachages de CDN (sinon l'URL ne mènerait plus à l'image). Les noms passés à `__addNames` sont aussi remplacés
  dans les URL (`/e/jean-dupont` → `/e/lucas-lambert`). Un chemin local qui contient le nom de session
  (`vscode-file://…/c:/Users/<nom>/…`, `C:\Users\<nom>\…`, `/Users/<nom>/…`) devient `…/Users/utilisateur/…`.

---

## 4. Anonymiser avant toute image et tout dump

Les images et les dumps quittent l'original pour être lus par d'autres agents et rangés sur disque : on
anonymise **avant**, jamais après. Ce que le kit fait seul : emails (sauf titulaire, adresses de rôle comme
`support@`, et domaine fictif), téléphones internationaux et français (les montants comme « +12 345 678 € » ne
sont pas touchés), adresses IP publiques (remplacées par des adresses de documentation ; IP locales et numéros
de version gardés), clés et jetons (`sk_live_`, `AKIA`, `ghp_`, `xox…`, JWT…), numéros de carte (Luhn), IBAN
(clé 97), paramètres d'URL sensibles, chemins locaux qui révèlent le nom de session Windows ou macOS, avatars
(photos floutées à l'écran, `[AVATAR]` dans les dumps). Un long
numéro valide au test de Luhn (SIRET, certains numéros de commande) est masqué comme une carte : le noter à part
s'il compte pour la reconstruction.

Ce qu'il faut lui dire : les **noms de personnes**. Déroulé, à chaque page :
1. `__guessNames()` → relire les deux listes (elle propose, on décide : « Calendrier IA » n'est pas une personne,
   un prénom seul n'est pas détecté). Ce sont de vrais noms : la liste reste dans la conversation, jamais dans
   le dossier de capture ;
2. `__addNames([...noms réels...])` : chaque nom reçoit un faux nom stable, ses initiales d'avatar (« JD » ;
   la lettre seule « J » seulement dans une pastille ronde ou un élément `avatar`), ses variantes de lien
   (`jean-dupont`, `jean.dupont`, fréquentes dans les liens de réservation) et un email fictif qui suit le
   faux nom (`jean.dupont@…` → `lucas.lambert@exemple.com`). Prénom seul affiché (« Bonjour Jean ») :
   `__addNames([...], {prenom: true})` — à éviter pour un prénom qui est aussi un mot courant (Rose, Pierre),
   puisque le remplacement porte sur tout le texte ;
   `__addMap({...})` pour les adresses, sociétés clientes, intitulés personnels et **montants individuels**
   (le montant d'un client précis), que le kit ne devine pas. Les noms d'objets propres au compte (évènements,
   produits, étapes) et les chiffres agrégés peuvent rester (voir `regles.md` §5) ;
3. `__anonLive()` — il signale ce qu'il ne modifie pas exprès : les **zones éditables** (un éditeur de texte riche
   prendrait la modification pour une saisie et l'enregistrerait) et le **champ qui a le focus** (certaines
   applis enregistrent un champ quand il perd le focus). On les couvre avec `__cover(sel)` avant l'image ;
4. **regarder chaque image** : si une donnée réelle reste visible (nom non listé, texte dans une image, canvas,
   iframe), compléter (`__addNames`, `__mask`, `__cover`) et refaire l'image.

La surveillance de `__anonLive` rattrape ce qui apparaît ensuite (lignes chargées au défilement, infobulles,
re-rendus). Les **notes** ne contiennent jamais de donnée réelle non plus. Le dictionnaire réel → fictif reste
dans l'onglet (`sessionStorage`) et n'est jamais écrit sur disque. Après la page, la navigation suivante (ou un
rechargement) remet l'affichage d'origine.

---

## 5. Procédure par page et par état

Les appels exacts (outils, paramètres) sont dans les références ; la logique est la même dans tous les modes.

1. **Ouvrir** la page par son URL complète, attendre le rendu complet (rituel de rendu en mode connecté), puis
   injecter / réinjecter le kit. `__info()` → noter route demandée → route finale (redirection ?
   « page introuvable » ?), `titre` exact, viewport, conteneur défilant et `scrollHeight`.
2. **Anonymiser** (section 4).
3. **Images** de la vue initiale puis de toute la hauteur : pour chaque `y` de `__steps()`, `__scroll(y)` puis
   image ; `__scroll(0)` à la fin. Noms parlants (section 6).
4. **DOM** : `__dump('main', 8)` → `dom-initial.html`. Sur la page de référence (fondation), dumper aussi la coque :
   barre latérale, en-tête (`__dump('nav')`, `__dump('#sidebar')`, ou `__dump('body', 8)`).
5. **États** — c'est souvent là que se cache la moitié du travail : chaque onglet et sous-onglet, menus
   déroulants importants, modales « Nouveau… » ouvertes **sans rien remplir** puis fermées, tiroirs, états
   vides, infobulles clés, survols, accordéons, pagination. Pour chacun : ouvrir (si c'est autorisé), `__anonLive()`
   si du contenu nouveau est apparu hors surveillance, image, `__overlays()` puis `__dump('modal')` ou
   `__dump(i)` → `dom-<etat>.html`, fermer (Échap, Annuler, croix).
   - **États de la coque** (barre repliée, menu utilisateur, petit écran) : `__etat()` avant l'action,
     `__diffEtat()` après → `dom-<etat>-diff.txt`. Une action sur la barre latérale change souvent un élément
     éloigné (la marge du contenu principal sous 768 px, vu sur iClosed) qu'un dump du seul élément cliqué ne
     montre pas ; à défaut, dumper `'body'`.
   - **Survols** : `cdp_eval.py hover --selector "<CSS>" --out 40-survol-<nom>.png` (vrai survol : `:hover` CSS et
     infobulles pilotées en JavaScript), ou `computer hover` dans le navigateur.
   - **Animations automatiques** (carrousel, bandeau qui défile) : noter l'intervalle, capturer chaque
     diapositive ; une image et un dump pris à quelques secondes d'écart ne montrent pas la même diapositive.
6. **Une fois par unité** (et sur la page de référence), **dans l'état initial, avant toute interaction** — les
   styles calculés gardent la trace d'un panneau ouvert puis refermé (vu sur VS Code : icône restée « active ») :
   `__styles('body')` → `styles.css`, `__icons('body')` → `icones.txt` ; graphiques : `__chart()` puis
   `__chart(i)` → `graphique-<nom>.txt` ; mesures clés : `__rects('main > div > *')` ou les sélecteurs utiles
   → dans `notes.md`.
7. **`notes.md`** de la page (modèle section 6), écrit au fil de l'eau : si la session est coupée, on reprend
   là où on en était.
8. Page suivante. Une route qui redirige ou affiche « page introuvable » : la noter, ne pas insister.

Explorer aussi les sous-pages et onglets internes de l'unité que l'inventaire n'a pas listés (les ajouter aux
notes). En revanche, ne pas sortir de l'unité : la capture séquentielle attend.

---

## 6. Dossier de capture

```
<TRAVAIL>\capture\<unité>\
  notes.md                  synthèse de l'unité : pages, statuts, routes découvertes, problèmes
  styles.css                __styles('body')            (une fois ; refaire si une page a ses propres styles)
  icones.txt                __icons('body')
  <slug>\                   slug = route sans « / » initial, « / » → « - » : /app/settings/billing → app-settings-billing
    notes.md                                             (« / » seul → accueil ; ?tab=x → -tab-x)
    01-haut.png  02-milieu.png  03-bas.png               vue initiale puis défilement
    10-onglet-<nom>.png  20-modale-<nom>.png  30-menu-<nom>.png  40-infobulle-<nom>.png  50-vide.png
    dom-initial.html  dom-onglet-<nom>.html  dom-modale-<nom>.html  dom-menu-<nom>.html
    graphique-<nom>.txt
```
Garder l'extension d'origine des images (`.png` ou `.jpg`). Créer les dossiers avec `mkdir -p "…"` (Git Bash) ou
`New-Item -ItemType Directory -Force "…"` (PowerShell).

Modèle de `notes.md` d'une page :
```markdown
# /app/route-demandee
- Route finale : /app/route-finale (redirection ? « page introuvable » ?) — statut : ok | redirect | 404 | not-accessible
- Titre exact : « … »  — viewport 1536×791, DPR 1 — capture : <mode>, <date>
- Conteneur défilant : main#main.overflow-y-auto — scrollHeight 2140
## Structure (de haut en bas)
1. <bloc> : rôle, éléments, textes clés exacts, classes marquantes
## États capturés
| état | comment l'obtenir | fichiers |
## Interactions observées
- clic sur « … » → … (modale, tiroir, navigation vers /app/…)
## Liens
| libellé | href |
## Données
- colonnes (noms exacts, ordre), formats (dates, montants, U+202F), lignes affichées, pagination, tri par défaut
## Graphiques
- type, axes, graduations, couleurs, valeurs (graphique-<nom>.txt)
## Mesures
- __rects : …
## Non capturé (et pourquoi)
- bouton « Supprimer » : interdit en lecture seule — aspect décrit : …
## Anonymisation
- N noms remplacés ; zones couvertes : … ; rien de réel visible sur les images (vérifié)
```

---

## 7. Critères de fin (par unité)

- Chaque page de l'unité a un statut (ok / redirect / 404 / not-accessible) et un `notes.md` complet.
- Chaque page « ok » a des images couvrant **toute sa hauteur** et un `dom-*.html` par état capturé ;
  tous les états listés dans la mission (onglets, modales, menus, états vides) sont capturés ou expliqués.
- `styles.css` et `icones.txt` existent pour l'unité ; graphiques détaillés s'il y en a.
- Aucune image, aucun dump, aucune note ne contient de donnée réelle hors liste « à garder », ni de secret.
- Mode connecté : aucune action interdite effectuée ; l'onglet est laissé sur une page neutre rechargée,
  `__forget()` appelé en fin de capture complète. Mode public : navigateur headless fermé par celui qui l'a lancé.
- Le compte rendu renvoyé liste les pages (route, statut, dossier, fichiers, résumé), le viewport et les problèmes.

---

## 8. Pièges fréquents (détails : références et `copier-une-appli/references/lecons.md`)

- **Écran de chargement infini** (Chrome masqué ou onglet en arrière-plan) → rituel de rendu : image à l'échelle
  0.1, attente 3–4 s, nouvelle image, puis seulement le DOM ; un seul onglet au premier plan.
- **Réponse tronquée ou « [BLOCKED…] »** → mode par défaut du kit, morceaux par paquets de 20, morceau bloqué
  redemandé en plus petit (`window.__D[i].slice(0, 300)`…).
- **Navigation par `history.pushState`** qui recharge la page → toujours naviguer avec l'outil de navigation,
  réinjecter le kit ensuite.
- **Faux noms différents d'une page à l'autre** → toujours le même onglet (le dictionnaire vit dans son
  `sessionStorage`) ; ne pas appeler `__forget()` avant la fin.
- **Images trompeuses après un re-rendu** (l'appli remet un vrai nom) → la surveillance le corrige ; refaire
  `__anonLive()` après toute action qui recharge une zone, et regarder l'image.
- **Viewport headless plus petit que `--window-size`** → `cdp_eval.py size --viewport 1536x791` règle la
  fenêtre d'après le viewport mesuré (fait par `headless.ps1`) ; vérifier `__info().vw/vh`. Une fenêtre
  headless ne descend pas sous ~500 px de large : pour 375 px, `nav --viewport 375x812` puis
  `shot`/`eval --viewport 375x812` (`references/sites-publics.md` §2.1).
- **Images d'un autre domaine absentes en headless** (`naturalWidth` 0) alors qu'elles s'affichent dans un
  navigateur normal → ne pas noter « cassées dans l'original » : vérifier dans le navigateur intégré, ne rien
  contourner (ni agent utilisateur, ni en-têtes).
- **Un état de la coque mal reproduit** (marge, largeur ailleurs dans la page) → `__etat()` / `__diffEtat()`
  autour de l'action (section 5).
- **Modale vide dans le dump** → elle est souvent dans un portail hors de `main` : `__dump('modal')` ou
  `__overlays()` puis `__dump(i)`.
- **`styles.css` commence par « Feuilles illisibles (CORS) »** → ces feuilles viennent d'un autre domaine et
  le navigateur en interdit la lecture au script. Pour Google Fonts, c'est sans importance (l'URL suffit). Si
  c'est la feuille de l'appli (classes « sans règle trouvée ») : en mode public, ouvrir son URL dans le même
  onglet (`cdp_eval.py nav --url <URL de la feuille>`, puis `eval --expr "document.body.innerText" --out
  _tmp/feuille.css`), n'en garder que les règles des classes listées, puis revenir à la page par `nav` ; en mode
  connecté, relever les styles calculés des éléments concernés (`getComputedStyle`) dans les notes plutôt que
  de sortir du domaine.

---

## 9. Ensuite

La capture alimente `reconstruire-appli` (fondation d'abord : page de référence → coque partagée), puis
`verifier-copie` compare le clone à ces mêmes fichiers. Si la capture a révélé des pages ou des états que
l'inventaire ignorait, les signaler à l'agent principal pour ajuster les unités.
