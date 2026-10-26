# Orchestration multi-agents

Comment répartir une copie d'appli entre plusieurs agents sans perdre la cohérence. C'est la méthode qui a
permis de recréer l'appli iClosed entière : une fondation validée, une capture séquentielle, une construction
parallèle avec des propriétaires uniques, deux vérifications par unité, un contrôle final.

Sommaire : 1. Vocabulaire · 2. Découper en unités · 3. Le GUIDE du projet · 4. Les phases et leur raison d'être ·
5. Remontée des besoins · 6. Seul, Agent ou Workflow · 7. Utiliser `workflow-template.js` ·
8. Sans Workflow : la même méthode avec l'outil Agent · 9. Estimer durée et coût · 10. Garder un script en ASCII

---

## 1. Vocabulaire

| Terme | Sens |
|---|---|
| **page** / **écran** | une route d'appli web (`/app/settings/profile`) ou une fenêtre / vue d'un logiciel |
| **état** | une variante d'une page : onglet actif, modale ouverte, menu déroulé, état vide, survol |
| **section** | groupe de pages qui partagent des éléments (en-tête, onglets, barre latérale secondaire) |
| **unité** | 2 à 6 pages d'une même section, capturées par UN agent puis construites par UN agent |
| **propriétaire** | l'unité qui écrit les fichiers communs de sa section (`assets/sections/<section>.js` et `.css`) |
| **fondation** | la page de référence recréée et validée + la coque partagée + les données fictives + le GUIDE |
| **coque** | ce qui est commun à toute l'appli : navigation, menus, icônes, infobulles, styles, utilitaires |
| **GUIDE du projet** | le document que lisent tous les agents : chemins, gabarit, API de la coque, conventions |

## 2. Découper en unités

Règles qui ont fonctionné :
- **Une unité = une section ou un morceau de section** : les pages d'une unité se ressemblent, l'agent de capture
  garde le contexte, le constructeur réutilise ses propres composants.
- **2 à 6 pages par unité** (moins si les pages ont beaucoup d'états : formulaires longs, modales multiples).
  Au-delà, le contexte de l'agent sature et la qualité baisse en fin d'unité.
- **Un propriétaire par section** quand la section a des éléments communs ; il porte un champ `shared` qui décrit
  précisément ce qui est commun (« la barre latérale des paramètres avec ses 16 entrées et leurs routes, la
  barre de titre, un paramètre pour l'entrée active »). Le propriétaire doit prévoir les entrées que d'autres
  unités construiront.
- **Ordre du tableau = ordre de capture** : mettre d'abord les propriétaires et les unités qui découvrent des
  informations utiles aux autres (ex. l'unité qui relève les routes de chaque entrée d'un menu et les note dans
  un fichier que les unités suivantes liront).
- **Notes de capture précises** : états à couvrir, ce qui s'ouvre en modale, ce qu'il ne faut surtout pas cliquer
  (facturation, clés API, boutons « connecter »), ce qui redirige.
- **Unité « divers »** pour les routes isolées, les pages qui redirigent ou les éléments de la coque à
  documenter (menu « Quoi de neuf », sélecteur d'organisation…).

Exemple (iClosed, 15 unités) : `ais-core` (propriétaire « ai-scheduler », 4 routes), `ais-automations`,
`ais-other`, `ais-messages` (non-propriétaires, même section), `settings-general` (propriétaire « settings », relève
les routes des 16 entrées), `settings-workspace`, `settings-tracking`, `settings-data`, `integrations-hub`,
`integrations-details`, `analytics`, `database`, `members`, `inbox`, `misc`.

## 3. Le GUIDE du projet

Écrit pendant la fondation (squelette par l'agent principal, complété par le constructeur de la fondation), dans
le dossier de travail. Tous les agents le lisent en premier. Il contient :
1. **Le projet** : dossier du clone, URL locale (serveur déjà lancé, ne pas le relancer), URL ou programme
   original, correspondance route → fichier (`/app/x` → `<CLONE>\app\x\index.html` ; écran de logiciel →
   `<CLONE>\ecrans\<ecran>\index.html`), pages déjà validées à ne pas toucher, page de référence à ouvrir comme
   modèle ; pour un logiciel, le **PID et le handle** de l'instance lancée pour la capture (relevés au lancement
   dans le `notes.md` de la capture ; les agents visent ce PID, jamais une instance de l'utilisateur), son port
   de débogage s'il y en a un ; pour un site public capturé en headless, le port du navigateur.
2. **Le gabarit de page exact** (copier-coller) : `<head>` (polices, Tailwind et sa configuration, feuille de la
   coque), structure du `<body>` (conteneurs de la navigation et du contenu principal, attributs comme
   `data-nav`), scripts (données fictives, coque, section, script de page).
3. **L'API de la coque** : icônes (`Shell.icon`, ajout d'icônes), infobulles, échappement HTML, formatage des
   nombres, stockage local protégé, configuration (titulaire du compte, organisation), classes CSS disponibles.
4. **Les données** : ce qui est fictif, l'API des données fictives (`FAKE.*`, générateur à graine fixe, date
   « aujourd'hui » figée), ce qu'on garde tel quel, jamais de secret réel.
5. **Fidélité et interactions** : recopier structure, classes, textes exacts, icônes ; reproduire les comportements
   visibles ; aucune requête réseau ; liens vers les pages locales ; images (URL publiques absolues ou
   équivalents libres) ; graphiques en SVG ; viewport de comparaison ; zéro erreur console.
6. **Ce qui est partagé et qui peut le modifier** : coque et données → personne pendant la construction
   (`shellIssues`) ; fichiers de section → leur propriétaire seulement (`sectionIssues`) ; chaque agent → ses pages.
7. **Comment vérifier** : navigateur intégré, son propre onglet, `tabId` partout, fermer son onglet ;
   le navigateur réel de l'utilisateur est réservé aux captures.

Le modèle prêt à remplir est dans `reconstruire-appli/references/conventions.md` §9 ; le même skill fournit
les gabarits (page, coque, données fictives) dont le guide décrit l'usage.

## 4. Les phases et leur raison d'être

1. **Fondation** — page de référence capturée à fond, recréée, vérifiée deux fois (relecteurs par angle +
   vérificateur adverse + correcteur), puis coque et données extraites, GUIDE complété, accord de l'utilisateur.
   *Pourquoi* : tout défaut de la coque se multiplie par le nombre de pages ; on ne parallélise qu'une base saine.
2. **Capture séquentielle** — une unité après l'autre, dans le seul navigateur réel (ou la seule instance du
   logiciel). *Pourquoi* : deux agents dans le même navigateur se volent la navigation ; les onglets en
   arrière-plan ne rendent pas les SPA ; un compte réel exploré par plusieurs agents à la fois multiplie les
   risques de clic malheureux.
3. **Construction parallèle** — chaque unité est construite dès que sa capture est prête, pendant que la capture
   suivante continue ; les unités non propriétaires attendent la construction de leur propriétaire (verrou de
   section). *Pourquoi* : la construction est le travail le plus long et n'utilise que des fichiers ; le verrou
   évite que chaque unité invente sa propre version de l'en-tête de section.
4. **Vérification 1** — un agent compare chaque page et chaque état au capturé (mesures, textes mot à mot,
   interactions, confidentialité) et corrige les pages de son unité.
5. **Vérification 2** — une seconde passe **indépendante**, depuis zéro. *Pourquoi* : la première passe corrige
   ce qu'elle voit et rate ce qu'elle ne cherche pas ; une deuxième paire d'yeux trouve un autre lot d'écarts
   et repère les régressions introduites par les corrections.
   Variante plus sûre (option `verifAdverseUnites`) : chaque passe = 4 relecteurs par angle (mise en page,
   textes, comportement, confidentialité) qui ne modifient rien, un vérificateur adverse par relecteur qui tente
   de réfuter chaque écart (réel = faux par défaut), puis un correcteur qui n'applique que les écarts confirmés.
6. **Contrôle final** — tout le site : chargement sans erreur console, navigation cohérente, liens
   (`check_links.py`), confidentialité (`scan_pii.py`), défilement horizontal.
7. **Coque** — un seul agent trie et applique les demandes de modification de la coque et des sections
   remontées par tous les autres, puis revérifie la page de référence, un échantillon par section, les liens et
   la confidentialité.

## 5. Remontée des besoins

Chaque agent renvoie un objet structuré. Deux champs servent de canal entre agents qui n'ont pas le droit de
toucher aux fichiers partagés :
- `shellIssues` : besoins sur la coque ou les données fictives (« ajouter l'icône `calendar-plus` à la coque »,
  « la barre latérale doit accepter `data-rail="true"` sur les pages Paramètres ») ;
- `sectionIssues` : besoins sur un fichier de section (« l'en-tête de la section settings n'a pas d'entrée
  Médiathèque »).

Une demande utile est **précise** : fichier, problème observé, changement proposé, pages concernées.
L'agent « Coque » les dédoublonne, écarte celles qui contredisent la capture et applique le reste.

## 6. Seul, Agent ou Workflow

| Taille | Mode | Remarques |
|---|---|---|
| 1 page / 1 écran | seul + 1–2 agents de vérification | la fondation est la livraison |
| 2 à ~8 pages | seul pour la fondation, puis outil Agent | captures une par une, constructeurs en arrière-plan |
| appli complète | Workflow + `assets/workflow-template.js` | déterminisme, verrous, reprise après interruption |

**Consentement** : le Workflow lance de nombreux agents et consomme beaucoup. On ne l'utilise que si l'outil est
disponible et que l'utilisateur l'a accepté — mode ultracode actif (accord permanent), ou « oui » explicite après
l'annonce du nombre d'agents, de la durée et du coût. Sinon, même méthode avec l'outil Agent (section 8).

## 7. Utiliser `workflow-template.js`

Le gabarit est dans `assets/workflow-template.js` (ASCII pur). Il enchaîne : [Fondation] → Capture (séquentielle)
→ Construction (parallèle, verrous de section) → Vérification 1 → Vérification 2 → Contrôle final → Coque.

### Préparer
1. Faire le cadrage, la reconnaissance (inventaire + unités) et lancer le serveur local du clone.
2. Écrire le squelette du GUIDE du projet dans le dossier de travail.
3. Si l'appli est connectée : l'utilisateur ouvre l'appli dans son Chrome et s'y connecte lui-même.
   Si c'est un site public capturé en headless : `OUTILS\headless.ps1 -Action lancer -Port 9333`
   (`capture-web/references/sites-publics.md`), noter port et profil, `cdpPort` = ce port ; le fermer à la fin
   avec `-Action fermer`.
   Si c'est un logiciel : le lancer selon `capture-bureau` (profil temporaire, mises à jour automatiques
   bloquées, port de débogage pour Electron ; application du Store sans fichier) et noter son **PID et le
   handle de sa fenêtre dans le GUIDE** : les prompts du gabarit y renvoient.
4. Copier le gabarit dans le dossier de travail.

### Paramétrer : `CONFIG`
| Champ | Rôle |
|---|---|
| `appli` | nom de l'appli tel que l'utilisateur la désigne |
| `mode` | `web-connecte`, `web-public`, `electron` ou `natif` (choisit le skill de capture et les règles) |
| `original` | URL de base, ou processus / titre de fenêtre / chemin de l'exe |
| `projet`, `urlLocale` | dossier du clone et son URL locale (serveur déjà lancé) |
| `travail` | dossier de travail hors du clone (captures, GUIDE) |
| `skills` | dossier `skills` du plugin = `<Base directory de copier-une-appli>\..` en chemin absolu |
| `outils`, `captures`, `guide` | facultatifs : déduits (`<plugin>\outils`, `<travail>\capture`, `<travail>\GUIDE.md`) |
| `viewport` | viewport ou taille de fenêtre de référence (ex. `1536x791`) |
| `garder` | ce qui reste réel : titulaire du compte, son email, son organisation |
| `domainesFictifs` | domaines des emails fictifs autorisés par `scan_pii.py` |
| `cdpPort` | port de débogage (Electron, Chrome headless) — habitudes du plugin : 9229 pour Electron, 9333 pour Chrome headless |
| `pageReference` | route de la page de référence validée (modèle de qualité) |
| `fondation` | `{ faite, arreterApres, unite }` : `faite: false` + `unite` (= contenu de `fondation.json` écrit par `reconnaissance-appli`) = le script fait la fondation |
| `verifAdverseUnites` | `true` = vérifications par angle + adverses pour chaque unité (≈ 4 fois plus d'agents) |
| `appliquerDemandesCoque` | `true` = agent final qui applique `shellIssues` / `sectionIssues` |

### Paramétrer : `UNITS`
Chaque unité : `key` (unique ; lettres ASCII, chiffres, `.`, `_`, `-` : elle sert de nom de dossier), `section`,
`owner` (une seule par section), `shared` (si propriétaire), `nav` (clé de navigation active), `routes`, `notes`
— c'est le format d'`unites.json` produit par `reconnaissance-appli`. Supprimer les exemples (`exemple: true`) : le
script refuse de démarrer tant qu'ils sont là, comme il refuse tout `A_REMPLIR`, un mode inconnu, une `key`
invalide ou en double, deux propriétaires dans une section, ou des `args` passés sous forme de chaîne illisible —
avant de lancer le moindre agent.

### Lancer
Deux façons, au choix :
- éditer `CONFIG` et `UNITS` dans la copie (en restant en ASCII : voir section 10), puis
  `Workflow({ scriptPath: "<travail>\\workflow.js" })` ;
- laisser la copie intacte et passer les paramètres en `args` (objets JSON réels, pas une chaîne) :
  ```
  Workflow({ scriptPath: "<travail>\\workflow.js", args: {
    config: { appli: "...", mode: "web-connecte", original: "https://...", projet: "C:\\...\\clone",
              urlLocale: "http://localhost:8770", travail: "C:\\...\\travail",
              skills: "C:\\...\\plugins\\copieur-universel\\skills",
              garder: ["Prénom Nom", "email@domaine.fr", "Organisation"], pageReference: "/app/accueil" },
    units: [ { key: "...", section: "...", owner: true, shared: "...", nav: "...", routes: ["..."], notes: "..." } ]
  } })
  ```
  `args.config` est fusionné dans `CONFIG` (et `args.config.fondation` dans `CONFIG.fondation`) ;
  `args.units` remplace `UNITS` s'il est non vide.

### Suivre et reprendre
- La progression s'affiche par phase. La capture fixe le rythme ; les constructions et vérifications avancent
  en parallèle derrière elle.
- Après une interruption (agent mort, script modifié, session coupée) : relancer avec
  `resumeFromRunId` — même script + mêmes `args` = les résultats déjà obtenus sont rejoués depuis le cache, seul
  ce qui manque est relancé.
- Avec `fondation.faite: false` et `arreterApres: true`, le script s'arrête après la fondation : montrer la page
  de référence à l'utilisateur, puis relancer avec `fondation.faite: true` et `pageReference` renseigné.

### Lire le résultat
Le script renvoie : `unites` (pages capturées et statuts, pages construites, nombre de corrections et écarts
restants des deux passes), `unitesSansPage` (unités ignorées faute de page exploitable — à signaler, pas à
taire), `shellIssues`, `sectionIssues`, `site` (contrôle final), `coque` (demandes appliquées ou écartées).
Un agent sauté ou mort n'est jamais compté comme un succès : sa passe apparaît « en échec ou non lancée », et en
vérification adverse les angles non vérifiés ou les écarts non tranchés figurent dans `remaining`.
Le compte rendu à l'utilisateur reprend les écarts restants et les demandes écartées, honnêtement.

## 8. Sans Workflow : la même méthode avec l'outil Agent

1. Fondation dans la session principale (ou un agent), puis deux agents de vérification successifs.
2. Pour chaque unité, **dans l'ordre** : lancer l'agent de capture et **attendre sa fin** avant la capture
   suivante (jamais deux captures en même temps).
3. Dès qu'une capture est finie, lancer son constructeur **en arrière-plan** — sauf si c'est une unité non
   propriétaire dont le propriétaire n'a pas fini de construire : attendre.
4. Quand un constructeur a fini, lancer sa vérification 1, puis sa vérification 2.
5. Quand tout est vérifié : contrôle final, puis un agent « coque » pour les demandes remontées.
6. Fermer ce qui a été lancé pour la capture (par PID), et seulement cela.
Les prompts du gabarit (sections 5 et 6 de `workflow-template.js`) servent de modèle pour ces agents : ils
renvoient chacun vers le skill du plugin qui convient et reprennent les règles de sécurité de chaque mode. Leurs
accents y sont écrits en séquences d'échappement : les relire dans le gabarit, puis rédiger le prompt en clair.

**Ni Workflow ni outil Agent** (un sous-agent ne peut pas lancer d'agents) : même ordre, fait par un seul agent —
fondation, puis chaque unité capturée, construite, vérifiée deux fois depuis la capture. Les passes ne sont
alors pas indépendantes : s'appuyer sur des preuves mécaniques (`png_diff.py`, dump contre dump, `textes.py`,
`nav --console`, `check_links.py`, `scan_pii.py`) et écrire dans le compte rendu « vérifié par l'agent
constructeur, sans relecteur indépendant » (`verifier-copie` §2). Si l'orchestrateur peut lancer des agents,
lui demander plutôt une vraie passe indépendante.

## 9. Estimer durée et coût (à annoncer avant de lancer)

- **Nombre d'agents** ≈ 4 par unité (capture, construction, 2 vérifications) + 2 (contrôle final, coque).
  Fondation : 2 (capture, construction) + 2 passes × (4 relecteurs + jusqu'à 4 vérificateurs adverses +
  1 correcteur) ≈ 20. Avec `verifAdverseUnites`, chaque passe d'unité passe de 1 à environ 9 agents.
- **Durée** : la capture séquentielle fixe le tempo. Ordre de grandeur indicatif : 15 à 45 minutes par unité
  selon le nombre d'états, plus la dernière construction et ses deux vérifications. Une appli de 15 unités
  occupe donc plusieurs heures.
- **Coût** : proportionnel au nombre d'agents et au volume des captures lues. Une appli complète est une
  opération coûteuse : proposer de commencer par la fondation, puis une section, avant de tout lancer.
- Présenter ces chiffres comme des estimations, et préciser qu'on peut s'arrêter après la fondation.

## 10. Garder un script Workflow en ASCII

Un script lancé via `scriptPath` qui contient des accents peut être refusé (« control characters »). Écrire le
script avec accents dans un fichier source, puis produire la version ASCII avec ce petit script Python
(enregistrer sous `escape_ascii.py`, lancer `py escape_ascii.py source.js workflow.js`) :

```python
# Echappe tout caractere non ASCII d'un script JS en sequences d'echappement unicode JS.
# Messages en ASCII : une console Git Bash en cp1252 afficherait mal les accents.
import re, sys
BS = chr(92)  # antislash
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
for n, line in enumerate(s.splitlines(), 1):
    if any(ord(c) > 127 for c in line) and line.lstrip().startswith(('//', '*', '/*')):
        print('ligne %d : accent dans un commentaire (il restera illisible une fois echappe)' % n)
    for m in re.finditer('(' + re.escape(BS) + '+)([^\x00-\x7f])', line):
        if len(m.group(1)) % 2:
            print('ligne %d : antislash isole avant U+%04X : a doubler' % (n, ord(m.group(2))))
def esc(c):
    o = ord(c)
    if o < 128:
        return c
    if o <= 0xFFFF:
        return BS + 'u%04x' % o
    o -= 0x10000
    return BS + 'u%04x' % (0xD800 + (o >> 10)) + BS + 'u%04x' % (0xDC00 + (o & 0x3FF))
open(dst, 'w', encoding='ascii', newline='\n').write(''.join(esc(c) for c in s))
```

Écrire les commentaires du script sans accents (ils ne sont pas interprétés : une séquence échappée y resterait
illisible), et doubler les antislashs des chemins Windows dans les chaînes (`'C:\\dossier'`). Alternative : passer
le script **en ligne** avec le paramètre `script` du Workflow.
