# Méthode détaillée — vérifier une copie (skill verifier-copie)

Ce fichier donne les **outils concrets** des passes de vérification : préparer un onglet de mesure, mesurer
avec Chrome/Edge headless, les fonctions `verif.js`, le comparateur de textes `textes.py`, la comparaison
d'images `png_diff.py`, les schémas JSON, les gabarits de prompts, la lecture des rapports d'outils, le cas des
logiciels de bureau et le modèle de rapport. Le *pourquoi* est dans `SKILL.md`. `OUTILS` = dossier `outils/`
du plugin (voir SKILL.md, « Outils ») : `verif.js`, `textes.py`, `uia_rects.py`, `png_diff.py`,
`headless.ps1`, `cdp_eval.py`, `check_links.py`, `scan_pii.py` y sont, prêts à l'emploi (rien à recopier).
`<TRAVAIL>` = dossier de travail hors du clone (captures, GUIDE, résultats) ; on y range les mesures,
**jamais** dans le dossier servi du clone.

Tout ce qui suit a été exécuté sur le clone iClosed (Windows 11, Python 3.13), avec Chrome headless et avec
le navigateur intégré : mesures, textes (page Sécurité : 9 textes identiques à la capture ; une espace
insécable, une majuscule, une ligne manquante et une ligne en trop, injectées exprès, toutes détectées),
liens rendus (`/app/knowledge` du menu utilisateur, invisible dans le HTML, trouvé par `__liens()` puis
`check_links.py`), mesure d'une image de référence (bord de la barre latérale à x = 239 sur l'original comme
dans le clone).

---

## 1. Navigateur intégré : un onglet de mesure à soi

Charger les outils en une fois (ToolSearch) :
```
select:mcp__Claude_Browser__tabs_create,mcp__Claude_Browser__navigate,mcp__Claude_Browser__computer,mcp__Claude_Browser__javascript_tool,mcp__Claude_Browser__resize_window,mcp__Claude_Browser__read_console_messages,mcp__Claude_Browser__read_network_requests,mcp__Claude_Browser__get_page_text,mcp__Claude_Browser__tabs_close
```
Déroulé (toujours avec **son** `tabId`) :
1. `tabs_create` → noter le `tabId` ; `navigate` vers `http://localhost:<PORT>/<route>`.
2. `resize_window {width, height, tabId}` au viewport de la capture. Le volet du navigateur intégré réduit
   l'image d'un viewport plus large que lui (vu : copies d'écran de 800 px pour 1141 px CSS) : les mesures JS
   restent justes, mais pour comparer des images au pixel près, passer par le headless (§2, §6).
3. `javascript_tool` : `localStorage.clear(); sessionStorage.clear(); location.reload()` (état propre).
4. `javascript_tool` : contenu complet de `OUTILS\verif.js` (lu avec Read, §3) → `verif ok`. À réinjecter
   après chaque navigation ou rechargement.
5. `javascript_tool` : `await __attendre()` → vérifier `fenetre` (= viewport voulu, DPR) et `polices`. Le
   DPR du navigateur intégré suit l'échelle de Windows (1,25 mesuré ici) : sans effet sur les mesures JS
   en px CSS, mais ses captures d'écran sont agrandies d'autant.
6. Mesurer (`__mesures`, `__style`, `__textes`…), comparer avec `computer` screenshot / `zoom` et les images
   de capture (Read), lire la console (`read_console_messages`, `onlyErrors: true` puis tout).
7. Survols : `computer` action `hover` sur l'élément, puis `zoom` sur la zone ; on ne simule pas `:hover` en JS
   (en headless : `cdp_eval.py hover`, vrai mouvement de souris, §2).
8. Fin : `tabs_close` de **son** onglet. Ne jamais toucher aux onglets des autres agents.

Un résultat volumineux (`__textes` d'une longue page) revient dans la conversation : l'écrire tel quel dans un
fichier (Write) pour `textes.py diff`, ou passer par Chrome headless (§2), qui écrit directement sur disque.
« Tel quel » veut dire avec ses guillemets : `javascript_tool` renvoie une chaîne JSON, que `textes.py` et
`check_links.py --urls-file` savent décoder.

---

## 2. Chrome/Edge headless + `cdp_eval.py` (sans navigateur intégré, ou pour écrire sur disque)

Profil **temporaire** (jamais le profil de l'utilisateur), port libre, et on ne ferme que ce qu'on a lancé :
`headless.ps1` s'en charge (testé avec Chrome 154 et Edge 155).
```
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\headless.ps1" -Action lancer -Viewport 1536x791 [-Navigateur edge] [-Echelle 1.25]
   → {"ok":true,"port":61234,"profil":"C:\\…\\Temp\\cu-chrome-1a2b3c4d","viewport":"1536x791",…}     noter port et profil
py "%OUTILS%\cdp_eval.py" --port <port> nav  --url "http://localhost:<PORT>/<route>" --wait 2 --console "<TRAVAIL>\verif\<page>-console.json"
py "%OUTILS%\cdp_eval.py" --port <port> eval --file "%OUTILS%\verif.js" --expr "__attendre()" --out "<TRAVAIL>\verif\attente.json"
py "%OUTILS%\cdp_eval.py" --port <port> eval --file "%OUTILS%\verif.js" --expr "__mesures('#main', 2)" --out "<TRAVAIL>\verif\<page>-mesures.json"
py "%OUTILS%\cdp_eval.py" --port <port> eval --file "%OUTILS%\verif.js" --expr "__textes('#main')" --out "<TRAVAIL>\verif\<page>-textes.json"
py "%OUTILS%\cdp_eval.py" --port <port> nav  --url "http://localhost:<PORT>/<route>" --viewport 375x812 --wait 2
py "%OUTILS%\cdp_eval.py" --port <port> eval --viewport 375x812 --file "%OUTILS%\verif.js" --expr "__debord()" --out "<TRAVAIL>\verif\<page>-375.json"
py "%OUTILS%\cdp_eval.py" --port <port> shot --out "<TRAVAIL>\verif\<page>-clone.png"
py "%OUTILS%\cdp_eval.py" --port <port> hover --selector "<CSS>" --out "<TRAVAIL>\verif\<page>-survol.png" --leave
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\headless.ps1" -Action fermer -Profil "<profil>" -Port <port>
```
- **La taille d'abord, la page ensuite** : `headless.ps1` règle le viewport sur `about:blank` avant toute
  navigation. Une page chargée dans une fenêtre trop petite puis agrandie peut garder une disposition décidée
  au chargement (barre repliée sous 768 px). Pour la même raison, un petit écran se mesure avec
  `nav --viewport 375x812` puis `eval`/`shot --viewport 375x812` : une fenêtre headless ne descend pas sous
  ~500 px de large, et `--viewport` ne vaut que le temps d'une commande.
- **Console** : `nav --console` relève erreurs, avertissements, exceptions et requêtes en échec (404) pendant
  le chargement ; `eval --console` ceux d'une interaction ; `console` ce que la page a déjà émis. `--strict`
  → code 4 s'il y a des erreurs. Seul avertissement attendu : « cdn.tailwindcss.com should not be used in
  production ».
- **Échelle** : mesurer au DPR de la capture. Une appli de bureau capturée à 125 % se compare à un rendu
  `--viewport LxH@1.25` (ou un navigateur lancé avec `-Echelle 1.25`) : à DPR 1, les hauteurs de ligne
  s'arrondissent autrement (vu : cartes de 75 px contre 77).
- **Fermeture** : `headless.ps1 -Action fermer` quitte proprement le navigateur, arrête en boucle les seuls
  processus de **ce** profil (Chrome ou Edge), puis supprime le profil (jusqu'à 60 s : les processus enfants le
  gardent verrouillé 10 à 20 s). S'il répond `ok:false`, le dire avec le chemin restant plutôt qu'annoncer un
  nettoyage fait. Pourquoi un script : des lignes PowerShell recopiées finissaient avec `chrome.exe` codé en
  dur alors qu'on avait lancé Edge, des accents illisibles (fichier sans BOM), et l'outil PowerShell de
  Claude Code bloque `Remove-Item` sur un chemin contenu dans une variable.
- **Image pleine page** (`shot --full`, `--selector`) : Chrome masque alors les barres de défilement des
  conteneurs internes et ne les rend qu'au rechargement ; `cdp_eval.py` 1.2 les rétablit et avertit s'il n'y
  parvient pas — dans ce cas `nav` avant de mesurer, sinon `clientWidth` et positions sont décalés de 15 px.
- `cdp_eval.py eval` réévalue `verif.js` à chaque appel (rien à réinjecter) ; `--target <morceau d'URL>`
  choisit l'onglet quand il y en a plusieurs (`list` les affiche ; garder un seul onglet de préférence).
- Git Bash convertit un argument qui commence par `/` en chemin Windows (`/app/x` → `C:/Program Files/Git/app/x`) :
  écrire les routes sans `/` initial quand l'outil l'accepte, ou préfixer la commande de `MSYS_NO_PATHCONV=1`.

---

## 3. `verif.js` — fonctions de mesure (`OUTILS\verif.js`)

| Fonction | Renvoie | Sert à |
|---|---|---|
| `await __attendre(ms)` | coque prête ?, fenêtre `[l, h, DPR]`, polices chargées | mesurer une page stable |
| `__mesures(sel, prof)` | conteneur qui défile + `scrollHeight`, débordement horizontal, blocs `[desc, x, y, l, h, texte]` | §4.1 du SKILL |
| `__style(sel, props)` | styles calculés + rectangle des 8 premiers éléments | couleurs, polices, bordures |
| `__debord()` | `scrollWidth`, éléments qui font déborder la page à droite, et `rognesParUnAncetre` (ceux qu'un ancêtre `overflow` coupe : diapositive de carrousel, tableau qui défile dans son cadre — pas des fautes) | 375 / 768 px |
| `__textes(sel)` | textes bloc par bloc + attributs, espaces spéciaux gardés | §4 ci-dessous |
| `__liens()` | liens du DOM rendu, format `--urls-file` | contrôle final |
| `__reseau()` | ressources chargées hors du serveur local, par hôte | confidentialité |
| `__formulaires()` | formulaires : action, mot de passe, carte | confidentialité |
| `__image()`, `__couleur(x, y)`, `__bords(axe, pos, de, a)` | mesures dans une **image** de capture ouverte seule dans un onglet | §6 ci-dessous |

Le fichier se lit (Read) puis s'injecte tel quel dans le navigateur intégré, ou se passe à `cdp_eval.py eval
--file`. Lecture seule : il ne modifie ni la page ni ses données ; il répond `verif ok`.

---

## 4. Textes caractère par caractère — `textes.py` (`OUTILS\textes.py`)

Même découpage des deux côtés : un texte par bloc (les balises en ligne `span`, `b`, `strong`, `em`… sont
recollées ; `a`, `button`, `label` comptent comme des blocs), espaces ordinaires normalisés, **U+00A0, U+202F, U+2009 gardés**, commentaires ignorés (les
`<!-- EN: … -->` et `<!-- +12 lignes non capturées -->` des dumps ne gênent pas), SVG, scripts et styles ignorés.

```
py "%OUTILS%\textes.py" capture "<capture>\<page>\dom-page.html" > "<TRAVAIL>\verif\<page>-capture-textes.json"
   (côté clone : __textes('<zone qui correspond au dump>') → <page>-textes.json, §1 ou §2)
py "%OUTILS%\textes.py" diff "<…>-capture-textes.json" "<…>-textes.json" --attributs [--masquer-chiffres]
```
Sortie : `~` texte modifié (avec l'écart en codes, ex. `«<U+0020 SPACE>» -> «<U+00A0 NO-BREAK SPACE>»`),
`-` absent du clone, `+` en trop dans le clone, puis un bilan ; code 0 si tout est identique.
- **Zone** : le dump couvre souvent le conteneur principal ou une modale (voir l'en-tête du fichier `dom-*.html`
  et `notes.md`) ; passer à `__textes` le sélecteur de la même zone dans le clone.
- **Données fictives** : les noms et valeurs diffèrent forcément ; `--masquer-chiffres` remplace les chiffres
  par `#` pour comparer les formats (`# ###` contre `#,###`). Les lignes de tableau en trop ou en moins par
  rapport à un dump tronqué ne sont pas des écarts.
- **Attributs** (`--attributs` : placeholder, aria-label, alt, title, value) : `-`/`+` = présent d'un seul côté
  (écart) ; `~ nombre different (capture 3, clone 1)` = même texte répété un autre nombre de fois (VS Code
  répète un `aria-label` sur `li`, `a` et badge) : à regarder, rarement un défaut.
- **Contenu chargé à l'ouverture** (modale, menu, panneau d'accordéon créé par le JS) : l'ouvrir dans le clone
  avant `__textes`, sinon tout apparaît « absent ».

---

## 5. Schémas JSON (identiques au script Workflow de `copier-une-appli`)

Relecteur → `FINDINGS` :
```json
{ "findings": [ { "id": "txt-04", "page": "/app/…", "severity": "high|medium|low", "title": "…",
    "original": "ce que montre l'original + preuve (fichier de capture, mesure)",
    "clone": "ce que montre le clone + mesure", "fix": "correctif précis (fichier, classe, valeur, texte)" } ],
  "notes": "ce qui n'a pas pu être vérifié et pourquoi" }
```
Vérificateur adverse → `VERDICTS` :
```json
{ "verdicts": [ { "id": "txt-04", "real": false, "confidence": "high|medium|low",
    "reasoning": "ce que j'ai relu et re-mesuré moi-même, et pourquoi c'est réel ou réfuté",
    "refined_fix": "correctif exact et vérifié si réel ; vide si réfuté" } ] }
```
Vérificateur d'unité, correcteur, contrôleur final → `VERIFY` :
```json
{ "checked": ["/app/… (états : initial, modale X ; viewport 1536×791 et 375)"], "fixed": ["…"],
  "remaining": ["écart + raison"], "shellIssues": ["fichier, problème, changement proposé, pages"],
  "sectionIssues": ["…"], "notes": "…" }
```

---

## 6. Comparer et mesurer des images au pixel près

**Comparer deux images** — `png_diff.py` (Python standard ; testé sur les captures du clone iClosed) :
```
py "%OUTILS%\png_diff.py" diff "<capture>\<page>\01-haut.png" "<TRAVAIL>\verif\<page>-clone.png" --out "<TRAVAIL>\verif\<page>-ecarts.png" [--seuil 24] [--zone x,y,l,h] [--decalage dx,dy]
→ <page>-clone.png : 36749 pixels differents sur 304500 (12.069 %, seuil 24) ; boite x=8 y=0 l=364 h=812 ; ecart moyen …
    zone x 128-191, y 192-255 : 1450 pixels …
```
Le clone se rend **au même format** que la capture (`shot --viewport LxH@DPR` : une capture de logiciel à
125 % se compare à `--viewport 1141x658@1.25`) ; `--out` dessine les écarts en rouge sur l'original en gris.
Lire les zones touchées plutôt que le pourcentage seul : un carrousel qui a tourné, un curseur qui clignote ou
l'anticrénelage ClearType d'une appli native créent des écarts sans défaut. À l'inverse, un écart de teinte
faible passe sous le seuil par défaut (fond de survol gris-100 sur blanc : 12 unités, donc « 0 pixel » à
`--seuil 24`) : pour un survol ou une bordure pâle, comparer la zone avec `--zone x,y,l,h --seuil 6`, ou lire
l'« écart moyen par canal ». Une image identique au pixel près
(0 pixel au-dessus du seuil) est une preuve forte ; c'est ainsi qu'un décalage de 52 px du contenu à 375 px a
été trouvé sur l'essai web. Une paire pleine page prend 5 à 20 s. `png_diff.py couleur <png> x,y` donne la
couleur exacte d'un pixel ; `png_diff.py encre <png> --zone x,y,l,h` la boîte du texte ou de l'icône d'une zone
(position réelle de l'encre, utile quand un rectangle UIA ne la suit pas).

**Comparer la structure : « dump contre dump »** — passer le clone dans le **même kit** que la capture, en mode
raw, et comparer les deux fichiers ligne à ligne :
```
py "%OUTILS%\cdp_eval.py" --port <port> eval --file "%OUTILS%\capture-kit.js" --expr "__config({raw:true}); __dump('main', 8)" --out "<TRAVAIL>\verif\<page>-dump-clone.html"
fc /n "<capture>\<page>\dom-initial.html" "<TRAVAIL>\verif\<page>-dump-clone.html"      (Git Bash : diff)
```
Les seules différences attendues sont les données fictives et les attributs propres au clone (`data-*` de la
coque) ; une classe ou une balise différente est un écart à expliquer.

**Mesurer une image dans le navigateur** (alternative) : l'ouvrir seule dans un onglet, servie en local
sur un **autre port** que le clone (pas dans le dossier du clone), puis `verif.js` :
```
py -m http.server <PORT2> --bind 127.0.0.1 --directory "<capture>\<page>"      (processus à soi, arrêté à la fin)
```
Onglet → `http://127.0.0.1:<PORT2>/01-haut.png`, injecter `verif.js`, puis :
- `__image()` → taille de l'image ; `÷ fenetre` de la capture = DPR (1,25 → diviser toutes les mesures) ;
- `__bords('x', 400, 200, 300)` → transitions de couleur le long de la ligne y = 400 entre x = 200 et 300
  (une bordure, le début d'une carte) ; `__bords('y', 700, 0, 120)` → le long de la colonne x = 700 ;
- `__couleur(600, 700)` → couleur exacte d'un pixel (fond, texte, bordure).
Exemple réel (iClosed, 1150×783, DPR 1) : `__bords('x', 400, 200, 300)` sur l'original donne
`239 rgb(231,233,232)` puis `240 rgb(249,250,252)` → bordure de 1 px gris-200 à x = 239, fond gris-50 ensuite ;
dans le clone `__style('nav')` donne `rect [0,0,240,…]`, `borderRightWidth 1px`, `rgb(229,231,235)` : conforme.
Les JPEG décalent les couleurs de quelques unités : comparer à ±6 par composante, pas à l'identique.

---

## 7. Lire les rapports des outils

### `check_links.py` (rapport `--out liens.json`)
| Champ | Contenu | Que faire |
|---|---|---|
| `resume` | pages, `pagesEnErreur`, références par source (html, css, js, rendu), `ciblesCassees`, `cassesSeulementJs`, avertissements par type, ignorés | chiffres du rapport final |
| `pagesEnErreur` | page qui ne répond pas 200 | la réparer, ou le serveur sert un autre dossier (voir `contenu-different`) |
| `cassees[]` | `cible`, `raison` (absent du disque, HTTP 404, dossier sans index, chemin `C:\`), `occurrences` (page, ligne, colonne, balise, attribut, brut), `sources` | HTML/CSS : cassé sûr → corriger le lien ou créer la page ; `["js"]` seul : vérifier dans le rendu si le chemin sert de lien |
| `horsPerimetre[]` | cibles cassées sous un préfixe `--hors-perimetre` (pages volontairement non construites) | les lister dans le rapport ; elles ne font pas échouer le contrôle |
| `avertissements[]` | `casse-differente`, `ancre-introuvable`, `reference-original` (url, nature `navigation`/`ressource`/`js`, nombre), `contenu-different`, `servi-hors-disque`, `titre-absent`, `urls-file-vide` | navigation vers l'original → lien local ; ressource → seulement si écart accepté ; `js` vers une API → à supprimer |
| `externes` | hôtes externes référencés (non visités), exemples | repérer CDN, polices, et toute fuite vers l'original |
Options utiles : `--original <hôte>` (répétable), `--urls-file` (liens rendus), `--all-html`, `--exclude`,
`--strict` (avertissements = échec), sans `--base` : disque seulement. **Livraison partielle** (une page, une
section) : `--hors-perimetre app/settings,app/affiliate` ou `--hors-perimetre @hors.txt` (une route par ligne)
classe à part les liens vers les pages non construites — code 0 si rien d'autre n'est cassé (écrire les routes
sans `/` initial sous Git Bash, qui convertirait `/app/x` en chemin Windows ; l'outil rattrape aussi ce cas).
Les occurrences donnent ligne **et colonne** : un contenu recopié d'un dump tient souvent sur une seule ligne.
Il ne visite **aucun** site externe et
refuse un `--base` non local (sauf `--allow-remote` pour un serveur à soi) ou avec un chemin
(`http://localhost:8766/app` : `--base` est la racine du serveur, `--root` le dossier qu'il sert).
`--urls-file` accepte le résultat de `__liens()` tel que renvoyé (chaîne JSON), une liste de listes (plusieurs
pages), `["/chemin", …]` ou du texte (une URL par ligne, ou `urlDePage<TAB>href`) ; s'il n'en tire aucun lien,
l'avertissement `urls-file-vide` le dit. Dans le JS, les motifs de routeur (`'/app/contacts/:id'`) et les
gabarits (`${…}`) sont ignorés : ce ne sont pas des liens.

### `scan_pii.py` (rapport `--out pii.json`)
| Champ | Contenu |
|---|---|
| `resume` | fichiers analysés / ignorés, constats par catégorie et par type, `aVerifier`, `autorises` |
| `parValeur[]` | une entrée par valeur distincte : catégorie, valeur (secrets, cartes, IBAN **masqués**), occurrences, fichiers |
| `constats[]` | type, valeur, fichier, ligne, colonne, confiance, contexte (masqué) |
| `aVerifier[]` | constats sous `--seuil haute` (ex. 16 chiffres collés sans mot « carte » autour) |
| `autorises[]` | ce que la liste blanche a laissé passer, avec la raison — à relire : la liste est-elle trop large ? |
Autorisés d'office (désactivable : `--no-builtin-allow`) : domaines d'exemple (`example.com`, `*.test`…), plages
de fiction (France ARCEP `01 99 00`, `02 61 91`, `03 53 01`, `04 65 71`, `05 36 49`, `06 39 98` ; 555-0100 à
0199 ; Royaume-Uni Ofcom, sous forme +44 : 07700 900xxx, 020 7946 0xxx, 0113…0161 496 0xxx…), cartes de test
publiées, IBAN d'exemple des documentations, numéros manifestement factices (`+33 6 00 00 00 00`).
Emails détectés aussi sous forme encodée (`&#64;`, `%40`, `mailto%3A…`, `%3C…%3E`). Catégorie `chemin` :
chemins locaux qui révèlent un nom de session (`C:\Users\<nom>`, `file:///Users/<nom>/`, `/Users/<nom>/` en
début de texte ; `Public`, `Default`, `utilisateur` sont admis) — fréquents dans ce qui vient d'une appli
Electron. Non détectés : numéros étrangers au format national sans indicatif (07911 123456 britannique), noms
de personnes (→ `--deny-file`), et tout ce qui est dans une **image** (fichiers binaires ignorés) : regarder
soi-même chaque image versée dans le clone (icônes recadrées d'une capture, `assets/img/`).
Débit mesuré : environ 0,5 Mo/s, soit une vingtaine de secondes pour un bundle de 10 Mo (`--max-size`).

Tri d'un constat :
| Constat | Décision |
|---|---|
| Donnée réelle d'un tiers (nom, email, téléphone, adresse) | remplacer par une valeur fictive (`fake-data.js`), plage de fiction pour les téléphones |
| Valeur fictive inventée hors plage (`06 12 34 56 78`, `+33 6 30 50 70 90`) | remplacer : ces numéros sont attribués à de vraies personnes |
| Numéro « anonymisé » par le kit (premiers chiffres gardés) | remplacer par la plage de fiction |
| Texte d'exemple de l'interface d'origine (placeholder, aide) | garder, `--allow "<valeur>"`, le noter dans le rapport |
| Donnée que l'utilisateur a choisi de garder (titulaire) | `--allow` — rien d'autre |
| Secret (clé, jeton, webhook, DSN) | supprimer, remplacer par une valeur masquée (`sk_live_••••3f9a`) ; un secret réel trouvé se signale aussi à l'utilisateur (à révoquer) |
| Faux positif (identifiant, graduation) | le laisser, l'expliquer ; `--seuil haute` si c'est un motif répété |
`--deny-file <noms.txt>` (un nom par ligne, sans casse ni accents) : les vrais noms relevés pendant la capture
ne doivent réapparaître nulle part.

---

## 8. Logiciels de bureau

- Référence : `uia-*.json` de `uia_dump.ps1` — racine `fenetre.position` `{x, y, w, h}`, `dpi.echelle`, arbre
  `arbre` (nœuds `ControlType`, `Name`, `AutomationId`, `BoundingRectangle` `{x, y, w, h}` relatif au cadre de
  la fenêtre, `Children`), en **pixels physiques** : px CSS = valeur ÷ `echelle`.
- Le clone se mesure comme une page web, à la taille CSS de la fenêtre d'origine (`fidelite.md` §11 de
  `reconstruire-appli` pour la barre de titre et l'échelle). Rectangles de référence en px CSS :
  `py "%OUTILS%\uia_rects.py" uia-principale.json 3 [--json]` (menus ouverts de `autresFenetres` compris), à
  comparer à `__mesures('body', 3)` du clone.
- **Images** : rendre le clone au facteur de la capture — Edge/Chrome headless (`headless.ps1`) puis
  `cdp_eval.py shot --viewport 1141x658@1.25` donne une image superposable à celle de `window_shot.ps1`
  (1426×823 pour une fenêtre de 1141×658 px CSS à 125 %) ; `png_diff.py diff` pour l'écart, `png_diff.py encre`
  pour la position réelle d'un texte ou d'une icône. Le navigateur intégré ne convient pas ici (viewport réduit
  par le volet). Mesuré sur le Bloc-notes : positions à ±1–2 px physiques ; écart moyen de 5 à 10 sur les
  barres dû à l'anticrénelage ClearType de l'original (le navigateur lisse en niveaux de gris), quasi nul
  ailleurs.
- Textes : les `Name` de l'arbre (menus, boutons, onglets, en-têtes de colonnes) contre `__textes('body')` —
  sauf en WinUI 3, où le `Name` est le nom **accessible** (« Ligne 1, colonne 1 ») et pas toujours le texte
  affiché (« Ln 1, Col 1 ») : le texte affiché se vérifie sur l'image, le `Name` dans l'`aria-label` du clone.
  Les largeurs des menus WinUI se mesurent aussi sur l'image (UIA ignore la colonne des raccourcis).
- Comportement : menus (Échap, un seul ouvert), raccourcis affichés, boîtes de dialogue ouvertes/fermées
  comme sur les images ; les raccourcis réservés au navigateur (Ctrl+W, Ctrl+N, Ctrl+T) sont une limite à dire.

---

## 9. Gabarits de prompts (outil Agent, quand on n'utilise pas le script Workflow)

Contexte commun à placer en tête : appli copiée, mode, chemin du clone et URL locale (serveur déjà lancé, ne
pas l'arrêter), GUIDE du projet (à lire d'abord), dossier de capture de l'unité, liste « gardé tel quel »,
viewport, écarts acceptés, et « Charge le skill copieur-universel:verifier-copie (ou lis son SKILL.md) ».

**Relecteur (un par angle)** — « RÔLE : RELECTEUR, angle « <MISE EN PAGE ET RENDU | TEXTES ET CONTENU |
COMPORTEMENT ET ROBUSTESSE | CONFIDENTIALITÉ ET RÈGLES> », passe n°<1|2> de <pages>. Tu ne modifies aucun
fichier. Compare chaque page et chaque état capturé au clone dans TON onglet du navigateur intégré, au viewport
<…>, avec les mesures de verif.js. Rapporte seulement des écarts concrets avec preuve (fichier de capture,
mesure) et correctif précis ; ignore < 2 px et les artefacts JPEG ; ne signale pas les écarts acceptés <…>.
[Passe 2 : déjà corrigé <liste> — vérifie que chaque correction tient ; refusé <liste> — ne le rouvre qu'avec
une preuve nouvelle.] Sortie : FINDINGS. »

**Vérificateur adverse (un par relecteur)** — « RÔLE : VÉRIFICATEUR ADVERSE. Pour CHAQUE écart ci-dessous,
essaie de le RÉFUTER : relis toi-même les images et le DOM capturés cités, re-mesure le clone dans TON onglet
(état propre, bon viewport), lis la source. Réel seulement si visible ou mesurable par rapport à l'ORIGINAL,
hors écarts acceptés, conforme aux règles, et si le correctif rapproche vraiment le clone sans rien casser.
real=false si la preuve est ambiguë. Si réel : refined_fix exact. Tu ne modifies aucun fichier. Sortie :
VERDICTS. Écarts : <JSON>. »

**Correcteur** — « RÔLE : CORRECTEUR, passe n°<n>. Applique les écarts CONFIRMÉS (refined_fix s'il existe), en ne
modifiant que <périmètre>. Après chaque correction, re-mesure et vérifie l'absence de régression (autres états,
375 px, console). Besoins hors périmètre → shellIssues / sectionIssues. Sortie : VERIFY. Écarts : <JSON>. »

**Vérificateur d'unité (passe simple qui corrige elle-même)** — relecture des quatre angles, puis correction
des écarts réels de ses pages et re-mesure ; en passe 2 : « refais tout depuis zéro, sans te fier à la
passe précédente ». Sortie : VERIFY.

**Contrôleur final** — §9 du SKILL dans l'ordre (inventaire, `check_links.py`, liens rendus, chaque page,
`scan_pii.py`, réseau, propreté), corrige les pages, signale coque et sections. Sortie : VERIFY.

---

## 10. Modèle de rapport final (pour l'utilisateur)

```markdown
## Vérification de <appli> — <date>
**Périmètre** : <n> pages, <n> états ; viewport <l×h> (+ 375 px) ; 2 passes par unité (<simple | adverse>), contrôle final.

**Résultat** : <livrable | livrable avec écarts listés | à reprendre>

### Vérifié et conforme (mesures)
- scrollHeight du conteneur principal à ±2 px sur <n>/<n> pages
- textes : <n> blocs comparés, <n> identiques (écarts restants ci-dessous)
- interactions : <liste courte> ; console : 0 erreur sur <n> pages ; 375 px : aucun défilement horizontal
- check_links.py : <n> pages, <n> références internes, <n> cassées → code <0|1>
- scan_pii.py : <n> fichiers, <n> constats → code <0|1> ; gardé tel quel : <liste>

### Corrigé pendant la vérification
- <n> écarts (dont <n> en passe 2) — exemples : <2 ou 3>

### Écarts restants (assumés ou à faire)
- <écart> — <raison : choix, limite technique, page non capturée…>

### Non vérifié
- <quoi> — <pourquoi : état non capturé, nécessite un compte, survol non reproductible…>

### Demandes de modification de la coque
- <shellIssues dédoublonnées>
```
Ne pas arrondir à la hausse : « 23 pages sur 25 vérifiées » vaut mieux que « tout est vérifié ».
