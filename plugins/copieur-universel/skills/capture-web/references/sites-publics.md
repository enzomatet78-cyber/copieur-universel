# Capturer un site ou une appli publique

Pour tout ce qui s'affiche **sans compte** : site vitrine, page de tarifs, documentation, démo publique, parties
publiques d'une appli. On travaille sur un **profil de navigateur vierge et temporaire** : on voit exactement ce
que voit un visiteur, et rien ne touche aux sessions de l'utilisateur. `OUTILS` = dossier `outils/` du plugin
(voir SKILL.md) ; `CAP` = dossier de la page dans `<TRAVAIL>\capture\<unité>\<slug>\`.

Sommaire : 1. Règles propres aux sites publics · 2. Option A : Chrome/Edge headless + cdp_eval.py · 3. Option B :
navigateur intégré · 4. Secours sans cdp_eval.py · 5. Pièges

---

## 1. Règles propres aux sites publics

- **Aucun compte** : ne se connecter à rien, ne créer aucun compte, ne soumettre aucun formulaire (contact,
  newsletter, essai gratuit, devis). Si le contenu voulu est derrière une connexion, c'est le mode connecté
  (`chrome-connecte.md`) avec le compte de l'utilisateur, ou rien.
- **Interactions permises** : celles qui ne changent que l'affichage local — onglets, menus, accordéons,
  carrousels, survols, défilement, et sur ce profil temporaire sans compte une case ou un bouton qui ne fait que
  basculer un état d'affichage (« Marquer comme terminé » d'une liste de démonstration). Condition : rien n'est
  envoyé. Comparer `performance.getEntriesByType('resource').length` avant et après le clic ; si une requête
  est partie vers le site, s'arrêter là, le noter, et ne plus cliquer ce type d'élément. Dans le doute, ne pas
  cliquer et décrire.
- **Bandeaux de cookies** : ne jamais cliquer « Accepter ». Prendre une image du bandeau (`01-bandeau-cookies.png`,
  il fait partie de ce que voit un visiteur), puis le **masquer localement** pour les images suivantes
  (`document.querySelector('<sélecteur du bandeau>').style.display = 'none'`), ce qui ne donne aucun
  consentement. Si le bandeau bloque toute la page et ne se masque pas, choisir « Refuser » / « Continuer sans
  accepter ».
- **Aucun contournement** : CAPTCHA, page de vérification anti-robot, paywall, limite de débit, blocage
  géographique → noter la page « not-accessible » et passer. Ne pas changer l'agent utilisateur ni masquer le mode
  headless pour passer une protection : c'est précisément du contournement. On peut proposer à l'utilisateur
  d'ouvrir lui-même la page dans son navigateur, mais l'agent ne résout jamais de vérification.
- **Pas de crawl** : seulement les pages de l'inventaire, une à la fois, avec quelques secondes entre deux pages.
  Jeter un œil à `/robots.txt` : s'il exclut les robots d'une section, ne pas la capturer automatiquement.
- **Ne rien télécharger pour redistribuer** : images, polices, vidéos restent chez l'original (le clone peut les
  référencer par URL pour un usage personnel ; voir `reconstruire-appli`).
- Les données personnelles affichées publiquement (témoignages, équipe, avis) restent des données de tiers :
  `__addNames` + `__anonLive` comme ailleurs. Les noms de l'entreprise et de ses produits peuvent rester.

---

## 2. Option A (recommandée) : Chrome ou Edge headless + `cdp_eval.py`

Avantages : les images et les dumps sont **écrits directement sur disque** (aucun morceau à recopier, aucun
filtre de sortie), le kit est réinjecté gratuitement à chaque appel, le viewport est fixe et reproductible.

### 2.1 Lancer le navigateur (agent principal, une fois)

Toujours avec un `--user-data-dir` **temporaire et neuf** : sans lui, Chrome confierait la commande au Chrome déjà
ouvert de l'utilisateur (son profil, ses sessions) et le port de débogage ne s'ouvrirait pas (Chrome refuse
d'ailleurs le débogage à distance sur le profil par défaut).

L'outil `headless.ps1` fait tout cela d'un coup (testé avec Chrome 154 et Edge 155) : profil neuf
`%TEMP%\cu-<navigateur>-xxxxxxxx`, port libre (ou celui demandé, refusé s'il est déjà occupé : les commandes
partiraient chez un autre navigateur), lancement en `--headless=new`, attente du port, viewport réglé par
`cdp_eval.py size` :
```
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\headless.ps1" -Action lancer [-Navigateur edge] [-Port 9333] [-Viewport 1536x791] [-Echelle 1.25] [-Langue fr-FR]
→ {"ok":true,"navigateur":"chrome","port":9333,"pid":…,"profil":"C:\\…\\Temp\\cu-chrome-1a2b3c4d","viewport":"1536x791"}
```
**Noter `port` et `profil`** : ils servent à toutes les commandes et à la fermeture (§2.4). `-Echelle 1.25`
rend la page au facteur d'un écran à 125 % (`devicePixelRatio` 1,25) quand les mesures doivent tomber comme
sur la capture. Un profil neuf charge quand même les extensions imposées par la machine (stratégie
d'entreprise) : `list` montre alors des cibles `service_worker`, `background_page` ou `browser_ui` en plus de
la page ; les ignorer.

Sans l'outil (cmd, profil neuf à chaque lancement, à noter) :
`start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9333 --user-data-dir="%TEMP%\cu-chrome-1" --window-size=1554,887 --no-first-run about:blank`
puis `py "%OUTILS%\cdp_eval.py" --port 9333 --wait-port 15 size --viewport 1536x791` : la fenêtre headless
retire une marge à `--window-size`, différente selon le navigateur, que `size` corrige d'après le viewport
mesuré (réglage persistant). (macOS/Linux : même options, `--user-data-dir="$(mktemp -d)"`.)

**Petit écran** : une fenêtre headless ne descend pas sous ~500 px de large (`size --viewport 375x812` donne
504×812, avec un avertissement). Garder cette fenêtre et passer la taille à chaque commande :
```
py "%OUTILS%\cdp_eval.py" --port 9333 nav  --url "<URL>" --viewport 375x812 --wait 3    chargement à 375 px
py "%OUTILS%\cdp_eval.py" --port 9333 shot --viewport 375x812@2 --out "%CAP%\60-mobile-375.png"
py "%OUTILS%\cdp_eval.py" --port 9333 eval --viewport 375x812 --file "%OUTILS%\capture-kit.js" --expr "(__config({raw:true}), __dump('body', 8))" --out "%CAP%\dom-375.html"
```
`nav --viewport` compte : une appli qui décide de sa disposition **au chargement** (barre repliée sous 768 px)
ne se met pas toujours à jour quand la fenêtre change ensuite. Seule la taille change, pas l'agent utilisateur
ni le tactile (une page qui détecte le mobile par l'agent utilisateur restera en version bureau — le noter).

### 2.2 Commandes `cdp_eval.py`

Interface de l'outil (`py "%OUTILS%\cdp_eval.py" <commande> --help` en cas de doute) :
```
py "%OUTILS%\cdp_eval.py" --port 9333 [--wait-port 10] list
py "%OUTILS%\cdp_eval.py" --port 9333 size --target <…> --viewport 1536x791
py "%OUTILS%\cdp_eval.py" --port 9333 nav  --target <…> --url <URL> [--wait 3] [--viewport 375x812] [--console]
py "%OUTILS%\cdp_eval.py" --port 9333 eval --target <…> [--file <fichier.js>] [--expr "<JS>"] --out <fichier> [--viewport …]
py "%OUTILS%\cdp_eval.py" --port 9333 shot --target <…> --out <image.png> [--full | --selector "<CSS>"] [--viewport LxH@1.25]
py "%OUTILS%\cdp_eval.py" --port 9333 hover --target <…> --selector "<CSS>" [--out <image.png>] [--leave]
py "%OUTILS%\cdp_eval.py" --port 9333 console [--out console.json]          messages déjà émis par la page
py "%OUTILS%\cdp_eval.py" --port 9333 close --target <…>                    fermer un onglet en trop
```
`--viewport` ne vaut que le temps de la commande (le réglage disparaît avec la connexion) : le répéter à chaque
appel. `nav --console` relève erreurs, avertissements et requêtes en échec du chargement (code 4 avec
`--strict` s'il y a des erreurs).
- `--target` : indice affiché par `list`, identifiant de cible, ou morceau d'URL ou de titre. Travailler dans
  **un seul onglet** : comme dans un Chrome visible, un onglet passé en arrière-plan peut être gelé (constaté en
  headless sur une SPA : `eval` sans réponse, image à moitié dessinée). Avec un seul onglet, `--target 0`
  suffit. S'il y en a plusieurs (une commande `new`, un lien qui ouvre un onglet), Chrome liste en général la
  page la plus récente en premier : viser alors un morceau d'URL (`--target "/tarifs"`) ou l'identifiant, et
  fermer l'onglet en trop (pièges, §5).
- `eval` évalue d'abord le fichier, puis l'expression ; les promesses sont attendues ; un résultat chaîne est
  écrit tel quel (UTF-8), un objet en JSON. D'où le **mode raw** du kit : `__config({ raw: true })` → `__dump`,
  `__styles`, `__icons`, `__chart(i)` renvoient la chaîne complète, sans échappements ni morceaux. La
  configuration est gardée dans l'onglet ; la répéter ne coûte rien. L'expression peut enchaîner plusieurs
  appels avec la virgule `(__config({ raw: true }), __dump('main', 8))` ou le point-virgule
  `__config({raw:true}); __dump('main', 8)` : c'est la dernière valeur qui est écrite (les deux formes testées).
- `shot --selector "<CSS>"` capture un seul élément (l'équivalent d'un zoom sur un détail).
- Codes de sortie : 0 succès ; 1 connexion, cible ou argument (message en français qui dit quoi faire) ;
  2 exception JavaScript (ex. `__dump is not defined` : `--file capture-kit.js` oublié) ; 3 délai dépassé
  (page bloquée : augmenter `--timeout`, ou recharger l'onglet par `nav`).
- Un appel du kit qui ne trouve pas sa racine renvoie un texte (`racine introuvable : …`, `aucune modale
  ouverte`) avec le code 0 : il finit dans le fichier `--out`. Regarder la taille annoncée (« N caractères
  écrits ») avant de passer à la suite.

Déroulé d'une page, en Git Bash (remplacer `$OUTILS` et `$CAP` par les chemins absolus, entre guillemets ; les
variables du shell ne survivent pas d'un appel Bash à l'autre). En cmd : `py "%OUTILS%\cdp_eval.py" …`.
```bash
py "$OUTILS/cdp_eval.py" --port 9333 nav  --target 0 --url "https://exemple.org/tarifs" --wait 4
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "(__config({ raw: true, keep: [] }), __info())" --out "$CAP/info.json"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "__guessNames()"
# résultat affiché dans la console, jamais écrit dans le dossier de capture (ce sont de vrais noms) ; le relire, puis :
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "(__addNames(['Prénom Nom', 'Autre Nom']), __anonLive())" --out "$CAP/_anon.txt"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "__steps()" --out "$CAP/_steps.json"
py "$OUTILS/cdp_eval.py" --port 9333 shot --target 0 --out "$CAP/01-haut.png"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "(__scroll(672), __wait(800))" --out "$CAP/_scroll.txt"
py "$OUTILS/cdp_eval.py" --port 9333 shot --target 0 --out "$CAP/02-milieu.png"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "(__scroll(0), __dump('main', 8))" --out "$CAP/dom-initial.html"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "__styles('body')" --out "$CAP/../styles.css"
py "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/capture-kit.js" --expr "__icons('body')" --out "$CAP/../icones.txt"
```
Les fichiers `_*.json` / `_*.txt` sont des sorties de travail (on peut les regrouper dans `$CAP/_tmp/`).
- `shot --full` capture toute la hauteur **du document**. Si le contenu défile dans un conteneur interne
  (`main` en `overflow-y-auto h-screen`, fréquent dans les applis), la page entière est courte : faire défiler avec
  `__scroll(y)` (positions de `__steps()`) et une image par position.
- Le kit est réinjecté par `--file` à chaque `eval` ; le dictionnaire et la config survivent aux navigations dans
  le même onglet (`sessionStorage`). Après `nav`, `__anonLive()` est à refaire (nouvelle page).
- Un dump vide ou « racine introuvable » juste après `nav` : la page n'avait pas fini ; relancer avec un `--wait`
  plus long, ou vérifier `__info().scrollHeight`.

### 2.3 États

- Onglets, accordéons, menus, carrousels : un clic par expression, avec l'attente dans la même expression
  (`__wait(ms)` renvoie une promesse, que `cdp_eval.py` attend) :
  `--expr "(document.querySelectorAll('[role=tab]')[1].click(), __wait(1500))"`, puis `shot`, puis
  `__dump('main', 8)` ou `__dump('modal')` → `dom-onglet-<nom>.html`.
  Ne jamais cliquer d'envoi de formulaire, de connexion, d'achat, de téléchargement.
- **Survols et infobulles** : `cdp_eval.py hover --selector "<CSS>" --out "%CAP%\40-infobulle-<nom>.png"`
  envoie un vrai mouvement de souris (`:hover` CSS, `mouseover`/`mouseenter`, infobulles en JavaScript) et prend
  l'image pendant le survol (testé : couleur de survol et infobulle visibles) ; puis `eval … --expr
  "(__config({raw:true}), __overlays(), __dump(0))"` pour le texte exact de l'infobulle, et `hover --leave` pour
  sortir. À défaut, `el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, clientX, clientY}))` dans un
  `eval` suffit pour une infobulle pilotée en JavaScript (pas pour `:hover`).
- **États de la coque** : `__etat()` avant l'action, `__diffEtat()` après (SKILL.md §5).
- **Carrousel ou animation automatique** : relever l'intervalle (deux `__dump` à quelques secondes d'écart),
  une image et un dump par diapositive ; noter que les images de comparaison dépendent du moment.
- Graphiques : `--expr "__chart()"` (liste) puis `--expr "__chart(0)"` → `graphique-<nom>.txt`.

### 2.4 Fermer (celui qui a lancé ferme, et seulement ce qu'il a lancé)

```
powershell -NoProfile -ExecutionPolicy Bypass -File "%OUTILS%\headless.ps1" -Action fermer -Profil "<profil noté>" -Port <port>
→ {"ok":true,"restants":0,"profilSupprime":true,…}
```
L'outil quitte d'abord proprement le navigateur (`cdp_eval.py close --browser`, ce qui libère vite le profil),
puis arrête en boucle les processus **Chrome ou Edge** dont la ligne de commande contient **ce** dossier de
profil — jamais les autres : le navigateur de l'utilisateur n'a pas ce dossier —, ignore ceux déjà terminés (un
processus arrêté peut rester listé, `HasExited` vrai, port encore en écoute mais muet) et supprime le profil
jusqu'à 60 s (les processus enfants le gardent verrouillé 10 à 20 s ; chemins longs gérés). Il refuse tout
dossier qui n'est pas un `cu-*` de `%TEMP%`. Si `ok` vaut `false`, le message dit quoi faire (relancer plus
tard) et donne le chemin restant : le signaler plutôt qu'annoncer un nettoyage fait. `-Action etat -Profil …`
liste les processus encore vivants.

Pourquoi un script plutôt que des lignes PowerShell à recopier : l'outil PowerShell de Claude Code bloque
`Remove-Item` sur un chemin contenu dans une variable (et même une commande entière dont un message contient un
chemin), une boucle recopiée finissait avec le mauvais exécutable (chrome.exe alors qu'on avait lancé Edge), et
un `.ps1` enregistré sans BOM affiche des accents illisibles. Lancé avec `-File`, le script n'a aucun de ces
problèmes. Pour relancer aussitôt un navigateur, prendre un autre port.

---

## 3. Option B : le navigateur intégré

Utile pour explorer, voir les survols et infobulles, tester un petit écran (`resize_window { preset: 'mobile' }`
émule aussi l'agent utilisateur et le tactile), ou quand `cdp_eval.py` n'est pas disponible.

- Charger le skill du navigateur intégré s'il est proposé (`built-in-browser`), puis ses outils
  (`mcp__Claude_Browser__*`) en une seule recherche.
- **Son propre onglet** : `preview_start { url }` ou `tabs_create` + `navigate`, toujours passer son `tabId`,
  `resize_window { width, height, tabId }` au viewport de référence, fermer l'onglet à la fin. D'autres agents
  peuvent travailler dans d'autres onglets : ne jamais y toucher. Si le nombre maximal d'onglets est atteint,
  passer à l'option A.
- Kit : comme dans Claude in Chrome — contenu du fichier passé à `javascript_tool` (`kit ok`), réinjection courte
  ensuite, **mode par défaut** (morceaux échappés, récupération et décodage : `chrome-connecte.md` §7, même
  commande). Mesuré dans le navigateur intégré : pas de filtre de sortie, une chaîne de 20 000 caractères revient
  entière. On peut donc agrandir les morceaux pour faire moins d'allers-retours : `__config({ chunk: 18000 })`,
  puis un morceau par appel (`window.__D.slice(0, 1)`, `(1, 2)`…), chaque réponse étant un paquet JSON à décoder.
  Garder les morceaux de 900 si une réponse revient tronquée.
- **Images** : les captures d'écran du navigateur intégré reviennent dans la conversation mais ne sont **pas
  enregistrées sur disque**. Pour les fichiers d'images de la capture, utiliser `shot` de l'option A ; à défaut,
  décrire précisément dans `notes.md` ce que montre l'image (le constructeur ne la verra pas).
- Le navigateur intégré garde ses connexions d'une session à l'autre : ce n'est **pas** un profil vierge. Si le
  site y apparaît connecté au compte de l'utilisateur, appliquer les règles du mode connecté (lecture seule
  stricte, `chrome-connecte.md` §9), ou préférer l'option A.

---

## 4. Secours sans `cdp_eval.py`

Si l'outil manque ou échoue, Chrome sait produire seul une image et un DOM brut (pas de kit, donc **ni
nettoyage ni anonymisation** : réservé aux pages sans donnée personnelle) :
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --user-data-dir="%TEMP%\cu-chrome-2" --window-size=1554,887 --virtual-time-budget=5000 --screenshot="%CAP%\01-haut.png" "https://exemple.org/"
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --user-data-dir="%TEMP%\cu-chrome-2" --virtual-time-budget=5000 --dump-dom "https://exemple.org/" > "%CAP%\dom-brut.html"
```
Testé : l'image est écrite (à la taille de `--window-size`), mais avec une page animée le processus peut ne pas
se terminer seul → l'arrêter ensuite par son dossier de profil (§2.4). Edge headless n'écrit rien sur la sortie
standard avec `--dump-dom` sur ce poste : utiliser Chrome pour ce secours, ou Edge via le port de débogage. Le
DOM brut contient scripts et attributs internes : n'en garder que la structure utile.

---

## 5. Pièges

| Symptôme | Cause | Solution |
|---|---|---|
| `list` ne répond pas, ou un onglet s'ouvre dans le Chrome de l'utilisateur | lancé sans `--user-data-dir` neuf | relancer avec un profil temporaire neuf (§2.1) |
| Viewport différent de la référence | marge de fenêtre headless (différente entre Chrome et Edge) ; largeur < 500 px impossible | `headless.ps1` règle la taille ; sinon `cdp_eval.py size --viewport 1536x791`, puis vérifier `__info()` ; petit écran : `--viewport 375x812` sur `nav`, `eval`, `shot` (§2.1) |
| Les commandes agissent sur une autre page, ou un autre navigateur répond | `--target 0` alors qu'il y a plusieurs onglets ; ou port déjà occupé par une autre capture | viser un morceau d'URL ou l'identifiant ; `headless.ps1` refuse un port occupé (§2.1, §2.2) |
| `styles.css` signale des « Feuilles illisibles (CORS) » | feuille servie par un autre domaine | Google Fonts : sans importance ; feuille du site : `nav --url <feuille>` dans le même onglet, relever les règles des classes listées, revenir à la page (SKILL.md §8) |
| `eval` dépasse le délai (code 3) ou image à moitié dessinée, alors qu'un second onglet a été ouvert | onglet passé en arrière-plan : Chrome le gèle, même en headless (constaté sur une SPA) | un seul onglet ; fermer l'autre (`cdp_eval.py close --target <id>`), puis `shot --front` sur l'onglet de travail et `nav` pour le redessiner |
| `shot --full` montre une page courte | le contenu défile dans un conteneur interne | `__steps()` + `__scroll(y)` + une image par position |
| Après `shot --full` ou `--selector`, barres de défilement absentes, largeurs décalées de 15 px | Chrome les masque pendant une capture au-delà du viewport et ne les rend pas seul | `cdp_eval.py` (1.2) les rétablit ; s'il affiche « Chrome a masqué des barres de défilement », `nav` pour recharger avant toute mesure (`lecons.md` J10) |
| Page de vérification anti-robot | protection du site | « not-accessible », ne pas contourner (§1) |
| Contenu différent de ce que voit l'utilisateur | profil vierge : pas de langue/région enregistrée, A/B test | noter la langue (`__info().lang`) ; si le site suit la langue du navigateur, essayer `--lang=fr-FR` au lancement et vérifier |
| Processus headless encore présents après la capture | seul le PID principal a été arrêté, ou arrêt plus lent que prévu | `headless.ps1 -Action fermer` (arrêt par dossier de profil, en boucle jusqu'à zéro, §2.4) |
| « Remove-Item on system path … is blocked » dans l'outil PowerShell | garde-fou de Claude Code sur un chemin en variable | `headless.ps1 -Action fermer` (lancé avec `-File`) ; à la main, chemin écrit en entier (`rm -rf "<chemin>"` sous Git Bash) |
| Images d'un autre domaine cassées en headless (`naturalWidth` 0, `responseStatus` 0) alors qu'elles s'affichent ailleurs | ressource refusée au profil headless | ne pas noter « cassée dans l'original » : vérifier dans le navigateur intégré ; ne rien contourner (agent utilisateur, en-têtes) |
| `list` montre des cibles `service_worker`, `background_page`, `browser_ui` | extensions imposées par la machine, même sur un profil neuf | les ignorer ; viser la page |
| Images de comparaison différentes d'une fois à l'autre | carrousel ou animation automatique | une image par diapositive ; en vérification, l'image juste après `nav` (§2.3) |
| Images du site absentes dans la capture | chargement paresseux (lazy) hors écran | faire défiler toute la page (`__steps()`) avant `shot`, attendre 1–2 s |
