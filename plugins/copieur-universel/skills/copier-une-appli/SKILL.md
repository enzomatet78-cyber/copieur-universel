---
name: copier-une-appli
description: "POINT D'ENTRÉE obligatoire dès que l'utilisateur veut copier, cloner, recréer, reproduire, refaire ou imiter une application existante en local : appli web (SaaS, tableau de bord, back-office, site derrière une connexion ou public) ou logiciel de bureau (Electron, WebView2, Windows natif WPF/WinForms/Win32, Qt…). À utiliser même si la demande est vague ou ne nomme pas ce skill : « copie l'appli X », « clone ce site », « recrée le dashboard de mon logiciel », « refais cette page », « refais l'écran principal de Notepad », « fais-moi la même appli », « reproduis cette page à l'identique », « je veux une réplique de… ». Il cadre la demande, choisit le bon playbook (web connecté, web public, Electron, natif, mobile non pris en charge), applique les règles (lecture seule, données fictives, aucun contournement) et orchestre reconnaissance, capture, construction, double vérification et livraison. EN: MANDATORY entry point whenever the user wants to copy, clone, recreate, replicate, rebuild or mimic an existing app locally — web apps (SaaS dashboards, logged-in or public sites) or desktop software (Electron, WebView2, native Windows) — e.g. clone this app, make a replica of this dashboard, rebuild this screen pixel-perfect, make me the same app. Use it even when the request is vague and does not name this skill."
---

# Copier une appli — point d'entrée

Ce skill est le chef d'orchestre du plugin **copieur-universel** (« Universal Modder, mais pour copier des
applis »). Il ne capture ni ne construit lui-même : il cadre la demande, choisit le bon chemin, fait respecter
les règles et enchaîne les autres skills dans le bon ordre.

Pourquoi un point d'entrée plutôt que « coder directement ce qu'on voit » ? Parce que la fidélité ne vient pas
de l'imagination mais de la **réalité capturée** (DOM rendu, arbre d'accessibilité, captures d'écran, mesures) ;
et parce que l'expérience de la recréation complète de l'appli iClosed a montré que l'ordre des étapes compte
plus que la vitesse : une fondation validée avant de paralléliser, une capture séquentielle, un propriétaire
unique par fichier commun, deux vérifications indépendantes. Sauter ces étapes produit des pages incohérentes
qu'on passe ensuite des heures à réaligner.

**Outils** : dossier `outils/` du plugin = `${CLAUDE_PLUGIN_ROOT}/outils/` ; si cette variable n'est pas
remplacée, utiliser `<Base directory de ce skill>\..\..\outils\` (résoudre en chemin absolu avant de lancer
une commande). Dans la suite, `OUTILS` désigne ce chemin absolu (cmd : `%OUTILS%`, bash : `$OUTILS`).

Fichiers de ce skill (relatifs à son Base directory) :
- `references/regles.md` — règles de sécurité et de légalité, à lire avant toute capture ;
- `references/orchestration.md` — méthode multi-agents, unités, Workflow ou agents simples, estimation ;
- `references/lecons.md` — pièges connus (symptôme → cause → solution) ;
- `assets/workflow-template.js` — script Workflow paramétrable (capture → construction → 2 vérifications →
  contrôle final → demandes de coque).

Skills du plugin (s'invoquent `/copieur-universel:<nom>` ou via l'outil Skill ; à défaut, lire
`<Base directory de ce skill>\..\<nom>\SKILL.md`) :

| Skill | Rôle |
|---|---|
| `copier-une-appli` | ce point d'entrée : cadrage, choix du playbook, règles, orchestration, livraison |
| `reconnaissance-appli` | identifier le type d'appli, inventorier écrans/routes/états, découper en unités |
| `capture-web` | capturer une appli web connectée (Claude in Chrome) ou publique (navigateur intégré, Chrome headless + `cdp_eval.py`) |
| `capture-bureau` | capturer un logiciel : Electron/WebView2 (CDP), natif Windows (UI Automation + captures de fenêtre) |
| `reconstruire-appli` | fondation (page de référence → coque partagée), gabarit de page, données fictives, conventions |
| `verifier-copie` | double vérification (mesures, textes, interactions, confidentialité), vérificateur adverse, contrôle final |

---

## Le déroulé en un coup d'œil

1. **Cadrage** — quoi copier, jusqu'où, avec quel compte, où ranger le clone ; annoncer durée et coût.
2. **Choix du playbook** — web connecté / web public / Electron-WebView2 / natif / mobile (non pris en charge).
3. **Reconnaissance** — type d'appli, inventaire des écrans et états, découpage en unités → `reconnaissance-appli`.
4. **Fondation** — capturer et recréer UNE page de référence, la faire valider par deux passes de vérification,
   en extraire la coque partagée et les données fictives → `capture-*`, `reconstruire-appli`, `verifier-copie`.
5. **Capture séquentielle + construction parallèle** — une unité capturée à la fois, un constructeur par unité,
   un propriétaire unique par fichier de section.
6. **Deux vérifications par unité, puis contrôle final** du site entier et application des demandes de
   modification de la coque → `verifier-copie`.
7. **Livraison** — serveur local ou lanceur, compte rendu honnête.

Pour une seule page ou un seul écran, les étapes restent les mêmes mais tiennent en une session : la
« fondation » est alors la livraison elle-même (capture → recréation → deux vérifications).

---

## Étape 1 — Cadrage

Avant de toucher à quoi que ce soit, obtenir (en un seul message, avec des valeurs par défaut proposées) :

- **Quelle appli et quelle portée** : l'appli entière, une section, une page, un écran ? Une portée floue
  (« toute l'appli ») sur un gros logiciel peut représenter des dizaines d'écrans : proposer de commencer par
  l'écran principal, puis d'étendre.
- **Où est l'original** : URL, ou logiciel installé (chemin de l'exe, nom du processus).
- **Connexion** : l'appli demande-t-elle un compte ? Si oui, c'est **l'utilisateur** qui se connecte dans son
  propre navigateur ; l'agent ne saisit jamais d'identifiants. Le compte réel est exploré en lecture seule stricte.
- **Données** : fictives par défaut pour toute donnée personnelle (clients, contacts, messages…). On peut garder
  le nom du titulaire du compte, son organisation, ses réglages propres et les chiffres agrégés si l'utilisateur
  le souhaite — demander lesquels.
- **Usage** : personnel, local (apprentissage, prototypage, maquette). Si l'utilisateur veut publier le clone
  ou le faire passer pour l'original, s'arrêter et lire `references/regles.md`.
- **Emplacement** : dossier du clone (par défaut un nouveau dossier à côté du projet courant) et port local
  libre (ex. 8770). Les captures vont dans un **dossier de travail hors du clone** (le scratchpad de la session
  s'il existe) : elles ne doivent pas être servies ni livrées avec le clone.
- **Mode d'exécution** : seul, avec quelques agents, ou en Workflow multi-agents (voir plus bas) — et
  l'estimation de durée et de coût correspondante.

Pourquoi tout demander d'abord : chaque réponse change le playbook (navigateur réel ou profil vierge,
anonymisation, nombre d'agents). Une hypothèse fausse découverte après la capture coûte une capture entière.

---

## Étape 2 — Choisir le playbook

Si le type n'est pas évident, lancer d'abord la détection (`reconnaissance-appli`) :
`powershell -NoProfile -ExecutionPolicy Bypass -File "<OUTILS>\detect_app.ps1" -Path "<dossier ou exe>"`
(ou `-ProcessName <nom>`) → JSON avec le framework probable et les indices.

| Situation | Capture | Reconstruction |
|---|---|---|
| **Appli web derrière une connexion** (compte de l'utilisateur) | `capture-web`, mode connecté : Claude in Chrome dans le Chrome de l'utilisateur, qui s'est connecté lui-même ; lecture seule stricte ; anonymisation avant chaque capture | pages HTML/CSS/JS statiques servies en local |
| **Site ou appli web public** | `capture-web`, mode public : navigateur intégré (son propre onglet) ou Chrome/Edge headless sur profil temporaire + `cdp_eval.py` ; pas de connexion, pas de crawl massif | idem |
| **Logiciel Electron**, WebView2 (dont Tauri sous Windows) | `capture-bureau`, mode CDP : relancer l'appli avec `--remote-debugging-port` (WebView2 : variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) et un dossier de données temporaire si possible, puis `cdp_eval.py` + `capture-kit.js` | idem (l'interface est du web) + lanceur en fenêtre d'appli (`lancer-app.cmd`, Edge `--app`) |
| **Logiciel Windows natif** (Win32, WPF, WinForms, UWP/WinUI, Qt, Java) | `capture-bureau`, mode natif : `uia_dump.ps1` (arbre UI Automation) + `window_shot.ps1` (captures de fenêtre) + exploration prudente des menus (computer-use si disponible) | recréation HTML/CSS imitant les contrôles natifs, ouverte en fenêtre d'appli via Edge `--app` |
| **Appli mobile native** (iOS/Android) | non pris en charge : pas d'outil pour piloter ou inspecter un téléphone | proposer la version web de l'appli si elle existe ; sinon une recréation à partir de captures d'écran fournies par l'utilisateur, en annonçant une fidélité réduite (aucune mesure, aucun texte exact garanti) |
| **Contenu dessiné** (canvas, WebGL, jeux, éditeurs graphiques, vidéo) | partiel : le DOM ne contient rien d'exploitable | coque et panneaux recréés fidèlement, zone dessinée approximée à partir des images — le dire |

Cas particuliers :
- **« Mon propre logiciel »** dont l'utilisateur possède le code source : lire ce code est permis (c'est le sien) ;
  les interdits de `regles.md` concernent le code propriétaire de tiers. Demander simplement s'il a les sources.
- **Applis qui exigent un contournement** (paywall, licence, DRM, CAPTCHA, anti-bot) : on capture seulement ce
  qui est accessible normalement, on ne contourne rien.

---

## Étape 3 — Reconnaissance

Charger `reconnaissance-appli`. Elle produit, dans le dossier de travail :
- `inventaire.md` : écrans/routes, états (onglets, modales, menus, états vides), ce qui est commun (navigation,
  en-têtes de section), redirections et pages introuvables ;
- le **découpage en unités** : groupes de 2 à 6 écrans d'une même section, avec pour chaque section une unité
  **propriétaire** des fichiers communs (voir `references/orchestration.md`).

Pour une SPA, l'inventaire des routes vient du bundle (`routes-from-bundle.js` injecté dans la page) puis d'une
visite pour éliminer redirections et 404 — lire un bundle pour lister des routes est de la reconnaissance,
pas de la copie de code.

Elle écrit aussi `unites.json` (format du gabarit Workflow) et `fondation.json` (la page de référence, absente
de `unites.json`) ; pour une seule page, `fondation.json` seul et `unites.json` vide.

Logiciel de bureau : c'est l'agent principal qui le lance pour la capture, selon `capture-bureau` (profil ou
dossier de données temporaire, mises à jour automatiques bloquées, port de débogage pour Electron), et qui
note **son PID et le handle de sa fenêtre** dans le `notes.md` de la capture, puis dans le GUIDE du projet
quand il l'écrit. Les agents visent ensuite ce PID (`-ProcessId`), jamais une instance ouverte par
l'utilisateur, et lui seul sera fermé à la fin.

---

## Étape 4 — Fondation (toujours avant de paralléliser)

1. Choisir la page de référence : la plus représentative de la coque (navigation complète, en-tête, menus,
   barre latérale), idéalement la page d'accueil.
2. La capturer à fond (`capture-web` ou `capture-bureau`) : chaque état, survols, menu utilisateur, version
   repliée, petits écrans.
3. La recréer (`reconstruire-appli`, partie fondation), puis la faire passer par **deux vérifications
   indépendantes** (`verifier-copie`) — de préférence relecteurs par angle + vérificateur adverse.
4. En extraire la **coque partagée** (navigation, menus, icônes, styles, utilitaires, configuration Tailwind
   éventuelle) et les **données fictives** communes, et écrire le **GUIDE du projet** (gabarit de page, API de la
   coque, conventions de liens, données, règles) que liront tous les agents suivants — modèle :
   `reconstruire-appli/references/conventions.md` §9 ; contenu attendu : `references/orchestration.md` §3.
5. Montrer la page de référence à l'utilisateur et attendre son accord.

Pourquoi : chaque défaut de la coque se répète sur toutes les pages. Une erreur corrigée dans la fondation
coûte une correction ; la même erreur découverte après la construction parallèle en coûte des dizaines, et
les agents qui ont contourné le défaut chacun à leur façon rendent le site incohérent.

---

## Étape 5 — Capture séquentielle et construction parallèle

- **Capture séquentielle** : un seul navigateur réel (ou une seule instance du logiciel) est pilotable à la fois ;
  deux agents qui s'y croisent naviguent l'un sous l'autre et capturent des pages mélangées. On capture donc une
  unité après l'autre, en lecture seule, anonymisée.
- **Construction parallèle** : dès qu'une unité est capturée, son constructeur démarre, pendant que la capture
  suivante continue. Chaque constructeur vérifie ses pages dans le navigateur intégré, dans **son propre onglet**.
- **Propriétaires de section** : les fichiers communs d'une section (`assets/sections/<section>.js|css`) sont
  écrits par un seul agent ; les autres unités de la section attendent sa construction et signalent leurs besoins
  (`sectionIssues`) au lieu de modifier ces fichiers. La coque, elle, n'est modifiée par personne pendant cette
  phase (besoins → `shellIssues`).

Selon la taille, faire cela soi-même, avec l'outil Agent, ou avec `assets/workflow-template.js` (voir
« Mode d'exécution »).

---

## Étape 6 — Vérifications et contrôle final

- **Deux passes par unité** (`verifier-copie`) : la deuxième repart de zéro sans se fier à la première. Chaque
  passe compare au capturé (mise en page mesurée, textes mot à mot, interactions, confidentialité) et corrige
  elle-même les pages de son unité.
- **Contrôle final du site** : toutes les pages se chargent sans erreur console, liens internes valides,
  navigation cohérente, aucune donnée personnelle réelle ni secret :
  - `py "%OUTILS%\check_links.py" --root "<CLONE>" --base http://localhost:<PORT> --original <hôte de l'original>`
    (`--original` pour une appli web : toute référence à l'original est signalée ; un lien ou un script vers
    lui se corrige, une image ou une police publique peut rester) ;
  - `py "%OUTILS%\scan_pii.py" --root "<CLONE>" --allow "<email du titulaire gardé>" --allow-domain "exemple.*"`
    (code retour non nul = quelque chose a été trouvé : regarder le rapport, corriger ou ajouter à la liste blanche
    seulement ce qui est fictif ou explicitement gardé).
- **Demandes de modification de la coque** : un seul agent trie les `shellIssues`/`sectionIssues` collectés,
  applique celles qui sont fondées, puis revérifie la page de référence et un échantillon de pages par section.

Mesure de fidélité très parlante : même `scrollHeight` du conteneur principal que l'original, mêmes positions
clés (`getBoundingClientRect`), mêmes textes caractère par caractère.

---

## Étape 7 — Livraison

- **Servir le clone en local**, sur la boucle locale uniquement :
  `py -m http.server <PORT> --bind 127.0.0.1 --directory "<CLONE>"` (en arrière-plan : Bash `run_in_background`,
  ou une entrée `.claude/launch.json` + `preview_start` pour l'ouvrir dans le navigateur intégré). Pour un
  logiciel, `lancer-app.cmd --serveur` fait la même chose.
- **Logiciel de bureau** : fournir le lanceur `lancer-app.cmd` (skill `reconstruire-appli`) qui ouvre le clone
  dans une fenêtre d'appli Edge à la bonne taille (réglages `CU_*` en tête du fichier, taille **extérieure** de
  la fenêtre ; le tester avec `--verifier` avant de le livrer — depuis Git Bash :
  `cmd //c "<CLONE>\lancer-app.cmd" --verifier`).
- **Ranger ce qu'on a lancé** : le logiciel ou le Chrome headless ouverts pour la capture (par leur PID ou leur
  profil notés — `headless.ps1 -Action fermer` pour le headless —, jamais une instance de l'utilisateur), puis
  leurs profils temporaires ; un installeur de mise à jour lancé par l'appli n'est pas arrêté (on le signale) ;
  à la fin d'une capture connectée, l'onglet piloté est laissé sur une page neutre. Le serveur local du clone
  reste lancé si l'utilisateur veut le consulter tout de suite.
- **Compte rendu** (dans la langue de l'utilisateur, honnête, sans enjoliver) :
  - ce qui a été recréé (liste des pages/écrans, URL locale, comment lancer) ;
  - ce qui est fidèle et vérifié (deux passes, mesures clés) ;
  - les **écarts restants** connus, et pourquoi (non capturable, choix volontaire, manque de temps) ;
  - les **limites** : données fictives, actions sans effet (enregistrer, envoyer…), contenus dessinés approximés,
    images éventuellement chargées depuis l'original ;
  - les règles d'usage (personnel, local, ne pas publier).

Ne jamais annoncer « identique à 100 % » : dire ce qui a été mesuré et ce qui ne l'a pas été.

---

## Mode d'exécution : seul, agents ou Workflow

| Taille | Mode conseillé | Pourquoi |
|---|---|---|
| 1 page / 1 écran | seul dans la session, + 1 ou 2 agents de vérification (outil Agent) | la coordination coûterait plus que le travail |
| 2 à ~8 pages, 1 à 2 sections | seul pour la fondation, puis outil Agent : captures une par une, constructeurs en parallèle (en arrière-plan), vérifications | parallélisme utile, orchestration encore lisible à la main |
| Appli complète (plusieurs sections, dizaines de pages) | **Workflow** avec `assets/workflow-template.js` | contrôle déterministe (capture séquentielle, verrous de section, 2 passes, contrôle final), reprise possible |

Le Workflow n'est utilisé que si l'outil est disponible **et** que l'utilisateur l'a accepté : mode ultracode
actif, ou accord explicite après l'annonce du nombre d'agents et du coût. Sans cet accord, faire la même
orchestration à la main avec l'outil Agent. Détails, remplissage du gabarit et reprise :
`references/orchestration.md`. **Sans outil Agent ni Workflow** (sous-agent, session limitée) : tout faire
seul, dans le même ordre, avec des vérifications appuyées sur des preuves mécaniques (images comparées au
pixel, textes, console, liens, confidentialité), et dire dans le compte rendu que la vérification n'a pas été
faite par un tiers (`verifier-copie` §2, mode dégradé).

**Estimation à annoncer avant de démarrer** (ordres de grandeur indicatifs, à présenter comme tels) :
- nombre d'agents ≈ 4 par unité (capture, construction, 2 vérifications) + 2 (contrôle final, coque), plus
  la fondation (≈ 2 + 2 × (relecteurs + vérificateurs adverses + correcteur)) ;
- la capture étant séquentielle, elle fixe la durée : compter de l'ordre de 15 à 45 minutes par unité selon
  le nombre d'états ; une appli de 15 unités occupe donc plusieurs heures ;
- le coût en jetons croît avec le nombre d'agents et la taille des captures : une appli complète est une
  opération coûteuse, d'où l'intérêt de proposer d'abord une page ou une section.

---

## Règles essentielles (détail et justification : `references/regles.md`)

- **Usage personnel et local** ; ne pas publier le clone ni le présenter comme l'original ; pas de formulaire de
  connexion ou de paiement fonctionnel imitant l'original.
- **Reconstruire à partir de ce qu'on observe** (DOM rendu, captures, arbre d'accessibilité) ; ne pas
  décompiler de binaires ni recopier le code source propriétaire (bundles JS, assemblies).
- **Aucun contournement** : connexion, licence, DRM, paywall, anti-bot/CAPTCHA, limites de débit ; pas de crawl
  massif.
- **Compte réel = lecture seule stricte** ; l'utilisateur se connecte lui-même ; l'agent ne saisit jamais
  d'identifiants.
- **Données personnelles fictives par défaut**, anonymisation **avant** toute capture d'écran et tout dump ;
  secrets jamais copiés.
- **Logiciels de bureau** : profil/dossier de données temporaire quand c'est possible, ne rien enregistrer ni
  modifier, ne fermer que les processus qu'on a lancés.
- Respect de la vie privée des tiers ; pas d'appli dont l'usage serait illégal.

Ces règles priment sur la fidélité : un élément qu'on ne peut capturer qu'en enfreignant une règle est décrit
dans les notes et approximé, pas capturé.

---

## Pièges les plus fréquents (liste complète : `references/lecons.md`)

- Chrome masqué ou onglet en arrière-plan : la SPA ne se dessine pas → capture d'écran à petite échelle, attente
  de 3–4 s, nouvelle capture, puis seulement lecture du DOM ; un seul onglet au premier plan.
- Filtre de sortie de l'extension Claude in Chrome : chaînes tronquées ou « [BLOCKED…] » → échappements et
  morceaux ≤ 900 caractères (le kit de capture le fait ; inverser en écrivant les fichiers). À l'inverse, avec
  `cdp_eval.py` (Chrome headless, Electron), le kit doit passer en mode brut — `__config({raw:true})` — sinon
  le fichier de sortie ne contient que le nombre de morceaux.
- Agents parallèles dans le même onglet ou sur le même fichier commun → chacun son onglet (`tabId`),
  propriétaire unique par fichier.
- Script Workflow avec accents lancé par `scriptPath` refusé (« control characters ») → garder le script en ASCII
  pur (`\uXXXX`), comme le gabarit.
- Barres de défilement fines qui deviennent épaisses dans Chromium (`scrollbar-width` désactive
  `::-webkit-scrollbar`) → mettre `scrollbar-width` sous `@supports not selector(::-webkit-scrollbar)`.
- Logiciel lancé pour la capture qui installe sa mise à jour (vu avec VS Code) → bloquer les mises à jour dans
  le profil temporaire **avant** le lancement, ne jamais tuer un installeur (`capture-bureau` §3 et §10).
- Sous-menu « Récent » d'un logiciel : il montre les fichiers de l'utilisateur → ne pas l'ouvrir (l'outil
  refuse), le décrire.
- Git Bash convertit les arguments qui commencent par `/` (`/app/x` → `C:/Program Files/Git/app/x`) → écrire
  les routes sans `/` initial quand l'outil l'accepte, ou `MSYS_NO_PATHCONV=1` devant la commande.

---

## Livrables attendus

```
<CLONE>/                        servi tel quel (racine du serveur local)
  index.html                    redirection vers la page d'accueil de l'appli
  app/<route>/index.html        appli web : une page par route (/x → app/x/, sans doubler un préfixe /app)
  ecrans/<ecran>/index.html     logiciel de bureau : un écran par fenêtre ou grande vue
  assets/shell-base.js|css      coque générique (copie du skill reconstruire-appli, jamais modifiée)
  assets/shell.js|css           coque propre à l'appli (navigation, menus, icônes, classes relevées)
  assets/tailwind-config.js     police et palette relevées (si l'original utilise Tailwind)
  assets/fake-data.js           données fictives déterministes (graine fixe)
  assets/sections/<s>.js|css    éléments communs d'une section (propriétaire unique)
  lancer-app.cmd                (logiciel de bureau) ouverture en fenêtre d'appli
<TRAVAIL>/                      hors du clone, non livré
  GUIDE.md, inventaire.md, unites.json, fondation.json, reconnaissance/,
  capture/<unité>/<page>/ (notes.md, dom-*.html | uia-*.json, images), verif/ (mesures, rapports)
```

Et le compte rendu final décrit à l'étape 7.

---

## Quand dire non ou réorienter

- Demande de clone destiné à tromper (page de connexion imitant une banque, faux site marchand, usurpation
  d'une marque) : refuser, même « pour un test ».
- Demande de récupérer les données d'autres personnes via l'appli (export de contacts, aspiration de profils) :
  ce n'est pas une copie d'interface ; refuser cette partie.
- Contournement demandé (« passe le paywall », « désactive la licence ») : refuser cette partie, proposer de
  copier ce qui est accessible normalement.
- Appli mobile native : expliquer la limite et proposer les alternatives de l'étape 2.
