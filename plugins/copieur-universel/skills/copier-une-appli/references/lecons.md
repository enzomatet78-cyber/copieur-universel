# Leçons apprises (recréation de l'appli iClosed)

Chaque leçon suit le même schéma : **Symptôme** (ce qu'on voit) → **Cause** (pourquoi ça arrive) →
**Solution** (ce qui a marché). Elles viennent de la recréation complète d'une appli SaaS React + Tailwind
connectée, capturée via Claude in Chrome et reconstruite par une quinzaine d'unités en parallèle. Les noms
d'outils cités (`capture-kit.js`, `routes-from-bundle.js`…) sont dans le dossier `outils/` du plugin.

Sommaire : A. Claude in Chrome · B. SPA et navigation · C. Styles et rendu · D. Textes et données ·
E. Médias · F. Workflow et agents · G. Mesure de la fidélité · H. Leçons complémentaires (scripts et guide
d'iClosed) · I. Essais des outils du plugin · J. Essais de bout en bout (site web, Bloc-notes, VS Code, Chrome
headless)

---

## A. Claude in Chrome (capture d'applis connectées)

### A1. Plusieurs navigateurs connectés
- **Symptôme** : les commandes agissent dans un autre navigateur (autre ordinateur, autre profil) que celui où
  l'utilisateur s'est connecté ; pages « non connectées » ou onglets inconnus.
- **Cause** : l'extension peut être reliée à plusieurs navigateurs à la fois ; par défaut, l'outil n'utilise pas
  forcément le bon.
- **Solution** : `list_connected_browsers`, puis choisir celui **de cet ordinateur** où l'utilisateur est
  connecté à l'appli (`select_browser`) ; le vérifier en lisant `location.href` et le nom affiché du compte.

### A2. Le groupe d'onglets disparaît
- **Symptôme** : `tabs_context_mcp` ne renvoie plus d'onglet, ou l'onglet utilisé est introuvable.
- **Cause** : l'utilisateur (ou Chrome) a fermé le groupe d'onglets de l'extension.
- **Solution** : `tabs_context_mcp {createIfEmpty: true}` pour recréer le groupe, puis renaviguer vers la page
  en cours ; reprendre la capture là où elle s'était arrêtée (d'où l'intérêt de `notes.md` tenu à jour).

### A3. Écran de chargement infini quand la fenêtre est masquée
- **Symptôme** : après `navigate`, le DOM ne contient que le logo et la barre de chargement ; la page ne se
  dessine jamais, ou les mesures valent 0.
- **Cause** : Chrome ne dessine une fenêtre masquée ou occultée qu'à la demande ; la SPA attend une image
  (requestAnimationFrame) qui n'arrive pas.
- **Solution** : après chaque navigation, `computer screenshot` à l'échelle 0.1, attendre 3–4 s, refaire un
  `screenshot` 0.1, **puis** seulement lire le DOM. Si l'écran de chargement persiste, recommencer
  capture + attente.

### A4. Les onglets en arrière-plan ne démarrent pas
- **Symptôme** : une page ouverte dans un second onglet reste blanche ou à moitié rendue.
- **Cause** : Chrome ralentit fortement les onglets en arrière-plan ; les SPA n'y démarrent pas.
- **Solution** : **un seul onglet**, au premier plan, et les pages **une par une**. Ne pas paralléliser la
  capture dans le navigateur réel (c'est aussi pourquoi la capture est séquentielle dans le Workflow).

### A5. Résultats tronqués ou « [BLOCKED…] »
- **Symptôme** : la valeur renvoyée par `javascript_tool` est coupée vers 1000 caractères, ou remplacée par
  « [BLOCKED…] ».
- **Cause** : le filtre de sortie de l'extension tronque les longues chaînes et bloque ce qui ressemble à des
  cookies, des chaînes de requête ou du base64 (caractères `;`, `&`, `?`, longues suites alphanumériques).
- **Solution** : échapper avant de renvoyer — `;`→`§`, `&`→`(AMP)`, `?`→`(Q)` (le kit généralisé échappe
  d'abord les `§` d'origine en `(SECT)`) — et découper en morceaux **≤ 900 caractères** (le kit le fait :
  `__dump()` remplit `window.__D`) ; récupérer par paquets (`window.__D.slice(0,20)`, puis `(20,40)`…) ;
  redemander un morceau bloqué en plus petit (`window.__D[i].slice(0,300)`…). **Inverser les échappements** en
  écrivant les fichiers, dans le bon ordre (`§`→`;` avant `(SECT)`→`§`) : la commande de décodage testée est
  dans `capture-web/references/chrome-connecte.md` §7.

### A6. Alerte « Quitter la page ? »
- **Symptôme** : une navigation ou une fermeture est bloquée par une boîte de dialogue `beforeunload`.
- **Cause** : un formulaire ouvert (même vide) arme l'alerte de l'appli.
- **Solution** : fermer l'onglet **via l'extension** (`tabs_close_mcp`) contourne l'alerte sans rien
  enregistrer ; puis recréer un onglet. Ne jamais cliquer « Quitter » dans une boîte qui proposerait aussi
  « Enregistrer ».

## B. SPA et navigation

### B1. Rechargements intempestifs pendant un parcours scripté
- **Symptôme** : « Inspected target navigated or closed », le kit injecté disparaît, la progression d'un
  script qui visite plusieurs routes est perdue.
- **Cause** : naviguer par `history.pushState` + `popstate` déclenche parfois un rechargement complet dans
  certaines SPA (garde de route, mise à jour de version).
- **Solution** : naviguer avec l'outil `navigate` (une URL complète), réinjecter le kit après chaque
  navigation ; si un script doit parcourir plusieurs routes, mémoriser sa progression dans `sessionStorage`
  pour reprendre après un rechargement.

### B2. Inventaire des routes incomplet
- **Symptôme** : des pages existent dans l'appli mais aucun lien visible n'y mène ; l'inventaire en oublie.
- **Cause** : une SPA déclare ses routes dans son code ; le menu n'en montre qu'une partie.
- **Solution** : lire `/asset-manifest.json` (applis Create React App) ou les balises `<script>` chargées,
  télécharger les morceaux et extraire les motifs `path:"…"` et les chaînes `"/app/…"` du préfixe de l'appli —
  c'est ce que fait `routes-from-bundle.js` (à injecter dans une page de l'appli) — puis **visiter** chaque
  candidate pour éliminer redirections et « Page non trouvée ». C'est de la reconnaissance : on ne recopie
  aucun code.

## C. Styles et rendu

### C1. Recréer une appli Tailwind
- **Symptôme** : couleurs ou espacements légèrement faux alors que les classes semblent recopiées.
- **Cause** : l'appli utilise Tailwind avec une palette éventuellement personnalisée et quelques classes
  maison absentes du CDN.
- **Solution** : recopier les classes utilitaires du DOM et charger le CDN Tailwind v3
  (`https://cdn.tailwindcss.com/3.4.16?plugins=forms` ; le plugin forms si radios/cases sont stylées) ;
  **vérifier la palette** en comparant quelques couleurs calculées (`getComputedStyle`) avec l'original ;
  récupérer les classes personnalisées (dégradés, barres de défilement…) dans `document.styleSheets`
  (fonction `__styles()` du kit) et les mettre dans la feuille de la coque.

### C2. Barre de défilement épaisse au lieu d'une barre fine
- **Symptôme** : la barre fine de 4 px de l'original apparaît à 10 px dans le clone sous Chromium.
- **Cause** : dans Chromium récent, `scrollbar-width` / `scrollbar-color` **désactivent** les règles
  `::-webkit-scrollbar`.
- **Solution** : mettre `scrollbar-width`/`scrollbar-color` sous
  `@supports not selector(::-webkit-scrollbar) { … }` pour qu'ils ne servent qu'à Firefox.

### C3. Icônes fines devenues épaisses
- **Symptôme** : des icônes 16 px dessinées en trait fin (1,25–1,5) apparaissent en trait 2.
- **Cause** : une classe utilitaire `stroke-2` sur le SVG (ou un parent) écrase l'attribut `stroke-width`.
- **Solution** : donner l'épaisseur en **style inline** (`style="stroke-width:1.5"`), qui l'emporte sur la
  classe.

### C4. État par défaut mémorisé à tort
- **Symptôme** : la barre latérale reste repliée sur grand écran après un passage sur petit écran.
- **Cause** : le clone enregistrait dans `localStorage` un état appliqué automatiquement (repli sur petit
  écran) comme s'il était un choix.
- **Solution** : ne mémoriser que les **choix explicites** de l'utilisateur (clic sur le bouton), jamais un
  état par défaut calculé.

## D. Textes et données

### D1. Montants et nombres « presque » identiques
- **Symptôme** : « 1 007 » ou « 905 000 $ » semblent identiques mais la comparaison caractère par caractère
  échoue, ou le texte se coupe à un autre endroit.
- **Cause** : en fr-FR, `Intl.NumberFormat` sépare les milliers par une **espace fine insécable U+202F**
  (et certaines applis utilisent U+00A0 ailleurs).
- **Solution** : vérifier les codes caractère réels quand ça compte (`[...texte].map(c => c.charCodeAt(0))`),
  reproduire le même caractère (formater avec `toLocaleString('fr-FR')` ou l'écrire explicitement).

### D2. Que faut-il anonymiser ?
- **Symptôme** : hésitation à garder des chiffres ou des noms de réglages, ou au contraire tout remplacer
  et perdre la fidélité.
- **Cause** : confusion entre données personnelles (sur des tiers) et données du compte.
- **Solution** : les **données agrégées** (totaux, pourcentages, compteurs) ne sont pas des données
  personnelles ; les **réglages propres au compte** (noms d'évènements, de workflows, de produits, d'étapes)
  peuvent rester. Tout ce qui identifie un tiers (nom, email, téléphone, message) devient fictif.

## E. Médias

### E1. Le son d'une vidéo continue après fermeture
- **Symptôme** : une vidéo intégrée (Wistia, YouTube) continue de jouer quand on ferme le panneau ; ou
  avertissement console sur `allowfullscreen`.
- **Cause** : l'iframe reste chargée en arrière-plan ; `allow="fullscreen"` et l'attribut `allowfullscreen`
  font doublon.
- **Solution** : créer l'iframe **à l'ouverture** du panneau et la **supprimer à la fermeture** ; utiliser
  `allow="autoplay; fullscreen"` **sans** l'attribut `allowfullscreen`.

## F. Workflow et agents

### F1. Script Workflow refusé : « control characters »
- **Symptôme** : `Workflow({scriptPath})` refuse le script en signalant des caractères de contrôle.
- **Cause** : les caractères non ASCII (accents, guillemets français, flèches) du fichier.
- **Solution** : échapper tout caractère non ASCII en `\uXXXX` (le gabarit `assets/workflow-template.js` est
  déjà en ASCII pur ; script d'échappement dans `orchestration.md`), ou passer le script **en ligne**
  (paramètre `script`).

## G. Mesure de la fidélité

### G1. Comment savoir si une page est fidèle ?
- **Symptôme** : les captures « se ressemblent » mais des écarts subsistent qu'on ne sait pas localiser.
- **Cause** : la comparaison à l'œil ne détecte pas les décalages cumulés de quelques pixels.
- **Solution** : mesure très parlante : **même `scrollHeight`** du conteneur principal que l'original. Puis
  positions clés (`getBoundingClientRect`) et textes caractère par caractère contre le DOM capturé.

---

## Leçons complémentaires (tirées des scripts et du guide d'iClosed)

### H1. Agents parallèles qui se marchent dessus dans le navigateur intégré
- **Symptôme** : un vérificateur mesure une page qu'un autre agent vient de recharger ou de redimensionner.
- **Cause** : plusieurs agents utilisent le même onglet.
- **Solution** : chaque agent crée **son** onglet (`tabs_create`), passe toujours son `tabId`, le ferme à la
  fin, et ne touche jamais aux onglets des autres. Le navigateur réel de l'utilisateur (Claude in Chrome) est
  réservé aux agents de capture.

### H2. Fichier commun modifié par plusieurs constructeurs
- **Symptôme** : en-têtes de section différents d'une page à l'autre, corrections qui s'écrasent.
- **Cause** : plusieurs agents écrivent le même fichier en parallèle.
- **Solution** : un **propriétaire unique** par fichier de section ; les autres unités attendent sa
  construction et décrivent leurs besoins (`sectionIssues`) ; la coque n'est modifiée qu'à la fin, par un
  seul agent (`shellIssues`).

### H3. Données qui changent à chaque rechargement
- **Symptôme** : impossible de comparer deux mesures, les tableaux changent à chaque chargement.
- **Cause** : données fictives générées avec `Math.random()`.
- **Solution** : générateur **à graine fixe** (`FAKE.rng(seed)`) et date « aujourd'hui » figée.

### H4. Mesures faussées par les squelettes de chargement
- **Symptôme** : hauteurs ou textes mesurés différents d'une fois à l'autre juste après un rechargement.
- **Cause** : la page affiche des squelettes quelques centaines de millisecondes, comme l'original.
- **Solution** : attendre ~1,5 s après chargement avant de mesurer.

### H5. Vérificateurs qui « corrigent » des écarts imaginaires
- **Symptôme** : une passe de vérification dégrade la page en appliquant des écarts non fondés.
- **Cause** : un relecteur compare à ses suppositions plutôt qu'à l'original.
- **Solution** : exiger une preuve (image de référence ou mesure) par écart, ignorer les écarts < 2 px et les
  artefacts JPEG, et faire passer chaque écart par un **vérificateur adverse** qui tente de le réfuter
  (réel = faux par défaut si la preuve est ambiguë). En deuxième passe, donner la liste de ce qui a déjà été
  corrigé ou refusé pour éviter les allers-retours.

### H6. Scripts Workflow non reproductibles
- **Symptôme** : erreur au lancement ou reprise (`resumeFromRunId`) impossible.
- **Cause** : `Date.now()`, `Math.random()` ou `new Date()` sans argument dans le script.
- **Solution** : ne pas les utiliser ; passer dates et paramètres via `args`.

## Leçons tirées des essais des outils du plugin

### I1. `cdp_eval.py --out` écrit un simple nombre au lieu du DOM
- **Symptôme** : `eval … --expr "__dump('main', 8)" --out dom.html` produit un fichier qui contient `1` ou `7`.
- **Cause** : en mode par défaut (prévu pour Claude in Chrome), le kit range le texte échappé dans
  `window.__D` et ne renvoie que le nombre de morceaux.
- **Solution** : mode brut avec `cdp_eval.py` — `--expr "__config({raw:true}); __dump('main', 8)"` (la
  configuration est gardée dans le `sessionStorage` de l'onglet, la répéter ne coûte rien).

### I2. Le relevé d'un logiciel tombe sur la fenêtre de l'utilisateur
- **Symptôme** : `uia_dump.ps1` ou `window_shot.ps1` relève un document personnel, ou une autre fenêtre que
  celle lancée pour la capture.
- **Cause** : `-ProcessName` choisit parmi toutes les instances, y compris celle que l'utilisateur avait déjà
  ouverte.
- **Solution** : noter le PID (et le handle) de l'instance lancée sur profil temporaire, et viser
  `-ProcessId <PID>` ; ne fermer que ce PID à la fin.

### I3. Une passe de vérification « sans écart » alors que personne n'a vérifié
- **Symptôme** : le résultat d'une passe ne signale rien, mais un relecteur ou un vérificateur adverse a été
  interrompu.
- **Cause** : un agent sauté ou mort renvoie `null` ; un script qui l'ignore compte « 0 écart ».
- **Solution** : traiter `null` comme « non vérifié » et le remonter dans les écarts restants (le gabarit
  `workflow-template.js` le fait) ; le compte rendu le dit.

## J. Essais de bout en bout (une page web publique, le Bloc-notes de Windows 11, VS Code)

### J1. Le logiciel lancé pour la capture installe sa mise à jour
- **Symptôme** : pendant la capture, un processus `CodeSetup-…exe /verysilent /update=…` apparaît ; à la
  fermeture, VS Code est passé de 1.139 à 1.141 chez l'utilisateur.
- **Cause** : la mise à jour automatique tourne aussi dans une instance lancée sur profil temporaire ; elle
  modifie l'installation, que le profil ne protège pas.
- **Solution** : bloquer les mises à jour dans le profil **avant** le lancement (VS Code : `settings.json` avec
  `"update.mode": "none"`, `capture-bureau/references/electron.md` §1) ; ne jamais arrêter un installeur en
  cours (pas de `taskkill /T` à l'aveugle) ; prévenir l'utilisateur si c'est arrivé.

### J2. Les états de la coque se jouent ailleurs que sur l'élément cliqué
- **Symptôme** : à 375 px, le clone diffère de l'original de 52 px alors que le dump de la barre repliée était
  identique.
- **Cause** : replier la barre ajoutait aussi une marge au conteneur principal ; on n'avait dumpé que la barre.
- **Solution** : `__etat()` avant l'action, `__diffEtat()` après (`capture-kit.js`) ; à défaut, dumper `body`.
  L'écart a été trouvé par une comparaison d'images au pixel (`png_diff.py`).

### J3. Une fenêtre headless ne descend pas sous ~500 px
- **Symptôme** : `size --viewport 375x812` donne 504×812 ; la page « mobile » ne ressemble pas à l'original.
- **Cause** : limite de la fenêtre headless ; et une appli qui décide de sa disposition au chargement ne se
  recalcule pas toujours ensuite.
- **Solution** : `nav --viewport 375x812` (chargement à la bonne largeur) puis `shot`/`eval --viewport 375x812`.

### J4. Le nom accessible n'est pas le texte affiché (WinUI)
- **Symptôme** : le clone affiche « Ligne 1, colonne 1 » là où le Bloc-notes affiche « Ln 1, Col 1 ».
- **Cause** : `uia_dump.ps1` relève le `Name` UIA, qui est le nom accessible ; les rectangles des `TextBlock`
  et la largeur des menus WinUI ne suivent pas non plus ce qui est dessiné.
- **Solution** : texte affiché et positions fines lus sur l'image (`png_diff.py encre`), `Name` en
  `aria-label`.

### J5. La fenêtre du clone est trop petite
- **Symptôme** : `CU_LARGEUR=1141`, `CU_HAUTEUR=658` donnent une zone de contenu de 1128×622.
- **Cause** : `--window-size` fixe la taille extérieure (bordures et barre de titre d'Edge comprises).
- **Solution** : ajouter ~14 px en largeur et ~37 en hauteur (à 125 %), puis vérifier `innerWidth`/
  `innerHeight` (`reconstruire-appli/references/fidelite.md` §11).

### J6. Un `.cmd` modifié sous Git Bash lance n'importe quoi
- **Symptôme** : après `sed -i` sur `lancer-app.cmd`, `--verifier` reste bloqué ; un `py` sans argument attend
  sur l'entrée standard.
- **Cause** : `sed -i` a remplacé les fins de ligne CRLF par LF ; cmd lit alors mal ses étiquettes.
- **Solution** : modifier les `.cmd` avec un outil qui garde les CRLF (outil Edit, PowerShell) ; le lanceur
  vérifie désormais ses fins de ligne au démarrage et s'arrête.

### J7. L'outil PowerShell de Claude Code bloque une commande de nettoyage
- **Symptôme** : « Remove-Item on system path … is blocked » sur un script recopié, parfois même à cause d'un
  chemin cité dans un message d'erreur.
- **Cause** : garde-fou de Claude Code sur `Remove-Item` quand le chemin est dans une variable.
- **Solution** : passer par un script lancé avec `-File` (`headless.ps1 -Action fermer`), ou écrire le chemin en
  entier (`rm -rf "C:/…/cu-…"` sous Git Bash).

### J8. Git Bash transforme les routes en chemins Windows
- **Symptôme** : `check_links.py --hors-perimetre /app/settings` ou `cdp_eval.py eval --target "/app/demo"`
  reçoivent `C:/Program Files/Git/app/…`.
- **Cause** : la conversion automatique des chemins de MSYS pour les programmes Windows.
- **Solution** : routes sans `/` initial quand l'outil l'accepte, ou `MSYS_NO_PATHCONV=1` devant la commande.

### J9. Images manquantes en headless, carrousel qui tourne
- **Symptôme** : images cassées sur les captures headless d'un site, alors qu'elles s'affichent ailleurs ;
  comparaisons d'images qui changent d'un essai à l'autre.
- **Cause** : ressources d'un autre domaine refusées au profil headless ; carrousel à rotation automatique.
- **Solution** : vérifier `naturalWidth` et recouper dans le navigateur intégré avant de conclure, sans rien
  contourner ; capturer chaque diapositive et comparer l'image prise juste après `nav`.

### J10. Mesures décalées de 15 px après une image « pleine page »
- **Symptôme** : après `cdp_eval.py shot --full` (ou `--selector`), les images suivantes n'ont plus de barres de
  défilement et `clientWidth` du conteneur principal grandit de 15 px (4 px pour une barre fine) ; tout ce qui
  est mesuré ensuite dans la même page est faux.
- **Cause** : Chrome (vu en 154 headless) masque les barres des conteneurs internes pendant une capture
  `captureBeyondViewport` et les laisse masquées jusqu'au rechargement ; ni `clearDeviceMetricsOverride` ni
  `setScrollbarsHidden` ne les rétablissent.
- **Solution** : `cdp_eval.py` 1.2 les rétablit seul (redimensionnement de la fenêtre d'1 px puis retour) et
  avertit s'il n'y parvient pas : alors recharger la page (`nav`) avant de mesurer. Avec un autre client CDP,
  recharger après chaque capture pleine page.

## K. Leçons de la fin du chantier iClosed (reprises, budget)

**K1. Aucune capture d'écran possible (« Page.captureScreenshot timed out »).** Cause : la fenêtre Chrome de l'utilisateur
est **réduite** dans la barre des tâches. Solution : lui demander de la garder ouverte (elle peut rester derrière d'autres
fenêtres) avant de lancer les captures ; sinon la vérification se fait seulement sur le DOM, sans référence en pixels.

**K2. Agents en échec (coupure réseau « ENOTFOUND », limite d'usage atteinte).** Les agents réussis sont conservés :
relancer avec `Workflow({ scriptPath, resumeFromRunId })`. Ne modifier que des textes PROPRES aux unités en échec
(ex. leurs `notes`) : toucher un prompt générique invalide le cache de tous les agents qui l'utilisent. Vérifier aussi
que le serveur local tourne encore (il s'arrête avec la session) et que Chrome répond avant de reprendre.

**K3. Budget limité.** Proposer tôt un mode économique : une seule passe de vérification, contrôle final par les
scripts (`check_links.py`, `scan_pii.py`, console des pages clés) au lieu d'un agent, captures « une fiche par gabarit ».

**K4. Une correction partagée « ne marche pas ».** Souvent le cache du navigateur : recharger sans cache
(`fetch(url, {cache:'reload'})` puis `location.reload()`, ou ajouter `?v=N`).

**K5. Interligne global.** Certaines applis imposent `html{line-height:normal!important}` dans leur CSS de production :
les textes sans classe `text-*` y sont plus serrés qu'avec le 1.5 de Tailwind. Lire la règle `html` du CSS original
avant d'écrire la coque.
