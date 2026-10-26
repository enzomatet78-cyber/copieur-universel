/* capture-kit.js — kit de capture DOM du plugin copieur-universel (v2, généralisé depuis iClosed).
 * À injecter TEL QUEL (javascript_tool, ou cdp_eval.py eval --file) : renvoie « kit ok ».
 * Lecture seule : ne lit que le DOM ; __anonLive/__mask/__cover ne changent que l'affichage local
 * (recharger la page ensuite). Config, dictionnaire et source du kit : sessionStorage copieur-* (__forget).
 * Config : window.__KEEP = [...], window.__OWNER_EMAIL = '…' ou __config({keep, owner, raw, main, rows…}).
 * Réinjection courte : window.__dump ? 'kit ok' : (0, eval)(sessionStorage.getItem('copieur-kit') || "'kit absent'")
 * API et mode d'emploi : skills/capture-web/SKILL.md. Mode par défaut : échappements '§'→'(SECT)',
 * ';'→'§', '&'→'(AMP)', '?'→'(Q)' + morceaux de 900 caractères dans window.__D (à inverser à l'écriture).
 */
(function copieurKit() {
  'use strict';
  var VERSION = '2.2', W = window, D = document;
  var SEC = '\u00a7', BUL = '\u2022', ELL = '\u2026';

  /* ---------- utilitaires ---------- */
  function ssGet(k) { try { return W.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { W.sessionStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  function ssDel(k) { try { W.sessionStorage.removeItem(k); } catch (e) { /* idem */ } }
  function rx(src, fl, fb, ffl) { try { return new RegExp(src, fl); } catch (e) { return fb ? new RegExp(fb, ffl || 'g') : null; } }
  function h32(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function arr(x) { return Array.prototype.slice.call(x || []); }
  function clsOf(e) { return (e && e.getAttribute && e.getAttribute('class')) || ''; }
  function fold(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function esc(s) { return String(s).replace(/\u00a7/g, '(SECT)').replace(/;/g, SEC).replace(/&/g, '(AMP)').replace(/\?/g, '(Q)'); }
  function out(s) { return C.raw ? s : esc(s); }
  function area(e) { var r = e.getBoundingClientRect(); return Math.max(0, r.width) * Math.max(0, r.height); }
  function vis(e) {
    var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    var s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  }
  function desc(e) {
    if (!e || !e.tagName) return String(e);
    var id = e.id && /^[A-Za-z][\w-]{0,30}$/.test(e.id) ? '#' + e.id : '', c = clsOf(e).trim().split(/\s+/).slice(0, 4).join('.');
    return e.tagName.toLowerCase() + id + (c ? '.' + c : '');
  }

  var FIRST = ['Lucas', 'Emma', 'Hugo', 'Chlo\u00e9', 'Louis', 'L\u00e9a', 'Gabriel', 'Manon', 'Arthur', 'Camille', 'Jules', 'Sarah', 'Nathan', 'In\u00e8s', 'Th\u00e9o', 'Julie', 'Rapha\u00ebl', 'Clara', 'Paul', 'Zo\u00e9', 'Adam', 'Alice', 'Tom', 'Lina', 'Maxime', 'Ana\u00efs', 'Antoine', 'Pauline', 'Victor', 'Margaux'];
  var LAST = ['Martin', 'Bernard', 'Dubois', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Muller'];

  /* ---------- configuration ---------- */
  var DEF = { keep: [], owner: [], fakeDomain: 'exemple.com', raw: false, main: '', rows: 10, lists: 0, svgMax: 2500, iconPaths: false, dataAttrs: [], chunk: 900 };
  function cfg() {
    var c = {}, s = {}, k;
    try { s = JSON.parse(ssGet('copieur-kit-config') || '{}') || {}; } catch (e) { s = {}; }
    for (k in DEF) c[k] = s[k] !== undefined ? s[k] : DEF[k];
    if (W.__KEEP) c.keep = [].concat(W.__KEEP);
    if (W.__OWNER_EMAIL) c.owner = [].concat(W.__OWNER_EMAIL);
    if (typeof W.__RAW === 'boolean') c.raw = W.__RAW;
    if (W.__MAIN) c.main = W.__MAIN;
    if (W.__FAKE_DOMAIN) c.fakeDomain = W.__FAKE_DOMAIN;
    return c;
  }
  function saveCfg(c) { var o = {}; for (var k in DEF) o[k] = c[k]; ssSet('copieur-kit-config', JSON.stringify(o)); }

  /* ---------- dictionnaire d'anonymisation (persisté dans l'onglet) ---------- */
  var A = { m: {}, e: {}, p: {}, i: {} };
  try {
    var sa = JSON.parse(ssGet('copieur-anon') || 'null');
    if (sa && sa.m) A = { m: sa.m || {}, e: sa.e || {}, p: sa.p || {}, i: sa.i || {} };
  } catch (e) { /* dictionnaire neuf */ }
  if (W.__anonMap && typeof W.__anonMap === 'object') for (var k0 in W.__anonMap) if (!A.m[k0] && k0.indexOf('@') === -1 && k0.charAt(0) !== '+') A.m[k0] = W.__anonMap[k0];
  W.__anonMap = A.m;
  var FAKES = {}, DIRTY = false;
  function refreshFakes() { FAKES = {}; ['m', 'e', 'p', 'i'].forEach(function (t) { for (var k in A[t]) FAKES[A[t][k]] = 1; }); }
  refreshFakes();
  function saveAnon() { if (DIRTY) { ssSet('copieur-anon', JSON.stringify(A)); DIRTY = false; } }

  var C = cfg(), KEEPL = {}, KEEPINI = {}, OWN = {}, KEEP_RX = null, NAME_RX = null, NAME_SIG = '';
  function boundRx(alt, fl) { return rx('(?<![\\p{L}\\p{N}_])(?:' + alt + ')(?![\\p{L}\\p{N}_])', fl + 'u', alt, fl); }
  function prep() {
    C = cfg(); KEEPL = {}; KEEPINI = {}; OWN = {};
    var ks = [];
    C.keep.forEach(function (k) {
      k = String(k || '').replace(/\s+/g, ' ').trim(); if (!k) return;
      KEEPL[k.toLowerCase()] = 1; ks.push(k);
      if (k.indexOf('@') > 0) OWN[k.toLowerCase()] = 1;
      var p = k.split(' '); if (p.length > 1) KEEPINI[(p[0].charAt(0) + p[p.length - 1].charAt(0)).toUpperCase()] = 1;
    });
    [].concat(C.owner || []).forEach(function (e) { if (e) OWN[String(e).trim().toLowerCase()] = 1; });
    ks.sort(function (a, b) { return b.length - a.length; });
    KEEP_RX = ks.length ? boundRx(ks.map(reEsc).join('|'), 'gi') : null;
    var keys = Object.keys(A.m), sig = keys.length + '|' + ks.join('|');
    if (sig !== NAME_SIG) {
      keys = keys.filter(function (k) { return k.length > 2 && !KEEPL[k.toLowerCase()]; }).sort(function (a, b) { return b.length - a.length; });
      NAME_RX = keys.length ? boundRx(keys.map(reEsc).join('|'), 'g') : null;
      NAME_SIG = sig;
    }
  }

  /* ---------- détection et remplacement ---------- */
  var EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var ROLE = /^(support|contact|hello|hi|help|aide|info|infos|noreply|no-reply|ne-pas-repondre|sales|billing|facturation|team|equipe|admin|privacy|legal|security|press|presse|jobs|careers|recrutement|bonjour|service|compta|commercial|partners|partenaires|feedback|abuse|postmaster|webmaster|notifications?|newsletter|marketing|dpo|rgpd)$/i;
  var PHONE_INTL = rx('(?<![\\w+])\\+\\d[\\d \\u00a0\\u202f().-]{6,18}\\d(?!\\d)', 'g', '\\+\\d[\\d ().-]{6,18}\\d', 'g');
  var PHONE_FR = rx('(?<![\\d+])0[1-9](?:[ .\\u00a0\\u202f-]?\\d{2}){4}(?!\\d)', 'g', '\\b0[1-9](?:[ .-]?\\d{2}){4}\\b', 'g');
  var SECRETS = [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, /\bwhsec_[A-Za-z0-9]{8,}/g, /\bAKIA[0-9A-Z]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, /\bAIza[0-9A-Za-z_-]{30,}/g,
    /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
    /https?:\/\/hooks\.slack\.com\/services\/[\w\/-]+/g, /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[\w\/-]+/g];
  var IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
  var CARD = rx('(?<!\\d)(?:\\d[ -]?){12,18}\\d(?!\\d)', 'g', '\\b(?:\\d[ -]?){12,18}\\d\\b', 'g');
  var LONGTOK = rx('(?<![\\w-])[A-Za-z0-9_-]{32,}(?![\\w-])', 'g', '\\b[A-Za-z0-9_-]{32,}\\b', 'g');
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* affectation lisible d'un secret (sessionid=a1b2c3d4e5f6, csrftoken: ..., password=...) : seule la valeur est
     masquee, si elle melange chiffres et lettres ou fait 16 caracteres au moins (« Session : Printemps » reste) */
  var SECRET_KV = /\b((?:[a-z]*sess(?:ion)?[_-]?id|sid|token|(?:access|refresh|id|auth|csrf|xsrf)[_-]?token|api[_-]?key|client[_-]?secret|secret(?:[_-]?key)?|password|passwd|pwd)\s*[=:]\s*["']?)([A-Za-z0-9._~+\/%-]{6,}=*)/gi;

  function maskTok(s) {
    var p = (s.match(/^(?:[a-z]+_(?:live|test)_|[A-Za-z]+[_-]|https?:\/\/[^\/]+\/)/) || [s.slice(0, 4)])[0];
    return p + BUL.repeat(8) + s.slice(-4);
  }
  function luhn(d) { var s = 0, alt = false; for (var i = d.length - 1; i >= 0; i--) { var n = +d.charAt(i); if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; }
  function ibanOk(s) {
    s = s.replace(/ /g, ''); if (s.length < 15 || s.length > 34) return false;
    s = s.slice(4) + s.slice(0, 4); var r = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i), v = c >= 65 ? String(c - 55) : s.charAt(i); for (var j = 0; j < v.length; j++) r = (r * 10 + (+v.charAt(j))) % 97; }
    return r === 1;
  }
  /* media = chemin d'une image/vidéo : les longs hachages de CDN (Sanity, Contentful) n'y sont pas des secrets */
  function maskSecrets(t, media) {
    if (!t || t.length < 12) return t;
    for (var i = 0; i < SECRETS.length; i++) t = t.replace(SECRETS[i], maskTok);
    if (media) return t;
    t = t.replace(SECRET_KV, function (m, k, v) { return (/\d/.test(v) && /[a-z]/i.test(v)) || v.length >= 16 ? k + BUL.repeat(8) : m; });
    t = t.replace(IBAN, function (m) { return ibanOk(m) ? m.slice(0, 4) + ' ' + BUL.repeat(4) + ' ' + BUL.repeat(4) + ' ' + m.replace(/ /g, '').slice(-4) : m; });
    if (CARD) t = t.replace(CARD, function (m) { var d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d) ? BUL.repeat(4) + ' ' + BUL.repeat(4) + ' ' + BUL.repeat(4) + ' ' + d.slice(-4) : m; });
    if (LONGTOK) t = t.replace(LONGTOK, function (m) {
      var tok = (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m)) || /^[0-9a-f]{32,}$/i.test(m);
      return tok && !UUID.test(m) ? m.slice(0, 4) + BUL.repeat(8) + m.slice(-4) : m;
    });
    return t;
  }
  /* Email d'une personne deja anonymisee (partie locale qui contient son prenom ou son nom) : l'email fictif
     suit le faux nom (jean.dupont@ -> lucas.lambert@), sinon l'ecran montrerait deux identites differentes. */
  function emailFromName(loc, dom) {
    for (var r in A.m) {
      if (r.indexOf(' ') === -1) continue;
      var toks = fold(r).split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });
      if (!toks.some(function (t) { return loc.indexOf(t) !== -1; })) continue;
      var base = slug(A.m[r], '.'), f = base + '@' + dom;
      for (var k = 2; FAKES[f] && k < 50; k++) f = base + k + '@' + dom;
      return FAKES[f] ? '' : f;
    }
    return '';
  }
  function fakeEmail(e) {
    var low = e.toLowerCase(), dom = String(C.fakeDomain || 'exemple.com').toLowerCase();
    if (OWN[low] || FAKES[e] || low.slice(-dom.length - 1) === '@' + dom || ROLE.test(low.split('@')[0])) return e;
    if (A.e[low]) return A.e[low];
    var n = FIRST.length * LAST.length, s = h32(low), f = emailFromName(fold(low.split('@')[0]).replace(/[^a-z]/g, ''), dom);
    for (var k = 0; !f && k < n; k++) {
      var x = (s + k) % n, g = fold(FIRST[x % FIRST.length]) + '.' + fold(LAST[Math.floor(x / FIRST.length)]) + '@' + dom;
      if (!FAKES[g]) f = g;
    }
    A.e[low] = f; FAKES[f] = 1; DIRTY = true; return f;
  }

  /* Chemins locaux qui revelent le nom de session Windows/macOS (Electron : vscode-file://vscode-app/c:/Users/<nom>/...
     sous Windows, vscode-file://vscode-app/Users/<nom>/... sous macOS, messages d'erreur, chemins affiches)
     -> <dossier>/utilisateur. Masquees partout (texte, href/src, url() des styles) : lettre de lecteur, file://,
     schema non web (vscode-file://, app://...) colle a /Users/<nom>/, /Users/<nom>/ suivi d'un dossier personnel
     (Desktop, Documents, Library...) ou cache (.vscode). /Users/<nom>/ seul : masque dans le texte, et dans les URL
     d'une page locale (file:, vscode-file:...) ; pas dans les href/src d'une page web, ou /Users/Edit/5 est une route. */
  var UPATH_KEEP = /^(?:public|default|default user|all users|shared|guest|utilisateur|<utilisateur>|username|%username%|user)$/i;
  var UPATH_WIN = /([A-Za-z]:(?:\\{1,2}|\/)+(?:Users|Utilisateurs|Documents and Settings)(?:\\{1,2}|\/)+)([^\\\/\s"'<>|:*?]+)/gi;
  var UPATH_FILE = /(file:\/\/\/(?:Users|home)\/)([^\/\s"'<>]+)(?=\/)/g;
  var UPATH_SCHEME = /(\b(?!(?:https?|wss?|ftp):)[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\/\s"'<>?#]*\/Users\/)([^\/\s"'<>]+)(?=\/)/g;
  var UPATH_HOME = /(\/Users\/)([^\/\s"'<>]+)(?=\/(?:(?:Desktop|Documents|Downloads|Library|Pictures|Movies|Music|Applications|Public)(?![\w-])|\.[A-Za-z]))/g;
  var UPATH_MAC = /((?:^|[\s"'(=:,;[`])\/Users\/)([^\/\s"'<>]+)(?=\/)/g;
  function upRep(m, a, nom) { return UPATH_KEEP.test(nom) ? m : a + 'utilisateur'; }
  function upRepN(m, a, nom) { return /^\d+$/.test(nom) ? m : upRep(m, a, nom); }   /* /Users/42/ : identifiant de route */
  /* url = true : valeur d'attribut href/src (une route /Users/Edit/5 d'une appli web n'est pas un chemin local) */
  function userPath(t, url) {
    if (!t || !/users|home|utilisateurs|documents and settings/i.test(t)) return t;
    t = t.replace(UPATH_WIN, upRep).replace(UPATH_FILE, upRep).replace(UPATH_SCHEME, upRep).replace(UPATH_HOME, upRepN);
    return url && /^https?:$/.test(location.protocol) ? t : t.replace(UPATH_MAC, upRepN);
  }
  // Numéro français : remplacé dans la plage de fiction de l'ARCEP de sa zone (01 99 00, 02 61 91, 03 53 01,
  // 04 65 71, 05 36 49, 06 39 98 pour les mobiles), que scan_pii.py admet ; numéro nord-américain : 555-01xx ;
  // ailleurs, keepN chiffres gardés.
  var FR_FICTION = { 1: '19900', 2: '26191', 3: '35301', 4: '46571', 5: '53649', 6: '63998', 7: '63998' };
  function phoneRepl(keepN) {
    return function (m, off, str) {
      var digits = m.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15 || FAKES[m]) return m;
      if (/^[\s\u00a0\u202f]?[\u20ac$\u00a3%]/.test(str.slice(off + m.length, off + m.length + 2))) return m;
      if (A.p[m]) return A.p[m];
      var seed = h32(m), n = 0, f;
      var rnd = function () { seed = (Math.imul(seed ^ (seed >>> 13), 1274126177) + 0x6d2b79f5) >>> 0; return String(seed % 10); };
      var fr = /^(0|33|0033)([1-7])\d{8}$/.exec(digits), na = /^(1?)(\d{3})\d{7}$/.exec(digits), t = '', i = 0;
      if (fr) t = fr[1] + FR_FICTION[fr[2]] + rnd() + rnd() + rnd() + rnd();
      else if (na && (na[1] || /^\+?1?[\s.(-]*\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(m))) t = na[1] + na[2] + '55501' + rnd() + rnd();
      if (t) {
        f = m.replace(/\d/g, function () { return t[i++]; });
      } else {
        f = m.replace(/\d/g, function (d) { n++; return n <= keepN ? d : rnd(); });
      }
      if (f === m) f = f.slice(0, -1) + ((+f.slice(-1) + 1) % 10);
      A.p[m] = f; FAKES[f] = 1; DIRTY = true; return f;
    };
  }
  var PH3 = phoneRepl(3), PH2 = phoneRepl(2);

  /* adresses IP publiques (journaux de connexion, IP autorisees) -> plages de documentation (RFC 5737, RFC 3849) */
  var IPV4 = rx('(?<![\\w.:-])(?:\\d{1,3}\\.){3}\\d{1,3}(?![\\w-]|\\.\\d)', 'g', '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', 'g');
  var IPV6 = rx('(?<![\\w:.])(?:[0-9a-fA-F]{1,4}:){2,7}(?::|(?::[0-9a-fA-F]{1,4}){1,6}|[0-9a-fA-F]{1,4})(?![\\w:])', 'g');
  var IP_PUBLIC_OK = { '8.8.8.8': 1, '8.8.4.4': 1, '1.1.1.1': 1, '1.0.0.1': 1, '9.9.9.9': 1 };
  function ipFake(m, f) { A.p[m] = f; FAKES[f] = 1; DIRTY = true; return f; }
  function ip4Repl(m, off, str) {
    if (FAKES[m] || IP_PUBLIC_OK[m]) return m;
    var o = m.split('.').map(Number);
    if (o.some(function (x) { return x > 255; })) return m;
    if (o[0] === 0 || o[0] === 10 || o[0] === 127 || o[0] >= 224 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 169 && o[1] === 254)) return m;
    if ((o[0] === 192 && o[1] === 0 && o[2] === 2) || (o[0] === 198 && o[1] === 51 && o[2] === 100) || (o[0] === 203 && o[1] === 0 && o[2] === 113)) return m;
    if (/(?:version|build|ver\.?|v)\s*$/i.test(str.slice(Math.max(0, off - 12), off))) return m;
    if (A.p[m]) return A.p[m];
    var s = h32(m);
    return ipFake(m, ['192.0.2.', '198.51.100.', '203.0.113.'][s % 3] + (1 + (s >>> 8) % 254));
  }
  function ip6Repl(m) {
    if (FAKES[m] || !(m.indexOf('::') !== -1 || m.split(':').length > 5) || !/[a-f]|::/i.test(m)) return m;
    if (/^(?:fe[89ab]|f[cd]|2001:0?db8:)/i.test(m)) return m;
    if (A.p[m]) return A.p[m];
    return ipFake(m, '2001:db8::' + (h32(m) % 65535).toString(16));
  }

  function anonText(t) {
    if (!t || !/\S/.test(t)) return t;
    t = userPath(maskSecrets(t));
    if (t.indexOf('@') !== -1) t = t.replace(EMAIL_RX, fakeEmail);
    var kept = [];
    if (KEEP_RX) t = t.replace(KEEP_RX, function (m) { kept.push(m); return '\ue000' + (kept.length - 1) + '\ue001'; });
    if (NAME_RX) t = t.replace(NAME_RX, function (m) { return A.m[m] || m; });
    if (IPV4 && /\d\.\d/.test(t)) t = t.replace(IPV4, ip4Repl);
    if (IPV6 && t.indexOf(':') !== -1) t = t.replace(IPV6, ip6Repl);
    if (/\d\D?\d/.test(t)) { if (PHONE_INTL) t = t.replace(PHONE_INTL, PH3); if (PHONE_FR) t = t.replace(PHONE_FR, PH2); }
    var tt = t.trim();
    if (tt.length >= 2 && tt.length <= 3 && A.i[tt] && !FAKES[tt]) t = t.replace(tt, A.i[tt]);
    if (kept.length) t = t.replace(/\ue000(\d+)\ue001/g, function (_, i) { return kept[+i]; });
    return t;
  }

  function initials(n) { var p = n.split(' '); return (p[0].charAt(0) + p[p.length - 1].charAt(0)).toUpperCase(); }
  /* Les initiales fictives ne doivent jamais etre les initiales d'une personne reelle deja connue (et inversement) :
     sinon JD -> LL puis LL -> JD, et la surveillance de __anonLive tournerait en boucle. */
  function fakeName(real) {
    var full = / /.test(real), nF = FIRST.length, tot = full ? nF * LAST.length : nF, s = h32(real.toLowerCase());
    var toks = real.toLowerCase().split(' '), ri = full ? initials(real) : '';
    for (var k = 0; k < tot; k++) {
      var x = (s + k) % tot, f = full ? FIRST[x % nF] + ' ' + LAST[Math.floor(x / nF)] : FIRST[x];
      var share = f.toLowerCase().split(' ').some(function (w) { return toks.indexOf(w) !== -1; });
      if (full) { var fi = initials(f); if (fi === ri || A.i[fi] || KEEPINI[fi]) continue; }
      if (!share && !FAKES[f] && !A.m[f]) return f;
    }
    return (full ? 'Personne ' : 'Contact ') + (Object.keys(A.m).length + 1);
  }
  function slug(s, sep) { return fold(s).replace(/[^a-z0-9]+/g, sep).replace(/^[-.]+|[-.]+$/g, ''); }

  /* ---------- avatars ---------- */
  var AVATAR_RX = /gravatar\.com|googleusercontent\.com|licdn\.com|fbcdn\.net|pbs\.twimg\.com\/profile|avatar|profile[-_]?(?:pic|photo|image|img)|user[-_]?(?:photo|image|pic|img)|headshot|portrait/i;
  function keptAlt(img) { var a = (img.getAttribute('alt') || '').trim().toLowerCase(); return !!(a && KEEPL[a]); }
  function isAvatar(img) {
    var src = img.getAttribute('src') || '';
    if (!src || /logo|icon|brand|emoji|flag/i.test(src) || /\.svg(?:[?#]|$)/i.test(src) || /^data:image\/svg/i.test(src)) return false;
    var hint = src + ' ' + clsOf(img) + ' ' + (img.getAttribute('alt') || '') + ' ' + clsOf(img.parentElement);
    if (AVATAR_RX.test(hint)) return !keptAlt(img);
    var host = ''; try { host = new URL(src, location.href).host; } catch (e) { host = ''; }
    if (host && host !== location.host) {
      var r = img.getBoundingClientRect();
      if (r.width >= 16 && r.width <= 96 && Math.abs(r.width - r.height) < 3) {
        var br = getComputedStyle(img).borderTopLeftRadius;
        if (/%/.test(br) ? parseFloat(br) >= 40 : parseFloat(br) >= r.width / 2 - 1) return !keptAlt(img);
      }
    }
    return false;
  }

  /* ---------- anonymisation de l'affichage (pour les captures d'écran) ---------- */
  var SKIPT = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, BASE: 1 };
  var ANON_ATTRS = ['title', 'alt', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'label', 'data-tooltip', 'data-tip', 'data-title', 'data-original-title', 'data-content', 'data-tooltip-content', 'data-tippy-content'];
  var ANON_SET = {}; ANON_ATTRS.forEach(function (a) { ANON_SET[a] = 1; });
  /* MINE : derniere valeur ecrite par le kit dans chaque noeud. La surveillance ignore ses propres ecritures :
     aucune boucle possible, meme si deux remplacements se renvoient la balle. */
  var MINE = typeof WeakMap === 'function' ? new WeakMap() : null;
  /* Initiale d'avatar d'UNE lettre (« M » dans une pastille ronde) : remplacee seulement dans un contexte
     d'avatar (classe avatar/initial, ou pastille carree et ronde de 12 a 72 px), jamais dans le texte courant. */
  function avatarCtx(el) {
    for (var k = 0, e = el; k < 3 && e && e.nodeType === 1 && e !== D.body; k++, e = e.parentElement) {
      if (/avatar|initial|monogram|persona/i.test(clsOf(e) + ' ' + (e.getAttribute('data-testid') || ''))) return true;
      var r = e.getBoundingClientRect();
      if (r.width >= 12 && r.width <= 72 && Math.abs(r.width - r.height) < 3) {
        var br = getComputedStyle(e).borderTopLeftRadius;
        if (/%/.test(br) ? parseFloat(br) >= 40 : parseFloat(br) >= r.width / 2 - 1) return true;
      }
    }
    return false;
  }
  function initial1(v, el) {
    var tt = v.trim();
    if (tt.length !== 1 || !A.i[tt] || !el || !avatarCtx(el)) return v;
    return v.replace(tt, A.i[tt]);
  }
  function liveText(n, st) {
    var p = n.parentNode; if (p && p.nodeType === 1 && (SKIPT[p.tagName] || p.isContentEditable)) return;
    var v = n.nodeValue; if (MINE && MINE.get(n) === v) return;
    var t = anonText(v); if (t === v) t = initial1(v, p);
    if (t !== v) { n.nodeValue = t; if (MINE) MINE.set(n, t); st.t++; }
  }
  function setAttrOnce(el, a, v, st) {
    var t = anonText(v); if (t === v) return;
    var m = MINE && MINE.get(el); if (m && m[a] === v) return;
    el.setAttribute(a, t); if (MINE) { if (!m) { m = {}; MINE.set(el, m); } m[a] = t; } st.a++;
  }
  function liveAttrs(el, st) {
    for (var i = 0; i < ANON_ATTRS.length; i++) { var a = ANON_ATTRS[i], v = el.getAttribute(a); if (v) setAttrOnce(el, a, v, st); }
    var tag = el.tagName;
    if (tag === 'A') { var h = el.getAttribute('href'); if (h && /^(?:mailto|tel|sms):/i.test(h)) setAttrOnce(el, 'href', h, st); }
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && !/^(?:password|hidden|file|checkbox|radio)$/i.test(el.type || '')) {
      var v2 = el.value;
      if (v2) {
        var t2 = anonText(v2);
        /* champ qui a le focus : une appli peut enregistrer sa valeur a la perte du focus -> on n'y touche pas */
        if (t2 !== v2) { if (el === D.activeElement && !el.readOnly && !el.disabled) st.foc++; else { el.value = t2; st.c++; } }
      }
    }
    if (!el.__cuBlur) {
      var sa = tag === 'IMG' ? '' : el.getAttribute('style');
      if ((tag === 'IMG' && isAvatar(el)) || (sa && /url\(/i.test(sa) && AVATAR_RX.test(sa))) { el.style.filter = 'blur(6px)'; el.__cuBlur = 1; st.img++; }
    }
  }
  function liveTree(root, st) {
    if (root.nodeType === 3) { liveText(root, st); return; }
    if (root.nodeType === 1) {
      if (SKIPT[root.tagName] || root.classList.contains('copieur-cover')) return;
      if (root.isContentEditable) { st.ce++; return; }
      liveAttrs(root, st);
      if (root.shadowRoot) { liveTree(root.shadowRoot, st); observe(root.shadowRoot); }
    }
    var filter = { acceptNode: function (x) {
      if (x.nodeType !== 1) return 1;
      if (x.isContentEditable) { if (!(x.parentElement && x.parentElement.isContentEditable)) st.ce++; return 2; }
      return SKIPT[x.tagName] || x.classList.contains('copieur-cover') ? 2 : 1;
    } };
    var w = D.createTreeWalker(root, 5, filter), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) liveText(n, st);
      else { liveAttrs(n, st); if (n.shadowRoot) { liveTree(n.shadowRoot, st); observe(n.shadowRoot); } }
    }
  }
  var OBS = null, hadObs = false;
  if (W.__copieurObs) { try { W.__copieurObs.disconnect(); } catch (e) { /* d\u00e9j\u00e0 arr\u00eat\u00e9 */ } W.__copieurObs = null; hadObs = true; }
  function obsCb(muts) {
    var st = { t: 0, a: 0, c: 0, img: 0, ce: 0, foc: 0 };
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') liveText(m.target, st);
      else if (m.type === 'attributes') { if (m.target.nodeType === 1 && !m.target.isContentEditable) liveAttrs(m.target, st); }
      else for (var j = 0; j < m.addedNodes.length; j++) liveTree(m.addedNodes[j], st);
    }
    saveAnon();
  }
  function observe(target) {
    if (OBS) OBS.observe(target, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ANON_ATTRS.concat(['href', 'src']) });
  }
  function watch() { if (OBS) return; OBS = new MutationObserver(obsCb); W.__copieurObs = OBS; observe(D.body); }

  /* ---------- zones de la page ---------- */
  function scrollable(e) {
    if (!e || e.scrollHeight <= e.clientHeight + 4) return false;
    if (e === D.scrollingElement) return true;
    var oy = getComputedStyle(e).overflowY; return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }
  function bigScroller(root) {
    var best = null, ba = 0, lim = innerWidth * innerHeight * 0.25, els = root.getElementsByTagName('*');
    for (var i = 0; i < els.length && i < 6000; i++) {
      var e = els[i];
      if (e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 100) { var a = area(e); if (a > ba && a > lim && scrollable(e)) { best = e; ba = a; } }
    }
    return best;
  }
  function mainEl() {
    if (C.main) { try { var q = D.querySelector(C.main); if (q) return q; } catch (e) { /* s\u00e9lecteur invalide */ } }
    var ms = arr(D.querySelectorAll('main,[role=main]')), s = ms.filter(scrollable)[0];
    if (s) return s;
    if (ms.length) return ms.sort(function (a, b) { return area(b) - area(a); })[0];
    return bigScroller(D.body) || D.body;
  }
  function scroller() { var m = mainEl(); if (scrollable(m)) return m; return bigScroller(m) || D.scrollingElement || D.documentElement; }
  var OVL = '[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open],[role=menu],[role=listbox],[role=tooltip],[data-radix-popper-content-wrapper],.ReactModal__Content,.MuiDialog-root,.MuiPopover-root,.ant-modal-wrap,.ant-dropdown,.ant-popover,.ant-tooltip,.tippy-box,.rc-tooltip,.modal.show,.dropdown-menu.show,.popover.show';
  function overlayEls() {
    var all = arr(D.querySelectorAll(OVL)).filter(vis);
    return all.filter(function (e) { return !all.some(function (o) { return o !== e && o.contains(e); }); });
  }
  function isDialog(e) {
    var r = e.getAttribute('role') || '';
    return r === 'dialog' || r === 'alertdialog' || e.getAttribute('aria-modal') === 'true' || e.tagName === 'DIALOG' || /dialog|modal/i.test(clsOf(e));
  }
  function modalEl() {
    var ds = overlayEls().filter(isDialog); if (!ds.length) return null;
    var cur = ds[ds.length - 1], main = mainEl();
    while (cur.parentElement && cur.parentElement !== D.body && cur.parentElement !== D.documentElement && !cur.parentElement.contains(main)) cur = cur.parentElement;
    return cur;
  }
  function resolve(r) {
    if (r === undefined || r === null || r === '' || r === 'main') return mainEl();
    if (r === 'body') return D.body;
    if (r === 'modal' || r === 'modale' || r === 'dialog') return modalEl();
    if (typeof r === 'number') return (W.__O || [])[r] || null;
    if (typeof r === 'string') { try { return D.querySelector(r); } catch (e) { return null; } }
    return r && r.nodeType ? r : null;
  }
  function notFound(r) { return (r === 'modal' || r === 'modale' || r === 'dialog') ? 'aucune modale ouverte' : 'racine introuvable : ' + r; }

  /* ---------- sérialisation du DOM (nettoyée, anonymisée) ---------- */
  var MEDIA = { IMG: 1, SOURCE: 1, VIDEO: 1, AUDIO: 1, TRACK: 1, IMAGE: 1 };
  var VOID = { AREA: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1, SOURCE: 1, TRACK: 1, WBR: 1 };
  var DROP = {};
  ('for tabindex aria-controls aria-labelledby aria-owns aria-activedescendant aria-errormessage aria-details name autocomplete nonce integrity crossorigin referrerpolicy sizes decoding fetchpriority ping spellcheck autocorrect autocapitalize jsaction jscontroller jsname jsmodel checked selected').split(' ').forEach(function (a) { DROP[a] = 1; });
  var KEEP_DATA = ' data-state data-orientation data-headlessui-state data-side data-align data-disabled data-selected data-active data-highlighted data-checked data-open data-placeholder data-slot data-variant data-size data-theme data-mode data-collapsed data-expanded data-sidebar data-collapsible data-position data-motion data-swipe data-panel-group-direction data-color-scheme data-status ';
  var SENS_Q = /^(?:token|access_token|refresh_token|id_token|auth|authorization|key|api_?key|secret|client_secret|signature|sig|code|password|pwd|pass|session|sessionid|sid|jwt|otp|ticket|nonce|state|hash|email|mail|phone|tel)$/i;
  function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escText(v) { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;').replace(/\u202f/g, '&#8239;'); }
  function dec(s) { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } }
  function cleanUrl(v, media) {
    if (!v) return v;
    v = String(v).trim();
    if (/^data:/i.test(v)) return v.slice(0, 30) + ELL + '[DATAURI]';
    if (/^blob:/i.test(v)) return 'blob:' + ELL;
    if (/^javascript:/i.test(v)) return 'javascript:' + ELL;
    if (/^(?:mailto|tel|sms):/i.test(v)) return anonText(v.split('?')[0]);
    var hi = v.indexOf('#'), hash = hi === -1 ? '' : v.slice(hi), base = hi === -1 ? v : v.slice(0, hi), qi = base.indexOf('?'), q = '';
    if (qi !== -1) {
      q = '?' + base.slice(qi + 1).split('&').map(function (p) {
        var eq = p.indexOf('='); if (eq === -1) return p;
        var k = p.slice(0, eq), val = p.slice(eq + 1);
        if (SENS_Q.test(dec(k))) return k + '=' + BUL + BUL + BUL;
        var dv = dec(val), av = anonText(dv);
        return k + '=' + (av !== dv ? encodeURIComponent(av) : maskSecrets(val));
      }).join('&');
      base = base.slice(0, qi);
    }
    base = userPath(base.replace(EMAIL_RX, fakeEmail), true);
    if (NAME_RX) base = base.replace(NAME_RX, function (m) { return A.m[m] || m; });
    return maskSecrets(base, media) + q + maskSecrets(hash);
  }
  function cleanStyle(v) {
    v = v.replace(/url\((['"]?)data:[^)]{40,}\)/gi, 'url($1data:' + ELL + ')');
    v = v.replace(/url\((['"]?)([^)'"]*)\1\)/gi, function (m, q, u) { return AVATAR_RX.test(u) ? 'url([AVATAR])' : 'url(' + q + cleanUrl(u, true) + q + ')'; });
    return v.length > 600 ? v.slice(0, 600) + ELL : v;
  }
  function attrs(n, inSvg, isRoot) {
    var o = '', at = n.attributes, tag = n.tagName.toUpperCase();
    for (var i = 0; i < at.length; i++) {
      var nm = at[i].name, ln = nm.toLowerCase(), v = at[i].value;
      if (DROP[ln] || ln.slice(0, 2) === 'on') continue;
      /* infobulles : data-tip*, data-tooltip* (texte ou id d'un <template>) gardes, textes anonymises */
      if (ln.slice(0, 5) === 'data-' && KEEP_DATA.indexOf(' ' + ln + ' ') === -1 && C.dataAttrs.indexOf(ln) === -1 && !ANON_SET[ln] && !/^data-(?:tip|tooltip|tippy)/.test(ln)) continue;
      /* aria-describedby : lien element -> infobulle, garde seulement s'il vise des id lisibles (pas des id generes) */
      if (ln === 'aria-describedby' && !v.trim().split(/\s+/).every(function (x) { return /^[A-Za-z][\w-]{1,40}$/.test(x) && !/^(?:radix|headlessui|react-aria|mui|rc-|tippy|_)/i.test(x) && !/\d{3,}/.test(x); })) continue;
      if (inSvg && (ln === 'xmlns' || ln.slice(0, 6) === 'xmlns:' || ln === 'aria-hidden' || ln === 'focusable' || ln === 'version' || ln === 'role')) continue;
      if (ln === 'id' && (inSvg ? isRoot : !/^[A-Za-z][A-Za-z_-]{1,30}$/.test(v))) continue;
      if (ln === 'value' && (tag === 'INPUT' || tag === 'TEXTAREA')) continue;
      if (ln === 'srcset') v = cleanUrl(v.trim().split(/\s+/)[0], true);
      else if (ln === 'poster' || (ln === 'src' && MEDIA[tag])) v = cleanUrl(v, true);
      else if (ln === 'src' || ln === 'href' || ln === 'xlink:href' || ln === 'poster' || ln === 'action' || ln === 'data' || ln === 'formaction') v = cleanUrl(v);
      else if (ln === 'style') v = cleanStyle(v);
      else if (inSvg && (ln === 'd' || ln === 'points' || ln === 'transform')) v = v.replace(/\s+/g, ' ').trim();
      else if (ANON_SET[ln] || ln === 'value') v = anonText(v);
      o += ' ' + nm + '="' + escAttr(v) + '"';
    }
    return o;
  }
  function iconInfo(s) {
    var c = clsOf(s), m;
    if ((m = c.match(/(?:^|\s)(?:tabler-icon|icon-tabler)-([\w-]+)/))) return { lib: 'tabler', name: m[1] };
    if ((m = c.match(/(?:^|\s)lucide-([\w-]+)/)) && m[1] !== 'icon') return { lib: 'lucide', name: m[1] };
    if ((m = c.match(/(?:^|\s)feather-([\w-]+)/))) return { lib: 'feather', name: m[1] };
    var di = s.getAttribute('data-icon');
    if (di && s.getAttribute('data-prefix')) return { lib: 'fontawesome', name: s.getAttribute('data-prefix') + '-' + di };
    if (di) return { lib: 'iconify', name: di };
    var u = s.firstElementChild;
    if (u && s.children.length === 1 && u.tagName.toLowerCase() === 'use') {
      var hr = u.getAttribute('href') || u.getAttribute('xlink:href') || '', hm = hr.match(/#(.+)$/);
      if (hm) return { lib: 'sprite', name: hm[1], file: hr.split('#')[0] };
    }
    var vb = s.getAttribute('viewBox'), fill = s.getAttribute('fill'), hid = s.getAttribute('aria-hidden') === 'true';
    var v = vb === '0 0 20 20' ? 'mini' : vb === '0 0 16 16' ? 'micro' : fill === 'none' ? 'outline' : 'solid';
    if (s.getAttribute('data-slot') === 'icon') return { lib: 'heroicons', variant: v };
    if (hid && vb === '0 0 24 24' && fill === 'none' && s.getAttribute('stroke') === 'currentColor' && s.getAttribute('stroke-width') === '1.5') return { lib: 'heroicons', variant: 'outline' };
    if (hid && (vb === '0 0 20 20' || vb === '0 0 24 24') && fill === 'currentColor' && !s.getAttribute('stroke')) return { lib: 'heroicons?', variant: v };
    return null;
  }
  var ICON_CLS = /^(?:tabler-icon(?:-[\w-]+)?|icon-tabler(?:-[\w-]+)?|icon|lucide(?:-[\w-]+)?|feather(?:-[\w-]+)?|svg-inline--fa|fa-[\w-]+|iconify(?:--[\w-]+)?)$/;
  function shortAttrs(s) {
    var o = '', c = clsOf(s).split(/\s+/).filter(function (x) { return x && !ICON_CLS.test(x); }).join(' ');
    if (c) o += ' class="' + escAttr(c) + '"';
    ['width', 'height', 'stroke-width', 'stroke', 'fill', 'style'].forEach(function (a) {
      var v = s.getAttribute(a); if (v !== null && v !== '') o += ' ' + a + '="' + escAttr(a === 'style' ? cleanStyle(v) : v) + '"';
    });
    var vb = s.getAttribute('viewBox'); if (vb && vb !== '0 0 24 24') o += ' viewBox="' + escAttr(vb) + '"';
    return o;
  }
  function svgCtx(ctx) { return { rows: ctx.rows, lists: ctx.lists, svg: true, pre: false }; }
  function svgOut(s, ctx) {
    var info = iconInfo(s);
    if (info && info.name && !C.iconPaths) return '<svg icon="' + info.lib + ':' + escAttr(info.name) + '"' + shortAttrs(s) + '/>';
    var h = '<svg' + (info ? ' icon="' + info.lib + ':' + escAttr(info.name || info.variant) + '"' : '') + attrs(s, true, true) + '>' + kids(s, svgCtx(ctx)) + '</svg>';
    if (h.length <= C.svgMax) return h;
    var r = s.getBoundingClientRect(), k = '';
    ['class', 'width', 'height', 'viewBox', 'style'].forEach(function (a) { var v = s.getAttribute(a); if (v) k += ' ' + a + '="' + escAttr(v) + '"'; });
    return '<svg' + k + '><!--SVG complexe : ' + h.length + ' caract\u00e8res, ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' px, d\u00e9tail avec __chart()--></svg>';
  }
  function txt(n, ctx) {
    var v = n.nodeValue; if (!v) return '';
    if (!/[^ \t\n\r\f]/.test(v)) return ctx.svg ? '' : (ctx.pre ? v : ' ');
    var pre = ctx.pre;
    if (!pre && v.indexOf('\n') !== -1 && n.parentElement) pre = /pre|break-spaces/.test(getComputedStyle(n.parentElement).whiteSpace);
    var v0 = v; v = anonText(v); if (v === v0) v = initial1(v, n.parentElement);
    if (!pre) v = v.replace(/[ \t\n\r\f]+/g, ' ');
    return escText(v);
  }
  function kids(p, ctx) { var s = '', c = p.childNodes; for (var i = 0; i < c.length; i++) s += ser(c[i], ctx); return s; }
  function sig(e) { return e.tagName + '|' + clsOf(e); }
  function kidsLim(el, ctx) {
    var rowG = el.tagName === 'TBODY' || el.getAttribute('role') === 'rowgroup', lim = 0, isRow = null;
    if (rowG && ctx.rows < Infinity) {
      lim = ctx.rows; isRow = function (c) { return el.tagName === 'TBODY' || c.getAttribute('role') === 'row'; };
    } else if (ctx.lists > 0 && el.children.length > ctx.lists) {
      var s0 = sig(el.children[0]), same = 0;
      for (var k = 0; k < el.children.length; k++) if (sig(el.children[k]) === s0) same++;
      if (same >= el.children.length * 0.8) { lim = ctx.lists; isRow = function (c) { return sig(c) === s0; }; }
    }
    if (!isRow) return kids(el, ctx);
    var s = '', seen = 0, skip = 0, c = el.childNodes;
    for (var i = 0; i < c.length; i++) {
      var n = c[i];
      if (n.nodeType === 1 && isRow(n)) { if (++seen > lim) { skip++; continue; } } else if (seen > lim && n.nodeType === 3) continue;
      s += ser(n, ctx);
    }
    if (skip) s += '<!-- +' + skip + ' ' + (rowG ? 'lignes' : '\u00e9l\u00e9ments') + ' non captur\u00e9s -->';
    return s;
  }
  function ser(n, ctx) {
    var t = n.nodeType;
    if (t === 3) return txt(n, ctx);
    if (t === 11) return kids(n, ctx);
    if (t !== 1) return '';
    var up = n.tagName.toUpperCase(), cls = clsOf(n);
    /* <template id="..."> : contenu inerte souvent utile (texte d'infobulle, ligne de tableau type) -> garde */
    if (up === 'TEMPLATE' && !ctx.svg) {
      var tid = n.getAttribute('id') || '';
      if (!n.content || !/^[A-Za-z][\w-]{0,60}$/.test(tid)) return '';
      return '<template id="' + escAttr(tid) + '">' + kids(n.content, ctx) + '</template>';
    }
    if ((SKIPT[up] && !(ctx.svg && up === 'STYLE')) || /(?:^|\s)copieur-cover(?:\s|$)/.test(cls)) return '';
    var tag = ctx.svg ? n.tagName : n.tagName.toLowerCase();
    if (up === 'INPUT' && /^hidden$/i.test(n.type || '')) return '';
    if (up === 'SVG' && !ctx.svg) return svgOut(n, ctx);
    if (up === 'IFRAME' || up === 'CANVAS' || up === 'OBJECT' || up === 'EMBED') {
      /* l'URL garde sa requete (options d'integration : seo=false, fitStrategy=cover...) ; les parametres sensibles
         sont masques par cleanUrl, comme pour les liens */
      var r = n.getBoundingClientRect(), src = up === 'CANVAS' ? '' : cleanUrl(n.getAttribute('src') || n.getAttribute('data') || '').replace(/-->/g, '- ->').slice(0, 300) + ' ';
      return '<!--' + up + ' ' + src + Math.round(r.width) + 'x' + Math.round(r.height) + (cls ? ' class="' + cls + '"' : '') + (up === 'CANVAS' ? ' (dessin : voir __chart)' : '') + '-->';
    }
    if (/wistia|w-chrome|w-bottom-bar|w-vulcan/i.test(cls) || up.indexOf('WISTIA') === 0) {
      var wid = (cls.match(/wistia_async_(\w+)/) || [])[1] || n.getAttribute('media-id') || '';
      return '<!--WISTIA ' + wid + '-->';
    }
    var pre = ctx.pre || up === 'PRE' || /(?:^|\s|:)whitespace-pre/.test(cls), inSvg = ctx.svg && up !== 'FOREIGNOBJECT', c2 = ctx;
    if (!!pre !== !!ctx.pre || inSvg !== ctx.svg) c2 = { rows: ctx.rows, lists: ctx.lists, svg: inSvg, pre: pre };
    var a = attrs(n, ctx.svg, false);
    if (up === 'IMG' && isAvatar(n)) a = a.replace(/ src="[^"]*"/, ' src="[AVATAR]"').replace(/ srcset="[^"]*"/, '');
    if (up === 'INPUT') {
      var ty = String(n.type || '').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') { if (n.checked) a += ' checked'; }
      else if (ty !== 'password' && ty !== 'file' && n.value) a += ' value="' + escAttr(anonText(n.value)) + '"';
    }
    if (up === 'OPTION' && n.selected) a += ' selected';
    if (VOID[up]) return '<' + tag + a + '>';
    if (up === 'TEXTAREA') return '<textarea' + a + '>' + escText(anonText(n.value || '')) + '</textarea>';
    var inner = n.shadowRoot ? '<template shadowrootmode="open">' + kids(n.shadowRoot, c2) + '</template>' : '';
    inner += kidsLim(n, c2);
    if (ctx.svg && !inner) return '<' + tag + a + '/>';
    return '<' + tag + a + '>' + inner + '</' + tag + '>';
  }
  function html(root, rows, o) {
    prep(); var el = resolve(root); if (!el) return null;
    o = o || {};
    var r = ser(el, { rows: typeof rows === 'number' ? rows : C.rows, lists: o.lists !== undefined ? o.lists : C.lists, svg: false, pre: false });
    saveAnon(); return r;
  }
  function dumpText(s, size) {
    prep(); s = s === null || s === undefined ? '' : String(s); W.__H = s;
    if (C.raw) { W.__D = [s]; return s; }
    var e = esc(s), n = size || C.chunk || 900, o = [];
    for (var i = 0; i < e.length; i += n) o.push(e.slice(i, i + n));
    W.__D = o; return o.length;
  }

  /* ---------- styles : règles personnalisées + palette calculée ---------- */
  var TWCOL = '(?:inherit|current|transparent|black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))(?:/\\d{1,3})?';
  var TWNUM = '(?:px|\\d{1,3}(?:\\.5)?|auto|full|screen|min|max|fit|svh|lvh|dvh|svw|lvw|dvw|\\d{1,2}/\\d{1,2}|xs|sm|md|lg|xl|[2-7]xl|prose|none|screen-(?:sm|md|lg|xl|2xl))';
  var TW = [new RegExp('^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|outline|from|via|to|fill|stroke|accent|caret|decoration|placeholder|shadow)-' + TWCOL + '$'),
    new RegExp('^(?:[mp][xytrblse]?|space-[xy]|gap(?:-[xy])?|inset(?:-[xy])?|top|right|bottom|left|start|end|translate-[xy]|scroll-[mp][xytrblse]?|w|h|min-w|min-h|max-w|max-h|size|basis|indent)-' + TWNUM + '$'),
    /^(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty)|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)|leading-(?:none|tight|snug|normal|relaxed|loose|\d{1,2})|tracking-(?:tighter|tight|normal|wide|wider|widest))$/,
    /^(?:rounded(?:-[trblse]{1,2})?(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?|shadow(?:-(?:sm|md|lg|xl|2xl|inner|none))?|border(?:-[xytrblse])?(?:-[0248])?|border-(?:solid|dashed|dotted|double|hidden|none|collapse|separate)|ring(?:-[0-8]|-inset)?|ring-offset-[0-8]|outline(?:-(?:none|dashed|dotted|double|[0-8]|offset-[0-8]))?|divide-[xy](?:-[0-8]|-reverse)?|divide-(?:solid|dashed|dotted|double|none)|opacity-\d{1,3}|z-(?:\d{1,2}|auto)|order-(?:\d{1,2}|first|last|none)|(?:col|row)-(?:span-(?:\d{1,2}|full)|start-\d{1,2}|end-\d{1,2}|auto)|grid-(?:cols|rows)-(?:\d{1,2}|none|subgrid)|(?:duration|delay)-\d+|ease-(?:linear|in|out|in-out)|animate-(?:none|spin|ping|pulse|bounce)|scale(?:-[xy])?-\d+|rotate-\d+|skew-[xy]-\d+|blur(?:-(?:none|sm|md|lg|xl|2xl|3xl))?|line-clamp-(?:\d|none)|aspect-(?:auto|square|video)|columns-\d+|bg-gradient-to-(?:tr?|r|br?|bl|l|tl)|bg-(?:fixed|local|scroll|clip-[\w-]+|origin-[\w-]+|bottom|center|left(?:-bottom|-top)?|right(?:-bottom|-top)?|top|repeat(?:-[xy]|-round|-space)?|no-repeat|auto|cover|contain|none)|stroke-[0-2]|object-(?:contain|cover|fill|none|scale-down|center|top|bottom|left|right)|origin-[\w-]+|cursor-[\w-]+|select-(?:none|text|all|auto)|pointer-events-(?:none|auto)|whitespace-[\w-]+|break-(?:normal|words|all|keep)|overflow(?:-[xy])?-(?:auto|hidden|clip|visible|scroll)|overscroll(?:-[xy])?-(?:auto|contain|none)|(?:items|justify|content|self|place-content|place-items|place-self|justify-items|justify-self)-(?:start|end|center|between|around|evenly|stretch|baseline|auto|normal|left|right)|flex-(?:row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none|shrink|shrink-0|grow|grow-0)|(?:grow|shrink)(?:-0)?|auto-(?:cols|rows)-(?:auto|min|max|fr)|grid-flow-[\w-]+|list-(?:none|disc|decimal|inside|outside)|decoration-(?:solid|double|dotted|dashed|wavy|auto|from-font|[0-8])|underline-offset-\w+|align-[\w-]+|float-\w+|clear-\w+|box-(?:border|content)|table-(?:auto|fixed)|transition(?:-(?:all|colors|opacity|shadow|transform|none))?|will-change-\w+|appearance-none|resize(?:-[xy]|-none)?|snap-[\w-]+|touch-[\w-]+|(?:mix|bg)-blend-[\w-]+|backdrop-[\w-]+|(?:brightness|contrast|saturate|hue-rotate|grayscale|invert|sepia)(?:-\d+)?|drop-shadow(?:-\w+)?|(?:fill|stroke)-none|form-(?:input|textarea|select|multiselect|checkbox|radio)|(?:inline-)?(?:flex|grid|block|table)|table-(?:row|cell|caption|column|row-group|header-group|footer-group|column-group)|inline|hidden|contents|flow-root|list-item|static|fixed|absolute|relative|sticky|visible|invisible|collapse|truncate|(?:not-)?italic|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|(?:subpixel-)?antialiased|(?:not-)?sr-only|container|isolate|isolation-auto|transform(?:-gpu|-none)?|filter|group|peer|prose(?:-[\w-]+)?|ordinal|slashed-zero|tabular-nums|lining-nums|oldstyle-nums|proportional-nums|diagonal-fractions|stacked-fractions|space-[xy]-reverse|dark)$/];
  function isTw(c) {
    var d = 0, cut = -1;
    for (var i = 0; i < c.length; i++) { var ch = c.charAt(i); if (ch === '[') d++; else if (ch === ']') d--; else if (ch === ':' && d === 0) cut = i; }
    var b = c.slice(cut + 1).replace(/^!|!$/g, '').replace(/^-/, '');
    if (/^(?:group|peer)\/[\w-]+$/.test(b) || /\[.*\]/.test(b)) return true;
    for (var k = 0; k < TW.length; k++) if (TW[k].test(b)) return true;
    return false;
  }
  var COLCLS = /^(bg|text|border(?:-[xytrblse])?|fill|stroke|outline|decoration|accent|caret)-(.+)$/;
  var NONCOL = {
    bg: /^(?:fixed|local|scroll|clip-.*|origin-.*|bottom|center|left.*|right.*|top|repeat.*|no-repeat|auto|cover|contain|none|gradient-.*|blend-.*|opacity-.*|\[url.*)$/,
    text: /^(?:xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|ellipsis|clip|balance|pretty|opacity-.*|\[\d[\d.]*(?:px|rem|em|%)\])$/,
    border: /^(?:\d|[xytrblse](?:-\d)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*|opacity-.*|\[\d[\d.]*px\])$/,
    outline: /^(?:none|dashed|dotted|double|\d|offset-.*)$/, stroke: /^(?:\d|none)$/, fill: /^none$/,
    decoration: /^(?:solid|double|dotted|dashed|wavy|auto|from-font|\d|clone|slice)$/, accent: /^auto$/, caret: /^auto$/
  };
  var COLPROP = { bg: 'backgroundColor', text: 'color', fill: 'fill', stroke: 'stroke', outline: 'outlineColor', decoration: 'textDecorationColor', accent: 'accentColor', caret: 'caretColor', 'border-b': 'borderBottomColor', 'border-l': 'borderLeftColor', 'border-r': 'borderRightColor', 'border-x': 'borderLeftColor', 'border-s': 'borderLeftColor', 'border-e': 'borderRightColor' };
  function topK(o, n) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n).map(function (k) { return k + ' x' + o[k]; }).join(' | '); }
  function sty(e) {
    var s = getComputedStyle(e), p = ['color ' + s.color];
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') p.push('fond ' + s.backgroundColor);
    if (s.backgroundImage !== 'none') p.push('image ' + s.backgroundImage.slice(0, 160));
    p.push(s.fontFamily.split(',')[0].replace(/"/g, '') + ' ' + s.fontSize + '/' + s.lineHeight + ' ' + s.fontWeight);
    if (parseFloat(s.borderTopWidth)) p.push('bordure ' + s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor);
    if (parseFloat(s.borderTopLeftRadius)) p.push('rayon ' + s.borderTopLeftRadius);
    if (s.boxShadow !== 'none') p.push('ombre ' + s.boxShadow.slice(0, 120));
    return p.join(' | ');
  }
  function styles(root, o) {
    prep(); o = o || {};
    var r = resolve(root || 'body'); if (!r) return notFound(root);
    /* max : 0 = pas de limite (defaut en mode raw, ou cdp_eval ecrit le fichier entier) ; 60000 sinon */
    var max = o.max !== undefined ? o.max : (C.raw ? 0 : 60000), used = {}, custom = {}, nC = 0;
    var maxVars = o.maxVars || (C.raw ? 4000 : 300);
    [r].concat(arr(r.querySelectorAll('[class]'))).forEach(function (e) { clsOf(e).split(/\s+/).forEach(function (c) { if (c) used[c] = (used[c] || 0) + 1; }); });
    Object.keys(used).forEach(function (c) { if (o.all || !isTw(c)) { custom[c] = 1; nC++; } });
    var rules = [], kf = {}, ffs = [], vars = [], varSeen = {}, blocked = [], hit = {}, idRules = [];
    /* Ancetres du conteneur principal : leurs variables CSS (theme VS Code --vscode-* sur .monaco-workbench,
       variables d'un conteneur d'appli) sont celles que voit toute la page. */
    var chain = []; for (var ce = mainEl(); ce && ce.nodeType === 1; ce = ce.parentElement) chain.push(ce);
    if (chain.indexOf(r) === -1 && r !== D.body) chain.push(r);
    var ELEM_SEL = /^(?::root|html|:host|body|\*|\*::?before|\*::?after|::?before|::?after|::selection|::-webkit-scrollbar(?:-[\w-]+)?|::placeholder)$/i;
    function head(rule) {
      if (rule.media && rule.type === 4) return '@media ' + rule.media.mediaText;
      if (rule.type === 12) return '@supports ' + rule.conditionText;
      var t = rule.cssText, b = t.indexOf('{'); return b > 0 ? t.slice(0, b).trim() : '@groupe';
    }
    function wrap(ctx, t) { return ctx.length ? ctx.join(' { ') + ' { ' + t + new Array(ctx.length + 1).join(' }') : t; }
    function onlyTw(st) { for (var q = 0; q < st.length; q++) if (st[q].indexOf('--tw-') !== 0) return false; return true; }
    function matchesChain(sel) {
      if (/^(?::root|html|:host|body|\.dark|\.light|\[data-theme[^\]]*\])$/.test(sel.trim())) return true;
      for (var q = 0; q < chain.length; q++) { try { if (chain[q].matches(sel)) return true; } catch (x) { return false; } }
      return false;
    }
    function idOrElem(sel) {
      return sel.split(',').some(function (pt) {
        pt = pt.trim(); if (ELEM_SEL.test(pt)) return true;
        var ids = pt.match(/#(?:\\.|[\w-])+/g) || [];
        return ids.some(function (x) { var el = D.getElementById(x.slice(1).replace(/\\(.)/g, '$1')); return !!el && (r === D.body || r.contains(el) || el.contains(r)); });
      });
    }
    function walk(list, ctx) {
      for (var i = 0; i < list.length; i++) {
        var ru = list[i], ty = ru.type;
        if (ty === 1) {
          var sel = ru.selectorText || '', toks = sel.match(/\.(?:\\.|[\w-])+/g) || [], ok = false, hasVar = false;
          for (var v0 = 0; v0 < ru.style.length; v0++) if (ru.style[v0].indexOf('--') === 0 && ru.style[v0].indexOf('--tw-') !== 0) { hasVar = true; break; }
          if (hasVar && vars.length < maxVars && matchesChain(sel)) {
            for (var v = 0; v < ru.style.length && vars.length < maxVars; v++) {
              var pn = ru.style[v]; if (pn.indexOf('--') !== 0 || pn.indexOf('--tw-') === 0) continue;
              var line = sel + ' { ' + pn + ': ' + ru.style.getPropertyValue(pn).trim() + ' }';
              if (!varSeen[line]) { varSeen[line] = 1; vars.push(line); }
            }
          }
          for (var j = 0; j < toks.length; j++) { var cn = toks[j].slice(1).replace(/\\(.)/g, '$1'); if (custom[cn]) { ok = true; hit[cn] = 1; } }
          if (ok) rules.push(wrap(ctx, ru.cssText));
          else if (idRules.length < 600 && ru.style.length && !onlyTw(ru.style) && idOrElem(sel)) idRules.push(wrap(ctx, ru.cssText.length > 3000 ? ru.cssText.slice(0, 3000) + ' ' + ELL + ' }' : ru.cssText));
          if (ru.cssRules && ru.cssRules.length) walk(ru.cssRules, ctx.concat([sel]));
        } else if (ty === 7) kf[ru.name] = ru.cssText;
        else if (ty === 5) {
          var fs = ru.style, src = (fs.getPropertyValue('src').match(/url\(([^)]+)\)/) || [])[1] || '';
          ffs.push('@font-face ' + fs.getPropertyValue('font-family') + ' ' + (fs.getPropertyValue('font-weight') || '') + ' ' + (fs.getPropertyValue('font-style') || '') + ' ' + cleanUrl(src.replace(/['"]/g, '')));
        } else if (ru.cssRules) walk(ru.cssRules, ctx.concat([head(ru)]));
      }
    }
    var sheets = arr(D.styleSheets).concat(D.adoptedStyleSheets ? arr(D.adoptedStyleSheets) : []);
    sheets.forEach(function (sh) { var rl; try { rl = sh.cssRules; } catch (e) { blocked.push(cleanUrl(sh.href || '(sans href)')); return; } if (rl) walk(rl, []); });
    /* variables posees en style inline sur les ancetres (themes appliques par script) */
    chain.forEach(function (e) {
      for (var q = 0; q < e.style.length && vars.length < maxVars; q++) {
        var pn = e.style[q]; if (pn.indexOf('--') !== 0 || pn.indexOf('--tw-') === 0) continue;
        var line = desc(e).slice(0, 60) + ' [style] { ' + pn + ': ' + e.style.getPropertyValue(pn).trim() + ' }';
        if (!varSeen[line]) { varSeen[line] = 1; vars.push(line); }
      }
    });
    /* couleurs d'abord : ce sont elles qu'on reprend dans la coque (theme, palette) */
    var COLV = /:\s*(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\(|transparent\b|white\b|black\b)/i;
    vars = vars.filter(function (x) { return COLV.test(x); }).concat(vars.filter(function (x) { return !COLV.test(x); }));
    var anims = {}; rules.concat(idRules).join('\n').replace(/animation(?:-name)?\s*:\s*([^;}]+)/g, function (m, v) { v.split(/[\s,]+/).forEach(function (x) { if (kf[x]) anims[x] = 1; }); return m; });
    var noRule = Object.keys(custom).filter(function (c) { return !hit[c]; });
    var tw = '', ds = getComputedStyle(D.documentElement);
    if (ds.getPropertyValue('--spacing') || ds.getPropertyValue('--default-font-family')) tw = 'v4 probable'; else if (getComputedStyle(D.body).getPropertyValue('--tw-ring-offset-width')) tw = 'v3 probable'; else tw = 'non d\u00e9tect\u00e9';
    var H = [], S1 = [], S2 = [];
    H.push('/* __styles \u2014 kit ' + VERSION + ' \u2014 ' + location.origin + location.pathname + ' \u2014 ' + new Date().toISOString() + ' */');
    H.push('/* Tailwind : ' + tw + ' | classes utilis\u00e9es : ' + Object.keys(used).length + ', dont ' + nC + (o.all ? ' analys\u00e9es' : ' personnalis\u00e9es (hors Tailwind standard)') + ' | r\u00e8gles trouv\u00e9es : ' + rules.length + ' | r\u00e8gles par id/\u00e9l\u00e9ment : ' + idRules.length + ' | variables : ' + vars.length + ' */');
    if (blocked.length) H.push('/* Feuilles illisibles (CORS) : ' + blocked.join(' , ') + ' */');
    S1.push('/* ===== 1. R\u00e8gles CSS des classes personnalis\u00e9es ===== */');
    S1 = S1.concat(rules);
    if (noRule.length) S1.push('/* Classes personnalis\u00e9es sans r\u00e8gle trouv\u00e9e : ' + noRule.slice(0, 150).join(', ') + ' */');
    S2.push('/* ===== 2. @keyframes utilis\u00e9s ===== */');
    Object.keys(anims).forEach(function (k) { S2.push(kf[k]); });
    S2.push('/* ===== 3. Variables CSS (hors --tw-*) de :root et des anc\u00eatres du conteneur principal, couleurs d\u2019abord ===== */');
    S2 = S2.concat(vars);
    if (vars.length >= maxVars) S2.push('/* ' + ELL + ' limite de ' + maxVars + ' variables atteinte : __styles(racine, {maxVars: N}) */');
    S2.push('/* ===== 4. Polices ===== */');
    ffs.slice(0, 40).forEach(function (f) { S2.push('/* ' + f + ' */'); });
    arr(D.querySelectorAll('link[rel~=stylesheet][href]')).forEach(function (l) { S2.push('/* <link> ' + cleanUrl(l.href) + ' */'); });
    S2.push('/* ===== 5. Palette calcul\u00e9e ===== */');
    S2.push('/* body : ' + sty(D.body) + ' */');
    var me = mainEl(); if (me !== D.body) S2.push('/* principal ' + desc(me) + ' : ' + sty(me) + ' */');
    ['h1', 'h2', 'h3', 'a[href]', 'button', 'input:not([type=hidden])', 'select', 'label', 'nav', 'aside', 'th', 'td', '[role=dialog]', '[role=tab]'].forEach(function (q) {
      var e = arr(r.querySelectorAll(q)).filter(vis)[0]; if (e) S2.push('/* ' + q + ' ' + desc(e).slice(0, 90) + ' : ' + sty(e) + ' */');
    });
    var fc = {}, fb = {}, fbo = {}, ff = {}, fz = {}, cc = {}, nCC = 0, els = [r].concat(arr(r.getElementsByTagName('*')));
    for (var i = 0; i < els.length && i < 5000; i++) {
      var e = els[i]; if (SKIPT[e.tagName]) continue;
      var rc = e.getBoundingClientRect(); if (!rc.width || !rc.height) continue;
      var s = getComputedStyle(e), hasT = false;
      for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.nodeValue)) { hasT = true; break; }
      if (hasT) { fc[s.color] = (fc[s.color] || 0) + 1; var fam = s.fontFamily.split(',')[0].replace(/"/g, ''); ff[fam] = (ff[fam] || 0) + 1; fz[s.fontSize] = (fz[s.fontSize] || 0) + 1; }
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') fb[s.backgroundColor] = (fb[s.backgroundColor] || 0) + 1;
      if (parseFloat(s.borderTopWidth) > 0) fbo[s.borderTopColor] = (fbo[s.borderTopColor] || 0) + 1;
      if (nCC < 120) clsOf(e).split(/\s+/).forEach(function (k) {
        if (!k || k.indexOf(':') !== -1 || cc[k]) return;
        var m = k.replace(/^!/, '').match(COLCLS); if (!m) return;
        var pre = m[1], base = pre.indexOf('border') === 0 ? 'border' : pre;
        if (NONCOL[base] && NONCOL[base].test(m[2])) return;
        cc[k] = s[COLPROP[pre] || (base === 'border' ? 'borderTopColor' : '')] || '?'; nCC++;
      });
    }
    S2.push('/* Couleurs de texte fr\u00e9quentes : ' + topK(fc, 12) + ' */');
    S2.push('/* Fonds fr\u00e9quents : ' + topK(fb, 12) + ' */');
    S2.push('/* Bordures fr\u00e9quentes : ' + topK(fbo, 8) + ' */');
    S2.push('/* Polices : ' + topK(ff, 5) + ' | tailles : ' + topK(fz, 10) + ' */');
    S2.push('/* ===== 6. Classes de couleur \u2192 valeur calcul\u00e9e (comparer avec la palette Tailwind par d\u00e9faut) ===== */');
    var ccl = Object.keys(cc).sort().map(function (k) { return k + ' = ' + cc[k]; });
    for (var x = 0; x < ccl.length; x += 4) S2.push('/* ' + ccl.slice(x, x + 4).join(' | ') + ' */');
    S2.push('/* ===== 7. R\u00e8gles par identifiant (#id pr\u00e9sent dans la page) et par \u00e9l\u00e9ment (html, body, *, barres de d\u00e9filement) ===== */');
    S2 = S2.concat(idRules);
    /* Troncature (mode par defaut seulement) : on raccourcit la section 1, jamais les sections 2 a 7 */
    var head0 = H.join('\n'), tail = S2.join('\n'), s1 = S1.join('\n');
    if (max && head0.length + s1.length + tail.length + 2 > max) {
      var budget = Math.max(2000, max - head0.length - tail.length - 200), keep = [], used1 = 0;
      for (var k1 = 0; k1 < S1.length && used1 + S1[k1].length + 1 <= budget; k1++) { keep.push(S1[k1]); used1 += S1[k1].length + 1; }
      keep.push('/* ' + ELL + ' section 1 tronqu\u00e9e : ' + (S1.length - keep.length) + ' r\u00e8gle(s) omise(s) sur ' + (S1.length - 1) + ' (limite ' + max + ' caract\u00e8res) : __styles(racine, {max: 0}) ou mode raw */');
      s1 = keep.join('\n');
    }
    /* chemins locaux restes dans les regles, les styles calcules (url absolue) et l'en-tete (origine de la page) */
    return userPath(head0 + '\n' + s1 + '\n' + tail, true);
  }

  /* ---------- icônes ---------- */
  function icons(root) {
    prep(); var r = resolve(root || 'body'); if (!r) return notFound(root);
    var seen = {}, keys = [], c2 = { rows: Infinity, lists: 0, svg: true, pre: false };
    arr(r.querySelectorAll('svg')).forEach(function (s) {
      if (s.parentElement && s.parentElement.closest('svg')) return;
      var info = iconInfo(s); if (!info) return;
      var body = kids(s, c2), vb = s.getAttribute('viewBox') || '';
      if (info.lib === 'sprite') {
        var sym = D.getElementById(info.name);
        if (sym) { body = kids(sym, c2); vb = vb || sym.getAttribute('viewBox') || ''; } else body = '(sprite externe ' + cleanUrl(info.file) + ')';
      }
      var key = info.lib + ':' + (info.name || info.variant + '#' + h32(body).toString(36));
      if (seen[key]) { seen[key].n++; return; }
      var at = ''; ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].forEach(function (a) { var v = s.getAttribute(a); if (v) at += ' ' + a + '="' + v + '"'; });
      seen[key] = { n: 1, a: 'viewBox="' + vb + '"' + at, b: body }; keys.push(key);
    });
    keys.sort();
    var fi = fontIcons(r);
    return '/* __icons : ' + keys.length + ' ic\u00f4nes distinctes (biblioth\u00e8que:nom xN | attributs | contenu SVG) */\n' +
      keys.map(function (k) { return k + ' x' + seen[k].n + ' | ' + seen[k].a + ' | ' + seen[k].b; }).join('\n') +
      (fi.length ? '\n/* Polices d\'ic\u00f4nes : ' + fi.length + ' glyphe(s) distinct(s) (police : nom xN | code | content CSS, taille, couleur | \u00e9l\u00e9ment) ; lignes en commentaire, ignor\u00e9es par Shell.registerIconsText */\n' + fi.join('\n') : '');
  }
  /* Polices d'icones (codicon de VS Code, Font Awesome en police, Bootstrap Icons, Material Symbols...) : glyphe
     pose par ::before/::after (souvent dans la zone privee U+E000-U+F8FF) ou ligature (Material : texte \u00ab home \u00bb). */
  var ICONFONT = /codicon|material|symbols|icomoon|awesome|bootstrap-icons|remixicon|ionicons|feather|tabler|lucide|phosphor|segoe (?:fluent|mdl2)|glyphicons|icofont|boxicons|line-?awesome|fluent|iconfont|icons?$/i;
  var ICONCLS = /^(?:codicon|fa|fas|far|fab|fal|fad|bi|ri|ion|mdi|ti|icon|glyph|ms|material-icons|ph|bx|bxs|la|las|lab)-([\w-]+)$/;
  function fontIcons(r) {
    var seen = {}, keys = [], els = [r].concat(arr(r.getElementsByTagName('*')));
    function nameOf(e, code) {
      var cs = clsOf(e).split(/\s+/), m, best = '';
      for (var q = 0; q < cs.length; q++) if ((m = cs[q].match(ICONCLS)) && !/^(?:solid|regular|brands|light|duotone|fw|lg|xs|sm|xl|[2-9]x|spin|pulse|modifier-[\w-]+)$/.test(m[1])) { best = m[1]; break; }
      return best || (e.getAttribute('aria-label') || '').trim().slice(0, 40) || code;
    }
    function add(fam, name, code, detail, e) {
      var key = fam + ' : ' + name;
      if (seen[key]) { seen[key].n++; return; }
      var tag = '<' + e.tagName.toLowerCase() + (clsOf(e) ? ' class="' + escAttr(clsOf(e).slice(0, 120)) + '"' : '') + '>';
      seen[key] = { n: 1, l: code + ' | ' + detail + ' | ' + tag }; keys.push(key);
    }
    for (var i = 0; i < els.length && i < 8000; i++) {
      var e = els[i]; if (SKIPT[e.tagName] || e.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      for (var p = 0; p < 2; p++) {
        var ps = p ? '::after' : '::before', cs = getComputedStyle(e, ps), ct = cs.content;
        if (!ct || ct === 'none' || ct === 'normal') continue;
        var mm = ct.match(/^"([\s\S]*)"$/); if (!mm) continue;
        var ch = mm[1].replace(/\\(.)/g, '$1'); if (!ch || ch.length > 2) continue;
        var cp = ch.codePointAt(0), fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        var pua = (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;
        if (!pua && !ICONFONT.test(fam)) continue;
        var hex = cp.toString(16);
        add(fam, nameOf(e, 'U+' + hex.toUpperCase()), 'U+' + hex.toUpperCase(), ps + ' content "\\' + hex + '" ; ' + cs.fontSize + ' ; ' + cs.color, e);
      }
      if (!e.firstElementChild) {
        var fs = getComputedStyle(e).fontFamily, w = (e.textContent || '').trim();
        if (/material (?:icons|symbols)/i.test(fs) && /^[a-z0-9_]{2,40}$/.test(w)) {
          var s2 = getComputedStyle(e);
          add(fs.split(',')[0].replace(/["']/g, '').trim(), w, 'ligature', 'texte "' + w + '" ; ' + s2.fontSize + ' ; ' + s2.color + (s2.fontVariationSettings && s2.fontVariationSettings !== 'normal' ? ' ; font-variation-settings ' + s2.fontVariationSettings : ''), e);
        }
      }
    }
    keys.sort();
    return keys.map(function (k) { return '/* police ' + k + ' x' + seen[k].n + ' | ' + seen[k].l.replace(/\*\//g, '* /') + ' */'; });
  }

  /* ---------- graphiques ---------- */
  function chartLib(e) {
    var p = e.parentElement, c = clsOf(e) + ' ' + clsOf(p) + ' ' + clsOf(p && p.parentElement);
    return /recharts/.test(c) ? 'Recharts' : /highcharts/.test(c) ? 'Highcharts' : /apexcharts/.test(c) ? 'ApexCharts' : /echarts/.test(c) ? 'ECharts' : /nivo/.test(c) ? 'Nivo' : /chartjs|chart-js/.test(c) ? 'Chart.js' : /amcharts|am5/.test(c) ? 'amCharts' : '';
  }
  function chartList() {
    var els = [], lines = [];
    arr(D.querySelectorAll('svg,canvas')).forEach(function (e) {
      if (e.tagName.toLowerCase() === 'svg' && e.parentElement && e.parentElement.closest('svg')) return;
      var r = e.getBoundingClientRect(); if (r.width < 120 || r.height < 60) return;
      lines.push(els.length + ' : ' + e.tagName.toLowerCase() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' en ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + chartLib(e) + ' ' + desc(e).slice(0, 80));
      els.push(e);
    });
    W.__G = els; return lines;
  }
  function f1(x) { return Math.round(x * 10) / 10; }
  function chart(t, max) {
    prep();
    if (t === undefined) return chartList().map(out);
    var e = typeof t === 'number' ? (W.__G || (chartList(), W.__G))[t] : resolve(t);
    if (!e) return 'graphique introuvable : __chart() pour la liste';
    var tn = e.tagName.toLowerCase(); if (tn !== 'svg' && tn !== 'canvas') { e = e.querySelector('svg,canvas') || e; tn = e.tagName.toLowerCase(); }
    max = max || 400;
    var L = [], R = e.getBoundingClientRect();
    if (tn === 'canvas') {
      L.push('CANVAS ' + Math.round(R.width) + 'x' + Math.round(R.height) + ' ' + chartLib(e) + ' : dessin non lisible dans le DOM (d\u00e9crire d\'apr\u00e8s l\'image et les infobulles).');
      try {
        if (W.Chart) {
          var inst = W.Chart.getChart ? W.Chart.getChart(e) : null;
          if (!inst && W.Chart.instances) for (var k in W.Chart.instances) if (W.Chart.instances[k].canvas === e) inst = W.Chart.instances[k];
          if (inst) L.push('Chart.js ' + ((inst.config && inst.config.type) || '') + ' : ' + JSON.stringify({ labels: inst.data.labels, datasets: (inst.data.datasets || []).map(function (d) { return { label: d.label, data: d.data, backgroundColor: d.backgroundColor, borderColor: d.borderColor }; }) }).slice(0, 8000));
        }
      } catch (x) { /* pas Chart.js */ }
      try {
        if (W.echarts) {
          var ei = W.echarts.getInstanceByDom(e.parentElement) || W.echarts.getInstanceByDom(e.parentElement.parentElement);
          if (ei) { var op = ei.getOption(); L.push('ECharts : ' + JSON.stringify({ xAxis: op.xAxis, yAxis: op.yAxis, series: (op.series || []).map(function (s) { return { type: s.type, name: s.name, data: s.data, color: s.color }; }) }).slice(0, 8000)); }
        }
      } catch (x) { /* pas ECharts */ }
      return big(anonText(L.join('\n')));
    }
    L.push('SVG ' + Math.round(R.width) + 'x' + Math.round(R.height) + ' viewBox="' + (e.getAttribute('viewBox') || '') + '" ' + chartLib(e) + ' ' + desc(e).slice(0, 80) + ' (positions relatives au coin haut-gauche du SVG)');
    arr(e.querySelectorAll('text,rect,circle,ellipse,line,path,polyline,polygon')).some(function (s) {
      if (L.length > max) { L.push(ELL + ' tronqu\u00e9 : __chart(i, max)'); return true; }
      var tg = s.tagName.toLowerCase(), r = s.getBoundingClientRect(), cs = getComputedStyle(s);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (tg === 'text' && s.parentElement && s.parentElement.closest('text')) return false;
      if (tg !== 'text' && r.width < 0.5 && r.height < 0.5) return false;
      var pos = f1(r.left - R.left) + ',' + f1(r.top - R.top) + ' ' + f1(r.width) + 'x' + f1(r.height);
      var col = (cs.fill && cs.fill !== 'none' ? ' fill=' + cs.fill : '') + (cs.stroke && cs.stroke !== 'none' ? ' stroke=' + cs.stroke + ' ' + cs.strokeWidth : '') + (parseFloat(cs.opacity) < 1 ? ' opacity=' + cs.opacity : '');
      if (tg === 'text') L.push('TEXT ' + pos + ' "' + anonText(s.textContent.replace(/\s+/g, ' ').trim()) + '"' + col + ' ' + cs.fontSize + ' ' + cs.fontWeight + ' anchor=' + (s.getAttribute('text-anchor') || cs.textAnchor));
      else if (tg === 'path') { var d = (s.getAttribute('d') || '').replace(/\s+/g, ' '); L.push('PATH ' + pos + col + ' d="' + d.slice(0, 160) + (d.length > 160 ? ELL : '') + '"'); }
      else L.push(tg.toUpperCase() + ' ' + pos + col + (tg === 'rect' && s.getAttribute('rx') ? ' rx=' + s.getAttribute('rx') : ''));
      return false;
    });
    return big(L.join('\n'));
  }
  function big(s) { return dumpText(s); }

  /* ---------- noms probables ---------- */
  /* mot : Jean, Jean-Pierre, Curie-Test (au plus 3 segments ; apres le trait d'union, 3 lettres au moins pour
     ecarter Pop-Up, Check-In) ; nom en capitales : DURAND, MARTIN-DURAND ; particules : de, de la, van der */
  var NAME_W = "\\p{Lu}[\\p{Ll}'\\u2019]+(?:-\\p{Lu}?[\\p{Ll}'\\u2019]{2,}){0,2}", NAME_UP = "\\p{Lu}{3,}(?:-\\p{Lu}{2,}){0,2}";
  var NAME_LIKE = rx("^" + NAME_W + "\\.?(?:\\s+(?:(?:de|du|des|la|le|van|von|der|den|da|di|dos|del|el|al|bin|ben)\\s+){0,2}(?:" + NAME_W + "|" + NAME_UP + "|\\p{Lu}\\.)){1,3}$", 'u');
  var CTX_RX = /avatar|user|name|member|membre|contact|guest|invit|lead|owner|assign|host|profile|profil|person|customer|client|attendee|sender|recipient|participant|author|auteur|closer|setter|people|team|equipe|agent/i;
  function guessNames(root) {
    prep(); var r = resolve(root || 'body'); if (!r) return notFound(root);
    var prob = {}, other = {}, w = D.createTreeWalker(r, 4, null), n;
    while ((n = w.nextNode())) {
      var p = n.parentElement; if (!p || SKIPT[p.tagName]) continue;
      var t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 50 || !NAME_LIKE || !NAME_LIKE.test(t)) continue;
      if (KEEPL[t.toLowerCase()] || A.m[t] || FAKES[t]) continue;
      var ctx = false, e = p;
      for (var k = 0; k < 5 && e && e !== D.body; k++, e = e.parentElement) {
        if (CTX_RX.test(clsOf(e) + ' ' + (e.getAttribute('role') || '') + ' ' + (e.getAttribute('data-testid') || '')) || /^(?:TD|TH)$/.test(e.tagName) || /^(?:cell|gridcell|row)$/.test(e.getAttribute('role') || '') || (k < 2 && e.querySelector('img,[class*=avatar]'))) { ctx = true; break; }
      }
      (ctx ? prob : other)[t] = 1;
    }
    var res = { probables: Object.keys(prob).slice(0, 150), autres: Object.keys(other).filter(function (x) { return !prob[x]; }).slice(0, 80) };
    if (!C.raw) { res.probables = res.probables.map(esc); res.autres = res.autres.map(esc); }
    return res;
  }

  /* ---------- masquage manuel ---------- */
  function maskStr(s, k) { var vis = k > 0 && s.trim().length > k * 2 ? s.slice(-k) : ''; return s.slice(0, s.length - vis.length).replace(/\S/g, BUL) + vis; }
  function targets(sel) {
    if (typeof sel === 'string' && !/^(?:main|body|modale?|dialog)$/.test(sel)) { try { return arr(D.querySelectorAll(sel)); } catch (e) { return []; } }
    return [resolve(sel)].filter(Boolean);
  }

  /* ---------- API publique ---------- */
  W.__config = function (o) {
    o = o || {}; var c = cfg();
    for (var k in o) if (Object.prototype.hasOwnProperty.call(DEF, k)) c[k] = (k === 'keep' || k === 'owner' || k === 'dataAttrs') ? [].concat(o[k] || []) : o[k];
    if (o.keep) W.__KEEP = c.keep;
    if (o.owner) W.__OWNER_EMAIL = c.owner;
    if (o.raw !== undefined) W.__RAW = !!o.raw;
    if (o.main !== undefined) W.__MAIN = o.main;
    if (o.fakeDomain) W.__FAKE_DOMAIN = o.fakeDomain;
    saveCfg(c); prep();
    return 'config : ' + c.keep.length + ' \u00e9l\u00e9ment(s) gard\u00e9(s), ' + Object.keys(OWN).length + ' email(s) gard\u00e9(s), raw ' + (c.raw ? 'oui' : 'non') + ', lignes ' + c.rows + (c.main ? ', principal ' + c.main : '');
  };
  W.__info = function () {
    prep(); var m = mainEl(), s = scroller(), docS = s === D.scrollingElement || s === D.documentElement;
    return {
      kit: VERSION, url: out(cleanUrl(location.href)), titre: out(anonText(D.title)),
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, principal: out(desc(m)), defilant: out(desc(s)),
      scrollHeight: s.scrollHeight, clientHeight: docS ? innerHeight : s.clientHeight, overlays: overlayEls().length,
      anonymise: !!W.__ANON_LIVE, surveillance: !!OBS, noms: Object.keys(A.m).length, raw: !!C.raw, techno: techno(), lang: D.documentElement.lang || ''
    };
  };
  function techno() {
    var t = [], b = D.body;
    try {
      var root = D.getElementById('root') || D.getElementById('__next') || D.getElementById('app') || b.firstElementChild;
      if (W.__NEXT_DATA__ || D.getElementById('__next')) t.push('Next.js');
      if (W.__NUXT__ || W.$nuxt) t.push('Nuxt');
      if ((root && Object.keys(root).some(function (k) { return k.indexOf('__react') === 0; })) || D.querySelector('[data-reactroot]')) t.push('React');
      if (D.querySelector('[data-v-app]') || (root && root.__vue_app__) || W.Vue) t.push('Vue');
      var ng = D.querySelector('[ng-version]'); if (ng) t.push('Angular ' + ng.getAttribute('ng-version'));
      if (D.querySelector('[class*="svelte-"]')) t.push('Svelte');
      var ds = getComputedStyle(D.documentElement);
      if (ds.getPropertyValue('--spacing') || ds.getPropertyValue('--default-font-family')) t.push('Tailwind v4 probable');
      else if (getComputedStyle(b).getPropertyValue('--tw-ring-offset-width')) t.push('Tailwind v3 probable');
      if (D.querySelector('[class*="Mui"]')) t.push('MUI');
      if (D.querySelector('[class*="ant-"]')) t.push('Ant Design');
      if (D.querySelector('[class*="chakra-"]')) t.push('Chakra UI');
      if (D.querySelector('[data-radix-popper-content-wrapper],[data-radix-collection-item]')) t.push('Radix UI');
      if (D.querySelector('[data-headlessui-state],[id^="headlessui-"]')) t.push('Headless UI');
      if (W.bootstrap || D.querySelector('link[href*="bootstrap"]')) t.push('Bootstrap');
      if (D.querySelector('svg[class*="tabler-icon"],svg[class*="icon-tabler"]')) t.push('ic\u00f4nes Tabler');
      if (D.querySelector('svg[class*="lucide"]')) t.push('ic\u00f4nes Lucide');
      if (D.querySelector('svg[data-slot="icon"]')) t.push('Heroicons');
      if (D.querySelector('svg[data-prefix]')) t.push('Font Awesome');
      if (D.querySelector('.material-icons,.material-symbols-outlined,.material-symbols-rounded')) t.push('Material Icons');
      if (W.Chart) t.push('Chart.js'); if (W.echarts) t.push('ECharts'); if (W.Highcharts) t.push('Highcharts');
      if (D.querySelector('.recharts-surface')) t.push('Recharts'); if (D.querySelector('.apexcharts-svg')) t.push('ApexCharts');
    } catch (e) { /* d\u00e9tection partielle */ }
    return t;
  }
  /* __addNames(noms, {prenom: true}) : prenom = remplacer aussi le prenom SEUL (\u00ab Bonjour Jean \u00bb), a reserver aux
     prenoms qui ne sont pas des mots courants (Rose, Pierre...) puisque le remplacement porte sur tout le texte. */
  W.__addNames = function (list, o) {
    prep(); o = o || {};
    var keep1 = {};
    Object.keys(KEEPL).forEach(function (k) { if (k.indexOf(' ') > 0) keep1[k.charAt(0).toUpperCase()] = 1; });
    [].concat(list || []).forEach(function (n0) {
      var n = String(n0 || '').replace(/\s+/g, ' ').trim();
      if (n.length < 3 || KEEPL[n.toLowerCase()]) return;
      var f = A.m[n];
      if (!f) { if (FAKES[n]) return; f = fakeName(n); A.m[n] = f; FAKES[f] = 1; DIRTY = true; }
      var p = n.split(' ');
      if (p.length > 1) {
        var ini = initials(n), fi = initials(f);
        /* initiales reelles deja utilisees comme initiales fictives : on ne les remplace pas (pas de chaine JD -> LL -> JD) */
        if (/^[A-Z\u00c0-\u00de]{2}$/.test(ini) && !A.i[ini] && !KEEPINI[ini] && !FAKES[ini] && fi !== ini) { A.i[ini] = fi; FAKES[fi] = 1; DIRTY = true; }
        /* initiale d'une lettre (pastille d'avatar \u00ab M \u00bb) : remplacee seulement dans un contexte d'avatar (initial1) */
        var i1 = n.charAt(0).toUpperCase(), f1 = f.charAt(0).toUpperCase();
        if (/^[A-Z\u00c0-\u00de]$/.test(i1) && i1 !== f1 && !A.i[i1] && !FAKES[i1] && !keep1[i1]) { A.i[i1] = f1; FAKES[f1] = 1; DIRTY = true; }
        /* variantes slug des liens personnels (/e/jean-dupont, jean.dupont) */
        ['-', '.'].forEach(function (sep) {
          var rs = slug(n, sep), fs = slug(f, sep);
          if (rs.length >= 5 && rs !== fs && !A.m[rs] && !KEEPL[rs] && !FAKES[rs]) { A.m[rs] = fs; FAKES[fs] = 1; DIRTY = true; }
        });
        if (o.prenom) {
          var rp = p[0], fp = f.split(' ')[0];
          if (rp.length >= 3 && rp !== fp && !A.m[rp] && !KEEPL[rp.toLowerCase()] && !FAKES[rp]) { A.m[rp] = fp; FAKES[fp] = 1; DIRTY = true; }
        }
      }
    });
    prep(); saveAnon();
    return Object.keys(A.m).length;
  };
  W.__addMap = function (o) {
    prep();
    for (var k in o || {}) { var r = String(k).trim(); if (r.length >= 3 && !KEEPL[r.toLowerCase()] && !FAKES[r]) { A.m[r] = String(o[k]); FAKES[A.m[r]] = 1; DIRTY = true; } }
    prep(); saveAnon();
    return Object.keys(A.m).length;
  };
  W.__guessNames = guessNames;
  W.__anonLive = function (root, o) {
    prep(); var r = resolve(root || 'body'); if (!r) return notFound(root);
    var st = { t: 0, a: 0, c: 0, img: 0, ce: 0, foc: 0 };
    liveTree(r, st);
    if (!(o && o.watch === false)) watch();
    W.__ANON_LIVE = true; saveAnon();
    return 'ok : ' + st.t + ' textes, ' + st.a + ' attributs, ' + st.c + ' champs, ' + st.img + ' avatar(s) flout\u00e9(s)' +
      (st.ce ? ', ' + st.ce + ' zone(s) \u00e9ditable(s) NON modifi\u00e9e(s) : utiliser __cover' : '') +
      (st.foc ? ', ' + st.foc + ' champ(s) avec le focus NON modifi\u00e9(s) : utiliser __cover(\'input:focus,textarea:focus\')' : '') + (OBS ? ', surveillance active' : '');
  };
  W.__anonStop = function () { if (OBS) { OBS.disconnect(); OBS = null; W.__copieurObs = null; } return 'surveillance arr\u00eat\u00e9e (l\'affichage reste anonymis\u00e9 jusqu\'au rechargement)'; };
  W.__mask = function (sel, keepN) {
    prep(); var n = 0; keepN = keepN === undefined ? 4 : keepN;
    targets(sel).forEach(function (e) {
      if (e.isContentEditable) return;
      if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') { e.value = maskStr(e.value, keepN); n++; return; }
      var w = D.createTreeWalker(e, 4, null), t;
      while ((t = w.nextNode())) if (/\S/.test(t.nodeValue)) { t.nodeValue = maskStr(t.nodeValue, keepN); n++; }
    });
    return n + ' texte(s) masqu\u00e9(s)';
  };
  /* Les aplats suivent leur cible : un aplat fixe resterait sur place pendant le defilement (__steps, __scroll)
     et laisserait la zone sensible visible sur les images suivantes. */
  function placeCovers() {
    arr(D.querySelectorAll('.copieur-cover')).forEach(function (d) {
      var e = d.__cuT;
      if ((!e || !e.isConnected) && d.__cuS) { e = targets(d.__cuS)[d.__cuI || 0] || null; if (e) d.__cuT = e; }
      if (!e || !e.isConnected) return;
      var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
      d.style.left = r.left + 'px'; d.style.top = r.top + 'px'; d.style.width = r.width + 'px'; d.style.height = r.height + 'px';
    });
  }
  W.__copieurPlace = placeCovers;
  if (!W.__copieurCoverWatch) {
    W.__copieurCoverWatch = true;
    D.addEventListener('scroll', function () { if (W.__copieurPlace) W.__copieurPlace(); }, true);
    W.addEventListener('resize', function () { if (W.__copieurPlace) W.__copieurPlace(); });
  }
  W.__cover = function (sel, label) {
    prep(); var n = 0;
    targets(sel).forEach(function (e, i) {
      var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
      var bg = 'rgb(243, 244, 246)';
      for (var p = e; p && p.nodeType === 1; p = p.parentElement) { var b = getComputedStyle(p).backgroundColor; if (b && b !== 'transparent' && b !== 'rgba(0, 0, 0, 0)') { bg = b; break; } }
      var d = D.createElement('div'); d.className = 'copieur-cover';
      d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:center;color:#9ca3af;font:12px/1.2 system-ui,sans-serif;border-radius:4px;' +
        'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;background:' + bg;
      d.textContent = label === undefined ? 'contenu masqu\u00e9' : String(label);
      d.__cuT = e; d.__cuS = typeof sel === 'string' ? sel : null; d.__cuI = i;
      D.body.appendChild(d); n++;
    });
    return n + ' zone(s) couverte(s)';
  };
  W.__uncover = function () { var c = arr(D.querySelectorAll('.copieur-cover')); c.forEach(function (d) { d.parentNode.removeChild(d); }); return c.length + ' zone(s) retir\u00e9e(s)'; };
  W.__mainEl = function () { prep(); return mainEl(); };
  W.__modalEl = function () { prep(); return modalEl(); };
  W.__overlays = function () {
    prep(); var els = overlayEls(); W.__O = els;
    return els.map(function (e, i) {
      var r = e.getBoundingClientRect();
      return out(i + ' : ' + (e.getAttribute('role') || '-') + ' ' + desc(e).slice(0, 80) + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + anonText((e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)) + '"');
    });
  };
  W.__scroll = function (y) {
    prep(); var s = scroller();
    s.scrollTop = (y === 'bas' || y === 'bottom') ? s.scrollHeight : (+y || 0);
    placeCovers();
    var docS = s === D.scrollingElement || s === D.documentElement;
    return { el: out(desc(s)), top: Math.round(s.scrollTop), height: s.scrollHeight, client: docS ? innerHeight : s.clientHeight };
  };
  W.__steps = function () {
    prep(); var s = scroller(), c = (s === D.scrollingElement || s === D.documentElement) ? innerHeight : s.clientHeight;
    var max = Math.max(0, s.scrollHeight - c), step = Math.max(100, Math.floor(c * 0.85)), r = [];
    for (var y = 0; y < max; y += step) r.push(y);
    r.push(max);
    return r.filter(function (v, i, a) { return a.indexOf(v) === i; });
  };
  W.__rects = function (sel, max) {
    prep(); var els = sel === undefined ? arr(mainEl().children) : targets(sel);
    return els.slice(0, max || 30).map(function (e) { var r = e.getBoundingClientRect(); return out(desc(e).slice(0, 90) + ' x=' + Math.round(r.left) + ' y=' + Math.round(r.top) + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height)); });
  };
  /* __etat() puis, apres une action (replier la barre, ouvrir un menu), __diffEtat() : liste ce qui a change
     PARTOUT dans la page (classes, style, visibilite, aria-expanded, data-state, elements ajoutes ou retires).
     Une action sur la coque change souvent un element eloigne (marge du contenu principal...) qu'un dump du
     seul element clique ne montre pas. */
  function sigEl(e) {
    var s = getComputedStyle(e);
    return [clsOf(e), e.getAttribute('style') || '', (s.display === 'none' || s.visibility === 'hidden') ? 'cach\u00e9' : 'visible',
      e.getAttribute('aria-expanded') || '', e.getAttribute('data-state') || '', e.hidden ? 'hidden' : ''].join('\u0001');
  }
  W.__etat = function (root) {
    prep(); var r = resolve(root || 'body'); if (!r) return notFound(root);
    var snap = new Map(), n = 0;
    [r].concat(arr(r.getElementsByTagName('*'))).forEach(function (e) {
      if (SKIPT[e.tagName] || (e.classList && e.classList.contains('copieur-cover'))) return;
      snap.set(e, sigEl(e)); n++;
    });
    W.__ETAT0 = { root: r, snap: snap };
    return '\u00e9tat m\u00e9moris\u00e9 : ' + n + ' \u00e9l\u00e9ments ; faire l\'action, puis __diffEtat()';
  };
  W.__diffEtat = function (max) {
    prep(); var s = W.__ETAT0; if (!s) return 'appeler d\'abord __etat()';
    var res = [], ajoutes = 0, retires = 0, modifies = 0, NOMS = ['classes', 'style', 'visibilit\u00e9', 'aria-expanded', 'data-state', 'hidden'];
    [s.root].concat(arr(s.root.getElementsByTagName('*'))).forEach(function (e) {
      if (SKIPT[e.tagName] || (e.classList && e.classList.contains('copieur-cover'))) return;
      var old = s.snap.get(e);
      if (old === undefined) {
        ajoutes++;
        if (e.parentElement && s.snap.has(e.parentElement)) res.push('+ ' + desc(e).slice(0, 90) + ' ajout\u00e9 dans ' + desc(e.parentElement).slice(0, 60));
        return;
      }
      var now = sigEl(e); if (now === old) return;
      var a = old.split('\u0001'), b = now.split('\u0001'), parts = [];
      for (var k = 0; k < a.length; k++) {
        if (a[k] === b[k]) continue;
        if (k === 0) {
          var ca = a[0].split(/\s+/).filter(Boolean), cb = b[0].split(/\s+/).filter(Boolean);
          var plus = cb.filter(function (c) { return ca.indexOf(c) === -1; }), moins = ca.filter(function (c) { return cb.indexOf(c) === -1; });
          parts.push('classes ' + plus.map(function (c) { return '+' + c; }).concat(moins.map(function (c) { return '-' + c; })).join(' '));
        } else parts.push(NOMS[k] + ' \u00ab ' + a[k].slice(0, 80) + ' \u00bb \u2192 \u00ab ' + b[k].slice(0, 80) + ' \u00bb');
      }
      modifies++; res.push('~ ' + desc(e).slice(0, 90) + ' : ' + parts.join(' ; '));
    });
    s.snap.forEach(function (v, e) { if (!e.isConnected) retires++; });
    var lim = max || 80;
    return [out('bilan : ' + modifies + ' \u00e9l\u00e9ment(s) modifi\u00e9(s), ' + ajoutes + ' ajout\u00e9(s), ' + retires + ' retir\u00e9(s)')].concat(res.slice(0, lim).map(out)).concat(res.length > lim ? [out(ELL + ' ' + (res.length - lim) + ' de plus : __diffEtat(N)')] : []);
  };
  W.__html = function (root, rows, o) { var h = html(root, rows, o); return h === null ? notFound(root) : h; };
  W.__dump = function (root, rows, o) { var h = html(root, rows, o); return h === null ? notFound(root) : dumpText(h); };
  W.__dumpText = dumpText;
  W.__get = function (i, n) { i = i || 0; return (W.__D || []).slice(i, i + (n || 20)); };
  W.__wait = function (ms) { return new Promise(function (r) { setTimeout(function () { r('ok'); }, ms || 1000); }); };
  W.__styles = function (root, o) { return big(styles(root, o)); };
  W.__icons = function (root) { return big(icons(root)); };
  W.__chart = chart;
  W.__forget = function () {
    if (OBS) { OBS.disconnect(); OBS = null; W.__copieurObs = null; }
    ssDel('copieur-anon'); ssDel('copieur-kit-config'); ssDel('copieur-kit');
    A = { m: {}, e: {}, p: {}, i: {} }; W.__anonMap = A.m; refreshFakes(); NAME_SIG = ''; W.__D = []; W.__H = '';
    W.__KEEP = undefined; W.__OWNER_EMAIL = undefined; W.__RAW = undefined; W.__MAIN = undefined; W.__FAKE_DOMAIN = undefined;
    prep();
    return 'oubli\u00e9 : recharger la page pour retirer l\'anonymisation affich\u00e9e';
  };
  /* compatibilité avec le kit d'iClosed */
  W.__clean = function (el) { prep(); var r = ser(resolve(el), { rows: Infinity, lists: 0, svg: false, pre: false }); saveAnon(); return r; };
  W.__trim = function (root, rows) {
    var c = resolve(root).cloneNode(true); rows = rows || 10;
    arr(c.querySelectorAll('tbody')).forEach(function (tb) { arr(tb.children).slice(rows).forEach(function (x) { x.parentNode.removeChild(x); }); });
    arr(c.querySelectorAll('[role=rowgroup]')).forEach(function (g) { arr(g.children).filter(function (x) { return x.getAttribute('role') === 'row'; }).slice(rows).forEach(function (x) { x.parentNode.removeChild(x); }); });
    return c;
  };

  /* ---------- initialisation ---------- */
  if (W.__KEEP || W.__OWNER_EMAIL || typeof W.__RAW === 'boolean' || W.__MAIN || W.__FAKE_DOMAIN) saveCfg(cfg());
  prep();
  if (hadObs && W.__ANON_LIVE) watch();
  ssSet('copieur-kit', '(' + copieurKit.toString() + ')()');
  return 'kit ok';
})();
