#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_links.py — contrôle des pages et des liens internes d'un clone servi en local.
Plugin copieur-universel, skill verifier-copie. Python 3.8+ STANDARD (aucune dépendance).

  python3 check_links.py --root <dossier du clone> --base http://localhost:PORT [--out rapport.json]
  python3 check_links.py --root <dossier du clone>            (sans --base : contrôle sur disque seulement)
  (Windows : py au lieu de python3)

Ce que fait l'outil :
  1. trouve les pages : chaque index.html sous --root (--all-html : tous les .html) ;
  2. vérifie que chaque page répond 200 sur le serveur local et qu'il sert bien le fichier du disque ;
  3. extrait les références internes du HTML STATIQUE (href, src, srcset, poster, data, action, formaction,
     meta refresh, <base>, style="url()"), des feuilles CSS locales (url(), @import) et les chemins internes
     écrits en clair dans le JavaScript local ('/app/...' entre guillemets) ;
  4. vérifie chaque cible : fichier présent sur le disque (ou dossier avec index.html) ET/OU réponse HTTP 2xx ;
  5. signale aussi (avertissements) : casse différente du disque, ancres #id introuvables, références à
     l'original (--original), pages sans <title>, contenu servi différent du fichier.
Chemins du disque local (file:, lecteur C:, partage réseau, /Users/<nom>/Desktop/…, /Users/<session>/…,
/Volumes/…, dossiers temporaires de macOS) : toujours cassés une fois servis, signalés comme tels (HTML, CSS et JS).
Les liens fabriqués à l'exécution ('/app/' + cle) ne sont pas visibles ici : les relever dans le DOM rendu
(snippet du skill verifier-copie) et les passer avec --urls-file.

Codes de sortie : 0 = tout est bon ; 1 = au moins une page ou une référence cassée (ou un avertissement
avec --strict) ; 2 = erreur d'usage ou serveur injoignable.
"""
import argparse
import fnmatch
import json
import os
import re
import socket
import ssl
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from http.client import HTTPConnection, HTTPSConnection, HTTPException
from urllib.parse import quote, unquote, urljoin, urlsplit

VERSION = '1.2'
DUMMY = 'http://clone.invalid'          # origine fictive pour résoudre les URL sans --base
DEFAULT_EXCLUDED_DIRS = {'.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv', '.claude',
                         '.idea', '.vscode'}
IGNORED_SCHEMES = ('javascript:', 'mailto:', 'tel:', 'sms:', 'data:', 'blob:', 'about:', 'chrome:', 'edge:',
                   'intent:', 'whatsapp:', 'callto:', 'skype:', 'facetime:', 'geo:', 'market:', 'itms')
NAV_TAGS = {'a', 'area', 'form', 'button', 'meta'}  # références de navigation (les autres = ressources)
URL_ATTRS = {
    'a': ('href',), 'area': ('href',), 'link': ('href',), 'script': ('src',), 'img': ('src', 'srcset'),
    'source': ('src', 'srcset'), 'iframe': ('src',), 'frame': ('src',), 'embed': ('src',), 'object': ('data',),
    'video': ('src', 'poster'), 'audio': ('src',), 'track': ('src',), 'input': ('src',), 'form': ('action',),
    'button': ('formaction',), 'use': ('href', 'xlink:href'), 'image': ('href', 'xlink:href'),
    'feimage': ('href', 'xlink:href'),
}
DYNAMIC_MARKERS = ('{{', '}}', '${', '<%', '%>', "' +", '" +', "+ '", '+ "', '[[', ']]')
CSS_URL_RX = re.compile(r'url\(\s*([\'"]?)(.*?)\1\s*\)', re.I | re.S)
CSS_IMPORT_RX = re.compile(r'@import\s+([\'"])(.+?)\1', re.I)
JS_PATH_RX = re.compile(r'([\'"`])(/[A-Za-z0-9_\-.~%][^\'"`\s<>\\]*)\1')
JS_URL_RX = re.compile(r'([\'"`])(https?://[^\'"`\s<>\\]+)\1')
WIN_PATH_RX = re.compile(r'^(?:file:|[A-Za-z]:[\\/]|\\\\)', re.I)
# Chemins absolus du disque macOS (ou Linux) : dossier personnel (/Users/<nom>/Desktop…, /Users/<session>/…),
# disques (/Volumes/…), dossiers temporaires. Une route d'appli (/Users/42, /Users/Edit/5) n'y ressemble pas.
_SESSION = re.escape(os.environ.get('USER') or os.environ.get('LOGNAME') or '')
NIX_PATH_RX = re.compile(
    r'^/(?:Users/[^/?#]+/(?:Desktop|Documents|Downloads|Library|Pictures|Movies|Music|Public|Sites|Applications)(?:[/?#]|$)'
    + (r'|Users/' + _SESSION + r'(?:[/?#]|$)' if _SESSION else '')
    + r'|Volumes/[^/?#]+/|private/(?:var|tmp)/|var/folders/|home/[^/?#]+/(?:Desktop|Documents|Downloads)(?:[/?#]|$))',
    re.I)


# ----------------------------------------------------------------------------------------------------
# Console : UTF-8 quand la sortie est redirigée, jamais d'exception d'encodage.
# ----------------------------------------------------------------------------------------------------
def _setup_console():
    for stream in (sys.stdout, sys.stderr):
        try:
            if os.environ.get('PYTHONIOENCODING'):
                stream.reconfigure(errors='replace')
            elif not stream.isatty():
                stream.reconfigure(encoding='utf-8', errors='replace')
            else:
                stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass


def die(msg, code=2):
    print('erreur : ' + msg, file=sys.stderr, flush=True)
    sys.exit(code)


def is_local_host(host):
    h = (host or '').lower().strip('[]')
    return (h in ('localhost', '::1', '0.0.0.0') or h.startswith('127.') or h.endswith('.localhost')
            or h.endswith('.test'))


# ----------------------------------------------------------------------------------------------------
# Analyse HTML
# ----------------------------------------------------------------------------------------------------
class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []          # (balise, attribut, valeur, ligne)
        self.ids = set()
        self.base_href = None
        self.title = None
        self._in_title = False
        self._title_buf = []
        self._script = None     # (ligne, type, morceaux) pendant un <script> en ligne
        self._style = None      # (ligne, morceaux) pendant un <style>
        self.inline_scripts = []  # (ligne, texte)
        self.inline_styles = []   # (ligne, texte)
        self.lang = None

    def handle_starttag(self, tag, attrs):
        self._start(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._start(tag, attrs, closed=True)

    def _start(self, tag, attrs, closed=False):
        pos = self.getpos()
        line = (pos[0], pos[1] + 1)     # (ligne, colonne) : un dump recopié tient souvent sur UNE ligne
        a = {}
        for k, v in attrs:
            if k not in a:
                a[k] = v if v is not None else ''
        if a.get('id'):
            self.ids.add(a['id'])
        if tag == 'a' and a.get('name'):
            self.ids.add(a['name'])
        if tag == 'html' and a.get('lang'):
            self.lang = a['lang']
        if tag == 'base' and a.get('href') and self.base_href is None:
            self.base_href = a['href']
        if tag == 'title' and not closed:
            self._in_title = True
            self._title_buf = []
        if tag == 'meta' and (a.get('http-equiv') or '').lower() == 'refresh':
            m = re.search(r'url\s*=\s*([\'"]?)([^\'"]+)\1', a.get('content') or '', re.I)
            if m:
                self.refs.append(('meta', 'refresh', m.group(2).strip(), line))
        for attr in URL_ATTRS.get(tag, ()):
            if attr in a:
                val = a[attr]
                if attr == 'srcset':
                    for part in val.split(','):
                        u = part.strip().split(' ')[0].strip()
                        if u:
                            self.refs.append((tag, attr, u, line))
                else:
                    if tag == 'link' and attr == 'href':
                        rel = (a.get('rel') or '').lower()
                        if any(r in rel for r in ('preconnect', 'dns-prefetch')):
                            self.refs.append((tag, 'href:' + rel.strip(), val, line))
                            continue
                    self.refs.append((tag, attr, val, line))
        style = a.get('style')
        if style and 'url(' in style.lower():
            for m in CSS_URL_RX.finditer(style):
                self.refs.append((tag, 'style:url', m.group(2).strip(), line))
        if tag == 'script' and not closed and 'src' not in a:
            self._script = (line[0], (a.get('type') or '').lower(), [])
        if tag == 'style' and not closed:
            self._style = (line[0], [])

    def handle_endtag(self, tag):
        if tag == 'title' and self._in_title:
            self._in_title = False
            if self.title is None:
                self.title = ''.join(self._title_buf).strip()
        if tag == 'script' and self._script is not None:
            line, typ, parts = self._script
            if typ in ('', 'text/javascript', 'module', 'application/javascript', 'text/babel'):
                self.inline_scripts.append((line, ''.join(parts)))
            self._script = None
        if tag == 'style' and self._style is not None:
            self.inline_styles.append((self._style[0], ''.join(self._style[1])))
            self._style = None

    def handle_data(self, data):
        if self._in_title:
            self._title_buf.append(data)
        if self._script is not None:
            self._script[2].append(data)
        if self._style is not None:
            self._style[1].append(data)


def read_text(path):
    with open(path, 'rb') as f:
        raw = f.read()
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw, raw[3:].decode('utf-8', errors='replace')
    if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        return raw, raw.decode('utf-16', errors='replace')
    return raw, raw.decode('utf-8', errors='replace')


def line_of(text, pos, start_line=1):
    """(ligne, colonne) d'une position ; colonne seulement dans un fichier séparé (start_line == 1)."""
    ln = start_line + text.count('\n', 0, pos)
    return (ln, pos - text.rfind('\n', 0, pos)) if start_line == 1 else ln


# ----------------------------------------------------------------------------------------------------
# Contrôleur
# ----------------------------------------------------------------------------------------------------
class Checker:
    def __init__(self, args):
        self.args = args
        self.hors_perimetre = []
        for x in args.hors_perimetre or []:
            if x.startswith('@'):
                try:
                    with open(x[1:], encoding='utf-8-sig') as f:
                        self.hors_perimetre += [l.strip() for l in f if l.strip() and not l.lstrip().startswith('#')]
                except OSError as e:
                    die('--hors-perimetre : fichier illisible ' + x[1:] + ' (' + str(e) + ')')
            else:
                # Git Bash convertit « /app/x » en « C:/Program Files/Git/app/x » : on retire ce préfixe
                x = re.sub(r'^[A-Za-z]:/(?:[^,;]*/)?Git(?=/)', '', x)
                self.hors_perimetre += [y.strip() for y in x.split(',') if y.strip()]
        self.hors_perimetre = ['/' + y.lstrip('/') for y in self.hors_perimetre]
        self.root = os.path.abspath(args.root)
        self.base = args.base.rstrip('/') if args.base else None
        self.base_split = urlsplit(self.base) if self.base else None
        self.origins = set()
        if self.base:
            b = self.base_split
            port = b.port or (443 if b.scheme == 'https' else 80)
            self.origins.add((b.hostname or '').lower() + ':' + str(port))
            if is_local_host(b.hostname):
                for alias in ('localhost', '127.0.0.1', '::1'):
                    self.origins.add(alias + ':' + str(port))
        self.excludes = list(args.exclude or [])
        self.originals = [h.lower() for h in (args.original or [])]
        self.pages = []            # dicts
        self.refs = []             # dicts : page, source, balise, attribut, brut, ligne, cible, fragment
        self.externals = {}        # hôte -> {'navigation': n, 'ressource': n, 'js': n, 'exemples': set}
        self.ignored = {'schemas': 0, 'dynamiques': 0, 'ancres-seules': 0, 'vides': 0, 'prefixes-js': 0}
        self.warnings = []
        self.dir_cache = {}
        self.page_ids = {}         # url de page -> ids
        self.http_cache = {}
        self.addr_cache = {}
        self.orig_refs = {}
        self.js_prefixes = set()
        self.css_seen = set()
        self.js_seen = set()

    # ---------- fichiers ----------
    def excluded(self, rel_posix, name):
        if name in DEFAULT_EXCLUDED_DIRS:
            return True
        for pat in self.excludes:
            if fnmatch.fnmatch(rel_posix, pat) or fnmatch.fnmatch(name, pat):
                return True
        return False

    def find_pages(self):
        found = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            rel_dir = os.path.relpath(dirpath, self.root).replace('\\', '/')
            rel_dir = '' if rel_dir == '.' else rel_dir
            dirnames[:] = sorted(d for d in dirnames
                                 if not self.excluded((rel_dir + '/' + d).lstrip('/'), d))
            for fn in sorted(filenames):
                low = fn.lower()
                if low == 'index.html' or (self.args.all_html and low.endswith(('.html', '.htm'))):
                    rel = (rel_dir + '/' + fn).lstrip('/')
                    if self.excluded(rel, fn):
                        continue
                    if low == 'index.html':
                        url = '/' + (rel_dir + '/' if rel_dir else '')
                    else:
                        url = '/' + rel
                    found.append((rel, url))
        return found

    def listdir(self, d):
        if d not in self.dir_cache:
            try:
                self.dir_cache[d] = os.listdir(d)
            except OSError:
                self.dir_cache[d] = None
        return self.dir_cache[d]

    def fs_lookup(self, path):
        """Chemin d'URL (sans requête) -> (statut, fichier relatif, détail).
        statut : 'fichier' | 'page-dossier' | 'dossier-sans-index' | 'absent' | 'hors-racine'"""
        p = unquote(path)
        parts = [x for x in p.split('/') if x not in ('', '.')]
        if '..' in parts:
            # normaliser
            stack = []
            for x in parts:
                if x == '..':
                    if not stack:
                        return 'hors-racine', None, 'remonte au-dessus de la racine du clone'
                    stack.pop()
                else:
                    stack.append(x)
            parts = stack
        cur = self.root
        case_issue = None
        for i, part in enumerate(parts):
            names = self.listdir(cur)
            if names is None:
                return 'absent', None, None
            if part in names:
                cur = os.path.join(cur, part)
                continue
            # accents : un nom enregistré en NFD (Finder, archive venue d'un Mac) et un lien en NFC sont le même
            nfc = unicodedata.normalize('NFC', part)
            same = {unicodedata.normalize('NFC', n): n for n in names}
            if nfc in same:
                cur = os.path.join(cur, same[nfc])
                continue
            low = {unicodedata.normalize('NFC', n).lower(): n for n in names}
            if nfc.lower() in low:
                real = low[nfc.lower()]
                case_issue = '/'.join(parts[:i] + [real])
                cur = os.path.join(cur, real)
                continue
            return 'absent', None, None
        rel = os.path.relpath(cur, self.root).replace('\\', '/')
        detail = ('casse différente sur le disque : /' + case_issue + '…') if case_issue else None
        if os.path.isfile(cur):
            return 'fichier', rel, detail
        if os.path.isdir(cur):
            names = self.listdir(cur) or []
            for idx in ('index.html', 'index.htm'):
                if idx in names:
                    return 'page-dossier', (idx if rel == '.' else rel + '/' + idx), detail
            return 'dossier-sans-index', rel, detail
        return 'absent', None, None

    # ---------- HTTP ----------
    def address_for(self, host, port):
        """Adresse IP qui répond vraiment. Sous Windows, « localhost » essaie d'abord ::1 : si le serveur
        n'écoute que sur 127.0.0.1 (python3 -m http.server --bind 127.0.0.1 ; Windows : py), chaque requête perd ~2 s."""
        key = (host, port)
        if key in self.addr_cache:
            return self.addr_cache[key]
        chosen = host
        try:
            infos = socket.getaddrinfo(host, port or 80, type=socket.SOCK_STREAM)
            addrs = []
            for fam, _, _, _, sa in sorted(infos, key=lambda i: 0 if i[0] == socket.AF_INET else 1):
                if sa[0] not in addrs:
                    addrs.append(sa[0])
            for addr in addrs:
                try:
                    s = socket.create_connection((addr, port or 80), timeout=min(3.0, self.args.timeout))
                    s.close()
                    chosen = addr
                    break
                except OSError:
                    continue
        except OSError:
            pass
        self.addr_cache[key] = chosen
        return chosen

    def http(self, path, want_body=False):
        if not self.base:
            return None
        key = (path, want_body)
        if key in self.http_cache:
            return self.http_cache[key]
        url = self.base + quote(unquote(path), safe="/%:@!$&'()*+,;=-._~")
        method = 'GET' if want_body else 'HEAD'
        res = {'status': None, 'final': None, 'error': None, 'body': None, 'redirects': 0}
        hops = 0
        tried_get = want_body
        while True:
            u = urlsplit(url)
            try:
                addr = self.address_for(u.hostname, u.port)
                if u.scheme == 'https':
                    # serveur local en https : certificat auto-signé le plus souvent, on ne le vérifie pas
                    ctx = ssl._create_unverified_context() if is_local_host(u.hostname) else None
                    conn = HTTPSConnection(addr, u.port, timeout=self.args.timeout, context=ctx)
                else:
                    conn = HTTPConnection(addr, u.port, timeout=self.args.timeout)
                target = (u.path or '/') + ('?' + u.query if u.query else '')
                conn.request(method, target, headers={'Host': u.netloc,
                                                      'User-Agent': 'copieur-universel-check_links/' + VERSION,
                                                      'Accept': '*/*', 'Connection': 'close'})
                r = conn.getresponse()
                body = r.read() if method == 'GET' else b''
                status, loc = r.status, r.getheader('Location')
                conn.close()
            except (OSError, HTTPException, socket.timeout) as e:
                res['error'] = type(e).__name__ + ': ' + str(e)
                break
            if status in (301, 302, 303, 307, 308) and loc:
                hops += 1
                url = urljoin(url, loc)
                nu = urlsplit(url)
                port = nu.port or (443 if nu.scheme == 'https' else 80)
                if (nu.hostname or '').lower() + ':' + str(port) not in self.origins:
                    res['status'], res['final'] = status, url
                    res['error'] = 'redirige hors du clone : ' + url
                    break
                if hops > 6:
                    res['error'] = 'trop de redirections'
                    break
                res['redirects'] = hops
                continue
            if method == 'HEAD' and status in (405, 501) and not tried_get:
                method, tried_get = 'GET', True
                continue
            res['status'], res['final'] = status, url
            if want_body:
                res['body'] = body
            break
        self.http_cache[key] = res
        return res

    # ---------- classement d'une référence ----------
    def classify(self, raw, base_url):
        """-> ('interne', chemin, requête, fragment) | ('externe', hôte, url) | ('ignore', raison) |
              ('ancre', fragment) | ('local-disque', raw)"""
        v = (raw or '').strip()
        if not v:
            return ('ignore', 'vides')
        if any(m in v for m in DYNAMIC_MARKERS):
            return ('ignore', 'dynamiques')
        low = v.lower()
        if WIN_PATH_RX.match(v):
            return ('local-disque', v)
        if NIX_PATH_RX.match(v) and v.lstrip('/').split('/')[0] not in (self.listdir(self.root) or []):
            return ('local-disque', v)
        if low.startswith(IGNORED_SCHEMES):
            return ('ignore', 'schemas')
        if v.startswith('#'):
            return ('ancre', unquote(v[1:]))
        joined = urljoin(base_url, v)
        s = urlsplit(joined)
        if s.scheme not in ('http', 'https'):
            return ('ignore', 'schemas')
        host = (s.hostname or '').lower()
        port = s.port or (443 if s.scheme == 'https' else 80)
        origin = host + ':' + str(port)
        if host == 'clone.invalid' or origin in self.origins:
            return ('interne', s.path or '/', s.query, unquote(s.fragment))
        return ('externe', host, joined)

    def page_base(self, page_url, base_href):
        origin = self.base if self.base else DUMMY
        if re.match(r'^https?://', page_url or '', re.I):
            s = urlsplit(page_url)
            page_url = (s.path or '/')
        b = origin + (page_url if (page_url or '').startswith('/') else '/' + (page_url or ''))
        if base_href:
            b = urljoin(b, base_href)
        return b

    def add_external(self, host, kind, url, where=None):
        e = self.externals.setdefault(host, {'navigation': 0, 'ressource': 0, 'js': 0, 'exemples': []})
        e[kind] += 1
        if len(e['exemples']) < 3 and url not in e['exemples']:
            e['exemples'].append(url[:160])
        if any(host == o or host.endswith('.' + o) for o in self.originals):
            key = (kind, url[:200])
            w = self.orig_refs.get(key)
            if w is None:
                w = {'type': 'reference-original', 'hote': host, 'nature': kind, 'url': url[:200],
                     'nombre': 0, 'fichiers': []}
                self.orig_refs[key] = w
                self.warnings.append(w)
            w['nombre'] += 1
            if where and where not in w['fichiers'] and len(w['fichiers']) < 20:
                w['fichiers'].append(where)

    def add_ref(self, page, source, tag, attr, raw, line, base_url, origin_file=None):
        line, col = line if isinstance(line, tuple) else (line, None)
        c = self.classify(raw, base_url)
        kind = c[0]
        if kind == 'ignore':
            self.ignored[c[1]] += 1
            return
        where = origin_file or page
        if kind == 'local-disque':
            self.refs.append({'page': where, 'source': source, 'balise': tag, 'attribut': attr, 'brut': raw,
                              'ligne': line, 'colonne': col, 'cible': raw, 'fragment': '', 'localDisque': True})
            return
        if kind == 'ancre':
            frag = c[1]
            if frag in ('', '!', '/') or frag.startswith(('!', '/')):
                self.ignored['ancres-seules'] += 1
                return
            self.refs.append({'page': where, 'source': source, 'balise': tag, 'attribut': attr, 'brut': raw,
                              'ligne': line, 'colonne': col, 'cible': None, 'fragment': frag, 'memePage': base_url})
            return
        if kind == 'externe':
            nature = 'js' if source == 'js' else ('navigation' if tag in NAV_TAGS else 'ressource')
            if attr.startswith('href:'):
                nature = 'ressource'
            self.add_external(c[1], nature, c[2], where)
            return
        _, path, query, frag = c
        if source == 'js' and path.endswith('/') and self.fs_lookup(path)[0] == 'dossier-sans-index':
            # '/assets/sections/' + nom : début de chemin assemblé par le script, pas un lien
            self.ignored['prefixes-js'] += 1
            return
        self.refs.append({'page': where, 'source': source, 'balise': tag, 'attribut': attr, 'brut': raw,
                          'ligne': line, 'colonne': col, 'cible': path, 'fragment': frag})
        # feuilles de style et scripts locaux à analyser ensuite
        if source in ('html', 'css') and ((tag == 'link' and attr == 'href' and path.lower().endswith('.css'))
                                          or (source == 'css' and attr == '@import')):
            self.css_seen.add(path)
        if source == 'html' and tag == 'script' and attr == 'src':
            self.js_seen.add(path)

    # ---------- analyse ----------
    def scan_css_text(self, text, file_url, where, start_line=1):
        for m in CSS_IMPORT_RX.finditer(text):
            self.add_ref(where, 'css', 'css', '@import', m.group(2).strip(), line_of(text, m.start(), start_line),
                         file_url)
        for m in CSS_URL_RX.finditer(text):
            u = m.group(2).strip()
            if u and not u.startswith('#'):
                self.add_ref(where, 'css', 'css', 'url()', u, line_of(text, m.start(), start_line), file_url)

    def scan_js_text(self, text, file_url, where, start_line=1):
        if self.args.no_js:
            return
        for m in JS_URL_RX.finditer(text):
            url = m.group(2)
            if any(x in url for x in ('${', '{', '}')) or url.startswith('http://www.w3.org/'):
                continue            # gabarits et espaces de noms XML (svg, xlink) : pas des requêtes
            try:
                sp = urlsplit(url)
                host, port = (sp.hostname or '').lower(), sp.port or (443 if url.startswith('https') else 80)
            except ValueError:
                continue
            if not host:
                continue
            if host + ':' + str(port) in self.origins:
                self.add_ref(where, 'js', 'js', 'chaine', url, line_of(text, m.start(), start_line), file_url)
            else:
                self.add_external(host, 'js', url, where)
        for m in JS_PATH_RX.finditer(text):
            p = m.group(2)
            if p.startswith('//') or any(x in p for x in ('${', '{', '}', '*', '|', '(', ')', '...', '…', '/:', '[')):
                continue            # gabarits, motifs de routeur ('/app/contacts/:id', '/[slug]') : pas des liens
            seg = p.lstrip('/').split('/')[0].split('?')[0].split('#')[0]
            if seg not in self.js_prefixes and not NIX_PATH_RX.match(p):
                continue            # chemin du disque local (/Users/<nom>/…) : relevé, il sera « cassé »
            self.add_ref(where, 'js', 'js', 'chaine', p, line_of(text, m.start(), start_line), file_url)

    def run(self):
        a = self.args
        if not os.path.isdir(self.root):
            die('dossier introuvable : ' + self.root)
        if self.base:
            if self.base_split.scheme not in ('http', 'https') or not self.base_split.hostname:
                die('--base doit être une URL http(s)://hôte:port, ex. http://localhost:8766')
            if self.base_split.path not in ('', '/') or self.base_split.query:
                die('--base doit être la racine du serveur (http://hôte:port, sans chemin) : « ' + a.base + ' ».\n'
                    '  --root doit être le dossier que ce serveur sert à la racine.')
            if not is_local_host(self.base_split.hostname) and not a.allow_remote:
                die("--base n'est pas un serveur local (" + self.base_split.hostname + "). Cet outil contrôle un "
                    "clone servi en local ; ajoutez --allow-remote seulement pour un serveur à vous.")
            hb = (self.base_split.hostname or '').lower()
            if any(hb == o or hb.endswith('.' + o) for o in self.originals):
                die("--base désigne l'original (" + hb + ") : l'outil visiterait chaque page et chaque cible de "
                    "l'original, ce que les règles interdisent (pas de crawl), même avec --allow-remote.")
            probe = self.http('/')
            if probe['error'] and probe['status'] is None:
                die('serveur injoignable sur ' + self.base + ' (' + probe['error'] + ').\n'
                    '  Lancez-le : ' + ('py' if os.name == 'nt' else 'python3') + ' -m http.server PORT --bind 127.0.0.1'
                    ' --directory "' + self.root + '"\n'
                    '  ou relancez sans --base pour un contrôle sur disque seulement.')
            self.http_cache.clear()

        t0 = time.time()
        pages = self.find_pages()
        if not pages:
            die('aucune page (index.html) trouvée sous ' + self.root + (' (essayez --all-html)' if not a.all_html else ''))

        # préfixes des chemins internes à relever dans le JS : dossiers de premier niveau + --js-prefix
        for name in self.listdir(self.root) or []:
            if os.path.isdir(os.path.join(self.root, name)) and not self.excluded(name, name) \
                    and not name.startswith('.'):
                self.js_prefixes.add(name)
        for p in a.js_prefix or []:
            self.js_prefixes.add(p.strip('/').split('/')[0])

        # 1. pages
        for rel, url in pages:
            full = os.path.join(self.root, rel)
            raw, text = read_text(full)
            parser = PageParser()
            try:
                parser.feed(text)
                parser.close()
            except Exception as e:  # HTML très malformé : on garde ce qui a été lu
                self.warnings.append({'type': 'html-illisible', 'page': rel, 'detail': str(e)[:200]})
            base_url = self.page_base(url, parser.base_href)
            page = {'fichier': rel, 'url': url, 'titre': parser.title, 'octets': len(raw), 'lang': parser.lang,
                    'http': None, 'redirections': 0, 'erreur': None, 'references': 0, 'cassees': 0}
            self.pages.append(page)
            self.page_ids[url] = parser.ids
            refresh = any(r[0] == 'meta' for r in parser.refs)
            if not parser.title and not refresh:
                self.warnings.append({'type': 'titre-absent', 'page': rel})
            before = len(self.refs)
            for tag, attr, val, line in parser.refs:
                self.add_ref(rel, 'html', tag, attr, val, line, base_url)
            for line, css in parser.inline_styles:
                self.scan_css_text(css, base_url, rel, line)
            for line, js in parser.inline_scripts:
                self.scan_js_text(js, base_url, rel, line)
            page['references'] = len(self.refs) - before
            page['_raw'] = raw

        # 2. CSS et JS locaux référencés (une fois chacun)
        done_css = set()
        while self.css_seen - done_css:
            path = sorted(self.css_seen - done_css)[0]
            done_css.add(path)
            st, rel, _ = self.fs_lookup(path)
            if st == 'fichier':
                _, text = read_text(os.path.join(self.root, rel))
                self.scan_css_text(text, (self.base or DUMMY) + path, rel)
        for path in sorted(self.js_seen):
            st, rel, _ = self.fs_lookup(path)
            if st == 'fichier':
                _, text = read_text(os.path.join(self.root, rel))
                self.scan_js_text(text, (self.base or DUMMY) + path, rel)

        # 3. liens relevés dans le DOM rendu (--urls-file)
        if a.urls_file:
            rendered = self.load_urls_file(a.urls_file)
            if not rendered:
                self.warnings.append({'type': 'urls-file-vide', 'cible': a.urls_file,
                                      'detail': 'aucun lien lu : format inattendu ? (attendu : résultat de __liens())'})
            for item in rendered:
                page = item.get('page') or '(rendu)'
                self.add_ref(page, 'rendu', item.get('balise') or 'a', 'href', item['href'], 0,
                             self.page_base(item.get('pageUrl') or '/', None))

        # 4. vérifications
        targets = sorted({r['cible'] for r in self.refs if r.get('cible') and not r.get('localDisque')})
        fs = {t: self.fs_lookup(t) for t in targets}
        if self.base:
            with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
                page_res = list(ex.map(lambda p: self.http(p['url'], want_body=True), self.pages))
                http_res = dict(zip(targets, ex.map(self.http, targets)))
        else:
            page_res = [None] * len(self.pages)
            http_res = {t: None for t in targets}

        for page, res in zip(self.pages, page_res):
            raw = page.pop('_raw')
            if res is None:
                continue
            page['http'] = res['status']
            page['redirections'] = res['redirects']
            page['erreur'] = res['error']
            if res['status'] == 200 and res['body'] is not None and res['body'] != raw:
                self.warnings.append({'type': 'contenu-different', 'page': page['fichier'],
                                      'detail': 'le serveur ne renvoie pas le fichier du disque (autre racine de '
                                                'serveur ? injection de script ? cache ?)'})

        results = {}
        for t in targets:
            st, rel, detail = fs[t]
            h = http_res.get(t)
            code = h['status'] if h else None
            http_ok = code is not None and 200 <= code < 300
            on_disk = st in ('fichier', 'page-dossier')
            if st == 'dossier-sans-index':
                state, why = 'cassee', "dossier sans index.html (le serveur afficherait une liste de fichiers)"
            elif st == 'hors-racine':
                state, why = 'cassee', 'chemin hors de la racine du clone'
            elif on_disk and (http_ok or not self.base):
                state, why = 'ok', None
            elif on_disk and not http_ok:
                state, why = 'cassee', ('présent sur le disque mais HTTP ' + str(code) if code
                                        else 'présent sur le disque mais ' + ((h or {}).get('error') or 'pas de réponse'))
            elif http_ok:
                state, why = 'ok', None
                self.warnings.append({'type': 'servi-hors-disque', 'cible': t,
                                      'detail': 'HTTP ' + str(code) + " mais absent du disque (repli SPA du serveur ? "
                                                "le lien est peut-être cassé)"})
            else:
                state = 'cassee'
                why = 'absent du disque' + (' et HTTP ' + str(code) if code else
                                            (' (' + h['error'] + ')' if h and h.get('error') else ''))
            if detail and state == 'ok':
                self.warnings.append({'type': 'casse-differente', 'cible': t, 'detail': detail +
                                      ' — marche sous Windows et macOS (disques insensibles à la casse), cassé '
                                      'sous Linux et sur un hébergement sensible à la casse'})
            results[t] = {'cible': t, 'etat': state, 'raison': why, 'http': code, 'disque': st, 'fichier': rel}

        # 5. ancres
        for r in self.refs:
            frag = r.get('fragment')
            if not frag:
                continue
            if r.get('cible') is None:      # ancre sur la même page
                page_url = urlsplit(r['memePage']).path
                ids = self.page_ids.get(page_url)
            else:
                ids = self.page_ids.get(r['cible']) or self.page_ids.get(r['cible'].rstrip('/') + '/')
            if ids is not None and frag not in ids and not frag.startswith(('!', '/', ':~:')):
                self.warnings.append({'type': 'ancre-introuvable', 'page': r['page'], 'ligne': r['ligne'],
                                      'brut': r['brut'], 'detail': "aucun id/name « " + frag + " » dans la page cible "
                                                                    "(peut être créé par le JS : vérifier dans le rendu)"})

        # 6. assemblage
        broken = {}
        for r in self.refs:
            if r.get('localDisque'):
                key = r['cible']
                b = broken.setdefault(key, {'cible': key, 'etat': 'cassee', 'http': None, 'disque': None,
                                            'raison': 'chemin du disque local (file:, C:\\, /Users/…) : ne marche pas une fois servi',
                                            'occurrences': []})
            elif r.get('cible') and results[r['cible']]['etat'] == 'cassee':
                b = broken.setdefault(r['cible'], dict(results[r['cible']], occurrences=[]))
            else:
                continue
            if len(b['occurrences']) < 50:
                b['occurrences'].append({k: r.get(k) for k in ('page', 'ligne', 'colonne', 'source', 'balise', 'attribut', 'brut')})
            b['nombre'] = b.get('nombre', 0) + 1
        for b in broken.values():
            b['sources'] = sorted({o['source'] for o in b['occurrences']})
        for page in self.pages:
            page['cassees'] = sum(1 for b in broken.values() for o in b['occurrences'] if o['page'] == page['fichier'])

        pages_bad = [p for p in self.pages if self.base and (p['http'] != 200)]
        by_source = {}
        for r in self.refs:
            if r.get('cible') or r.get('localDisque'):
                by_source[r['source']] = by_source.get(r['source'], 0) + 1
        warn_types = {}
        for w in self.warnings:
            warn_types[w['type']] = warn_types.get(w['type'], 0) + 1
        broken_list = sorted(broken.values(), key=lambda b: (b['sources'] == ['js'], b['cible']))
        hp = self.hors_perimetre
        hors = [b for b in broken_list if hp and any(b['cible'] == x.rstrip('/') or b['cible'].startswith(x.rstrip('/') + '/')
                                                     or b['cible'] == x for x in hp)]
        broken_list = [b for b in broken_list if b not in hors]
        report = {
            'outil': 'check_links.py', 'version': VERSION,
            'date': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'racine': self.root, 'base': self.base, 'mode': 'disque+http' if self.base else 'disque',
            'resume': {
                'pages': len(self.pages),
                'pagesOk': len(self.pages) - len(pages_bad) if self.base else None,
                'pagesEnErreur': len(pages_bad) if self.base else None,
                'references': sum(by_source.values()),
                'referencesParSource': by_source,
                'ciblesInternes': len(targets),
                'ciblesCassees': len(broken_list),
                'occurrencesCassees': sum(b['nombre'] for b in broken_list),
                'cassesHtmlCss': sum(1 for b in broken_list if b['sources'] != ['js'] and b['sources'] != ['rendu']),
                'cassesSeulementJs': sum(1 for b in broken_list if b['sources'] == ['js']),
                'horsPerimetre': len(hors),
                'avertissements': len(self.warnings), 'avertissementsParType': warn_types,
                'hotesExternes': len(self.externals),
                'ignores': self.ignored,
                'prefixesJs': sorted(self.js_prefixes) if not a.no_js else [],
                'duree_s': round(time.time() - t0, 2),
            },
            'pagesEnErreur': [{k: p[k] for k in ('fichier', 'url', 'http', 'erreur')} for p in pages_bad],
            'cassees': broken_list,
            'horsPerimetre': hors,
            'avertissements': self.warnings,
            'externes': {h: self.externals[h] for h in sorted(self.externals,
                                                               key=lambda x: -sum(self.externals[x][k] for k in ('navigation', 'ressource', 'js')))},
            'pages': self.pages,
            'cibles': [results[t] for t in targets] if a.all_targets else None,
        }
        failed = bool(pages_bad or broken_list or (a.strict and self.warnings))
        report['resultat'] = 'ECHEC' if failed else 'OK'
        return report, failed

    def load_urls_file(self, path):
        try:
            with open(path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
        except OSError as e:
            die('--urls-file illisible : ' + str(e))
        items = []
        s = content.strip()
        if s.startswith(('[', '{', '"')):
            try:
                data = json.loads(s)
                # résultat de __liens() écrit tel quel depuis javascript_tool : chaîne JSON dans du JSON
                while isinstance(data, str) and data.strip().startswith(('[', '{')):
                    data = json.loads(data)
            except ValueError as e:
                die('--urls-file : JSON invalide (' + str(e) + ')')

            def collect(x):
                if isinstance(x, list):            # plusieurs pages réunies : [[…], […]]
                    for y in x:
                        collect(y)
                elif isinstance(x, str):
                    if x.strip().startswith(('[', '{')):
                        try:
                            collect(json.loads(x))
                            return
                        except ValueError:
                            pass
                    items.append({'href': x})
                elif isinstance(x, dict):
                    if x.get('href'):
                        items.append(x)
                    else:                          # {"liens": […]} ou {"/page/": […]}
                        for y in x.values():
                            if isinstance(y, (list, dict)):
                                collect(y)
            collect(data)
        else:
            for line in s.splitlines():
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split('\t')
                if len(parts) >= 2:
                    items.append({'pageUrl': parts[0], 'page': parts[0], 'href': parts[1]})
                else:
                    items.append({'href': line})
        return items


# ----------------------------------------------------------------------------------------------------
# Résumé lisible
# ----------------------------------------------------------------------------------------------------
def print_summary(rep, out_path, max_list):
    r = rep['resume']
    print('check_links.py ' + VERSION + ' — clone : ' + rep['racine'])
    print('Mode : ' + ('disque + HTTP sur ' + rep['base'] if rep['base'] else 'disque seulement (pas de --base)'))
    if rep['base']:
        print('Pages : %d trouvées, %d répondent 200, %d en erreur' % (r['pages'], r['pagesOk'], r['pagesEnErreur']))
        for p in rep['pagesEnErreur'][:max_list]:
            print('  - %s  (%s)  HTTP %s %s' % (p['url'], p['fichier'], p['http'], p['erreur'] or ''))
        if r['pages'] and r['pagesEnErreur'] == r['pages']:
            print("  → aucune page ne répond : ce serveur sert-il bien --root à sa racine ? (autre dossier, autre "
                  "agent sur ce port ?)")
    else:
        print('Pages : %d trouvées' % r['pages'])
    src = ', '.join('%s %d' % (k, v) for k, v in sorted(r['referencesParSource'].items()))
    print('Références internes : %d (%d cibles distinctes) — %s' % (r['references'], r['ciblesInternes'], src or 'aucune'))
    ig = r['ignores']
    print('Ignorées : %d dynamiques (gabarits), %d mailto/tel/data/javascript, %d ancres de routeur, %d vides, '
          '%d débuts de chemin JS' % (ig['dynamiques'], ig['schemas'], ig['ancres-seules'], ig['vides'], ig['prefixes-js']))
    print('Cibles cassées : %d (%d occurrences) dont %d seulement dans des chaînes JS (à confirmer)'
          % (r['ciblesCassees'], r['occurrencesCassees'], r['cassesSeulementJs']))
    for b in rep['cassees'][:max_list]:
        occ = b['occurrences']
        where = ', '.join(o['page'] + (':%s' % o['ligne'] if o['ligne'] else '')
                          + (':%s' % o['colonne'] if o.get('colonne') else '') for o in occ[:3])
        more = (' (+%d)' % (b['nombre'] - 3)) if b['nombre'] > 3 else ''
        tag = ' [JS]' if b['sources'] == ['js'] else (' [rendu]' if b['sources'] == ['rendu'] else '')
        print('  - %s%s — %s — %s%s' % (b['cible'], tag, b['raison'], where, more))
    if len(rep['cassees']) > max_list:
        print('  … %d autres (voir le rapport JSON)' % (len(rep['cassees']) - max_list))
    if rep.get('horsPerimetre'):
        print('Hors périmètre (--hors-perimetre, sans effet sur le résultat) : %d cible(s) — %s' % (
            len(rep['horsPerimetre']), ', '.join(b['cible'] for b in rep['horsPerimetre'][:max_list])))
    print('Avertissements : %d %s' % (r['avertissements'], ('(' + ', '.join('%s %d' % kv for kv in sorted(r['avertissementsParType'].items())) + ')') if r['avertissements'] else ''))
    shown = 0
    for w in rep['avertissements']:
        if shown >= max_list:
            print('  … (voir le rapport JSON)')
            break
        if w['type'] == 'reference-original':
            continue
        label = w.get('page') or w.get('cible') or ''
        line = (':' + str(w['ligne'])) if w.get('ligne') else ''
        print('  ! %s : %s%s %s' % (w['type'], label, line, (w.get('brut') or '') + (' — ' + w['detail'] if w.get('detail') else '')))
        shown += 1
    origs = [w for w in rep['avertissements'] if w['type'] == 'reference-original']
    if origs:
        nat = {}
        for w in origs:
            nat[w['nature']] = nat.get(w['nature'], 0) + w['nombre']
        print("  ! références à l'original : %d URL distinctes, %d occurrences (%s)" % (
            len(origs), sum(w['nombre'] for w in origs), ', '.join('%s %d' % kv for kv in sorted(nat.items()))))
        for w in sorted(origs, key=lambda x: (x['nature'] != 'navigation', -x['nombre']))[:min(8, max_list)]:
            print('     [%s] x%d %s' % (w['nature'], w['nombre'], w['url']))
    if rep['externes']:
        top = list(rep['externes'].items())[:8]
        print('Hôtes externes (non visités) : %d — %s' % (len(rep['externes']), ', '.join(
            '%s (%d)' % (h, v['navigation'] + v['ressource'] + v['js']) for h, v in top)))
    if out_path:
        print('Rapport JSON : ' + out_path)
    print('Résultat : ' + rep['resultat'])


def main(argv=None):
    _setup_console()
    p = argparse.ArgumentParser(
        prog='check_links.py',
        description="Contrôle des pages et des liens internes d'un clone servi en local (copieur-universel).",
        epilog='Exemple : python3 check_links.py --root "$HOME/clones/monappli" --base http://localhost:8766 '
               '--original app.exemple.com --out rapport-liens.json   (Windows : py au lieu de python3)')
    p.add_argument('--root', required=True, help='dossier du clone (= racine du serveur local)')
    p.add_argument('--base', help='URL du serveur local, ex. http://localhost:8766 (sinon : disque seulement)')
    p.add_argument('--out', help='fichier du rapport JSON (UTF-8)')
    p.add_argument('--json', action='store_true', help='écrire le rapport JSON sur la sortie standard au lieu du résumé')
    p.add_argument('--all-html', action='store_true', help='visiter tous les .html, pas seulement les index.html')
    p.add_argument('--exclude', action='append', metavar='MOTIF',
                   help="motif fnmatch (chemin relatif ou nom) à ignorer, répétable ; toujours ignorés : "
                        + ', '.join(sorted(DEFAULT_EXCLUDED_DIRS)))
    p.add_argument('--original', action='append', metavar='HOTE',
                   help="hôte de l'original (ex. app.exemple.com) : chaque référence vers lui est signalée")
    p.add_argument('--js-prefix', action='append', metavar='PREFIXE',
                   help='premier segment de chemin à relever dans les chaînes JS, en plus des dossiers de premier niveau')
    p.add_argument('--no-js', action='store_true', help='ne pas relever les chemins écrits dans le JavaScript')
    p.add_argument('--urls-file', help='liens relevés dans le DOM rendu : résultat de __liens() (JSON '
                                      '[{"page","pageUrl","href"}], aussi sous forme de chaîne JSON ou de liste de '
                                      'listes), ["/chemin", …], ou texte (une URL par ligne, ou « urlDePage<TAB>href »)')
    p.add_argument('--all-targets', action='store_true', help='inclure toutes les cibles (pas seulement les cassées) dans le JSON')
    p.add_argument('--hors-perimetre', action='append', metavar='PREFIXES',
                   help="routes volontairement non construites (livraison partielle) : préfixes séparés par des "
                        "virgules (/app/settings,/app/affiliate) ou @fichier (une route par ligne) ; leurs liens "
                        "cassés sont listés à part et ne font pas échouer le contrôle")
    p.add_argument('--strict', action='store_true', help='code de sortie 1 aussi en cas d’avertissement')
    p.add_argument('--allow-remote', action='store_true', help="autoriser un --base non local (serveur à vous)")
    p.add_argument('--workers', type=int, default=8, help='requêtes HTTP simultanées (défaut 8)')
    p.add_argument('--timeout', type=float, default=10.0, help='délai par requête en s (défaut 10)')
    p.add_argument('--max-list', type=int, default=30, help='lignes max par liste dans le résumé (défaut 30)')
    p.add_argument('--version', action='version', version='check_links.py ' + VERSION)
    args = p.parse_args(argv)

    checker = Checker(args)
    report, failed = checker.run()
    if args.out:
        out_dir = os.path.dirname(os.path.abspath(args.out))
        os.makedirs(out_dir, exist_ok=True)
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_summary(report, os.path.abspath(args.out) if args.out else None, args.max_list)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
