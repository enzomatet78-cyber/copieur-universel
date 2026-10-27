---
name: reconnaissance-appli
description: "Reconnaissance d'une appli à copier (étape 3 de copier-une-appli, le point d'entrée) : identifie sa technologie (SPA React/Vue/Angular/Next/Nuxt/Svelte, site multipage, Electron, WebView2, Tauri, .NET WPF/WinForms, WinUI/UWP, Qt, Java, Flutter, macOS AppKit/SwiftUI/Catalyst…), inventorie tous ses écrans, routes et états (onglets, modales, menus, tiroirs, états vides) et leur statut réel, repère ce qui est commun (navigation, en-têtes de section, palette, icônes, polices) et découpe le travail en unités avec un propriétaire par section. À charger AVANT toute capture ou reconstruction dès qu'on copie, clone, recrée, reproduit ou refait une appli, un site, un logiciel ou un tableau de bord, et aussi seul pour : « c'est fait en quoi ce logiciel ? », « est-ce de l'Electron ? », « quelles pages/routes a cette appli ? », « liste les écrans de cette SPA », « combien d'écrans à refaire ? », « par où commencer pour copier X ? ». Outils : routes-from-bundle.js (routes, technologie, inventaire d'écran), detect_app.ps1 (framework d'un exe, Windows) et detect_app_mac.py (framework d'un .app, macOS). EN: Recon step of copier-une-appli (the entry point) for cloning an app: detect its stack (SPA framework, Electron, WebView2, native Windows or macOS), inventory every screen, route and state, find the shared shell and split the work into units. Load it before capturing or rebuilding whenever an app, website, desktop software or dashboard is being copied, cloned or replicated, and on its own when the user asks what an app is built with, which routes/pages/screens it has, or how big a clone would be."
---

# Reconnaissance d'une appli

Cette étape vient juste après le cadrage et le choix du playbook du skill `copier-une-appli` (étape 3 de son
déroulé) et avant toute capture. Si ce skill est chargé seul (« c'est fait en quoi ? », « combien d'écrans ? »),
les parties utiles suffisent ; dès qu'il s'agit de copier, `copier-une-appli` reste le point d'entrée (cadrage,
règles, accord sur le périmètre). La reconnaissance répond à quatre questions, dans cet ordre :
1. **De quoi est faite l'appli ?** (web SPA ou multipage, Electron, WebView2, natif…, et avec quels styles,
   composants, icônes, polices)
2. **Quels écrans, routes et états existe-t-il ?** (avec un statut vérifié pour chacun)
3. **Qu'est-ce qui est commun ?** (coque globale, en-têtes de section)
4. **Comment découper le travail ?** (unités, propriétaires de section, ordre)

Pourquoi y passer du temps : sur iClosed, l'inventaire tiré du bundle a révélé des dizaines de routes qu'aucun
menu ne montrait, la visite a éliminé redirections et pages mortes avant qu'un agent ne les « recrée », savoir que
l'appli utilisait Tailwind + Tabler a dicté toute la reconstruction (classes recopiées, CDN, icônes), et le
découpage en unités avec **un propriétaire par section** a permis de construire en parallèle sans que deux agents
écrivent le même fichier. Une reconnaissance bâclée se paie plus tard en captures refaites et en pages
incohérentes.

**Outils** : `OUTILS="${CLAUDE_PLUGIN_ROOT}/outils"` ; si cette variable n'est pas remplacée,
`<Base directory de ce skill>/../../outils` (résoudre en chemin absolu avant de lancer une commande). Dans la
suite, `$OUTILS` désigne ce chemin absolu et `$TRAVAIL` le dossier de travail hors du clone (le scratchpad de la
session s'il existe). Les commandes sont écrites pour l'outil Bash (bash/zsh sous macOS, Git Bash sous Windows),
chemins entre guillemets ; chaque appel Bash est un nouveau shell : y réécrire en clair les valeurs notées (port,
profil, PID). Sous Windows, `py` remplace `python3` (lanceur Python de Windows).

Outils utilisés ici :
- `routes-from-bundle.js` — kit injectable (web, Electron, WebView2) : `__stack()`, `__routes()`,
  `__routesText()`, `__inventory()`, `__routeStatus()`, `__out()`. Détails : `references/kit-web.md`.
- `detect_app.ps1` (Windows uniquement) et `detect_app_mac.py` (macOS) — détection d'un logiciel installé ou
  ouvert, sans rien lancer. Détails : `references/detection-bureau.md`.
- `headless.py` — Chrome/Edge headless sur profil temporaire (`lancer`, `etat`, `fermer`, `trouver`). Windows :
  `headless.ps1` reste disponible (mêmes actions).
- `cdp_eval.py` — pour piloter Chrome/Edge headless ou une appli Electron par CDP (voir `capture-web`,
  `capture-bureau`).
- Modèles des livrables : `references/modele-inventaire.md`.

---

## Livrables
Dans `TRAVAIL` (jamais dans le dossier du clone : rien de tout cela ne doit être servi ni livré) :
- `reconnaissance/` : `stack.json`, `routes.json` + `routes.txt` (web), `detect.json` (bureau),
  `inv-<slug>.json` (un inventaire par écran visité) ;
- `inventaire.md` : technologie, éléments communs mesurés, tableau écrans/routes/états/statuts, routes écartées,
  unités, page de référence, questions ouvertes ;
- `unites.json` : le découpage, au format du gabarit Workflow (`key, section, owner, shared, nav, routes, notes`),
  et `fondation.json` : la page de référence, au même format (voir partie D) ;
- un **compte rendu court à l'utilisateur** (voir la fin) avant de passer à la fondation.

## Règles propres à cette étape
Elles découlent de `copier-une-appli/references/regles.md` ; les voici appliquées à la reconnaissance :
- **Lecture seule.** Observer, ouvrir puis refermer ; ne jamais enregistrer, créer, envoyer, supprimer, basculer un
  interrupteur. Les listes `aEviter` (routes) et `nePasCliquer` (boutons) des outils sont des garde-fous : les
  recopier dans les notes des unités.
- **Rythme humain, pas de crawl.** Une route à la fois, dans l'onglet au premier plan. Le kit lit les fichiers
  statiques référencés par la page, plus quelques manifestes standard sondés (4 à 8 requêtes : un 404 est ignoré
  mais reste dans les journaux du site) et des chunks devinés, avec le cache du navigateur, plafonnés à 120 par
  défaut et jusqu'à 6 en parallèle (`concurrency: 2` sur un site public) ; il n'appelle aucune API. Sur un site
  public, ne pas visiter par parcours automatique les chemins interdits par `robots.txt`.
- **Lire un bundle sert à lister des routes**, c'est de la reconnaissance ; ne rien en recopier dans le clone (ni
  code, ni textes, ni données) : le clone se reconstruit à partir de l'écran rendu.
- **Aucun contournement** : une route qui exige un autre rôle, une offre supérieure ou une connexion est notée
  « non accessible » ou « connexion », point.
- **Données personnelles et secrets** : l'inventaire décrit des écrans, pas des personnes. Les outils masquent
  emails et téléphones ; ne noter ni noms de clients, ni identifiants réels (une route `/contacts/8f3a…` devient
  `/contacts/:id`), ni aucun secret aperçu en chemin (clé d'API dans un bundle, jeton dans une URL).
- **Logiciels** : `detect_app.ps1` et `detect_app_mac.py` ne lancent rien. Lancer l'appli seulement selon
  `capture-bureau` (profil ou dossier de données temporaire, document de test), noter son PID, ne fermer que lui
  (macOS : le binaire lui-même, jamais `open -a`, qui ne rend pas de PID et peut réutiliser l'instance de
  l'utilisateur).

---

## Étape 0 — Web ou bureau ?
| L'utilisateur donne… | Voie | Première commande |
|---|---|---|
| une URL d'appli où il est connecté | web connecté (Claude in Chrome, son navigateur) | partie A |
| une URL publique | web public (navigateur intégré, ou Chrome headless + `cdp_eval.py`) | partie A |
| un logiciel installé (nom, raccourci, dossier, exe, .app) ou ouvert | bureau | partie B : `detect_app.ps1` (Windows), `detect_app_mac.py` (macOS) |
| une appli mobile (y compris une appli iPhone installée sur un Mac) | non prise en charge | proposer sa version web, ou une recréation d'après captures fournies (fidélité réduite) |

Un logiciel détecté `electron`, `cef` ou `nwjs` (et, sous Windows, `webview2` ou `tauri`) repasse ensuite par la
partie A : son interface **est** une page web, inspectable par CDP. Sous macOS, Tauri (WKWebView), Catalyst et
les applis natives n'ont pas de port de débogage : voie images (B1).

---

## Partie A — Appli web

### A1. Préparer l'onglet
Suivre `capture-web` pour ouvrir l'appli : appli connectée → Claude in Chrome dans le navigateur de l'utilisateur,
qui s'est connecté lui-même ; site public → son propre onglet du navigateur intégré, ou Chrome headless sur profil
temporaire. Noter le **viewport réel** (`innerWidth × innerHeight`) : c'est la référence des mesures. En
headless, la fenêtre retire une marge à `--window-size`, variable selon l'OS (Windows : `1536,791` demandé →
viewport 1518×695 ; macOS : 0 px en largeur, 87 px en hauteur) : toujours régler par `cdp_eval.py size`.
`python3 "$OUTILS/headless.py" lancer` le fait (1536×791 par défaut) et renvoie une ligne JSON dont on note
`port` et `profil` en clair pour la fermeture (`python3 "$OUTILS/headless.py" fermer --profil "<profil noté>"
--port <port>` ; `capture-web/references/sites-publics.md` §2.1 et §2.4). Jamais `open -a "Google Chrome"` ni un
navigateur sans `--headless=new` et profil temporaire : il s'ouvrirait avec les sessions de l'utilisateur.
Fenêtre Chrome masquée : la SPA peut ne pas se dessiner ; faire une capture d'écran réduite, attendre 3–4 s,
recommencer, puis seulement lire le DOM (leçon d'iClosed).

### A2. Identifier la technologie — `__stack()`
Injecter `$OUTILS/routes-from-bundle.js` (contenu du fichier → `javascript_tool`, ou `--file` de `cdp_eval.py`,
réponse `"routes ok"`), puis `__stack()` → `reconnaissance/stack.json`. Le fichier (≈ 65 Ko) dépasse ce qu'un
Read rend par défaut : un Read tronqué donne une erreur de syntaxe ou un kit absent. Recette exacte (Read
complet, numéros de ligne retirés, réponse vérifiée), attente des promesses et découpage `__out` pour Claude in
Chrome : `references/kit-web.md` §2.

Ce que la réponse change pour la suite :
| `__stack()` révèle | Conséquence |
|---|---|
| React/Vue/Angular/Svelte + routeur `history` | SPA : routes dans les bundles → A3 rapporte gros |
| rien de tout cela, `generator` WordPress/Rails… | site multipage : inventaire par la navigation (A4) |
| routeur `hash` | URL de la forme `#/x` : le clone devra le reproduire ou le simplifier (le noter) |
| Tailwind (v3/v4, part des classes, valeurs arbitraires) | recopier les classes du DOM + CDN Tailwind ; vérifier la palette |
| « classes utilitaires : Tailwind ou Bootstrap ? » | trancher avant de choisir un CDN : variables `--tw-*`, préfixes `md:`/`hover:` (Tailwind) ou `--bs-*` (Bootstrap) |
| MUI, Chakra, Ant, Bootstrap, Mantine, CSS Modules, styled-components | classes non réutilisables : reconstruire avec les styles calculés (le noter) |
| Radix, Headless UI, React Aria | menus/modales/popovers accessibles : reproduire leurs états `data-state`, `aria-expanded` |
| icônes Tabler, Lucide, Heroicons, Material… | même jeu libre dans le clone ; « SVG inline non reconnu » → recopier les SVG capturés |
| polices chargées, Google Fonts | mêmes polices et graisses dans la coque |
| couleurs dominantes, variables de `:root` | base de la palette de la coque |
| alertes : canvas, iframes, shadow DOM, Flutter Web | zones non capturables par le DOM : prévoir captures d'écran et approximation, le dire à l'utilisateur |
| widgets tiers (chat, vidéo, cookies) | recréés en statique ou laissés de côté ; jamais connectés au service réel |

### A3. Inventorier les routes — `__routes()`
Choisir le **préfixe** commun des URL de l'appli (`/app`, `/dashboard`… : celui de la page courante) : il élimine
le bruit des bibliothèques. Lancer `__routes({prefix: '/app'})`, enregistrer `routes.json` et
`__routesText()` → `routes.txt`.

Lire les listes de la plus sûre à la moins sûre (détail : `references/kit-web.md`) :
`routes` (définitions) → `relatives` / `aVerifier` (segments enfants : hypothèses) → `liens` → `chaines` (bruit
possible). `dynamiques` demandent un identifiant réel, qu'on obtiendra en ouvrant un élément d'une liste — jamais en
inventant. `aEviter` ne se visite pas. `noms` et `ecrans` aident à nommer les écrans et les unités.

Si la liste est maigre (site multipage, Next.js routeur app, Electron en `file://`, bundles sur un CDN sans CORS),
ce n'est pas un échec : la partie A4 s'appuie alors sur la navigation. Sur un site public, `/sitemap.xml` (une
seule requête) complète utilement.

### A4. Visiter pour qualifier chaque route
Une route à la fois, dans le même onglet au premier plan :
1. `navigate` vers la route (pas de `history.pushState` scripté : il provoque des rechargements) ;
2. attendre le rendu (cf. A1), réinjecter le kit (Claude in Chrome : réinjection courte, `references/kit-web.md`
   §2a) ;
3. `__routeStatus('/app/x')` → `ok`, `redirection`, `404`, `connexion`, ou `chargement ?` (attendre, relancer).
   C'est un indice : relire `titre` et `h1` avant de reporter le statut (un état vide « introuvable » peut
   passer pour un 404) ;
4. `__inventory()` → `inv-<slug>.json`. Il lit le **texte affiché** : sur un compte réel, la navigation et
   les listes contiennent des noms de personnes (titulaire, collègues, clients). Avant de l'écrire sur disque,
   injecter aussi `$OUTILS/capture-kit.js`, relire `__guessNames()`, puis `__addNames([...])` et `__anonLive()` :
   l'inventaire lit alors les noms fictifs, comme la future capture (même onglet, même dictionnaire). À défaut,
   garder l'inventaire dans la conversation et n'écrire dans `inventaire.md` que la structure ;
5. reporter dans le tableau de l'inventaire : statut, titre exact de l'onglet, états, boutons à ne pas cliquer.

Commencer par l'écran d'accueil : son `__inventory().navigation` donne la carte des sections (liens de la barre
latérale ou de l'en-tête, élément actif marqué `*`). Les routes vues dans la navigation mais absentes du bundle
s'ajoutent à la liste ; les routes du bundle jamais liées sont souvent des pages cachées, anciennes ou réservées :
les visiter quand même (sauf `aEviter`) et noter le résultat. Une simple visite peut déjà agir quand l'URL porte
un verbe : `/connect`, `/oauth/callback`, `/export`, `/download`, `/switch-workspace/:id` lancent un flux OAuth,
un téléchargement ou changent l'espace actif. `aEviter` en écarte la plupart ; pour un nom ambigu qui y
échappe, demander à l'utilisateur plutôt que d'essayer.

Combien en visiter : toutes celles du périmètre. Pour une appli très vaste (> 60 routes), qualifier d'abord une
route par section, présenter la carte à l'utilisateur, et ne détailler que le périmètre retenu.

### A5. Lister les états de chaque écran
Un écran n'est pas une image : c'est un ensemble d'états, et chaque état oublié ici manquera au clone.
`__inventory()` en donne la plupart :
- `onglets`, `menus` (déroulants), `accordeons`, `etatsCandidats` (« Nouveau… », « Ajouter », « Filtres »,
  « Voir » : modales, tiroirs, formulaires à ouvrir **sans valider**) ;
- `tableaux` (colonnes, pagination, tri, recherche), `formulaires` (champs), `infobulles` ;
- `defilement` : un `scrollHeight` élevé = page longue, plusieurs captures nécessaires ;
- `nePasCliquer` : à recopier tel quel dans les notes de l'unité (les boutons qui valident un formulaire ou une
  modale déjà ouverte, « Créer », « OK », `submit`, y sont marqués « (validation) ») ;
- `dialoguesOuverts` : une modale est déjà ouverte (la fermer avant de mesurer).

Ajouter ce que l'outil ne voit pas : squelettes de chargement, états vides (« Aucun… »), erreurs de formulaire,
survols, barre latérale repliée, menu utilisateur, rendu à 375 px, mode sombre si l'appli en a un, animations
d'accueil, notifications/toasts.

---

## Partie B — Logiciel de bureau

### B1. Détecter le framework — `detect_app.ps1` (Windows) ou `detect_app_mac.py` (macOS)
**Windows** (`detect_app.ps1`, Windows uniquement) :
```
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -Path "<dossier, exe ou .lnk>" -Out "$TRAVAIL/reconnaissance/detect.json"
powershell -NoProfile -ExecutionPolicy Bypass -File "$OUTILS/detect_app.ps1" -ProcessName <nom>      (appli déjà ouverte)
```
Lire `resume`, `framework`, `confiance`, `indices`, `strategie` (voie de capture et commandes prêtes),
`ecransPresumes` (fichiers HTML d'une appli Electron, vues `.baml` d'une appli WPF), `donnees` (emplacements des
données : **ne jamais les ouvrir**). Si la confiance n'est pas « haute », relancer avec `-ProcessName` pendant que
l'appli est ouverte : les modules chargés (`Microsoft.UI.Xaml.dll`, `PresentationFramework`, `Qt6Core.dll`,
`EmbeddedBrowserWebView.dll`…) tranchent presque toujours. Viser l'instance que l'utilisateur a déjà ouverte est
sans risque ici (lecture de la liste des modules, rien d'autre) et évite de lancer l'appli pour rien. Un
`-Path` vers un lanceur du dossier Windows (`C:\Windows\System32\notepad.exe` sous Windows 11) est résolu seul :
l'outil analyse le paquet du Store installé, sans lancer l'appli. Les commandes de `strategie` repèrent le PID
(processus apparu au lancement) puis visent `-ProcessId <PID>` : celui de l'instance que `capture-bureau`
lancera, jamais celle de l'utilisateur ; pour Electron, elles bloquent aussi les mises à jour du profil.

**macOS** (`detect_app_mac.py`, Python standard, lecture seule) :
```
python3 "$OUTILS/detect_app_mac.py" --app "/Applications/<Appli>.app" --out "$TRAVAIL/reconnaissance/detect.json"
python3 "$OUTILS/detect_app_mac.py" --app "<Appli>"      (nom cherché dans /Applications, /System/Applications, ~/Applications, ~/Desktop, le PATH, puis Spotlight)
python3 "$OUTILS/detect_app_mac.py" --pid <PID>          (appli déjà ouverte ; pgrep -x "<Nom>" donne le PID)
```
Il lit `Contents/Info.plist`, la liste de `Contents/Frameworks` (Electron, CEF, NW.js, Qt, Flutter, Squirrel,
Sparkle), `app.asar` ou `app/`, les bibliothèques liées et la plateforme du binaire (ce qu'affichent `otool -L` et
`vtool -show-build`) et les chaînes de Tauri ; il ne lance rien. Lire `resume`, `framework`, `cdp` (port de
débogage possible ou non), `indices`, `ecransPresumes`, `misesAJour` (Squirrel/ShipIt, Sparkle), `donnees`
(existence seulement : **ne jamais les ouvrir**) et `strategie` (`voie` `cdp` ou `images`, commandes prêtes :
binaire lancé avec `--remote-debugging-port` et un `--user-data-dir` temporaire, `& echo $!` pour le PID).
Code 0 = reconnu, 1 = inconnu (relancer avec `--pid` appli ouverte), 2 = erreur d'usage. Détails et exemples
réels : `references/detection-bureau.md` §7.

| Famille | Exemples de `framework` | Suite |
|---|---|---|
| interface web | `electron`, `cef`, `nwjs` ; sous Windows aussi `webview2`, `tauri` | lancer selon `capture-bureau` avec port de débogage + profil temporaire, puis partie A via `cdp_eval.py` (cible = fenêtre principale) |
| natif bien exposé (Windows) | `wpf`, `winui3`, `uwp`, `winforms`, `maui` | UI Automation (`uia_dump.ps1`) + captures (`window_shot.ps1`) |
| natif partiellement exposé (Windows) | `qt`, `delphi`, `wx`, `avalonia`, `mfc`, `win32`, `gtk`, `tkinter` | UIA + captures, plus d'observation visuelle |
| peu ou pas exposé | `java`, `flutter`, moteurs de jeu | captures d'écran surtout ; fidélité réduite à annoncer |
| macOS sans CDP | `appkit`, `swiftui`, `catalyst`, `tauri` (WKWebView), `qt`, `java`, `flutter` | voie images : computer-use ou `screencapture` sur une fenêtre de **notre** PID ; fidélité réduite annoncée, aucune mesure garantie |
| appli iPhone/iPad sur Mac | `ios` | hors cible, comme une appli mobile |
| navigateur | `chromium-browser`, `gecko` (Firefox), `webkit-browser` (Safari) | ce n'est pas l'appli à copier : demander quel site → partie A |

Tableau complet des indices et des voies : `references/detection-bureau.md`.

### B2. Inventorier fenêtres, écrans et états
- **Interface web** (Electron…) : après le lancement par `capture-bureau`, `cdp_eval.py list` donne les cibles
  (fenêtres, vues intégrées) ; dans la cible principale, `__stack()`, `__routes()` (souvent un routeur à hachage),
  puis `__inventory()` sur chaque écran comme en A4. Les menus natifs de la fenêtre (Fichier, Édition…) ne sont pas
  dans le DOM : les relever en UIA (Windows) ; sous macOS, ils sont dans la barre de menus globale et les boutons
  de fenêtre sont dessinés par AppKit : les décrire, ou les lire avec computer-use (`app_menu`).
- **Natif (Windows)** : `uia_dump.ps1 -ProcessId <PID>` (l'instance lancée selon `capture-bureau`) sur la fenêtre
  principale ; l'arbre donne la barre de menus (`MenuItem`), les onglets (`TabItem`), la barre d'outils, le volet
  de navigation (`ListItem`/`TreeItem`), la barre d'état. Ouvrir chaque menu (`-Expand "Fichier"`), le relever,
  le refermer (`-CloseMenus` ou Échap) — commandes détaillées : `capture-bureau/references/natif.md` ; un élément terminé par « … » ouvre une boîte de dialogue : l'ouvrir, la relever, la
  capturer, Annuler/Échap. Ne jamais activer une commande qui agit (Enregistrer, Supprimer, Envoyer, Imprimer,
  Quitter sans enregistrer, Mettre à jour…), ni déplier le sous-menu des fichiers récents (fichiers de
  l'utilisateur ; l'outil le refuse).
- **Natif (macOS)** : aucun outil du plugin (`uia_dump.ps1`, `window_shot.ps1` sont Windows uniquement).
  Inventaire d'après images : computer-use (`app_screenshot`, `app_menu` pour la barre de menus globale,
  `app_ax_find`), ou `screencapture -x -o -l <id de fenêtre>` sur une fenêtre de **notre** PID (id de fenêtre et
  procédure : `capture-bureau/references/natif.md` §9). Les permissions Accessibilité et Enregistrement de l'écran (Réglages Système >
  Confidentialité et sécurité) sont accordées par l'utilisateur lui-même, jamais par l'agent. Pas de profil
  temporaire : l'appli ouvre les données de l'utilisateur (le lui dire avant de la lancer ; écrans sans données
  personnelles, ou masquées). Mêmes interdits qu'en UIA : ouvrir un menu, le relever, Échap ; ni commande qui
  agit, ni « Ouvrir l'élément récent ». Annoncer une fidélité réduite.
- Pour chaque fenêtre : titre, taille de référence, échelle d'affichage (DPI sous Windows, ×2 sur écran Retina),
  thème (clair/sombre de Windows ; Apparence de macOS : `defaults read -g AppleInterfaceStyle` répond `Dark`, ou
  une erreur en clair), états (menus, onglets, panneaux repliables, infobulles, menus contextuels, barre d'état).
- Nommer les écrans de façon stable (`fenetre-principale`, `dialogue-options>onglet-affichage`) : ces noms
  servent de « routes » dans `unites.json`.

---

## Partie C — Repérer ce qui est commun
La coque (ce qui se répète d'un écran à l'autre) sera construite **une seule fois**, dans la fondation ; chaque
défaut de la coque se répète sinon sur toutes les pages. La repérer maintenant permet de choisir la bonne page de
référence et d'écrire les bonnes consignes aux unités.

1. Comparer `__inventory().navigation` (ou l'arbre UIA, ou les captures d'un natif macOS) sur trois écrans de sections différentes : ce qui ne
   change pas est la **coque globale** (barre latérale, en-tête, menu utilisateur, lanceur de chat, pied de page) ;
   ce qui change est l'élément actif → une **clé `nav`** par entrée.
2. Comparer deux écrans d'une même section : ce qui ne change qu'entre sections est un **élément de section**
   (sous-navigation des Paramètres, en-tête avec onglets d'un module) → il aura un propriétaire.
3. Relever le style partagé : palette, polices, rayons, ombres, style des modales, infobulles, toasts, boutons,
   champs (via `__stack()` et quelques `getComputedStyle`).
4. Mesurer la coque : largeur de la barre latérale dépliée/repliée, hauteur de l'en-tête, marges du contenu
   (`getBoundingClientRect`), et noter ses états (repliée, menus ouverts, petits écrans).
5. Choisir la **page de référence** de la fondation : celle qui montre le plus de coque (navigation complète, menu
   utilisateur, widgets), idéalement l'accueil.

## Partie D — Découper en unités
Une **unité** = 2 à 6 écrans d'une même section, qu'un agent capture en 15–45 min puis qu'un autre reconstruit.
Pourquoi ce grain : assez petit pour qu'un agent tienne tout en tête et finisse, assez gros pour que la coordination
ne coûte pas plus que le travail.

Règles (issues d'iClosed) :
- **Un propriétaire par section** (`owner: true`) : il crée les fichiers communs de la section ; son `shared` décrit
  précisément ce commun, **y compris les entrées construites par d'autres unités** (sinon le menu de section sera
  incomplet). Les autres unités de la section attendent sa construction et signalent leurs besoins au lieu de
  modifier ses fichiers.
- **Ordre** : propriétaires d'abord, puis les unités qui débloquent les autres (celle qui découvre les routes d'un
  menu de paramètres, par exemple : lui demander dans ses `notes` de les écrire dans un fichier).
- **Écrans lourds seuls** : un formulaire de création à 11 sections, une grande modale à menu latéral, un tableau de
  bord très long forment leur propre unité.
- **Redirections** : rattachées à l'unité de leur cible ; **404** : nulle part (listées comme écartées) ;
  **même écran que** : dans l'unité de l'écran d'origine.
- **Notes d'unité** : états à couvrir, modales à ouvrir sans valider, nombre de lignes de tableau à garder (8),
  données à rendre fictives, **liste « ne pas cliquer »**, routes à découvrir, pièges vus pendant la visite.
- La fondation (page de référence) n'est pas une unité ordinaire : elle passe en premier, seule (voir
  `copier-une-appli`). Elle **ne figure pas** dans `unites.json` (sinon elle serait reconstruite une seconde
  fois) ; la décrire à part dans `fondation.json`, au même format (`key, section, nav, routes, notes`) : c'est
  le `config.fondation.unite` du gabarit Workflow.

Écrire `unites.json` au format de `references/modele-inventaire.md` : il se passe tel quel en `args.units` au
gabarit `copier-une-appli/assets/workflow-template.js`, ou sert de plan pour une orchestration à la main.
**Une seule page ou un seul écran** : `fondation.json` seul (la page est la fondation, et la livraison) et
`unites.json` = `[]`.

---

## Rendre compte à l'utilisateur
Avant de passer à la fondation, un message court :
- type et technologie (une ligne), et ce que ça implique (« Tailwind + Tabler : reconstruction très fidèle
  possible » ; « Java Swing : surtout d'après captures, fidélité réduite ») ;
- nombre d'écrans par statut (ok / redirections / 404 / non accessibles / à éviter) ;
- la coque repérée et la page de référence proposée ;
- les unités (tableau court) et l'estimation (agents, durée — ordres de grandeur, cf. `modele-inventaire.md`) ;
- les questions ouvertes (périmètre, données gardées réelles) et une proposition de réduction si c'est gros.
Attendre son accord avant la fondation.

## Critères de fin
- [ ] Technologie identifiée (`stack.json` et/ou `detect.json`) et ses conséquences écrites.
- [ ] Chaque route/écran du périmètre a un statut vérifié par une visite (ou est explicitement hors périmètre).
- [ ] États listés par écran, avec les boutons et routes à ne pas toucher.
- [ ] Coque et éléments de section décrits et mesurés ; page de référence choisie.
- [ ] `unites.json` : un propriétaire par section, clés `nav`, notes complètes, ordre de capture ;
  `fondation.json` pour la page de référence (absente de `unites.json`).
- [ ] Rien n'a été modifié dans l'appli ; aucune donnée personnelle ni aucun code des bundles n'a été recopié.

---

## Pièges connus
| Symptôme | Cause | Solution |
|---|---|---|
| Écran de chargement infini, DOM vide | fenêtre Chrome masquée ou onglet en arrière-plan : la SPA ne se dessine pas | un seul onglet au premier plan ; capture réduite, attente 3–4 s, nouvelle capture, puis lecture |
| `__routes` ne trouve presque rien | site multipage, routes calculées, Next routeur app, Electron `file://`, CDN sans CORS | s'appuyer sur `__inventory().navigation` écran par écran ; `/sitemap.xml` (public) ; `origins` pour un CDN du même éditeur |
| Beaucoup de `chaines` sans intérêt | pas de préfixe | relancer avec `prefix` |
| Routes relatives sans parent | routeur imbriqué (Angular, React Router) | `aVerifier` = hypothèses ; confirmer par la visite et par la navigation |
| Route `:id` impossible à visiter | il faut un identifiant réel | ouvrir un élément depuis sa liste (lecture seule) ; noter `/x/:id`, jamais l'identifiant |
| Rechargements pendant un parcours | `history.pushState` scripté | `navigate` ; mémoriser la progression dans `sessionStorage` si un script enchaîne des routes |
| Réponse tronquée (Claude in Chrome) | filtre de sortie de l'extension | `__out(...)` puis `window.__R.slice(0, 20)` |
| Morceau « [BLOCKED…] » (Claude in Chrome) | le filtre a vu un cookie, un jeton, une chaîne de requête ou du base64 | ne pas le redécouper aussitôt : le relire, y chercher cookie/session/token/`=`/base64, masquer (`__mask`, `__addMap` de `capture-kit.js`), puis redemander ; une valeur de session ou un secret n'est jamais relevé (le noter dans `notes.md`, sans la valeur) — `references/kit-web.md` §2a |
| Kit tronqué : `SyntaxError`, `__routes is not defined` juste après l'injection | fichier lu partiellement par Read (taille), ou numéros de ligne laissés dans le texte | Read complet (`allow_large: true` ou par tranches), numéros retirés, réponse `routes ok` vérifiée (`references/kit-web.md` §2a) |
| `ReferenceError: __routes is not defined` (code 2 de `cdp_eval.py`) | la page a été rechargée ou a navigué : le kit a disparu | réinjecter le fichier (`--file`, ou dans `javascript_tool` la réinjection courte, sinon le contenu complet) avant chaque appel |
| Écran accessible classé « connexion » | champ mot de passe visible sur une page sans navigation (assistant plein écran, modale de confirmation) | relire `titre`/`h1` ; un formulaire de mot de passe dans une page avec navigation est signalé par `champsMotDePasse` (statut `ok`) : ne jamais le remplir |
| `__routes` semble ignorer un bundle modifié | cache du navigateur (lecture `force-cache`, voulue) | sans importance en reconnaissance ; recharger sans cache si l'appli vient d'être mise à jour |
| `detect_app.ps1` (Windows) : « chemin introuvable » | installation par utilisateur (`%LOCALAPPDATA%\Programs`), raccourci | l'outil essaie seul les emplacements usuels ; sinon `-ProcessName` sur l'appli ouverte ou le `.lnk` |
| Confiance « faible » sur un logiciel (Windows) | indices insuffisants dans les fichiers | relancer avec `-ProcessName` appli ouverte (modules chargés) ; appli du Store : chemin donné par `powershell -NoProfile -Command "(Get-AppxPackage *<nom>*).InstallLocation"`, puis `-Path` |
| `detect_app_mac.py` : « appli introuvable » (code 2) | appli rangée ailleurs que dans /Applications, ~/Applications ou ~/Desktop, nom différent du nom affiché | chemin complet du `.app` (`mdfind "kMDItemFSName == '<Nom>.app'"`), ou `--pid` sur l'appli ouverte |
| `detect_app_mac.py` : `inconnu` (code 1) | ni framework embarqué, ni bibliothèque d'interface liée | relancer avec `--pid` appli ouverte (bibliothèques chargées) ; sinon voie images |
| Au lancement d'une appli, macOS affiche « … est endommagé » ou « ne peut pas être ouvert » | binaire non signé ou en quarantaine (Gatekeeper) | ne pas insister ni contourner (aucun `xattr`, aucun réglage de sécurité) : le dire à l'utilisateur |
| De vrais noms dans `inv-<slug>.json` | `__inventory()` lit le texte affiché | `capture-kit.js` + `__addNames` + `__anonLive()` avant `__inventory()` (A4) ; sinon ne rien écrire sur disque |
| L'appli Electron ignore le port de débogage | instance déjà ouverte qui reçoit les arguments (instance unique), ou appli qui filtre ses options, ou lancement par `open -a` | binaire lancé directement avec `--user-data-dir` temporaire ; sinon demander à l'utilisateur de fermer la sienne ; sinon voie UIA + captures (Windows) ou images (macOS) |
| Une fenêtre s'ouvre dans le Chrome de l'utilisateur | navigateur lancé sans `--headless=new` ni `--user-data-dir` temporaire (même `chrome.exe --version` sous Windows), ou `open -a "Google Chrome"` | toujours `headless.py lancer` (headless + profil temporaire) ; lire une version sans rien lancer : `detect_app.ps1` (Windows), `plutil -extract CFBundleShortVersionString raw "<Appli>.app/Contents/Info.plist"` (macOS) |
| Accents illisibles dans un script PowerShell | Windows PowerShell 5.1 lit un `.ps1` sans BOM en ANSI | garder les `.ps1` du plugin en UTF-8 **avec BOM** |

Les autres skills : `copier-une-appli` (point d'entrée, règles, orchestration), `capture-web` et `capture-bureau`
(capture après cette étape), `reconstruire-appli` (fondation, coque, pages), `verifier-copie` (double
vérification, contrôle final).
