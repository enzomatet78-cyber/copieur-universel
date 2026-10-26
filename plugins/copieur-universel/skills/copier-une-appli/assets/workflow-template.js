/*
 * copieur-universel -- gabarit de script Workflow (Claude Code)
 * =============================================================
 * Recree une appli (web ou logiciel de bureau) en local, avec la methode validee sur iClosed :
 *   [Fondation (optionnelle)] page de reference + coque partagee, 2 passes de verification adverses
 *   Capture        une unite a la fois (un seul navigateur / une seule appli pilotable), lecture seule, anonymisee
 *   Construction   un constructeur par unite, lance des que sa capture est prete ; les fichiers communs d'une
 *                  section ont un proprietaire unique : les autres unites de la section attendent sa construction
 *   Verification 1 puis Verification 2 (independante, depuis zero) par unite ; chaque passe corrige ses pages
 *   Controle final du site (liens, console, confidentialite, coherence)
 *   Coque          application des demandes de modification de la coque / des sections (un seul agent)
 *
 * FICHIER EN ASCII PUR : les textes accentues sont ecrits en \uXXXX. Un script lance via scriptPath qui
 * contient des caracteres non ASCII peut etre refuse ("control characters"). Si vous l'editez avec des
 * accents, re-echappez-le (script Python dans references/orchestration.md) ou passez-le en ligne.
 *
 * MODE D'EMPLOI (detail : skills/copier-une-appli/references/orchestration.md)
 *  1. Copier ce fichier dans le dossier de travail (jamais dans le clone).
 *  2. Remplir CONFIG et UNITS ci-dessous, OU les passer au lancement :
 *       Workflow({ scriptPath: "<travail>\\workflow.js",
 *                  args: { config: { ...champs de CONFIG... }, units: [ ...unites... ] } })
 *     args.config est fusionne dans CONFIG (args.config.fondation dans CONFIG.fondation) ;
 *     args.units remplace UNITS s'il est non vide.
 *  3. Prerequis : reconnaissance faite (inventaire + unites), GUIDE du projet ecrit, serveur local lance,
 *     fondation validee (CONFIG.fondation.faite = true). Sinon, fondation.faite = false et
 *     fondation.unite = { key, section, nav, routes, notes } : le script fait la fondation puis s'arrete
 *     (fondation.arreterApres = true) pour que l'utilisateur la valide avant la suite.
 *     Logiciel (modes electron / natif) : l'agent principal l'a lance (profil temporaire, mises a jour
 *     automatiques bloquees) et a note son PID et le handle de sa fenetre dans le notes.md de la capture puis
 *     dans le GUIDE (section 1) ; les agents visent ce PID, jamais une autre instance.
 *     Site public en headless : l'agent principal a lance le navigateur (outils/headless.ps1 -Action lancer)
 *     et passe son port dans CONFIG.cdpPort ; il le ferme a la fin (headless.ps1 -Action fermer).
 *  4. Reprise apres interruption : relancer avec resumeFromRunId (meme script + memes args = les resultats
 *     deja obtenus sont rejoues depuis le cache).
 * Interdits dans un script Workflow : Date.now(), Math.random(), new Date() sans argument.
 * meta doit rester un litteral pur (ni variable, ni appel, ni gabarit) : textes sans accents.
 */
export const meta = {
  name: 'copieur-universel-copie',
  description: 'Recree une appli en local (copieur-universel) : capture sequentielle en lecture seule, construction parallele avec proprietaires de section, deux verifications par unite, controle final du site, puis demandes de modification de la coque',
  whenToUse: 'Apres la reconnaissance, le GUIDE du projet et le lancement du serveur local ; remplir CONFIG et UNITS (ou passer args.config / args.units)',
  phases: [
    { title: 'Fondation', detail: 'page de reference + coque partagee, deux passes de verification adverses (facultatif)' },
    { title: 'Capture', detail: 'une unite a la fois, lecture seule, anonymisee' },
    { title: 'Construction', detail: 'un constructeur par unite, proprietaires de section d abord' },
    { title: 'Verification 1', detail: 'comparaison avec la capture et corrections' },
    { title: 'Verification 2', detail: 'seconde passe independante, depuis zero' },
    { title: 'Controle final', detail: 'toutes les pages, liens, console, confidentialite, coherence' },
    { title: 'Coque', detail: 'demandes de modification de la coque et des sections' },
  ],
}

/* ------------------------------------------------------------------------------------------------
 * 1. PARAMETRES -- a remplir (ou a passer via args.config)
 * ---------------------------------------------------------------------------------------------- */
const CONFIG = {
  // Nom de l'appli tel que l'utilisateur la designe (ex. 'Notion', 'Bloc-notes Windows', 'mon logiciel de caisse')
  appli: 'A_REMPLIR',
  // 'web-connecte' (Claude in Chrome, compte de l'utilisateur) | 'web-public' (navigateur integre ou Chrome
  // headless + cdp_eval.py) | 'electron' (Electron / WebView2 via CDP) | 'natif' (Windows natif : UIA + captures)
  mode: 'web-connecte',
  // URL de base de l'original (https://...) ou, pour un logiciel : nom du processus / titre de fenetre / chemin de l'exe
  original: 'A_REMPLIR',
  // Dossier du clone (racine du serveur local) et son URL locale (serveur deja lance par l'agent principal)
  projet: 'A_REMPLIR',
  urlLocale: 'http://localhost:8770',
  // Dossier de travail HORS du clone (captures, GUIDE, inventaire) -- ex. le scratchpad de la session
  travail: 'A_REMPLIR',
  // Dossier skills/ du plugin = <Base directory du skill copier-une-appli>\.. (chemin absolu)
  skills: 'A_REMPLIR',
  // Facultatifs (deduits si vides) : outils = <skills>\..\outils ; captures = <travail>\capture ; guide = <travail>\GUIDE.md
  outils: '',
  captures: '',
  guide: '',
  // Viewport (web) ou taille de fenetre (bureau) de reference des captures
  viewport: '1536x791',
  // Ce qu'on garde tel quel (titulaire du compte, son email, son organisation...) ; tout le reste est fictif
  garder: [],
  // Domaines des emails fictifs autorises par scan_pii.py
  domainesFictifs: ['exemple.com', 'exemple.fr', 'exemple.org'],
  // Port de debogage (electron, ou web-public en Chrome headless) -- l'agent principal a lance le programme
  // (habitudes du plugin : 9229 pour une appli Electron, 9333 pour Chrome/Edge headless)
  cdpPort: 9229,
  // Page de reference deja validee (route), lue par tous les agents comme modele de qualite
  pageReference: '',
  fondation: {
    faite: true,          // true : fondation deja validee (cas normal)
    arreterApres: true,   // si le script fait la fondation : s'arreter ensuite pour validation par l'utilisateur
    unite: null,          // { key, section, nav, routes: [...], notes } de la page de reference
  },
  // true : chaque passe de verification d'unite = relecteurs par angle + verificateurs adverses + correcteur
  // (plus fiable, environ 4 fois plus d'agents). false : un verificateur qui corrige lui-meme (comme iClosed).
  verifAdverseUnites: false,
  // Appliquer a la fin les demandes de modification de la coque / des sections (un seul agent)
  appliquerDemandesCoque: true,
}

/* ------------------------------------------------------------------------------------------------
 * 2. UNITES -- a remplir (ou a passer via args.units). Supprimer les exemples (exemple: true).
 *
 * Une unite = 2 a 6 ecrans d'une meme section, captures par UN agent puis construits par UN agent.
 *   key       identifiant unique : lettres ASCII, chiffres, . _ - (sert de nom de dossier de capture)
 *   section   nom de la section (les unites d'une meme section partagent assets/sections/<section>.js|css)
 *   owner     true pour UNE unite par section : elle cree les fichiers communs de la section ; les autres
 *             unites de la section attendent la fin de sa construction (verrou, quel que soit l'ordre)
 *   shared    (owner) description precise de ce qui est commun aux pages de la section
 *   nav       cle de l'element actif de la navigation commune (voir le GUIDE du projet)
 *   routes    routes (web) ou ecrans/fenetres (bureau) de depart
 *   notes     consignes de capture : etats a couvrir, modales, pieges, ce qu'il ne faut surtout pas cliquer
 * Les unites sont capturees dans l'ordre du tableau : mettre en premier celles qui debloquent les autres.
 * ---------------------------------------------------------------------------------------------- */
const UNITS = [
  { exemple: true, key: 'tableau-de-bord', section: 'tableau-de-bord', owner: true, nav: 'dashboard',
    routes: ['/app/dashboard'],
    shared: '(aucun)',
    notes: 'Longue page : capturer toute la hauteur, les valeurs des graphiques (lire le SVG), les infobulles des indicateurs, les onglets de periode.' },
  { exemple: true, key: 'parametres-general', section: 'parametres', owner: true, nav: 'settings',
    routes: ['/app/settings', '/app/settings/profile'],
    shared: 'la barre laterale des parametres (toutes ses entrees et leurs routes, meme celles des autres unites) et la barre de titre, avec un parametre pour l entree active',
    notes: 'Noter la route de CHAQUE entree du menu des parametres dans routes-parametres.md (dossier de capture de l unite) : les autres unites de la section le liront.' },
  { exemple: true, key: 'parametres-equipe', section: 'parametres', owner: false, nav: 'settings',
    routes: ['/app/settings/users', '/app/settings/billing'],
    notes: 'Facturation : lecture seule absolue, masquer tout numero de carte.' },
]

/* ------------------------------------------------------------------------------------------------
 * 3. PREPARATION (ne pas modifier en principe)
 * ---------------------------------------------------------------------------------------------- */
// args doit etre un objet JSON reel ; une chaine JSON (erreur frequente) est relue, sinon refusee clairement
let A = {}
if (typeof args === 'string' && args.trim()) {
  try { A = JSON.parse(args) } catch (e) {
    throw new Error('Gabarit copieur-universel : args est une cha\u00eene illisible. Passer un objet JSON r\u00e9el : args: { config: {...}, units: [...] }')
  }
} else if (typeof args === 'object' && args) {
  A = args
}
const C = Object.assign({}, CONFIG, A.config || {})
C.fondation = Object.assign({}, CONFIG.fondation, (A.config && A.config.fondation) || {})
const UNITES = (Array.isArray(A.units) && A.units.length) ? A.units : UNITS

const SEP = /\\/.test(String(C.projet) + String(C.travail) + String(C.skills)) ? '\\' : '/'
function join() {
  const parts = Array.prototype.slice.call(arguments).filter(p => p !== undefined && p !== null && p !== '')
  return parts.map((p, i) => {
    let s = String(p)
    if (i > 0) s = s.replace(/^[\\/]+/, '')
    if (i < parts.length - 1) s = s.replace(/[\\/]+$/, '')
    return s
  }).join(SEP)
}
// Dossier parent (C:\x\plugin\skills -> C:\x\plugin), '' si introuvable
function parent(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return i > 0 ? s.slice(0, i) : ''
}
C.outils = C.outils || (parent(C.skills) ? join(parent(C.skills), 'outils') : join(C.skills, '..', 'outils'))
C.captures = C.captures || join(C.travail, 'capture')
C.guide = C.guide || join(C.travail, 'GUIDE.md')
const REGLES = join(C.skills, 'copier-une-appli', 'references', 'regles.md')
const LECONS = join(C.skills, 'copier-une-appli', 'references', 'lecons.md')
const MODES_VALIDES = ['web-connecte', 'web-public', 'electron', 'natif']
// Hote de l'original (appli web) : check_links.py --original signale toute reference vers lui dans le clone
const HOTE_ORIGINAL = ((String(C.original).match(/^https?:\/\/([^\/?#:]+)/i) || [])[1] || '')

// Verification des parametres AVANT de lancer le moindre agent
;(function verifierParametres() {
  const manque = []
  for (const k of ['appli', 'original', 'projet', 'travail', 'skills', 'urlLocale']) {
    if (!C[k] || /A_REMPLIR/.test(String(C[k]))) manque.push('CONFIG.' + k)
  }
  if (MODES_VALIDES.indexOf(C.mode) === -1) manque.push('CONFIG.mode (' + MODES_VALIDES.join(' | ') + ')')
  if (!Array.isArray(C.garder)) manque.push('CONFIG.garder (tableau)')
  if (!C.fondation.faite && !(C.fondation.unite && C.fondation.unite.key && C.fondation.unite.routes)) {
    manque.push('CONFIG.fondation.unite (obligatoire si fondation.faite = false)')
  }
  const besoinUnites = C.fondation.faite || !C.fondation.arreterApres
  if (besoinUnites) {
    if (!UNITES.length) manque.push('UNITS (vide)')
    if (UNITES.some(u => u.exemple)) manque.push('UNITS (contient encore les exemples : exemple: true)')
    const vues = {}
    const proprios = {}
    UNITES.forEach((u, i) => {
      if (!u.key || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(u.key))) manque.push('UNITS[' + i + '].key (obligatoire : lettres ASCII, chiffres, . _ - ; ni espace ni accent)')
      if (vues[u.key]) manque.push('UNITS : key en double ' + u.key)
      vues[u.key] = true
      if (!u.section) manque.push('UNITS[' + i + '].section')
      if (!Array.isArray(u.routes) || !u.routes.length) manque.push('UNITS[' + i + '].routes')
      if (u.owner) {
        if (proprios[u.section]) manque.push('UNITS : deux proprietaires pour la section ' + u.section)
        proprios[u.section] = u.key
      }
    })
  }
  if (manque.length) {
    throw new Error('Gabarit copieur-universel : parametres manquants ou invalides -> ' + manque.join(' ; '))
  }
})()

/* ------------------------------------------------------------------------------------------------
 * 4. SCHEMAS DE SORTIE DES AGENTS
 * ---------------------------------------------------------------------------------------------- */
const CAP_SCHEMA = {
  type: 'object',
  properties: {
    pages: { type: 'array', items: { type: 'object', properties: {
      route: { type: 'string' }, finalRoute: { type: 'string' }, title: { type: 'string' },
      status: { type: 'string', description: 'ok | redirect | 404 | not-accessible' },
      dir: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
    }, required: ['route', 'status', 'dir', 'files', 'summary'] } },
    viewport: { type: 'string' },
    notes: { type: 'string' },
    problems: { type: 'string' },
  },
  required: ['pages'],
}
const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    pages: { type: 'array', items: { type: 'object', properties: {
      route: { type: 'string' }, file: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string' },
    }, required: ['route', 'file', 'status'] } },
    sectionAssets: { type: 'array', items: { type: 'string' } },
    shellIssues: { type: 'array', items: { type: 'string' } },
    sectionIssues: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['pages', 'shellIssues'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    checked: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
    shellIssues: { type: 'array', items: { type: 'string' } },
    sectionIssues: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['checked', 'fixed', 'remaining', 'shellIssues'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      page: { type: 'string' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      title: { type: 'string' },
      original: { type: 'string', description: 'Ce que montre l original + preuve (fichier de capture ou mesure)' },
      clone: { type: 'string', description: 'Ce que montre le clone + mesure' },
      fix: { type: 'string', description: 'Correctif precis a appliquer au clone' },
    }, required: ['id', 'page', 'severity', 'title', 'original', 'clone', 'fix'] } },
    notes: { type: 'string' },
  },
  required: ['findings'],
}
const VERDICTS_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      real: { type: 'boolean' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reasoning: { type: 'string' },
      refined_fix: { type: 'string', description: 'Correctif exact si reel ; vide si refute' },
    }, required: ['id', 'real', 'confidence', 'reasoning', 'refined_fix'] } },
  },
  required: ['verdicts'],
}

/* ------------------------------------------------------------------------------------------------
 * 5. TEXTES COMMUNS DES PROMPTS
 * ---------------------------------------------------------------------------------------------- */
const garderTxt = () => (C.garder.length ? C.garder.join(', ') : '(rien : tout est fictif)')
const skill = (nom) => `Charge le skill \u00ab copieur-universel:${nom} \u00bb avec l'outil Skill et suis-le ; s'il n'est pas disponible, lis ${join(C.skills, nom, 'SKILL.md')} (outil Read) et suis-le.`

const contexte = () => `CONTEXTE \u2014 recr\u00e9ation locale et fid\u00e8le de \u00ab ${C.appli} \u00bb (mode ${C.mode}) avec le plugin copieur-universel, pour un usage personnel.
- Original : ${C.original}
- Clone : ${C.projet} \u2014 servi sur ${C.urlLocale} (serveur d\u00e9j\u00e0 lanc\u00e9 : ne pas le lancer ni l'arr\u00eater).
- Guide du projet (conventions, gabarit de page, API de la coque, donn\u00e9es fictives) : ${C.guide} \u2014 lis-le en premier.${C.pageReference ? `
- Page de r\u00e9f\u00e9rence valid\u00e9e (mod\u00e8le de qualit\u00e9, \u00e0 ouvrir et \u00e0 lire) : ${C.urlLocale}${C.pageReference}` : ''}
- Captures : ${join(C.captures, '<unit\u00e9>', '<page>')} (notes.md, dom-*.html ou uia-*.json, images).
- Outils du plugin : ${C.outils} (ex. py "${join(C.outils, 'check_links.py')}" \u2026).
- R\u00e8gles (lecture seule, donn\u00e9es fictives, aucun contournement) : ${REGLES} \u2014 pi\u00e8ges connus : ${LECONS}.
- Donn\u00e9es personnelles : fictives ; on garde tels quels : ${garderTxt()}.
- Viewport / taille de fen\u00eatre de r\u00e9f\u00e9rence : ${C.viewport}.
Les dossiers se cr\u00e9ent avec Bash (mkdir -p, chemins entre guillemets). Tout texte destin\u00e9 \u00e0 l'utilisateur est en fran\u00e7ais.`

const OUTILS_NAVIGATEUR_INTEGRE = 'mcp__Claude_Browser__tabs_create,mcp__Claude_Browser__navigate,mcp__Claude_Browser__computer,mcp__Claude_Browser__javascript_tool,mcp__Claude_Browser__resize_window,mcp__Claude_Browser__read_console_messages,mcp__Claude_Browser__get_page_text,mcp__Claude_Browser__tabs_close'

const navigateurIntegre = () => `Navigateur int\u00e9gr\u00e9 : charge ses outils en une fois via ToolSearch \u00ab select:${OUTILS_NAVIGATEUR_INTEGRE} \u00bb. Cr\u00e9e TON onglet (tabs_create), passe toujours ton tabId, resize_window au viewport ${C.viewport}, mesure avec javascript_tool (injecte le contenu de ${join(C.outils, 'verif.js')} : __attendre, __mesures, __textes, __debord, __liens, __reseau ; ou getBoundingClientRect, getComputedStyle, scrollHeight), compare avec computer screenshot et les images de capture (Read), lis la console (read_console_messages). Ferme ton onglet \u00e0 la fin. D'autres agents travaillent dans d'autres onglets : n'y touche jamais. Le navigateur r\u00e9el de l'utilisateur (Claude in Chrome) est r\u00e9serv\u00e9 aux agents de capture.
Navigateur int\u00e9gr\u00e9 absent ou plein (\u00ab Tab cap reached \u00bb) : Chrome/Edge headless \u00e0 toi sur profil temporaire \u2014 powershell -NoProfile -ExecutionPolicy Bypass -File "${join(C.outils, 'headless.ps1')}" -Action lancer -Viewport ${C.viewport} (note port et profil), puis py "${join(C.outils, 'cdp_eval.py')}" --port <port> nav --url <page> --console (erreurs console du chargement), eval --file "${join(C.outils, 'verif.js')}" --expr "__mesures('#main', 2)", shot --out <png>, hover --selector <CSS> (survol r\u00e9el) ; \u00e0 la fin headless.ps1 -Action fermer -Profil <profil> -Port <port>. Comparaison d'images au pixel : py "${join(C.outils, 'png_diff.py')}" diff <capture.png> <clone.png> (m\u00eame \u00e9chelle : --viewport LxH@DPR de la capture). M\u00e9thode : verifier-copie, references/methode.md.`

/* Commandes de controle (check_links.py signale par --original toute reference a l'original : navigation et
 * scripts a corriger, ressources publiques statiques tolerees ; scan_pii.py : code retour non nul = trouve) */
const cmdCheckLinks = () => `py "${join(C.outils, 'check_links.py')}" --root "${C.projet}" --base ${C.urlLocale}${HOTE_ORIGINAL ? ` --original ${HOTE_ORIGINAL}` : ''}`
const cmdScanPii = () => `py "${join(C.outils, 'scan_pii.py')}" --root "${C.projet}"${C.garder.filter(g => /@/.test(g)).map(g => ` --allow "${g}"`).join('')}${(C.domainesFictifs || []).map(d => ` --allow-domain ${d}`).join('')}`

/* Consignes propres a chaque mode : outils de capture + regles de securite */
const MODES = {
  'web-connecte': {
    skill: 'capture-web',
    capture: () => `Navigateur R\u00c9EL de l'utilisateur via l'extension Claude in Chrome ; il s'y est connect\u00e9 lui-m\u00eame. Charge les outils en UNE fois : ToolSearch \u00ab select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__list_connected_browsers,mcp__claude-in-chrome__select_browser,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__tabs_create_mcp \u00bb. Proc\u00e9dure exacte : capture-web, references/chrome-connecte.md.
- Plusieurs navigateurs connect\u00e9s : list_connected_browsers puis celui de CET ordinateur o\u00f9 l'utilisateur est connect\u00e9 (select_browser). tabs_context_mcp {createIfEmpty:true} ; travaille dans l'UNIQUE onglet du groupe (le m\u00eame pour toutes les unit\u00e9s : le dictionnaire d'anonymisation du kit y vit), au premier plan, une page \u00e0 la fois. N'ouvre que des URL de l'original (${C.original}). Page de connexion ou \u00ab session expir\u00e9e \u00bb : arr\u00eate-toi et signale-le dans problems (l'utilisateur se reconnecte lui-m\u00eame).
- RENDU : la fen\u00eatre ne se dessine qu'\u00e0 la demande. Apr\u00e8s chaque navigate : screenshot (scale 0.1), attendre 3\u20134 s, screenshot (scale 0.1), PUIS lire le DOM ; recommencer si l'\u00e9cran de chargement persiste. Naviguer avec navigate, jamais par history.pushState.
- FILTRE de l'extension : r\u00e9sultats > ~1000 caract\u00e8res tronqu\u00e9s, contenu ressemblant \u00e0 cookies/requ\u00eates/base64 bloqu\u00e9. En mode par d\u00e9faut, le kit \u00e9chappe \u00ab \u00a7 \u00bb\u2192\u00ab (SECT) \u00bb, puis \u00ab ; \u00bb\u2192\u00ab \u00a7 \u00bb, \u00ab & \u00bb\u2192\u00ab (AMP) \u00bb, \u00ab ? \u00bb\u2192\u00ab (Q) \u00bb, et d\u00e9coupe en morceaux \u2264 900 caract\u00e8res (window.__D) : r\u00e9cup\u00e8re-les par paquets (window.__D.slice(0,20), puis (20,40)\u2026), redemande en plus petit tout morceau \u00ab [BLOCKED\u2026] \u00bb, \u00e9cris les morceaux tels quels dans un fichier .esc.txt puis d\u00e9code-le avec la commande py de chrome-connecte.md \u00a77 (ordre d'inversion : \u00ab \u00a7 \u00bb\u2192\u00ab ; \u00bb AVANT \u00ab (SECT) \u00bb\u2192\u00ab \u00a7 \u00bb), et contr\u00f4le la longueur.
- KIT : ${join(C.outils, 'capture-kit.js')} \u2014 passe tout son contenu \u00e0 javascript_tool une fois par onglet, puis __config({ keep: [...], owner: '...' }) avec ce qu'on garde (${garderTxt()}) ; apr\u00e8s chaque navigation ou rechargement : r\u00e9injection courte (capture-web \u00a73), le fichier complet si elle r\u00e9pond \u00ab kit absent \u00bb. N'appelle __forget() qu'\u00e0 la toute fin de la capture compl\u00e8te. Pr\u00e9f\u00e8re browser_batch pour encha\u00eener plusieurs actions.`,
    securite: () => `Compte R\u00c9EL de l'utilisateur : LECTURE SEULE STRICTE.
- Autoris\u00e9 : naviguer dans l'appli ; cliquer onglets, entr\u00e9es de navigation, filtres d'affichage, accord\u00e9ons, pagination ; ouvrir un menu, une modale, un tiroir ou un formulaire de cr\u00e9ation SANS le remplir puis le fermer (\u00c9chap, Annuler, croix) ; ouvrir un d\u00e9tail en lecture ; survoler pour une infobulle.
- INTERDIT : tout ce qui enregistre, cr\u00e9e, modifie, supprime, duplique, envoie, publie, invite, connecte/d\u00e9connecte, active/d\u00e9sactive (interrupteurs, cases), importe/exporte, t\u00e9l\u00e9charge, paie, change d'abonnement ou d'organisation, r\u00e9v\u00e8le ou r\u00e9g\u00e9n\u00e8re une cl\u00e9 ; taper dans un champ ; glisser-d\u00e9poser ; tout ce qui ouvre une bo\u00eete de dialogue du navigateur. Une alerte \u00ab quitter la page ? \u00bb : fermer l'onglet via tabs_close_mcp puis tabs_context_mcp {createIfEmpty:true}.
- Ne jamais saisir d'identifiants, ne jamais se d\u00e9connecter, ne jamais quitter le domaine de l'original. En cas de doute : NE PAS cliquer, d\u00e9crire l'\u00e9l\u00e9ment dans notes.md.`,
  },
  'web-public': {
    skill: 'capture-web',
    capture: () => `Site PUBLIC, profil VIERGE (aucun compte). Deux moyens, compl\u00e9mentaires :
(a) Chrome/Edge headless lanc\u00e9 par l'agent principal sur le port ${C.cdpPort} (profil temporaire), \u00e0 privil\u00e9gier car il \u00e9crit images et dumps sur disque : py "${join(C.outils, 'cdp_eval.py')}" --port ${C.cdpPort} list | nav --url <URL> --wait 3 | eval --file "${join(C.outils, 'capture-kit.js')}" --expr "__config({raw:true}); <appel du kit>" --out <fichier> | shot --out <png> [--full] | hover --selector <CSS> --out <png> (survol r\u00e9el : :hover CSS et infobulles). Le mode raw est indispensable avec cdp_eval.py : sans lui, __dump renvoie seulement le nombre de morceaux. Un seul onglet (--target facultatif). Petit \u00e9cran : la fen\u00eatre headless ne descend pas sous ~500 px, donc nav --viewport 375x812 puis shot/eval --viewport 375x812. Ne lance ni ne ferme toi-m\u00eame ce navigateur. D\u00e9tail : capture-web, references/sites-publics.md.
(b) Navigateur int\u00e9gr\u00e9, dans TON onglet (outils mcp__Claude_Browser__* charg\u00e9s en une fois via ToolSearch, tabId partout, onglet ferm\u00e9 \u00e0 la fin) : pour explorer et voir survols et infobulles (computer hover) ; kit en mode par d\u00e9faut (morceaux, capture-web \u00a73). Ses captures d'\u00e9cran ne sont pas enregistr\u00e9es sur disque : les images du dossier viennent de (a).
Kit : ${join(C.outils, 'capture-kit.js')} (voir capture-web) ; cdp_eval.py le r\u00e9injecte \u00e0 chaque appel. Pas de crawl : seulement les pages de l'unit\u00e9, une \u00e0 la fois. Images d'un autre domaine absentes en headless (naturalWidth 0) : ne pas en conclure qu'elles sont cass\u00e9es dans l'original.`,
    securite: () => `Ne te connecte \u00e0 rien, ne cr\u00e9e aucun compte, ne soumets aucun formulaire, n'accepte aucune condition ; bandeau de cookies : refuser le non-essentiel. Aucun contournement (CAPTCHA, anti-bot, paywall, limites de d\u00e9bit) : une page bloqu\u00e9e est not\u00e9e \u00ab not-accessible \u00bb et on passe. Ne pas quitter le domaine de l'original.`,
  },
  'electron': {
    skill: 'capture-bureau',
    capture: () => `Logiciel Electron / WebView2 lanc\u00e9 par l'agent principal avec --remote-debugging-port=${C.cdpPort} et un dossier de donn\u00e9es TEMPORAIRE (ne le relance pas, ne le ferme pas ; son PID et le handle de sa fen\u00eatre sont not\u00e9s dans le guide). Outil : py "${join(C.outils, 'cdp_eval.py')}" --port ${C.cdpPort} list (choisir la fen\u00eatre principale : type page, par un morceau de titre ou d'URL), puis eval --target <cible> --file "${join(C.outils, 'capture-kit.js')}" --expr "__config({raw:true}); <appel du kit>" --out <fichier> pour les dumps (mode raw indispensable : sans lui, __dump renvoie seulement le nombre de morceaux), shot --target <cible> --out <png> pour les images, nav si l'appli a des routes internes. Rel\u00e8ve __styles, __icons et __rects de l'\u00e9tat INITIAL avant toute interaction (les styles calcul\u00e9s gardent l'\u00e9tat d'un panneau ouvert puis referm\u00e9). __guessNames : lis le r\u00e9sultat dans la console, ne l'\u00e9cris jamais sur disque (ce sont de vrais noms). Le cadre natif (barre de titre, menus Windows, boutons de fen\u00eatre d'une appli sans cadre) n'est pas dans le DOM : uia_dump.ps1 / window_shot.ps1 avec -ProcessId <PID du guide>. Voir capture-bureau, references/electron.md.`,
    securite: () => `LECTURE SEULE : ne rien enregistrer, cr\u00e9er, modifier, supprimer ni synchroniser ; ne changer aucun r\u00e9glage ; ne se connecter \u00e0 aucun compte ; n'ouvrir aucun fichier personnel de l'utilisateur ; fermer menus et bo\u00eetes de dialogue par \u00c9chap/Annuler, jamais \u00ab Enregistrer \u00bb. Ne fermer aucun processus.`,
  },
  'natif': {
    skill: 'capture-bureau',
    capture: () => `Logiciel Windows NATIF d\u00e9j\u00e0 ouvert par l'agent principal (${C.original}) sur un profil ou un document fictif ; son PID et le handle de sa fen\u00eatre sont not\u00e9s dans le guide. Vise toujours ce PID (-ProcessId) : -ProcessName pourrait tomber sur une instance ouverte par l'utilisateur, avec ses documents.
- Arbre UI Automation : powershell -NoProfile -ExecutionPolicy Bypass -File "${join(C.outils, 'uia_dump.ps1')}" -ProcessId <PID> -Out <uia-etat.json> (SANS -IncludeValues : les champs peuvent contenir des donn\u00e9es personnelles) ; -ListWindows pour voir ses fen\u00eatres.
- Image de la fen\u00eatre : powershell -NoProfile -ExecutionPolicy Bypass -File "${join(C.outils, 'window_shot.ps1')}" -ProcessId <PID> -Out <png> (bo\u00eete de dialogue : -ProcessId <PID> -WindowTitle "<titre>" ; menu ouvert : -IncludePopups, puis noter \u00ab decalage \u00bb de la r\u00e9ponse : position de la fen\u00eatre dans l'image quand le menu d\u00e9borde). Regarde chaque image : zone WinUI vide \u2192 -Method PrintWindow.
- Menus, onglets, bo\u00eetes de dialogue : d'abord la navigation prudente de uia_dump.ps1 (-Expand "Fichier", -SelectTab "<onglet>", -Invoke "<commande\u2026>" pour ouvrir une bo\u00eete de dialogue, -CloseWindow "<titre>" pour la refermer, -KeepOpen / -CloseMenus) ; \u00e0 d\u00e9faut computer-use s'il est disponible (charger le skill computer-use), refermer par \u00c9chap ; sinon d\u00e9crire l'\u00e9l\u00e9ment. Jamais le sous-menu des fichiers r\u00e9cents (\u00ab R\u00e9cent \u00bb, \u00ab Ouvrir r\u00e9cent \u00bb) : il montre les fichiers de l'utilisateur (l'outil le refuse) ; d\u00e9cris seulement sa fl\u00e8che.
- Le Name UIA est le nom ACCESSIBLE (\u00ab Ligne 1, colonne 1 \u00bb) et pas toujours le texte affich\u00e9 (\u00ab Ln 1, Col 1 \u00bb) ; la largeur d'un menu WinUI et la position du texte d'un TextBlock se mesurent sur l'image. Note les deux dans notes.md. Voir capture-bureau, references/natif.md.`,
    securite: () => `LECTURE SEULE : jamais \u00ab Enregistrer \u00bb, aucune modification de pr\u00e9f\u00e9rences, aucune saisie dans un document existant de l'utilisateur, n'ouvrir aucun de ses fichiers (un document vierge ou fictif du dossier de travail suffit pour montrer un \u00e9tat \u00ab document ouvert \u00bb) ; fermer menus et bo\u00eetes de dialogue par \u00c9chap/Annuler ; ne fermer aucun processus (seul l'agent principal ferme ceux qu'il a lanc\u00e9s). Aucune modification syst\u00e8me.`,
  },
}
const M = MODES[C.mode]
const estWeb = C.mode === 'web-connecte' || C.mode === 'web-public'

/* ------------------------------------------------------------------------------------------------
 * 6. PROMPTS
 * ---------------------------------------------------------------------------------------------- */
const capturePrompt = (u, estFondation) => `${contexte()}

R\u00d4LE : agent de CAPTURE de l'unit\u00e9 \u00ab ${u.key} \u00bb (section ${u.section || '-'})${estFondation ? ` \u2014 c'est la PAGE DE R\u00c9F\u00c9RENCE de la fondation : la coque partag\u00e9e en sera extraite, donc capture aussi \u00e0 fond ce qui est commun (navigation compl\u00e8te et ses \u00e9tats, menu utilisateur, version repli\u00e9e, en-t\u00eates, infobulles, petits \u00e9crans)` : ''}.
${skill(M.skill)}
OBJECTIF : capturer fid\u00e8lement toutes les pages / \u00e9crans et tous les \u00e9tats de l'unit\u00e9, en LECTURE SEULE et anonymis\u00e9s, pour qu'un autre agent puisse les recr\u00e9er \u00e0 l'identique sans revoir l'original.
Pages / \u00e9crans de d\u00e9part : ${(u.routes || []).join(', ')}
Consignes propres \u00e0 l'unit\u00e9 : ${u.notes || '(aucune)'}
Sortie : ${join(C.captures, u.key)} \u2014 ${estWeb ? 'un sous-dossier par page (slug de la route, ex. app-settings-profile)' : 'un sous-dossier par \u00e9cran (nom stable, ex. fenetre-principale, dialogue-options)'} contenant : images (01-haut.png, 02-bas.png, 20-modale-x.png\u2026 ; garder l'extension d'origine), ${estWeb || C.mode === 'electron' ? 'dom-<etat>.html (DOM nettoy\u00e9 par le kit)' : 'uia-<etat>.json (arbre UI Automation)'}, notes.md ; \u00e0 la racine de l'unit\u00e9 : notes.md de synth\u00e8se${estWeb || C.mode === 'electron' ? ', styles.css (__styles) et icones.txt (__icons)' : ''}. Formats exacts : skill ${M.skill}.

OUTILS ET MODE (${C.mode}) :
${M.capture()}

S\u00c9CURIT\u00c9 :
${M.securite()}

ANONYMISATION (AVANT toute image et tout dump) : noms de tiers, emails, t\u00e9l\u00e9phones, adresses, messages, montants individuels \u2192 fictifs ${C.mode === 'natif' ? "(uia_dump.ps1 masque emails, t\u00e9l\u00e9phones, IBAN, cartes et cl\u00e9s mais pas les noms, et window_shot.ps1 ne masque rien : d'o\u00f9 le profil temporaire et le document fictif ; une image qui montre une donn\u00e9e r\u00e9elle n'est pas vers\u00e9e, l'\u00e9cran est d\u00e9crit)" : '(kit : __guessNames() \u00e0 relire, __addNames([...]) puis __anonLive() sur la page visible, __cover() pour une zone \u00e9ditable ; le dump anonymise un clone du DOM)'}. Garder : ${garderTxt()}. Cl\u00e9s, jetons, num\u00e9ros de carte : jamais \u00e9crits, masqu\u00e9s localement avant capture. Les notes ne contiennent aucune donn\u00e9e r\u00e9elle non plus. Contr\u00f4le chaque image (Read) ; refais-la si une donn\u00e9e r\u00e9elle reste visible.

PROC\u00c9DURE PAR PAGE / \u00c9TAT :
1. Ouvrir la page ou l'\u00e9cran, attendre le rendu complet ; noter la route finale, le titre exact (document.title ou titre de fen\u00eatre), le viewport / la taille de fen\u00eatre.
2. Anonymiser.
3. Images : vue initiale + vues apr\u00e8s d\u00e9filement pour couvrir toute la hauteur, noms parlants.
4. Structure : ${estWeb || C.mode === 'electron' ? 'dump du conteneur principal (et de chaque modale/tiroir ouvert, souvent hors du conteneur : [role=dialog] ou conteneur fixed), tous les morceaux r\u00e9cup\u00e9r\u00e9s' : 'arbre UIA de la fen\u00eatre et de chaque bo\u00eete de dialogue ouverte'} pour chaque \u00e9tat.
5. \u00c9tats : chaque onglet / sous-onglet, menus d\u00e9roulants importants, modales \u00ab Nouveau\u2026 \u00bb ouvertes puis ferm\u00e9es SANS valider, \u00e9tats vides, infobulles cl\u00e9s, survols.${estWeb || C.mode === 'electron' ? ' Pour un \u00e9tat de la coque (barre repli\u00e9e, menu utilisateur, petit \u00e9cran) : __etat() avant l\'action puis __diffEtat() apr\u00e8s \u2014 une action change souvent un \u00e9l\u00e9ment \u00e9loign\u00e9 (marge du contenu principal) qu\'un dump du seul \u00e9l\u00e9ment cliqu\u00e9 ne montre pas. Animation automatique (carrousel, bandeau qui d\u00e9file) : la noter avec son intervalle et capturer chaque diapositive.' : ''}
6. notes.md : route demand\u00e9e \u2192 route finale (redirection ? \u00ab page introuvable \u00bb ?), titre exact, viewport, r\u00f4le de chaque bloc, textes cl\u00e9s, interactions observ\u00e9es et leur effet, liens (href), forme des donn\u00e9es (colonnes\u2026), valeurs des graphiques, mesures utiles (scrollHeight du conteneur principal, positions cl\u00e9s), ce qui n'a pas pu \u00eatre captur\u00e9 et pourquoi.
Explore aussi les sous-pages et onglets internes de l'unit\u00e9 non list\u00e9s (ajoute-les). Une route qui redirige ou est introuvable : la noter sans insister.
Sois exhaustif mais efficace : la recr\u00e9ation d\u00e9pend enti\u00e8rement de ta capture. Retourne la liste des pages captur\u00e9es.`

const proprioTxt = (u) => u.owner
  ? `- Tu es PROPRI\u00c9TAIRE de la section \u00ab ${u.section} \u00bb : ce qui est commun \u00e0 plusieurs pages de la section (${u.shared || '\u00e0 d\u00e9terminer d\'apr\u00e8s la capture'}) va dans ${join(C.projet, 'assets', 'sections', u.section + '.js')} (et .css si utile), avec une API simple document\u00e9e en t\u00eate de fichier (ex. window.Section.renderHeader({ active: '\u2026' })). D'autres unit\u00e9s de la section l'utiliseront SANS le modifier : rends-le complet et stable (pr\u00e9vois toutes les entr\u00e9es / onglets de la section, m\u00eame ceux construits par d'autres).`
  : `- La section \u00ab ${u.section} \u00bb a un fichier commun ${join(C.projet, 'assets', 'sections', u.section + '.js')} cr\u00e9\u00e9 par son unit\u00e9 propri\u00e9taire (d\u00e9j\u00e0 construite) : lis-le et utilise-le, ne le modifie pas (besoins \u2192 sectionIssues). S'il n'existe pas (construction du propri\u00e9taire \u00e9chou\u00e9e), construis sans et signale-le dans sectionIssues. Lis aussi les pages d\u00e9j\u00e0 construites de la section pour rester coh\u00e9rent.`

const buildPrompt = (u, cap) => `${contexte()}

R\u00d4LE : CONSTRUCTEUR de l'unit\u00e9 \u00ab ${u.key} \u00bb (section ${u.section}).
${skill('reconstruire-appli')}
Lis le guide, puis TOUTE la capture : ${join(C.captures, u.key)} (notes.md, dom-*.html ou uia-*.json, images \u2014 Read).
R\u00e9sum\u00e9 de la capture : ${JSON.stringify(cap)}
MISSION : recr\u00e9er chaque page / \u00e9cran captur\u00e9 (statut ok) \u00e0 l'emplacement d\u00e9fini par le guide (par d\u00e9faut ${estWeb ? `${join(C.projet, 'app', '<chemin>', 'index.html')}, sans doubler un pr\u00e9fixe /app d\u00e9j\u00e0 pr\u00e9sent` : join(C.projet, 'ecrans', '<ecran>', 'index.html')} : reconstruire-appli, references/conventions.md \u00a72\u20133), fid\u00e8le \u00e0 la structure captur\u00e9e et aux images, donn\u00e9es personnelles fictives, interactions reproduites (onglets, menus, modales, filtres, tri, recherche, pagination, survols, \u00e9tats vides). Cl\u00e9 de navigation par d\u00e9faut : \u00ab ${u.nav || ''} \u00bb.
- Route qui redirige dans l'original : page de redirection (meta refresh + location.replace) vers la cible locale. Page introuvable : ne rien cr\u00e9er, le noter.
${proprioTxt(u)}
- Aucune requ\u00eate vers l'original ni vers un autre serveur (pas d'API r\u00e9elle) ; pas d'alert()/confirm() ; aucun formulaire de connexion ou de paiement fonctionnel ; donn\u00e9es fictives d\u00e9terministes (g\u00e9n\u00e9rateur \u00e0 graine fixe, jamais Math.random() non-graine).
Puis v\u00e9rifie chaque page : ${navigateurIntegre()} Compare au captur\u00e9 et corrige jusqu'\u00e0 \u00eatre fid\u00e8le ; z\u00e9ro erreur console${estWeb ? ' ; pas de d\u00e9filement horizontal \u00e0 375 px' : ' ; rendu correct \u00e0 la taille de fen\u00eatre de r\u00e9f\u00e9rence'}.
Ne modifie que les fichiers de ton unit\u00e9${u.owner ? ' et ceux de ta section' : ''} : ni la coque (assets/shell-base.*, assets/shell.*, assets/tailwind-config.js), ni assets/fake-data.js, ni la page de r\u00e9f\u00e9rence \u2014 besoins \u2192 shellIssues / sectionIssues (pr\u00e9cis : fichier, probl\u00e8me, changement propos\u00e9).
Retourne pages construites, sectionAssets, shellIssues, sectionIssues.`

const verifyPrompt = (u, cap, built, pass) => `${contexte()}

R\u00d4LE : V\u00c9RIFICATEUR n\u00b0${pass} de l'unit\u00e9 \u00ab ${u.key} \u00bb (section ${u.section})${pass === 2 ? ' \u2014 DEUXI\u00c8ME passe compl\u00e8te et ind\u00e9pendante : refais tout le contr\u00f4le depuis z\u00e9ro, sans te fier au travail pr\u00e9c\u00e9dent' : ''}.
${skill('verifier-copie')}
Lis le guide, la capture ${join(C.captures, u.key)} (notes.md, dom-*.html ou uia-*.json, images), puis les pages construites : ${JSON.stringify((built && built.pages) || [])}.
Pour chaque page et chaque \u00e9tat captur\u00e9, compare le clone \u00e0 l'original \u2014 ${navigateurIntegre()}
- mise en page, tailles, espacements (getBoundingClientRect vs pixels des images ; scrollHeight du conteneur principal), couleurs, typographie, ic\u00f4nes ;
- TOUS les textes, mot \u00e0 mot, contre la capture (accents, majuscules, ponctuation, espaces ins\u00e9cables) ;
- interactions (onglets, menus, modales, filtres, tri, recherche, pagination, survols) ;
- liens internes vers des pages locales existantes ; z\u00e9ro erreur console${estWeb ? ' ; 375 px sans d\u00e9filement horizontal' : ''} ;
- AUCUNE donn\u00e9e personnelle r\u00e9elle (seul est gard\u00e9 : ${garderTxt()}) ; aucun secret ; aucune requ\u00eate vers l'original.
Sois sceptique et pr\u00e9cis ; ignore les \u00e9carts < 2 px et les artefacts JPEG. Pour chaque \u00e9cart r\u00e9el : CORRIGE directement la page (tu ne modifies que les pages de cette unit\u00e9), puis re-v\u00e9rifie. Ne modifie ni la coque (assets/shell-base.*, assets/shell.*, assets/tailwind-config.js), ni assets/fake-data.js, ni les fichiers de section : d\u00e9cris les besoins dans shellIssues / sectionIssues.
Retourne : pages v\u00e9rifi\u00e9es, \u00e9carts corrig\u00e9s, \u00e9carts restants, shellIssues, sectionIssues.`

/* Verification adverse : relecteurs par angle -> verificateur adverse par relecteur -> correcteur */
const ANGLES = [
  { key: 'mise-en-page', titre: 'MISE EN PAGE ET RENDU',
    consigne: 'positions, tailles, espacements, alignements, couleurs, typographie, ic\u00f4nes, ombres, bordures, barres de d\u00e9filement, \u00e9tats de survol ; mesurer avec getBoundingClientRect / getComputedStyle et comparer aux pixels des images de capture ; scrollHeight du conteneur principal.' },
  { key: 'textes', titre: 'TEXTES ET CONTENU',
    consigne: 'chaque texte visible ou cach\u00e9 (onglets, infobulles, menus, modales, placeholders, alt, aria-label, titre de l\'onglet ou de la fen\u00eatre) compar\u00e9 caract\u00e8re par caract\u00e8re au DOM / \u00e0 l\'arbre captur\u00e9 : accents, majuscules, ponctuation, espaces ins\u00e9cables (U+00A0, U+202F), ordre des \u00e9l\u00e9ments, format des nombres et des dates.' },
  { key: 'comportement', titre: 'COMPORTEMENT ET ROBUSTESSE',
    consigne: 'chaque interaction captur\u00e9e (onglets, menus, modales, tiroirs, filtres, tri, recherche, pagination, accord\u00e9ons, infobulles, repli de la navigation, clavier \u00c9chap) ; erreurs et avertissements console au chargement et apr\u00e8s interaction ; liens internes ; petits \u00e9crans (375, 768 px) pour une appli web ; \u00e9tat m\u00e9moris\u00e9 seulement pour les choix explicites.' },
  { key: 'confidentialite', titre: 'CONFIDENTIALIT\u00c9 ET R\u00c8GLES',
    consigne: `aucune donn\u00e9e personnelle r\u00e9elle hors ${garderTxt()} (noms, emails, t\u00e9l\u00e9phones, adresses, messages) ; aucun secret (cl\u00e9s, jetons, cartes) ; aucune requ\u00eate r\u00e9seau vers l'original ou une API (onglet r\u00e9seau / code) ; aucun formulaire de connexion ou de paiement fonctionnel ; donn\u00e9es fictives d\u00e9terministes. Outil : ${cmdScanPii()}.` },
]

const reviewPrompt = (cible, angle, pass, precedent) => `${contexte()}

R\u00d4LE : RELECTEUR \u2014 angle \u00ab ${angle.titre} \u00bb \u2014 passe de v\u00e9rification n\u00b0${pass} de ${cible.description}.
${skill('verifier-copie')}
Tu ne modifies AUCUN fichier : tu rapportes des \u00e9carts.
Capture de l'original : ${cible.captureDir} (notes.md, dom-*.html ou uia-*.json, images \u2014 Read). Pages du clone : ${JSON.stringify(cible.pages)}.
${navigateurIntegre()}
TON ANGLE : ${angle.consigne}
${precedent ? `D\u00e9j\u00e0 trait\u00e9 en passe 1 \u2014 \u00e9carts confirm\u00e9s : ${JSON.stringify(precedent.confirmed || [])} ; corrections faites : ${JSON.stringify(precedent.fixed || [])} ; \u00e9carts refus\u00e9s : ${JSON.stringify(precedent.rejected || [])}. V\u00e9rifie que chaque correction est r\u00e9ellement effective et sans r\u00e9gression ; ne re-signale un point refus\u00e9 qu'avec une preuve NOUVELLE et plus forte.` : ''}
Sois exhaustif dans ton angle. Ne rapporte que des \u00e9carts concrets et observables entre le clone et l'ORIGINAL, chacun avec sa preuve (fichier de capture, mesure) et un correctif pr\u00e9cis (classe, CSS, JS, texte exact). Ignore les \u00e9carts < 2 px et les artefacts JPEG. S\u00e9v\u00e9rit\u00e9 : high = visible / cass\u00e9, medium = visible en comparant, low = finition.`

const skepticPrompt = (cible, angle, findings) => `${contexte()}

R\u00d4LE : V\u00c9RIFICATEUR ADVERSE pour ${cible.description}. Un relecteur (angle \u00ab ${angle.titre} \u00bb) a rapport\u00e9 les \u00e9carts ci-dessous. Pour CHACUN, essaie ind\u00e9pendamment de le R\u00c9FUTER : relis toi-m\u00eame les images et le DOM captur\u00e9s concern\u00e9s, re-mesure le clone toi-m\u00eame, lis la source du clone.
${navigateurIntegre()}
Un \u00e9cart n'est r\u00e9el que s'il est visible ou mesurable par rapport \u00e0 l'ORIGINAL (pas par rapport aux suppositions du relecteur), s'il n'enfreint pas une r\u00e8gle du plugin, et si le correctif rapproche vraiment le clone de l'original sans rien casser. real=false par d\u00e9faut si la preuve est ambigu\u00eb. Si r\u00e9el : donne un correctif exact et v\u00e9rifi\u00e9 (refined_fix). Ne modifie aucun fichier.
\u00c9CARTS \u00c0 V\u00c9RIFIER (JSON) :
${JSON.stringify(findings, null, 2)}`

const fixerPrompt = (cible, confirmed, pass) => `${contexte()}

R\u00d4LE : CORRECTEUR \u2014 passe n\u00b0${pass} de ${cible.description}.
${skill('reconstruire-appli')}
Applique les \u00e9carts CONFIRM\u00c9S ci-dessous (utilise refined_fix quand il est fourni), en ne modifiant que : ${cible.modifiables}. Les besoins hors de ce p\u00e9rim\u00e8tre vont dans shellIssues / sectionIssues.
Puis re-v\u00e9rifie chaque correction et l'absence de r\u00e9gression \u2014 ${navigateurIntegre()}
\u00c9CARTS CONFIRM\u00c9S (JSON) :
${JSON.stringify(confirmed, null, 2)}
Retourne : pages v\u00e9rifi\u00e9es (checked), corrections faites (fixed), \u00e9carts restants (remaining), shellIssues, sectionIssues.`

const fondationPrompt = (u, cap) => `${contexte()}

R\u00d4LE : CONSTRUCTEUR DE LA FONDATION (page de r\u00e9f\u00e9rence \u00ab ${u.key} \u00bb + coque partag\u00e9e).
${skill('reconstruire-appli')} Suis sa partie \u00ab fondation \u00bb.
Lis le guide (s'il est encore incomplet, c'est toi qui le compl\u00e8tes), puis TOUTE la capture : ${join(C.captures, u.key)}.
R\u00e9sum\u00e9 de la capture : ${JSON.stringify(cap)}
MISSION :
1. Recr\u00e9er la page de r\u00e9f\u00e9rence (${(u.routes || []).join(', ')}) \u00e0 l'identique, interactions comprises, donn\u00e9es fictives.
2. En extraire la COQUE PARTAG\u00c9E r\u00e9utilisable par toutes les pages : navigation, menus, ic\u00f4nes, infobulles, styles, utilitaires (${join(C.projet, 'assets', 'shell.js')}, shell.css, configuration Tailwind \u00e9ventuelle) et les DONN\u00c9ES FICTIVES communes d\u00e9terministes (${join(C.projet, 'assets', 'fake-data.js')}).
3. Compl\u00e9ter le GUIDE du projet (${C.guide}) : gabarit de page exact, API de la coque, cl\u00e9s de navigation, conventions de liens et d'images, donn\u00e9es fictives disponibles, ce qui est partag\u00e9 et qui peut le modifier, comment v\u00e9rifier.
4. V\u00e9rifier dans le navigateur int\u00e9gr\u00e9 contre la capture et corriger \u2014 ${navigateurIntegre()} Z\u00e9ro erreur console${estWeb ? ' ; pas de d\u00e9filement horizontal \u00e0 375 px' : ''}.
Retourne les pages construites (pages), les fichiers de la coque (sectionAssets), et tes remarques (notes).`

const siteCheckPrompt = (allPages) => `${contexte()}

R\u00d4LE : CONTR\u00d4LEUR FINAL du clone entier (${C.projet}, servi sur ${C.urlLocale}).
${skill('verifier-copie')} Suis sa partie \u00ab contr\u00f4le final \u00bb.
Pages construites : ${JSON.stringify(allPages)}${C.pageReference ? ` (+ ${C.pageReference}, page de r\u00e9f\u00e9rence d\u00e9j\u00e0 valid\u00e9e)` : ''}.
1. Liste toutes les pages du clone (Glob **/index.html).
2. Liens : ${cmdCheckLinks()}${HOTE_ORIGINAL ? " (avertissements \u00ab r\u00e9f\u00e9rences \u00e0 l'original \u00bb : un lien de navigation ou un script vers l'original est \u00e0 corriger ; une ressource publique statique \u2014 image, police \u2014 est tol\u00e9r\u00e9e)" : ''} ; puis, pour les liens g\u00e9n\u00e9r\u00e9s par JS, inspecte le DOM rendu. Corrige chaque lien cass\u00e9 vers la bonne page locale, ou liste-le.
3. Pour chaque page, dans le navigateur int\u00e9gr\u00e9 (${navigateurIntegre()}) : chargement sans erreur console, navigation commune correcte (\u00e9l\u00e9ment actif), en-t\u00eates de section coh\u00e9rents entre pages d'une m\u00eame section${estWeb ? ', pas de d\u00e9filement horizontal (viewport de r\u00e9f\u00e9rence et 375 px)' : ''}.
4. Confidentialit\u00e9 : ${cmdScanPii()} (code retour non nul = trouv\u00e9) ; plus une recherche (Grep) de cl\u00e9s / jetons / num\u00e9ros de carte et de toute requ\u00eate vers l'original. Corrige.
Tu peux corriger les pages ; pas la coque (assets/shell-base.*, assets/shell.*, assets/tailwind-config.js), ni assets/fake-data.js, ni assets/sections/* : signale-les dans shellIssues / sectionIssues.
Retourne : pages v\u00e9rifi\u00e9es, corrections, probl\u00e8mes restants, shellIssues, sectionIssues.`

const coquePrompt = (shellIssues, sectionIssues) => `${contexte()}

R\u00d4LE : PROPRI\u00c9TAIRE DE LA COQUE pour la derni\u00e8re \u00e9tape : appliquer les demandes de modification remont\u00e9es par tous les agents.
${skill('reconstruire-appli')}
Demandes pour la coque (assets/shell.*, assets/fake-data.js, configuration) : ${JSON.stringify(shellIssues)}
Demandes pour les fichiers de section (assets/sections/*) : ${JSON.stringify(sectionIssues)}
1. Trie : regroupe les doublons ; \u00e9carte ce qui contredit la capture de l'original ou les r\u00e8gles (explique pourquoi) ; garde ce qui est fond\u00e9 et v\u00e9rifiable.
2. Applique les changements retenus (tu peux modifier assets/shell.*, assets/tailwind-config.js, fake-data.js et les fichiers de section ; jamais assets/shell-base.*, copie g\u00e9n\u00e9rique du skill reconstruire-appli), en restant compatible avec toutes les pages existantes (lis celles qui utilisent ce que tu modifies).
3. Rev\u00e9rifie : la page de r\u00e9f\u00e9rence${C.pageReference ? ` (${C.pageReference})` : ''} et au moins une page par section dans le navigateur int\u00e9gr\u00e9 (${navigateurIntegre()}), puis ${cmdCheckLinks()} et ${cmdScanPii()}.
Retourne : checked (pages rev\u00e9rifi\u00e9es), fixed (demandes appliqu\u00e9es), remaining (demandes \u00e9cart\u00e9es ou non r\u00e9solues, avec la raison), shellIssues (vide si tout est trait\u00e9).`

/* ------------------------------------------------------------------------------------------------
 * 7. ORCHESTRATION
 * ---------------------------------------------------------------------------------------------- */

/* Passe de verification adverse (fondation, ou unites si verifAdverseUnites) */
async function verifAdverse(cible, pass, phaseName, labelBase, precedent) {
  const revues = await pipeline(
    ANGLES,
    (angle) => agent(reviewPrompt(cible, angle, pass, precedent),
      { label: `${labelBase}:revue-${angle.key}:p${pass}`, phase: phaseName, schema: FINDINGS_SCHEMA }),
    (review, angle) => {
      // relecteur saute ou mort : l'angle n'est PAS verifie (a dire, pas a taire)
      if (!review) return { angle: angle.key, relecteurEnEchec: true, findings: [], verdicts: [] }
      const findings = review.findings || []
      if (!findings.length) return { angle: angle.key, findings: [], verdicts: [] }
      return agent(skepticPrompt(cible, angle, findings),
        { label: `${labelBase}:adverse-${angle.key}:p${pass}`, phase: phaseName, schema: VERDICTS_SCHEMA })
        .catch(() => null)
        .then(v => ({ angle: angle.key, findings, verdicts: (v && v.verdicts) || [], adverseEnEchec: !v }))
    },
  )
  const confirmed = []
  const rejected = []
  const nonVerifies = []
  revues.forEach((r, i) => {
    const angle = ANGLES[i].key
    if (!r || r.relecteurEnEchec) { nonVerifies.push(`angle ${angle} non v\u00e9rifi\u00e9 (relecteur en \u00e9chec)`); return }
    if (r.adverseEnEchec) {
      for (const f of r.findings) nonVerifies.push(`${angle}/${f.id} ${f.title} (${f.page}) \u2014 non tranch\u00e9 (v\u00e9rificateur adverse en \u00e9chec)`)
      return
    }
    const byId = {}
    for (const v of r.verdicts) byId[v.id] = v
    for (const f of r.findings) {
      const v = byId[f.id]
      if (v && v.real) confirmed.push(Object.assign({}, f, { angle, refined_fix: v.refined_fix }))
      else rejected.push(`${angle}/${f.id} ${f.title} \u2014 ${v ? v.reasoning : 'pas de verdict'}`)
    }
  })
  log(`${labelBase} passe ${pass} : ${confirmed.length} \u00e9cart(s) confirm\u00e9(s), ${rejected.length} refus\u00e9(s)` +
    (nonVerifies.length ? `, ${nonVerifies.length} point(s) non v\u00e9rifi\u00e9(s)` : ''))
  if (!confirmed.length) {
    return { checked: nonVerifies.length ? [] : cible.pages.map(p => p.route || String(p)), fixed: [], remaining: nonVerifies, shellIssues: [], sectionIssues: [], confirmed: [], rejected,
      notes: nonVerifies.length ? 'v\u00e9rification incompl\u00e8te' : 'aucun \u00e9cart confirm\u00e9' }
  }
  const fix = await agent(fixerPrompt(cible, confirmed, pass),
    { label: `${labelBase}:correcteur:p${pass}`, phase: phaseName, schema: VERIFY_SCHEMA }).catch(() => null)
  const confirmes = confirmed.map(f => `${f.angle}/${f.id} ${f.title} (${f.page})`)
  if (!fix) return { checked: [], fixed: [], remaining: confirmes.concat(nonVerifies), shellIssues: [], sectionIssues: [], confirmed: confirmes, rejected, notes: 'correcteur en \u00e9chec' }
  return Object.assign({}, fix, { remaining: (fix.remaining || []).concat(nonVerifies), confirmed: confirmes, rejected })
}

/* Verification d'une unite : simple (un agent qui corrige, la passe 2 repart de zero sans voir la passe 1)
 * ou adverse (la passe 2 recoit ce que la passe 1 a corrige ou refuse, pour eviter les allers-retours) */
function verifUnite(u, cap, built, pass, precedent) {
  const phaseName = 'Verification ' + pass
  if (C.verifAdverseUnites) {
    const cible = {
      description: `l'unit\u00e9 \u00ab ${u.key} \u00bb (section ${u.section})`,
      pages: (built && built.pages) || [],
      captureDir: join(C.captures, u.key),
      modifiables: `les pages de l'unit\u00e9 \u00ab ${u.key} \u00bb uniquement`,
    }
    return verifAdverse(cible, pass, phaseName, 'verif:' + u.key, precedent || null).catch(() => null)
  }
  return agent(verifyPrompt(u, cap, built, pass),
    { label: `verif${pass}:${u.key}`, phase: phaseName, schema: VERIFY_SCHEMA }).catch(() => null)
}

/* Fondation : capture de la page de reference -> construction page + coque -> 2 passes adverses */
async function fondation() {
  const u = C.fondation.unite
  log(`Fondation : capture de la page de r\u00e9f\u00e9rence (${u.key})\u2026`)
  const cap = await agent(capturePrompt(u, true), { label: 'capture:fondation', phase: 'Fondation', schema: CAP_SCHEMA }).catch(() => null)
  if (!cap || !(cap.pages || []).some(p => p.status === 'ok')) {
    return { ok: false, etape: 'capture', capture: cap }
  }
  const b = await agent(fondationPrompt(u, cap), { label: 'build:fondation', phase: 'Fondation', schema: BUILD_SCHEMA }).catch(() => null)
  if (!b) return { ok: false, etape: 'construction', capture: cap }
  const cible = {
    description: `la FONDATION (page de r\u00e9f\u00e9rence \u00ab ${u.key} \u00bb et coque partag\u00e9e)`,
    pages: b.pages || [],
    captureDir: join(C.captures, u.key),
    modifiables: `la page de r\u00e9f\u00e9rence, la coque (assets/shell.*, configuration Tailwind \u00e9ventuelle), assets/fake-data.js et le guide ${C.guide}`,
  }
  const v1 = await verifAdverse(cible, 1, 'Fondation', 'fondation', null)
  const v2 = await verifAdverse(cible, 2, 'Fondation', 'fondation', v1)
  return { ok: true, capture: cap, build: b, v1, v2 }
}

let resultatFondation = null
if (!C.fondation.faite) {
  resultatFondation = await fondation()
  if (!resultatFondation.ok) {
    log('Fondation en \u00e9chec : arr\u00eat (rien d\'autre n\'est lanc\u00e9).')
    return { etape: 'fondation', fondation: resultatFondation }
  }
  if (C.fondation.arreterApres) {
    log('Fondation termin\u00e9e : la faire valider par l\'utilisateur, puis relancer avec fondation.faite = true.')
    return { etape: 'fondation', fondation: resultatFondation,
      suite: 'Montrer la page de r\u00e9f\u00e9rence \u00e0 l\'utilisateur ; une fois valid\u00e9e, relancer ce script avec config.fondation.faite = true et config.pageReference renseign\u00e9.' }
  }
  if (!C.pageReference) C.pageReference = (C.fondation.unite.routes || [])[0] || ''
}

/* Verrous de section : les unites non proprietaires attendent la construction de leur proprietaire,
 * quel que soit l'ordre du tableau. Une section sans proprietaire n'attend rien. */
const verrous = {}
function verrou(section) {
  if (!verrous[section]) {
    let ouvrir = null
    const p = new Promise(res => { ouvrir = res })
    verrous[section] = { p, ouvrir }
  }
  return verrous[section]
}
for (const u of UNITES) {
  if (!UNITES.some(x => x.section === u.section && x.owner)) verrou(u.section).ouvrir(null)
}

const chaines = []
const sansPage = []
for (const u of UNITES) {
  log(`Capture de ${u.key}\u2026`)
  const cap = await agent(capturePrompt(u, false), { label: `capture:${u.key}`, phase: 'Capture', schema: CAP_SCHEMA }).catch(() => null)
  const exploitable = cap && Array.isArray(cap.pages) && cap.pages.some(p => p.status === 'ok' || p.status === 'redirect')
  if (!exploitable) {
    sansPage.push(u.key)
    log(`Aucune page exploitable pour ${u.key} : unit\u00e9 ignor\u00e9e (voir le r\u00e9sultat).`)
    if (u.owner) verrou(u.section).ouvrir(null)
    chaines.push(Promise.resolve({ unit: u.key, capture: cap, build: null, v1: null, v2: null }))
    continue
  }
  const attente = u.owner ? Promise.resolve(null) : verrou(u.section).p
  const buildP = attente
    .then(() => agent(buildPrompt(u, cap), { label: `build:${u.key}`, phase: 'Construction', schema: BUILD_SCHEMA }))
    .catch(() => null)
  if (u.owner) buildP.then(b => verrou(u.section).ouvrir(b))
  chaines.push(
    buildP.then(b => {
      if (!b) return { unit: u.key, capture: cap, build: null, v1: null, v2: null }
      return verifUnite(u, cap, b, 1)
        .then(v1 => verifUnite(u, cap, b, 2, v1).then(v2 => ({ unit: u.key, capture: cap, build: b, v1, v2 })))
    }).catch(() => ({ unit: u.key, capture: cap, build: null, v1: null, v2: null }))
  )
}

const resultats = await Promise.all(chaines)
const nbCompletes = resultats.filter(r => r.build && r.v1 && r.v2).length
log(`${nbCompletes} unit\u00e9(s) sur ${resultats.length} construite(s) et v\u00e9rifi\u00e9e(s) deux fois ; contr\u00f4le final du site\u2026`)

const toutesPages = resultats.flatMap(r => (r.build && r.build.pages) || []).map(p => p.route)
const site = await agent(siteCheckPrompt(toutesPages), { label: 'controle-final', phase: 'Controle final', schema: VERIFY_SCHEMA }).catch(() => null)

const collecter = (cle) => (resultatFondation && resultatFondation.ok
  ? [resultatFondation.build, resultatFondation.v1, resultatFondation.v2].filter(Boolean).flatMap(x => x[cle] || []).map(s => `[fondation] ${s}`)
  : []).concat(resultats.flatMap(r =>
  [r.build, r.v1, r.v2].filter(Boolean).flatMap(x => x[cle] || []).map(s => `[${r.unit}] ${s}`)))
const shellIssues = collecter('shellIssues').concat(site ? (site.shellIssues || []).map(s => '[site] ' + s) : [])
const sectionIssues = collecter('sectionIssues').concat(site ? (site.sectionIssues || []).map(s => '[site] ' + s) : [])

let coque = null
if (C.appliquerDemandesCoque && (shellIssues.length || sectionIssues.length)) {
  log(`Application de ${shellIssues.length} demande(s) pour la coque et ${sectionIssues.length} pour les sections\u2026`)
  coque = await agent(coquePrompt(shellIssues, sectionIssues), { label: 'coque', phase: 'Coque', schema: VERIFY_SCHEMA }).catch(() => null)
}

return {
  fondation: resultatFondation,
  unites: resultats.map(r => ({
    unit: r.unit,
    captured: r.capture ? (r.capture.pages || []).map(p => `${p.route} \u2192 ${p.status}`) : 'capture en \u00e9chec',
    built: r.build ? (r.build.pages || []).map(p => `${p.route} (${p.status})`) : 'construction en \u00e9chec ou ignor\u00e9e',
    v1: r.v1 ? { fixed: (r.v1.fixed || []).length, remaining: r.v1.remaining || [] } : 'v1 en \u00e9chec ou non lanc\u00e9e',
    v2: r.v2 ? { fixed: (r.v2.fixed || []).length, remaining: r.v2.remaining || [] } : 'v2 en \u00e9chec ou non lanc\u00e9e',
  })),
  unitesSansPage: sansPage,
  shellIssues,
  sectionIssues,
  site,
  coque,
}
