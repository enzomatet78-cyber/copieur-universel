# Règles du copieur universel

Ces règles sont l'équivalent des garde-fous d'un outil de modding : elles délimitent ce qu'on fait pour que la
copie reste un exercice personnel, légal et sans risque pour le compte ni pour les données de l'utilisateur.
Elles priment sur la fidélité. Chaque agent (capture, construction, vérification) les applique ; les prompts
de `assets/workflow-template.js` en reprennent l'essentiel pour que la sécurité ne dépende pas du chargement
d'un fichier.

---

## 1. Usage : personnel, local, sans tromperie

- Le clone sert à apprendre, prototyper, maquetter, archiver une interface pour soi. Il est servi sur la boucle
  locale (`--bind 127.0.0.1`), pas sur le réseau ni sur Internet.
- **Ne pas publier** le clone, ne pas le déployer, ne pas le présenter comme l'original : marques, logos,
  textes et visuels appartiennent à leur éditeur. Si l'utilisateur veut publier quelque chose, la bonne voie est
  une interface **inspirée** (sa propre marque, ses propres textes et visuels), pas une copie.
- **Pas de formulaire fonctionnel imitant l'original** pour une connexion ou un paiement : les écrans de connexion
  ou de paiement recréés ne doivent rien envoyer nulle part (pas de `action`, pas de `fetch`, champs sans effet).
  Une page qui fonctionnerait comme la vraie serait un outil d'hameçonnage.
- Le clone ne contacte ni l'API ni les serveurs de l'original (aucune requête de données, aucun jeton). Seules
  des ressources publiques statiques (polices, icônes publiques, images d'illustration) peuvent être chargées par
  URL absolue pour un usage personnel ; on ne les télécharge pas pour les redistribuer.

Pourquoi : une copie fidèle est utile précisément parce qu'elle ressemble à l'original — c'est aussi ce qui la
rendrait trompeuse une fois sortie de la machine de l'utilisateur.

## 2. Ce qu'on a le droit d'utiliser comme source

- **Oui** : ce que l'application montre à l'utilisateur — DOM rendu, styles calculés, arbre d'accessibilité
  (UI Automation), captures d'écran, textes affichés, URL des routes, mesures.
- **Oui, comme reconnaissance** : lire un bundle JS ou un manifeste pour **lister des routes** (noms de chemins),
  détecter le framework d'un exécutable (présence de `app.asar`, de DLL Qt…).
- **Non** : décompiler un binaire propriétaire, désassembler une assembly .NET, extraire et recopier le code d'un
  bundle JS, d'un `app.asar` ou d'une ressource interne, extraire les icônes/ressources embarquées d'un exécutable.
  On **reconstruit** le comportement observé, on ne **copie** pas l'implémentation.
- Exception : le code dont l'utilisateur est l'auteur ou le titulaire (son propre logiciel) peut être lu
  librement.
- Icônes : jeux d'icônes libres équivalents (Tabler, Lucide, Heroicons, Fluent UI System Icons…) ou SVG présent
  dans le DOM rendu ; pour un logiciel natif, à défaut d'équivalent libre, un découpage de capture d'écran pour un
  usage strictement personnel.

Pourquoi : observer une interface pour la reproduire est un exercice classique ; recopier du code ou des
ressources protégés est une reproduction de l'œuvre elle-même, et souvent une violation de licence.

## 3. Aucun contournement

Jamais de contournement de : connexion ou authentification, licence, période d'essai, DRM, paywall,
protection anti-bot ou CAPTCHA, limites de débit, restrictions d'accès géographiques ou de rôle.

- Une page qui n'est pas accessible normalement avec le compte de l'utilisateur n'est pas capturée : on la note
  (« non accessible ») et on s'arrête là.
- **Pas de crawl massif** : on visite les pages de l'inventaire, une à la fois, à un rythme humain. Pas de boucle
  qui aspire des centaines d'URL ou de fiches.
- On ne récupère pas les données d'autres personnes au-delà de ce qui est nécessaire pour comprendre la
  **structure** d'un écran (8 à 10 lignes de tableau suffisent, anonymisées).
- Site public, profil temporaire sans compte : seules les interactions qui ne changent que l'affichage local
  (onglets, menus, accordéons, carrousels, une case de démonstration) sont permises, et seulement si rien n'est
  envoyé au site (`capture-web/references/sites-publics.md` §1) ; aucun formulaire n'est soumis.

## 4. Compte réel : lecture seule stricte

L'agent explore le compte de l'utilisateur comme un visiteur prudent. L'utilisateur se connecte **lui-même**
dans son navigateur ; l'agent ne saisit jamais d'identifiants, ne crée pas de compte, ne se déconnecte pas.

**Autorisé**
- naviguer vers des pages de l'appli ;
- cliquer des onglets, des entrées de navigation, des filtres d'affichage, des accordéons, la pagination ;
- ouvrir un menu déroulant, une modale ou un tiroir informatif, ou un formulaire de création **sans le remplir**,
  puis le fermer (Échap, Annuler, croix) ;
- ouvrir le détail d'un élément en lecture ; survoler pour afficher une infobulle ;
- lire le DOM et les styles, injecter le kit de capture (il ne modifie que le texte affiché localement).

**Interdit**
- tout bouton qui enregistre, crée, modifie, supprime, duplique, archive, envoie, publie, invite, partage ;
- connecter/déconnecter une intégration, activer/désactiver (interrupteurs, cases à cocher) ;
- importer, exporter, télécharger, téléverser ;
- payer, changer d'abonnement, changer d'organisation ou d'espace de travail ;
- révéler, copier ou régénérer une clé, un jeton, un webhook ;
- taper dans un champ, glisser-déposer ;
- tout ce qui peut ouvrir une boîte de dialogue du navigateur (« Quitter la page ? », impression…) ;
- sortir du domaine de l'appli.

**En cas de doute : ne pas cliquer**, décrire l'élément dans `notes.md` (libellé, position, ce qu'il ferait
probablement) et le reconstruire d'après cette description.

Pourquoi une liste explicite : sur un compte réel, une action involontaire (un rendez-vous annulé, un email
envoyé à un client, une intégration déconnectée) a des conséquences pour l'utilisateur et pour des tiers. La
copie ne vaut pas ce risque.

## 5. Données personnelles et secrets

- **Fictives par défaut** : noms de clients, contacts, invités, membres d'équipe, emails, téléphones, adresses,
  adresses IP, messages, notes, enregistrements, montants individuels.
- L'**anonymisation se fait AVANT** toute capture d'écran et tout dump (kit : `__addNames([...])` puis
  `__anonLive()` ; le dump anonymise un clone du DOM). Chaque image est contrôlée ; si une donnée réelle reste
  visible, on complète l'anonymisation et on refait l'image.
- **On peut garder**, si l'utilisateur le veut : le titulaire du compte (son nom, son email, son organisation),
  les réglages propres au compte (noms d'évènements, de workflows, de produits, d'étapes, de champs), les chiffres
  agrégés (totaux, pourcentages) — ce ne sont pas des données sur des tiers.
- **Secrets jamais copiés** : clés API, jetons, mots de passe, webhooks, numéros de carte, IBAN → s'ils sont
  visibles, masqués localement avant la capture ; dans le clone, valeurs fictives masquées
  (ex. `sk_live_••••••••3f9a`).
- Les chemins locaux de la machine (`C:\Users\<nom>\…`, fréquents dans le DOM d'une appli Electron) révèlent
  le nom de session : le kit les remplace par `…\utilisateur\…`, `scan_pii.py` les signale.
- Données fictives **déterministes** (générateur à graine fixe) : mêmes valeurs à chaque chargement, donc
  vérifiables.
- Contrôle final obligatoire : `py "<OUTILS>\scan_pii.py" --root "<CLONE>" --allow "<email gardé>"
  --allow-domain exemple.com` ; un code retour non nul se traite avant la livraison.
- Les dossiers de capture restent dans le dossier de travail, hors du clone livré.

## 6. Logiciels de bureau

- Lancer l'appli avec un **profil ou dossier de données temporaire** quand c'est possible
  (Electron/Chromium : `--user-data-dir=<dossier temporaire>`), pour ne pas toucher aux données ni à la session
  de l'utilisateur. Si ce n'est pas possible, le dire et rester en lecture seule stricte.
- Ne rien enregistrer, ne pas modifier les préférences, ne pas ouvrir les documents personnels de
  l'utilisateur ; pour montrer un état « document ouvert », utiliser un document vierge ou fictif créé pour
  l'occasion dans le dossier de travail — sauf pour une appli du Store qui restaure sa session (Bloc-notes de
  Windows 11) : la lancer sans fichier, sinon le fichier de test réapparaîtrait chez l'utilisateur.
- Ne pas ouvrir les listes de fichiers récents (« Récent », « Ouvrir récent ») : ce sont les fichiers de
  l'utilisateur.
- **Mises à jour automatiques bloquées** dans le profil temporaire avant le lancement quand l'appli le permet :
  une appli lancée pour la capture peut installer sa nouvelle version et modifier l'installation de
  l'utilisateur (vu avec VS Code). Ne jamais interrompre un installeur en cours ; le signaler.
- Fermer les menus et boîtes de dialogue par Échap ou Annuler ; ne jamais répondre « Enregistrer ».
- **Ne fermer que les processus qu'on a lancés** (noter leur PID au lancement) ; jamais une instance déjà ouverte
  par l'utilisateur. Pour la même raison, les relevés visent ce PID (`-ProcessId`) plutôt qu'un nom de
  processus, qui pourrait désigner la fenêtre de l'utilisateur et ses documents.
- **Navigateur piloté pour un site public** : Chrome/Edge seulement en `--headless=new` avec
  `--user-data-dir=<dossier temporaire>` ; sous Windows, un `chrome.exe` lancé sans ces options s'ouvre dans le
  navigateur de l'utilisateur, avec ses sessions.
- `uia_dump.ps1` sans `-IncludeValues` par défaut : les champs peuvent contenir des données personnelles.
- Aucune modification système (registre, services, pare-feu, réglages de sécurité) pour faciliter la capture.

## 7. Tiers et légalité

- Respect de la vie privée des tiers : pas de clone d'un profil, d'une messagerie ou d'un espace d'une autre
  personne ; pas de capture de conversations réelles.
- Pas de copie d'une appli dont l'usage serait illégal, ni d'une appli destinée à tromper (banque, administration,
  paiement, connexion d'un service tiers) même « pour un test » ou « pour une démo ».
- Si l'utilisateur insiste pour franchir une de ces règles, expliquer pourquoi on s'arrête et proposer
  l'alternative la plus proche (interface inspirée, données fictives, copie de la partie accessible).

## 8. Résumé à recopier dans les prompts d'agents

> Usage personnel et local. Reconstruire à partir de ce qu'on observe, ne jamais recopier de code propriétaire.
> Aucun contournement, pas de crawl. Compte réel en lecture seule stricte (ne rien enregistrer, créer, modifier,
> supprimer, envoyer, connecter, payer ; ne rien taper ; en cas de doute, ne pas cliquer). L'agent ne saisit
> jamais d'identifiants. Données personnelles anonymisées avant toute capture ; secrets jamais copiés. Logiciels :
> profil temporaire, mises à jour bloquées, rien enregistrer, pas de fichiers récents, ne fermer que ce qu'on a
> lancé (jamais un installeur en cours).
