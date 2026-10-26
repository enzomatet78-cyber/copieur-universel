# Modèles : `inventaire.md`, `unites.json` et `fondation.json`

Trois fichiers sortent de la reconnaissance, dans le **dossier de travail** (jamais dans le clone) :
- `inventaire.md` : lu par les humains et par tous les agents (capture, construction, vérification) ;
- `unites.json` : le découpage, au format exact attendu par `copier-une-appli/assets/workflow-template.js`
  (`args.units`) — et réutilisable tel quel pour une orchestration à la main avec l'outil Agent ;
- `fondation.json` : la page de référence, au même format (`config.fondation.unite` du gabarit, voir §3).

Les fichiers bruts restent à côté : `reconnaissance/stack.json`, `routes.json`, `routes.txt`, `detect.json`,
`inv-<slug>.json` (un par écran visité). Slug = route sans le premier `/`, `/` → `-` (`/app/settings/profile` →
`app-settings-profile`), comme les dossiers de capture.

---

## 1. Vocabulaire des statuts
| Statut | Sens | Suite |
|---|---|---|
| `ok` | l'écran s'affiche à cette route | à capturer |
| `redirection → /cible` | l'URL change en arrivant | page de redirection dans le clone, rattachée à l'unité de la cible |
| `même écran que /x` | l'URL reste mais le contenu est celui d'une autre route | page qui réutilise le même contenu |
| `404` | « Page non trouvée » | rien à construire ; garder dans la liste des routes écartées |
| `connexion` | renvoie à un écran de connexion | l'utilisateur doit se connecter lui-même, ou hors périmètre |
| `non accessible` | 403, rôle ou offre insuffisants, mur de mise à niveau | noté, jamais contourné |
| `modale sur /x` | la route ouvre une grande modale par-dessus un autre écran | capturer la modale + l'écran du dessous |
| `à éviter` | nom d'action (déconnexion, suppression, paiement…) | ne pas visiter |
| `non visité` | pas encore qualifié | à visiter ou à sortir du périmètre |

---

## 2. Modèle d'`inventaire.md`
```markdown
# Inventaire — <Nom de l'appli>
- Original : <URL de base> | <chemin de l'exe / nom du processus>     Mode : web-connecte | web-public | electron | natif
- Date : <AAAA-MM-JJ>   Viewport / fenêtre de référence : 1536×791 (DPR 1)   Langue de l'interface : fr
- Périmètre demandé : <appli entière | section X | écran Y>   Données : fictives sauf <titulaire, organisation…>

## 1. Technologie (sources : stack.json, routes.json, detect.json)
- Type : SPA React 18 + React Router (routeur history) | Electron 43 (Chromium 150) avec React | WinUI 3 (MSIX)…
- Styles : Tailwind CSS v3 (≈ 80 % des classes, valeurs arbitraires) → recopier les classes + CDN Tailwind
- Composants : Headless UI (menus, modales) ; icônes : Tabler (stroke 2) ; graphiques : Recharts (SVG)
- Polices : Inter 400/500/600/700 (Google Fonts) ; corps 14 px #111928
- Palette (fonds / textes / bordures dominants) : #ffffff, #f9fafb, #eff6ff / #111827, #6b7280, #2563eb / #e5e7eb
- Variables CSS de :root utiles : --radius: 8px…
- Alertes : 1 iframe vidéo (Wistia), aucun canvas, pas de shadow DOM
- Conséquences pour la reconstruction : <ce que la coque devra fournir, ce qui sera approximé>

## 2. Éléments communs
| Élément | Présent sur | Mesures (px) | États | Notes |
|---|---|---|---|---|
| Barre latérale globale | toutes les pages /app | 240 déplié / 52 replié ; liens h 32 | actif, survol, repliée, menu utilisateur ouvert | clé nav par entrée : home, dashboard… |
| En-tête de section « Paramètres » | /app/settings/* | barre 240 + titre h 52 | entrée active, groupes repliables | propriétaire : unité settings-general |
| Lanceur de chat | toutes | 48×48, bas-droite 25/46 | — | widget tiers, recréé en statique |
| Infobulles / modales / toasts | — | rayon 8, ombre… | — | style commun à mettre dans la coque |

## 3. Écrans et routes
| Route / écran | Section | Statut | Titre de l'onglet | États à capturer | Ne pas cliquer | Notes |
|---|---|---|---|---|---|---|
| /app/dashboard | analytique | ok | Tableau de bord | onglets 7/30/90 j, infobulles KPI, sélecteur de dates | Synchroniser | page longue : scrollHeight 3 400 |
| /app/contacts | base | ok | Contacts | vue tableau, filtres, tri, tiroir détail (1 contact) | Importer, Exporter, Supprimer | 8 lignes max, données fictives |
| /app/contacts/:id | base | ok (via un contact de la liste) | — | onglets du profil | Modifier, Envoyer | identifiant réel : ne pas le noter |
| /app/settings | paramètres | redirection → /app/settings/profile | — | — | — | — |
| /app/old-reports | — | 404 | — | — | — | écartée |

## 4. Routes écartées ou à éviter
- 404 / mortes : …
- Non accessibles (rôle, offre) : …
- À éviter (actions) : /app/logout, /app/account/delete…
- Hors périmètre (pages publiques, documentation externe) : …

## 5. Découpage en unités (détail : unites.json)
| Unité | Section | Propriétaire | Clé nav | Écrans | Commun à fournir (propriétaire) |
|---|---|---|---|---|---|
| analytics | analytics | oui | dashboard | /app/dashboard | (aucun) |
| settings-general | settings | oui | settings | /app/settings/profile, … | barre latérale des paramètres (toutes les entrées), barre de titre |
| settings-equipe | settings | non | settings | /app/settings/users, /app/settings/billing | — |

## 6. Fondation
- Page de référence : /app/getting-started (navigation complète, menu utilisateur, carrousel, lanceur de chat)
- États de la coque à capturer avec elle : barre repliée, menu utilisateur ouvert, petits écrans (375 px)

## 7. Questions pour l'utilisateur
- Périmètre : les 11 pages d'intégrations sont-elles utiles ?
- Données gardées réelles : titulaire du compte et organisation ?
```

---

## 3. Format d'`unites.json`
Tableau d'unités, **dans l'ordre de capture** (les propriétaires de section et les unités qui débloquent les
autres d'abord). Champs (ceux du gabarit Workflow) :

| Champ | Obligatoire | Contenu |
|---|---|---|
| `key` | oui | identifiant unique : lettres ASCII, chiffres, `.`, `_`, `-` (ni espace ni accent ; le gabarit refuse le reste) — c'est le nom du dossier de capture |
| `section` | oui | nom de section (les unités d'une section partagent `assets/sections/<section>.js|css`) |
| `owner` | oui | `true` pour **une seule** unité par section (elle crée les fichiers communs de la section) |
| `shared` | si `owner` | description précise de ce qui est commun aux écrans de la section, y compris les entrées construites par d'autres unités |
| `nav` | oui | clé de l'élément actif de la navigation commune (`''` si aucun) |
| `routes` | oui | routes (web) ou écrans/fenêtres (bureau) de départ |
| `notes` | oui | états à couvrir, modales, pièges, **ce qu'il ne faut surtout pas cliquer**, routes à découvrir |

Exemple :
```json
[
  { "key": "settings-general", "section": "settings", "owner": true, "nav": "settings",
    "routes": ["/app/settings/profile", "/app/settings/availability", "/app/settings/security"],
    "shared": "la barre latérale des paramètres (titre, recherche, 4 groupes repliables avec TOUTES leurs entrées et leurs routes, y compris celles des autres unités) et la barre de titre de page (icône + titre + bouton), avec un paramètre pour l'entrée active",
    "notes": "Noter dans routes-parametres.md (dossier de capture de l'unité) la route de CHAQUE entrée du menu des paramètres (et si elle ouvre une modale) : les autres unités en dépendent. Ne pas cliquer : Enregistrer, Supprimer le compte, interrupteurs." },
  { "key": "analytics", "section": "analytics", "owner": true, "nav": "dashboard",
    "routes": ["/app/dashboard"], "shared": "(aucun)",
    "notes": "Page longue (scrollHeight ≈ 3 400) : couvrir toute la hauteur ; lire les valeurs des graphiques dans le SVG ; onglets Jour/Semaine/Mois ; infobulles des KPI. Ne pas cliquer : Synchroniser, Exporter." },
  { "key": "settings-equipe", "section": "settings", "owner": false, "nav": "settings",
    "routes": ["/app/settings/users", "/app/settings/billing"],
    "notes": "Facturation : lecture seule absolue, masquer tout numéro de carte. Gestion des utilisateurs : ouvrir « Inviter » sans valider." }
]
```
`unites.json` est un fichier de travail : les accents y sont permis dans `shared` et `notes`. Si on recopie ces
unités dans `UNITS` d'un script Workflow lancé par `scriptPath`, les écrire en ASCII ou en `\uXXXX` (un script
accentué peut être refusé : `copier-une-appli/references/orchestration.md` §10).

### La page de référence : `fondation.json`
La fondation n'est **pas** dans `unites.json` (elle serait reconstruite deux fois). Elle se décrit à part, au même
format sans `owner`/`shared`, et devient `config.fondation.unite` du gabarit (avec `fondation.faite: false`) :
```json
{ "key": "fondation", "section": "accueil", "nav": "home",
  "routes": ["/app/getting-started"],
  "notes": "Page de référence : navigation complète, menu utilisateur ouvert, barre repliée, lanceur de chat, rendu à 375 px. Ne pas cliquer : Inviter, Se déconnecter." }
```
Une fois la fondation validée, sa route va dans `config.pageReference` et `fondation.faite` passe à `true`.
Copie d'une seule page ou d'un seul écran : `fondation.json` seul, et `unites.json` = `[]` (la fondation est
la livraison).

Pour un logiciel de bureau, `routes` contient des noms d'écrans explicites, par exemple
`["fenetre-principale", "menu-fichier", "dialogue-options>onglet-general", "dialogue-options>onglet-affichage"]`,
et `notes` dit comment y accéder (« menu Outils > Options… », raccourci) et ce qu'il ne faut pas activer.

---

## 4. Estimation à présenter à l'utilisateur
- Agents ≈ 4 par unité (capture, construction, 2 vérifications) + 2 (contrôle final, coque) + fondation
  (≈ 20 : capture, construction, puis 2 passes de relecteurs, vérificateurs adverses et correcteur — détail et
  variante `verifAdverseUnites` : `copier-une-appli/references/orchestration.md` §9).
- Durée dominée par la capture, séquentielle : 15 à 45 min par unité selon le nombre d'états.
- Présenter ces chiffres comme des ordres de grandeur, et proposer une réduction de périmètre (une section, la
  page principale) quand le total dépasse ce que l'utilisateur semble attendre.
