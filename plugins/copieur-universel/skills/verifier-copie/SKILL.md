---
name: verifier-copie
description: "Vérification d'un clone recréé en local (appli web, site, écran de logiciel) contre la capture de l'original, avant de dire qu'il est fidèle ou livrable : deux passes indépendantes, relecteurs par angle (mise en page, textes, comportement, confidentialité), vérificateur adverse qui réfute par défaut en cas de doute, mesures getBoundingClientRect et scrollHeight, textes comparés caractère par caractère (espaces insécables), interactions, console, 375 px, contrôle final du site avec check_links.py (pages et liens) et scan_pii.py (emails, téléphones, IBAN, cartes, clés API), rapport honnête. À utiliser dès qu'une copie, un clone, une réplique ou une page refaite doit être vérifiée, relue, comparée, validée ou livrée, même si l'utilisateur dit seulement « vérifie », « c'est fidèle ? », « compare avec l'original », « relis la page », « double vérification », « contrôle final », « il reste des liens cassés ? », « il y a des données perso dans le clone ? », « c'est prêt ? ». EN: Use whenever a locally recreated app, site or screen (clone, copy, replica) must be checked against the original's capture before calling it faithful or done: two independent passes, per-lens reviewers, an adversarial verifier that defaults to 'refuted' when evidence is ambiguous, bounding-rect and scrollHeight measurements, character-level text diff, interactions, console, 375 px, privacy scan and site-wide link check (check_links.py, scan_pii.py), honest report. Also for: QA this clone, is it faithful, final check, broken links."
---

# Vérifier une copie — des mesures, deux passes, un sceptique

Un clone a presque toujours l'air juste au premier coup d'œil. Les écarts qui comptent ne se voient qu'en
mesurant : sur iClosed, les passes de vérification ont trouvé une barre de défilement de 10 px au lieu de 4,
des montants écrits avec une espace ordinaire au lieu de l'espace fine insécable U+202F, des icônes trop
épaisses, une flèche d'infobulle de la mauvaise couleur, un panneau dont les libellés avaient des lignes de
24 px au lieu de 20. Aucun ne sautait aux yeux ; tous se voyaient côte à côte avec l'original.

Trois constats structurent ce skill :
- **Le constructeur est juge et partie** : il vérifie ce qu'il croit avoir fait. Une passe de vérification
  part de la capture de l'original, pas du code du clone.
- **Une passe ne suffit pas** : la première corrige ce qu'elle cherche et rate le reste ; ses corrections
  introduisent parfois des régressions. Une deuxième passe indépendante, depuis zéro, trouve un autre lot.
- **Les relecteurs inventent aussi** : un relecteur qui compare à ses suppositions « corrige » des écarts
  imaginaires et dégrade une page juste. D'où le **vérificateur adverse**, qui tente de réfuter chaque écart
  et le rejette quand la preuve est ambiguë.

**Outils** : dossier `outils/` du plugin, `OUTILS="${CLAUDE_PLUGIN_ROOT}/outils"` ; si cette variable n'est pas
remplacée, utiliser `"<Base directory de ce skill>/../../outils"` (résoudre en chemin absolu avant de lancer une
commande). Dans la suite, `OUTILS` désigne ce chemin absolu, `CLONE` le dossier du clone et `TRAVAIL` le dossier
de travail. Les commandes sont écrites pour l'outil Bash (bash/zsh sous macOS, Git Bash sous Windows), chemins
entre guillemets ; chaque appel Bash est un nouveau shell : redéfinir ces variables ou écrire les chemins en clair.
Sous Windows, `py` remplace `python3` (lanceur Python de Windows).
Outils utilisés ici (Python standard ou JavaScript à injecter, aucune dépendance) : `verif.js` (mesures,
textes, débordement, liens rendus, réseau, formulaires), `textes.py` (textes caractère par caractère),
`png_diff.py` (images au pixel près), `uia_rects.py` (rectangles d'un relevé UIA en px CSS), `check_links.py`,
`scan_pii.py`, et pour mesurer sans navigateur intégré `headless.py` + `cdp_eval.py` (`nav --console`,
`eval`, `shot`, `hover`) ; Windows : `headless.ps1` reste disponible (mêmes actions).

Fichier de ce skill : `references/methode.md` — mode d'emploi de ces outils (navigateur intégré, headless,
comparaison d'images et « dump contre dump »), schémas JSON, gabarits de prompts (relecteur, adverse,
correcteur, contrôleur final), lecture des rapports d'outils, logiciels de bureau, modèle de rapport.

Skills voisins : `copier-une-appli` (point d'entrée, règles `references/regles.md`, orchestration et script
Workflow, pièges `references/lecons.md`), `capture-web` / `capture-bureau` (ce qu'on compare : le dossier de
capture), `reconstruire-appli` (conventions du clone, `references/fidelite.md`), `reconnaissance-appli`
(inventaire des pages attendues).

---

## 1. Avant de commencer : de quoi a-t-on besoin ?

| Entrée | Où | Pourquoi |
|---|---|---|
| Capture de l'original | `<TRAVAIL>/capture/<unité>/<page>/` : `notes.md`, `dom-*.html` (web) ou `uia-*.json` (natif), images | c'est **la** référence ; sans elle on ne juge pas la fidélité |
| Clone servi en local | ex. `http://localhost:8766/` (serveur déjà lancé, on ne l'arrête pas) | on mesure le rendu réel, pas la source |
| GUIDE du projet | `<TRAVAIL>/GUIDE.md` | gabarit, coque, clés de navigation, qui peut modifier quoi |
| Ce qui est gardé tel quel | titulaire du compte, son email, son organisation… | liste blanche de `scan_pii.py`, et tout le reste doit être fictif |
| Viewport de référence | `notes.md` de la capture (ex. 1536×791, DPR 1) | une mesure à une autre taille ne prouve rien |
| Écarts acceptés | liste écrite par l'agent principal (ex. images liées depuis l'original) | on ne les signale pas, on ne les « corrige » pas |

Sans capture, dites-le : on peut vérifier liens, console, petits écrans et confidentialité, pas la fidélité.
Il manque un état ou un texte dans la capture ? Demandez une capture ciblée (`capture-web`/`capture-bureau`)
au lieu d'aller regarder l'original vous-même : le navigateur réel de l'utilisateur (Claude in Chrome) est
réservé aux agents de capture, qui en appliquent les règles de lecture seule. Seule exception : un agent
principal qui confie explicitement un angle « textes contre l'original en direct » (comme sur iClosed) — alors
lecture du DOM uniquement, aucun clic, règles de `capture-web/references/chrome-connecte.md`.

---

## 2. Trois niveaux de vérification

| Niveau | Quand | Agents | Qui modifie |
|---|---|---|---|
| **Passe de vérification** d'une unité (n°1 puis n°2) | après la construction de l'unité | 1 par passe | le vérificateur, pages de son unité seulement |
| **Passe adverse** | fondation (page de référence), pages critiques, ou option `verifAdverseUnites` du Workflow | 4 relecteurs par angle → 1 adverse par relecteur → 1 correcteur | le correcteur seulement |
| **Contrôle final** du site | quand toutes les unités sont vérifiées | 1 | pages oui ; coque et sections non (→ `shellIssues`) |

Le script Workflow de `copier-une-appli` (`assets/workflow-template.js`) câble déjà ces trois niveaux et charge
ce skill dans chaque agent ; sans Workflow, les gabarits de prompts de `methode.md` §9 servent avec l'outil Agent.

Pourquoi des **angles** séparés plutôt qu'un relecteur « qui regarde tout » : chacun descend au détail dans
son domaine (un pixel, un caractère, un évènement) au lieu de survoler. Pourquoi la **deuxième passe repart de
zéro** : si elle se contente de relire la liste de la première, elle hérite de ses angles morts. Elle reçoit
cette liste seulement pour confirmer que chaque correction tient et ne pas rouvrir un point déjà refusé sans
preuve nouvelle.

**Mode dégradé — un seul agent, sans outil Agent ni Workflow** (sous-agent d'un Workflow, session limitée) :
les passes indépendantes et le vérificateur adverse sont impossibles, et le constructeur reste juge et partie.
Faire quand même les deux passes, la seconde **depuis la capture** et non depuis ses notes, en s'appuyant
d'abord sur des preuves mécaniques qui ne dépendent pas du jugement (`png_diff.py`, dump contre dump,
`textes.py`, `nav --console`, `check_links.py`, `scan_pii.py`) ; puis le dire tel quel dans le compte rendu :
« vérifié par l'agent constructeur, sans tiers ». Si l'orchestrateur peut lancer des agents, lui demander une
vraie passe indépendante plutôt que de la simuler.

---

## 3. Préparer la mesure

- **Navigateur intégré** (outils `mcp__Claude_Browser__*`, à charger en une fois via ToolSearch — liste exacte
  dans `references/methode.md` §1). Créez **votre** onglet, passez toujours votre `tabId`, fermez-le à la fin :
  d'autres agents mesurent en parallèle dans leurs onglets, et un rechargement dans l'onglet d'un autre fausse
  ses mesures.
- **Viewport** : `resize_window` à la taille de la capture, puis vérifiez `innerWidth`, `innerHeight` et
  `devicePixelRatio` dans la page. Une image de capture est en pixels **physiques** : px CSS = px image ÷ DPR.
  Le DPR du navigateur intégré suit l'écran : 1,25 sous Windows à 125 %, 2 sur un Mac Retina. Ses mesures JS
  restent en px CSS, donc comparables, mais ses captures d'écran sont agrandies d'autant.
- **État propre** : `localStorage.clear(); sessionStorage.clear(); location.reload()` avant la première mesure,
  sinon un panneau replié ou un onglet mémorisé par un test précédent passe pour un écart.
- **Attendre** que la page soit stable : `<html data-shell="ready">` (coque `shell-base.js`), polices chargées
  (`document.fonts.ready`), fin des squelettes de chargement (~1,5 s). Fonction `__attendre` : `methode.md` §1 et §3.
- **Sans navigateur intégré**, ou pour écrire les mesures directement dans des fichiers, ou pour comparer des
  images au pixel près : Chrome/Edge headless sur profil temporaire (`python3 "$OUTILS/headless.py" lancer`,
  qui règle la taille **avant** toute page ; noter `port` et `profil`) + `cdp_eval.py` (`nav --console`,
  `eval --file verif.js --expr … --out`, `shot`, `hover`), puis `headless.py fermer --profil "<profil>"` —
  `methode.md` §2. Petit écran : `--viewport 375x812` sur `nav`, `eval` et `shot` (une fenêtre headless ne
  descend pas sous ~500 px). Mesurer au **DPR de la capture** (`--viewport LxH@1.25` pour une capture à 125 %,
  `--viewport LxH@2` pour une capture faite sur un Mac Retina) : à DPR 1, les hauteurs de ligne s'arrondissent
  autrement. Ne jamais utiliser le Chrome de l'utilisateur pour mesurer (ni `open -a`, ni un navigateur sans
  `--headless=new` et profil temporaire).
- **Logiciel de bureau** : le clone est une page web ouverte comme une fenêtre d'appli ; on le mesure de la
  même façon à la taille **CSS** de la fenêtre d'origine, et on compare aux rectangles de `uia-*.json`
  (pixels physiques ÷ échelle) et aux images de `window_shot.ps1` (Windows) — `methode.md` §8. macOS : seule
  une appli Electron/CEF se vérifie comme une page (DOM) ; une appli native n'a que ses images de référence
  (`screencapture`), sans équivalent à `uia-*.json`.
- **Déterminisme** : deux rechargements doivent donner la même page (données fictives à graine fixe, date
  figée). Si ce n'est pas le cas, c'est un écart à signaler, et la cause de mesures incohérentes.

---

## 4. Les quatre angles de relecture

Chaque angle se vérifie **pour chaque page et chaque état capturé** (onglet, modale, menu ouvert, survol,
état vide…), pas seulement l'état initial.

### 4.1 Mise en page et rendu
- Commencez par le **`scrollHeight` du conteneur qui défile** : identique à l'original (±2 px), la page est
  presque toujours juste ; différent, cherchez le bloc qui diffère en descendant (`__mesures`).
- Positions et tailles des blocs (`getBoundingClientRect`) contre les `__rects` / mesures de `notes.md` et les
  pixels des images ; couleurs, polices, graisses, interlignes calculés (`getComputedStyle`, `__style`) ;
  icônes (taille, `stroke-width`), bordures, rayons, ombres, barres de défilement, états de survol
  (`computer` hover puis `zoom` sur la zone).
- **Image contre image** : `png_diff.py diff <capture.png> <clone.png> --out ecarts.png` (même format, même
  DPR) donne le nombre de pixels différents, la boîte et les zones touchées ; 0 pixel au-dessus du seuil ET
  tailles identiques est une preuve forte (tailles différentes sans `--zone` : code 1 et
  `"taillesDifferentes": true`, seule la partie commune a été comparée), et c'est ainsi qu'un décalage de
  52 px à 375 px a été trouvé sur l'essai web. **Dump contre dump** : le clone passé dans le même kit de
  capture (mode raw) se compare ligne à ligne au `dom-*.html` (`methode.md` §6).
- Tolérance ±2 px ; ignorez les artefacts JPEG. Un écart sans mesure n'est pas un écart.

### 4.2 Textes, caractère par caractère
- **Tous** les textes, visibles ou cachés (panneaux repliés, infobulles, menus, modales), plus `placeholder`,
  `aria-label`, `alt`, `title`, valeurs d'exemple, et le titre de l'onglet ou de la fenêtre.
- Ce qui se rate à l'œil : accents et majuscules, apostrophe droite ' contre typographique ’, points de
  suspension … contre ..., espaces insécables U+00A0 (avant « : ») et fines U+202F (dans « 1 007 »), ordre des
  éléments, format des nombres, des dates et des devises.
- Méthode outillée (`methode.md` §4) : `textes.py capture dom-page.html` d'un côté, `__textes('<zone>')` dans
  le clone de l'autre, puis `textes.py diff` — il affiche chaque écart avec les codes U+XXXX. Les lignes de
  données (noms, montants) sont fictives par construction : comparez leur **format** (`--masquer-chiffres`),
  pas leurs valeurs.

### 4.3 Comportement et robustesse
- Chaque interaction listée dans « Interactions observées » de `notes.md` produit le même effet : onglets,
  menus (un seul ouvert, Échap, clic extérieur), modales et tiroirs, filtres, tri, recherche, pagination,
  accordéons, infobulles, repli de la navigation.
- **Console** (`read_console_messages`, ou en headless `cdp_eval.py nav --console` au chargement et
  `eval --console` pour une interaction) au chargement et après chaque interaction : zéro erreur ; les
  avertissements se justifient un par un.
- Aucun `alert()`/`confirm()`, aucune requête réseau vers l'original ou une API ; mémorisation seulement des
  choix explicites de l'utilisateur (pas d'un état automatique comme « barre repliée sur petit écran »).
- Vidéos intégrées : l'iframe se charge à l'ouverture et se décharge à la fermeture (sinon le son continue,
  vu sur iClosed) ; `allow="autoplay; fullscreen"` sans `allowfullscreen`, qui produit un avertissement console.
- **Petits écrans** (web) : 375 px et 768 px, aucun défilement horizontal de page (`__debord` donne les
  coupables), navigation utilisable.
- Liens : chaque lien de la page mène à une page locale existante (contrôle complet au §9).

### 4.4 Confidentialité et règles
- `scan_pii.py` sur les fichiers du clone (commande au §9) : emails, téléphones, IBAN, cartes, clés, jetons,
  chemins locaux qui contiennent un nom de session (`C:\Users\<nom>`, `/Users/<nom>/`). Il ne lit pas les
  **images** : regarder soi-même chaque image versée dans le clone (icônes recadrées d'une capture).
- Seules les valeurs choisies par l'utilisateur restent réelles. Les téléphones fictifs viennent de la plage
  réservée à la fiction (`+33 6 39 98 xx xx`) : un « 06 12 34 56 78 » appartient à quelqu'un, et les numéros
  anonymisés par le kit de capture gardent leurs premiers chiffres — tous deux doivent être remplacés.
- Réseau (`read_network_requests`, `__reseau` relancé **après** les interactions) : aucune requête vers les API
  de l'original ; les ressources statiques liées depuis l'original ne sont admises que si le GUIDE les accepte
  (écart accepté).
- Aucun formulaire de connexion ou de paiement fonctionnel : `__formulaires` ne regarde que les éléments `<form>`
  (`action`, mot de passe, carte) ; un écran fait de `div` + JS (champ mot de passe hors `<form>`, envoi par
  script) se vérifie par `__reseau` après avoir cliqué « Se connecter » / « Payer », et dans la source :
  `grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.credentials" "$CLONE"` (résultat attendu :
  vide, hors bibliothèques publiques chargées par CDN). Secrets affichés masqués (`sk_live_••••3f9a`) ; aucune
  capture brute (`dom-*.html`, images d'origine) copiée dans le dossier servi.
- Le clone reste **local et personnel** (`copier-une-appli/references/regles.md` §1) : marques et logos
  appartiennent à l'éditeur. Vérifier n'est pas préparer une mise en ligne ; si l'utilisateur veut publier,
  la bonne voie est une interface inspirée, avec sa propre marque.

---

## 5. Rapporter un écart (relecteur)

Un écart = **une** cause, avec sa preuve et son correctif :

```json
{ "id": "mp-03", "page": "/app/settings/general", "severity": "medium",
  "title": "Cartes de statistiques 8 px trop hautes",
  "original": "01-haut.png : carte de 132 px (y 214 → 346) ; notes.md : h-[132px]",
  "clone": "getBoundingClientRect : 140 px (y 214 → 354), padding 20 px au lieu de 16",
  "fix": "remplacer p-5 par p-4 sur .stat-card (app/settings/general/index.html l. 88)" }
```

- `severity` : `high` = visible ou cassé ; `medium` = visible en comparant ; `low` = finition.
- Preuve obligatoire : fichier de capture et/ou mesure. « Ça me semble plus grand » n'est pas une preuve.
- Ne signalez pas : les écarts < 2 px, les artefacts JPEG, les écarts acceptés, les points refusés en passe 1
  (sauf preuve **nouvelle et plus forte**), vos préférences (« ce serait plus joli »).
- Un relecteur ne modifie **aucun** fichier : s'il corrige, le vérificateur adverse ne peut plus juger.

Schémas JSON complets (FINDINGS, VERDICTS, VERIFY) : `methode.md` §5 — les mêmes que le script Workflow.

---

## 6. Le vérificateur adverse

Son rôle n'est pas de confirmer : c'est d'essayer de **réfuter** chaque écart, indépendamment.

1. Relire lui-même les images et le DOM de capture cités (zoom sur la zone exacte).
2. Re-mesurer lui-même le clone dans **son** onglet, au bon viewport, état propre.
3. Lire la source du clone à l'endroit du correctif proposé.
4. Décider : l'écart est **réel** seulement s'il est visible ou mesurable par rapport à l'**original** (pas
   aux suppositions du relecteur), s'il n'est pas un écart accepté, s'il ne contredit pas une règle du plugin,
   et si le correctif rapproche vraiment le clone sans rien casser ailleurs (autres états, 375 px).
5. **En cas de doute : `real=false`.** Preuve ambiguë, capture qui ne montre pas la zone, mesure dans la
   tolérance → réfuté, avec la raison.
6. S'il est réel : `refined_fix` exact et vérifié (classe, valeur CSS, ligne), pas une reformulation.

Pourquoi « réfuté par défaut » : les coûts ne sont pas symétriques. Un faux correctif abîme une page validée
et oblige la passe suivante à le défaire ; un vrai écart rejeté à tort a encore deux chances d'être retrouvé
(deuxième passe, contrôle final). Pièges à éviter : approuver parce que le relecteur était affirmatif ;
réfuter sans avoir mesuré ; « confirmer » un écart en mesurant un autre état ou un autre viewport.

---

## 7. Corriger

- On n'applique que des écarts **confirmés** (par le vérificateur lui-même en passe simple, par l'adverse en
  passe adverse), et seulement dans son périmètre (pages de l'unité). La coque, les données fictives
  partagées et les fichiers de section ont un propriétaire unique : décrivez le besoin dans `shellIssues` /
  `sectionIssues` — fichier, problème observé, changement proposé, pages concernées.
- Après **chaque** correction : re-mesurer ce qui était faux, puis vérifier l'absence de régression (autres
  états de la page, 375 px, console).
- Tenez la liste : vérifié (`checked`), corrigé (`fixed`), restant (`remaining`, avec la raison).

---

## 8. La deuxième passe

Elle refait **tout** le contrôle de son angle depuis la capture, comme si la première n'avait pas existé.
Elle reçoit en plus : les écarts confirmés et corrigés en passe 1 (à re-mesurer : une correction peut ne pas
avoir pris, ou avoir cassé autre chose), et les écarts refusés (à ne rouvrir qu'avec une preuve nouvelle).
Elle cherche spécialement les **régressions** introduites par les corrections : décalages en cascade,
états oubliés, petits écrans.

---

## 9. Contrôle final du site

Quand toutes les unités ont passé leurs deux vérifications. Ordre conseillé :

1. **Inventaire** : toutes les pages présentes (Glob `**/index.html`) contre la liste attendue (inventaire de
   reconnaissance, résultats de construction). Une page manquante est un écart, pas un détail.
2. **Pages et liens** (HTML statique, CSS, chemins écrits dans le JS) :
   ```bash
   python3 "$OUTILS/check_links.py" --root "$CLONE" --base http://localhost:<PORT> --original <hôte de l'original> --out "$TRAVAIL/verif/liens.json"
   ```
   (Sans `--base`, contrôle sur disque seulement.)
   **Livraison partielle** (une page, une section) : les liens de navigation vers les pages non construites
   ne sont pas des défauts du livrable ; `--hors-perimetre app/settings,app/affiliate` (ou `@fichier`) les
   classe à part et les liste, et le compte rendu dit lesquels restent à construire.
   Code 0 = tout répond ; 1 = page ou lien cassé ; 2 = usage ou serveur injoignable. Cassés « [JS] » : chemins
   trouvés dans une chaîne JavaScript, à confirmer dans le rendu. Avertissements : `casse-differente` (marche
   sous Windows et macOS, cassé sous Linux et sur un hébergement sensible à la casse), `ancre-introuvable`,
   `reference-original`, `contenu-different` (le port sert un autre dossier !), `servi-hors-disque` (repli SPA
   qui masque un lien cassé). Chemins du disque local (`C:\…`, `file:`, `/Users/<nom>/Desktop/…`) : cassés,
   avec cette raison.
3. **Liens générés à l'exécution** (menus construits par la coque) : sur chaque page, ouvrir les menus puis
   `__liens()` ; réunir les résultats dans un JSON et relancer `check_links.py … --urls-file liens-rendus.json`.
   Le résultat s'écrit tel que `javascript_tool` le renvoie (chaîne JSON), une liste de listes (une par page)
   est acceptée ; un fichier illisible donne l'avertissement `urls-file-vide`, pas un faux « tout va bien ».
4. **Chaque page** dans le navigateur : console propre, élément actif de la navigation correct, en-têtes de
   section cohérents d'une page à l'autre, pas de défilement horizontal (viewport de référence et 375 px).
5. **Confidentialité** :
   ```bash
   python3 "$OUTILS/scan_pii.py" --root "$CLONE" --allow "<email gardé>" --allow-domain "exemple.*" --out "$TRAVAIL/verif/pii.json"
   ```
   Ajoutez `--deny-file noms-reels.txt` si la capture a relevé de vrais noms (ceux passés à `__addNames`) :
   aucun ne doit réapparaître. Code 0 = rien trouvé ; 2 = erreur d'usage ; 1 = quelque chose à trier (tableau
   au §7 de `methode.md`, rapport : secrets, cartes et IBAN y sont masqués) : valeur réelle →
   remplacer par une valeur fictive ; texte d'exemple de l'interface d'origine (placeholder) → le garder,
   l'autoriser avec `--allow` et le noter ; fictif hors plage de fiction → le remplacer.
6. **Réseau** : aucune requête vers l'API de l'original (`__reseau` après les interactions,
   `read_network_requests`) ; aucun envoi écrit dans le JS (`grep` du §4.4).
7. **Propreté** : aucun fichier de travail dans le dossier servi (captures, dumps, journaux, scripts de
   vérification) — aucun outil ne le vérifie, d'où cette commande (résultat attendu : vide) :
   ```bash
   find "$CLONE" \( -name 'dom-*.html' -o -name 'uia-*.json' -o -name 'notes.md' -o -name 'GUIDE.md' \
     -o -name '*-console.json' -o -name '*.log' -o -name '.DS_Store' -o -name 'graphique-*.txt' \) -print
   ```
   Aucun chemin `C:\…`, `/Users/<nom>/…` ou `file:` (signalés par `check_links.py` et `scan_pii.py`).
8. Corrigez les pages ; tout ce qui touche la coque ou une section va dans `shellIssues` / `sectionIssues`,
   puis relancez les deux outils pour montrer le résultat final.

---

## 10. Rendre compte honnêtement

Le rapport sert à décider : livrer, corriger encore, ou accepter un écart. Il doit donc dire ce qui a été
**mesuré**, ce qui a seulement été **regardé**, et ce qui n'a **pas** été vérifié.

- Sortie structurée d'une passe : `checked`, `fixed`, `remaining`, `shellIssues`, `sectionIssues`, `notes`
  (schéma VERIFY). En passe adverse : écarts confirmés, refusés (avec la raison), corrigés.
- Pour l'utilisateur : **Vérifié** (pages × états × angles, viewport) / **Corrigé** (nombre, exemples) /
  **Écarts restants** (chacun avec sa raison : choix assumé, limite technique, à faire) / **Non vérifié** (et
  pourquoi) / résultats bruts des outils (codes de sortie, nombres). Modèle : `methode.md` §10.
- Jamais « identique », « pixel-perfect » ou « aucun problème » sans les mesures qui le montrent ; jamais un
  écart corrigé annoncé sans avoir été re-mesuré ; jamais un outil « passé » s'il n'a pas été lancé.
- Un relecteur, un vérificateur adverse ou un correcteur qui n'a rien renvoyé (agent interrompu, résultat
  `null`) n'a **pas** vérifié : on le compte « non vérifié », jamais « 0 écart » (`lecons.md` I3).
- Un écart restant assumé (image liée depuis l'original, police de remplacement, raccourci clavier réservé
  au navigateur) se dit comme tel, sans le noyer.

---

## 11. Critères de fin

**Passe d'unité** : chaque page et chaque état capturé comparés sur les quatre angles au viewport de référence ;
`scrollHeight` du conteneur principal à ±2 px de l'original ou écart expliqué ; textes identiques au caractère
près (hors données fictives) ; interactions capturées reproduites ; console sans erreur ; aucun défilement
horizontal à 375 px (web) ; corrections re-mesurées ; besoins hors périmètre décrits dans `shellIssues` /
`sectionIssues`.

**Contrôle final** : toutes les pages attendues présentes ; `check_links.py` code 0 (ou chaque cassé restant
expliqué) avec les liens rendus inclus ; `scan_pii.py` code 0 avec une liste blanche limitée à ce que
l'utilisateur a choisi de garder ; aucune requête vers l'original hors écarts acceptés ; rapport rédigé.

---

## 12. Pièges fréquents

| Symptôme | Cause | Solution |
|---|---|---|
| Hauteurs différentes d'une mesure à l'autre | squelettes de chargement, polices pas prêtes | attendre `data-shell="ready"`, `document.fonts.ready`, ~1,5 s |
| Un « écart » qui disparaît au rechargement | état mémorisé par un test précédent | `localStorage.clear()` + rechargement avant de mesurer |
| Mesures incohérentes entre agents | quelqu'un a rechargé ou redimensionné votre onglet | un onglet par agent, toujours son `tabId` |
| Tout est décalé d'un facteur 1,25 ou 2 | image en pixels physiques, DPR ou échelle Windows | px CSS = px image ÷ DPR (÷ échelle pour `uia-*.json`) |
| `check_links.py` : pages en 404 et `contenu-different` | le port sert un autre dossier (autre agent, autre serveur) | vérifier le processus qui écoute ; choisir un port libre |
| Requêtes très lentes vers `localhost` | Windows essaie IPv6 d'abord | géré par `check_links.py` ; ailleurs, préférer `127.0.0.1` |
| Lien cassé invisible pour `check_links.py` | lien fabriqué par le JS (`'/app/' + clé`) | `__liens()` dans le rendu, puis `--urls-file` |
| Lien « OK » qui mène à la mauvaise page | serveur à repli SPA qui répond 200 partout | `servi-hors-disque` dans le rapport ; ouvrir la page |
| Lien qui marche sous Windows et macOS seulement | casse différente (`/App/…`) | avertissement `casse-differente` : aligner sur le disque |
| `scan_pii.py` signale des numéros dans des données | identifiants, graduations | `aVerifier` / `--seuil haute`, ou valeur fictive de la plage de fiction |
| Relecteur qui signale 30 écarts | comparaison à ses goûts, pas à l'original | preuve exigée, vérificateur adverse, `real=false` si doute |
| Profil headless impossible à supprimer | les processus enfants de Chrome gardent le profil 10 à 20 s après l'arrêt | `headless.py fermer` (attend jusqu'à 60 s) ; sinon donner le chemin restant |
| Page chargée à la mauvaise disposition (barre repliée, colonnes) | fenêtre redimensionnée après le chargement, ou petit écran < 500 px | taille d'abord (`headless.py lancer --viewport`), puis `nav --viewport LxH` (`methode.md` §2) |
| Hauteurs de 1–2 px différentes partout | clone mesuré à DPR 1, capture à 1,25 (ou 2 sur un Mac Retina) | `--viewport LxH@1.25` (ou `@2`) |
| `textes.py` : « ~ nombre different » sur un attribut | même `aria-label` répété un autre nombre de fois | à regarder, rarement un défaut (`methode.md` §4) |
| `check_links.py` échoue sur une livraison d'une seule page | liens vers des pages non construites | `--hors-perimetre` (§9) |

---

## Renvois

- `references/methode.md` — fonctions de mesure, comparateur de textes, Chrome headless, schémas, gabarits de
  prompts, tri des rapports, logiciels de bureau, modèle de rapport.
- `copier-une-appli/references/orchestration.md` — place des vérifications dans le déroulé, option
  `verifAdverseUnites`, remontée `shellIssues` / `sectionIssues`.
- `copier-une-appli/references/lecons.md` — H1 à H5 (agents parallèles, squelettes, vérificateurs qui
  inventent), I3 (passe « sans écart » d'un agent interrompu), D1 (nombres fr-FR), C2/C3 (barre de
  défilement, icônes), E1 (vidéos), J2 à J5 et J9 (états de la coque, petits écrans, noms UIA, taille de
  fenêtre, images en headless).
- `reconstruire-appli/references/fidelite.md` — principe de mesure, palette, pièges CSS, bureau (§11),
  scripts de contrôle (§12).
