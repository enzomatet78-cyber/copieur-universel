# Copieur universel

**« Universal Modder, mais pour copier des applis »** — un plugin Claude Code qui recrée en local, fidèlement,
presque n'importe quelle application : **applis web** (publiques ou derrière une connexion) et **logiciels de
bureau** (Electron sous Windows et macOS, WebView2, applis Windows natives). Pour un usage personnel : apprendre,
prototyper, maquetter, garder une trace d'une interface.

Vous demandez « copie l'appli X » ; Claude cadre la demande, identifie le type d'appli, capture ce qu'elle affiche
(en lecture seule, avec des données personnelles remplacées par du fictif), la reconstruit page par page en
HTML/CSS/JS, la vérifie deux fois, puis vous la sert en local avec un compte rendu honnête de ce qui est fidèle et
de ce qui ne l'est pas encore.

La méthode vient d'une recréation complète réussie : une appli SaaS connectée (iClosed) reproduite en local,
section par section, par une équipe d'agents.

---

## Installation

### Comme plugin (recommandé)

Dans Claude Code, depuis GitHub :

```
/plugin marketplace add enzomatet78-cyber/copieur-universel
/plugin install copieur-universel@copieur-universel
```

Ou depuis une copie locale de ce dépôt (remplacez le chemin par celui du dossier sur votre machine) :

```
/plugin marketplace add "/Users/<vous>/chemin/vers/copieur-universel"
/plugin install copieur-universel@copieur-universel
```

(Windows : `/plugin marketplace add "C:\chemin\vers\copieur-universel"`.)

En ligne de commande, mêmes arguments : `claude plugin marketplace add …` puis
`claude plugin install copieur-universel@copieur-universel`.
Redémarrez ensuite la session Claude Code. Les skills s'invoquent alors `/copieur-universel:<nom-du-skill>`
(ex. `/copieur-universel:copier-une-appli`), mais une simple demande en français suffit : le point d'entrée se
déclenche tout seul.

Mise à jour : `/plugin marketplace update copieur-universel` · Désinstallation :
`/plugin uninstall copieur-universel@copieur-universel`.

### Sans plugin (skills personnels)

Copiez chaque dossier de `plugins/copieur-universel/skills/` dans `~/.claude/skills/`, **et** le dossier
`plugins/copieur-universel/outils/` dans `~/.claude/outils/`. Sous macOS (Terminal, depuis la racine de ce
dossier) :

```
mkdir -p ~/.claude/skills ~/.claude/outils
cp -R plugins/copieur-universel/skills/* ~/.claude/skills/
cp -R plugins/copieur-universel/outils/. ~/.claude/outils/
```

Sous Windows (invite de commandes `cmd`, depuis la racine de ce dossier) :

```
xcopy /E /I "plugins\copieur-universel\skills\*" "%USERPROFILE%\.claude\skills\"
xcopy /E /I "plugins\copieur-universel\outils" "%USERPROFILE%\.claude\outils"
```

Pourquoi le second : chaque skill trouve ses outils dans `<dossier du skill>/../../outils/`. Installé dans
`~/.claude/skills/<skill>/` (`%USERPROFILE%\.claude\skills\<skill>\` sous Windows), ce chemin désigne
`~/.claude/outils/`. Sans cette copie, les skills se chargent mais leurs commandes échouent. Dans ce mode, les
skills s'invoquent sans préfixe (`/copier-une-appli`).

### Vérifier que tout est prêt (2 minutes)

1. Dans Claude Code, tapez `/copieur` : les six skills doivent apparaître dans la liste
   (`/copieur-universel:copier-une-appli`, `/copieur-universel:capture-web`… ; installation sans plugin : tapez
   `/copier` et cherchez `/copier-une-appli`). La commande `/plugin` montre aussi les plugins installés.
2. Dans un terminal (Terminal sous macOS ; invite de commandes, PowerShell ou Git Bash sous Windows), vérifiez
   Python et les outils :
   ```
   python3 --version
   python3 "/Users/<vous>/chemin/vers/copieur-universel/plugins/copieur-universel/outils/cdp_eval.py" --version
   ```
   (adaptez le chemin ; sous Windows, `py` remplace `python3`) → `Python 3.10` ou plus récent, puis
   `cdp_eval.py 1.3`. Si `python3` ou `py` est introuvable, voir « Dépannage » plus bas.

### Premier essai conseillé

Commencez petit, sur une page publique simple, pour voir le déroulé complet en une session :

> Reproduis cette page à l'identique : https://exemple.fr/tarifs

Claude vous pose ses questions (dossier du clone, port local), capture la page dans un Chrome invisible qui
ne touche pas au vôtre, la reconstruit, la vérifie, puis vous donne l'adresse à ouvrir, par exemple
`http://localhost:8770/app/tarifs`. Le clone est un simple dossier de fichiers HTML : pour le rouvrir plus tard,
demandez « relance le serveur du clone », ou lancez vous-même
`python3 -m http.server 8770 --bind 127.0.0.1 --directory "<dossier du clone>"` (Windows : `py` au lieu de
`python3`) puis ouvrez l'adresse dans votre navigateur. Fermer cette fenêtre de terminal arrête le serveur.

---

## Exemples de demandes

- « Copie l'appli Trello, juste le tableau et la vue d'une carte. »
- « Clone le tableau de bord de mon compte Calendly — je suis connecté dans Chrome. »
- « Recrée le tableau de bord de mon logiciel de caisse. »
- « Refais l'écran principal de Notepad, avec les menus. »
- « Fais-moi la même appli que Notion pour la page d'accueil et la barre latérale. »
- « Reproduis cette page à l'identique : https://exemple.fr/tarifs »
- « Recrée toute l'interface de Visual Studio Code (l'explorateur, les onglets, la barre d'état). »
- « Je veux une réplique locale de l'écran Paramètres de Discord. »

Claude vous posera d'abord quelques questions (portée, compte, données à garder, dossier du clone) et annoncera
une estimation de durée et de coût avant de lancer quoi que ce soit.

---

## Comment ça se déroule

1. **Cadrage** — quoi copier, jusqu'où, avec quel compte, où ranger le clone ; estimation.
2. **Reconnaissance** — type d'appli (SPA, Electron, WPF…), inventaire des écrans et des états, découpage en unités.
3. **Fondation** — une page de référence capturée, recréée et validée par deux vérifications ; on en tire la
   coque partagée (navigation, menus, icônes, styles) et les données fictives.
4. **Capture séquentielle** (lecture seule, anonymisée) et **construction parallèle** (un agent par unité).
5. **Deux vérifications** par unité (mesures, textes mot à mot, interactions, confidentialité), puis **contrôle
   final** du site (liens, console, données personnelles) et application des retouches de la coque.
6. **Livraison** — serveur local (`http://localhost:<port>`) ou lanceur en fenêtre d'appli (`lancer-app.cmd`
   sous Windows, `lancer-app.command` sous macOS), et compte rendu : fait / écarts restants / limites.

Pour une appli entière, l'orchestration peut passer par l'outil Workflow de Claude Code (avec votre accord) ;
pour une page ou un écran, tout tient dans une session.

---

## Ce qui est pris en charge

| Type d'appli | Prise en charge | Comment |
|---|---|---|
| Appli web derrière une connexion | oui | votre Chrome via l'extension Claude in Chrome ; **vous** vous connectez ; lecture seule stricte |
| Site ou appli web public | oui | navigateur intégré de Claude Code, ou Chrome/Edge headless sur profil temporaire |
| Logiciel Electron, CEF, NW.js (VS Code, Discord, Slack…) | oui, Windows et macOS | relancé avec un port de débogage et un profil temporaire, inspecté comme une page web |
| WebView2 / Tauri (Windows) | oui, selon l'appli | même principe via le port de débogage WebView2 |
| Windows natif (Win32, WPF, WinForms, UWP/WinUI, Qt, Java) | oui, fidélité visuelle (Windows uniquement) | arbre UI Automation + captures de fenêtre ; recréé en HTML/CSS imitant les contrôles |
| Appli macOS native (AppKit, SwiftUI, Catalyst, Tauri…) | partiel, fidélité réduite | aucun outil dédié : recréation d'après des images (computer-use, `screencapture`), sans mesure garantie |
| Contenu dessiné (canvas, WebGL, jeux, éditeurs graphiques) | partiel | interface autour recréée ; zone dessinée approximée d'après les images |
| Appli mobile native (iOS, Android) | non | alternative : sa version web, ou une recréation d'après vos captures d'écran (fidélité réduite) |

Ce que le clone **n'est pas** : il ne reproduit pas le serveur ni les données réelles. Les boutons « Enregistrer »,
« Envoyer », « Connecter »… ouvrent et ferment l'interface comme l'original, sans effet. Les données affichées
sont fictives (sauf ce que vous choisissez de garder, comme votre nom).

---

## Règles

Le plugin applique des garde-fous stricts (détail : `plugins/copieur-universel/skills/copier-une-appli/references/regles.md`) :

- **Usage personnel et local** : le clone est servi sur `127.0.0.1` ; ne le publiez pas et ne le présentez pas
  comme l'original (marques, logos, droits d'auteur). Pas de faux formulaire de connexion ou de paiement.
- **Reconstruire à partir de ce qu'on voit** (page affichée, arbre d'accessibilité, captures) ; aucune
  décompilation, aucune copie du code source propriétaire.
- **Aucun contournement** : connexion, licence, DRM, paywall, CAPTCHA, limites de débit ; pas d'aspiration massive.
- **Votre compte reste intact** : exploration en lecture seule (rien n'est enregistré, envoyé, supprimé ni
  connecté) ; Claude ne saisit jamais vos identifiants — vous vous connectez vous-même.
- **Données personnelles remplacées par du fictif** avant toute capture ; les secrets (clés, jetons, cartes) ne
  sont jamais copiés.
- **Logiciels** : profil temporaire quand c'est possible, mises à jour automatiques bloquées avant le lancement,
  rien d'enregistré, pas d'ouverture de vos fichiers récents, seuls les processus lancés par Claude sont fermés.
- Pas de copie d'une appli destinée à tromper ni d'un espace appartenant à une autre personne.

---

## Prérequis

- **Claude Code** (application de bureau recommandée : navigateur intégré pour vérifier les pages).
- **macOS ou Windows 11**. Sur les deux, les applis web et les logiciels Electron/CEF/NW.js sont pris en charge
  au même niveau. Les logiciels natifs ne le sont que sous Windows : les outils `*.ps1` (UI Automation,
  captures de fenêtre, détection) demandent PowerShell 5.1 et Git Bash. Sous macOS, une appli native est
  recréée d'après des images, avec une fidélité réduite ; la détection d'un `.app` passe par `detect_app_mac.py`.
- **Python 3.10+** accessible par `python3` (macOS, Linux) ou `py` (Windows) — bibliothèque standard uniquement,
  rien à installer.
- **Google Chrome** et/ou **Microsoft Edge** : Claude les lance en headless sur un profil temporaire avec
  `headless.py`, sans toucher à votre navigateur ni à vos sessions.
- Pour les applis connectées : l'extension **Claude in Chrome**, avec votre session ouverte dans l'appli.
- Facultatif : **computer-use** (pour ouvrir menus et boîtes de dialogue des logiciels natifs ; sous macOS,
  barre de menus et images des applis natives), l'outil **Workflow** (orchestration d'une appli entière), le
  mode **ultracode**.
- Node.js n'est **pas** nécessaire.

---

## Dépannage

| Problème | Que faire |
|---|---|
| Les skills n'apparaissent pas après l'installation | redémarrer la session Claude Code ; vérifier avec `/plugin` que `copieur-universel` est installé et activé ; à défaut, appeler directement `/copieur-universel:copier-une-appli` |
| `py` n'est pas reconnu (Windows) | installer Python 3 depuis python.org (le lanceur `py` est installé avec ; cocher aussi « Add python.exe to PATH »), puis rouvrir Claude Code (sur macOS/Linux, `python3` remplace `py`) |
| `python3` introuvable ou trop ancien (macOS) | installer Python 3.10 ou plus récent depuis python.org (le `python3` des outils de développement d'Apple peut être plus ancien : vérifier avec `python3 --version`), puis rouvrir Claude Code |
| Chrome introuvable (macOS : Chrome ailleurs que dans `/Applications`, par exemple sur le Bureau) | `headless.py` cherche dans `/Applications`, `~/Applications`, `~/Desktop`, puis avec Spotlight ; sinon, définir `CU_CHROME` (dossier `.app` ou exécutable), par exemple dans `~/.zshrc` : `export CU_CHROME="/Users/<vous>/Desktop/Google Chrome.app"` (Edge : `CU_EDGE`), puis rouvrir Claude Code |
| macOS : image noire ou « permission refusée » en capturant une appli native ou ses menus | les permissions **Accessibilité** et **Enregistrement de l'écran** (Réglages Système > Confidentialité et sécurité) s'accordent par vous-même à l'application qui lance la capture (Claude, Terminal) ; Claude ne les modifie jamais. Sans elles, l'écran est décrit plutôt que capturé |
| Message sur la « stratégie d'exécution » de PowerShell (Windows) | rien à changer dans Windows : les commandes du plugin passent `-ExecutionPolicy Bypass` pour ce seul script ; si vous lancez un `.ps1` à la main, utilisez la même forme (`powershell -NoProfile -ExecutionPolicy Bypass -File …`) |
| Appli connectée : Claude ne voit pas votre session | installer et connecter l'extension Claude in Chrome, ouvrir l'appli dans ce Chrome et vous y connecter vous-même ; si plusieurs navigateurs sont reliés, indiquer lequel utiliser |
| Une fenêtre Chrome ou un logiciel s'est ouvert pendant la capture | c'est l'instance de travail de Claude, sur un profil temporaire : ne pas l'utiliser ; Claude la ferme à la fin (seulement elle) |
| Le clone s'affiche sans styles ou avec des liens cassés | l'ouvrir par `http://localhost:<port>/…` et non en double-cliquant le fichier (`file://`) : les chemins du clone partent de la racine du serveur |
| Une page ne ressemble pas assez à l'original | demander « vérifie la page X du clone » : le skill `verifier-copie` mesure les écarts et les corrige |

---

## Contenu du plugin

### Skills

| Skill | Rôle |
|---|---|
| `copier-une-appli` | **point d'entrée** : cadrage, choix du playbook, règles, orchestration, livraison ; gabarit de Workflow |
| `reconnaissance-appli` | identifier le type d'appli, inventorier écrans, routes et états, découper en unités |
| `capture-web` | capturer une appli web connectée (Claude in Chrome) ou publique (navigateur intégré, Chrome headless) |
| `capture-bureau` | capturer un logiciel : Electron/WebView2 par le protocole de débogage, natif par UI Automation + captures (Windows) ; appli macOS native : images, fidélité réduite |
| `reconstruire-appli` | fondation (page de référence → coque partagée), gabarit de page, données fictives, lanceur en fenêtre d'appli |
| `verifier-copie` | double vérification (mesures, textes, interactions, confidentialité), vérificateur adverse, contrôle final |

### Outils (`plugins/copieur-universel/outils/`)

| Outil | Rôle |
|---|---|
| `capture-kit.js` | kit injecté dans la page : nettoyage du DOM, anonymisation, découpage des gros résultats, styles personnalisés |
| `routes-from-bundle.js` | liste les routes candidates d'une SPA (manifeste, scripts chargés) |
| `cdp_eval.py` | client du protocole de débogage Chrome en Python standard : lister, naviguer, évaluer un script, capturer, survoler, relever la console, fermer |
| `headless.py` | lance, surveille et ferme un Chrome/Edge headless sur un profil temporaire (port, taille, nettoyage du profil) ; Windows, macOS, Linux ; `CU_CHROME` / `CU_EDGE` pour un navigateur hors des emplacements habituels |
| `headless.ps1` | (Windows) la même chose en PowerShell, mêmes actions |
| `uia_dump.ps1` | (Windows) arbre UI Automation d'une fenêtre en JSON (valeurs des champs masquées par défaut) |
| `window_shot.ps1` | (Windows) capture PNG d'une fenêtre, même en arrière-plan si possible |
| `detect_app.ps1` | (Windows) reconnaît le framework d'un logiciel installé (Electron, WebView2, .NET, Qt, Java, natif, Tauri…) |
| `detect_app_mac.py` | (macOS) reconnaît le framework d'un `.app` en lecture seule (Electron, CEF, NW.js, Qt, Flutter, Java, Tauri, Catalyst, AppKit, SwiftUI) et dit s'il est capturable par le port de débogage |
| `check_links.py` | contrôle un clone servi en local : pages qui répondent, liens internes valides |
| `scan_pii.py` | recherche emails, téléphones, IBAN, cartes, clés, jetons et chemins locaux dans un clone (liste blanche possible) |
| `verif.js` | fonctions de mesure à injecter dans le clone (positions, textes, débordement, liens, réseau) |
| `textes.py` | compare les textes de la capture et du clone, caractère par caractère |
| `png_diff.py` | compare deux images au pixel près ; couleur d'un pixel, boîte d'un texte ou d'une icône |
| `uia_rects.py` | (Windows) rectangles d'un relevé UI Automation convertis en px CSS |
| `dom2page.py` | prépare le contenu d'une page du clone à partir d'un dump de capture |
| `glyphes.html` | (Windows) identifie les icônes d'un logiciel Windows dans la police Segoe Fluent Icons |
| (serveur local) | `python3 -m http.server <port> --bind 127.0.0.1 --directory "<clone>"` (Windows : `py`) ; pas de script fourni |

Lanceurs du clone d'un logiciel (skill `reconstruire-appli`, dossier `assets/`, copiés à la racine du clone) :
`lancer-app.cmd` sous Windows (serveur local + fenêtre d'appli Edge `--app`) et `lancer-app.command` sous macOS
(serveur local + fenêtre d'appli Chrome `--app` sur un profil propre au clone, ouverte par `open -na`). Les deux
acceptent `--verifier` et `--serveur`.

### Arborescence

```
copieur-universel/                    marketplace
  .claude-plugin/marketplace.json
  README.md, LICENSE
  plugins/copieur-universel/           plugin
    .claude-plugin/plugin.json
    outils/                            outils partagés
    skills/
      copier-une-appli/                point d'entrée (+ references/, assets/workflow-template.js)
      reconnaissance-appli/  capture-web/  capture-bureau/  reconstruire-appli/  verifier-copie/
```

---

## Licence

MIT — voir [LICENSE](LICENSE). La licence couvre le plugin lui-même, pas les applications que vous copiez :
leurs marques, textes et visuels restent la propriété de leurs éditeurs, d'où l'usage strictement personnel des
clones.
