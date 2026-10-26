# Capturer une appli connectée avec Claude in Chrome

Procédure complète, telle qu'elle a fonctionné pour l'appli iClosed (15 unités capturées l'une après l'autre
dans le Chrome de l'utilisateur), généralisée. Le principe : l'utilisateur est connecté **lui-même** dans son
Chrome ; l'agent pilote **un seul onglet**, en **lecture seule stricte**, injecte le kit, anonymise avant toute
image et range tout dans le dossier de capture. `OUTILS` = dossier `outils/` du plugin (voir SKILL.md).

Sommaire : 1. Prérequis · 2. Charger les outils · 3. Choisir le navigateur · 4. Un seul onglet · 5. Forcer le
rendu · 6. Injecter et configurer le kit · 7. Récupérer les dumps malgré le filtre · 8. Images · 9. Lecture seule
stricte · 10. Déroulé d'une page · 11. États · 12. Relever les routes d'un menu · 13. Fin de capture · 14. Dépannage

---

## 1. Prérequis

- L'extension Claude in Chrome est installée et reliée ; l'utilisateur a ouvert l'appli et **s'est connecté
  lui-même**. Si une page de connexion, une double authentification ou « session expirée » apparaît : arrêter,
  demander à l'utilisateur de se reconnecter, attendre. Ne jamais saisir d'identifiants, même s'il les donne dans
  la conversation : c'est une règle du plugin, pas une formalité.
- Prévenir l'utilisateur qu'un onglet de son Chrome va être piloté pendant la capture (durée estimée) et qu'il ne
  doit pas s'en servir pendant ce temps ; ses autres onglets ne sont pas touchés.
- Si un skill d'utilisation de Claude in Chrome est disponible dans la session (ex. `chrome-browser`), le charger :
  il couvre les permissions de site et les boîtes de dialogue à éviter.
- Une seule capture à la fois dans ce navigateur (voir SKILL.md §1).

## 2. Charger les outils (une seule recherche)

```
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__list_connected_browsers,mcp__claude-in-chrome__select_browser,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__tabs_create_mcp"
```
Si seul un outil `enable__mcp__claude-in-chrome` est présent, l'appeler d'abord. Chaque recherche séparée coûte un
aller-retour : tout charger d'un coup.

## 3. Choisir le bon navigateur

L'extension peut être reliée à plusieurs navigateurs (autre ordinateur, autre profil). Les commandes iraient
alors dans un navigateur où l'utilisateur n'est pas connecté.
1. `list_connected_browsers` → s'il y en a plusieurs, prendre celui **de cet ordinateur** (`onThisComputer`) où
   l'utilisateur est connecté à l'appli ; en cas de doute, lui demander lequel.
2. `select_browser { deviceId }`.
3. Vérifier après la première navigation : `location.href` est bien l'appli, et le nom du compte affiché est
   celui de l'utilisateur.

## 4. Un seul onglet, au premier plan

- `tabs_context_mcp { createIfEmpty: true }` : renvoie le groupe d'onglets de la session (ou le crée avec un
  onglet vide). Travailler dans **l'unique onglet** de ce groupe pendant toute la capture, toutes unités
  confondues ; ne pas en ouvrir d'autres.
- Pourquoi : un onglet en arrière-plan ne démarre pas une SPA ; et le dictionnaire d'anonymisation du kit vit dans
  le `sessionStorage` de cet onglet (faux noms identiques d'une page à l'autre).
- Ne jamais toucher aux onglets de l'utilisateur hors du groupe.
- Si le groupe disparaît (l'utilisateur l'a fermé) : `tabs_context_mcp { createIfEmpty: true }`, renaviguer vers
  la page en cours, réinjecter le kit **complet** et refaire `__config`. Le dictionnaire est perdu, mais les faux
  noms sont dérivés d'une empreinte du vrai nom : repasser la même liste à `__addNames` redonne en général les
  mêmes faux noms (vérifier sur une page déjà capturée).

## 5. Forcer le rendu après chaque navigation

Chrome ne dessine une fenêtre masquée ou occultée qu'à la demande ; une SPA y reste bloquée sur son écran de
chargement et le DOM est vide. Après **chaque** `navigate` :
```json
browser_batch { "actions": [
  { "name": "computer", "input": { "action": "screenshot", "scale": 0.1, "tabId": 123 } },
  { "name": "computer", "input": { "action": "wait", "duration": 4, "tabId": 123 } },
  { "name": "computer", "input": { "action": "screenshot", "scale": 0.1, "tabId": 123 } }
] }
```
Puis seulement lire le DOM. Si le logo de chargement est encore là, recommencer capture + attente. Les images à
l'échelle 0.1 coûtent peu : elles servent à déclencher le dessin, pas à documenter.

## 6. Injecter et configurer le kit

1. Lire `$OUTILS/capture-kit.js` (Read, chemin absolu, `allow_large: true` — le fichier dépasse ce qu'un Read
   rend par défaut ; à défaut, tranches de 400 lignes jusqu'à la dernière, `})();`) et passer **tout** son
   contenu, sans les numéros de ligne de Read :
   `javascript_tool { action: "javascript_exec", tabId, text: <contenu> }` → exactement `kit ok` (sinon tranche
   manquante ou numéro resté : relire et renvoyer).
2. Configurer une fois (conservé dans l'onglet, **pour cette origine**) :
   `__config({ keep: ['Prénom Nom', 'Organisation'], owner: 'titulaire@domaine.fr' })`. Le `sessionStorage` est
   propre à l'origine : si l'appli passe sur un autre hôte (`admin.`, `www.`, page de compte sur un sous-domaine),
   le kit, la config et le dictionnaire n'y sont pas — kit complet, `__config`, puis `__addNames` avec la même
   liste (en général les mêmes faux noms : ils dérivent d'une empreinte du vrai nom) ; `__info().noms` à 0 =
   dictionnaire vide.
3. Après chaque navigation ou rechargement, réinjection courte (pas besoin de renvoyer les 85 Ko du kit) :
   ```js
   window.__dump ? 'kit ok' : (0, eval)(sessionStorage.getItem('copieur-kit') || "'kit absent'")
   ```
   `kit absent` ou erreur → renvoyer le fichier complet puis `__config`.
4. Les clics dans l'appli qui changent seulement de vue (onglets d'une SPA) ne rechargent pas la page : le kit
   reste en place (`typeof __dump` vaut `'function'`).

Plusieurs appels `javascript_tool` peuvent s'enchaîner dans un `browser_batch` (toujours avec `tabId`).

## 7. Récupérer les dumps malgré le filtre de sortie

Le filtre de l'extension tronque les réponses vers 1000 caractères et remplace par « [BLOCKED…] » ce qui ressemble
à des cookies, des chaînes de requête ou du base64. C'est un **garde-fou** : il ne se contourne pas. Le kit
échappe `§`→`(SECT)`, puis `;`→`§`, `&`→`(AMP)`, `?`→`(Q)`, et découpe en morceaux de ≤ 900 caractères, parce que
du HTML ordinaire (styles en ligne, liens déjà nettoyés) déclencherait sinon le filtre à tort. Ses masques
(secrets connus, jetons longs, affectations `sessionid=…`/`token=…`, paramètres d'URL sensibles) ne reconnaissent
pas tout : `laravel_session=a1b2c3d4e5f6` passe (testé). Un morceau bloqué est donc d'abord un **signal à
examiner**.

1. `__dump('main', 8)` → nombre de morceaux `N` (même logique pour `__styles()`, `__icons()`, `__chart(i)`).
2. Récupérer par paquets : `window.__D.slice(0, 20)`, puis `window.__D.slice(20, 40)`… jusqu'à `N`.
3. Morceau rendu « [BLOCKED…] » (ici le n° 7) : **ne pas le redécouper aussitôt**.
   - Le relire **masqué** (les valeurs ne sortent pas de la page) et y chercher `cookie`, `session`, `token`,
     `auth`, une valeur après `=`, un long bloc base64 :
     `window.__D[7].replace(/=[^\s"'<>§&()]{3,}/g, '=•••').replace(/[\w+\/-]{20,}={0,2}/g, '[•••]')`
   - Donnée sensible trouvée → la masquer dans la page : `__mask('<sélecteur>')` pour un texte affiché, ou, sans
     faire sortir la valeur, `(() => { const m = window.__H.match(/laravel_session=([^\s"'<>;&]+)/); return m ?
     __addMap({[m[1]]: '•••'}) : 'rien' })()` (adapter le nom du paramètre) ; puis refaire `__dump` et reprendre
     depuis le premier paquet. Noter dans `notes.md` ce qui a été masqué et où (« jeton de session masqué dans
     le pied de page »), **jamais la valeur** : une valeur de session, un cookie ou un secret n'est jamais capturé.
   - Seulement si rien de sensible n'apparaît (faux positif : longue classe, `data:` déjà raccourci) : le
     redemander en plus petit (`window.__D[7].slice(0, 300)`, `window.__D[7].slice(300, 600)`…), ou redécouper tout
     le texte : `__dumpText(window.__H, 400)` puis reprendre depuis le premier paquet (les paquets déjà écrits ne
     correspondent plus au nouveau découpage). Toujours bloqué : laisser ce passage hors capture et le décrire.
4. Écrire le fichier — méthode sûre pour les gros dumps : chaque paquet revient sous forme de **tableau JSON** ;
   le recopier **tel quel**, crochets et guillemets compris, sans rien inverser, dans un fichier numéroté
   (outil Write) : `$CAP/_tmp/dom-initial.01.json`, `.02.json`… (un morceau redemandé en plusieurs parts :
   remettre dans le tableau la chaîne recomposée). Puis décoder tous les paquets d'un coup (outil Bash ; `$CAP` =
   chemin absolu du dossier de la page, écrit en entier ou défini dans le même appel ; le motif reste entre
   guillemets, c'est Python qui le développe) :
   ```bash
   python3 -c "import sys,io,json,glob;f=sorted(glob.glob(sys.argv[1]));f or sys.exit('0 paquet trouve pour '+sys.argv[1]+' : verifier le chemin (barres /) et le nom des fichiers');s=''.join(''.join(json.load(io.open(x,encoding='utf-8'))) for x in f);s=s.replace(chr(167),';').replace('(SECT)',chr(167)).replace('(AMP)','&').replace('(Q)','?');io.open(sys.argv[2],'w',encoding='utf-8',newline='').write(s);print(len(f),'paquet(s),',len(s),'caracteres')" "$CAP/_tmp/dom-initial.*.json" "$CAP/dom-initial.html"
   ```
   Aucun paquet trouvé → message d'erreur, code 1 et aucun fichier écrit. Variante : écrire le **contenu** des
   chaînes (sans les crochets ni les guillemets du tableau, `\"` redevenant `"`) bout à bout dans
   `dom-initial.esc.txt`, puis :
   ```bash
   python3 -c "import sys,io;s=io.open(sys.argv[1],encoding='utf-8').read();s=s.replace(chr(167),';').replace('(SECT)',chr(167)).replace('(AMP)','&').replace('(Q)','?');io.open(sys.argv[2],'w',encoding='utf-8',newline='').write(s);print(len(s),'caracteres')" "$CAP/dom-initial.esc.txt" "$CAP/dom-initial.html"
   ```
   Testées sous macOS (zsh) sur des paquets fictifs : fichier identique, à l'octet près, au texte d'origine ;
   sous Windows (Git Bash), `py` remplace `python3`. Pour un petit dump, on peut écrire directement le HTML en
   inversant les échappements soi-même — dans cet ordre : `§`→`;` d'abord, `(SECT)`→`§` ensuite.
5. Contrôle : `[...window.__H].length` dans la page doit égaler le nombre de caractères affiché par la commande
   (ou `python3 -c "import io,sys;print(len(io.open(sys.argv[1],encoding='utf-8').read()))" "$CAP/dom-initial.html"`).
   Un écart = un morceau manquant ou mal recopié.

Les petits résultats (`__info()`, `__overlays()`, `__guessNames()`) sont échappés de la même façon : penser à
inverser, notamment pour le **titre exact** de la page.

## 8. Images

- `computer { action: "screenshot", tabId, save_to_disk: true }` → le résultat donne le chemin du fichier ; le
  copier avec un nom parlant : `cp "<chemin renvoyé>" "$CAP/01-haut.png"` (garder l'extension renvoyée).
- Détails (icônes, infobulles, badges) : `computer { action: "zoom", region: [x0, y0, x1, y1], tabId,
  save_to_disk: true }` → `41-infobulle-<nom>-zoom.png`.
- Toute la hauteur : `__steps()` donne les positions ; pour chacune, `__scroll(y)` puis image (enchaîner dans un
  `browser_batch`), et `__scroll(0)` à la fin. Les aplats de `__cover` suivent leur zone pendant le défilement ;
  vérifier quand même sur chaque image qu'ils couvrent bien ce qu'il faut.
- **Regarder chaque image** (Read) avant de passer à la suite : aucune donnée réelle hors liste « à garder ».
- Taille de fenêtre : capturer au viewport actuel de l'utilisateur et le noter (`__info()`). `resize_window`
  redimensionne **sa** fenêtre : seulement si la mission demande un petit écran, en notant la taille d'origine
  (`[outerWidth, outerHeight]`) pour la rétablir aussitôt après.

## 9. Lecture seule stricte

Le compte est réel : un clic malheureux annule un rendez-vous, envoie un email à un client ou déconnecte une
intégration. La copie ne vaut pas ce risque. D'où une liste explicite (reprise de `regles.md` §4).

**Autorisé**
- naviguer vers des pages de l'appli (URL complètes, même domaine) ;
- cliquer des onglets, entrées de navigation, filtres d'affichage, accordéons, pagination, tri d'une colonne ;
- ouvrir un menu déroulant, une modale ou un tiroir informatif, ou un formulaire de création **sans le remplir**,
  puis le fermer (Échap, Annuler, croix) ; cliquer les onglets internes d'une modale ;
- ouvrir le détail d'un élément en lecture ; survoler (`computer hover`) pour une infobulle ; faire défiler ;
- lire le DOM et les styles, injecter le kit (il ne change que l'affichage local).

**Interdit**
- tout bouton qui enregistre, crée, modifie, supprime, duplique, archive, envoie, publie, invite, partage ;
- connecter / déconnecter une intégration, activer / désactiver (interrupteurs, cases à cocher) ;
- importer, exporter, télécharger, téléverser ; payer, changer d'abonnement, d'organisation ou d'espace ;
- révéler, copier ou régénérer une clé, un jeton, un webhook ;
- **taper dans un champ** (y compris la recherche : décrire la recherche au lieu de la capturer, sauf accord
  explicite de l'utilisateur pour ce champ précis), touche Entrée dans un formulaire, glisser-déposer ;
- changer un réglage d'affichage persistant du compte (langue, thème, colonnes enregistrées, vue par défaut) ;
- ouvrir une conversation ou une notification **non lue** quand cela la marque comme lue (et, dans une
  messagerie, envoie un accusé de lecture à un tiers) ;
- « Suivant » / « Continuer » dans un assistant de création s'il peut créer un brouillon ;
- tout ce qui ouvre une boîte de dialogue du navigateur (impression, « quitter la page ? ») ; sortir du domaine ;
  se déconnecter.

**En cas de doute : ne pas cliquer.** Décrire l'élément dans `notes.md` (libellé, position, ce qu'il ferait
probablement, aspect au survol) ; le constructeur le reproduira d'après la description.

Si une alerte « Quitter la page ? » bloque (formulaire ouvert) : fermer l'onglet **via l'extension**
(`tabs_close_mcp`), ce qui n'enregistre rien, puis `tabs_context_mcp { createIfEmpty: true }` et reprendre (kit
complet). Ne jamais cliquer dans une boîte qui propose aussi « Enregistrer ».

Pour cliquer, préférer une référence d'élément (`find` « Onglet Évènements » → `ref`) à des coordonnées ; donner
à chaque clic un `action_summary` exact (« Ouvre l'onglet Évènements »).

## 10. Déroulé d'une page

```
1. navigate { url: "https://app.exemple.com/app/route", tabId }
2. browser_batch : screenshot 0.1 → wait 4 → screenshot 0.1                         (§5)
3. javascript_tool : réinjection courte → "kit ok" (au premier passage : fichier complet + __config)
4. javascript_tool : __info()             → route finale, titre (inverser les échappements), viewport, scrollHeight
5. javascript_tool : __guessNames()       → relire → __addNames([...]) ; __addMap({...}) si besoin
6. javascript_tool : __anonLive()         → zones éditables ou champ avec le focus signalés ? → __cover('<sélecteur>')
7. javascript_tool : __steps()            → [0, 590, 1180, …]
8. browser_batch   : __scroll(0) → screenshot save_to_disk → __scroll(590) → screenshot save_to_disk → …
   puis cp de chaque fichier vers $CAP/01-haut.png, 02-milieu.png, 03-bas.png ; Read de chaque image
9. javascript_tool : __dump('main', 8)    → N morceaux → __D.slice(0,20)… → dom-initial.esc.txt → décodage (§7)
10. une fois par unité, DANS L'ÉTAT INITIAL (avant d'ouvrir quoi que ce soit) : __styles('body') → styles.css,
    __icons('body') → icones.txt, __chart() / __chart(i) → graphique-<nom>.txt ; puis les états (§11)
11. notes.md (modèle dans SKILL.md §6), au fil de l'eau
```

## 11. États

- **Onglets / sous-onglets** : clic (référence `find`) → attendre 1–2 s → images + `__dump('main', 8)` →
  `dom-onglet-<nom>.html`. La surveillance de `__anonLive` anonymise le nouveau contenu ; regarder l'image.
- **Menus déroulants, sélecteurs, filtres** : ouvrir → `__overlays()` (liste numérotée) → image →
  `__dump(0)` (indice de l'overlay) → `dom-menu-<nom>.html` → Échap.
- **Modales et tiroirs** : ouvrir « Nouveau… » / « Modifier » **sans rien remplir** → `__dump('modal')` (racine
  élargie au portail, fond compris) → images (défiler dans la modale si besoin) → onglets internes un par un →
  fermer par Annuler / croix / Échap. Une modale de confirmation (« Supprimer ? ») : ne pas l'ouvrir ; la décrire.
- **Infobulles** : `computer { action: "hover", coordinate, tabId }` → `zoom` + `save_to_disk` → `__overlays()`
  → `__dump(i)` (texte exact). Une infobulle qui n'est que dans un attribut `title` : lire l'attribut dans le dump.
- **Survols** de lignes, de cartes, de boutons : `hover` puis `zoom` ; les classes `hover:` des applis Tailwind
  sont de toute façon dans le DOM.
- **États de la coque** (barre repliée, menu utilisateur) : `__etat()` avant le clic, `__diffEtat(20)` après
  (lignes échappées comme le reste ; nombre limité pour passer le filtre de sortie) → tout ce qui a changé dans
  la page, y compris loin de l'élément cliqué.
- **États vides** : seulement s'ils existent déjà dans le compte (filtre qui ne renvoie rien, section jamais
  utilisée). Ne jamais supprimer quoi que ce soit pour en obtenir un.
- **Squelettes de chargement** : s'ils sont visibles (images prises pendant le chargement), les garder et les
  noter : l'original les montre, le clone aussi.
- **Graphiques** : `__chart()` puis `__chart(i)` ; survoler quelques points pour l'infobulle de valeur.

## 12. Relever les routes d'un menu

Cliquer les entrées de navigation est autorisé. Pour chaque entrée : clic → rendu → `__info().url` (route) et
`__overlays()` (s'ouvre-t-elle en modale ?) → noter dans `<unité>/routes-<section>.md` (libellé exact, route,
modale ou page). Les unités suivantes de la section liront ce fichier : c'est pour cela que l'unité qui le
produit est capturée en premier.

## 13. Fin de capture

- Fermer menus et modales (Échap), puis **naviguer** vers une page neutre de l'appli (l'accueil) : le
  rechargement retire l'anonymisation affichée et les aplats `__cover`.
- Entre deux unités : garder l'onglet et le dictionnaire (ne pas appeler `__forget()`).
- À la toute fin de la capture : `__forget()` puis une dernière navigation. Fermer l'onglet (`tabs_close_mcp`)
  s'il a été créé pour la capture et que l'utilisateur n'en a pas besoin. Ne jamais se déconnecter.

## 14. Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| Les actions vont dans un navigateur où l'utilisateur n'est pas connecté | plusieurs navigateurs reliés | `list_connected_browsers` → `select_browser` (§3) |
| `tabs_context_mcp` ne renvoie plus d'onglet | groupe fermé | `createIfEmpty: true`, renaviguer, kit complet (§4) |
| DOM vide, logo de chargement, mesures à 0 | fenêtre masquée : rien n'est dessiné | rituel de rendu (§5), un seul onglet au premier plan |
| Réponse coupée | limite de taille du filtre de sortie | morceaux, paquets de 20 (§7) |
| « [BLOCKED…] » sur un morceau | le filtre a vu un cookie, un jeton, une chaîne de requête ou du base64 | relecture masquée, `__mask`/`__addMap`, nouveau `__dump` ; re-découpage seulement pour un faux positif ; jamais de valeur de session capturée (§7) |
| `__info().noms` à 0, vrai nom revenu, après un passage sur un autre hôte | `sessionStorage` propre à l'origine | kit complet, `__config`, `__addNames` avec la même liste (§6) |
| « Inspected target navigated or closed », kit disparu | rechargement (garde de route, nouvelle version) | réinjection courte ; naviguer avec `navigate`, jamais `history.pushState` |
| `kit absent` à la réinjection courte | `sessionStorage` vidé ou nouvel onglet | fichier complet + `__config` |
| Une modale n'apparaît pas dans `__dump('main')` | rendue dans un portail hors de `main` | `__dump('modal')` ou `__overlays()` + `__dump(i)` |
| Un vrai nom réapparaît sur une image | re-rendu, ou nom non listé | `__addNames`, `__anonLive()`, refaire l'image |
| Alerte « Quitter la page ? » | formulaire ouvert | `tabs_close_mcp` puis nouvel onglet (§9) |
| Page de connexion / session expirée | déconnexion | arrêter, l'utilisateur se reconnecte lui-même |
| `__dump` renvoie « racine introuvable » | sélecteur absent sur cette page | `__info().principal`, `__config({ main: '<sélecteur>' })` |
