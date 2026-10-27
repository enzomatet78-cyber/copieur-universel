/* routes-from-bundle.js -- kit de reconnaissance web du plugin copieur-universel.
 *
 * A injecter TEL QUEL dans un onglet de l'appli a copier (reponse attendue : "routes ok") :
 *   - Claude in Chrome / navigateur integre : javascript_tool avec le contenu du fichier ;
 *   - CDP (Chrome headless, Electron, WebView2 ; sous Windows, py remplace python3) :
 *       python3 "$OUTILS/cdp_eval.py" --port 9222 eval --target 0 --file "$OUTILS/routes-from-bundle.js"
 *          --expr "__routes({prefix:'/app'})" --out "$TRAVAIL/routes.json"
 *
 * LECTURE SEULE. Le kit ne lit que le DOM et des fichiers statiques (JS/JSON) deja references par la page,
 * sur l'origine de la page ou celle de ses propres bundles, avec le cache du navigateur. Il n'appelle
 * aucune API, ne soumet rien, ne navigue pas et ne modifie pas la page. Lire un bundle pour LISTER des
 * routes est de la reconnaissance : ne jamais recopier de code des bundles dans le clone.
 *
 * Fonctions (toutes sur window) :
 *   __routes(opts)    -> Promise du resultat compact (aussi dans window.__ROUTES ;
 *                        etat dans window.__ROUTES_STATE : 'en cours' | 'fini' | 'erreur')
 *       opts.prefix     '/app'  ne garder que les routes sous ce prefixe (les segments relatifs restent)
 *       opts.maxFiles   120     nombre max de fichiers JS/JSON lus
 *       opts.maxBytes   40e6    volume max lu (caracteres)
 *       opts.origins    []      origines supplementaires autorisees (ex. CDN des bundles)
 *       opts.include3p  false   lire aussi les scripts tiers (analytics, chat...) : inutile en general
 *       opts.all        false   lister aussi les chaines "/..." quand un prefixe est donne
 *       opts.detail     false   ajouter, par route, le nombre de fichiers et les sources
 *       opts.maxList    300     longueur max de chaque liste
 *   __routesText()    -> texte compact (une route par ligne) du dernier __routes() (a decouper avec __out)
 *   __stack()         -> technologies : framework, routeur, CSS (Tailwind...), composants, icones, polices,
 *                        couleurs dominantes, variables CSS de :root, widgets tiers, alertes (canvas, iframes)
 *   __inventory(opts) -> inventaire de l'ecran courant : navigation, liens internes (motifs), onglets, menus,
 *                        accordeons, declencheurs de modales, boutons a NE PAS cliquer, formulaires, tableaux,
 *                        infobulles, conteneur defilant (emails/telephones masques, textes tronques)
 *   __routeStatus(attendue) -> apres une navigation : route finale, titre, 404 ?, connexion ?, redirection ?
 *                        (routeur a hachage : '#/x' ou '/index.html#/x' ; le #/route compte dans la comparaison)
 *   __out(valeur, taille) -> JSON (ou texte) echappe et decoupe en morceaux <= 900 caracteres dans window.__R ;
 *                        renvoie le nombre de morceaux. Recuperer ensuite window.__R.slice(0, 20)...
 *                        Echappements (filtre de sortie de Claude in Chrome), les memes que capture-kit.js :
 *                        U+00A7 deja present -> '(SECT)', puis ';' -> U+00A7 (paragraphe)   '&' -> '(AMP)'   '?' -> '(Q)'
 *                        A inverser en ecrivant les fichiers, dans cet ordre : U+00A7 -> ';' d'abord, '(SECT)' -> U+00A7 en dernier.
 *
 * Sans "await" (Claude in Chrome) :  __routes({prefix:'/app'}); 'lance'
 *   puis interroger window.__ROUTES_STATE jusqu'a 'fini', puis __out(__routesText()) et window.__R.slice(0, 20).
 * Avec "await" (navigateur integre, cdp_eval) :  await __routes({prefix:'/app'})
 */
(function () {
  'use strict';
  var W = window, D = document;
  var VERSION = '1.0';

  /* ------------------------------------------------------------------ utilitaires */
  /* un U+00A7 d'origine devient '(SECT)' AVANT que ';' devienne U+00A7 : l'inversion reste exacte (comme capture-kit.js) */
  function esc(s) { return String(s).replace(/\u00a7/g, '(SECT)').replace(/;/g, '\u00a7').replace(/&/g, '(AMP)').replace(/\?/g, '(Q)'); }
  W.__out = function (data, size) {
    size = size || 900;
    var s = esc(typeof data === 'string' ? data : JSON.stringify(data));
    var out = [];
    for (var i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    W.__R = out;
    return out.length;
  };
  function uniq(a) { var s = {}, r = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; r.push(a[i]); } return r; }
  function short(u) { try { var p = new URL(u, location.href).pathname.split('/'); return (p.pop() || p.pop() || u).slice(0, 48); } catch (e) { return String(u).slice(0, 48); } }
  function clip(t, n) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); n = n || 60; return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; }
  /* telephones : format international (+33 6...) ou francais (06 12 34 56 78) ; une date ISO n'est pas masquee */
  var EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, PHONE = /\+\d[\d\s().-]{7,}\d|\b0\d(?:[\s.-]?\d{2}){4}\b/g;
  function mask(t) { return clip(t).replace(EMAIL, '[email]').replace(PHONE, '[tel]'); }
  function hex(c) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || '');
    if (!m) return c;
    if (m[4] !== undefined && +m[4] === 0) return 'transparent';
    var h = '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + (+x).toString(16)).slice(-2); }).join('');
    return m[4] !== undefined && +m[4] < 1 ? h + ' a' + (+m[4]).toFixed(2) : h;
  }
  function baseDomain(h) {
    var p = String(h || '').split('.');
    if (p.length <= 2) return h;
    if (/^(co|com|net|org|gov|edu|ac|gouv)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join('.');
    return p.slice(-2).join('.');
  }

  /* chemin -> forme normalisee ('' si ce n'est pas une route plausible) */
  var ASSET_EXT = /\.(?:m?js|cjs|ts|tsx|jsx|css|scss|less|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|json|txt|xml|csv|mp4|webm|mov|mp3|wav|ogg|wasm|pdf|zip|gz|mdx?|ya?ml|php|aspx?|html?|vue|svelte|astro)$/i;
  var NOT_ROUTE = /^\/(?:api|v\d+|graphql|gql|rest|rpc|oauth2?|socket\.io|sockjs|wss?|cdn-cgi|static|assets|_[\w-]*|node_modules|src|dist|build|favicon|fonts?|images?|img|icons?|media|uploads|cdn|sitemap|robots|manifest|sw|service-worker|webpack|hot|@vite|@id|@fs)(?:[\/.]|$)/i;
  function normRoute(p) {
    if (p == null) return '';
    p = String(p).replace(/\$\{[^}]*\}/g, ':param').split(/[?#]/)[0].replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p;
  }
  /* chemin + route a hachage ('/index.html#/x', '#!/x') : normRoute coupe au '#', ce qui confondait toutes les
     routes d'un routeur a hachage. Une simple ancre (#section) est ignoree ; '#x' seul = page courante. */
  function normFull(p) {
    p = String(p == null ? '' : p);
    if (p[0] === '#') p = location.pathname + p;
    var i = p.indexOf('#'), h = i >= 0 ? p.slice(i + 1) : '';
    var base = normRoute(i >= 0 ? p.slice(0, i) : p);
    return /^!?\//.test(h) ? base + '#' + normRoute(h.replace(/^!/, '')) : base;
  }
  function hashRoute() { return /^#!?\//.test(location.hash) ? location.hash : ''; }
  function plausibleAbs(p) {
    if (!p || p[0] !== '/' || p.length > 160) return false;
    if (p === '/') return true;
    if (/^\/\//.test(p) || /[\s<>{}"'`\\^|]/.test(p)) return false;
    if (ASSET_EXT.test(p) || NOT_ROUTE.test(p)) return false;
    return /^\/[\w\-.~:*()\[\]@%+!=]+(?:\/[\w\-.~:*()\[\]@%+!=]*)*$/.test(p);
  }
  function plausibleRel(p) {
    if (!p || p.length > 80 || p[0] === '/' || p[0] === '.') return false;
    if (p === '*' || p === '**') return true;
    return /^[\w\-:*()\[\]@]+(?:\/[\w\-:*()\[\]@]+)*$/.test(p) && !/^\d+$/.test(p);
  }

  /* ------------------------------------------------------------------ __routes */
  var THIRD = /(?:^|\.)(?:googletagmanager|google-analytics|googleadservices|googlesyndication|doubleclick|gstatic|recaptcha|hcaptcha|facebook|fbcdn|hotjar|intercom|intercomcdn|intercomassets|segment|sentry|sentry-cdn|stripe|hubspot|hs-scripts|hs-analytics|hsforms|hscollectedforms|usemessages|zendesk|zdassets|zopim|crisp|tawk|drift|driftt|fullstory|mixpanel|amplitude|posthog|clarity|bing|linkedin|licdn|twitter|twimg|cloudflareinsights|wistia|youtube|ytimg|vimeo|jsdelivr|unpkg|cdnjs|polyfill|newrelic|nr-data|datadoghq|logrocket|heapanalytics|optimizely|launchdarkly|calendly|typeform|chatwoot|gorgias|onesignal|pusher|cookiebot|onetrust|cookielaw|usercentrics|axeptio|didomi|tarteaucitron|trustarc|tiktok|snapchat|pinterest|reddit|adroll|criteo|taboola|outbrain|appcues|pendo|userpilot|walkme|canny|beamer|productfruits|smartlook|mouseflow|paypal|braintreegateway|plaid|chargebee|paddle|olark|livechatinc|freshchat|helpscout|loom|vidyard|jotform|mapbox|googleapis|tailwindcss)\./i;
  var BUILDISH = /\/(?:static|assets|_next|_nuxt|_app|build|dist|js|chunks?|bundles?|scripts|packs|webpack|runtime)\/|[.\-_][0-9a-zA-Z_-]{6,}\.m?js$|\.chunk\.js$/i;
  var VENDOR_NAMES = /^(?:index|main|app|runtime|vendors?|polyfills?|framework|webpack|chunk|commons?|shared|client|entry|jsx-runtime|react|react-dom|preload-helper|modulepreload-polyfill|_commonjsHelpers|_plugin-vue_export-helper|styles?|lib|libs|utils?|helpers?|common|core|bootstrap|scheduler|tslib|lodash|moment|dayjs|axios|i18n|locale|vendor-[\w-]+|npm\.[\w.-]+|\d+)$/i;

  W.__routes = function (opts) {
    opts = opts || {};
    var o = {
      prefix: normRoute(opts.prefix || ''), maxFiles: opts.maxFiles || 120, maxBytes: opts.maxBytes || 40e6,
      timeoutMs: opts.timeoutMs || 15000, concurrency: opts.concurrency || 6, origins: opts.origins || [],
      include3p: !!opts.include3p, all: !!opts.all, detail: !!opts.detail, maxList: opts.maxList || 300
    };
    if (o.prefix === '/') o.prefix = '';
    W.__ROUTES_STATE = 'en cours';
    var t0 = Date.now();
    var page = location.origin, pageHost = location.hostname;
    var st = { manifestes: [], execution: [], scriptsInitiaux: 0, lus: 0, echecs: 0, htmlAuLieuDeJs: 0, refusesCors: 0, tiersIgnores: 0, octets: 0, tronque: false };
    var warn = [];
    var items = {};   // cle kind|chemin -> {p, kind, files:{}, n}
    var names = {};
    var screens = {};
    var seen = {}, queue = [], fileOrigins = {}, extraOrigins = {};
    o.origins.forEach(function (x) { try { extraOrigins[new URL(x, page).origin] = 1; } catch (e) { } });

    function add(kind, raw, src, name) {
      var p = normRoute(raw);
      if (kind === 'rel') { if (!plausibleRel(p)) return; }
      else if (!plausibleAbs(p)) return;
      var k = kind + '|' + p;
      var it = items[k] || (items[k] = { p: p, kind: kind, files: {}, n: 0 });
      if (!it.files[src]) { it.files[src] = 1; it.n++; }
      if (name && kind !== 'str' && !names[p]) names[p] = clip(name, 50);
    }

    function allowed(u) {
      var url;
      try { url = new URL(u, location.href); } catch (e) { return false; }
      if (!/^https?:$/.test(url.protocol) && url.origin !== page) return false;
      if (url.origin === page || extraOrigins[url.origin] || o.include3p) return true;
      if (baseDomain(url.hostname) === baseDomain(pageHost)) return true;
      if (THIRD.test(url.hostname + '.')) return false;
      return !!fileOrigins[url.origin];
    }
    function enqueue(u, force) {
      var href;
      try { href = new URL(u, location.href).href.split('#')[0]; } catch (e) { return; }
      var bare = href.split('?')[0];
      if (seen[bare]) return;
      if (!force && !/\.m?js$/i.test(bare)) return;
      seen[bare] = 1;
      chunkName(bare);
      if (!allowed(href)) { st.tiersIgnores++; return; }
      if (queue.length < 5000) queue.push(href);
    }

    /* noms de chunks -> routes (Next, Nuxt) ou ecrans presumes */
    function chunkName(u) {
      var path;
      try { path = new URL(u).pathname; } catch (e) { return; }
      try { path = decodeURIComponent(path); } catch (e) { }
      var m = /\/_next\/static\/chunks\/app\/(?:(.*)\/)?page-[^\/]+\.js$/.exec(path);
      if (m) { add('route', '/' + (m[1] || '').split('/').filter(function (s) { return s && !/^\(.*\)$/.test(s) && s[0] !== '@'; }).join('/'), 'chunk Next (app)'); return; }
      m = /\/_next\/static\/chunks\/pages\/(.+?)-[0-9a-f]{6,}\.js$/.exec(path);
      if (m) { if (m[1][0] !== '_') add('route', '/' + m[1].replace(/(^|\/)index$/, ''), 'chunk Next (pages)'); return; }
      m = /\/_nuxt\/pages\/(.+?)\.[0-9a-f]{5,}\.js$/.exec(path);
      if (m) { add('route', '/' + m[1].replace(/(^|\/)index$/, '').replace(/_(\w+)/g, ':$1'), 'chunk Nuxt'); return; }
      m = /\/([A-Za-z][\w-]*?)((?:[.-][0-9A-Za-z_]{6,12})+)\.(?:chunk\.)?m?js$/.exec(path);
      // un hachage contient un chiffre ou mele majuscules et minuscules ("-config" n'en est pas un)
      if (m && /\d|[A-Z].*[a-z]|[a-z].*[A-Z]/.test(m[2]) && !VENDOR_NAMES.test(m[1]) && m[1].length > 2) screens[m[1]] = (screens[m[1]] || 0) + 1;
    }

    /* resolution d'un specifieur trouve dans un fichier */
    function resolveSpec(spec, fileUrl) {
      try {
        if (/^https?:\/\//i.test(spec) || spec[0] === '/' || spec.indexOf('./') === 0 || spec.indexOf('../') === 0) return new URL(spec, fileUrl).href;
        var first = spec.split('/')[0];
        var path = new URL(fileUrl).pathname;
        var k = path.indexOf('/' + first + '/');
        if (k >= 0) return new URL(path.slice(0, k + 1) + spec, fileUrl).href;
        return new URL(spec, D.baseURI).href;
      } catch (e) { return null; }
    }

    /* cartes de chunks webpack : "prefixe"+(({noms}[e]||e)+"."+{hash}[e]+".js") */
    function skipWsBack(t, i) { while (i > 0 && /\s/.test(t[i - 1])) i--; return i; }
    function strBack(t, end) {
      var q = t[end - 1];
      if (q !== '"' && q !== "'") return null;
      var j = end - 2;
      while (j >= 0 && t[j] !== q) { if (end - j > 300 || t[j] === '\n') return null; j--; }
      return j < 0 ? null : { s: t.slice(j + 1, end - 1), start: j };
    }
    function parseMap(s) {
      var r = {}, re = /(?:^|,)\s*(["']?)([\w\-.~$@\/]+)\1\s*:\s*(["'])([^"']*)\3/g, m, n = 0;
      while ((m = re.exec(s)) && n < 5000) { r[m[2]] = m[4]; n++; }
      return r;
    }
    function webpackChunks(t, fileUrl) {
      var re = /\{((?:\s*(?:"[^"\n]{1,120}"|'[^'\n]{1,120}'|[\w$]+)\s*:\s*["'][0-9a-f]{4,}["']\s*,?){1,6000})\}\s*\[\s*[\w$]+\s*\]/g;
      var m, count = 0, pm = /\.p\s*=\s*(["'])([^"'\n]*)\1/.exec(t), pub = pm ? pm[2] : null;
      while ((m = re.exec(t)) && count < 3) {
        var i = skipWsBack(t, m.index);
        if (t[i - 1] !== '+') continue;
        i = skipWsBack(t, i - 1);
        var mid = strBack(t, i);
        if (!mid) continue;
        i = skipWsBack(t, mid.start);
        if (t[i - 1] !== '+') continue;
        i = skipWsBack(t, i - 1);
        var nmap = null;
        if (t[i - 1] === ')') {
          var depth = 0, j = i - 1, lim = Math.max(0, i - 600000);
          for (; j >= lim; j--) { if (t[j] === ')') depth++; else if (t[j] === '(') { depth--; if (depth === 0) break; } }
          if (j < lim) continue;
          var inner = /^\s*\{([^{}]*)\}\s*\[\s*([\w$]+)\s*\]\s*\|\|\s*\2\s*$/.exec(t.slice(j + 1, i - 1));
          if (!inner) continue;
          nmap = parseMap(inner[1]);
          i = skipWsBack(t, j);
        } else {
          var k2 = i;
          while (k2 > 0 && /[\w$]/.test(t[k2 - 1])) k2--;
          if (k2 === i) continue;
          i = skipWsBack(t, k2);
        }
        while (t[i - 1] === '(') i = skipWsBack(t, i - 1);
        var prefix = '';
        if (t[i - 1] === '+') { var ps = strBack(t, skipWsBack(t, i - 1)); if (ps) prefix = ps.s; }
        var after = /^\s*\+\s*(["'])([^"'\n]*)\1/.exec(t.slice(re.lastIndex, re.lastIndex + 200));
        var suffix = after ? after[2] : '';
        if (!/\.m?js$/.test(suffix)) continue;   // carte CSS ou autre
        var base;
        if (pub && pub !== 'auto' && /^(?:\/|https?:)/.test(pub)) base = new URL(pub, fileUrl).href;
        else {
          var dir = fileUrl.split('?')[0].replace(/[^\/]*$/, '');
          base = prefix && dir.slice(-prefix.length) === prefix ? dir.slice(0, -prefix.length) : dir;
        }
        var hmap = parseMap(m[1]);
        Object.keys(hmap).forEach(function (id) {
          var nm = (nmap && nmap[id]) || id;
          enqueue(new URL(prefix + nm + mid.s + hmap[id] + suffix, base).href);
        });
        count++;
      }
    }

    function scanText(t, fileUrl) {
      var src = short(fileUrl), m, re;
      if (t.length > 12e6) { t = t.slice(0, 12e6); warn.push(src + ' : analyse limitee aux 12 premiers Mo'); }
      /* 1. definitions de routes : path:"..." (React Router, Vue Router, Angular, Ember...) */
      re = /["']?\bpath["']?\s*:\s*(["'`])((?:(?!\1)[^\\\n]){0,200})\1/g;
      while ((m = re.exec(t))) {
        var v = m[2], nm = null;
        var look = t.slice(re.lastIndex, re.lastIndex + 400);
        var cut = look.search(/["']?\bpath["']?\s*:/);
        if (cut >= 0) look = look.slice(0, cut);
        var nmm = /\b(?:name|title|label|breadcrumb)\s*:\s*(["'`])([^"'`\n]{1,60})\1/.exec(look);
        if (nmm) nm = nmm[2];
        if (v.indexOf('/') === 0) add('route', v, src, nm); else add('rel', v.replace(/\$\{[^}]*\}/g, ':param'), src, nm);
      }
      /* 2. dictionnaires { "/chemin": [...] } (SvelteKit, manifeste Next) */
      re = /(["'])(\/[^"'\s\\]{0,120})\1\s*:\s*\[/g;
      while ((m = re.exec(t))) add('route', m[2], src);
      re = /sortedPages\s*:\s*\[([^\]]*)\]/g;
      while ((m = re.exec(t))) (m[1].match(/(["'])(\/[^"']*)\1/g) || []).forEach(function (s) { var p = s.slice(1, -1); if (!/^\/_/.test(p)) add('route', p, src); });
      /* 3. cibles de navigation */
      re = /\b(?:to|href|redirectTo|redirect|navigate|navigateByUrl|push|replace|pathname|returnTo|returnUrl|callbackUrl|goto|link|url)\s*(?::|=|\()\s*(["'`])(\/[^"'`\s\\]{0,150})\1/g;
      while ((m = re.exec(t))) add('link', m[2], src);
      /* 4. chaines sous le prefixe */
      if (o.prefix) {
        re = new RegExp('(["\'`])(' + o.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\/?#][^"\'`\\s\\\\]{0,150})?)\\1', 'g');
        while ((m = re.exec(t))) add('str', m[2], src);
      }
      /* 5. toutes les chaines "/..." (bruit possible : classees a part) */
      if (!o.prefix || o.all) {
        re = /(["'`])(\/[a-zA-Z0-9][\w\-.~:*()\[\]@%+!=\/]{1,120})\1/g;
        while ((m = re.exec(t))) add('str', m[2], src);
      }
      /* 6. decouverte d'autres fichiers : import(), import ... from, __vite__mapDeps, chunks haches, webpack */
      re = /(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)(["'`])([^"'`\s]+?\.m?js)\1/g;
      while ((m = re.exec(t))) { var r1 = resolveSpec(m[2], fileUrl); if (r1) enqueue(r1); }
      re = /(["'])((?:\.{1,2}\/|\/)?(?:[\w\-.~@]+\/)*[\w\-.~@]+[.-][0-9A-Za-z_-]{6,}\.m?js)\1/g;
      while ((m = re.exec(t))) { var r2 = resolveSpec(m[2], fileUrl); if (r2) enqueue(r2); }
      try { webpackChunks(t, fileUrl); } catch (e) { }
    }

    function fetchText(url) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, o.timeoutMs);
      var same = false;
      try { same = new URL(url).origin === page; } catch (e) { }
      return fetch(url, { credentials: same ? 'same-origin' : 'omit', cache: 'force-cache', signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var ct = r.headers.get('content-type') || '';
          return r.text().then(function (t) { clearTimeout(timer); return { t: t, ct: ct }; });
        }, function (e) { clearTimeout(timer); throw e; });
    }
    function isHtml(res) { return /text\/html/i.test(res.ct) || /^\s*<(?:!doctype|html)/i.test(res.t.slice(0, 200)); }

    function pump() {
      return new Promise(function (resolve) {
        var active = 0;
        function over() { return st.lus + st.echecs >= o.maxFiles || st.octets >= o.maxBytes; }
        function launch(u) {
          active++;
          fetchText(u).then(function (res) {
            if (isHtml(res)) { st.htmlAuLieuDeJs++; st.echecs++; return; }
            st.lus++; st.octets += res.t.length;
            scanText(res.t, u);
          }, function (e) {
            st.echecs++;
            var cross = false;
            try { cross = new URL(u).origin !== page; } catch (x) { }
            if (cross && e && e.name === 'TypeError') st.refusesCors++;
          }).then(function () { active--; next(); });
        }
        function next() {
          while (active < o.concurrency && queue.length && !over()) launch(queue.shift());
          if (over() && queue.length) st.tronque = true;
          if (active === 0 && (!queue.length || over())) resolve();
        }
        next();
      });
    }

    /* manifestes JSON (asset-manifest CRA, manifeste Vite/Laravel, ngsw Angular, manifeste PWA) */
    function tryManifest(url, kind) {
      return fetchText(url).then(function (res) {
        if (isHtml(res)) return;
        var j;
        try { j = JSON.parse(res.t); } catch (e) { return; }
        st.lus++; st.octets += res.t.length;
        st.manifestes.push(short(url) === 'manifest.json' ? url.replace(page, '') : short(url));
        var base = url.replace(/[^\/]*$/, '');
        if (kind === 'pwa') {
          if (j.start_url) add('route', new URL(j.start_url, url).pathname, 'manifeste PWA');
          (j.shortcuts || []).forEach(function (s) { if (s && s.url) add('route', new URL(s.url, url).pathname, 'manifeste PWA', s.name); });
          return;
        }
        if (kind === 'ngsw') {
          (j.assetGroups || []).forEach(function (g) { (g.urls || []).forEach(function (u) { if (/\.m?js$/.test(u)) enqueue(new URL(u, page + '/').href); }); });
          return;
        }
        if (j.files && typeof j.files === 'object') {   // CRA asset-manifest.json
          Object.keys(j.files).forEach(function (k) { var v = j.files[k]; if (typeof v === 'string' && /\.m?js$/.test(v)) enqueue(new URL(v, base).href); });
          return;
        }
        var viteBase = /\/\.vite\/manifest\.json$/.test(url) ? url.replace(/\.vite\/manifest\.json$/, '') : base;
        Object.keys(j).forEach(function (k) {   // Vite / Laravel : { "src/pages/X.tsx": { file: "assets/X-abc.js" } }
          var e = j[k];
          if (!e || typeof e !== 'object' || typeof e.file !== 'string') return;
          if (/\.m?js$/.test(e.file)) enqueue(new URL(e.file, viteBase).href);
          var mm = /(?:^|\/)(?:pages|views|routes|screens|app)\/(.+?)\.(?:[jt]sx?|vue|svelte)$/.exec(k);
          if (mm) screens[mm[1].replace(/\/index$/, '')] = (screens[mm[1]] || 0) + 1;
        });
      }, function () { });
    }

    /* routes exposees a l'execution (lecture de proprietes, sans rien modifier) */
    function runtimeRoutes() {
      try {
        var bm = W.__BUILD_MANIFEST;
        if (bm && bm.sortedPages) { bm.sortedPages.forEach(function (p) { if (!/^\/_/.test(p)) add('route', p, 'Next __BUILD_MANIFEST'); }); st.execution.push('Next.js (__BUILD_MANIFEST)'); }
      } catch (e) { }
      try {
        var nd = W.__NEXT_DATA__;
        if (nd && nd.page) { add('route', nd.page, 'Next __NEXT_DATA__'); if (nd.buildId && !bm) enqueue(page + (nd.assetPrefix || '') + '/_next/static/' + nd.buildId + '/_buildManifest.js'); }
      } catch (e) { }
      ['__remixManifest', '__reactRouterManifest'].forEach(function (g) {
        try {
          var rm = W[g] && W[g].routes;
          if (!rm) return;
          Object.keys(rm).forEach(function (id) {
            var segs = [], r = rm[id], guard = 0;
            while (r && guard++ < 30) { if (r.path) segs.unshift(r.path); r = r.parentId ? rm[r.parentId] : null; }
            add('route', '/' + segs.join('/'), g, id);
          });
          st.execution.push(g);
        } catch (e) { }
      });
      try {
        var els = D.querySelectorAll('[data-v-app], #app, #__nuxt, #root, body > div');
        for (var i = 0; i < els.length && i < 30; i++) {
          var el = els[i];
          var app = el.__vue_app__;
          var router = app && app.config && app.config.globalProperties && app.config.globalProperties.$router;
          if (router && router.getRoutes) {
            router.getRoutes().forEach(function (rt) { add('route', rt.path.replace(/\(\.\*\)\*?/g, '*'), 'vue-router (execution)', rt.name ? String(rt.name) : null); });
            st.execution.push('vue-router 4 (getRoutes)');
            break;
          }
          var vm = el.__vue__;
          if (vm && vm.$router && vm.$router.options && vm.$router.options.routes) {
            (function walk(list, parent) {
              (list || []).forEach(function (rt) {
                var p = rt.path || '';
                var full = p[0] === '/' ? p : (parent.replace(/\/$/, '') + '/' + p);
                add('route', full, 'vue-router 2/3 (execution)', rt.name);
                walk(rt.children, full);
              });
            })(vm.$router.options.routes, '');
            st.execution.push('vue-router 2/3 (options.routes)');
            break;
          }
        }
      } catch (e) { }
    }

    function run() {
      runtimeRoutes();
      /* scripts deja charges : balises, preloads, ressources chargees, scripts en ligne */
      var initial = [];
      Array.prototype.forEach.call(D.scripts, function (s) { if (s.src) initial.push(s.src); });
      Array.prototype.forEach.call(D.querySelectorAll('link[href]'), function (l) {
        var rel = (l.getAttribute('rel') || '').toLowerCase();
        if (/modulepreload/.test(rel) || ((/preload|prefetch/.test(rel)) && (l.getAttribute('as') === 'script' || /\.m?js(\?|$)/.test(l.href)))) initial.push(l.href);
      });
      try {
        performance.getEntriesByType('resource').forEach(function (e) { if (e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)) initial.push(e.name); });
      } catch (e) { }
      initial = uniq(initial);
      st.scriptsInitiaux = initial.length;
      initial.forEach(function (u) {
        try {
          var url = new URL(u, location.href);
          if (url.origin !== page && BUILDISH.test(url.pathname) && !THIRD.test(url.hostname + '.')) fileOrigins[url.origin] = 1;
        } catch (e) { }
      });
      /* les scripts de l'appli d'abord, ceux qui ressemblent a des bibliotheques ensuite */
      initial.sort(function (a, b) {
        var va = /vendor|polyfill|framework|runtime~|npm\./i.test(a) ? 1 : 0, vb = /vendor|polyfill|framework|runtime~|npm\./i.test(b) ? 1 : 0;
        return va - vb;
      });
      initial.forEach(function (u) { enqueue(u, true); });
      Array.prototype.forEach.call(D.querySelectorAll('script:not([src])'), function (s, i) {
        if (s.type && !/javascript|module|json/i.test(s.type)) return;
        var t = s.textContent || '';
        if (t.length > 20 && t.length < 5e6) { st.octets += t.length; scanText(t, location.href.split('#')[0].split('?')[0] + '#inline' + i); }
      });
      if (!/^https?:$/.test(location.protocol)) warn.push('Page servie en ' + location.protocol + ' : la lecture des fichiers par fetch peut etre refusee (Electron file://). Se fier alors au DOM et a __inventory().');
      /* manifestes candidats (un 404 ou une page HTML de repli est simplement ignore) */
      var bases = ['/'];
      initial.forEach(function (u) {
        try {
          var url = new URL(u, location.href);
          if (url.origin !== page) return;
          var mm = /^(.*?\/)(?:static\/js|assets|js|build|_next)\//.exec(url.pathname);
          if (mm) bases.push(mm[1]);
        } catch (e) { }
      });
      bases = uniq(bases).slice(0, 3);
      var man = [];
      bases.forEach(function (b) {
        man.push([page + b + 'asset-manifest.json', 'cra']);
        man.push([page + b + '.vite/manifest.json', 'vite']);
      });
      man.push([page + '/build/manifest.json', 'vite']);
      man.push([page + '/ngsw.json', 'ngsw']);
      var pwa = D.querySelector('link[rel="manifest"]');
      if (pwa && pwa.href) man.push([pwa.href, 'pwa']);
      var mseen = {};
      man = man.filter(function (x) { if (mseen[x[0]]) return false; mseen[x[0]] = 1; return true; });
      return Promise.all(man.map(function (x) { return tryManifest(x[0], x[1]); })).then(pump).then(finish);
    }

    function finish() {
      var all = Object.keys(items).map(function (k) { return items[k]; });
      var inPrefix = function (p) { return !o.prefix || p === o.prefix || p.indexOf(o.prefix + '/') === 0; };
      var horsPrefixe = 0;
      var byKind = { route: [], rel: [], link: [], str: [] };
      var routeSet = {}, linkSet = {};
      all.forEach(function (it) {
        if (it.kind !== 'rel' && !inPrefix(it.p)) { horsPrefixe++; return; }
        byKind[it.kind].push(it);
      });
      byKind.route.forEach(function (it) { routeSet[it.p] = 1; });
      byKind.link = byKind.link.filter(function (it) { return !routeSet[it.p]; });
      byKind.link.forEach(function (it) { linkSet[it.p] = 1; });
      byKind.str = byKind.str.filter(function (it) { return !routeSet[it.p] && !linkSet[it.p]; });
      var alpha = function (a, b) { return a.p < b.p ? -1 : a.p > b.p ? 1 : 0; };
      var freq = function (a, b) { return (b.n - a.n) || alpha(a, b); };
      byKind.route.sort(alpha); byKind.link.sort(alpha); byKind.rel.sort(freq); byKind.str.sort(freq);
      var cap = function (a) { return a.slice(0, o.maxList); };
      var paths = function (a) { return cap(a).map(function (it) { return it.p; }); };
      var guesses = [];
      if (o.prefix) byKind.rel.forEach(function (it) { if (it.p !== '*' && it.p !== '**') { var g = o.prefix + '/' + it.p; if (!routeSet[g]) guesses.push(g); } });
      var nm = {};
      byKind.route.concat(byKind.rel).forEach(function (it) { if (names[it.p]) nm[it.p] = names[it.p]; });
      var dyn = byKind.route.concat(byKind.link).filter(function (it) { return /[:*\[]/.test(it.p); }).map(function (it) { return it.p; });
      var scr = Object.keys(screens).sort();
      /* routes a ne jamais visiter pendant la reconnaissance (effet de bord possible, meme en simple GET :
         deconnexion, flux OAuth, telechargement, changement d'espace de travail...). Segment = verbe seul, ou verbe
         suivi de -/_ (sauf vue de consultation : order-history, test-results, payment-details...).
         Filtre HEURISTIQUE : un segment verbal absent de la liste se soumet a l'utilisateur avant visite. */
      var RISKY = /(?:^|\/)(?:log-?out|log-?off|sign-?out|deconnexion|se-deconnecter|disconnect|delete|remove|destroy|supprimer|unsubscribe|subscribe|desabonnement|desinscription|cancel|annuler|resilier|checkout|pay(?:ment)?|paiement|payer|purchase|buy|order|commander|upgrade|downgrade|reset|revoke|impersonate|invite|accept|confirm|verify|activate|deactivate|enable|disable|close-account|leave|connect|oauth2?|authorize|callback|install|uninstall|export|exporter|import|importer|download|telecharger|sync|approve|reject|refund|transfer|claim|redeem|join|switch|send|resend|envoyer|share|partager|publish|unpublish|publier|archive|unarchive|archiver|restore|duplicate|generate|regenerate|rotate|reveal|test|trigger|run|execute|start|stop|print|merge|refresh)(?:\/|$|[-_](?!(?:history|historique|list|logs?|results?|status|details?|preview|overview)(?:[\/_-]|$)))/i;
      var risky = uniq(byKind.route.concat(byKind.link, byKind.str).map(function (it) { return it.p; }).concat(guesses).filter(function (p) { return RISKY.test(p); }));
      if (st.refusesCors) warn.push(st.refusesCors + ' fichier(s) d\'une autre origine refuses (CORS) : ajouter rien de plus ; lire ces bundles via CDP si necessaire, ou se fier a la visite des ecrans.');
      if (st.htmlAuLieuDeJs) warn.push(st.htmlAuLieuDeJs + ' URL(s) de chunk ont renvoye une page HTML (repli de la SPA) : chunks devines inexistants, sans consequence.');
      if (st.tronque) warn.push('Lecture arretee par maxFiles/maxBytes : relancer avec { maxFiles: 300 } si des sections manquent.');
      if (!byKind.route.length && !byKind.rel.length) warn.push('Aucune definition de route trouvee : appli multipage, routes calculees, ou bundles illisibles. Utiliser __inventory() sur chaque ecran (liens de navigation).');
      var res = {
        ok: true, version: VERSION, origine: page, page: location.pathname,
        routeur: /^#!?\//.test(location.hash) ? 'hash (#/...)' : 'history',
        prefixe: o.prefix || null,
        sources: { manifestes: st.manifestes, execution: uniq(st.execution), scriptsInitiaux: st.scriptsInitiaux, lus: st.lus, echecs: st.echecs, htmlAuLieuDeJs: st.htmlAuLieuDeJs, refusesCors: st.refusesCors, tiersIgnores: st.tiersIgnores, octets: st.octets, ms: Date.now() - t0, tronque: st.tronque },
        compte: { routes: byKind.route.length, relatives: byKind.rel.length, liens: byKind.link.length, chaines: byKind.str.length, horsPrefixe: horsPrefixe },
        routes: paths(byKind.route),
        relatives: paths(byKind.rel),
        aVerifier: cap(uniq(guesses)),
        liens: paths(byKind.link),
        chaines: paths(byKind.str).slice(0, Math.min(o.maxList, 150)),
        dynamiques: cap(uniq(dyn)),
        aEviter: cap(risky),
        noms: nm,
        ecrans: scr.slice(0, 150),
        avertissements: warn.slice(0, 20)
      };
      if (o.detail) res.detail = cap(byKind.route.concat(byKind.link)).map(function (it) { return { p: it.p, k: it.kind, n: it.n, src: Object.keys(it.files).slice(0, 3) }; });
      return res;
    }

    return run().then(function (res) { W.__ROUTES = res; W.__ROUTES_STATE = 'fini'; return res; }, function (e) {
      W.__ROUTES = { ok: false, erreur: String((e && e.message) || e) };
      W.__ROUTES_STATE = 'erreur';
      return W.__ROUTES;
    });
  };

  W.__routesText = function () {
    var r = W.__ROUTES;
    if (!r) return 'Lancer d\'abord __routes(...)';
    if (!r.ok) return 'ERREUR ' + r.erreur;
    var L = [];
    var s = r.sources;
    L.push('ROUTES ' + r.origine + (r.prefixe ? ' (prefixe ' + r.prefixe + ')' : '') + ' ; routeur ' + r.routeur);
    L.push('lus ' + s.lus + ' fichiers (' + Math.round(s.octets / 1e4) / 100 + ' Mo), echecs ' + s.echecs + ', ' + s.ms + ' ms' + (s.manifestes.length ? ' ; manifestes : ' + s.manifestes.join(', ') : '') + (s.execution.length ? ' ; execution : ' + s.execution.join(', ') : '') + (s.tronque ? ' ; TRONQUE' : ''));
    function block(title, list, withNames) {
      if (!list || !list.length) return;
      L.push('[' + title + ' : ' + list.length + ']');
      list.forEach(function (p) { L.push(withNames && r.noms[p] ? p + '  (' + r.noms[p] + ')' : p); });
    }
    block('routes', r.routes, true);
    if (r.relatives.length) L.push('[relatives : ' + r.relatives.length + '] ' + r.relatives.join(', '));
    block('a verifier (prefixe + relative)', r.aVerifier);
    block('liens', r.liens);
    block('chaines', r.chaines);
    block('A NE PAS VISITER (effet de bord possible)', r.aEviter);
    if (r.ecrans.length) L.push('[ecrans presumes (noms de chunks) : ' + r.ecrans.length + '] ' + r.ecrans.join(', '));
    if (r.avertissements.length) L.push('[avertissements] ' + r.avertissements.join(' | '));
    return L.join('\n');
  };

  /* ------------------------------------------------------------------ __routeStatus */
  W.__routeStatus = function (attendue) {
    var body = ((D.body && D.body.innerText) || '').trim();
    var h = D.querySelector('h1') || D.querySelector('h2');
    var head = [D.title, h ? h.textContent : ''].join(' ');
    var NF = /\b404\b|not found|introuvable|non trouv|n['\u2019]existe pas|page not found|nicht gefunden|no encontrada|does not exist/i;
    var notFound = NF.test(head) || (body.length < 600 && NF.test(body));
    var path = location.pathname + hashRoute();
    /* ecran de connexion : un champ mot de passe VISIBLE et (URL d'authentification ou page sans navigation).
       Un formulaire de changement de mot de passe dans les parametres (barre laterale presente) n'en est pas un. */
    var pw = Array.prototype.filter.call(D.querySelectorAll('input[type=password]'), function (i) { return i.getClientRects().length > 0; }).length;
    var authUrl = /(?:^|[\/#._-])(?:log-?in|sign-?in|connexion|se-connecter|auth|oauth|sso|session|identification)(?:[\/#?._-]|$)/i.test(path);
    var navLinks = 0;
    try { navLinks = D.querySelectorAll('nav a[href], aside a[href], [role=navigation] a[href], [class*="sidebar" i] a[href]').length; } catch (e) { }
    var login = pw > 0 && (authUrl || navLinks < 3);
    var r = {
      route: path, titre: D.title, h1: h ? mask(h.textContent) : null,
      introuvable: notFound, connexion: login,
      dialogues: D.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true]').length,
      etat: D.readyState, texte: body.length
    };
    if (pw && !login) r.champsMotDePasse = pw + ' (formulaire dans la page, pas un ecran de connexion : ne rien saisir)';
    if (attendue) {
      /* une URL complete est acceptee : seul son chemin (et son #/route) compte ; '#/x' seul = page courante + #/x.
         Chemin ET route a hachage sont compares : '#/a' -> '#/b' est une redirection. */
      var att = String(attendue);
      try { if (/^[a-z][\w+.-]*:\/\//i.test(att)) { var au = new URL(att); att = au.pathname + (/^#!?\//.test(au.hash) ? au.hash : ''); } } catch (e) { }
      r.attendue = attendue;
      r.redirection = normFull(att) !== normFull(path);
    }
    r.statut = notFound ? '404' : login ? 'connexion' : r.redirection ? 'redirection' : body.length < 40 ? 'chargement ? (rien d\'affiche : attendre puis relancer)' : 'ok';
    return r;
  };

  /* ------------------------------------------------------------------ __stack */
  W.__stack = function () {
    var out = { url: location.origin + location.pathname, titre: D.title, langue: D.documentElement.lang || null,
      viewport: innerWidth + 'x' + innerHeight + ' @' + (W.devicePixelRatio || 1), routeur: /^#!?\//.test(location.hash) ? 'hash' : 'history',
      frameworks: [], css: [], composants: [], icones: [], graphiques: [], editeurs: [], tiers: [], polices: {}, couleurs: {}, variablesRacine: {}, alertes: [] };
    function F(list, label) { if (out[list].indexOf(label) === -1) out[list].push(label); }
    function q(sel) { try { return D.querySelector(sel); } catch (e) { return null; } }
    function n(sel) { try { return D.querySelectorAll(sel).length; } catch (e) { return 0; } }
    var all = D.querySelectorAll('body *'), N = Math.min(all.length, 4000);
    var tok = {}, ntok = 0, i, j;
    for (i = 0; i < N; i++) {
      var c = all[i].getAttribute('class');
      if (c) { var ts = c.split(/\s+/); for (j = 0; j < ts.length; j++) if (ts[j]) { tok[ts[j]] = (tok[ts[j]] || 0) + 1; ntok++; } }
    }
    var keys = Object.keys(tok);
    function share(re) { var k = 0; for (var x = 0; x < keys.length; x++) if (re.test(keys[x])) k += tok[keys[x]]; return ntok ? k / ntok : 0; }
    function any(re) { for (var x = 0; x < keys.length; x++) if (re.test(keys[x])) return true; return false; }
    var scripts = Array.prototype.map.call(D.scripts, function (s) { return s.src || ''; }).join(' ');
    try {
      /* frameworks */
      var react = false;
      for (i = 0; i < Math.min(N, 400) && !react; i++) { var ks = Object.keys(all[i]); for (j = 0; j < ks.length; j++) if (/^__react(Fiber|Props|Container)\$|^_reactRootContainer/.test(ks[j])) { react = true; break; } }
      var rootEl = q('#root') || q('#app') || q('#__next');
      if (!react && rootEl) react = Object.keys(rootEl).some(function (k) { return /^__react|^_reactRoot/.test(k); });
      if (react) F('frameworks', 'React');
      if (W.__NEXT_DATA__) F('frameworks', 'Next.js (pages router)'); else if (W.__next_f || q('#__next')) F('frameworks', 'Next.js' + (W.__next_f ? ' (app router)' : ''));
      if (W.__remixContext) F('frameworks', 'Remix');
      if (W.__reactRouterContext) F('frameworks', 'React Router 7 (mode framework)');
      if (q('#___gatsby')) F('frameworks', 'Gatsby');
      var vueApp = q('[data-v-app]') || rootEl;
      if ((vueApp && vueApp.__vue_app__) || W.__VUE__) F('frameworks', 'Vue 3'); else if (vueApp && vueApp.__vue__) F('frameworks', 'Vue 2');
      else if (Array.prototype.some.call(Array.prototype.slice.call(all, 0, 300), function (e) { return Array.prototype.some.call(e.attributes, function (a) { return a.name.indexOf('data-v-') === 0; }); })) F('frameworks', 'Vue (attributs data-v-)');
      if (W.__NUXT__ || W.useNuxtApp || q('#__nuxt')) F('frameworks', 'Nuxt');
      var ng = q('[ng-version]');
      if (ng) F('frameworks', 'Angular ' + ng.getAttribute('ng-version'));
      if (W.angular && q('[ng-app],[data-ng-app],.ng-scope')) F('frameworks', 'AngularJS 1.x');
      if (any(/^svelte-[a-z0-9]+$/)) F('frameworks', 'Svelte');
      if (Object.keys(W).some(function (k) { return k.indexOf('__sveltekit') === 0; }) || q('[data-sveltekit-preload-data],[data-sveltekit-reload]')) F('frameworks', 'SvelteKit');
      if (W._$HY) F('frameworks', 'SolidJS');
      if (q('astro-island')) F('frameworks', 'Astro');
      if (rootEl && rootEl.getAttribute && rootEl.getAttribute('data-page')) F('frameworks', 'Inertia.js (Laravel ?)');
      if (W.Livewire) F('frameworks', 'Livewire');
      if (W.Alpine || q('[x-data]')) F('frameworks', 'Alpine.js');
      if (W.htmx) F('frameworks', 'htmx');
      if (W.Ember) F('frameworks', 'Ember');
      if (W.Blazor) F('frameworks', 'Blazor');
      if (W.Ext && W.Ext.version) F('frameworks', 'Ext JS');
      if (W.jQuery && W.jQuery.fn) F('frameworks', 'jQuery ' + W.jQuery.fn.jquery);
      if (q('flutter-view,flt-glass-pane,flt-scene-host')) { F('frameworks', 'Flutter Web'); out.alertes.push('Flutter Web : interface dessinee dans un canvas, DOM inexploitable -> captures d\'ecran.'); }
      if (q('html[data-wf-site]')) F('frameworks', 'Webflow');
      var gen = q('meta[name=generator]');
      if (gen) F('frameworks', 'generator : ' + clip(gen.getAttribute('content'), 40));
      if (/Electron\//.test(navigator.userAgent)) F('frameworks', 'Electron (' + (/Electron\/[\d.]+/.exec(navigator.userAgent) || [''])[0] + ')');
      if (W.chrome && W.chrome.webview) F('frameworks', 'WebView2');
      if (W.__TAURI__ || W.__TAURI_INTERNALS__) F('frameworks', 'Tauri');
      /* CSS */
      var tw = share(/^(?:[a-z0-9-]+:)*-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|size|min-w|max-w|min-h|max-h|gap|gap-x|gap-y|space-x|space-y|text|bg|border|border-[trblxy]|rounded|rounded-[trbl]{1,2}|font|leading|tracking|shadow|opacity|z|inset|top|left|right|bottom|overflow|cursor|transition|duration|ease|grid-cols|col-span|flex|items|justify|self|place|order|ring|fill|stroke|translate-x|translate-y|scale|rotate)(?:-[\w.\/\[\]#%(),]+)?$|^(?:[a-z0-9-]+:)*(?:flex|grid|hidden|block|inline-block|inline-flex|relative|absolute|fixed|sticky|truncate|uppercase|italic|underline|sr-only)$/);
      var twVar = '';
      try { twVar = getComputedStyle(D.body).getPropertyValue('--tw-ring-offset-width') || getComputedStyle(D.body).getPropertyValue('--tw-border-spacing-x'); } catch (e) { }
      var twv4 = false;
      try { twv4 = !!getComputedStyle(D.documentElement).getPropertyValue('--color-gray-500') || !!getComputedStyle(D.documentElement).getPropertyValue('--color-neutral-500'); } catch (e) { }
      var bs = '';
      try { bs = getComputedStyle(D.documentElement).getPropertyValue('--bs-body-bg') || getComputedStyle(D.documentElement).getPropertyValue('--bs-blue'); } catch (e) { }
      var bsCls = !!(tok.btn && (tok.container || tok.row) && any(/^col-(?:sm|md|lg|xl)?-?\d+$/));
      /* p-4, flex, text-center... existent aussi dans Bootstrap : Tailwind seulement avec un indice propre (variable
         --tw-*, prefixe de variante md:/hover:..., valeur arbitraire [..]) ou un echantillon >= 200 classes sans Bootstrap */
      var twArb = any(/\[[^\]]+\]$/), twVariant = any(/^(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|first|last|odd|even|placeholder|group-[\w-]+|peer-[\w-]+|aria-[\w-]+|data-\[[^\]]+\]):/);
      if (twVar || (tw > 0.25 && (twArb || twVariant || (ntok >= 200 && !bs && !bsCls)))) F('css', 'Tailwind CSS ' + (twv4 ? 'v4' : twVar ? 'v3' : '?') + ' (' + Math.round(tw * 100) + ' % des classes' + (twArb ? ', valeurs arbitraires' : '') + ')');
      else if (tw > 0.25 && !bs && !bsCls) F('css', 'classes utilitaires (' + Math.round(tw * 100) + ' % de ' + ntok + ' classes) : Tailwind ou Bootstrap ? a confirmer');
      if (/cdn\.tailwindcss\.com/.test(scripts)) F('css', 'Tailwind Play CDN');
      if (any(/^Mui[A-Z]/)) F('css', 'MUI (Material UI)');
      if (any(/^chakra-/)) F('css', 'Chakra UI');
      if (any(/^ant-/)) F('css', 'Ant Design');
      if (any(/^mantine-|^m_[0-9a-f]{8}$/)) F('css', 'Mantine');
      if (bs || bsCls) F('css', 'Bootstrap' + (bs ? ' 5' : ''));
      if (tok.columns && tok.column && any(/^is-(?:primary|info|success)$/)) F('css', 'Bulma');
      if (any(/^v-(?:application|btn|card)\b/)) F('css', 'Vuetify');
      if (any(/^q-(?:btn|layout|page)/)) F('css', 'Quasar');
      if (any(/^el-(?:button|input|table)/)) F('css', 'Element Plus / Element UI');
      if (any(/^p-(?:button|component|datatable|inputtext)$/)) F('css', 'PrimeReact / PrimeVue');
      if (any(/^fui-/)) F('css', 'Fluent UI v9');
      if (any(/^ms-(?:Button|Fabric|TextField)/)) F('css', 'Fluent UI (Fabric)');
      if (any(/^(?:bx|cds)--/)) F('css', 'Carbon (IBM)');
      if (any(/^slds-/)) F('css', 'Salesforce Lightning');
      if (any(/^bp[3-6]-/)) F('css', 'Blueprint');
      if (q('style[data-styled]') || any(/^sc-[a-zA-Z]{5,}$/)) F('css', 'styled-components');
      if (q('style[data-emotion]') || any(/^css-[a-z0-9]{5,8}$/)) F('css', 'Emotion');
      if (any(/^[A-Za-z][\w-]*_[\w-]+__[\w-]{5}$/) || any(/^_[a-zA-Z0-9]{5,}_\d+$/)) F('css', 'CSS Modules');
      /* composants */
      if (q('[data-radix-popper-content-wrapper],[data-radix-collection-item],[id^="radix-"]') || n('[data-state][data-orientation]')) F('composants', 'Radix UI');
      if (q('[data-headlessui-state],[id^="headlessui-"]')) F('composants', 'Headless UI');
      if (q('[data-rac]')) F('composants', 'React Aria Components');
      if (q('[data-scope][data-part]')) F('composants', 'Ark UI / Zag');
      try { if (out.composants.indexOf('Radix UI') !== -1 && /tailwind/i.test(out.css.join(' ')) && getComputedStyle(D.documentElement).getPropertyValue('--radius')) F('composants', 'shadcn/ui (probable)'); } catch (e) { }
      /* icones */
      if (q('svg.tabler-icon,svg[class*="tabler-icon"],i[class*="ti-"]')) F('icones', 'Tabler');
      if (q('svg.lucide,svg[class*="lucide-"]')) F('icones', 'Lucide');
      if (q('svg[data-slot="icon"]')) F('icones', 'Heroicons (v2)');
      if (q('svg.svg-inline--fa,i.fa,i[class*="fa-"]')) F('icones', 'Font Awesome');
      if (q('.material-icons,.material-icons-outlined,[class*="material-symbols"]')) F('icones', 'Material Icons / Symbols');
      if (q('svg[data-testid$="Icon"].MuiSvgIcon-root,svg.MuiSvgIcon-root')) F('icones', 'MUI Icons');
      if (q('svg.feather,svg[class*="feather-"]')) F('icones', 'Feather');
      if (q('i[class^="bi-"],i[class*=" bi-"]')) F('icones', 'Bootstrap Icons');
      if (q('i[class^="ri-"],i[class*=" ri-"]')) F('icones', 'Remix Icon');
      if (q('i[class^="ph"],svg[class*="phosphor"]')) F('icones', 'Phosphor');
      if (q('iconify-icon,svg.iconify,span.iconify')) F('icones', 'Iconify');
      if (q('ion-icon')) F('icones', 'Ionicons');
      /* Tabler sans classe : chemin de cadrage invisible propre a ce jeu (Material a le meme d, mais sans stroke="none") */
      if (out.icones.indexOf('Tabler') === -1 && q('svg[stroke] > path[stroke="none"][d="M0 0h24v24H0z"]')) F('icones', 'Tabler (signature du chemin M0 0h24v24H0z)');
      if (!out.icones.length && n('svg') > 5) {
        var trait24 = n('svg[viewBox="0 0 24 24"][fill="none"][stroke="currentColor"]');
        F('icones', n('svg') + ' SVG inline (jeu non reconnu' + (trait24 ? ', dont ' + trait24 + ' au trait 24x24 : style Tabler / Lucide / Feather' : '') + ' : comparer les chemins)');
      }
      /* graphiques, grilles, editeurs, cartes */
      if (q('.recharts-wrapper')) F('graphiques', 'Recharts');
      if (W.Chart && q('canvas')) F('graphiques', 'Chart.js');
      if (q('.apexcharts-canvas')) F('graphiques', 'ApexCharts');
      if (q('.highcharts-container')) F('graphiques', 'Highcharts');
      if (q('[_echarts_instance_]')) F('graphiques', 'ECharts');
      if (q('.js-plotly-plot')) F('graphiques', 'Plotly');
      if (W.d3 && W.d3.version) F('graphiques', 'D3 ' + W.d3.version);
      if (q('.ag-root-wrapper')) F('graphiques', 'AG Grid (tableau)');
      if (q('.MuiDataGrid-root')) F('graphiques', 'MUI DataGrid (tableau)');
      if (q('.monaco-editor')) F('editeurs', 'Monaco');
      if (q('.cm-editor,.CodeMirror')) F('editeurs', 'CodeMirror');
      if (q('.ql-editor')) F('editeurs', 'Quill');
      if (q('.ProseMirror')) F('editeurs', 'ProseMirror / Tiptap');
      if (q('[data-slate-editor]')) F('editeurs', 'Slate');
      if (q('[data-lexical-editor]')) F('editeurs', 'Lexical');
      if (q('.leaflet-container')) F('graphiques', 'Leaflet (carte)');
      if (q('.mapboxgl-map,.maplibregl-map')) F('graphiques', 'Mapbox / MapLibre (carte)');
      if (q('.gm-style')) F('graphiques', 'Google Maps');
      /* widgets tiers */
      var T = [['Intercom', W.Intercom || q('#intercom-container,.intercom-launcher,.intercom-lightweight-app')], ['Crisp', W.$crisp], ['HubSpot', q('#hubspot-messages-iframe-container')], ['Zendesk', W.zE], ['Drift', W.drift], ['Tawk.to', W.Tawk_API], ['Wistia', W.Wistia || q('[class*="wistia"]')], ['YouTube', q('iframe[src*="youtube"]')], ['Vimeo', q('iframe[src*="vimeo"]')], ['Calendly', W.Calendly], ['Stripe', W.Stripe], ['Sentry', W.__SENTRY__ || W.Sentry], ['Google Tag Manager', W.google_tag_manager], ['Segment', W.analytics && W.analytics.track], ['PostHog', W.posthog], ['Hotjar', W.hj], ['Microsoft Clarity', W.clarity], ['Mixpanel', W.mixpanel], ['Amplitude', W.amplitude], ['FullStory', W.FS], ['LogRocket', W.LogRocket], ['OneTrust', W.OneTrust], ['Cookiebot', W.Cookiebot], ['Axeptio', W.axeptioSDK || W._axcb], ['Didomi', W.Didomi], ['tarteaucitron', W.tarteaucitron]];
      T.forEach(function (x) { if (x[1]) F('tiers', x[0]); });
      /* polices */
      var bcs = getComputedStyle(D.body);
      out.polices.corps = bcs.fontFamily + ' ; ' + bcs.fontSize + ' ; couleur ' + hex(bcs.color);
      var fams = {};
      try { D.fonts.forEach(function (f) { if (f.status === 'loaded') fams[f.family.replace(/["']/g, '')] = 1; }); } catch (e) { }
      out.polices.chargees = Object.keys(fams).slice(0, 15);
      out.polices.liens = Array.prototype.map.call(D.querySelectorAll('link[href*="fonts.googleapis"],link[href*="typekit"],link[href*="fonts.bunny"]'), function (l) { return l.href.replace(/^https?:\/\//, ''); }).slice(0, 5);
      /* couleurs dominantes (elements visibles) */
      var bg = {}, fg = {}, bd = {};
      var cnt = 0;
      for (i = 0; i < all.length && cnt < 1500; i++) {
        var el = all[i];
        if (!el.getClientRects().length) continue;
        cnt++;
        var cs = getComputedStyle(el);
        var b = hex(cs.backgroundColor);
        if (b && b !== 'transparent') bg[b] = (bg[b] || 0) + 1;
        if (el.childNodes.length && Array.prototype.some.call(el.childNodes, function (nd) { return nd.nodeType === 3 && nd.nodeValue.trim(); })) { var f = hex(cs.color); fg[f] = (fg[f] || 0) + 1; }
        if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') { var d = hex(cs.borderTopColor); bd[d] = (bd[d] || 0) + 1; }
      }
      function top(m, k) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, k).map(function (x) { return x + ' x' + m[x]; }); }
      out.couleurs = { fonds: top(bg, 10), textes: top(fg, 10), bordures: top(bd, 6), echantillon: cnt };
      /* variables CSS de :root (feuilles lisibles) */
      var vars = {}, nv = 0;
      Array.prototype.forEach.call(D.styleSheets, function (sh) {
        var rules;
        try { rules = sh.cssRules; } catch (e) { return; }
        (function walk(rs) {
          Array.prototype.forEach.call(rs || [], function (r) {
            if (nv >= 60) return;
            if (r.cssRules && !r.selectorText) walk(r.cssRules);
            if (r.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText) && r.style) {
              for (var x = 0; x < r.style.length && nv < 60; x++) { var p = r.style[x]; if (p.indexOf('--') === 0 && p.indexOf('--tw-') !== 0 && !vars[p]) { vars[p] = clip(r.style.getPropertyValue(p), 60); nv++; } }
            }
          });
        })(rules);
      });
      out.variablesRacine = vars;
      /* alertes */
      var vw = innerWidth * innerHeight, big = 0;
      Array.prototype.forEach.call(D.querySelectorAll('canvas'), function (cv) { var r = cv.getBoundingClientRect(); if (r.width * r.height > vw * 0.3) big++; });
      if (big) out.alertes.push(big + ' grand(s) canvas : contenu dessine (graphique, carte, editeur graphique) a recreer a partir des captures.');
      var ifr = Array.prototype.map.call(D.querySelectorAll('iframe'), function (f) { try { return new URL(f.src, location.href).host || 'about:blank'; } catch (e) { return '?'; } });
      if (ifr.length) out.alertes.push('iframes : ' + uniq(ifr).slice(0, 8).join(', ') + ' (contenu d\'une autre origine non capturable par le DOM)');
      var shadow = 0;
      for (i = 0; i < N; i++) if (all[i].shadowRoot) shadow++;
      if (shadow) out.alertes.push(shadow + ' element(s) avec shadow DOM ouvert (Web Components) : le kit de capture ne descend pas dedans.');
      if (n('[role=dialog],[aria-modal=true]')) out.alertes.push('Une modale est ouverte : la fermer avant de mesurer la page.');
    } catch (e) { out.alertes.push('Erreur de detection : ' + e.message); }
    return out;
  };

  /* ------------------------------------------------------------------ __inventory */
  W.__inventory = function (opts) {
    opts = opts || {};
    var lim = opts.max || 60;
    var here = location.pathname + hashRoute();
    function visible(el) { return !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'; }
    function label(el) { return mask(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('value') || ''); }
    function internal(a) {
      var href = a.getAttribute('href');
      if (!href || /^(mailto|tel|javascript):/i.test(href)) return null;
      try { var u = new URL(href, location.href); if (u.origin !== location.origin) return null; return u.pathname + (/^#!?\//.test(u.hash) ? u.hash : ''); } catch (e) { return null; }
    }
    function pattern(p) { return p.split('/').map(function (s) { return /^\d+$|^[0-9a-f]{8}-[0-9a-f-]{27,}$|^[0-9a-f]{20,}$|^[A-Za-z0-9_-]{22,}$/i.test(s) ? ':id' : s; }).join('/'); }
    var navSel = 'nav, aside, header, [role=navigation], [role=menubar], [class*="sidebar" i], [class*="sidenav" i], [class*="navbar" i], [id*="sidebar" i]';
    var navRoots = Array.prototype.slice.call(D.querySelectorAll(navSel));
    function inNav(el) { return navRoots.some(function (r) { return r.contains(el); }); }
    var out = { route: here, titre: D.title, viewport: innerWidth + 'x' + innerHeight, titres: [], navigation: [], boutonsNavigation: [], liensInternes: {}, onglets: [], menus: [], accordeons: [], etatsCandidats: [], nePasCliquer: [], interrupteurs: 0, formulaires: null, tableaux: [], infobulles: 0, dialoguesOuverts: [], defilement: null, iframes: [] };
    Array.prototype.forEach.call(D.querySelectorAll('h1, h2, h3'), function (h) { if (out.titres.length < 15 && visible(h)) out.titres.push(h.tagName.toLowerCase() + ' ' + mask(h.textContent)); });
    var seenNav = {};
    Array.prototype.forEach.call(D.querySelectorAll('a[href]'), function (a) {
      var p = internal(a);
      if (!p) return;
      if (inNav(a)) {
        var t = label(a), k = p + '|' + t;
        if (seenNav[k] || out.navigation.length >= lim * 2) return;
        seenNav[k] = 1;
        var ac = a.getAttribute('aria-current');
        var act = (ac && ac !== 'false') || /(^|\s|-)(active|selected|current)(\s|$)/i.test(a.className && a.className.baseVal === undefined ? a.className : '') || normFull(p) === normFull(here);
        out.navigation.push((act ? '* ' : '') + p + (t ? '  ' + t : '') + (visible(a) ? '' : '  (masque)'));
      } else {
        var pt = pattern(p);
        out.liensInternes[pt] = (out.liensInternes[pt] || 0) + 1;
      }
    });
    navRoots.forEach(function (r) {
      Array.prototype.forEach.call(r.querySelectorAll('button, [role=button], [role=menuitem]'), function (b) {
        var t = label(b);
        if (t && out.boutonsNavigation.length < lim && out.boutonsNavigation.indexOf(t) === -1) out.boutonsNavigation.push(t);
      });
    });
    /* listes dedoublonnees avec compteur (ex. 5 editeurs identiques -> "App.js  x5") */
    function counter() {
      var m = {}, order = [];
      return {
        add: function (t) { if (!Object.prototype.hasOwnProperty.call(m, t)) { m[t] = 0; order.push(t); } m[t]++; },
        list: function () { return order.slice(0, lim).map(function (t) { return m[t] > 1 ? t + '  x' + m[t] : t; }); }
      };
    }
    var cTabs = counter(), cMenus = counter(), cAcc = counter();
    Array.prototype.forEach.call(D.querySelectorAll('[role=tab], .nav-tabs a, .nav-tabs button'), function (t) {
      var sel = t.getAttribute('aria-selected') === 'true' || t.getAttribute('data-state') === 'active' || /(^|\s)active(\s|$)/.test(t.className || '');
      cTabs.add((sel ? '* ' : '') + label(t));
    });
    Array.prototype.forEach.call(D.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded]'), function (b) {
      if (!visible(b)) return;
      var t = label(b) || '(sans texte)';
      var hp = b.getAttribute('aria-haspopup');
      var desc = t + (b.getAttribute('aria-expanded') === 'true' ? ' [ouvert]' : '');
      if (hp && hp !== 'false') cMenus.add(desc + (hp !== 'true' ? ' (' + hp + ')' : ''));
      else cAcc.add(desc);
    });
    out.onglets = cTabs.list(); out.menus = cMenus.list(); out.accordeons = cAcc.list();
    var CREATE = /^(?:\+\s*)?(nouve(?:au|l|lle)|ajouter|cr[\u00e9e]er|modifier|[\u00e9e]diter|importer|inviter|configurer|param[\u00e8e]tres|filtres?|trier|voir|afficher|d[\u00e9e]tails?|aper[\u00e7c]u|plus|new|add|create|edit|import|invite|settings|filters?|sort|view|show|details?|preview|more)\b/i;
    /* verbes d'action (regles.md section 4), mot entier, accents compris ; "Annuler" / "Cancel" SEULS ferment une
       boite de dialogue et restent permis, "Annuler le rendez-vous" est interdit */
    var DANGER = /(?:^|[^\w\u00c0-\u024f])(supprimer|effacer|retirer|archiver|d[\u00e9e]sarchiver|d[\u00e9e]sactiver|activer|d[\u00e9e]connect(?:er)?|d[\u00e9e]connexion|se d[\u00e9e]connecter|connexion|reconnecter|envoyer|renvoyer|publier|d[\u00e9e]publier|partager|payer|acheter|commander|s['\u2019]abonner|se d[\u00e9e]sabonner|d[\u00e9e]sabonner|abonnement|s['\u2019]inscrire|se d[\u00e9e]sinscrire|r[\u00e9e]silier|fermer (?:le |mon |votre )?compte|upgrade|mettre [\u00e0a] niveau|mettre [\u00e0a] jour|enregistrer|sauvegarder|valider|confirmer|soumettre|appliquer|inviter|importer|exporter|t[\u00e9e]l[\u00e9e]charger|t[\u00e9e]l[\u00e9e]verser|connecter|synchroniser|r[\u00e9e]g[\u00e9e]n[\u00e9e]rer|g[\u00e9e]n[\u00e9e]rer|r[\u00e9e]v[\u00e9e]ler|dupliquer|copier|transf[\u00e9e]rer|r[\u00e9e]voquer|r[\u00e9e]initialiser|approuver|accepter|rejeter|refuser|installer|d[\u00e9e]sinstaller|imprimer|rembourser|restaurer|annuler(?=\s+\S)|quitter|rejoindre|renommer|d[\u00e9e]placer|fusionner|tester|ex[\u00e9e]cuter|lancer|d[\u00e9e]clencher|d[\u00e9e]marrer|red[\u00e9e]marrer|arr[\u00eae]ter|signer|marquer|[\u00e9e]pingler|d[\u00e9e]s[\u00e9e]pingler|bloquer|d[\u00e9e]bloquer|bannir|expulser|v[\u00e9e]rifier|r[\u00e9e]essayer|au panier|aux favoris|delete|remove|archive|unarchive|disable|deactivate|enable|activate|log ?out|log ?off|sign ?out|log ?in|sign ?in|sign ?up|sign|disconnect|reconnect|send|resend|publish|unpublish|share|pay|buy|purchase|order|checkout|subscribe|unsubscribe|close (?:my |your |the )?account|terminate|save|submit|confirm|apply|invite|import|export|download|upload|connect|sync|generate|regenerate|reveal|duplicate|copy|transfer|revoke|reset|approve|accept|reject|decline|install|uninstall|print|refund|restore|cancel(?=\s+\S)|leave|join|rename|move|merge|test|run|execute|trigger|start|stop|restart|update|mark|pin|unpin|block|unblock|ban|kick|verify|retry|to cart|to bag|to favou?rites|to wishlist)(?![\w\u00c0-\u024f])/i;
    /* boutons qui VALIDENT un formulaire ou la boite deja ouverte ("Creer", "Ajouter", "OK" en bas d'une modale, tout
       bouton submit d'un formulaire) : ils n'ouvrent rien, ils enregistrent -> nePasCliquer, marques "(validation)" */
    var COMMIT = /^(?:\+\s*)?(nouve(?:au|l|lle)|ajouter|cr[\u00e9e]er|new|add|create|oui|yes|ok|d['\u2019]accord|continuer|continue|suivant|next|terminer|finish|done|go)(?![\w\u00c0-\u024f])/i;
    function isSubmit(b) { return (b.tagName === 'BUTTON' || b.tagName === 'INPUT') && String(b.type).toLowerCase() === 'submit' && !!b.form; }
    function inDialogOrForm(b) { try { return !!b.closest('[role=dialog], [role=alertdialog], [aria-modal=true], dialog, form'); } catch (e) { return false; } }
    Array.prototype.forEach.call(D.querySelectorAll('button, [role=button], a[href], input[type=submit], input[type=button]'), function (b) {
      if (!visible(b)) return;
      var t = label(b);
      if (!t) return;
      var danger = DANGER.test(t), valide = !danger && (isSubmit(b) || (COMMIT.test(t) && inDialogOrForm(b)));
      if (danger || valide) { var tv = valide ? t + '  (validation)' : t; if (out.nePasCliquer.length < lim && out.nePasCliquer.indexOf(tv) === -1) out.nePasCliquer.push(tv); }
      else if (b.tagName === 'A' && internal(b) && normFull(internal(b)) !== normFull(here)) { /* lien de navigation : une autre route (#/route comprise), pas un etat */ }
      else if (CREATE.test(t) || b.getAttribute('data-bs-toggle') === 'modal' || b.getAttribute('data-toggle') === 'modal') { if (out.etatsCandidats.length < lim && out.etatsCandidats.indexOf(t) === -1) out.etatsCandidats.push(t); }
    });
    out.interrupteurs = D.querySelectorAll('[role=switch], input[type=checkbox], input[type=radio]').length;
    var fields = D.querySelectorAll('input:not([type=hidden]), select, textarea, [contenteditable=true]');
    var labels = [];
    Array.prototype.forEach.call(fields, function (f) {
      if (labels.length >= 15 || !visible(f)) return;
      var l = f.getAttribute('aria-label') || f.getAttribute('placeholder') || '';
      if (!l && f.id) { var lb = D.querySelector('label[for="' + f.id.replace(/"/g, '\\"') + '"]'); if (lb) l = lb.textContent; }
      labels.push((f.getAttribute('type') || f.tagName.toLowerCase()) + (l ? ' ' + mask(l) : ''));
    });
    out.formulaires = { formulaires: D.forms.length, champs: fields.length, exemples: labels };
    Array.prototype.forEach.call(D.querySelectorAll('table, [role=grid], [role=table], [role=treegrid]'), function (t) {
      if (out.tableaux.length >= 6 || !visible(t)) return;
      var heads = Array.prototype.map.call(t.querySelectorAll('th, [role=columnheader]'), function (h) { return mask(h.textContent); }).filter(Boolean).slice(0, 15);
      var rows = t.querySelectorAll('tbody tr').length || Math.max(0, t.querySelectorAll('[role=row]').length - 1);
      out.tableaux.push({ colonnes: heads, lignes: rows });
    });
    out.infobulles = D.querySelectorAll('[title], [data-tip], [data-tip-text], [data-tooltip], [data-tippy-content], [data-bs-toggle=tooltip], [aria-describedby]').length;
    Array.prototype.forEach.call(D.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true]'), function (d) {
      if (!visible(d)) return;
      var h = d.querySelector('h1, h2, h3, [role=heading]');
      out.dialoguesOuverts.push(h ? mask(h.textContent) : '(sans titre)');
    });
    var best = null;
    Array.prototype.forEach.call(D.querySelectorAll('main, [role=main], div, section'), function (el) {
      if (el.scrollHeight <= el.clientHeight + 20 || el.clientHeight < 200) return;
      var ov = getComputedStyle(el).overflowY;
      if (ov !== 'auto' && ov !== 'scroll') return;
      if (!best || el.clientHeight * el.clientWidth > best.clientHeight * best.clientWidth) best = el;
    });
    var se = D.scrollingElement || D.documentElement;
    var docScrolls = se.scrollHeight > se.clientHeight + 20;
    /* conteneur principal : le plus grand bloc defilant, sauf s'il est petit et que la page elle-meme defile */
    if (best && docScrolls && best.clientWidth * best.clientHeight < 0.4 * innerWidth * innerHeight) best = null;
    out.defilement = best ? { conteneur: best.tagName.toLowerCase() + (best.id ? '#' + best.id : '') + (typeof best.className === 'string' && best.className ? '.' + best.className.trim().split(/\s+/).slice(0, 3).join('.') : ''), scrollHeight: best.scrollHeight, clientHeight: best.clientHeight }
      : { conteneur: 'document', scrollHeight: se.scrollHeight, clientHeight: se.clientHeight };
    out.iframes = Array.prototype.map.call(D.querySelectorAll('iframe'), function (f) { try { return new URL(f.src, location.href).host || 'about:blank'; } catch (e) { return '?'; } }).slice(0, 10);
    var li = out.liensInternes, lk = Object.keys(li).sort();
    out.liensInternes = lk.slice(0, lim * 2).map(function (k) { return k + (li[k] > 1 ? '  x' + li[k] : ''); });
    return out;
  };

  return 'routes ok';
})();
