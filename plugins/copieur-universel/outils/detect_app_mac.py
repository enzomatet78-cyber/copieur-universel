#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
detect_app_mac.py — reconnaissance d'une appli de bureau macOS (.app), en Python STANDARD (aucune dépendance).
Plugin copieur-universel : skill reconnaissance-appli (partie B) ; équivalent macOS de detect_app.ps1 (Windows).

Dit avec quoi une appli .app est construite (Electron, CEF, NW.js, Qt, Flutter, Java, Tauri, Mac Catalyst,
SwiftUI, AppKit, appli iPhone, navigateur) et comment la capturer ensuite (skill capture-bureau).

LECTURE SEULE. L'outil lit Contents/Info.plist, la liste de Contents/Frameworks, la présence de
Contents/Resources/app.asar ou app/, l'en-tête de l'archive asar (liste des fichiers, package.json), les
commandes de chargement Mach-O du binaire principal (bibliothèques liées et plateforme : ce qu'affichent
« otool -L » et « vtool -show-build », sans les outils Xcode), et cherche quelques chaînes dans ce binaire
(Tauri). Il ne lance, ne modifie, ne décompile rien. Dossiers de données (~/Library/Application Support/<nom>,
~/Library/Containers/<bundle id>) : existence seulement (lue dans la liste du dossier parent), jamais ouverts,
écrits avec ~ ; app et binaire restent des chemins réels (ils servent au lancement).
Avec --pid : retrouve le .app du processus (ps -p N -o comm=) et lit la liste de ses bibliothèques chargées
(lsof ; chemins .framework/.dylib seulement), sans toucher au processus.

  python3 detect_app_mac.py --app "/Applications/Visual Studio Code.app" [--out detect.json] [--compact]
  python3 detect_app_mac.py --app "Visual Studio Code"     (nom cherché dans /Applications, ~/Applications…)
  python3 detect_app_mac.py --pid 12345                    (appli déjà ouverte)

Sortie : JSON UTF-8 sur la console (et dans --out) : ok, resume, framework, confiance, cdp, indices, app, nom,
bundleId, version, binaire, plateforme, bibliotheques, electron, ecransPresumes, misesAJour, donnees,
strategie (voie de capture et commandes prêtes), avertissements.
framework : electron | cef | nwjs | qt | flutter | java | tauri | catalyst | swiftui | appkit | ios |
            chromium-browser | gecko | webkit-browser | inconnu.
Codes de sortie : 0 framework reconnu, 1 framework inconnu, 2 erreur d'usage (cible introuvable, pas un .app,
PID absent…).
"""
import argparse
import json
import os
import platform
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import time

VERSION = '1.0'
OUTILS = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser('~')
APP_DIRS = ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities',
            os.path.join(HOME, 'Applications'), os.path.join(HOME, 'Desktop')]
SKIP_DIRS = {'node_modules', 'extensions', 'locales', '.git', '_CodeSignature'}
UI_LIBS = re.compile(r'^(react|react-dom|vue|svelte|preact|solid-js|lit|jquery|@angular/core|tailwindcss|bootstrap|'
                     r'@mui/material|@material-ui/core|antd|@chakra-ui/react|@mantine/core|@radix-ui/.+|'
                     r'@headlessui/react|styled-components|@emotion/react|@fluentui/react.*|@blueprintjs/core|'
                     r'monaco-editor|codemirror|@codemirror/.+|xterm|@xterm/xterm|electron-updater|update-electron-app)$')
BROWSER_IDS = [('com.google.chrome', 'chromium-browser'), ('org.chromium.', 'chromium-browser'),
               ('com.microsoft.edgemac', 'chromium-browser'), ('com.brave.browser', 'chromium-browser'),
               ('com.vivaldi.', 'chromium-browser'), ('com.operasoftware.', 'chromium-browser'),
               ('company.thebrowser.', 'chromium-browser'), ('ru.yandex.desktop.yandex-browser', 'chromium-browser'),
               ('org.mozilla.firefox', 'gecko'), ('org.mozilla.nightly', 'gecko'),
               ('com.apple.safari', 'webkit-browser')]
BROWSER_FW = re.compile(r'^(Google Chrome|Google Chrome for Testing|Chromium|Microsoft Edge|Brave Browser|Vivaldi|'
                        r'Opera|Thorium) Framework\.framework$')
TAURI = [b'__TAURI__', b'__TAURI_INTERNALS__', b'tauri://localhost', b'tauri.localhost', b'__TAURI_IPC__']
WAILS = [b'wails.localhost', b'wails://']
PLATFORMS = {1: 'MACOS', 2: 'IOS', 3: 'TVOS', 4: 'WATCHOS', 5: 'BRIDGEOS', 6: 'MACCATALYST', 7: 'IOSSIMULATOR',
             8: 'TVOSSIMULATOR', 9: 'WATCHOSSIMULATOR', 10: 'DRIVERKIT', 11: 'VISIONOS', 12: 'VISIONOSSIMULATOR'}
CPU = {0x0100000C: 'arm64', 0x01000007: 'x86_64', 7: 'i386', 12: 'arm', 18: 'ppc'}
LC_DYLIB = {0xC, 0x80000018, 0x8000001F, 0x20, 0x80000023}   # LOAD, WEAK, REEXPORT, LAZY, UPWARD
VSCODE_SETTINGS = ('{"update.mode": "none", "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false, '
                   '"telemetry.telemetryLevel": "off", "workbench.enableExperiments": false}')


class Usage(Exception):
    def __init__(self, msg, pistes=None):
        Exception.__init__(self, msg)
        self.pistes = pistes or []


def run(cmd, timeout=20):
    """Commande en lecture seule ; sortie texte, ou '' si la commande manque ou échoue."""
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return r.stdout.decode('utf-8', 'replace')
    except (OSError, subprocess.SubprocessError):
        return ''


def tilde(p):
    """Chemin sous le dossier personnel écrit avec ~ (le nom d'utilisateur ne va pas dans detect.json)."""
    if p and HOME and HOME != '/' and (p == HOME or p.startswith(HOME + '/')):
        return '~' + p[len(HOME):]
    return p


def q(s):
    """Argument entre guillemets pour bash/zsh."""
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('`', '\\`') + '"'


def read_plist(path):
    try:
        with open(path, 'rb') as f:
            d = plistlib.load(f)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def listdir(path):
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


# --------------------------------------------------------------------------------------------------------
# Cible
# --------------------------------------------------------------------------------------------------------
def bundle_root(path):
    """Le .app le plus extérieur qui contient path (un « Helper.app » intérieur renvoie à l'appli principale)."""
    parts = os.path.abspath(path).split('/')
    for i, part in enumerate(parts):
        if i > 0 and part.lower().endswith('.app'):
            return '/'.join(parts[:i + 1])
    return None


def resolve_app(arg, warn):
    p = os.path.expanduser(arg)
    if '/' in arg or arg.startswith('~') or (arg.lower().endswith('.app') and os.path.isdir(p)):
        if not os.path.exists(p):
            raise Usage('chemin introuvable : ' + arg, ['vérifier le chemin (ls -d "/Applications/<Appli>.app")',
                                                        'ou donner seulement le nom : --app "<Appli>"'])
        root = bundle_root(p) or bundle_root(os.path.realpath(p))
        if root:
            if os.path.normpath(root) != os.path.normpath(os.path.abspath(p)):
                warn('cible ramenée au paquet de l\'appli : ' + tilde(root))
            return root
        if os.path.isdir(p):
            apps = [e for e in listdir(p) if e.lower().endswith('.app')]
            if len(apps) == 1:
                warn('dossier sans .app : analyse de ' + apps[0])
                return os.path.join(p, apps[0])
            if apps:
                raise Usage('plusieurs applis dans ce dossier : ' + ', '.join(apps[:10]),
                            ['préciser --app "<dossier>/<Appli>.app"'])
        raise Usage('ce n\'est pas une appli .app : ' + arg,
                    ['donner le dossier « <Appli>.app » (clic droit > Afficher le contenu du paquet le montre)'])
    name = arg[:-4] if arg.lower().endswith('.app') else arg
    for d in APP_DIRS:
        for e in listdir(d):
            if e.lower() == (name + '.app').lower():
                found = os.path.join(d, e)
                warn('nom résolu : ' + tilde(found))
                return found
    exe = shutil.which(arg)
    if exe:
        root = bundle_root(os.path.realpath(exe))
        if root:
            warn('commande « %s » : appli %s' % (arg, tilde(root)))
            return root
    if not re.search(r'["\'\\]', name):
        out = run(['mdfind', "kMDItemContentType == 'com.apple.application-bundle' && "
                             "kMDItemFSName == '%s.app'c" % name], 10)
        for line in out.splitlines():
            if line.lower().endswith('.app') and os.path.isdir(line):
                warn('trouvée par Spotlight : ' + tilde(line))
                return line
    raise Usage('appli introuvable : ' + arg, ['donner le chemin complet : --app "/Applications/<Appli>.app"',
                                               'appli ouverte : pgrep -x "<nom du processus>" puis --pid <PID>'])


def resolve_pid(pid, warn):
    if not re.fullmatch(r'\d{1,9}', pid or ''):
        raise Usage('PID non numérique : ' + str(pid), ['pgrep -x "<nom du processus>" donne le PID'])
    comm = run(['ps', '-p', pid, '-o', 'comm='], 10).strip()
    if not comm:
        raise Usage('aucun processus de PID ' + pid, ['pgrep -x "<nom du processus>" donne le PID'])
    root = bundle_root(comm) if comm.startswith('/') else None
    if not root:
        raise Usage('le processus %s n\'est pas une appli .app (exécutable : %s)' % (pid, tilde(comm)),
                    ['outil prévu pour les applis .app ; pour un outil en ligne de commande, rien à capturer'])
    if '.app/' in comm[len(root) + 1:]:
        warn('processus annexe (%s) : appli principale analysée' % os.path.basename(comm))
    return root, comm


# --------------------------------------------------------------------------------------------------------
# Mach-O : bibliothèques liées et plateforme (équivalent de otool -L et vtool -show-build)
# --------------------------------------------------------------------------------------------------------
def _thin(f, off, cpu_hint):
    f.seek(off)
    m = f.read(4)
    if m in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe'):
        e = '<'
    elif m in (b'\xfe\xed\xfa\xcf', b'\xfe\xed\xfa\xce'):
        e = '>'
    else:
        return None
    is64 = m in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf')
    cpu, _sub, _ft, ncmds, sizeofcmds, _flags = struct.unpack(e + 'iiIIII', f.read(24))
    if is64:
        f.read(4)
    raw = f.read(min(sizeofcmds, 8 << 20))
    res = {'arch': CPU.get(cpu & 0xFFFFFFFF, hex(cpu & 0xFFFFFFFF)), 'dylibs': [], 'rpaths': [],
           'plateforme': None, 'minimum': None}
    i = 0
    for _ in range(min(ncmds, 4096)):
        if i + 8 > len(raw):
            break
        cmd, size = struct.unpack(e + 'II', raw[i:i + 8])
        if size < 8:
            break
        body = raw[i:i + size]
        if cmd in LC_DYLIB or cmd == 0x8000001C:          # dylib_command / rpath_command : décalage du nom
            no = struct.unpack(e + 'I', body[8:12])[0]
            s = body[no:].split(b'\0', 1)[0].decode('utf-8', 'replace')
            (res['rpaths'] if cmd == 0x8000001C else res['dylibs']).append(s)
        elif cmd == 0x32 and len(body) >= 16:              # LC_BUILD_VERSION
            plat, minos = struct.unpack(e + 'II', body[8:16])
            res['plateforme'] = PLATFORMS.get(plat, str(plat))
            res['minimum'] = '%d.%d' % (minos >> 16, (minos >> 8) & 0xFF)
        elif cmd in (0x24, 0x25) and len(body) >= 12 and not res['plateforme']:   # LC_VERSION_MIN_MACOSX / IPHONEOS
            v = struct.unpack(e + 'I', body[8:12])[0]
            res['plateforme'] = 'MACOS' if cmd == 0x24 else 'IOS'
            res['minimum'] = '%d.%d' % (v >> 16, (v >> 8) & 0xFF)
        i += size
    return res


def macho(path):
    """{archs, dylibs, rpaths, plateforme, minimum} du binaire, ou None si ce n'est pas un Mach-O."""
    try:
        with open(path, 'rb') as f:
            head = f.read(8)
            if len(head) < 8:
                return None
            magic, n = struct.unpack('>II', head)
            slices = []
            if magic in (0xCAFEBABE, 0xCAFEBABF) and 0 < n < 32:     # binaire universel (une classe Java a n > 32)
                is64 = magic == 0xCAFEBABF
                size = 32 if is64 else 20
                raw = f.read(n * size)
                for k in range(n):
                    rec = raw[k * size:(k + 1) * size]
                    if len(rec) < size:
                        break
                    cpu = struct.unpack('>i', rec[:4])[0] & 0xFFFFFFFF
                    off = struct.unpack('>Q', rec[8:16])[0] if is64 else struct.unpack('>I', rec[8:12])[0]
                    slices.append((cpu, off))
            else:
                slices.append((None, 0))
            host = {'arm64': 0x0100000C, 'x86_64': 0x01000007}.get(platform.machine())
            slices.sort(key=lambda s: 0 if s[0] == host else 1)
            archs = [CPU.get(c, hex(c)) for c, _ in slices if c is not None]
            info = _thin(f, slices[0][1], slices[0][0])
            if info is None:
                return None
            info['archs'] = archs or [info['arch']]
            return info
    except OSError:
        return None


def short_lib(p):
    """'/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit' -> 'AppKit'."""
    m = re.search(r'([^/]+)\.framework/', p)
    return m.group(1) if m else os.path.basename(p)


def scan_binary(path, patterns, max_bytes):
    """Motifs trouvés dans le binaire (lecture par blocs de 8 Mo, jusqu'à max_bytes)."""
    found, tail, total = set(), b'', 0
    keep = max(len(p) for p in patterns) - 1
    try:
        with open(path, 'rb') as f:
            while total < max_bytes:
                chunk = f.read(8 << 20)
                if not chunk:
                    break
                total += len(chunk)
                buf = tail + chunk
                for p in patterns:
                    if p not in found and p in buf:
                        found.add(p)
                if len(found) == len(patterns):
                    break
                tail = buf[-keep:]
    except OSError:
        pass
    return found


# --------------------------------------------------------------------------------------------------------
# Electron : archive asar, package.json, fichiers HTML
# --------------------------------------------------------------------------------------------------------
def asar_read(path):
    """(arbre de l'en-tête, début des données) d'une archive asar ; (None, 0) si illisible."""
    try:
        with open(path, 'rb') as f:
            h = f.read(16)
            if len(h) < 16:
                return None, 0
            four, header_size, _payload, json_len = struct.unpack('<IIII', h)
            if four != 4 or json_len > header_size or json_len > (64 << 20):
                return None, 0
            return json.loads(f.read(json_len).decode('utf-8', 'replace')), 8 + header_size
    except (OSError, ValueError):
        return None, 0


def asar_html(node, prefix, out, depth=0):
    for name, sub in sorted((node.get('files') or {}).items()):
        if not isinstance(sub, dict):
            continue
        if 'files' in sub:
            if name not in SKIP_DIRS and depth < 12:
                asar_html(sub, prefix + name + '/', out, depth + 1)
        elif name.lower().endswith(('.html', '.htm')) and len(out) < 200:
            out.append(prefix + name)


def asar_file(asar, tree, base, name):
    """Contenu (texte) d'un fichier à la racine de l'archive, ou None."""
    node = (tree.get('files') or {}).get(name)
    if not isinstance(node, dict) or 'offset' not in node:
        if isinstance(node, dict) and node.get('unpacked'):
            try:
                with open(os.path.join(asar + '.unpacked', name), 'rb') as f:
                    return f.read(2 << 20).decode('utf-8', 'replace')
            except OSError:
                return None
        return None
    try:
        with open(asar, 'rb') as f:
            f.seek(base + int(node['offset']))
            return f.read(min(int(node.get('size', 0)), 2 << 20)).decode('utf-8', 'replace')
    except (OSError, ValueError):
        return None


def dir_html(root, limit=200):
    out = []
    for d, dirs, files in os.walk(root):
        rel = os.path.relpath(d, root)
        depth = 0 if rel == '.' else rel.count('/') + 1
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and depth < 12)
        for fn in sorted(files):
            if fn.lower().endswith(('.html', '.htm')):
                out.append(os.path.normpath(os.path.join(rel, fn)))
                if len(out) >= limit:
                    return out
    return out


def read_text(path, limit=2 << 20):
    try:
        with open(path, 'rb') as f:
            return f.read(limit).decode('utf-8', 'replace')
    except OSError:
        return None


def json_or_none(s):
    try:
        d = json.loads(s) if s else None
        return d if isinstance(d, dict) else None
    except ValueError:
        return None


def electron_details(res_dir, indices):
    """Appli Electron : où est le code, package.json, product.json (VS Code), fichiers HTML."""
    asar = os.path.join(res_dir, 'app.asar')
    appdir = os.path.join(res_dir, 'app')
    pkg = prod = None
    html = []
    det = {}
    if os.path.isfile(asar):
        det['appli'] = 'Contents/Resources/app.asar'
        det['format'] = 'archive asar'
        tree, base = asar_read(asar)
        if tree:
            asar_html(tree, '', html)
            pkg = json_or_none(asar_file(asar, tree, base, 'package.json'))
            prod = json_or_none(asar_file(asar, tree, base, 'product.json'))
        else:
            indices.append('en-tête de app.asar illisible')
    elif os.path.isdir(appdir):
        det['appli'] = 'Contents/Resources/app'
        det['format'] = 'dossier non archivé'
        pkg = json_or_none(read_text(os.path.join(appdir, 'package.json')))
        prod = json_or_none(read_text(os.path.join(appdir, 'product.json')))
        html = dir_html(appdir)
    if pkg:
        deps = {}
        for k in ('dependencies', 'devDependencies'):
            if isinstance(pkg.get(k), dict):
                deps.update(pkg[k])
        libs = ['%s@%s' % (n, v) for n, v in sorted(deps.items()) if UI_LIBS.match(n)]
        det['package'] = {'name': pkg.get('name'), 'productName': pkg.get('productName'),
                          'version': pkg.get('version'), 'main': pkg.get('main'),
                          'bibliothequesInterface': libs[:20]}
    if prod and prod.get('dataFolderName'):
        det['vscode'] = {'nameShort': prod.get('nameShort'), 'dataFolderName': prod.get('dataFolderName'),
                         'majIntegree': bool(prod.get('updateUrl'))}
    return det, pkg, prod, html


# --------------------------------------------------------------------------------------------------------
# Analyse
# --------------------------------------------------------------------------------------------------------
def analyse(app, max_bytes, pid=None, comm=None):
    t0 = time.time()
    warns, indices = [], []
    res = {'ok': True, 'outil': 'detect_app_mac.py ' + VERSION}
    contents = os.path.join(app, 'Contents')
    info = read_plist(os.path.join(contents, 'Info.plist'))
    ios_wrapper = None
    if info is None:
        # Appli iPhone/iPad installée sur un Mac Apple silicon : X.app/Wrapper/X.app (paquet iOS à plat).
        for w in [os.path.join(app, 'WrappedBundle')] + [os.path.join(app, 'Wrapper', e)
                                                          for e in listdir(os.path.join(app, 'Wrapper'))]:
            if w.lower().endswith(('.app', 'wrappedbundle')) and read_plist(os.path.join(w, 'Info.plist')):
                ios_wrapper = os.path.realpath(w)
                info = read_plist(os.path.join(w, 'Info.plist'))
                break
        if info is None and read_plist(os.path.join(app, 'Info.plist')):
            ios_wrapper = app
            info = read_plist(os.path.join(app, 'Info.plist'))
        if info is None:
            raise Usage('Info.plist introuvable ou illisible dans ' + tilde(app),
                        ['est-ce bien une appli ? (ls "<Appli>.app/Contents")'])
    exe_name = info.get('CFBundleExecutable') or os.path.splitext(os.path.basename(app))[0]
    exe = os.path.join(ios_wrapper, exe_name) if ios_wrapper else os.path.join(contents, 'MacOS', exe_name)
    if not os.path.isfile(exe):
        warns.append('binaire principal absent : ' + tilde(exe))
    bid = info.get('CFBundleIdentifier') or ''
    nom = info.get('CFBundleDisplayName') or info.get('CFBundleName') or os.path.splitext(os.path.basename(app))[0]
    nom = re.sub('[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', str(nom)).strip()   # marques de direction (ex. WhatsApp)
    # app et binaire : chemins réels (servent au lancement) ; seuls les dossiers de données sont écrits avec ~.
    res.update({'app': app, 'nom': nom, 'bundleId': bid or None,
                'version': info.get('CFBundleShortVersionString') or info.get('CFBundleVersion'),
                'binaire': exe})

    fw_dir = os.path.join(contents, 'Frameworks')
    fws = listdir(fw_dir)
    fw_names = [f for f in fws if f.endswith('.framework') or f.endswith('.dylib')]
    res_dir = os.path.join(contents, 'Resources')
    mo = macho(exe) if os.path.isfile(exe) else None
    libs = []
    if mo:
        libs = mo['dylibs']
        res['plateforme'] = {'systeme': mo['plateforme'], 'minimum': mo['minimum'], 'archs': mo['archs']}
    elif os.path.isfile(exe):
        first = (read_text(exe, 200) or '').split('\n', 1)[0]
        warns.append('binaire principal non Mach-O' + (' (script : %s)' % first[:60] if first.startswith('#!') else ''))
    short = [short_lib(p) for p in libs]
    ios_support = any('/System/iOSSupport/' in p for p in libs)

    # Bibliothèques chargées (appli ouverte) : seulement les noms de frameworks et dylib non système.
    modules = []
    if pid:
        out = run(['lsof', '-n', '-P', '-w', '-p', pid, '-Fn'], 20)
        seen = set()
        for line in out.splitlines():
            if not line.startswith('n/'):
                continue
            p = line[1:]
            if ('.framework/' in p or p.endswith(('.dylib', '.so', '.jnilib'))) and not p.startswith(('/System/', '/usr/lib/')):
                s = short_lib(p)
                if s not in seen:
                    seen.add(s)
                    modules.append(s)
        res['processus'] = {'pid': int(pid), 'executable': comm, 'modulesCles': modules[:40]}
        if not out:
            warns.append('lsof n\'a rien rendu (droits ?) : détection par fichiers seulement')

    def has_fw(rx):
        return [f for f in fw_names + modules + [m + '.framework' for m in modules] if re.match(rx, f)]

    fw, conf, libelle, cdp = None, 'faible', None, False
    electron = None
    misc = {}
    html, html_src = [], None
    upd = []

    # Mises à jour automatiques
    if has_fw(r'^Squirrel\.framework$') or 'Squirrel' in short:
        upd.append('Squirrel.Mac (Squirrel.framework, processus ShipIt) : après le lancement, pgrep -lf ShipIt ; '
                   'ne jamais l\'arrêter, le signaler à l\'utilisateur')
    if has_fw(r'^Sparkle\.framework$') or 'Sparkle' in short or info.get('SUFeedURL'):
        upd.append('Sparkle : une fenêtre « Mise à jour disponible » peut s\'ouvrir ; ne jamais cliquer « Installer », '
                   'la fermer')
    if os.path.isdir(os.path.join(contents, '_MASReceipt')):
        upd.append('Mac App Store : mises à jour gérées par l\'App Store (rien à bloquer)')

    # 1. Appli iPhone/iPad
    if ios_wrapper or (mo and mo['plateforme'] in ('IOS', 'IOSSIMULATOR')):
        fw, conf, libelle = 'ios', 'haute', 'appli iPhone/iPad (Apple silicon)'
        indices.append('ios : ' + ('paquet iOS enveloppé (Wrapper/)' if ios_wrapper else 'plateforme IOS du binaire'))
    # 2. Electron, NW.js, CEF
    ef = has_fw(r'^Electron Framework\.framework$')
    if not fw and (ef or os.path.isfile(os.path.join(res_dir, 'app.asar'))):
        det, pkg, prod, html = electron_details(res_dir, indices)
        html_src = det.get('appli')
        v = None
        if ef:
            fi = read_plist(os.path.join(fw_dir, 'Electron Framework.framework', 'Resources', 'Info.plist')) or {}
            v = fi.get('CFBundleVersion') or fi.get('CFBundleShortVersionString')
            indices.append('electron : Contents/Frameworks/Electron Framework.framework' + (' (version %s)' % v if v else ''))
        if det.get('appli'):
            indices.append('electron : ' + det['appli'] + ' (' + det['format'] + ')')
        if any(s == 'Electron Framework' for s in short):
            indices.append('electron : binaire lié à Electron Framework')
        det['version'] = v
        electron = det
        fw, conf, cdp = 'electron', ('haute' if ef else 'moyenne'), True
        libelle = 'Electron' + (' ' + v if v else '')
        libs_ui = (det.get('package') or {}).get('bibliothequesInterface') or []
        if any(x.startswith(('electron-updater', 'update-electron-app')) for x in libs_ui):
            upd.append('electron-updater / update-electron-app : mise à jour automatique (Squirrel.Mac sur macOS)')
        if det.get('vscode', {}).get('majIntegree'):
            upd.append('mise à jour intégrée de VS Code : bloquée par "update.mode": "none" dans le profil temporaire '
                       '(voir strategie)')
    nw = has_fw(r'^nwjs Framework\.framework$')
    if not fw and (nw or os.path.exists(os.path.join(res_dir, 'app.nw'))):
        fi = read_plist(os.path.join(fw_dir, 'nwjs Framework.framework', 'Resources', 'Info.plist')) or {}
        v = fi.get('CFBundleShortVersionString') or fi.get('CFBundleVersion')
        fw, conf, cdp, libelle = 'nwjs', ('haute' if nw else 'moyenne'), True, 'NW.js' + (' (nwjs Framework %s)' % v if v else '')
        indices.append('nwjs : ' + ('nwjs Framework.framework' if nw else 'Contents/Resources/app.nw'))
        if os.path.isdir(os.path.join(res_dir, 'app.nw')):
            html, html_src = dir_html(os.path.join(res_dir, 'app.nw')), 'Contents/Resources/app.nw'
    cef = has_fw(r'^Chromium Embedded Framework\.framework$')
    if not fw and cef:
        fi = read_plist(os.path.join(fw_dir, 'Chromium Embedded Framework.framework', 'Resources', 'Info.plist')) or {}
        v = fi.get('CFBundleShortVersionString') or fi.get('CFBundleVersion')
        fw, conf, cdp, libelle = 'cef', 'haute', True, 'CEF (Chromium Embedded Framework)' + (' ' + v if v else '')
        indices.append('cef : Contents/Frameworks/Chromium Embedded Framework.framework')
    # 3. Navigateurs
    if not fw:
        low = bid.lower()
        kind = next((k for pre, k in BROWSER_IDS if low.startswith(pre)), None)
        bf = [f for f in fw_names if BROWSER_FW.match(f)]
        if bf and not kind:
            kind = 'chromium-browser'
        if not kind and os.path.isfile(os.path.join(contents, 'MacOS', 'XUL')):
            kind = 'gecko'
        if kind:
            fw, conf = kind, 'haute'
            libelle = {'chromium-browser': 'navigateur Chromium', 'gecko': 'Gecko (Mozilla)',
                       'webkit-browser': 'navigateur WebKit (Safari)'}[kind]
            indices.append(kind + ' : ' + (('bundle id ' + bid) if bid else '') + (' ; ' + ', '.join(bf) if bf else '')
                           + (' ; Contents/MacOS/XUL' if kind == 'gecko' else ''))
    # 4. Flutter, Qt
    fl = has_fw(r'^FlutterMacOS\.framework$')
    if not fw and (fl or os.path.isdir(os.path.join(fw_dir, 'App.framework', 'Resources', 'flutter_assets'))):
        fw, conf, libelle = 'flutter', 'haute', 'Flutter (macOS)'
        indices.append('flutter : ' + ('FlutterMacOS.framework' if fl else 'App.framework/Resources/flutter_assets'))
    qt = has_fw(r'^(Qt[A-Za-z0-9]*\.framework|libQt[0-9]?[A-Za-z0-9]*\.[0-9.]*dylib)$') + \
        [s for s in short if re.match(r'^(Qt[A-Z][A-Za-z0-9]*|libQt)', s)]
    if not fw and qt:
        qt = sorted(set(re.sub(r'\.framework$', '', x) for x in qt))
        fw, conf, libelle = 'qt', 'haute', 'Qt'
        indices.append('qt : ' + ', '.join(qt[:8]))
        misc['qt'] = qt
        if any('WebEngine' in x for x in qt):
            indices.append('qt : Qt WebEngine présent (vues web inspectables par QTWEBENGINE_REMOTE_DEBUGGING)')
    # 5. Tauri (WKWebView) : chaînes du binaire
    if not fw and os.path.isfile(exe):
        hit = scan_binary(exe, TAURI + WAILS, max_bytes)
        th = [p.decode() for p in TAURI if p in hit]
        wh = [p.decode() for p in WAILS if p in hit]
        if th:
            fw, conf, libelle = 'tauri', ('haute' if len(th) >= 2 else 'moyenne'), 'Tauri (WKWebView)'
            indices.append('tauri : chaînes ' + ', '.join(th) + ' dans le binaire')
        elif wh:
            indices.append('wails : chaînes ' + ', '.join(wh) + ' (interface web en WKWebView, pas de CDP)')
    # 6. Java
    if not fw:
        jhits = []
        if any(k in info for k in ('JVMOptions', 'Java', 'JavaX', 'JVMMainClassName', 'JVMRuntime')):
            jhits.append('clés Java dans Info.plist')
        if any(s in ('JavaVM', 'libjli.dylib', 'libjvm.dylib') for s in short):
            jhits.append('binaire lié à la JVM')
        n = 0
        for d, dirs, files in os.walk(contents):
            n += len(files) + len(dirs)
            rel = os.path.relpath(d, contents)
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.endswith('.lproj')
                       and (rel == '.' or rel.count('/') < 8)]
            j = [f for f in files if f in ('libjvm.dylib', 'libjli.dylib') or f.endswith('.jar')]
            if j:
                jhits.append('%s dans Contents/%s' % (j[0], '' if rel == '.' else rel))
                break
            if n > 40000:
                break
        if any(m == 'libjvm.dylib' for m in modules):
            jhits.append('libjvm.dylib chargée')
        if jhits:
            fw, libelle = 'java', 'Java (JVM)'
            conf = 'haute' if len(jhits) >= 2 or any('libjvm' in h or '.jar' in h for h in jhits) else 'moyenne'
            indices.append('java : ' + ' ; '.join(jhits))
    # 7. Natif Apple : Catalyst, SwiftUI, AppKit
    if not fw and mo and (mo['plateforme'] == 'MACCATALYST' or ios_support):
        fw, conf, libelle = 'catalyst', 'haute', 'Mac Catalyst (UIKit)'
        indices.append('catalyst : ' + ('plateforme MACCATALYST' if mo['plateforme'] == 'MACCATALYST' else
                                        'UIKit de /System/iOSSupport'))
    if not fw and 'SwiftUI' in short:
        fw, conf, libelle = 'swiftui', 'moyenne', 'SwiftUI' + (' + AppKit' if 'AppKit' in short else '')
        indices.append('swiftui : binaire lié à SwiftUI' + (' et AppKit' if 'AppKit' in short else ''))
    if not fw and ('AppKit' in short or 'Cocoa' in short):
        fw, conf, libelle = 'appkit', 'moyenne', 'AppKit (Cocoa)'
        indices.append('appkit : binaire lié à ' + ('AppKit' if 'AppKit' in short else 'Cocoa'))
    if not fw:
        fw, conf, libelle = 'inconnu', 'faible', 'type non déterminé'
        indices.append('aucun indice décisif (frameworks : %s)' % (', '.join(fw_names[:8]) or 'aucun'))
    if 'WebKit' in short and fw in ('appkit', 'swiftui', 'catalyst', 'tauri', 'inconnu'):
        indices.append('webkit : binaire lié à WebKit (WKWebView possible : contenu web, mais pas de CDP)')

    notable = [s for s in short if re.match(r'^(AppKit|Cocoa|SwiftUI|UIKit|WebKit|JavaVM|Carbon|Metal|'
                                            r'libswiftCore\.dylib|libjvm\.dylib|libjli\.dylib|Qt.*|Flutter.*|'
                                            r'Electron Framework|Chromium Embedded Framework|nwjs Framework)$', s)]
    notable += [s for s, p in zip(short, libs) if p.startswith('@') and '.framework/' in p]   # frameworks de l'appli
    res['bibliotheques'] = sorted(set(notable))[:30]
    if fws:
        res['frameworksEmbarques'] = fws[:40]
    res.update({'framework': fw, 'libelle': libelle, 'confiance': conf, 'cdp': cdp, 'indices': indices})
    if electron is not None:
        res['electron'] = electron
    res.update(misc)
    if html:
        res['ecransPresumes'] = {'source': html_src, 'liste': html[:40], 'total': len(html)}
    res['misesAJour'] = upd

    # Dossiers de données : existence seulement (noms lus dans le dossier parent), jamais ouverts.
    names = {nom, info.get('CFBundleName'), exe_name, os.path.splitext(os.path.basename(app))[0], bid}
    if electron:
        p = electron.get('package') or {}
        names |= {p.get('productName'), p.get('name')}
        names |= {(electron.get('vscode') or {}).get('nameShort')}
    names = {n.lower() for n in names if isinstance(n, str) and n.strip()}
    dossiers = []
    asup = os.path.join(HOME, 'Library', 'Application Support')
    for e in listdir(asup):
        if e.lower() in names:
            dossiers.append(os.path.join(asup, e))
    if bid:
        for parent in ('Containers', 'Caches', 'HTTPStorages', 'WebKit'):
            pd = os.path.join(HOME, 'Library', parent)
            for e in listdir(pd):
                if e.lower() == bid.lower():
                    dossiers.append(os.path.join(pd, e))
        gc = os.path.join(HOME, 'Library', 'Group Containers')
        for e in listdir(gc):
            if e.lower().endswith('.' + bid.lower()):
                dossiers.append(os.path.join(gc, e))
        pref = os.path.join(HOME, 'Library', 'Preferences')
        if (bid + '.plist').lower() in {e.lower() for e in listdir(pref)}:
            dossiers.append(os.path.join(pref, bid + '.plist'))
    dfn = (electron or {}).get('vscode', {}).get('dataFolderName') if electron else None
    if dfn and dfn in listdir(HOME):
        dossiers.append(os.path.join(HOME, dfn))
    res['donnees'] = {'dossiers': [tilde(d) for d in dossiers],
                      'note': 'Existence seulement : ne jamais lire, ouvrir ni copier ces dossiers (sessions, jetons, '
                              'données personnelles). C\'est la raison du profil temporaire.'}

    res['strategie'] = strategy(fw, app, exe, exe_name, electron, misc, upd)
    res['avertissements'] = warns
    vs = (' ' + res['version']) if res.get('version') else ''
    res['resume'] = '%s%s : %s ; confiance %s ; %s ; capture : %s' % (
        nom, vs, libelle, conf, 'CDP possible' if cdp else 'pas de CDP', res['strategie']['skill'])
    res['dureeSecondes'] = round(time.time() - t0, 2)
    order = ['ok', 'outil', 'resume', 'framework', 'libelle', 'confiance', 'cdp', 'indices', 'app', 'nom', 'bundleId',
             'version', 'binaire', 'plateforme', 'bibliotheques', 'frameworksEmbarques', 'processus', 'electron', 'qt',
             'ecransPresumes', 'misesAJour', 'donnees', 'strategie', 'avertissements', 'dureeSecondes']
    return {k: res[k] for k in order if k in res}


# --------------------------------------------------------------------------------------------------------
# Stratégie de capture (skill capture-bureau)
# --------------------------------------------------------------------------------------------------------
def strategy(fw, app, exe, exe_name, electron, misc, upd):
    cdp_py = 'python3 ' + q(os.path.join(OUTILS, 'cdp_eval.py'))
    slug = re.sub(r'[^a-z0-9]+', '-', exe_name.lower()).strip('-') or 'appli'
    qexe = q(exe)
    instance = {'etape': 'Avant le lancement : une instance de l\'utilisateur est-elle ouverte ? (PID affichés : ne '
                         'jamais les piloter ni les fermer)',
                'commande': 'ps -axo pid=,comm= | grep -F -- ' + q(exe)}
    no_open = 'Lancer le binaire lui-même (PID connu), jamais « open -a » : pas de PID, et l\'instance de l\'utilisateur ' \
              'peut être réutilisée avec ses sessions. Chaque appel Bash est un nouveau shell : noter en clair les valeurs ' \
              'affichées (PID, PROFIL).'
    perms = 'Permissions Accessibilité et Enregistrement de l\'écran (Réglages Système > Confidentialité et sécurité) : ' \
            'accordées par l\'utilisateur lui-même, jamais par l\'agent.'
    menus = 'Menus : barre de menus globale de macOS (pas dans la fenêtre ni dans le DOM) ; boutons rouge/orange/vert ' \
            'dessinés par AppKit : les décrire, ou les lire avec computer-use (app_menu, app_screenshot).'
    if fw in ('electron', 'nwjs', 'cef'):
        mk = 'T="${TMPDIR:-/tmp}"; PROFIL="$(mktemp -d "${T%/}/cu-' + slug + '-XXXXXXXX")" || exit 1; '
        vsc = bool(electron and electron.get('vscode'))
        if vsc:
            mk += ('mkdir -p "$PROFIL/User" "$PROFIL/extensions"; printf \'%s\' \'' + VSCODE_SETTINGS +
                   '\' > "$PROFIL/User/settings.json"; ')
            launch = (mk + qexe + ' --remote-debugging-port=9229 --user-data-dir="$PROFIL" '
                      '--extensions-dir="$PROFIL/extensions" --new-window >/dev/null 2>&1 & echo "PID=$! PROFIL=$PROFIL"')
        else:
            launch = (mk + qexe + ' --remote-debugging-port=9229 --user-data-dir="$PROFIL" >/dev/null 2>&1 & '
                      'echo "PID=$! PROFIL=$PROFIL"')
        cmds = [instance,
                {'etape': 'Lancer sur un profil temporaire avec le port de débogage (noter PID et PROFIL affichés)'
                          + (' ; mises à jour et télémétrie bloquées dans le profil' if vsc else ''),
                 'commande': launch},
                {'etape': 'Vérifier le port et lister les cibles (fenêtres, vues)',
                 'commande': cdp_py + ' --port 9229 --wait-port 20 list'},
                {'etape': 'Notre processus vit-il ? Une mise à jour Squirrel tourne-t-elle ?',
                 'commande': 'ps -p <PID> -o pid=,comm= ; pgrep -lf ShipIt'},
                {'etape': 'Premier relevé (kit en mode raw)',
                 'commande': cdp_py + ' --port 9229 eval --target "' + ('workbench' if vsc else '<morceau d\'URL ou de titre (voir list)>')
                             + '" --file ' + q(os.path.join(OUTILS, 'capture-kit.js'))
                             + ' --expr "__config({raw:true}); __info()" --out "<dossier de capture>/info.json"'},
                {'etape': 'Fermer : notre PID (SIGTERM), puis, dans un second appel, les processus restants de NOTRE profil',
                 'commande': 'kill <PID>'},
                {'etape': 'Processus restants du profil (helpers) : kill <pid> pour chacun, jamais ShipIt ni kill -9 sur un arbre',
                 'commande': 'ps -axo pid=,command= | grep -F -- "--user-data-dir=<PROFIL noté>" | grep -v -e grep -e ShipIt'},
                {'etape': 'Supprimer le profil (seulement un dossier cu-* du dossier temporaire)',
                 'commande': 'case "<PROFIL noté>" in "${TMPDIR%/}"/cu-*|"/private${TMPDIR%/}"/cu-*|/tmp/cu-*) rm -rf "<PROFIL noté>" ;; '
                             '*) echo "profil refusé" ;; esac'}]
        rem = [no_open,
               'Le profil temporaire donne une appli « neuve » : non connectée, sans les données de l\'utilisateur. '
               'S\'il veut capturer son état connecté, il se connecte lui-même dans cette instance.',
               'Si l\'appli ignore --user-data-dir et qu\'une instance est déjà ouverte, les arguments vont à cette '
               'instance et le port ne s\'ouvre pas : demander à l\'utilisateur de fermer la sienne.',
               'Si aucun port ne répond, l\'appli filtre ses arguments : repli sur la voie images (fidélité réduite).',
               menus, 'Mode raw du kit indispensable avec cdp_eval.py (__config({raw:true})).']
        if fw == 'cef':
            rem.insert(0, 'CEF : --remote-debugging-port ne marche que si l\'appli transmet ses arguments à CEF, et '
                          '--user-data-dir peut être ignoré (l\'appli ouvrirait alors la session de l\'utilisateur) : '
                          'vérifier avec list ; sinon voie images.')
        if vsc:
            rem.insert(0, 'VS Code et dérivés : la page « Welcome » est une couche modale : la capturer, puis la fermer par '
                          'sa croix, jamais par un bouton de connexion. Dossier d\'extensions vide plutôt que '
                          '--disable-extensions (qui ajoute une notification absente de l\'appli normale).')
        if upd:
            rem.append('Mises à jour : ' + ' | '.join(upd))
        return {'skill': 'capture-bureau', 'voie': 'cdp', 'fidelite': 'haute (interface web inspectable)',
                'methode': 'CDP (Chrome DevTools Protocol) : lancer le binaire avec un port de débogage sur un profil '
                           'temporaire, puis traiter l\'appli comme une page web (cdp_eval.py, partie A).',
                'commandes': cmds, 'remarques': rem}
    if fw in ('chromium-browser', 'gecko', 'webkit-browser') and not (fw == 'gecko' and 'firefox' not in app.lower()):
        return {'skill': 'capture-web', 'voie': 'capture-web', 'fidelite': '-',
                'methode': 'C\'est un navigateur : demander quel site copier, puis skill capture-web (Chrome headless sur '
                           'profil temporaire, ou Claude in Chrome pour une appli connectée).',
                'commandes': [{'etape': 'Chrome headless sur profil temporaire (port et profil à noter)',
                               'commande': 'python3 ' + q(os.path.join(OUTILS, 'headless.py')) + ' lancer'}],
                'remarques': ['Jamais « open -a » ni un binaire de navigateur sans --headless=new ET --user-data-dir '
                              'temporaire : il s\'ouvrirait dans la session de l\'utilisateur.']}
    if fw == 'ios':
        return {'skill': 'copier-une-appli', 'voie': 'hors-cible', 'fidelite': '-',
                'methode': 'Appli iPhone/iPad installée sur le Mac : non prise en charge. Proposer sa version web, ou une '
                           'recréation d\'après des captures fournies par l\'utilisateur (fidélité réduite).',
                'commandes': [], 'remarques': []}
    # Voie images : natif Apple, Tauri (WKWebView), Qt, Java, Flutter, inconnu
    cocoa = fw in ('appkit', 'swiftui', 'catalyst')
    cmds = [instance,
            {'etape': 'Lancer (noter le PID affiché)' + (' ; -ApplePersistenceIgnoreState YES évite de rouvrir les '
                      'fenêtres et documents de la session précédente (ce lancement seulement)' if cocoa else ''),
             'commande': qexe + (' -ApplePersistenceIgnoreState YES' if cocoa else '') + ' >/dev/null 2>&1 & echo "PID=$!"'},
            {'etape': 'Notre processus vit-il ?', 'commande': 'ps -p <PID> -o pid=,comm='},
            {'etape': 'Images : computer-use (app_screenshot) sur cette appli, ou capture de la fenêtre de CE PID '
                      '(id de fenêtre : app_list_windows, ou capture-bureau/references/natif.md §9)',
             'commande': 'screencapture -x -o -l <id de fenêtre> "<dossier de capture>/ecran.png"'},
            {'etape': 'Fermer notre instance seulement', 'commande': 'kill <PID>'}]
    rem = ['Fidélité réduite à annoncer : ni DOM ni arbre UI Automation ; mesures d\'après images (×2 sur écran '
           'Retina), aucune mesure garantie.',
           'Pas de profil temporaire pour une appli native : elle ouvre les données de l\'utilisateur. Une seule '
           'instance (si la sienne est ouverte, lui demander de la fermer) ; ne capturer que des écrans sans données '
           'personnelles, ou les masquer.',
           no_open, menus, perms]
    meth = 'Captures d\'écran seulement (computer-use ou screencapture -l), fidélité réduite.'
    if fw == 'tauri':
        rem.insert(0, 'Tauri sur macOS : WKWebView, pas de port de débogage (CDP). L\'Inspecteur web de Safari ne marche '
                      'que si l\'appli est construite « inspectable » : ne pas chercher à le forcer.')
    elif fw == 'qt' and any('WebEngine' in x for x in misc.get('qt', [])):
        rem.insert(0, 'Vues Qt WebEngine : QTWEBENGINE_REMOTE_DEBUGGING=9223 dans l\'environnement du lancement '
                      '(QTWEBENGINE_REMOTE_DEBUGGING=9223 ' + qexe + ' …), puis cdp_eval.py --port 9223 list ; le '
                      'reste de la fenêtre en images.')
    elif fw == 'catalyst':
        rem.insert(0, 'Mac Catalyst : contrôles UIKit (aspect iPad), à reproduire tels qu\'à l\'écran.')
    elif fw == 'inconnu':
        rem.insert(0, 'Type non déterminé : relancer avec --pid pendant que l\'appli est ouverte (bibliothèques '
                      'chargées), sinon voie images.')
    if upd:
        rem.append('Mises à jour : ' + ' | '.join(upd))
    return {'skill': 'capture-bureau', 'voie': 'images', 'fidelite': 'réduite', 'methode': meth,
            'commandes': cmds, 'remarques': rem}


# --------------------------------------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------------------------------------
class FrHelp(argparse.HelpFormatter):
    def add_usage(self, usage, actions, groups, prefix=None):
        return super().add_usage(usage, actions, groups, prefix or 'utilisation : ')


FR = [(r'one of the arguments (.+) is required', r'une des options \1 est obligatoire'),
      (r'argument (.+?): not allowed with argument (.+)', r'option \1 incompatible avec \2'),
      (r'unrecognized arguments: (.+)', r'arguments inconnus : \1'),
      (r'argument (.+?): expected one argument', r'option \1 : valeur attendue'),
      (r'argument (.+?): invalid (\w+) value: (.+)', r'option \1 : valeur invalide \3')]


class Parser(argparse.ArgumentParser):
    def error(self, message):
        for a, b in FR:
            message = re.sub(a, b, message)
        emit({'ok': False, 'erreur': 'arguments : ' + message,
              'pistes': ['python3 detect_app_mac.py --help']}, None, False)
        sys.exit(2)


def build_parser():
    p = Parser(prog='detect_app_mac.py', add_help=False, allow_abbrev=False, formatter_class=FrHelp,
               description='Reconnaissance d\'une appli macOS (.app), en lecture seule : framework, indices, '
                           'dossiers de données (existence), stratégie de capture. Plugin copieur-universel.',
               epilog='Codes de sortie : 0 framework reconnu, 1 inconnu, 2 erreur d\'usage. '
                      'Exemple : python3 detect_app_mac.py --app "/Applications/Visual Studio Code.app" '
                      '--out detect.json')
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--app', metavar='CHEMIN_OU_NOM', help='dossier <Appli>.app (ou un chemin à l\'intérieur), ou nom '
                                                          'cherché dans /Applications, /System/Applications, ~/Applications, ~/Desktop, le PATH, '
                                                          'puis Spotlight')
    g.add_argument('--pid', metavar='PID', help='PID d\'une appli ouverte (ajoute ses bibliothèques chargées)')
    p.add_argument('--out', metavar='FICHIER', help='écrire aussi le JSON dans ce fichier (UTF-8)')
    p.add_argument('--compact', action='store_true', help='JSON sur une seule ligne')
    p.add_argument('--max-mo', type=int, default=400, metavar='N',
                   help='taille maximale du binaire parcouru pour les chaînes Tauri (défaut 400 Mo)')
    p.add_argument('-h', '--help', action='help', help='afficher cette aide et quitter')
    p.add_argument('--version', action='version', version='detect_app_mac.py ' + VERSION,
                   help='afficher la version et quitter')
    return p


def emit(obj, out, compact):
    txt = json.dumps(obj, ensure_ascii=False, indent=None if compact else 2)
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    print(txt)
    if out:
        d = os.path.dirname(os.path.abspath(out))
        os.makedirs(d, exist_ok=True)
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(txt + '\n')


def main(argv=None):
    a = build_parser().parse_args(argv)
    warns = []
    try:
        if sys.platform != 'darwin':
            warns.append('outil prévu pour macOS (sous Windows : detect_app.ps1)')
        if a.pid is not None:
            app, comm = resolve_pid(a.pid.strip(), warns.append)
            res = analyse(app, a.max_mo << 20, a.pid.strip(), comm)
        else:
            app = resolve_app(a.app, warns.append)
            res = analyse(app, a.max_mo << 20)
    except Usage as e:
        emit({'ok': False, 'erreur': str(e), 'pistes': e.pistes, 'avertissements': warns}, a.out, a.compact)
        return 2
    res['avertissements'] = warns + res.get('avertissements', [])
    emit(res, a.out, a.compact)
    return 1 if res['framework'] == 'inconnu' else 0


if __name__ == '__main__':
    sys.exit(main())
