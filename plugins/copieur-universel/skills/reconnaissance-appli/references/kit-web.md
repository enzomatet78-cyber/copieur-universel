# Kit de reconnaissance web — `routes-from-bundle.js`

Référence détaillée de l'outil `$OUTILS/routes-from-bundle.js` (voir le SKILL.md pour savoir *quand* l'utiliser).
`$OUTILS` = dossier `outils/` du plugin, résolu en chemin absolu (`${CLAUDE_PLUGIN_ROOT}/outils`). Sous Windows,
`py` remplace `python3` (lanceur Python de Windows).

Le fichier est un script autonome : on l'**injecte tel quel** dans l'onglet de l'appli, il répond `"routes ok"` et
installe six fonctions sur `window`. Il est en **lecture seule** : il lit le DOM et des fichiers statiques (JS/JSON)
référencés par la page, plus quelques manifestes standard sondés (4 à 8 requêtes : `asset-manifest.json`,
`.vite/manifest.json`, `build/manifest.json`, `ngsw.json`, `_buildManifest.js` de Next ; un 404 est ignoré mais
reste dans les journaux du site) et des chunks devinés d'après les cartes du runtime, dans la limite de
`maxFiles` ; il n'appelle aucune API, ne clique rien, ne navigue pas, ne modifie pas la page.
Il faut le réinjecter après chaque navigation ou rechargement (la page repart de zéro).

---

## 1. Les six fonctions

| Fonction | Rôle | Durée |
|---|---|---|
| `__stack()` | technologies : frameworks, routeur, CSS, composants, icônes, graphiques/éditeurs, widgets tiers, polices, couleurs dominantes, variables CSS de `:root`, alertes | instantané |
| `__routes(opts)` | routes de l'appli à partir des bundles, des manifestes et des routeurs exposés | 0,1 à 5 s |
| `__routesText()` | version texte compacte (une route par ligne) du dernier `__routes` | instantané |
| `__inventory(opts)` | inventaire de l'écran affiché : navigation, liens, onglets, menus, accordéons, déclencheurs de modales, boutons à ne pas cliquer, formulaires, tableaux, infobulles, défilement | instantané |
| `__routeStatus(attendue)` | après une navigation : route finale, titre, 404 ?, écran de connexion ?, redirection ? | instantané |
| `__out(valeur, taille)` | découpe JSON/texte en morceaux ≤ 900 caractères échappés dans `window.__R` | instantané |

### Options de `__routes`
| Option | Défaut | Quand la changer |
|---|---|---|
| `prefix` | aucun | toujours quand les écrans partagent un préfixe (`'/app'`, `'/dashboard'`) : élimine le bruit |
| `maxFiles` | 120 | `300` si `sources.tronque` est vrai et que des sections manquent ; `40` suffit souvent sur un site public |
| `maxBytes` | 40e6 | rarement |
| `origins` | `[]` | bundles servis par un CDN d'un autre domaine non reconnu (ex. `['https://cdn.monappli.net']`) |
| `include3p` | `false` | jamais en pratique (analytics, chat : aucun intérêt) |
| `all` | `false` | avec un préfixe, pour voir aussi les chaînes `/…` hors préfixe |
| `detail` | `false` | pour savoir dans quel fichier une route a été vue (débogage) |
| `maxList` | 300 | listes très longues |
| `timeoutMs` | 15000 | délai par fichier lu ; à augmenter sur une connexion lente |
| `concurrency` | 6 | requêtes en parallèle ; `2` sur un site public (rythme plus humain) |

Option de `__inventory` : `max` (60 par défaut) = longueur maximale de chaque liste (liens, boutons, onglets…) ;
`__inventory({max: 150})` sur un écran très chargé.

### Ce que `__routes` lit, dans l'ordre
1. **Routeurs exposés à l'exécution** (listes complètes, les plus fiables) : `window.__BUILD_MANIFEST.sortedPages`
   (Next.js, routeur pages), `__remixManifest` / `__reactRouterManifest` (Remix, React Router 7), routeur Vue
   (`app.config.globalProperties.$router.getRoutes()` en Vue 3, `vm.$router.options.routes` en Vue 2).
2. **Manifestes** (un 404 ou une page HTML de repli est simplement ignoré) : `asset-manifest.json` (Create React
   App : tous les chunks), `.vite/manifest.json` et `build/manifest.json` (Vite, Laravel : chunks + noms des
   composants de pages), `ngsw.json` (Angular PWA), manifeste PWA (`start_url`, raccourcis).
3. **Scripts de la page** : balises `<script src>`, `modulepreload`/`preload`, ressources déjà chargées
   (`performance`), scripts en ligne.
4. **Découverte de proche en proche** dans chaque fichier lu : `import("…")`, `import … from "…"`, tableaux
   `__vite__mapDeps`, noms de chunks hachés, cartes de chunks webpack (`"static/js/"+e+"."+{…}[e]+".chunk.js"`,
   variante Next/Angular avec carte de noms) avec le `publicPath` du runtime.
5. **Extraction** dans chaque fichier : définitions `path:"…"` (React Router, Vue Router, Angular, Ember…) avec le
   `name`/`title` voisin, dictionnaires `"/chemin": [...]` (SvelteKit, manifeste Next), cibles de navigation
   (`to:`, `href:`, `navigate(`, `push(`, `redirectTo:`…), chaînes sous le préfixe, chaînes `"/…"` (sans préfixe).
6. **Noms de fichiers** : `/_next/static/chunks/app/**/page-*.js` → route (Next, routeur app), `pages/*.js` (Next,
   Nuxt 2), autres chunks hachés → « écrans présumés » (`Dashboard-Bc3d.js` → `Dashboard`).

Origines lues : celle de la page, les sous-domaines du même domaine, les origines des bundles de l'appli (CDN dont
le chemin ressemble à un build) et `opts.origins`. Les domaines tiers connus (analytics, chat, paiement, vidéo,
CDN publics de bibliothèques, bandeaux cookies) sont ignorés. Cache du navigateur utilisé (`force-cache`).

### Résultat de `__routes` (compact)
```json
{
  "ok": true, "origine": "https://app.exemple.com", "page": "/app/dashboard", "routeur": "history",
  "prefixe": "/app",
  "sources": { "manifestes": ["asset-manifest.json"], "execution": [], "scriptsInitiaux": 3, "lus": 10,
               "echecs": 0, "htmlAuLieuDeJs": 0, "refusesCors": 0, "tiersIgnores": 4, "octets": 1630,
               "ms": 675, "tronque": false },
  "compte": { "routes": 9, "relatives": 3, "liens": 3, "chaines": 1, "horsPrefixe": 1 },
  "routes":     ["/app/billing", "/app/contacts/:contactId", "..."],
  "relatives":  ["dashboard", "settings/profile", "*"],
  "aVerifier":  ["/app/settings/profile"],
  "liens":      ["/app/help", "/app/notifications"],
  "chaines":    ["/app/inbox"],
  "dynamiques": ["/app/contacts/:contactId"],
  "aEviter":    ["/app/logout", "/app/account/delete"],
  "noms":       { "/app/billing": "Facturation", "dashboard": "Tableau de bord" },
  "ecrans":     ["Charts", "Reports", "Settings"],
  "avertissements": []
}
```
Lecture, du plus sûr au moins sûr :
- `routes` : **définitions** (routeur, manifeste) → écrans réels très probables.
- `relatives` : segments enfants (`path:"dashboard"` sous un parent) ; le parent n'est pas connu avec certitude.
  `aVerifier` = préfixe + segment : **hypothèses** à confirmer en visitant.
- `liens` : cibles de navigation trouvées dans le code mais pas définies comme routes (redirections, liens
  externes à la section, anciennes routes).
- `chaines` : simples chaînes `"/…"` → bruit possible, à ne retenir que si elles ressemblent aux autres routes.
- `dynamiques` : routes à paramètre (`:id`, `[slug]`, `*`) → ne jamais inventer d'identifiant ; ouvrir un
  élément réel depuis une liste (en lecture) pour obtenir une URL valide.
- `aEviter` : routes dont un segment est un verbe d'action (déconnexion, suppression, paiement, invitation,
  annulation, `connect`/`oauth`/`callback`/`authorize`, `install`, `export`/`download`, `sync`, `approve`,
  `switch`, `send`, `share`, `publish`, `archive`, `rotate`…) : **ne pas les visiter**, même pour vérifier leur
  statut — une simple visite peut lancer un flux OAuth, un téléchargement ou changer l'espace de travail actif.
  Les pluriels (`/orders`, `/exports`) et les vues de consultation (`/order-history`) sont des listes et n'y
  figurent pas. C'est un filtre **heuristique** : un segment verbal absent de la liste se soumet à l'utilisateur
  avant toute visite.
- `noms` : libellés (souvent le titre de l'écran ou une clé de traduction) → aident à nommer les unités.
- `ecrans` : noms de composants déduits des noms de fichiers → indices d'écrans, pas des routes.

### Résultat de `__inventory` (écran courant)
`navigation` (liens des zones nav/aside/header/sidebar, `*` = actif, « (masqué) » = présent mais invisible, ex. menu
replié), `boutonsNavigation`, `liensInternes` (motifs, identifiants remplacés par `:id`, avec compteur),
`onglets` (`*` = sélectionné), `menus` (`aria-haspopup`), `accordeons` (`aria-expanded`), `etatsCandidats`
(boutons « Nouveau… », « Ajouter », « Modifier », « Filtres », « Voir »… : modales, tiroirs ou formulaires à
capturer **sans valider**), `nePasCliquer` (enregistrer, supprimer, envoyer, payer, connecter, inviter, exporter,
partager, activer, révoquer, réinitialiser, accepter, imprimer, se déconnecter, « Annuler le rendez-vous »… ;
« Annuler » seul, qui ferme une boîte, reste permis ; les boutons qui valident un formulaire ou une modale déjà
ouverte — `submit`, « Créer », « Ajouter », « OK » — y figurent avec la mention « (validation) »), `interrupteurs` (nombre de cases/switches : ne jamais les basculer), `formulaires`, `tableaux`
(colonnes + nombre de lignes), `infobulles`, `dialoguesOuverts`, `defilement` (conteneur principal et
`scrollHeight` : combien de captures pour couvrir la page), `iframes`, `titres` (h1–h3).
Les emails et téléphones sont masqués, les textes tronqués à 60 caractères. Les libellés de navigation peuvent
contenir le nom du titulaire du compte : ne pas les recopier ailleurs que dans les notes de travail.

### Résultat de `__routeStatus('/route/attendue')`
`statut` = `ok` | `redirection` | `404` | `connexion` | `chargement ?` (rien d'affiché : attendre 3–4 s et
relancer). Avec `route` (finale), `titre` (document.title exact, à reprendre tel quel dans le clone), `h1`,
`dialogues` ouverts. L'argument peut être un chemin (`'/app/x'`, `'#/x'` ou `'/index.html#/x'` compris : chemin et
route à hachage sont comparés, `#/a` → `#/b` est une redirection) ou une URL complète.
- `connexion` = champ mot de passe visible **et** (URL d'authentification : `login`, `signin`, `auth`, `sso`…,
  ou page sans navigation). Un formulaire de changement de mot de passe dans les paramètres reste `ok` et
  apparaît dans `champsMotDePasse` (ne rien y saisir).
- `404` = « 404 », « not found », « introuvable »… dans le titre ou le `h1`, ou dans une page presque vide :
  un état vide (« élément introuvable ») peut tromper ; relire `h1` avant de conclure.

---

## 2. Recettes selon le navigateur

### a) Claude in Chrome (appli connectée, navigateur de l'utilisateur) — voir aussi `capture-web`
Le filtre de sortie de l'extension tronque les longues réponses et bloque ce qui ressemble à des cookies ou à des
requêtes ; on ne sait pas toujours si une promesse est attendue. D'où ce déroulé :
1. Injecter le fichier **entier**. Il pèse environ 65 Ko (900 lignes environ) : plus que ce qu'un Read rend par
   défaut, qui s'arrête vers les deux tiers — un kit tronqué donne une erreur de syntaxe ou rien du tout.
   - Read du chemin absolu `$OUTILS/routes-from-bundle.js` avec `allow_large: true` ; à défaut, par tranches de
     400 lignes (`offset` 1, 401, 801…, `limit` 400) jusqu'à la dernière ligne, `})();` ;
   - passer à `javascript_tool` (`action: "javascript_exec"`, `tabId`) le texte **sans** les numéros de ligne
     ajoutés par Read (le nombre et la tabulation en tête de chaque ligne), toutes les lignes dans l'ordre, rien
     d'autre ;
   - la réponse doit être exactement `routes ok`. `SyntaxError`, `undefined` ou `__routes is not defined` =
     tranche manquante ou numéro resté : relire et renvoyer. Contrôle : `typeof __inventory` → `'function'`.
   Réinjection courte (testée, même principe que `capture-kit.js`) : la première fois, envelopper le texte —
   `(function (f) { try { sessionStorage.setItem('copieur-routes', '(' + f + ')()'); } catch (e) {} f(); return typeof __routes === 'function' ? 'routes ok' : 'kit absent'; })(function () {`
   en tête, le fichier, puis `});` à la fin. Après chaque navigation complète sur la même origine :
   ```js
   typeof __routes === 'function' ? 'routes ok' : ((0, eval)(sessionStorage.getItem('copieur-routes') || 'void 0'), typeof __routes === 'function' ? 'routes ok' : 'kit absent')
   ```
   `kit absent` ou erreur (autre origine, stockage vidé, `EvalError`) → renvoyer le fichier complet. Un clic qui
   ne change que la vue d'une SPA laisse le kit en place (`typeof __routes`).
2. `__out(__stack())` → nombre de morceaux, puis `window.__R.slice(0, 20)` (puis 20–40…).
3. `__routes({prefix: '/app'}); 'lance'` → puis `window.__ROUTES_STATE` toutes les 2–3 s jusqu'à `fini`.
4. `__out(__routesText())` → morceaux → `routes.txt` ; `__out(window.__ROUTES)` → `routes.json`.
5. Sur chaque écran visité : `__out(__inventory())` et `__routeStatus('/app/x')` — sur un compte réel, après
   avoir injecté `capture-kit.js` et lancé `__addNames([...])` puis `__anonLive()` dans le même onglet
   (`__inventory` lit le texte affiché, noms de personnes compris).

Pour reconstituer : concaténer les morceaux puis inverser les échappements (les mêmes que `capture-kit.js`), dans
cet ordre : `§`→`;` d'abord, `(AMP)`→`&`, `(Q)`→`?`, et `(SECT)`→`§` en dernier. Morceaux recopiés bout à bout
(contenu des chaînes, sans crochets ni guillemets) dans un fichier `.esc.txt`, puis :
```bash
python3 -c "import sys,io;s=io.open(sys.argv[1],encoding='utf-8').read();s=s.replace(chr(167),';').replace('(AMP)','&').replace('(Q)','?').replace('(SECT)',chr(167));io.open(sys.argv[2],'w',encoding='utf-8',newline='').write(s);print(len(s),'caracteres')" "$TRAVAIL/reconnaissance/routes.esc.txt" "$TRAVAIL/reconnaissance/routes.txt"
```
(méthode par paquets JSON pour les gros résultats : `capture-web/references/chrome-connecte.md` §7).

Un morceau « [BLOCKED…] » : **ne pas le redécouper aussitôt** — le filtre a vu ce qui ressemble à un cookie, un
jeton, une chaîne de requête ou du base64.
- Le relire masqué (les valeurs ne sortent pas de la page) et y chercher `cookie`, `session`, `token`, `auth`,
  une valeur après `=`, un long bloc base64 :
  `window.__R[7].replace(/=[^\s"'<>§&()]{3,}/g, '=•••').replace(/[\w+\/-]{20,}={0,2}/g, '[•••]')`
- Donnée sensible dans le texte affiché (`__inventory`) : la masquer avec `capture-kit.js` injecté dans le même
  onglet (`__mask('<sélecteur>')`, ou `__addMap` puis `__anonLive()`), puis relancer `__inventory()` et `__out`.
  Dans une chaîne de bundle (`__routes`) : laisser ce passage de côté. Noter dans `notes.md` ce qui a été masqué
  ou écarté, **jamais la valeur** : une valeur de session, un cookie ou un secret n'est jamais relevé.
- Seulement pour un faux positif (longue classe, nom de chunk haché) : le redemander en plus petit,
  `window.__R[7].slice(0, 300)`, `slice(300, 600)`…

### b) Navigateur intégré (site public, son propre onglet)
`javascript_tool` accepte `await` au premier niveau :
1. passer le contenu **entier** du fichier, lu comme en a) (Read complet, numéros de ligne retirés) →
   `"routes ok"` ;
2. `await __routes({prefix: '/app'})` renvoie directement l'objet ; `__stack()`, `__inventory()` idem.
Toujours passer son `tabId`, ne jamais toucher aux onglets des autres agents, fermer son onglet à la fin.

### c) CDP : Chrome/Edge headless, Electron, WebView2 (`cdp_eval.py`)
`cdp_eval.py` évalue le fichier puis l'expression (promesse attendue) et écrit le résultat (texte tel quel, objet
en JSON) :
```
python3 "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/routes-from-bundle.js" --expr "__stack()" --out "$TRAVAIL/reconnaissance/stack.json"
python3 "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/routes-from-bundle.js" --expr "__routes({prefix:'/app'})" --out "$TRAVAIL/reconnaissance/routes.json"
python3 "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/routes-from-bundle.js" --expr "__routes({prefix:'/app'}).then(function(){return __routesText()})" --out "$TRAVAIL/reconnaissance/routes.txt"
python3 "$OUTILS/cdp_eval.py" --port 9333 nav --target 0 --url "https://exemple.com/app/contacts" --wait 3
python3 "$OUTILS/cdp_eval.py" --port 9333 eval --target 0 --file "$OUTILS/routes-from-bundle.js" --expr "[__routeStatus('/app/contacts'), __inventory()]" --out "$TRAVAIL/reconnaissance/inv-app-contacts.json"
```
Chrome (ou Edge) headless sur un profil temporaire **neuf** (jamais le profil de l'utilisateur ; détails :
`capture-web/references/sites-publics.md` §2) :
```
python3 "$OUTILS/headless.py" lancer --port 9333
   → {"ok": true, "navigateur": "chrome", "port": 9333, "pid": 4242, "profil": "/var/folders/…/T/cu-chrome-1a2b3c4d", "viewport": "1536x791", …}
… commandes cdp_eval.py ci-dessus (port noté) …
python3 "$OUTILS/headless.py" fermer --profil "<profil noté>" --port 9333
```
Noter `port` et `profil` en clair : chaque appel Bash est un nouveau shell. L'outil trouve le navigateur
(variable `CU_CHROME`, puis emplacements habituels, sous macOS jusqu'à Spotlight : un Chrome rangé sur le
Bureau est trouvé), règle le viewport (1536×791 par défaut ; la fenêtre headless retire une marge à
`--window-size`), et à la fin n'arrête que les processus de **ce** profil puis le supprime — un profil unique par
lancement évite de toucher l'instance d'un autre agent. Windows : `headless.ps1` reste disponible (mêmes
actions). Jamais `open -a "Google Chrome"` ni un navigateur sans `--headless=new` et profil temporaire.

Sur un compte réel, `__inventory()` lit des noms de personnes dans la navigation et les listes : dans la même
commande, injecter aussi le kit de capture et anonymiser d'abord, par exemple
`--file "$OUTILS/capture-kit.js" --file "$OUTILS/routes-from-bundle.js" --expr "__config({raw:true}); __addNames(['Prénom Nom']); __anonLive(); [__routeStatus('/app/x'), __inventory()]"`
(noms relus au préalable avec `__guessNames()`, affiché sans `--out`).

---

## 3. Selon le framework (ce qu'on peut attendre)

| Pile | Couverture de `__routes` | Compléter par |
|---|---|---|
| Create React App (`asset-manifest.json`) | complète (tous les chunks listés) | visite pour statuts |
| Webpack / Angular CLI | bonne (carte des chunks du runtime) ; Angular donne surtout des segments **relatifs** | `aVerifier`, menus |
| Vite (React, Vue, Svelte) | bonne via `import()`/`mapDeps` ; `.vite/manifest.json` si déployé → noms de pages | `ecrans` |
| Next.js, routeur pages | complète (`__BUILD_MANIFEST.sortedPages`) | — |
| Next.js, routeur app | partielle : seules les pages déjà chargées/préchargées apparaissent (noms de chunks) | inventaire de la navigation sur chaque section |
| Remix / React Router 7 (framework) | complète (manifeste d'exécution) | — |
| Vue Router (Vue 2/3, Nuxt) | complète si le routeur est exposé (`getRoutes`) | — |
| SvelteKit | bonne (dictionnaire des routes) | — |
| Site multipage (Rails, Django, PHP, Laravel Blade, WordPress) | faible : pas de définitions côté client | `__inventory()` (navigation), `/sitemap.xml` d'un site public |
| Routeur à hachage (`#/…`) | routes listées sous la forme `/x`, URL réelles `#/x` | — |
| Electron en `file://` | `fetch` souvent refusé → presque rien | `__inventory()`, menus de l'appli, `ecransPresumes` de `detect_app.ps1` / `detect_app_mac.py` |

Avertissements fréquents et réponse :
- `refusesCors > 0` : bundles sur un CDN sans CORS. Ne rien forcer ; la visite des écrans suffit souvent. Avec CDP
  on peut aussi relancer `__routes` après avoir parcouru les sections (les chunks chargés entre-temps sont lus).
- `htmlAuLieuDeJs > 0` : chunks devinés inexistants, la SPA renvoie sa page HTML de repli : sans conséquence.
- `tronque: true` : relancer avec `maxFiles: 300`.
- « Aucune définition de route trouvée » : appli multipage ou routes calculées → inventaire par la navigation.

---

## 4. Limites assumées
- Un bundle peut définir des routes **mortes** (anciennes, réservées à un rôle, à une offre) : seule la visite
  tranche. Une route réservée (403, mur « Passez à l'offre supérieure ») est notée « non accessible », jamais
  contournée.
- Les routes construites dynamiquement (concaténations, tableaux de configuration côté serveur) échappent aux
  expressions régulières.
- Le kit ne lit pas les shadow DOM fermés ni l'intérieur des iframes d'une autre origine (`__stack().alertes` les
  signale).
- Lire un bundle sert à **lister des noms de routes**. Ne jamais recopier de code, de textes ou de données de ces
  fichiers dans le clone : le clone se reconstruit à partir de l'écran rendu (`capture-web`).
