# Conventions d'un clone (skill reconstruire-appli)

Ces conventions existent pour que des agents qui ne se parlent pas (constructeurs en parallèle,
vérificateurs, contrôle final) produisent un site cohérent : mêmes emplacements, mêmes liens, mêmes
attributs, mêmes règles de propriété. Le GUIDE du projet (§9) les reprend en les précisant pour l'appli.

---

## 1. Arborescence du clone

```
<CLONE>/                              racine servie par python3 -m http.server (jamais ouverte en file://)
  index.html                          redirection vers la page d'accueil (/app/... ou /ecrans/principal/)
  app/index.html                      (web) redirection vers l'accueil, ou la page « / » de l'original
  app/<route>/index.html              (web) une page par route
  ecrans/<ecran>/index.html           (bureau) un écran par fenêtre ou vue principale
  assets/shell-base.js                coque générique — copie conforme du skill, jamais modifiée dans le clone
  assets/shell-base.css               styles génériques — idem (on règle ses variables dans shell.css)
  assets/shell.js                     coque propre à l'appli (navigation, menu utilisateur, configuration, icônes)
  assets/shell.css                    classes personnalisées de l'original, variables, styles de la coque
  assets/tailwind-config.js           police et palette relevées
  assets/fake-data.js                 données fictives déterministes
  assets/sections/<section>.js|css    éléments communs d'une section (propriétaire unique)
  assets/img/                         images fournies par l'utilisateur ou recadrées de ses captures (bureau)
  lancer-app.cmd | .command           (bureau ; facultatif pour le web) fenêtre d'appli : Edge --app (Windows),
                                      Chrome --app (macOS)
```
Les captures, le GUIDE, l'inventaire et les scripts de test restent dans le **dossier de travail**, hors du
clone : ils ne doivent être ni servis ni livrés.

Page de redirection (racine, `app/index.html`, routes qui redirigent dans l'original) :
```html
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Redirection…</title><link rel="icon" href="data:,">
<meta http-equiv="refresh" content="0; url=/app/accueil">
<script>location.replace('/app/accueil' + location.search + location.hash);</script>
</head><body></body></html>
```

---

## 2. Appli web : route → fichier

Règle : la page affichée à l'adresse `/<chemin>` de l'original va dans **`app/<chemin>/index.html`** et se sert
à `/app/<chemin>`. Si les adresses de l'original commencent déjà par `/app/` (cas d'iClosed :
`/app/dashboard`), on ne double pas le préfixe : `app/dashboard/index.html`.

Pourquoi un préfixe commun : les pages ne peuvent pas entrer en collision avec `assets/`, la racine reste libre
pour la redirection, et `check_links.py` comme les vérificateurs savent où chercher.

| Original | Clone | Remarque |
|---|---|---|
| `/dashboard` | `app/dashboard/index.html` | liens internes réécrits `/dashboard` → `/app/dashboard` |
| `/app/settings/billing` | `app/settings/billing/index.html` | préfixe `/app` déjà présent |
| `/` (page d'accueil réelle) | `app/index.html` | la racine du clone redirige vers `/app/` |
| `/#/reports` (routage par ancre) | `app/reports/index.html` | liens `#/reports` → `/app/reports` |
| `/contacts?tab=notes` | même page que `/contacts` | état lu dans l'URL (`data-tabs-param="tab"`) |
| `/contacts/8f3a…` (segment variable) | `app/contacts/_id/index.html` | une page par motif ; liens `/app/contacts/_id?id=c1004` ; la page lit `id` et choisit l'enregistrement `FAKE` |
| route qui redirige | page de redirection (§1) vers la cible locale | noter la redirection dans le compte rendu |
| « page introuvable » dans l'original | rien | le noter ; ne pas inventer de page |

`python3 -m http.server` redirige `/app/x` vers `/app/x/` : les liens peuvent garder la forme de l'original, avec
ou sans barre finale.

---

## 3. Logiciel de bureau : écrans

- Un écran = une fenêtre ou une grande vue de l'original : `ecrans/<ecran>/index.html`, `<ecran>` en
  minuscules-tirets français (`principal`, `preferences`, `a-propos`, `editeur`, `historique`…).
- La racine `index.html` redirige vers `/ecrans/principal/` ; le lanceur (`lancer-app.cmd` sous Windows,
  `lancer-app.command` sous macOS) ouvre `CU_PAGE=/ecrans/principal/`.
- **Boîtes de dialogue modales** (Préférences, Rechercher, À propos qui bloquent la fenêtre) : modales dans
  l'écran qui les ouvre (`data-modal-open`), à la taille relevée.
- **Fenêtres indépendantes** (deuxième fenêtre d'un outil, palette flottante) : écran séparé, ouvert par
  `window.open('/ecrans/<ecran>/', '<ecran>', 'popup,width=W,height=H')` — la fenêtre d'appli l'ouvre en
  fenêtre sans barre d'adresse.
- Vues internes d'une même fenêtre (onglets, panneaux latéraux, pages d'un assistant) : dans l'écran, avec
  `data-tabs` ou des états, pas des fichiers séparés.
- `<title>` = titre exact de la fenêtre originale, caractère par caractère (ex. `Sans titre – Bloc-notes`,
  avec le tiret demi-cadratin U+2013 entouré d'espaces de Windows 11, pas un trait d'union) : la barre de titre
  de la fenêtre d'appli l'affiche.

---

## 4. Liens, chemins, images

- Chemins **absolus depuis la racine** du clone : `/assets/shell.js`, `/app/contacts`, `/ecrans/principal/`.
  Ils ne fonctionnent qu'à travers le serveur local : ne jamais tester en `file://`.
- Liens internes vers la page locale correspondante, même si elle est construite par un autre agent
  (le contrôle final vérifie qu'elle existe). Liens externes (aide, documentation, réseaux) : identiques à l'original,
  `target="_blank" rel="noopener noreferrer"` comme lui.
- Images et logos : URL **publiques absolues** de l'original (`https://app.exemple.com/static/logo.svg`),
  comme les a relevées la capture ; rien n'est téléchargé. Contenu derrière connexion (avatars, pièces jointes)
  → avatar à initiales ou image neutre. Logiciel de bureau : icônes recadrées dans les captures de fenêtre
  (`fidelite.md` §8) rangées dans `assets/img/`.
- Icône de l'onglet : URL absolue de l'original, ou `data:,` (pas de requête 404 dans la console).

---

## 5. Nommage et attributs

| Élément | Convention |
|---|---|
| `#nav-slot`, `#topbar-slot` | emplacements vides rendus par `shell.js` ; la page n'y écrit rien. `class="contents"` sur `#nav-slot` quand la coque recopiée est une enveloppe stylée par son id, enfant direct du conteneur flex (`#sidebar-wrap { width: 240px }`) |
| `#main` | conteneur qui défile (mesures `scrollHeight`, masquage des infobulles au défilement) |
| `body[data-nav]` | clé de l'élément de navigation actif (liste fermée dans le GUIDE) ; vide si hors menu |
| `body[data-rail]` ou autre attribut de page | variantes de la coque (ex. barre repliée forcée) documentées dans le GUIDE |
| identifiants | en français, minuscules-tirets, préfixés par le bloc : `modale-export`, `menu-filtre-statut`, `panneau-faq-2` |
| comportements | attributs de `shell-base.js` (`data-menu`, `data-modal-open`, `data-tabs`, `data-toggle`, `data-switch`, `data-tip-text`) plutôt que du JS maison |
| classes personnalisées | celles de l'original (relevées dans `styles.css`) dans `shell.css` ou le CSS de section, sous le **même nom** |
| icônes | `data-icon="lib:nom"` comme dans le dump (`tabler:plus`, `lucide:inbox`) ; noms courts acceptés |

---

## 6. La coque propre à l'appli : exemple complet

Exemple **testé** (page de démonstration du skill, sous Windows et sous macOS : navigation active, repli
mémorisé seulement au clic, menu utilisateur, icônes capturées). À adapter : la structure et les classes
viennent du dump de la coque de l'original, pas de cet exemple. Cette organisation (`shell-base.js` + `shell.js`,
`#nav-slot`) est postérieure au clone iClosed (une seule coque `shell.js`, `#root`/`#sidebar-wrap`) : elle n'a
été validée que sur cette page de démonstration, pas encore sur un clone complet.

```js
/* assets/shell.js — coque propre à l'appli « <Nom> » (s'appuie sur shell-base.js) */
(function () {
  'use strict';
  Shell.configure({
    appName: '<Nom>',                       // préfixe du stockage local : clone-<nom>:
    // locale: 'en-US', currency: 'USD',    // si l'original n'est pas en français
    // bureau: true,                        // logiciel de bureau
    user: { firstName: FAKE.OWNER.firstName, lastName: FAKE.OWNER.lastName, email: FAKE.OWNER.email },
    org: { name: FAKE.OWNER.org }
  });

  /* Icônes de la capture : contenu de icones.txt collé tel quel (une ligne par icône) */
  Shell.registerIconsText([
    'lucide:inbox x3 | viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" | <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'
  ].join('\n'));
  /* Icône fine propre à l'appli : trait verrouillé (une classe stroke-2 ne l'écrase pas) */
  Shell.registerIcons({ 'calendar16': { vb: '0 0 16 16', sw: 1.5, lock: true, body: '<rect x="2.67" y="3.33" width="10.67" height="10.67" rx="1.33"/><path d="M2.67 7.33H13.33"/><path d="M10.67 2V4.67"/><path d="M5.33 2V4.67"/>' } });
  /* Logo : SVG complet recopié tel quel */
  Shell.registerIcons({ 'logo': '<svg viewBox="0 0 32 32" fill="none">…</svg>' });

  var NAV = [   // ordre, libellés, icônes, liens et badges EXACTS de l'original
    { key: 'accueil', label: 'Tableau de bord', icon: 'layout-grid', href: '/app/accueil' },
    { key: 'agenda', label: 'Agenda', icon: 'calendar16', href: '/app/agenda' },
    { key: 'boite', label: 'Boîte de réception', icon: 'lucide:inbox', href: '/app/boite', badge: 'BÊTA' }
  ];
  var ITEM = 'sb-item flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm';   // classes communes relevées

  var slot = document.getElementById('nav-slot');
  if (!slot) return;                                   // écran sans navigation commune
  slot.innerHTML = Shell.html`
    <nav id="sidebar" class="h-full w-[240px] flex flex-col bg-white border-r border-gray-200 transition-all duration-300">
      <div class="sb-head flex items-center justify-between h-[52px] px-4 border-b border-gray-200">
        <a href="/app/accueil" class="flex items-center gap-2"><svg data-icon="logo" class="w-6 h-6"></svg><span class="sb-label font-semibold" data-bind="appName"></span></a>
        <button type="button" id="sb-toggle" class="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Replier la barre latérale"><svg data-icon="layout-sidebar" class="w-4 h-4"></svg></button>
      </div>
      <ul class="flex-1 overflow-y-auto scrollbar-thin space-y-0.5 py-3 px-2">
        ${NAV.map(function (it) {
          return Shell.html`<li><a href="${it.href}" class="${ITEM}" data-nav-key="${it.key}"
              data-active-class="bg-blue-50 text-blue-600 font-medium" data-inactive-class="text-gray-900 hover:bg-gray-100">
            ${Shell.icon(it.icon, 'w-4 h-4 shrink-0')}<span class="sb-label flex-1 truncate">${it.label}</span>
            ${it.badge ? Shell.html`<span class="sb-label px-1.5 rounded border text-xs font-medium bg-blue-100 border-blue-200 text-blue-800">${it.badge}</span>` : ''}
          </a></li>`;
        })}
      </ul>
      <div class="relative mx-2 mb-2">
        <button type="button" id="user-btn" data-menu="user-menu" aria-expanded="false" class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200">
          <span class="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center" data-bind="user.initial"></span>
          <span class="sb-label text-sm font-medium truncate flex-1 text-left" data-bind="user.fullName"></span>
          <svg data-icon="chevron-down" class="sb-label w-5 h-5 text-gray-500 transition-transform" data-chevron></svg>
        </button>
        <div id="user-menu" class="hidden absolute bottom-full left-0 mb-2 w-[260px] rounded-lg border border-gray-200 bg-white z-50" role="menu">
          <div class="px-4 py-3 border-b border-gray-200"><p class="text-sm font-semibold" data-bind="user.fullName"></p><p class="text-sm text-gray-500" data-bind="user.email"></p></div>
          <button type="button" class="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50" role="menuitem" data-menu-close><svg data-icon="logout" class="w-[18px] h-[18px] text-gray-500"></svg>Se déconnecter</button>
        </div>
      </div>
    </nav>`;
  Shell.hydrate(slot);

  /* Repli : état initial sans animation ; seul le CHOIX de l'utilisateur est mémorisé */
  var state = Shell.store.get('shell', {});
  var sidebar = document.getElementById('sidebar');
  function setCollapsed(c, persist) {
    sidebar.classList.toggle('is-collapsed', c);
    sidebar.classList.toggle('w-[240px]', !c);
    sidebar.classList.toggle('w-[52px]', c);
    if (persist) { state.collapsed = c; Shell.store.set('shell', state); }
  }
  var start = typeof state.collapsed === 'boolean' ? state.collapsed : window.matchMedia('(max-width: 767px)').matches;
  Shell.noTransition(sidebar, function () { setCollapsed(start, false); });
  document.getElementById('sb-toggle').addEventListener('click', function () {
    setCollapsed(!sidebar.classList.contains('is-collapsed'), true);
  });
})();
```

Et dans `assets/shell.css` :
```css
* { font-family: Inter, sans-serif; }                 /* police relevée */
html, body { height: 100%; }
body { margin: 0; -webkit-font-smoothing: antialiased; color: rgb(17, 24, 39); background: rgb(249, 250, 251); overflow: hidden; }
:root { --tip-bg: rgb(17, 25, 40); --tip-arrow-color: #373737; }   /* infobulle calée sur l'original */
.bg-gradient-blue { background: linear-gradient(94deg, rgb(3, 25, 83) -43.1%, rgb(2, 54, 194) 99.55%); }  /* classe perso relevée */
#sidebar.is-collapsed .sb-label { display: none; }
#sidebar.is-collapsed .sb-item { justify-content: center; padding-left: 0; padding-right: 0; }
```

---

## 7. Fichiers de section

Quand plusieurs pages d'une section partagent un en-tête, des onglets ou un menu secondaire :
`assets/sections/<section>.js` (+ `.css`), écrit par **un seul** constructeur (le propriétaire de la section),
avec une API documentée en tête de fichier, complète dès le départ (toutes les entrées de la section, même
celles construites par d'autres) :
```js
/* assets/sections/reglages.js — en-tête et menu des Réglages.
   Usage : <div id="section-slot"></div> puis Section.render({ active: 'profil' })
   Entrées : profil, equipe, facturation, integrations, securite */
window.Section = { render: function (o) { /* … Shell.html`…` … Shell.hydrate(slot) … */ } };
```
Les autres pages de la section l'utilisent sans le modifier et signalent leurs besoins (`sectionIssues`).

---

## 8. Qui modifie quoi

| Fichier | Pendant la fondation | Pendant la construction parallèle | Après (agent « Coque ») |
|---|---|---|---|
| `shell-base.js|css` | personne (copie du skill) | personne | personne ; un défaut générique se corrige dans le skill |
| `shell.js|css`, `tailwind-config.js`, `fake-data.js` | agent de la fondation | personne → `shellIssues` | applique les demandes retenues |
| page de référence | agent de la fondation | personne | revérifiée après changement de coque |
| `assets/sections/<s>.*` | — | propriétaire de la section | applique les `sectionIssues` retenues |
| `app/<route>/` ou `ecrans/<ecran>/` | — | constructeur puis vérificateurs de l'unité | contrôle final |

Une demande utile est précise : `[fichier] problème observé → changement proposé (pages concernées)`, ex.
`[assets/shell.js] l'entrée « Médiathèque » manque dans NAV → ajouter { key: 'medias', label: 'Médiathèque',
icon: 'photo', href: '/app/medias' } (pages : app/medias)`.

---

## 9. Modèle de GUIDE.md du projet

Écrit pendant la fondation, dans le dossier de travail ; tous les agents le lisent en premier.

````markdown
# Guide — clone local de <Nom de l'appli> (en <langue de l'original>)

## 1. Le projet
- Dossier du clone : `<CLONE>` (PROJET ci-dessous) — servi sur `http://localhost:<PORT>/` (serveur déjà lancé :
  ne pas le lancer ni l'arrêter).
- Outils : `OUTILS="<chemin absolu du dossier outils>"` ; commandes pour l'outil Bash, chemins entre guillemets,
  `python3` (sous Windows, `py` remplace `python3`).
- Original : `<URL ou programme>` — <connecté : compte de l'utilisateur, LECTURE SEULE | public | logiciel>.
- Une page = `PROJET/app/<route>/index.html` (route `/app/x` → `app/x/index.html`) | un écran =
  `PROJET/ecrans/<ecran>/index.html`. Liens internes : `/app/x`.
- Déjà fait et VALIDÉ (ne pas modifier) : `<page de référence>`, `assets/shell-base.*`, `assets/shell.*`,
  `assets/tailwind-config.js`, `assets/fake-data.js`, redirections.
- Référence de qualité : ouvrir `http://localhost:<PORT>/<page de référence>` et lire sa source.

## 2. Gabarit OBLIGATOIRE d'une page
<copier ici la page de référence réduite à son squelette : <head> exact, <body data-nav>, disposition, scripts>
- Clés `data-nav` : <liste fermée : accueil, contacts, …> ; page hors menu : clé de la section la plus proche, ou rien.
- Variantes de la coque : <ex. data-rail="true" sur les Réglages>.

## 3. API de la coque
- Générique (shell-base.js) : <tableau du skill reconstruire-appli §5, ou renvoi>.
- Propre à l'appli (shell.js) : <ce qu'elle injecte ; fonctions exposées ; classes de shell.css disponibles>.
- Sections : <liste des fichiers assets/sections/* et leur API, avec leur propriétaire>.

## 4. Données
- Fictives pour toute donnée personnelle : `window.FAKE` (<jeux disponibles>), graine fixe, `FAKE.TODAY` = <date>.
- Gardé tel quel : <titulaire ? organisation ? réglages du compte ? agrégats ?>.
- Jamais de secret réel : `FAKE.masked('sk_live_', r)`.

## 5. Fidélité et interactions
- Recopier structure, classes, textes exacts, icônes, ordre ; le DOM capturé est la référence, les images tranchent.
- Reproduire onglets, menus, modales, tiroirs, filtres/tri/recherche/pagination (données fictives), états vides,
  squelettes ; aucune requête réseau, pas d'alert()/confirm().
- Images : URL absolues publiques de l'original. Graphiques : SVG inline aux mêmes valeurs.
- Viewport de comparaison : <L×H> ; vérifier aussi 375 px. Zéro erreur console.

## 6. Ce qui est partagé
- Ne pas modifier la coque, les données, la configuration ni la page de référence → `shellIssues`.
- Fichiers de section : leur propriétaire seulement → `sectionIssues`. Chacun ne modifie que ses pages.

## 7. Vérifier son travail
- Navigateur intégré (`mcp__Claude_Browser__*`) : SON onglet (`tabs_create`/`preview_start`), `tabId` partout,
  `resize_window` au viewport, `read_console_messages`, captures à comparer ; fermer son onglet à la fin.
- Navigateur intégré absent ou plein : Chrome/Edge headless sur profil temporaire
  (`python3 "$OUTILS/headless.py" lancer --viewport <L×H>` → noter port et profil en clair),
  `python3 "$OUTILS/cdp_eval.py" --port <port> nav --console`, `eval --file "$OUTILS/verif.js"`, `shot`, `hover` ;
  à la fin `python3 "$OUTILS/headless.py" fermer --profil "<profil>" --port <port>`. Jamais `open -a` ni un
  navigateur sans `--headless=new` et profil temporaire : il s'ouvrirait avec les sessions de l'utilisateur.
- Logiciel : PID et handle de l'instance lancée pour la capture : <…> (relevés dans le notes.md de la capture).
- Le navigateur réel de l'utilisateur est réservé aux agents de capture ; personne ne retourne dans l'appli
  réelle pour « vérifier un détail » : un état manquant se signale dans le compte rendu.
````

---

## 10. Conversions depuis la capture

**Icônes** : `icones.txt` se colle tel quel dans `Shell.registerIconsText(...)` (§6) — chaque ligne
`lib:nom xN | attributs | contenu` enregistre `lib:nom` et l'alias `nom`. Une ligne « sprite externe » doit
être complétée à la main (SVG du symbole relevé sur l'image ou dans le DOM).

**Dump → contenu de `<main>`** : l'outil `OUTILS/dom2page.py` (Python standard, testé sur des dumps de l'ancien
et du nouveau kit) inverse les échappements du kit s'il en reste (y compris un dump dont le seul échappement est
un « § »), transforme les icônes reconnues en espaces réservés `data-icon`, garde le SVG complet des icônes sans
nom, et liste ce qui reste à reconstruire à la main :
```
python3 "$OUTILS/dom2page.py" "<capture>/<page>/dom-initial.html" "<TRAVAIL>/build/main.html"
→ (sortie d'erreur) icones a enregistrer (12) : tabler:home, …   a reconstruire (2) : - IFRAME https://… 444x248 …
```
Le mode est deviné (marqueurs du kit et aucun « ; & ? » brut = dump échappé) ; `--echappe` ou `--brut` le
force. Sont listés : `IFRAME`, `WISTIA`, `SVG complexe`, `CANVAS`, `OBJECT`, `EMBED`, les lignes « +N … non
capturés » et les avatars masqués (`src="[AVATAR]"`).
Ensuite, à la main : retirer les commentaires de notes du capteur, remplacer les lignes de données par un
rendu `FAKE` (le dump n'en garde que quelques-unes), rebrancher les états, reconstruire les éléments listés. Les
`<template id>` gardés par le kit (textes d'infobulle) se reprennent tels quels pour `data-tip="id"`.

**Bureau (`uia-*.json`)** : chaque nœud donne `ControlType`, `Name`, `BoundingRectangle` (relatif à la
fenêtre) → structure et positions ; convertir en px CSS (`fidelite.md` §11) et reproduire les contrôles avec
du HTML sémantique (`button`, `input`, `select`, `textarea`, `table`, `[role=menu]`…) stylé d'après les images.

---

## 11. Script de page : règles

- Un seul `<script>` en fin de page, dans `(function () { 'use strict'; … })();`, après fake-data, shell-base,
  shell et l'éventuel fichier de section.
- Rendu par `Shell.html` (échappement), icônes générées par `Shell.icon`, nombres et dates par `Shell.fmt*`.
- Données déterministes (`FAKE.rng('<route>-<usage>')`), aucune requête réseau (`fetch`, `XMLHttpRequest`,
  formulaires `action`), aucun `alert()`/`confirm()`/`prompt()`, aucun `console.log` laissé.
- `Shell.store` seulement pour les choix d'affichage de l'utilisateur (onglet, repli, tri) — jamais pour un état
  appliqué automatiquement.
- Le code qui mesure ou dépend des icônes hydratées s'exécute dans `Shell.ready(fn)`.
