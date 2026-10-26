#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cdp_eval.py — client minimal du Chrome DevTools Protocol (CDP), en Python STANDARD (aucune dépendance).
Plugin copieur-universel : skills capture-web (sites publics) et capture-bureau (Electron, WebView2).

Pilote un Chrome/Edge headless lancé sur un profil temporaire, une appli Electron ou une WebView2 lancée
avec un port de débogage : lister les cibles, naviguer, évaluer un fichier JS (ex. capture-kit.js) puis une
expression et écrire le résultat dans un fichier UTF-8, capturer la page en PNG/JPEG.

  py cdp_eval.py --port 9222 list [--json]
  py cdp_eval.py --port 9222 version
  py cdp_eval.py --port 9222 new [--url URL]
  py cdp_eval.py --port 9222 size [--target T] --viewport 1536x791
  py cdp_eval.py --port 9222 nav  [--target T] --url URL [--wait 3] [--viewport 375x812[@2]] [--console [FICHIER]]
  py cdp_eval.py --port 9222 eval [--target T] [--file kit.js]... [--expr "JS"] [--out sortie.txt]
                                  [--viewport 1536x791[@1]] [--no-await] [--console [FICHIER]]
  py cdp_eval.py --port 9222 shot [--target T] --out page.png [--full] [--selector CSS] [--viewport ...]
  py cdp_eval.py --port 9222 hover [--target T] --selector CSS [--out survol.png] [--wait 0.6] [--viewport ...]
  py cdp_eval.py --port 9222 console [--target T] [--out console.json] [--strict]
  py cdp_eval.py --port 9222 close [--target T]        (ferme un onglet)
  py cdp_eval.py --port 9222 close --browser           (quitte proprement le navigateur QU'ON A LANCÉ)

  T = index affiché par « list » (0 = première page), identifiant de cible, ou morceau d'URL/titre.
  Sans --target : la première cible de type « page ».

Lancer une cible (exemples) :
  Chrome/Edge headless, profil temporaire : outils\\headless.ps1 -Action lancer (recommandé), ou (cmd)
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --remote-debugging-port=9333
        --user-data-dir=%TEMP%\\cu-chrome-1 --window-size=1554,887 about:blank
    puis « size --viewport 1536x791 » : la fenêtre headless retire une marge à --window-size.
  Electron : "<appli>.exe" --remote-debugging-port=9229 --user-data-dir=<dossier temporaire>
  WebView2 : variable WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 avant le lancement.

Détails : le résultat d'eval est écrit tel quel si c'est une chaîne, en JSON sinon ; les promesses sont
attendues (« await » de premier niveau accepté) ; gros résultats et trames WebSocket fragmentées gérés.
--viewport n'agit que le temps de la commande (le réglage CDP disparaît avec la connexion) : le répéter sur
chaque nav/eval/shot/hover. « size » change la vraie fenêtre (persistant) mais une fenêtre headless ne
descend pas sous ~500 px de large : pour un petit écran, --viewport.
Codes de sortie : 0 succès, 1 erreur (connexion, cible, arguments), 2 exception JavaScript, 3 délai dépassé,
4 erreurs console trouvées (avec --strict).
"""
import argparse
import base64
import hashlib
import html
import http.client
import json
import os
import re
import socket
import struct
import sys
import time

VERSION = '1.2'
GROUP = 'cdp_eval'


# --------------------------------------------------------------------------------------------------------
# Console : UTF-8 quand la sortie est redirigée (outils Bash/PowerShell, fichiers) ; jamais d'exception
# d'encodage.
# --------------------------------------------------------------------------------------------------------
def _setup_console():
    for stream in (sys.stdout, sys.stderr):
        try:
            if not stream.isatty():
                stream.reconfigure(encoding='utf-8', errors='replace')
            else:
                stream.reconfigure(errors='replace')
        except (AttributeError, ValueError):
            pass


def info(msg):
    print(msg, flush=True)


def warn(msg):
    print('attention : ' + msg, file=sys.stderr, flush=True)


class CdpError(Exception):
    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.code = code


def fmt_int(n):
    return '{:,}'.format(n).replace(',', ' ')


# --------------------------------------------------------------------------------------------------------
# HTTP (points /json/*) : http.client direct, donc sans proxy.
# --------------------------------------------------------------------------------------------------------
def _no_listener(host, port):
    return ("aucun navigateur ni appli n'écoute sur %s:%s. Lancez la cible avec --remote-debugging-port=%s "
            "(Chrome/Edge headless : ajoutez --headless=new et --user-data-dir=<dossier temporaire> ; "
            "Electron : \"<appli>.exe\" --remote-debugging-port=%s --user-data-dir=<temp> ; voir le skill "
            "capture-bureau), attendez 1 à 2 s ou utilisez --wait-port 10." % (host, port, port, port))


def http_json(host, port, path, method='GET', timeout=10.0):
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request(method, path)
        resp = conn.getresponse()
        body = resp.read()
    except ConnectionRefusedError:
        raise CdpError(_no_listener(host, port))
    except socket.timeout:
        raise CdpError('pas de réponse de %s:%s en %ss sur %s' % (host, port, timeout, path), 3)
    except OSError as e:
        raise CdpError('connexion impossible à %s:%s (%s). %s' % (host, port, e, _no_listener(host, port)))
    finally:
        conn.close()
    if resp.status != 200:
        hint = ''
        if resp.status in (404, 405) and path.startswith('/json'):
            hint = (" — ce port répond en HTTP mais ne semble pas être un port de débogage CDP (serveur web, autre "
                    "appli ?) : vérifiez --port et la ligne de commande de la cible")
        raise CdpError('HTTP %s sur %s%s (début de la réponse : %s)'
                       % (resp.status, path, hint, ' '.join(body[:160].decode('utf-8', 'replace').split())))
    try:
        return json.loads(body.decode('utf-8'))
    except ValueError:
        raise CdpError("réponse non JSON sur %s : ce port n'est probablement pas un port de débogage CDP "
                       "(%r)" % (path, body[:120]))


def wait_port(a):
    if not a.wait_port:
        return
    deadline = time.time() + a.wait_port
    last = None
    while time.time() < deadline:
        try:
            # Sous Windows, une connexion refusée sur 127.0.0.1 met ~2 s à échouer : délai par essai plus large.
            http_json(a.host, a.port, '/json/version', timeout=max(1.0, min(5.0, deadline - time.time())))
            return
        except CdpError as e:
            if 'HTTP ' in str(e) or 'non JSON' in str(e):
                raise  # quelque chose répond, mais ce n'est pas un port CDP : inutile d'attendre
            last = e
            time.sleep(0.25)
    if last:
        raise CdpError('toujours rien après %ss d\'attente (--wait-port). %s' % (a.wait_port, _no_listener(a.host, a.port)))


# --------------------------------------------------------------------------------------------------------
# Client WebSocket minimal (RFC 6455) : poignée de main, masquage client, trames fragmentées, ping/pong.
# --------------------------------------------------------------------------------------------------------
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


def _mask(data, key):
    n = len(data)
    if not n:
        return b''
    k = (key * (n // 4 + 1))[:n]
    return (int.from_bytes(data, 'little') ^ int.from_bytes(k, 'little')).to_bytes(n, 'little')


class WebSocket:
    def __init__(self, url, timeout):
        m = re.match(r'^ws://(\[[^\]]+\]|[^/:]+)(?::(\d+))?(/.*)?$', url)
        if not m:
            raise CdpError('URL WebSocket non prise en charge (seul ws:// est géré) : %s' % url)
        host = m.group(1).strip('[]')
        port = int(m.group(2) or 80)
        path = m.group(3) or '/'
        hostport = m.group(1) + (':%d' % port if m.group(2) else '')
        try:
            self.sock = socket.create_connection((host, port), timeout=timeout)
        except ConnectionRefusedError:
            raise CdpError(_no_listener(host, port))
        except OSError as e:
            raise CdpError('connexion WebSocket impossible à %s:%s (%s)' % (host, port, e))
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        key = base64.b64encode(os.urandom(16)).decode('ascii')
        # Pas d'en-tête Origin : Chrome >= 111 refuse les origines non autorisées mais accepte un client sans Origin.
        req = ('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n') % (path, hostport, key)
        buf = bytearray()
        try:
            self.sock.sendall(req.encode('ascii'))
            while b'\r\n\r\n' not in buf:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise CdpError('connexion fermée pendant la poignée de main WebSocket (%s)' % url)
                buf += chunk
                if len(buf) > 65536:
                    raise CdpError('poignée de main WebSocket invalide (en-têtes trop longs)')
        except socket.timeout:
            self.sock.close()
            raise CdpError('pas de réponse à la poignée de main WebSocket en %ss (%s) : la cible est-elle figée, '
                           'ou un autre client la monopolise-t-il ?' % (timeout, url), 3)
        except OSError as e:
            self.sock.close()
            raise CdpError('poignée de main WebSocket interrompue (%s) : %s' % (url, e))
        head, _, rest = bytes(buf).partition(b'\r\n\r\n')
        lines = head.decode('latin-1').split('\r\n')
        parts = lines[0].split(' ', 2)
        if len(parts) < 2 or parts[1] != '101':
            hint = ''
            if len(parts) > 1 and parts[1] == '403':
                hint = (" (origine refusée : relancer la cible avec --remote-allow-origins=* "
                        "ou vérifier qu'aucun proxy ne s'interpose)")
            raise CdpError('poignée de main WebSocket refusée : %s%s' % (lines[0], hint))
        headers = {}
        for line in lines[1:]:
            k, _, v = line.partition(':')
            headers[k.strip().lower()] = v.strip()
        expected = base64.b64encode(hashlib.sha1((key + WS_GUID).encode('ascii')).digest()).decode('ascii')
        if headers.get('sec-websocket-accept') != expected:
            raise CdpError('poignée de main WebSocket invalide (Sec-WebSocket-Accept inattendu)')
        self.buf = bytearray(rest)

    def settimeout(self, t):
        self.sock.settimeout(t)

    def _read(self, n):
        while len(self.buf) < n:
            try:
                chunk = self.sock.recv(max(65536, min(n - len(self.buf), 4 << 20)))
            except socket.timeout:
                raise CdpError('délai dépassé en attendant la réponse de la cible', 3)
            except OSError as e:  # ConnectionResetError, etc. : appli ou navigateur fermé pendant l'appel
                raise CdpError('connexion WebSocket interrompue (%s) : la cible a été fermée ou a planté ?' % e)
            if not chunk:
                raise CdpError('connexion WebSocket fermée par la cible (onglet fermé, appli quittée ?)')
            self.buf += chunk
        data = bytes(self.buf[:n])
        del self.buf[:n]
        return data

    def send(self, payload, opcode=0x1):
        if isinstance(payload, str):
            payload = payload.encode('utf-8')
        n = len(payload)
        header = bytearray([0x80 | opcode])
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack('!H', n)
        else:
            header.append(0x80 | 127)
            header += struct.pack('!Q', n)
        key = os.urandom(4)
        header += key
        try:
            self.sock.sendall(bytes(header) + _mask(payload, key))
        except socket.timeout:
            raise CdpError("délai dépassé en envoyant un message à la cible", 3)
        except OSError as e:
            raise CdpError('envoi WebSocket impossible (%s) : la cible a été fermée ou a planté ?' % e)

    def recv(self):
        """Renvoie un message complet (str pour le texte, bytes pour le binaire)."""
        fragments = []
        msg_opcode = None
        while True:
            b1, b2 = self._read(2)
            fin = b1 & 0x80
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack('!H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', self._read(8))[0]
            key = self._read(4) if b2 & 0x80 else None
            payload = self._read(n) if n else b''
            if key:
                payload = _mask(payload, key)
            if opcode == 0x9:  # ping -> pong (peut arriver entre deux fragments)
                self.send(payload, 0xA)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode == 0x8:  # fermeture
                code = struct.unpack('!H', payload[:2])[0] if len(payload) >= 2 else None
                reason = payload[2:].decode('utf-8', 'replace')
                try:
                    self.send(payload[:2], 0x8)
                except (OSError, CdpError):
                    pass
                raise CdpError('la cible a fermé la connexion WebSocket (code %s %s)' % (code, reason))
            if opcode in (0x1, 0x2):
                if fragments:
                    raise CdpError('trame WebSocket invalide : nouveau message avant la fin du précédent')
                msg_opcode = opcode
                fragments.append(payload)
            elif opcode == 0x0:
                if msg_opcode is None:
                    raise CdpError('trame WebSocket de continuation inattendue')
                fragments.append(payload)
            else:
                raise CdpError('opcode WebSocket inconnu : %d' % opcode)
            if fin:
                data = b''.join(fragments)
                return data.decode('utf-8') if msg_opcode == 0x1 else data

    def close(self):
        try:
            self.send(struct.pack('!H', 1000), 0x8)
        except (OSError, CdpError):
            pass
        try:
            self.sock.close()
        except OSError:
            pass


# --------------------------------------------------------------------------------------------------------
# Session CDP sur une cible
# --------------------------------------------------------------------------------------------------------
class Cdp:
    def __init__(self, ws_url, timeout):
        self.ws = WebSocket(ws_url, timeout)
        self.timeout = timeout
        self.next_id = 0
        self.events = []
        self.watch = set()

    def _recv(self, deadline, what):
        remaining = deadline - time.time()
        if remaining <= 0:
            raise CdpError('délai dépassé (%s)' % what, 3)
        self.ws.settimeout(remaining)
        try:
            raw = self.ws.recv()
        except CdpError as e:
            if e.code == 3:
                raise CdpError('délai dépassé (%s) : augmentez --timeout, ou la page est bloquée/masquée' % what, 3)
            raise
        if isinstance(raw, bytes):
            raw = raw.decode('utf-8', 'replace')
        return json.loads(raw)

    def _event(self, msg):
        method = msg.get('method')
        if method in ('Inspector.detached', 'Inspector.targetCrashed'):
            raise CdpError("la cible s'est détachée ou a planté (%s %s)" % (method, msg.get('params', {})))
        if method in self.watch:
            self.events.append(msg)

    def call(self, method, params=None, timeout=None):
        self.next_id += 1
        mid = self.next_id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        deadline = time.time() + (timeout or self.timeout)
        while True:
            msg = self._recv(deadline, method)
            if msg.get('id') == mid:
                if 'error' in msg:
                    err = msg['error']
                    raise CdpError('%s : %s %s' % (method, err.get('message'), err.get('data', '')))
                return msg.get('result', {})
            if 'method' in msg:
                self._event(msg)

    def wait_event(self, name, timeout):
        deadline = time.time() + timeout
        while True:
            for i, ev in enumerate(self.events):
                if ev.get('method') == name:
                    return self.events.pop(i)
            msg = self._recv(deadline, 'attente de ' + name)
            if 'method' in msg:
                self._event(msg)

    def drain(self, seconds):
        """Lit les évènements qui arrivent pendant « seconds » (console, journal) sans rien envoyer."""
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                msg = self._recv(deadline, 'lecture des évènements')
            except CdpError as e:
                if e.code == 3:
                    return
                raise
            if 'method' in msg:
                self._event(msg)

    def close(self):
        self.ws.close()


# --------------------------------------------------------------------------------------------------------
# Cibles
# --------------------------------------------------------------------------------------------------------
def get_targets(a):
    lst = http_json(a.host, a.port, '/json/list', timeout=min(a.timeout, 10))
    pages = [t for t in lst if t.get('type') == 'page']
    others = [t for t in lst if t.get('type') != 'page']
    return pages + others


def pick_target(a, targets=None):
    targets = get_targets(a) if targets is None else targets
    spec = getattr(a, 'target', None)
    if not targets:
        raise CdpError('aucune cible sur %s:%s (aucun onglet ni fenêtre). Ouvrez-en une : cdp_eval.py --port %s new '
                       '--url about:blank' % (a.host, a.port, a.port))
    if spec is None or spec == '':
        pages = [t for t in targets if t.get('type') == 'page']
        if not pages:
            raise CdpError('aucune cible de type page ; précisez --target (voir « list »)')
        return pages[0]
    if re.fullmatch(r'\d+', spec):
        i = int(spec)
        if i < len(targets):
            return targets[i]
        raise CdpError('index %d hors limites : %d cible(s). Voir « list ».' % (i, len(targets)))
    for t in targets:
        if t.get('id', '').lower() == spec.lower():
            return t
    low = spec.lower()
    hits = [t for t in targets if low in (t.get('url', '') + ' ' + t.get('title', '')).lower()]
    hits.sort(key=lambda t: 0 if t.get('type') == 'page' else 1)
    if not hits:
        raise CdpError("aucune cible ne correspond à « %s » (id, index, morceau d'URL ou de titre). Cibles : %s"
                       % (spec, '; '.join('[%d] %s %s' % (i, t.get('type'), t.get('url', '')[:80])
                                          for i, t in enumerate(targets))))
    if len(hits) > 1:
        warn('%d cibles correspondent à « %s » ; utilisation de la première (%s %s)'
             % (len(hits), spec, hits[0].get('type'), hits[0].get('url', '')[:100]))
    return hits[0]


def connect(a, target):
    url = target.get('webSocketDebuggerUrl')
    if not url:  # cible déjà inspectée par un autre client sur un ancien Chrome
        url = 'ws://%s:%s/devtools/page/%s' % (a.host, a.port, target.get('id'))
    return Cdp(url, a.timeout)


# --------------------------------------------------------------------------------------------------------
# Évaluation
# --------------------------------------------------------------------------------------------------------
SAFE_STRINGIFY = r"""function () {
  var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
  return JSON.stringify(this, function (k, v) {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return '[fonction]';
    if (v && typeof v === 'object') {
      if (typeof Node !== 'undefined' && v instanceof Node) return '[' + (v.nodeName || 'Node') + ']';
      if (seen) { if (seen.has(v)) return '[circulaire]'; seen.add(v); }
    }
    return v;
  }, 2);
}"""


def describe_exception(ex, label):
    exc = ex.get('exception') or {}
    desc = exc.get('description') or exc.get('value') or ex.get('text') or 'erreur inconnue'
    line = ex.get('lineNumber')
    col = ex.get('columnNumber')
    where = ''
    if line is not None:
        where = ' (ligne %d, colonne %d)' % (line + 1, (col or 0) + 1)
    return 'exception JavaScript dans %s%s : %s' % (label, where, str(desc)[:2000])


def evaluate(cdp, source, label, await_promise, timeout):
    params = {
        'expression': source,
        'objectGroup': GROUP,
        'returnByValue': False,
        'awaitPromise': await_promise,
        'replMode': True,  # autorise « await » de premier niveau et la redéclaration de let/const
        'allowUnsafeEvalBlockedByCSP': True,
        'generatePreview': False,
    }
    r = cdp.call('Runtime.evaluate', params, timeout)
    if 'exceptionDetails' in r:
        raise CdpError(describe_exception(r['exceptionDetails'], label), 2)
    res = r.get('result', {})
    # En mode REPL, seule la complétion est attendue : une promesse RENVOYÉE (ex. « __routes().then(...) »)
    # arrive telle quelle. On l'attend explicitement.
    if await_promise and res.get('subtype') == 'promise' and res.get('objectId'):
        r = cdp.call('Runtime.awaitPromise', {'promiseObjectId': res['objectId'], 'returnByValue': False,
                                              'generatePreview': False}, timeout)
        if 'exceptionDetails' in r:
            raise CdpError(describe_exception(r['exceptionDetails'], label + ' (promesse rejetée)'), 2)
        res = r.get('result', {})
    return res


def fetch_value(cdp, obj, timeout):
    """Renvoie (genre, valeur) ; genre = string | json | json-text | raw | undefined."""
    if 'unserializableValue' in obj:  # NaN, Infinity, -0, BigInt
        return 'raw', obj['unserializableValue']
    t = obj.get('type')
    if t == 'undefined':
        return 'undefined', None
    if t == 'string':
        return 'string', obj.get('value', '')
    if t in ('number', 'boolean') or obj.get('subtype') == 'null':
        return 'json', obj.get('value')
    if t in ('function', 'symbol'):
        return 'string', obj.get('description', '')
    oid = obj.get('objectId')
    if not oid:
        return 'json', obj.get('value')
    if obj.get('subtype') == 'node':  # élément DOM : son HTML (ou son texte), plus utile qu'un {} vide
        r = cdp.call('Runtime.callFunctionOn', {
            'objectId': oid, 'returnByValue': True,
            'functionDeclaration': 'function () { return this.outerHTML !== undefined ? this.outerHTML : '
                                   '(this.textContent !== null ? this.textContent : String(this)); }'}, timeout)
        if 'exceptionDetails' not in r:
            return 'string', r.get('result', {}).get('value', '')
    try:
        r = cdp.call('Runtime.callFunctionOn', {'objectId': oid, 'functionDeclaration': 'function () { return this; }',
                                                'returnByValue': True, 'awaitPromise': False}, timeout)
        if 'exceptionDetails' not in r:
            return 'json', r.get('result', {}).get('value')
    except CdpError as e:
        warn('valeur non transmissible telle quelle (%s) : conversion JSON sécurisée' % str(e)[:160])
    r = cdp.call('Runtime.callFunctionOn', {'objectId': oid, 'functionDeclaration': SAFE_STRINGIFY,
                                            'returnByValue': True, 'awaitPromise': False}, timeout)
    if 'exceptionDetails' in r:
        return 'string', obj.get('description', '[objet]')
    val = r.get('result', {}).get('value')
    return ('json-text', val) if isinstance(val, str) else ('string', obj.get('description', '[objet]'))


def render(kind, value):
    if kind in ('string', 'json-text', 'raw'):
        return value if value is not None else ''
    if kind == 'undefined':
        return ''
    return json.dumps(value, ensure_ascii=False, indent=2)


def _ensure_dir(path):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)


def write_text(path, text):
    _ensure_dir(path)
    with open(path, 'w', encoding='utf-8', newline='') as f:  # newline='' : pas de \r\n ajoutés sous Windows
        f.write(text)


def write_bytes(path, data):
    _ensure_dir(path)
    with open(path, 'wb') as f:
        f.write(data)


def apply_viewport(cdp, spec, settle):
    m = re.fullmatch(r'(\d+)[x*](\d+)(?:@([\d.]+))?', spec.strip().lower())
    if not m:
        raise CdpError('--viewport attendu sous la forme LARGEURxHAUTEUR[@ÉCHELLE], ex. 1536x791 ou 1536x791@1')
    w, h = int(m.group(1)), int(m.group(2))
    dpr = float(m.group(3)) if m.group(3) else 0  # 0 = garder l'échelle de l'écran
    cdp.call('Emulation.setDeviceMetricsOverride', {'width': w, 'height': h, 'deviceScaleFactor': dpr,
                                                    'mobile': False})
    time.sleep(settle)


def read_source(path):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return f.read()
    except OSError as e:
        raise CdpError('lecture impossible de %s : %s' % (path, e))


# --------------------------------------------------------------------------------------------------------
# Console de la page : Runtime.consoleAPICalled, Runtime.exceptionThrown, Log.entryAdded (requêtes en échec,
# violations, avertissements du navigateur). Le headless n'a pas de fenêtre DevTools : c'est le seul moyen de
# vérifier « zéro erreur console » sans le navigateur intégré.
# --------------------------------------------------------------------------------------------------------
CONSOLE_EVENTS = ('Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded')
LEVELS = {'error': 'erreur', 'assert': 'erreur', 'warning': 'avertissement', 'warn': 'avertissement',
          'info': 'info', 'log': 'info', 'debug': 'debug', 'verbose': 'debug', 'trace': 'debug', 'dir': 'info',
          'table': 'info'}


def _arg_text(o):
    if 'value' in o:
        v = o['value']
        return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return o.get('unserializableValue') or o.get('description') or o.get('type', '')


def console_start(cdp, discard_replay):
    """Active la collecte. discard_replay=True : oublie les messages anciens que Chrome rejoue à l'activation."""
    for ev in CONSOLE_EVENTS:
        cdp.watch.add(ev)
    cdp.call('Runtime.enable')
    try:
        cdp.call('Log.enable')
    except CdpError:
        pass  # certaines cibles (workers, anciens Electron) n'ont pas le domaine Log
    cdp.drain(0.4)
    if discard_replay:
        cdp.events = [e for e in cdp.events if e.get('method') not in CONSOLE_EVENTS]


def console_collect(cdp):
    out = []
    for ev in cdp.events:
        m, p = ev.get('method'), ev.get('params', {})
        if m == 'Runtime.consoleAPICalled':
            st = (p.get('stackTrace') or {}).get('callFrames') or [{}]
            out.append({'niveau': LEVELS.get(p.get('type'), p.get('type')), 'source': 'console',
                        'texte': ' '.join(_arg_text(x) for x in p.get('args', []))[:2000],
                        'url': st[0].get('url', ''), 'ligne': (st[0].get('lineNumber') or 0) + 1 if st[0] else None})
        elif m == 'Runtime.exceptionThrown':
            d = p.get('exceptionDetails', {})
            exc = d.get('exception') or {}
            out.append({'niveau': 'erreur', 'source': 'exception',
                        'texte': str(exc.get('description') or d.get('text') or 'exception')[:2000],
                        'url': d.get('url', ''), 'ligne': (d.get('lineNumber') or 0) + 1})
        elif m == 'Log.entryAdded':
            e = p.get('entry', {})
            out.append({'niveau': LEVELS.get(e.get('level'), e.get('level')), 'source': e.get('source', 'log'),
                        'texte': str(e.get('text', ''))[:2000] + (' (' + e['url'] + ')' if e.get('url') and
                                                                  e.get('url') not in str(e.get('text', '')) else ''),
                        'url': e.get('url', ''), 'ligne': (e.get('lineNumber') or 0) + 1 if e.get('lineNumber') is not None else None})
    cdp.events = [e for e in cdp.events if e.get('method') not in CONSOLE_EVENTS]
    return out


def console_report(entries, dest, label):
    """Écrit le rapport (fichier JSON, ou console si dest == '-') et renvoie le nombre d'erreurs."""
    n_err = sum(1 for e in entries if e['niveau'] == 'erreur')
    n_warn = sum(1 for e in entries if e['niveau'] == 'avertissement')
    resume = 'console (%s) : %d erreur(s), %d avertissement(s), %d autre(s)' % (label, n_err, n_warn,
                                                                                 len(entries) - n_err - n_warn)
    if dest and dest != '-':
        write_text(dest, json.dumps({'resume': resume, 'messages': entries}, ensure_ascii=False, indent=2))
        info('%s -> %s' % (resume, dest))
    else:
        info(resume)
    if not dest or dest == '-':
        for e in entries:
            if e['niveau'] in ('erreur', 'avertissement'):
                where = ''
                if e.get('url') and e['url'] not in e['texte']:
                    where = ' [%s%s]' % (e['url'][-80:], ':%s' % e['ligne'] if e.get('ligne') else '')
                info('  %-13s %s%s' % (e['niveau'], e['texte'][:300].replace('\n', ' '), where))
    return n_err


# --------------------------------------------------------------------------------------------------------
# Commandes
# --------------------------------------------------------------------------------------------------------
def cmd_list(a):
    targets = get_targets(a)
    if a.json:
        out = [dict(index=i, **{k: t.get(k) for k in ('id', 'type', 'title', 'url', 'webSocketDebuggerUrl')})
               for i, t in enumerate(targets)]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0
    info('%d cible(s) sur %s:%s (index ou id utilisable par --target) :' % (len(targets), a.host, a.port))
    for i, t in enumerate(targets):
        title = html.unescape(t.get('title') or '').replace('\n', ' ')  # /json/list échappe « & » en « &amp; »
        if len(title) > 60:
            title = title[:57] + '...'
        url = t.get('url') or ''
        if len(url) > 110:
            url = url[:107] + '...'
        info('[%d] %-15s %s | %s | id=%s' % (i, t.get('type'), title or '(sans titre)', url, t.get('id')))
    return 0


def cmd_version(a):
    v = http_json(a.host, a.port, '/json/version', timeout=min(a.timeout, 10))
    print(json.dumps(v, ensure_ascii=False, indent=2))
    return 0


def cmd_new(a):
    from urllib.parse import quote
    path = '/json/new' + ('?' + quote(a.url, safe=':/?&=#%@+,;~') if a.url else '')
    try:
        t = http_json(a.host, a.port, path, method='PUT', timeout=min(a.timeout, 10))
    except CdpError as e:  # anciens Chrome : GET seulement
        if 'HTTP 405' in str(e) or 'HTTP 404' in str(e):
            t = http_json(a.host, a.port, path, method='GET', timeout=min(a.timeout, 10))
        else:
            raise
    info('nouvelle cible : id=%s type=%s url=%s' % (t.get('id'), t.get('type'), t.get('url')))
    return 0


def _measure(cdp, timeout):
    r = evaluate(cdp, 'JSON.stringify([innerWidth, innerHeight, devicePixelRatio])', 'size', True, timeout)
    return json.loads(r.get('value') or '[0,0,1]')


def cmd_size(a):
    m = re.fullmatch(r'(\d+)[x*](\d+)', a.viewport.strip().lower())
    if not m:
        raise CdpError('--viewport attendu sous la forme LARGEURxHAUTEUR, ex. 1536x791')
    want_w, want_h = int(m.group(1)), int(m.group(2))
    target = pick_target(a)
    ver = http_json(a.host, a.port, '/json/version', timeout=min(a.timeout, 10))
    bws = ver.get('webSocketDebuggerUrl')
    if not bws:
        raise CdpError("point d'accès « navigateur » absent de /json/version : redimensionnez la fenêtre à la main, "
                       "ou utilisez --viewport sur eval et shot")
    browser = Cdp(bws, a.timeout)
    page = connect(a, target)
    try:
        try:
            w = browser.call('Browser.getWindowForTarget', {'targetId': target['id']})
        except CdpError as e:
            raise CdpError('cette cible ne permet pas de redimensionner sa fenêtre (%s) : utilisez --viewport sur '
                           'eval et shot' % str(e)[:160])
        wid, bounds = w['windowId'], w.get('bounds', {})
        if bounds.get('windowState') not in (None, 'normal'):
            browser.call('Browser.setWindowBounds', {'windowId': wid, 'bounds': {'windowState': 'normal'}})
            time.sleep(a.settle)
            bounds = browser.call('Browser.getWindowBounds', {'windowId': wid}).get('bounds', bounds)
        cur_w, cur_h = bounds.get('width', want_w), bounds.get('height', want_h)
        vw, vh, dpr = _measure(page, a.timeout)
        for _ in range(4):  # la fenêtre inclut cadre et barres : on corrige d'après le viewport mesuré
            if (vw, vh) == (want_w, want_h):
                break
            prev = (vw, vh)
            cur_w = max(100, cur_w + want_w - vw)
            cur_h = max(100, cur_h + want_h - vh)
            browser.call('Browser.setWindowBounds', {'windowId': wid, 'bounds': {'width': cur_w, 'height': cur_h}})
            time.sleep(a.settle)
            vw, vh, dpr = _measure(page, a.timeout)
            if (vw, vh) == prev:
                break  # la fenêtre refuse de changer (taille minimale atteinte, écran trop petit)
        try:  # taille réelle de la fenêtre (et non la valeur demandée, que le navigateur a pu refuser)
            b = browser.call('Browser.getWindowBounds', {'windowId': wid}).get('bounds', {})
            cur_w, cur_h = b.get('width', cur_w), b.get('height', cur_h)
        except CdpError:
            pass
    finally:
        page.close()
        browser.close()
    info('OK size : viewport %sx%s (DPR %s), fenêtre %sx%s' % (vw, vh, dpr, cur_w, cur_h))
    if (vw, vh) != (want_w, want_h) and dpr != int(dpr) and abs(vw - want_w) <= 1 and abs(vh - want_h) <= 1:
        info("  (écart d'1 px inévitable à l'échelle %s : la fenêtre se règle en pixels physiques ; pour la taille "
             "exacte, --viewport %sx%s@%s sur eval, shot et hover)" % (dpr, want_w, want_h, dpr))
        return 0
    if (vw, vh) != (want_w, want_h):
        if want_w < 520 and vw > want_w:
            warn("viewport obtenu %sx%s au lieu de %sx%s : une fenêtre headless ne descend pas sous ~500 px de "
                 "large. Pour un petit écran, gardez cette taille et ajoutez --viewport %sx%s à nav (chargement "
                 "à la bonne largeur), eval, shot et hover." % (vw, vh, want_w, want_h, want_w, want_h))
        else:
            warn("viewport obtenu %sx%s au lieu de %sx%s (fenêtre limitée par la taille de l'écran ?) ; "
                 "utilisez --viewport sur nav, eval et shot" % (vw, vh, want_w, want_h))
        return 1
    return 0


def cmd_nav(a):
    target = pick_target(a)
    cdp = connect(a, target)
    try:
        cdp.watch.add('Page.loadEventFired')
        cdp.call('Page.enable')
        if a.console is not None:
            console_start(cdp, discard_replay=True)
        if a.viewport:  # chargement à cette taille : une page qui décide de sa disposition au chargement la voit
            apply_viewport(cdp, a.viewport, 0.2)
        r = cdp.call('Page.navigate', {'url': a.url})
        if r.get('errorText'):
            raise CdpError('navigation vers %s impossible : %s' % (a.url, r['errorText']))
        if r.get('loaderId'):  # nouveau document (pas une simple ancre)
            try:
                cdp.wait_event('Page.loadEventFired', a.load_timeout)
            except CdpError as e:
                if e.code != 3:
                    raise
                warn('évènement « load » non reçu en %ss (page lente ou connexion persistante) ; on continue'
                     % a.load_timeout)
        if a.wait:
            if a.console is not None:
                cdp.drain(a.wait)  # lire la console pendant l'attente
            else:
                time.sleep(a.wait)
        res = evaluate(cdp, 'JSON.stringify([location.href, document.title, document.readyState, innerWidth, '
                            'innerHeight, devicePixelRatio])', 'nav', True, a.timeout)
        href, title, state, vw, vh, dpr = json.loads(res.get('value') or '[]')
        info('OK nav : %s | titre « %s » | %s | viewport %sx%s, DPR %s' % (href, title, state, vw, vh, dpr))
        if href.rstrip('/') != a.url.rstrip('/'):
            info("  (URL finale différente de l'URL demandée : redirection ?)")
        n_err = 0
        if a.console is not None:
            cdp.drain(0.3)
            n_err = console_report(console_collect(cdp), a.console, 'chargement de ' + href[:80])
        if a.viewport:
            try:
                cdp.call('Emulation.clearDeviceMetricsOverride', {}, 10)
            except CdpError:
                pass
    finally:
        cdp.close()
    return 4 if (a.strict and n_err) else 0


def cmd_eval(a):
    if not a.file and a.expr is None:
        raise CdpError('rien à évaluer : donnez --file et/ou --expr')
    sources = [(read_source(f), f) for f in (a.file or [])]
    if a.expr is not None:
        sources.append((a.expr, '--expr'))
    target = pick_target(a)
    cdp = connect(a, target)
    entries = None
    try:
        if a.console is not None:  # messages produits PENDANT l'évaluation (clic, ouverture d'un état…)
            console_start(cdp, discard_replay=True)
        if a.viewport:
            apply_viewport(cdp, a.viewport, a.settle)
        res = None
        for src, label in sources:
            res = evaluate(cdp, src, label, not a.no_await, a.timeout)
        kind, value = fetch_value(cdp, res, a.timeout)
        text = render(kind, value)
        try:
            cdp.call('Runtime.releaseObjectGroup', {'objectGroup': GROUP}, 10)
        except CdpError:
            pass
        if a.console is not None:
            cdp.drain(0.5)
            entries = console_collect(cdp)
        if a.viewport:
            try:
                cdp.call('Emulation.clearDeviceMetricsOverride', {}, 10)
            except CdpError:
                pass
    finally:
        cdp.close()
    if kind == 'undefined':
        warn('le résultat est « undefined » (la dernière instruction ne renvoie rien ?)')
    if not a.out or a.out == '-':
        sys.stdout.write(text)
        if not text.endswith('\n'):
            sys.stdout.write('\n')
        sys.stdout.flush()
    else:
        write_text(a.out, text)
        genre = {'string': 'chaîne', 'json': 'JSON', 'json-text': 'JSON (conversion sécurisée)',
                 'raw': 'valeur spéciale', 'undefined': 'undefined'}[kind]
        info('OK eval : %s caractères écrits dans %s (%s) - cible %s'
             % (fmt_int(len(text)), a.out, genre, (target.get('url') or '')[:100]))
    if entries is not None:
        n_err = console_report(entries, a.console, "pendant l'évaluation")
        if a.strict and n_err:
            return 4
    return 0


def cmd_console(a):
    """Messages de console déjà émis par la page (Chrome les rejoue à l'activation), puis ceux des N s suivantes."""
    target = pick_target(a)
    cdp = connect(a, target)
    try:
        console_start(cdp, discard_replay=False)
        if a.wait:
            cdp.drain(a.wait)
        entries = console_collect(cdp)
    finally:
        cdp.close()
    n_err = console_report(entries, a.out or '-', (target.get('url') or '')[:80])
    if not entries:
        info("  (aucun message : Chrome ne garde pas les messages d'avant la dernière navigation si personne "
             "n'écoutait ; pour le chargement, préférez « nav --console »)")
    return 4 if (a.strict and n_err) else 0


def cmd_hover(a):
    """Survol réel (Input.dispatchMouseEvent) : déclenche :hover CSS, mouseover/mouseenter et les infobulles."""
    target = pick_target(a)
    cdp = connect(a, target)
    data = None
    try:
        if a.viewport:
            apply_viewport(cdp, a.viewport, a.settle)
        if a.selector:
            js = ('(function(){var e=document.querySelector(%s); if(!e) return null; var r=e.getBoundingClientRect();'
                  'if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth){e.scrollIntoView({block:"center",'
                  'inline:"center"}); r=e.getBoundingClientRect();}'
                  'return JSON.stringify([r.left+r.width/2, r.top+r.height/2, r.width, r.height]);})()'
                  % json.dumps(a.selector))
            res = evaluate(cdp, js, '--selector', True, a.timeout)
            if res.get('type') != 'string':
                raise CdpError('aucun élément ne correspond à --selector %s' % a.selector)
            x, y, w, h = json.loads(res['value'])
            if w < 1 or h < 1:
                raise CdpError("l'élément %s est invisible (taille %sx%s)" % (a.selector, w, h))
        elif a.x is not None and a.y is not None:
            x, y = a.x, a.y
        else:
            raise CdpError('donnez --selector ou --x et --y (px CSS du viewport)')
        for dx in (-3, 0):  # deux mouvements : certaines bibliothèques ignorent un premier évènement isolé
            cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x + dx, 'y': y, 'button': 'none'})
            time.sleep(0.05)
        time.sleep(a.wait)
        if a.out:
            fmt = 'jpeg' if a.out.lower().endswith(('.jpg', '.jpeg')) else 'png'
            r = cdp.call('Page.captureScreenshot', {'format': fmt, 'fromSurface': True}, a.timeout)
            data = base64.b64decode(r['data'])
        if a.leave:
            cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': 0, 'y': 0, 'button': 'none'})
        if a.viewport:
            try:
                cdp.call('Emulation.clearDeviceMetricsOverride', {}, 10)
            except CdpError:
                pass
    finally:
        cdp.close()
    info('OK hover : souris en %s,%s (px CSS)%s' % (round(x), round(y), (' ; ' + a.selector) if a.selector else ''))
    if data is not None:
        write_bytes(a.out, data)
        size = _png_size(data)
        info('  image : %s (%s octets%s)' % (a.out, fmt_int(len(data)), ', %dx%d px' % size if size else ''))
    return 0


def cmd_close(a):
    if a.browser:
        ver = http_json(a.host, a.port, '/json/version', timeout=min(a.timeout, 10))
        bws = ver.get('webSocketDebuggerUrl')
        if not bws:
            raise CdpError("point d'accès « navigateur » absent : fermez le navigateur par ses processus")
        b = Cdp(bws, min(a.timeout, 10))
        try:
            b.call('Browser.close', {}, 10)
        except CdpError:
            pass  # la connexion se coupe souvent avant la réponse : c'est le signe que le navigateur s'arrête
        finally:
            b.close()
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                http_json(a.host, a.port, '/json/version', timeout=1.5)
            except CdpError:
                info('OK close : navigateur arrêté (le port %s ne répond plus) ; reste à supprimer son profil '
                     'temporaire, après quelques secondes' % a.port)
                return 0
            time.sleep(0.5)
        warn('le navigateur répond encore après 15 s : arrêtez ses processus par le dossier de profil')
        return 1
    target = pick_target(a)
    conn = http.client.HTTPConnection(a.host, a.port, timeout=min(a.timeout, 10))
    try:
        conn.request('GET', '/json/close/' + target['id'])
        resp = conn.getresponse()
        body = resp.read()
    except OSError as e:
        raise CdpError('fermeture impossible (%s)' % e)
    finally:
        conn.close()
    if resp.status != 200:
        raise CdpError('fermeture refusée : HTTP %s %s' % (resp.status, body[:120]))
    info('OK close : cible fermée (%s %s)' % (target.get('type'), (target.get('url') or '')[:100]))
    return 0


def _png_size(data):
    """Largeur x hauteur d'une image PNG ou JPEG (None si illisible)."""
    if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        return struct.unpack('!II', data[16:24])
    if data[:2] == b'\xff\xd8':  # JPEG : chercher le segment SOFn
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                i += 1 if marker == 0xFF else 2
                continue
            seg = struct.unpack('!H', data[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('!HH', data[i + 5:i + 9])
                return w, h
            i += 2 + seg
    return None


# Barres de défilement visibles avant une capture « au-delà du viewport » : les éléments qui en ont une sont
# retenus dans une propriété de window (rien n'est écrit dans le DOM) ; après la capture, on compte ceux qui
# débordent toujours mais n'ont plus de barre.
SCROLLBARS_MARK = (
    "(function(){var K=Symbol.for('copieur-barres'),a=document.querySelectorAll('*'),s=[],m=Math.min(a.length,30000);"
    "function bar(e){var c=getComputedStyle(e);return Math.max(e.offsetWidth-e.clientWidth-(parseFloat(c.borderLeftWidth)||0)"
    "-(parseFloat(c.borderRightWidth)||0),e.offsetHeight-e.clientHeight-(parseFloat(c.borderTopWidth)||0)"
    "-(parseFloat(c.borderBottomWidth)||0));}"
    "for(var i=0;i<m;i++){var e=a[i];if(e.clientWidth>0&&(e.offsetWidth>e.clientWidth||e.offsetHeight>e.clientHeight)"
    "&&bar(e)>=1)s.push(e);}window[K]={els:s,root:innerWidth-document.documentElement.clientWidth};return s.length;})()")
SCROLLBARS_LOST = (
    "(function(){var o=window[Symbol.for('copieur-barres')];if(!o)return 0;var n=0;"
    "function bar(e){var c=getComputedStyle(e);return Math.max(e.offsetWidth-e.clientWidth-(parseFloat(c.borderLeftWidth)||0)"
    "-(parseFloat(c.borderRightWidth)||0),e.offsetHeight-e.clientHeight-(parseFloat(c.borderTopWidth)||0)"
    "-(parseFloat(c.borderBottomWidth)||0));}"
    "o.els.forEach(function(e){if(e.isConnected&&(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)&&bar(e)<1)n++;});"
    "var r=document.documentElement;if(o.root>0&&innerWidth-r.clientWidth<=0&&r.scrollHeight>innerHeight)n++;return n;})()")


def _scrollbar_sig(cdp, timeout, js=SCROLLBARS_MARK):
    try:
        return evaluate(cdp, js, 'barres', False, timeout).get('value')
    except CdpError:
        return None


def _restore_scrollbars(cdp, before, timeout):
    """Chrome (vu sur la version 154, headless) masque les barres de défilement des conteneurs internes après
    Page.captureScreenshot avec captureBeyondViewport, et les garde masquées jusqu'au rechargement : les images
    et les mesures suivantes (clientWidth, positions) seraient décalées de la largeur d'une barre (15 px).
    Ni clearDeviceMetricsOverride ni setScrollbarsHidden ne les rétablissent ; un redimensionnement de la
    fenêtre (+1 px en largeur et en hauteur, puis retour à la taille exacte) le fait. On ne touche à la fenêtre
    que si des barres ont réellement disparu (Electron : si la fenêtre ne peut pas être redimensionnée par CDP,
    un avertissement demande de recharger)."""
    if before and _scrollbar_sig(cdp, timeout, SCROLLBARS_LOST):
        try:
            w = cdp.call('Browser.getWindowForTarget', {}, 10)
            wid, b = w['windowId'], w.get('bounds', {})
            if b.get('windowState') in (None, 'normal') and b.get('width') and b.get('height'):
                # largeur ET hauteur : une barre fine personnalisée (::-webkit-scrollbar) ne revient qu'ainsi
                cdp.call('Browser.setWindowBounds', {'windowId': wid, 'bounds': {'width': b['width'] + 1,
                                                                                  'height': b['height'] + 1}}, 10)
                time.sleep(0.2)
                cdp.call('Browser.setWindowBounds', {'windowId': wid, 'bounds': {'width': b['width'],
                                                                                  'height': b['height']}}, 10)
                time.sleep(0.3)
        except CdpError:
            pass
        if _scrollbar_sig(cdp, timeout, SCROLLBARS_LOST):
            warn('après cette capture, Chrome a masqué des barres de défilement (largeurs et positions décalées de '
                 'quelques px) : recharger la page (« nav ») avant de mesurer ou de refaire une image')
    try:
        evaluate(cdp, "delete window[Symbol.for('copieur-barres')]", 'barres', False, timeout)
    except CdpError:
        pass


def cmd_shot(a):
    fmt = a.format or ('jpeg' if a.out.lower().endswith(('.jpg', '.jpeg')) else 'png')
    target = pick_target(a)
    cdp = connect(a, target)
    sig = None
    try:
        if a.selector or a.full:  # ces captures passent par captureBeyondViewport (voir _restore_scrollbars)
            sig = _scrollbar_sig(cdp, a.timeout)
        if a.viewport:
            apply_viewport(cdp, a.viewport, a.settle)
        if a.front:
            cdp.call('Page.bringToFront')
            time.sleep(0.3)
        params = {'format': fmt, 'fromSurface': True}
        if fmt == 'jpeg':
            params['quality'] = a.quality
        if a.selector:
            js = ('(function(){var e=document.querySelector(%s); if(!e) return null; var r=e.getBoundingClientRect();'
                  'return JSON.stringify([r.left+scrollX, r.top+scrollY, r.width, r.height]);})()'
                  % json.dumps(a.selector))
            res = evaluate(cdp, js, '--selector', True, a.timeout)
            if res.get('type') != 'string':
                raise CdpError('aucun élément ne correspond à --selector %s' % a.selector)
            x, y, w, h = json.loads(res['value'])
            if w < 1 or h < 1:
                raise CdpError("l'élément %s est invisible (taille %sx%s)" % (a.selector, w, h))
            params['clip'] = {'x': x, 'y': y, 'width': w, 'height': h, 'scale': 1}
            params['captureBeyondViewport'] = True
        elif a.full:
            m = cdp.call('Page.getLayoutMetrics')
            size = m.get('cssContentSize') or m.get('contentSize')
            params['clip'] = {'x': 0, 'y': 0, 'width': max(1, int(size['width'] + 0.999)),
                              'height': max(1, int(size['height'] + 0.999)), 'scale': 1}
            params['captureBeyondViewport'] = True
        try:
            r = cdp.call('Page.captureScreenshot', params, a.timeout)
        except CdpError as e:
            if e.code == 3:
                raise CdpError('capture non obtenue en %ss : fenêtre masquée ou minimisée (Electron) ? essayez '
                               '--front, ou affichez la fenêtre' % a.timeout, 3)
            raise
        data = base64.b64decode(r['data'])
        if a.viewport:
            try:
                cdp.call('Emulation.clearDeviceMetricsOverride', {}, 10)
            except CdpError:
                pass
        if sig is not None:
            _restore_scrollbars(cdp, sig, a.timeout)
    finally:
        cdp.close()
    write_bytes(a.out, data)
    size = _png_size(data)
    info('OK shot : %s (%s octets%s)' % (a.out, fmt_int(len(data)), ', %dx%d px' % size if size else ''))
    return 0


# --------------------------------------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------------------------------------
def build_parser():
    # Options communes acceptées aussi APRÈS la commande (« list --port 9333 »).
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--port', type=int, default=argparse.SUPPRESS, help='port de débogage (défaut 9222)')
    common.add_argument('--host', default=argparse.SUPPRESS, help='hôte (défaut 127.0.0.1)')
    common.add_argument('--timeout', type=float, default=argparse.SUPPRESS,
                        help='délai max par commande, en s (défaut 60)')
    common.add_argument('--wait-port', type=float, default=argparse.SUPPRESS,
                        help="attendre jusqu'à N s que le port réponde (utile juste après le lancement)")

    p = argparse.ArgumentParser(prog='cdp_eval.py', allow_abbrev=False,
                                description='Client Chrome DevTools Protocol minimal (Python standard). '
                                            'Plugin copieur-universel.',
                                epilog='Exemple : py cdp_eval.py --port 9333 eval --target 0 --file capture-kit.js '
                                       '--expr "__info()" --out info.json')
    p.add_argument('--port', type=int, default=9222, help='port de débogage (défaut 9222)')
    p.add_argument('--host', default='127.0.0.1', help='hôte (défaut 127.0.0.1)')
    p.add_argument('--timeout', type=float, default=60.0, help='délai max par commande, en s (défaut 60)')
    p.add_argument('--wait-port', type=float, default=0.0,
                   help="attendre jusqu'à N s que le port réponde (utile juste après le lancement)")
    p.add_argument('--version', action='version', version='cdp_eval.py ' + VERSION)
    sub = p.add_subparsers(dest='cmd', metavar='{list,version,new,size,nav,eval,shot,hover,console,close}')
    sub.required = True
    cons = dict(nargs='?', const='-', default=None, metavar='FICHIER',
                help='relever la console (erreurs, avertissements, requêtes en échec) ; sans FICHIER : affichage')

    s = sub.add_parser('list', parents=[common], help='lister les cibles (onglets, fenêtres, workers)')
    s.add_argument('--json', action='store_true', help='sortie JSON')
    s.set_defaults(func=cmd_list)

    s = sub.add_parser('version', parents=[common], help='afficher /json/version (navigateur, protocole)')
    s.set_defaults(func=cmd_version)

    s = sub.add_parser('new', parents=[common], help='ouvrir une nouvelle cible (onglet)')
    s.add_argument('--url', default='about:blank')
    s.set_defaults(func=cmd_new)

    s = sub.add_parser('size', parents=[common],
                       help='redimensionner la fenêtre pour obtenir ce viewport (persistant, headless compris)')
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--viewport', required=True, help='LARGEURxHAUTEUR voulue pour innerWidth x innerHeight')
    s.add_argument('--settle', type=float, default=0.4, help='attente après chaque redimensionnement (défaut 0.4)')
    s.set_defaults(func=cmd_size)

    s = sub.add_parser('nav', parents=[common], help='naviguer vers une URL et attendre le chargement')
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--url', required=True)
    s.add_argument('--wait', type=float, default=1.0, help='attente supplémentaire après « load », en s (défaut 1)')
    s.add_argument('--load-timeout', type=float, default=30.0, help='attente max de « load », en s (défaut 30)')
    s.add_argument('--viewport', help='charger la page à cette taille LARGEURxHAUTEUR[@ÉCHELLE] (petit écran)')
    s.add_argument('--console', **cons)
    s.add_argument('--strict', action='store_true', help='code 4 si la console contient des erreurs')
    s.set_defaults(func=cmd_nav)

    s = sub.add_parser('eval', parents=[common], help='évaluer des fichiers JS puis une expression')
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--file', action='append', help="fichier JS évalué avant l'expression (répétable)")
    s.add_argument('--expr', help='expression JS ; son résultat est écrit (sinon celui du dernier fichier)')
    s.add_argument('--out', help='fichier de sortie UTF-8 (défaut : console)')
    s.add_argument('--no-await', action='store_true', help='ne pas attendre les promesses')
    s.add_argument('--viewport', help="taille temporaire LARGEURxHAUTEUR[@ÉCHELLE] pendant l'évaluation")
    s.add_argument('--settle', type=float, default=0.5, help='attente après --viewport, en s (défaut 0.5)')
    s.add_argument('--console', **cons)
    s.add_argument('--strict', action='store_true', help='code 4 si la console contient des erreurs')
    s.set_defaults(func=cmd_eval)

    s = sub.add_parser('hover', parents=[common], help='survoler un élément (vrai :hover, infobulles)')
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--selector', help="élément à survoler (son centre) ; amené dans la vue s'il est hors écran")
    s.add_argument('--x', type=float, help='ou position x en px CSS du viewport')
    s.add_argument('--y', type=float, help='et position y')
    s.add_argument('--wait', type=float, default=0.6, help="attente avant l'image (délai d'infobulle), défaut 0.6")
    s.add_argument('--out', help='image prise pendant le survol (.png ou .jpg)')
    s.add_argument('--leave', action='store_true', help='ramener la souris en 0,0 après (fin du survol)')
    s.add_argument('--viewport', help='taille temporaire LARGEURxHAUTEUR[@ÉCHELLE]')
    s.add_argument('--settle', type=float, default=0.5, help='attente après --viewport, en s (défaut 0.5)')
    s.set_defaults(func=cmd_hover)

    s = sub.add_parser('console', parents=[common], help='messages de console de la page (erreurs, avertissements)')
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--wait', type=float, default=1.0, help='écouter encore N s (défaut 1)')
    s.add_argument('--out', help='rapport JSON (défaut : affichage)')
    s.add_argument('--strict', action='store_true', help='code 4 si la console contient des erreurs')
    s.set_defaults(func=cmd_console)

    s = sub.add_parser('close', parents=[common], help="fermer un onglet, ou quitter le navigateur qu'on a lancé")
    s.add_argument('--target', help="onglet à fermer : index, id ou morceau d'URL/titre")
    s.add_argument('--browser', action='store_true',
                   help='Browser.close : quitte proprement tout le navigateur (seulement celui que VOUS avez lancé)')
    s.set_defaults(func=cmd_close)

    s = sub.add_parser('shot', parents=[common], help="capture d'écran PNG/JPEG")
    s.add_argument('--target', help="index, id ou morceau d'URL/titre (défaut : première page)")
    s.add_argument('--out', required=True, help='fichier image (.png ou .jpg)')
    s.add_argument('--full', action='store_true', help="toute la hauteur du document (pas d'un conteneur interne)")
    s.add_argument('--selector', help='capturer seulement cet élément (sélecteur CSS)')
    s.add_argument('--format', choices=['png', 'jpeg'], help="défaut : d'après l'extension de --out")
    s.add_argument('--quality', type=int, default=90, help='qualité JPEG (défaut 90)')
    s.add_argument('--viewport', help='taille temporaire LARGEURxHAUTEUR[@ÉCHELLE] pendant la capture')
    s.add_argument('--settle', type=float, default=0.5, help='attente après --viewport, en s (défaut 0.5)')
    s.add_argument('--front', action='store_true', help='Page.bringToFront avant la capture')
    s.set_defaults(func=cmd_shot)
    return p


def main(argv=None):
    _setup_console()
    a = build_parser().parse_args(argv)
    try:
        wait_port(a)
        return a.func(a)
    except CdpError as e:
        print('erreur : %s' % e, file=sys.stderr, flush=True)
        return e.code
    except OSError as e:  # filet de sécurité : fichier de sortie inaccessible, réseau…
        print('erreur : %s' % e, file=sys.stderr, flush=True)
        return 1
    except KeyboardInterrupt:
        print('interrompu', file=sys.stderr)
        return 130


if __name__ == '__main__':
    sys.exit(main())
