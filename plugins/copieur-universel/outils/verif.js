/* verif.js — fonctions de vérification d'un clone (outils/ du plugin copieur-universel, skill verifier-copie).
   À injecter tel quel (javascript_tool du navigateur intégré : contenu du fichier ; ou
   cdp_eval.py eval --file verif.js --expr "__mesures('#main', 2)"). Mode d'emploi : verifier-copie,
   references/methode.md §3. Lecture seule : ne modifie ni la page ni ses données. Renvoie « verif ok ». */
(function () {
  var W = window, D = document;
  function desc(e) {
    var id = e.id ? '#' + e.id : '', c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return e.tagName.toLowerCase() + id + (c ? '.' + c : '');
  }
  function R(e) { var r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Attendre une page stable : coque prête (shell-base.js), polices, puis squelettes (ms, défaut 1500) */
  W.__attendre = async function (ms) {
    var t = performance.now();
    while (W.Shell && W.Shell.__base && D.documentElement.dataset.shell !== 'ready' && performance.now() - t < 8000) await wait(100);
    if (D.fonts && D.fonts.ready) await D.fonts.ready;
    await wait(ms === undefined ? 1500 : ms);
    return JSON.stringify({ coque: D.documentElement.dataset.shell || '(sans data-shell)', fenetre: [innerWidth, innerHeight, devicePixelRatio],
      polices: Array.from(D.fonts || []).filter(function (f) { return f.status === 'loaded'; }).map(function (f) { return f.family + ' ' + f.weight; }).slice(0, 10) });
  };

  /* Conteneur qui défile : le plus grand élément overflow auto/scroll dont le contenu dépasse (sinon la page) */
  W.__defilant = function () {
    var best = D.scrollingElement, aire = 0;
    D.querySelectorAll('body *').forEach(function (e) {
      var s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 && e.clientHeight * e.clientWidth > aire) { best = e; aire = e.clientHeight * e.clientWidth; }
    });
    return best;
  };

  /* __mesures(sel, profondeur) : fenêtre, conteneur défilant (scrollHeight), blocs [desc, x, y, largeur, hauteur, texte] */
  W.__mesures = function (sel, prof) {
    var root = sel ? D.querySelector(sel) : null, d = W.__defilant(), out = [];
    if (sel && !root) return JSON.stringify({ erreur: 'introuvable : ' + sel });
    (function walk(e, n) {
      Array.prototype.forEach.call(e.children, function (c) {
        var r = c.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
        var t = (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.push([new Array(n + 1).join('  ') + desc(c)].concat(R(c), t ? [t] : []));
        if (n < (prof === undefined ? 2 : prof)) walk(c, n + 1);
      });
    })(root || d, 0);
    return JSON.stringify({ page: location.pathname, fenetre: [innerWidth, innerHeight, devicePixelRatio], defilant: desc(d),
      scrollHeight: d.scrollHeight, clientHeight: d.clientHeight, debordementHorizontal: D.documentElement.scrollWidth - D.documentElement.clientWidth, blocs: out });
  };

  /* __style(sel, props) : styles calculés des 8 premiers éléments correspondants */
  W.__style = function (sel, props) {
    props = props || ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
      'borderTopColor', 'borderTopWidth', 'borderRadius', 'boxShadow', 'paddingTop', 'paddingLeft', 'gap'];
    return JSON.stringify(Array.prototype.slice.call(D.querySelectorAll(sel), 0, 8).map(function (e) {
      var s = getComputedStyle(e), o = { el: desc(e), rect: R(e) }; props.forEach(function (p) { o[p] = s[p]; }); return o;
    }));
  };

  /* __debord() : défilement horizontal de page et éléments qui dépassent à droite. Un élément rogné par un
     ancêtre (overflow hidden/clip/auto/scroll dont le bord droit reste dans la fenêtre : diapositive de
     carrousel, tableau qui défile dans son cadre) ne fait pas défiler la page : il n'est pas compté. */
  W.__debord = function () {
    var w = D.documentElement.clientWidth;
    function rogne(e) {
      for (var p = e.parentElement; p && p !== D.body && p !== D.documentElement; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= w + 1) return true;
      }
      return false;
    }
    var fautifs = [], rognes = 0;
    Array.prototype.forEach.call(D.querySelectorAll('body *'), function (e) {
      var r = e.getBoundingClientRect();
      if (!(r.right > w + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed')) return;
      if (rogne(e)) rognes++; else fautifs.push(e);
    });
    return JSON.stringify({ scrollWidth: D.documentElement.scrollWidth, largeur: w,
      fautifs: fautifs.slice(0, 12).map(function (e) { return desc(e) + ' -> ' + Math.round(e.getBoundingClientRect().right); }),
      rognesParUnAncetre: rognes });
  };

  /* __textes(sel) : textes bloc par bloc + attributs (placeholder, aria-label, alt, title, value) ; espaces
     ordinaires normalisés, U+00A0 / U+202F / U+2009 GARDÉS. Même découpage que textes.py côté capture. */
  W.__textes = function (sel) {
    var root = typeof sel === 'string' ? D.querySelector(sel) : (sel || D.body);
    if (!root) return JSON.stringify({ erreur: 'racine introuvable : ' + sel });
    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|CANVAS|IFRAME|VIDEO|AUDIO)$/;
    var INLINE = /^(SPAN|B|STRONG|I|EM|SMALL|CODE|SUP|SUB|ABBR|MARK|U|S|TIME|KBD|Q|CITE|DFN|VAR|BDI|BDO|WBR|FONT)$/;
    var textes = [], attributs = [], buf = [];
    function norm(s) { return String(s).replace(/[ \t\n\r\f]+/g, ' ').trim(); }
    function flush() { var t = norm(buf.join('')); buf = []; if (t) textes.push(t); }
    (function walk(n) {
      if (n.nodeType === 3) { buf.push(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase();
      if (SKIP.test(tag)) return;
      if (tag === 'BR') { buf.push(' '); return; }
      ['placeholder', 'aria-label', 'alt', 'title', 'value'].forEach(function (a) {
        if (a === 'value' && (tag !== 'INPUT' || /^(hidden|password|checkbox|radio)$/i.test(n.getAttribute('type') || ''))) return;
        var v = n.getAttribute(a); if (v && norm(v)) attributs.push(a + '=' + norm(v));
      });
      var bloc = !INLINE.test(tag);
      if (bloc) flush();
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (bloc) flush();
    })(root);
    flush();
    return JSON.stringify({ page: location.pathname, racine: String(sel || 'body'), titre: D.title, textes: textes, attributs: attributs });
  };

  /* __liens() : liens du DOM RENDU (menus générés compris) au format --urls-file de check_links.py */
  W.__liens = function () {
    var vus = {}, out = [];
    D.querySelectorAll('a[href], area[href], [data-href]').forEach(function (a) {
      var h = a.getAttribute('href') || a.getAttribute('data-href');
      if (!h || /^(#|mailto:|tel:|javascript:|data:)/i.test(h) || vus[h]) return;
      vus[h] = 1; out.push({ page: location.pathname, pageUrl: location.pathname, href: h, texte: (a.textContent || '').trim().slice(0, 40) });
    });
    return JSON.stringify(out);
  };

  /* __reseau() : ressources chargées hors du serveur local, groupées par hôte */
  W.__reseau = function () {
    var par = {};
    performance.getEntriesByType('resource').forEach(function (e) {
      try { var u = new URL(e.name); if (u.origin === location.origin) return; (par[u.host] = par[u.host] || []).push(e.initiatorType + ' ' + u.pathname.slice(0, 80)); } catch (x) { /* URL illisible */ }
    });
    return JSON.stringify(par);
  };

  /* __formulaires() : formulaires qui pourraient envoyer quelque chose (connexion, paiement, action externe) */
  W.__formulaires = function () {
    return JSON.stringify(Array.prototype.map.call(D.querySelectorAll('form'), function (f) {
      return { action: f.getAttribute('action'), methode: f.getAttribute('method'), motDePasse: !!f.querySelector('input[type=password]'),
        carte: !!f.querySelector('[autocomplete^="cc-"], [name*="card" i], [name*="carte" i]') };
    }));
  };

  /* Mesurer une IMAGE de capture : l'ouvrir seule dans un onglet (servie en local sur un AUTRE port que le
     clone), puis __image() ; __couleur(x, y) ; __bords('x', y, de, a) = transitions le long de la ligne y ;
     __bords('y', x, de, a) = le long de la colonne x. Coordonnées en pixels de l'image (÷ DPR = px CSS). */
  W.__image = function () {
    var img = D.images[0]; if (!img) return 'aucune image dans cet onglet';
    var c = D.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); W.__px = g;
    return JSON.stringify({ largeur: c.width, hauteur: c.height });
  };
  W.__couleur = function (x, y) { var d = W.__px.getImageData(x, y, 1, 1).data; return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')'; };
  W.__bords = function (axe, pos, de, a, seuil) {
    seuil = seuil || 30; var n = a - de + 1, out = [];
    var d = axe === 'x' ? W.__px.getImageData(de, pos, n, 1).data : W.__px.getImageData(pos, de, 1, n).data;
    for (var i = 1; i < n; i++) {
      var k = i * 4, j = k - 4, diff = Math.abs(d[k] - d[j]) + Math.abs(d[k + 1] - d[j + 1]) + Math.abs(d[k + 2] - d[j + 2]);
      if (diff > seuil) out.push((de + i) + ' rgb(' + d[k] + ',' + d[k + 1] + ',' + d[k + 2] + ')');
    }
    return JSON.stringify(out.slice(0, 60));
  };
  return 'verif ok';
})();
