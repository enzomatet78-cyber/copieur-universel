/*
 * shell-base.js — socle GÉNÉRIQUE de la coque d'un clone (plugin copieur-universel, skill reconstruire-appli).
 *
 * À copier TEL QUEL dans <CLONE>/assets/shell-base.js. Il ne contient rien de propre à une appli :
 * la navigation de l'appli copiée (barre latérale, en-tête, menu utilisateur…) s'écrit dans
 * <CLONE>/assets/shell.js, chargé juste après, avec l'API ci-dessous.
 *
 * Ordre de chargement (fin de <body>) :
 *   <script src="/assets/fake-data.js"></script>      données fictives (window.FAKE)
 *   <script src="/assets/shell-base.js"></script>     ce fichier (window.Shell)
 *   <script src="/assets/shell.js"></script>          coque propre à l'appli (Shell.configure, icônes, navigation)
 *   <script> … script de la page … </script>
 * Configuration possible AVANT ce fichier : <script>window.SHELL_CONFIG = { tabler: false, … }</script>
 *
 * API (window.Shell) — détail et exemples : skills/reconstruire-appli/SKILL.md et references/conventions.md
 *   Configuration : Shell.CONFIG, Shell.configure(o)
 *   Icônes        : Shell.icon(nom, classes, options) → chaîne <svg> ; Shell.registerIcons(map, défauts) ;
 *                   Shell.registerIconsText(contenu d'icones.txt) ; Shell.hasIcon(nom) ; Shell.iconNames()
 *                   <svg data-icon="nom" class="w-4 h-4"></svg> dans le HTML est remplacé automatiquement.
 *   Texte         : Shell.esc(s) ; Shell.html`…${valeur}…` (valeurs échappées) ; Shell.raw(s) ; Shell.codes(s)
 *   Formats       : Shell.fmt(n, opts) ; Shell.fmtMoney(n, devise, opts) ; Shell.fmtPct(ratio, décimales) ;
 *                   Shell.fmtDate(d, 'court'|'moyen'|'long'|'jour'|'heure'|'complet'|opts) ; Shell.fmtRel(d, base) ;
 *                   Shell.today()
 *   Stockage      : Shell.store.get(clé, défaut) / set(clé, valeur) / remove(clé) / clear()  (localStorage protégé)
 *   Hydratation   : Shell.hydrate(racine) (icônes, data-bind, data-nav-key, onglets) ; Shell.ready(fn) ; Shell.setNav(clé)
 *   Comportements déclaratifs (aucun style imposé : l'aspect vient des classes recopiées de l'original) :
 *                   infobulles data-tip-text / data-tip ; menus data-menu ; modales data-modal-open ;
 *                   onglets data-tabs ; dépliants data-toggle ; interrupteurs data-switch ;
 *                   barre de menus de logiciel data-menubar (Alt+lettre, flèches, cadre de focus au clavier)
 *   Divers        : Shell.$, Shell.$$, Shell.on, Shell.show/hide/isHidden, Shell.menu, Shell.modal, Shell.tabs,
 *                   Shell.noTransition, Shell.copy, Shell.keys
 * Évènements (bubbles) : shell:ready (document), shell:menu, shell:modal, shell:toggle, shell:tab, shell:switch.
 * Quand tout est prêt : <html data-shell="ready">.
 */
(function () {
  'use strict';
  if (window.Shell && window.Shell.__base) return; // chargé deux fois : on garde le premier

  var W = window, D = document;

  /* ===================================================================================== *
   * Configuration
   * ===================================================================================== */
  var CONFIG = {
    appName: 'Appli',
    locale: 'fr-FR',          // langue d'affichage de l'ORIGINAL (formats nombres/dates)
    currency: 'EUR',
    timeZone: '',             // ex. 'Europe/Paris' pour figer l'affichage des heures ('' = fuseau du poste)
    today: null,              // « aujourd'hui » figé (Date ou ISO) ; à défaut FAKE.TODAY ; à défaut la date réelle
    storagePrefix: '',        // préfixe localStorage ; à défaut 'clone-<appName>:'
    hiddenClass: 'hidden',    // classe qui masque (Tailwind : hidden) — utilisée par menus, modales, onglets…
    user: { firstName: 'Prénom', lastName: 'Nom', email: 'prenom.nom@exemple.com' },
    org: { name: 'Organisation' },
    tabler: true,             // enregistrer le jeu d'icônes Tabler de base (false si l'original utilise un autre jeu)
    bureau: false,            // clone de logiciel de bureau : pas de menu contextuel ni de sélection hors des champs
    tipDelay: 0,              // délai d'apparition des infobulles (ms)
    observe: true             // hydrater automatiquement le contenu ajouté au DOM après le démarrage
  };

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date); }
  function merge(dst, src) {
    Object.keys(src || {}).forEach(function (k) {
      var v = src[k];
      if (isObj(v) && isObj(dst[k])) merge(dst[k], v); else dst[k] = v;
    });
    return dst;
  }
  function configure(o) { merge(CONFIG, o || {}); if (booted) { applyMode(); hydrate(D); } return CONFIG; }
  merge(CONFIG, W.SHELL_CONFIG || {});

  function warn(msg) { if (W.console && console.warn) console.warn('[Shell] ' + msg); }
  var warned = {};
  function warnOnce(key, msg) { if (!warned[key]) { warned[key] = 1; warn(msg); } }

  function slug(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function initialsOf(name) {
    return String(name || '').trim().split(/\s+/).filter(Boolean)
      .map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }
  function HC() { return CONFIG.hiddenClass || 'hidden'; }

  /* ===================================================================================== *
   * Texte : échappement, gabarits sûrs, codes caractère
   * ===================================================================================== */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function SafeHtml(s) { this.s = s; }
  SafeHtml.prototype.toString = function () { return this.s; };
  function raw(s) { return s instanceof SafeHtml ? s : new SafeHtml(String(s == null ? '' : s)); }
  var SAFE_ICONS = {}; // chaînes produites par icon() : insérées telles quelles par html``
  function htmlVal(v) {
    if (v == null || v === false) return '';
    if (v instanceof SafeHtml) return v.s;
    if (Array.isArray(v)) return v.map(htmlVal).join('');
    if (typeof v === 'string' && SAFE_ICONS[v] === 1) return v;
    return esc(v);
  }
  /* Shell.html`<p title="${t}">${nom}</p>` : valeurs échappées ; html`` imbriqués, tableaux, icônes et
     Shell.raw(...) insérés tels quels. Le résultat s'affecte directement à innerHTML. */
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < strings.length; i++) out += htmlVal(arguments[i]) + strings[i];
    return new SafeHtml(out);
  }
  /* Shell.codes('1 007') → ['1','U+202F','0','0','7'] : pour comparer les espaces (U+00A0, U+202F…) */
  function codes(s) {
    return Array.from(String(s == null ? '' : s)).map(function (c) {
      var n = c.codePointAt(0);
      return (n > 32 && n < 127) ? c : 'U+' + ('000' + n.toString(16).toUpperCase()).slice(-4);
    });
  }

  /* ===================================================================================== *
   * Icônes : registre + hydratation des <svg data-icon="…">
   * ===================================================================================== */
  var ICONS = {};
  var DEF24 = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  function attrGet(attrs, name) {
    var m = (' ' + attrs).match(new RegExp('\\s' + name + '="([^"]*)"'));
    return m ? m[1] : null;
  }
  function attrSet(attrs, name, value) {
    var re = new RegExp('(^|\\s)' + name + '="[^"]*"');
    var v = name + '="' + esc(value) + '"';
    return re.test(attrs) ? attrs.replace(re, '$1' + v) : (attrs ? attrs + ' ' : '') + v;
  }
  function attrDel(attrs, name) { return attrs.replace(new RegExp('(^|\\s)' + name + '="[^"]*"', 'g'), '').trim(); }

  /* Une définition d'icône peut être :
     - une chaîne de contenu SVG ('<path d="…"/>') → cadre par défaut (viewBox 24, trait 2, comme Tabler/Lucide),
       modifiable par les « défauts » passés à registerIcons ({ vb, fill, stroke, sw, lock }) ;
     - un SVG complet recopié de la capture ('<svg viewBox="…" …>…</svg>') → gardé tel quel ;
     - un objet { body, attrs } (attrs = attributs bruts, format de icones.txt) ou { body, vb, fill, stroke, sw, lock, cls }.
     lock: true → l'épaisseur du trait est aussi posée en style inline (une classe stroke-2 ne peut plus l'écraser). */
  function normIcon(spec, d) {
    d = d || {};
    if (spec == null) return null;
    if (typeof spec === 'string') {
      var s = spec.trim();
      if (/^<svg[\s>]/i.test(s)) {
        var m = s.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/i);
        if (!m) return null;
        var at = m[1], cls = attrGet(at, 'class') || '';
        ['class', 'xmlns', 'aria-hidden', 'data-icon', 'data-icon-name', 'icon'].forEach(function (a) { at = attrDel(at, a); });
        return { attrs: at.replace(/(^|\s)viewBox="\s*"/g, ' ').trim(), body: m[2], lock: !!d.lock, cls: cls };
      }
      spec = { body: s };
    }
    var attrs = spec.attrs;
    if (attrs == null) {
      var fill = spec.fill || d.fill || 'none';
      var stroke = spec.stroke || d.stroke || (fill === 'none' ? 'currentColor' : 'none');
      var sw = spec.sw != null ? spec.sw : (d.sw != null ? d.sw : 2);
      attrs = 'viewBox="' + (spec.vb || d.vb || '0 0 24 24') + '" fill="' + fill + '"' +
        (stroke !== 'none' ? ' stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' : '');
    }
    // viewBox vide (sprite sans viewBox dans icones.txt) : attribut invalide → erreur console ; on le retire
    attrs = String(attrs).replace(/(^|\s)viewBox="\s*"/g, ' ').trim();
    return { attrs: attrs, body: spec.body || '', lock: !!(spec.lock != null ? spec.lock : d.lock), cls: spec.cls || '' };
  }

  /* registerIcons({ nom: définition }, défauts) — le dernier enregistré gagne ; 'lib:nom' crée aussi l'alias 'nom' */
  function registerIcons(map, defaults) {
    Object.keys(map || {}).forEach(function (k) {
      var def = normIcon(map[k], defaults);
      if (!def) { warn('définition d\u2019icône illisible : ' + k); return; }
      ICONS[k] = def;
      var i = k.indexOf(':');
      if (i > 0) ICONS[k.slice(i + 1)] = def;
    });
    return Object.keys(map || {}).length;
  }
  /* registerIconsText(texte) : enregistre directement le contenu de icones.txt (sortie de __icons() du kit) :
     « lib:nom xN | attributs | contenu SVG » par ligne ; lignes /* … *\/ ignorées. */
  function registerIconsText(text) {
    var n = 0;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.indexOf('/*') === 0) return;
      var i1 = line.indexOf(' | '), i2 = i1 < 0 ? -1 : line.indexOf(' | ', i1 + 3);
      if (i1 < 0 || i2 < 0) return;
      var key = line.slice(0, i1).replace(/\s+x\d+$/, '').trim();
      var body = line.slice(i2 + 3);
      if (/^\(sprite externe/.test(body)) { warn('icône ' + key + ' : sprite externe, à recopier à la main'); return; }
      var o = {}; o[key] = { attrs: line.slice(i1 + 3, i2), body: body };
      n += registerIcons(o);
    });
    return n;
  }
  function lookup(name) {
    name = String(name || '');
    if (ICONS[name]) return ICONS[name];
    var i = name.indexOf(':');
    return i > 0 ? ICONS[name.slice(i + 1)] || null : null;
  }
  function hasIcon(name) { return !!lookup(name); }
  function iconNames() { return Object.keys(ICONS).sort(); }

  /* icon(nom, classes, { attrs: {nom: valeur}, label: 'texte accessible' }) → chaîne <svg> */
  function icon(name, cls, opts) {
    opts = opts || {};
    var def = lookup(name);
    if (!def) {
      warnOnce('icon:' + name, 'icône inconnue « ' + name + ' » : l\u2019enregistrer avec Shell.registerIcons() (SVG de la capture, icones.txt)');
      def = { attrs: DEF24, body: '', lock: false, cls: '' };
    }
    var attrs = def.attrs, over = opts.attrs || {}, style = attrGet(attrs, 'style') || '';
    Object.keys(over).forEach(function (k) {
      if (k === 'style') style = (style ? style.replace(/;?\s*$/, ';') : '') + over[k];
      else if (k !== 'class' && over[k] != null) attrs = attrSet(attrs, k, over[k]);
    });
    if (attrGet(attrs, 'width') == null && attrGet(attrs, 'height') == null) {
      var vb = (attrGet(attrs, 'viewBox') || '0 0 24 24').split(/[\s,]+/);
      attrs += ' width="' + (vb[2] || 24) + '" height="' + (vb[3] || 24) + '"';
    }
    var sw = attrGet(attrs, 'stroke-width');
    if (def.lock && sw && !/stroke-width\s*:/.test(style)) style = (style ? style.replace(/;?\s*$/, ';') : '') + 'stroke-width:' + sw;
    attrs = attrDel(attrs, 'style');
    var classes = [def.cls, cls].filter(Boolean).join(' ').trim();
    var a11y = opts.label ? ' role="img" aria-label="' + esc(opts.label) + '"' : ' aria-hidden="true"';
    var out = '<svg xmlns="http://www.w3.org/2000/svg" ' + attrs + (style ? ' style="' + esc(style) + '"' : '') +
      (classes ? ' class="' + esc(classes) + '"' : '') + a11y + ' data-icon-name="' + esc(name) + '">' + def.body + '</svg>';
    SAFE_ICONS[out] = 1;
    return out;
  }

  var TPL = D.createElement('template');
  function fromHtml(s) { TPL.innerHTML = s; return TPL.content.firstElementChild; }

  /* Remplace chaque <svg data-icon="nom" …> par l'icône ; les attributs posés sur l'espace réservé
     (class, style, width, height, stroke-width, id, aria-label…) l'emportent sur la définition. */
  function hydrateIcons(scope) {
    eachMatch(scope || D, 'svg[data-icon]', function (el) {
      var over = {}, label = null;
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (a.name === 'data-icon' || a.name === 'class' || a.name === 'xmlns' || a.name === 'aria-hidden' || a.name === 'role') return;
        if (a.name === 'aria-label') { label = a.value; return; }
        over[a.name] = a.value;
      });
      var node = fromHtml(icon(el.getAttribute('data-icon'), el.getAttribute('class') || '', { attrs: over, label: label }));
      if (node && el.parentNode) el.parentNode.replaceChild(node, el);
    });
  }

  /* ===================================================================================== *
   * Formats (langue de l'original, fr-FR par défaut)
   * ===================================================================================== */
  var NF = {}, DF = {}, RF = {};
  function nf(o) { var k = CONFIG.locale + JSON.stringify(o || {}); return NF[k] || (NF[k] = new Intl.NumberFormat(CONFIG.locale, o)); }
  /* fr-FR : séparateur de milliers = espace fine insécable U+202F (« 1 007 »), décimale = virgule */
  function fmt(n, o) { return nf(o).format(n); }
  function fmtMoney(n, cur, o) { return nf(merge({ style: 'currency', currency: cur || CONFIG.currency }, o || {})).format(n); }
  function fmtPct(ratio, dec) { dec = dec || 0; return nf({ style: 'percent', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(ratio); }
  function toDate(d) {
    if (d instanceof Date) return d;
    if (d == null || d === '') return null;
    var x = new Date(d);
    return isNaN(x.getTime()) ? null : x;
  }
  var DATE_STYLES = {
    court: { day: '2-digit', month: '2-digit', year: 'numeric' },                  // 12/10/2026
    moyen: { day: 'numeric', month: 'short', year: 'numeric' },                    // 12 oct. 2026
    long: { day: 'numeric', month: 'long', year: 'numeric' },                      // 12 octobre 2026
    jour: { weekday: 'long', day: 'numeric', month: 'long' },                      // lundi 12 octobre
    heure: { hour: '2-digit', minute: '2-digit' },                                 // 10:00
    complet: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  };
  function fmtDate(d, style) {
    var x = toDate(d); if (!x) return '';
    var o = typeof style === 'object' && style ? merge({}, style) : merge({}, DATE_STYLES[style || 'court'] || DATE_STYLES.court);
    if (CONFIG.timeZone && !o.timeZone) o.timeZone = CONFIG.timeZone;
    var k = CONFIG.locale + JSON.stringify(o);
    return (DF[k] || (DF[k] = new Intl.DateTimeFormat(CONFIG.locale, o))).format(x);
  }
  /* fmtRel(date, base = Shell.today()) → « il y a 3 jours », « dans 2 heures », « hier » */
  function fmtRel(d, base) {
    var x = toDate(d), b = toDate(base) || today(); if (!x) return '';
    var s = (x.getTime() - b.getTime()) / 1000, a = Math.abs(s), unit, v;
    if (a < 60) { unit = 'second'; v = s; }
    else if (a < 3600) { unit = 'minute'; v = s / 60; }
    else if (a < 86400) { unit = 'hour'; v = s / 3600; }
    else if (a < 86400 * 30) { unit = 'day'; v = s / 86400; }
    else if (a < 86400 * 365) { unit = 'month'; v = s / (86400 * 30); }
    else { unit = 'year'; v = s / (86400 * 365); }
    var k = CONFIG.locale;
    return (RF[k] || (RF[k] = new Intl.RelativeTimeFormat(k, { numeric: 'auto' }))).format(Math.round(v), unit);
  }
  function today() {
    var t = toDate(CONFIG.today) || (W.FAKE && toDate(W.FAKE.TODAY));
    return t ? new Date(t.getTime()) : new Date();
  }

  /* ===================================================================================== *
   * Stockage local protégé (navigation privée, stockage plein ou désactivé : jamais d'erreur)
   * ===================================================================================== */
  function pfx() { return CONFIG.storagePrefix || ('clone-' + (slug(CONFIG.appName) || 'appli') + ':'); }
  var store = {
    get: function (k, def) {
      try { var r = W.localStorage.getItem(pfx() + k); if (r == null) return def; var v = JSON.parse(r); return v == null ? def : v; }
      catch (e) { return def; }
    },
    set: function (k, v) { try { W.localStorage.setItem(pfx() + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    remove: function (k) { try { W.localStorage.removeItem(pfx() + k); } catch (e) { /* stockage indisponible */ } },
    /* efface uniquement les clés de CE clone ; renvoie leur nombre */
    clear: function () {
      try {
        var p = pfx(), ks = [];
        for (var i = 0; i < W.localStorage.length; i++) { var k = W.localStorage.key(i); if (k && k.indexOf(p) === 0) ks.push(k); }
        ks.forEach(function (k) { W.localStorage.removeItem(k); });
        return ks.length;
      } catch (e) { return 0; }
    }
  };

  /* ===================================================================================== *
   * Petits utilitaires DOM
   * ===================================================================================== */
  function $(sel, root) { return (root || D).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }
  function eachMatch(scope, sel, fn) {
    if (!scope) return;
    var list = [];
    if (scope.nodeType === 1 && scope.matches(sel)) list.push(scope);
    if (scope.querySelectorAll) list = list.concat($$(sel, scope));
    list.forEach(fn);
  }
  /* Shell.on(racine, 'click', '.ligne', function (e, el) { … }) : délégation d'évènements */
  function on(root, type, sel, fn) {
    root = root || D;
    var h = function (e) {
      var t = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (t && (root === D || root.contains(t))) fn.call(t, e, t);
    };
    root.addEventListener(type, h);
    return function () { root.removeEventListener(type, h); };
  }
  function toggleClasses(el, list, onOff) {
    if (!el || !list) return;
    String(list).split(/\s+/).forEach(function (c) { if (c) el.classList.toggle(c, !!onOff); });
  }
  function byId(id) { return id ? D.getElementById(id) : null; }
  function isHidden(el) { return !!el && el.classList.contains(HC()); }
  function show(el) { if (el) el.classList.remove(HC()); return el; }
  function hide(el) { if (el) el.classList.add(HC()); return el; }
  function fire(el, name, detail) { (el || D).dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} })); }
  function cssEsc(s) { return W.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function chevrons(trigger, open) {
    $$('[data-chevron]', trigger).forEach(function (c) { toggleClasses(c, c.getAttribute('data-chevron') || 'rotate-180', open); });
  }
  /* iframes « paresseuses » (vidéos) : chargées à l'ouverture, déchargées à la fermeture (sinon le son continue) */
  function lazyFrames(root, open) {
    $$('iframe[data-lazy-src]', root).forEach(function (f) {
      var want = open ? f.getAttribute('data-lazy-src') : 'about:blank';
      if (f.getAttribute('src') !== want) f.setAttribute('src', want);
    });
  }
  /* Applique un état initial sans animation (ex. barre latérale repliée au chargement) */
  function noTransition(els, fn) {
    els = [].concat(els || D.documentElement).filter(Boolean);
    els.forEach(function (e) { e.classList.add('shell-no-transition'); });
    try { if (fn) fn(); } finally {
      els.forEach(function (e) { void e.offsetWidth; }); // styles finaux calculés sans transition
      var done = false;
      var end = function () { if (done) return; done = true; els.forEach(function (e) { e.classList.remove('shell-no-transition'); }); };
      requestAnimationFrame(function () { requestAnimationFrame(end); });
      setTimeout(end, 100); // onglet en arrière-plan : requestAnimationFrame n'est pas appelé
    }
  }
  function copy(text) {
    text = String(text == null ? '' : text);
    if (W.navigator.clipboard && W.isSecureContext) {
      return W.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var t = D.createElement('textarea'); t.value = text; t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:-1000px;opacity:0'; D.body.appendChild(t); t.select();
      var ok = D.execCommand('copy'); D.body.removeChild(t); return !!ok;
    } catch (e) { return false; }
  }

  /* ===================================================================================== *
   * Liaisons : data-bind (titulaire du compte, organisation…) et data-nav-key (navigation active)
   * ===================================================================================== */
  var BIND_ALIASES = { // compatibilité avec la coque iClosed
    'user-name': 'user.fullName', 'user-first': 'user.firstName', 'user-email': 'user.email',
    'user-initial': 'user.initial', 'org-name': 'org.name', 'org-initial': 'org.initial'
  };
  function resolve(path) {
    path = BIND_ALIASES[path] || path;
    var parts = String(path).split('.'), cur = CONFIG, parent = null;
    for (var i = 0; i < parts.length; i++) {
      parent = cur;
      cur = cur != null ? cur[parts[i]] : undefined;
    }
    if (cur != null) return cur;
    var last = parts[parts.length - 1], p = parent || {};
    var full = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || '';
    if (last === 'fullName') return full;
    if (last === 'initials') return initialsOf(full);
    if (last === 'initial') return full.charAt(0).toUpperCase();
    return null;
  }
  function bindData(scope) {
    eachMatch(scope || D, '[data-bind]', function (el) {
      var v = resolve(el.getAttribute('data-bind'));
      if (v != null && el.textContent !== String(v)) el.textContent = String(v);
    });
  }
  /* <a data-nav-key="contacts" data-active-class="bg-blue-50 text-blue-600" data-inactive-class="text-gray-700">
     actif quand <body data-nav="contacts"> (plusieurs clés possibles : data-nav-key="reglages integrations").
     Les descendants qui portent eux aussi data-active-class / data-inactive-class (icône, libellé, badge dont la
     couleur change avec l'élément actif) suivent le même état. */
  function markNav(scope) {
    var cur = (D.body && D.body.getAttribute('data-nav')) || '';
    eachMatch(scope || D, '[data-nav-key]', function (el) {
      var keys = (el.getAttribute('data-nav-key') || '').split(/\s+/), active = !!cur && keys.indexOf(cur) !== -1;
      toggleClasses(el, el.getAttribute('data-active-class'), active);
      toggleClasses(el, el.getAttribute('data-inactive-class'), !active);
      $$('[data-active-class],[data-inactive-class]', el).forEach(function (d) {
        var tc = d.closest('[data-tabs]');
        if (d.closest('[data-nav-key]') !== el || (tc && el.contains(tc))) return;   // élément d'un autre groupe
        toggleClasses(d, d.getAttribute('data-active-class'), active);
        toggleClasses(d, d.getAttribute('data-inactive-class'), !active);
      });
      if (active) el.setAttribute('aria-current', 'page');
      else if (el.getAttribute('aria-current') === 'page') el.removeAttribute('aria-current');
    });
  }
  function setNav(key) { if (D.body) { D.body.setAttribute('data-nav', key || ''); markNav(D); } }

  /* ===================================================================================== *
   * Infobulles : data-tip-text="texte" ou data-tip="id-d-un-<template>" ; data-tip-pos="top|bottom|left|right"
   * (délégation : fonctionne aussi pour le contenu injecté). Aspect : variables --tip-* de shell-base.css.
   * ===================================================================================== */
  var tip = null, tipFor = null, tipTimer = null;
  function tipEl() {
    if (tip) return tip;
    tip = D.createElement('div');
    tip.id = 'shell-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = '<div class="shell-tip-inner"></div><div class="shell-tip-arrow"></div>';
    (D.body || D.documentElement).appendChild(tip);
    return tip;
  }
  function tipTarget(n) { return n && n.closest ? n.closest('[data-tip],[data-tip-text]') : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function showTip(el) {
    var t = tipEl(), inner = t.firstChild, arrow = t.lastChild;
    var id = el.getAttribute('data-tip'), text = el.getAttribute('data-tip-text');
    if (id) {
      var tpl = byId(id);
      if (!tpl) { warnOnce('tip:' + id, 'infobulle : <template id="' + id + '"> introuvable'); return; }
      inner.innerHTML = tpl.innerHTML;
      hydrate(inner);
    } else if (text) {
      inner.innerHTML = '<p class="shell-tip-text">' + esc(text) + '</p>';
    } else return;
    tipFor = el;
    t.style.left = '0px'; t.style.top = '0px';
    t.classList.add('show');
    var pos = el.getAttribute('data-tip-pos') || 'top', place = pos;
    var gap = parseFloat(getComputedStyle(t).getPropertyValue('--tip-gap')) || 9;
    var r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight, vw = W.innerWidth, vh = W.innerHeight, left, top;
    if (pos === 'left' || pos === 'right') {
      top = clamp(r.top + r.height / 2 - h / 2, 8, vh - h - 8);
      left = pos === 'right' ? r.right + gap : r.left - w - gap;
      if (pos === 'left' && left < 8) { place = 'right'; left = r.right + gap; }
      else if (pos === 'right' && left + w > vw - 8) { place = 'left'; left = r.left - w - gap; }
      arrow.style.left = ''; arrow.style.top = (r.top + r.height / 2 - top) + 'px';
    } else {
      left = clamp(r.left + r.width / 2 - w / 2, 8, vw - w - 8);
      top = pos === 'bottom' ? r.bottom + gap : r.top - h - gap;
      if (pos !== 'bottom' && top < 8) { place = 'bottom'; top = r.bottom + gap; }
      else if (pos === 'bottom' && top + h > vh - 8) { place = 'top'; top = r.top - h - gap; }
      arrow.style.top = ''; arrow.style.left = (r.left + r.width / 2 - left) + 'px';
    }
    t.setAttribute('data-place', place);
    t.style.left = Math.round(left) + 'px';
    t.style.top = Math.round(top) + 'px';
  }
  function scheduleTip(el) {
    clearTimeout(tipTimer);
    var delay = parseInt(el.getAttribute('data-tip-delay') || CONFIG.tipDelay || 0, 10);
    if (delay > 0) tipTimer = setTimeout(function () { showTip(el); }, delay); else showTip(el);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipFor = null;
    if (tip) tip.classList.remove('show');
  }
  D.addEventListener('mouseover', function (e) {
    var el = tipTarget(e.target);
    if (el === tipFor) return;
    if (el) scheduleTip(el); else if (tipFor) hideTip();
  });
  D.addEventListener('mouseout', function (e) {
    if (!tipFor) return;
    var to = e.relatedTarget;
    if (to && (tipFor.contains(to) || tipTarget(to) === tipFor)) return;
    hideTip();
  });
  D.addEventListener('focusin', function (e) { var el = tipTarget(e.target); if (el && el !== tipFor) scheduleTip(el); });
  D.addEventListener('focusout', function (e) { if (tipFor && tipTarget(e.target) === tipFor) hideTip(); });
  D.addEventListener('scroll', function () { hideTip(); }, true);
  W.addEventListener('resize', function () { hideTip(); });

  /* ===================================================================================== *
   * Menus déroulants : <button data-menu="menu-id"> + <div id="menu-id" class="hidden …">
   *   fermeture : clic extérieur, Échap, [data-menu-close] dans le menu, ouverture d'un autre menu
   *   data-float="bottom-start|bottom-end|top-start|top-end" sur le menu : positionné en fixed contre le
   *   déclencheur (échappe aux conteneurs overflow-hidden) ; [data-chevron] dans le déclencheur pivote.
   * ===================================================================================== */
  var openMenus = [];
  function triggerFor(attr, id) { return $('[' + attr + '="' + cssEsc(id) + '"]'); }
  function floatMenu(m, trigger) {
    var place = m.getAttribute('data-float') || 'bottom-start', gap = parseFloat(m.getAttribute('data-float-gap') || '4');
    m.style.position = 'fixed'; m.style.left = '0px'; m.style.top = '0px'; m.style.right = 'auto'; m.style.bottom = 'auto';
    m.style.zIndex = m.style.zIndex || 'var(--shell-menu-z, 1000)';
    var r = trigger.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, vw = W.innerWidth, vh = W.innerHeight;
    var up = place.indexOf('top') === 0, end = /-end$/.test(place);
    var top = up ? r.top - h - gap : r.bottom + gap;
    if (!up && top + h > vh - 8 && r.top - h - gap >= 8) top = r.top - h - gap;
    else if (up && top < 8 && r.bottom + gap + h <= vh - 8) top = r.bottom + gap;
    var left = clamp(end ? r.right - w : r.left, 8, Math.max(8, vw - w - 8));
    m.style.left = Math.round(left) + 'px'; m.style.top = Math.round(top) + 'px';
  }
  function menuOpen(id, trigger) {
    var m = byId(id); if (!m) { warnOnce('menu:' + id, 'menu #' + id + ' introuvable'); return; }
    trigger = trigger || triggerFor('data-menu', id);
    openMenus.slice().forEach(function (o) { if (o.menu !== m && !(trigger && o.menu.contains(trigger))) menuClose(o.menu.id); });
    show(m);
    if (trigger) { trigger.setAttribute('aria-expanded', 'true'); chevrons(trigger, true); }
    if (trigger && m.hasAttribute('data-float')) floatMenu(m, trigger);
    if (!openMenus.some(function (o) { return o.menu === m; })) openMenus.push({ menu: m, trigger: trigger });
    hideTip();
    fire(m, 'shell:menu', { id: id, open: true });
  }
  function menuClose(id) {
    var m = byId(id); if (!m) return;
    var idx = -1;
    openMenus.forEach(function (o, i) { if (o.menu === m) idx = i; });
    var trigger = idx >= 0 ? openMenus[idx].trigger : triggerFor('data-menu', id);
    if (idx >= 0) openMenus.splice(idx, 1);
    // les sous-menus ouverts depuis ce menu se ferment avec lui
    openMenus.slice().forEach(function (o) { if (o.trigger && m.contains(o.trigger)) menuClose(o.menu.id); });
    if (isHidden(m)) return;
    hide(m);
    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); chevrons(trigger, false); }
    fire(m, 'shell:menu', { id: id, open: false });
  }
  function menuToggle(id, trigger) { var m = byId(id); if (m) { if (isHidden(m)) menuOpen(id, trigger); else menuClose(id); } }
  function closeAllMenus() { openMenus.slice().reverse().forEach(function (o) { menuClose(o.menu.id); }); }

  /* ===================================================================================== *
   * Barre de menus d'un logiciel : <div role="menubar" data-menubar> contenant les titres [data-menu]
   *   (+ data-accel="f" : Alt+F ouvre ce menu). Éléments des menus : role="menuitem".
   *   Ouvert au CLAVIER (Alt+lettre, flèches) : classe data-kbd-class (défaut « clavier ») sur le menu et
   *   data-focus-class (défaut « is-focused ») sur l'élément actif — posées par script, car :focus ne
   *   s'applique pas dans une fenêtre sans focus (headless). Ouvert à la SOURIS : aucune des deux, comme
   *   Windows. Flèches haut/bas : élément suivant ; gauche/droite : menu voisin ; Origine/Fin ; Entrée/Espace :
   *   active l'élément ; survol d'un autre titre pendant qu'un menu est ouvert : bascule.
   * ===================================================================================== */
  function barOf(el) { return el && el.closest ? el.closest('[data-menubar]') : null; }
  function barTriggers(bar) { return $$('[data-menu]', bar).filter(function (t) { return !t.disabled && !isHidden(t); }); }
  function openBarMenu() {
    for (var i = openMenus.length - 1; i >= 0; i--) { var o = openMenus[i]; if (o.trigger && barOf(o.trigger)) return o; }
    return null;
  }
  function menuItems(m) {
    return $$('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]', m).filter(function (x) {
      return !x.disabled && x.getAttribute('aria-disabled') !== 'true' && !isHidden(x) && x.getClientRects().length > 0;
    });
  }
  function kbdClass(bar) { return (bar && bar.getAttribute('data-kbd-class')) || 'clavier'; }
  function focusClass(bar) { return (bar && bar.getAttribute('data-focus-class')) || 'is-focused'; }
  function focusMenuItem(m, el, bar) {
    var fc = focusClass(bar);
    menuItems(m).forEach(function (x) { x.classList.toggle(fc, x === el); });
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }
  function openBar(trigger, byKeyboard) {
    var bar = barOf(trigger), id = trigger.getAttribute('data-menu'), m = byId(id);
    if (!m) { warnOnce('menu:' + id, 'menu #' + id + ' introuvable'); return; }
    if (isHidden(m)) menuOpen(id, trigger);
    m.classList.toggle(kbdClass(bar), !!byKeyboard);
    if (byKeyboard) focusMenuItem(m, menuItems(m)[0], bar);
    else menuItems(m).forEach(function (x) { x.classList.remove(focusClass(bar)); });
  }
  function menubarKey(e) {
    var k = e.key;
    if (e.altKey && !e.ctrlKey && !e.metaKey && k && k.length === 1) {
      var low = k.toLowerCase(), hit = null;
      $$('[data-menubar] [data-menu][data-accel]').forEach(function (t) {
        if (!hit && !isHidden(t) && (t.getAttribute('data-accel') || '').toLowerCase() === low) hit = t;
      });
      if (!hit) return false;
      e.preventDefault(); openBar(hit, true); return true;
    }
    var o = openBarMenu(); if (!o) return false;
    var bar = barOf(o.trigger), m = o.menu, its = menuItems(m), fc = focusClass(bar);
    var cur = its.filter(function (x) { return x.classList.contains(fc) || x === D.activeElement; })[0], i = its.indexOf(cur);
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      e.preventDefault(); m.classList.add(kbdClass(bar));
      if (!its.length) return true;
      var n = k === 'Home' ? 0 : k === 'End' ? its.length - 1 : k === 'ArrowDown' ? (i + 1) % its.length : (i <= 0 ? its.length - 1 : i - 1);
      focusMenuItem(m, its[n], bar); return true;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var ts = barTriggers(bar), j = ts.indexOf(o.trigger); if (j < 0 || ts.length < 2) return false;
      e.preventDefault();
      var nt = ts[(j + (k === 'ArrowRight' ? 1 : ts.length - 1)) % ts.length];
      menuClose(m.id); openBar(nt, true); return true;
    }
    if ((k === 'Enter' || k === ' ') && cur) { e.preventDefault(); cur.click(); return true; }
    return false;
  }
  D.addEventListener('mouseover', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-menubar] [data-menu]');
    if (!t || t.disabled) return;
    var o = openBarMenu(); if (!o || o.trigger === t || barOf(o.trigger) !== barOf(t)) return;
    menuClose(o.menu.id); openBar(t, false);
  });
  D.addEventListener('mousemove', function (e) {
    var o = openBarMenu(); if (!o || !e.target || !o.menu.contains(e.target)) return;
    var bar = barOf(o.trigger);
    if (o.menu.classList.contains(kbdClass(bar))) {
      o.menu.classList.remove(kbdClass(bar));
      menuItems(o.menu).forEach(function (x) { x.classList.remove(focusClass(bar)); });
    }
  });

  /* ===================================================================================== *
   * Modales et tiroirs : <button data-modal-open="modale-id"> + <div id="modale-id" class="hidden …">
   *   fermeture : [data-modal-close] (dans la modale, ou ="id"), Échap (la plus haute), clic sur un élément
   *   [data-modal-backdrop] (le clic doit tomber sur lui, pas sur le panneau) ; focus rendu au déclencheur.
   * ===================================================================================== */
  var openModals = [];
  function modalOpen(id, trigger) {
    var m = byId(id); if (!m) { warnOnce('modal:' + id, 'modale #' + id + ' introuvable'); return; }
    if (openModals.some(function (o) { return o.el === m; })) return;
    closeAllMenus(); hideTip();
    show(m);
    lazyFrames(m, true);
    openModals.push({ el: m, trigger: trigger || D.activeElement });
    var f = $('[autofocus]', m);
    if (f) f.focus({ preventScroll: true });
    fire(m, 'shell:modal', { id: id, open: true });
  }
  function modalClose(id) {
    var m = byId(id); if (!m) return;
    var idx = -1;
    openModals.forEach(function (o, i) { if (o.el === m) idx = i; });
    var trig = idx >= 0 ? openModals[idx].trigger : null;
    if (idx >= 0) openModals.splice(idx, 1);
    if (isHidden(m)) return;
    hide(m);
    lazyFrames(m, false);
    if (trig && trig.focus && D.contains(trig)) trig.focus({ preventScroll: true });
    fire(m, 'shell:modal', { id: id, open: false });
  }
  function topModal() { return openModals.length ? openModals[openModals.length - 1].el : null; }

  /* ===================================================================================== *
   * Dépliants / accordéons : <button data-toggle="panneau-id" [data-toggle-group="faq"]> + <div id="panneau-id" class="hidden">
   *   même groupe → un seul ouvert à la fois ; aria-expanded, [data-chevron], iframes paresseuses gérés.
   * ===================================================================================== */
  function setToggle(trigger, open) {
    var t = byId(trigger.getAttribute('data-toggle')); if (!t) return;
    if (open === !isHidden(t)) return;
    if (open) show(t); else hide(t);
    trigger.setAttribute('aria-expanded', String(open));
    chevrons(trigger, open);
    lazyFrames(t, open);
    fire(t, 'shell:toggle', { id: t.id, open: open });
  }
  function toggleClick(trigger) {
    var t = byId(trigger.getAttribute('data-toggle'));
    if (!t) { warnOnce('toggle:' + trigger.getAttribute('data-toggle'), 'dépliant #' + trigger.getAttribute('data-toggle') + ' introuvable'); return; }
    var open = isHidden(t), g = trigger.getAttribute('data-toggle-group');
    if (open && g) $$('[data-toggle-group="' + cssEsc(g) + '"]').forEach(function (o) { if (o !== trigger) setToggle(o, false); });
    setToggle(trigger, open);
  }

  /* ===================================================================================== *
   * Onglets : <div data-tabs [data-active-class="…"] [data-inactive-class="…"] [data-tabs-param="tab"] [data-tabs-store="clé"]>
   *             <button data-tab="a">…</button> … <div data-tab-panel="a">…</div> …
   *   onglet initial : ?param= → mémorisé → data-active → aria-selected="true" → premier.
   * ===================================================================================== */
  function own(c, sel) { return $$(sel, c).filter(function (e) { return e.closest('[data-tabs]') === c; }); }
  function selectTab(c, key, byUser) {
    if (!c || key == null) return;
    var ac = c.getAttribute('data-active-class'), ic = c.getAttribute('data-inactive-class');
    own(c, '[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === key;
      toggleClasses(b, ac, on); toggleClasses(b, ic, !on);
      b.setAttribute('aria-selected', String(on));
    });
    own(c, '[data-tab-panel]').forEach(function (p) { if (p.getAttribute('data-tab-panel') === key) show(p); else hide(p); });
    var changed = c.getAttribute('data-active') !== key;
    c.setAttribute('data-active', key);
    if (byUser) {
      var sk = c.getAttribute('data-tabs-store'); if (sk) store.set('tab:' + sk, key);
      var prm = c.getAttribute('data-tabs-param');
      if (prm && W.history && history.replaceState) {
        try { var u = new URL(location.href); u.searchParams.set(prm, key); history.replaceState(history.state, '', u.toString()); } catch (e) { /* URL non modifiable */ }
      }
    }
    if (changed || byUser) fire(c, 'shell:tab', { key: key, byUser: !!byUser });
  }
  function initTabs(scope) {
    eachMatch(scope || D, '[data-tabs]', function (c) {
      if (c.__shellTabs) return;
      c.__shellTabs = true;
      var keys = own(c, '[data-tab]').map(function (b) { return b.getAttribute('data-tab'); });
      if (!keys.length) return;
      var pick = null, prm = c.getAttribute('data-tabs-param'), sk = c.getAttribute('data-tabs-store');
      if (prm) { try { pick = new URL(location.href).searchParams.get(prm); } catch (e) { pick = null; } }
      if (keys.indexOf(pick) === -1 && sk) pick = store.get('tab:' + sk, null);
      if (keys.indexOf(pick) === -1) pick = c.getAttribute('data-active');
      if (keys.indexOf(pick) === -1) { var s = own(c, '[data-tab][aria-selected="true"]')[0]; pick = s ? s.getAttribute('data-tab') : null; }
      if (keys.indexOf(pick) === -1) pick = keys[0];
      selectTab(c, pick, false);
    });
  }

  /* ===================================================================================== *
   * Interrupteurs (visuels) : <button role="switch" aria-checked="false" data-switch
   *   data-on-class="bg-blue-600" data-off-class="bg-gray-200"><span data-on-class="translate-x-5" data-off-class="translate-x-0"></span>
   * ===================================================================================== */
  function setSwitch(sw, onOff, byUser) {
    sw.setAttribute('aria-checked', String(onOff));
    [sw].concat($$('[data-on-class],[data-off-class]', sw)).forEach(function (e) {
      toggleClasses(e, e.getAttribute('data-on-class'), onOff);
      toggleClasses(e, e.getAttribute('data-off-class'), !onOff);
    });
    fire(sw, 'shell:switch', { on: onOff, byUser: !!byUser });
  }

  /* ===================================================================================== *
   * Clavier : Échap + raccourcis (Shell.keys({ 'ctrl+s': fn, 'f1': fn }))
   * ===================================================================================== */
  var KEYMAP = {};
  function keys(map) { Object.keys(map || {}).forEach(function (k) { KEYMAP[normCombo(k)] = map[k]; }); }
  function normCombo(k) {
    var p = String(k).toLowerCase().replace(/\s+/g, '').split('+'), key = p.pop();
    var mods = ['ctrl', 'alt', 'shift'].filter(function (m) { return p.indexOf(m) !== -1 || (m === 'ctrl' && (p.indexOf('cmd') !== -1 || p.indexOf('meta') !== -1)); });
    return mods.concat([key === 'esc' ? 'escape' : key]).join('+');
  }
  function editable(t) { return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); }
  D.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase(); if (k === ' ') k = 'space';
    var combo = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', k].filter(Boolean).join('+');
    var fn = KEYMAP[combo];
    if (fn && !(editable(e.target) && !(e.ctrlKey || e.metaKey || e.altKey) && k.length === 1)) {
      if (fn(e) !== true) e.preventDefault();
      return;
    }
    if (menubarKey(e)) return;
    if (e.key === 'Escape') {
      hideTip();
      if (openMenus.length) { menuClose(openMenus[openMenus.length - 1].menu.id); return; }
      var m = topModal(); if (m) modalClose(m.id);
    }
  });

  /* ===================================================================================== *
   * Clics délégués (menus, modales, dépliants, onglets, interrupteurs)
   * ===================================================================================== */
  function isDeadLink(el) { return el.tagName === 'A' && /^(#|javascript:|)$/i.test(el.getAttribute('href') || ''); }
  D.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;

    var trg = t.closest('[data-menu]');
    if (trg && !trg.disabled) {
      if (isDeadLink(trg)) e.preventDefault();
      menuToggle(trg.getAttribute('data-menu'), trg);
      var bar0 = barOf(trg), mm = bar0 && byId(trg.getAttribute('data-menu'));   // ouvert à la souris : pas de cadre de focus
      if (mm) { mm.classList.remove(kbdClass(bar0)); menuItems(mm).forEach(function (x) { x.classList.remove(focusClass(bar0)); }); }
    } else {
      var mc = t.closest('[data-menu-close]');
      if (mc) openMenus.slice().forEach(function (o) { if (o.menu.contains(mc)) menuClose(o.menu.id); });
    }
    // clic extérieur : ferme les menus qui ne contiennent ni la cible ni son déclencheur
    openMenus.slice().forEach(function (o) {
      if (!o.menu.contains(t) && !(o.trigger && o.trigger.contains(t))) menuClose(o.menu.id);
    });
    if (trg) return;

    var mo = t.closest('[data-modal-open]');
    if (mo && !mo.disabled) { if (isDeadLink(mo)) e.preventDefault(); modalOpen(mo.getAttribute('data-modal-open'), mo); return; }
    var mx = t.closest('[data-modal-close]');
    if (mx) {
      var target = mx.getAttribute('data-modal-close');
      if (target) modalClose(target);
      else { var host = openModals.slice().reverse().filter(function (o) { return o.el.contains(mx); })[0]; if (host) modalClose(host.el.id); }
      if (isDeadLink(mx)) e.preventDefault();
      return;
    }
    var bd = t.closest('[data-modal-backdrop]');
    if (bd && bd === t) {
      var hostB = openModals.slice().reverse().filter(function (o) { return o.el.contains(bd); })[0];
      if (hostB) { modalClose(hostB.el.id); return; }
    }

    var tg = t.closest('[data-toggle]');
    if (tg && !tg.disabled) { if (isDeadLink(tg)) e.preventDefault(); toggleClick(tg); return; }

    var tb = t.closest('[data-tab]');
    if (tb && !tb.disabled) {
      var c = tb.closest('[data-tabs]');
      if (c) { if (isDeadLink(tb)) e.preventDefault(); selectTab(c, tb.getAttribute('data-tab'), true); return; }
    }

    var sw = t.closest('[data-switch]');
    if (sw && !sw.disabled && sw.getAttribute('aria-disabled') !== 'true') {
      setSwitch(sw, sw.getAttribute('aria-checked') !== 'true', true);
    }
  });
  // un menu flottant suit mal le défilement : on le ferme (comme la plupart des bibliothèques)
  D.addEventListener('scroll', function (e) {
    openMenus.slice().forEach(function (o) {
      if (o.menu.hasAttribute('data-float') && !(e.target && e.target.nodeType === 1 && o.menu.contains(e.target))) menuClose(o.menu.id);
    });
  }, true);
  W.addEventListener('resize', function () {
    openMenus.slice().forEach(function (o) { if (o.menu.hasAttribute('data-float')) menuClose(o.menu.id); });
  });

  /* ===================================================================================== *
   * Mode « logiciel de bureau »
   * ===================================================================================== */
  var modeBound = false;
  function applyMode() {
    D.documentElement.classList.toggle('shell-bureau', !!CONFIG.bureau);
    if (!CONFIG.bureau || modeBound) return;
    modeBound = true;
    D.addEventListener('contextmenu', function (e) {
      if (CONFIG.bureau && !editable(e.target) && !(e.target.closest && e.target.closest('[data-contextmenu-natif]'))) e.preventDefault();
    });
    D.addEventListener('dragstart', function (e) {
      if (CONFIG.bureau && e.target && /^(IMG|A)$/.test(e.target.tagName) && !e.target.hasAttribute('draggable')) e.preventDefault();
    });
  }

  /* ===================================================================================== *
   * Hydratation et démarrage
   * ===================================================================================== */
  function hydrate(scope) {
    scope = scope || D;
    hydrateIcons(scope);
    bindData(scope);
    markNav(scope);
    initTabs(scope);
    return scope;
  }
  var booted = false, readyFns = [], OBS = null;
  function call(fn) { try { fn(W.Shell); } catch (e) { if (W.console) console.error(e); } }
  function ready(fn) { if (typeof fn !== 'function') return; if (booted) call(fn); else readyFns.push(fn); }
  var SEL_HYD = 'svg[data-icon],[data-bind],[data-nav-key],[data-tabs]';
  function startObserver() {
    if (OBS || !CONFIG.observe || !W.MutationObserver || !D.body) return;
    OBS = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var add = muts[i].addedNodes;
        for (var j = 0; j < add.length; j++) {
          var n = add[j];
          if (n.nodeType !== 1 || !n.isConnected) continue;
          if (n.matches(SEL_HYD) || n.querySelector(SEL_HYD)) hydrate(n);
        }
      }
    });
    OBS.observe(D.body, { childList: true, subtree: true });
  }
  function boot() {
    if (booted) return;
    booted = true;
    applyMode();
    hydrate(D);
    startObserver();
    D.documentElement.setAttribute('data-shell', 'ready');
    readyFns.splice(0).forEach(call);
    fire(D, 'shell:ready', {});
  }

  /* ===================================================================================== *
   * Jeu d'icônes de base : Tabler Icons (MIT, viewBox 24, trait 2). Clés 'tabler:nom' + alias 'nom'.
   * À n'utiliser que si l'original utilise Tabler ; sinon SHELL_CONFIG.tabler = false et enregistrer les
   * icônes capturées (Shell.registerIconsText(icones.txt) ou Shell.registerIcons({...})).
   * ===================================================================================== */
  var TABLER = {
    'home': '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
    'layout-grid': '<path d="M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/>',
    'world': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/>',
    'users': '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
    'user': '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
    'layout-sidebar': '<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M9 4l0 16"/>',
    'layout-sidebar-right': '<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M15 4l0 16"/>',
    'external-link': '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
    'sparkles': '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z"/>',
    'book': '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>',
    'settings': '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',
    'help': '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 17l0 .01"/><path d="M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4"/>',
    'info-circle': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/>',
    'alert-triangle': '<path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/>',
    'list-details': '<path d="M13 5h8"/><path d="M13 9h5"/><path d="M13 15h8"/><path d="M13 19h5"/><path d="M3 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M3 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/>',
    'menu-2': '<path d="M4 6l16 0"/><path d="M4 12l16 0"/><path d="M4 18l16 0"/>',
    'chevron-down': '<path d="M6 9l6 6l6 -6"/>',
    'chevron-up': '<path d="M6 15l6 -6l6 6"/>',
    'chevron-left': '<path d="M15 6l-6 6l6 6"/>',
    'chevron-right': '<path d="M9 6l6 6l-6 6"/>',
    'selector': '<path d="M8 9l4 -4l4 4"/><path d="M16 15l-4 4l-4 -4"/>',
    'check': '<path d="M5 12l5 5l10 -10"/>',
    'x': '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    'plus': '<path d="M12 5l0 14"/><path d="M5 12l14 0"/>',
    'minus': '<path d="M5 12l14 0"/>',
    'search': '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    'dots': '<path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
    'dots-vertical': '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
    'filter': '<path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z"/>',
    'arrows-sort': '<path d="M3 9l4 -4l4 4m-4 -4v14"/><path d="M21 15l-4 4l-4 -4m4 4v-14"/>',
    'calendar': '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/>',
    'clock': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
    'copy': '<path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>',
    'link': '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
    'code': '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
    'edit': '<path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1"/><path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z"/><path d="M16 5l3 3"/>',
    'trash': '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>',
    'eye': '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',
    'refresh': '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    'download': '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
    'upload': '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 9l5 -5l5 5"/><path d="M12 4l0 12"/>',
    'mail': '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z"/><path d="M3 7l9 6l9 -6"/>',
    'phone': '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>',
    'bell': '<path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/>',
    'lock': '<path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>',
    'logout': '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
    'arrow-left': '<path d="M5 12l14 0"/><path d="M5 12l6 6"/><path d="M5 12l6 -6"/>',
    'arrow-right': '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>',
    'player-play': '<path d="M7 4v16l13 -8z"/>',
    'bolt': '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>',
    'chart-bar': '<path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/>'
  };
  if (CONFIG.tabler !== false) {
    var tb = {};
    Object.keys(TABLER).forEach(function (k) { tb['tabler:' + k] = TABLER[k]; });
    registerIcons(tb);
  }

  /* ===================================================================================== *
   * API publique
   * ===================================================================================== */
  W.Shell = {
    __base: true,
    version: '1.0',
    CONFIG: CONFIG,
    configure: configure,
    // icônes
    icon: icon, registerIcons: registerIcons, registerIconsText: registerIconsText,
    hasIcon: hasIcon, iconNames: iconNames, hydrateIcons: hydrateIcons,
    // texte et formats
    esc: esc, html: html, raw: raw, codes: codes, slug: slug, initials: initialsOf,
    fmt: fmt, fmtMoney: fmtMoney, fmtPct: fmtPct, fmtDate: fmtDate, fmtRel: fmtRel, today: today,
    // stockage
    store: store,
    // hydratation
    hydrate: hydrate, ready: ready, setNav: setNav, bind: bindData,
    bindTips: function (scope) { return scope; }, // compatibilité : les infobulles sont déléguées
    // comportements
    menu: { open: menuOpen, close: menuClose, toggle: menuToggle, closeAll: closeAllMenus },
    modal: { open: modalOpen, close: modalClose, top: topModal },
    tabs: { select: function (c, key) { selectTab(typeof c === 'string' ? $(c) : c, key, true); } },
    toggle: { set: setToggle },
    switchTo: setSwitch,
    tip: { show: showTip, hide: hideTip },
    keys: keys,
    // DOM
    $: $, $$: $$, on: on, show: show, hide: hide, isHidden: isHidden,
    noTransition: noTransition, copy: copy
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})();
