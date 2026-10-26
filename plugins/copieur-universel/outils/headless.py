#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
headless.py — lance ou ferme un Chrome/Edge headless sur un profil TEMPORAIRE, en Python STANDARD (aucune
dépendance), sous macOS, Linux et Windows. Plugin copieur-universel : capture de sites publics, mesures du
clone, reconnaissance. Portage de headless.ps1 (mêmes actions, même sortie JSON, mêmes codes de sortie).

  python3 headless.py lancer [--navigateur chrome|edge] [--port N] [--viewport 1536x791] [--echelle 2] [--langue fr]
  python3 headless.py etat   --profil "<profil noté>"
  python3 headless.py fermer --profil "<profil noté>" [--port N] [--attente 60]
  python3 headless.py trouver [--navigateur chrome|edge]
  (Sous Windows, `py` remplace `python3` ; headless.ps1 reste disponible, mêmes actions.)

lancer : crée un profil neuf <dossier temporaire>/cu-<chrome|edge>-xxxxxxxx, choisit un port libre (ou --port),
lance le navigateur en --headless=new avec ce profil, attend que le port de débogage réponde, puis règle le
viewport avec cdp_eval.py « size » (--viewport, 1536x791 par défaut). Sortie : une ligne JSON
{ok, navigateur, exe, port, pid, profil, viewport, message[, avertissement]} — noter port et profil EN CLAIR
pour la fermeture (chaque appel Bash est un nouveau shell). Le profil temporaire est indispensable : sans lui,
le navigateur déjà ouvert de l'utilisateur (ses onglets, ses sessions) recevrait la commande. Avant « size »,
le port doit être tenu par CE navigateur (lsof, macOS/Linux) : jamais celui d'un autre. Sous macOS,
--use-mock-keychain en plus : le trousseau de l'utilisateur n'est jamais lu.

fermer : quitte proprement le navigateur (Browser.close par cdp_eval.py si --port est donné), arrête en boucle
(SIGTERM) les processus dont la ligne de commande contient CE dossier de profil (jamais les autres : le
navigateur de l'utilisateur n'a pas ce dossier ; SIGKILL seulement en dernier recours, sur ces mêmes PID), puis
supprime le profil (jusqu'à --attente s). Sortie JSON {ok, restants, profilSupprime, profil, message, notes,
secondes}.

etat : processus encore vivants pour ce profil. trouver : affiche le chemin de l'exécutable du navigateur.

Recherche du navigateur : variable CU_CHROME (ou CU_EDGE : exécutable ou dossier .app), puis emplacements
habituels — macOS : /Applications, ~/Applications, ~/Desktop, puis Spotlight (mdfind, identifiant du paquet) ;
Linux : google-chrome, google-chrome-stable, chromium, chromium-browser, microsoft-edge dans le PATH ;
Windows : Program Files et AppData\\Local.

Garde-fou : --profil doit être un dossier « cu-* » placé directement dans le dossier temporaire du système
(chemin réel, liens résolus) ; rien d'autre n'est arrêté ni supprimé.
Codes de sortie : 0 fait, 1 erreur ou nettoyage incomplet (le message dit quoi faire).
"""
import argparse
import base64
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

VERSION = '1.0'
ICI = os.path.dirname(os.path.abspath(__file__))
CDP = os.path.join(ICI, 'cdp_eval.py')
WINDOWS = os.name == 'nt'
MACOS = sys.platform == 'darwin'

EXEMPLES = """exemples :
  python3 headless.py lancer
  python3 headless.py lancer --port 9555 --viewport 1204x804 --echelle 2 --langue fr
  python3 headless.py etat --profil "/private/var/folders/xx/yyyy/T/cu-chrome-1a2b3c4d"
  python3 headless.py fermer --profil "/private/var/folders/xx/yyyy/T/cu-chrome-1a2b3c4d" --port 9555
  python3 headless.py trouver --navigateur edge
  CU_CHROME="/chemin/vers/Google Chrome.app" python3 headless.py lancer
Sous Windows, `py` remplace `python3` ; headless.ps1 reste disponible (mêmes actions).
Codes de sortie : 0 fait, 1 erreur ou nettoyage incomplet."""


# --------------------------------------------------------------------------------------------------------
# Sortie : une ligne JSON en UTF-8 (même quand la sortie est redirigée).
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


def out_json(o):
    print(json.dumps(o, ensure_ascii=False, separators=(',', ':')), flush=True)


def fail(msg):
    out_json({'ok': False, 'erreur': msg})
    sys.exit(1)


class Erreur(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):  # même contrat que les autres erreurs : JSON et code 1 (pas 2)
        fail('arguments : %s (voir --help)' % message)


# --------------------------------------------------------------------------------------------------------
# Navigateur
# --------------------------------------------------------------------------------------------------------
BUNDLES = {'chrome': ('Google Chrome.app', 'com.google.Chrome', 'Google Chrome'),
           'edge': ('Microsoft Edge.app', 'com.microsoft.edgemac', 'Microsoft Edge')}


def _exe_du_bundle(app):
    """Exécutable d'un paquet .app (Contents/MacOS/<CFBundleExecutable>), ou None."""
    nom = None
    try:
        import plistlib
        with open(os.path.join(app, 'Contents', 'Info.plist'), 'rb') as f:
            nom = plistlib.load(f).get('CFBundleExecutable')
    except Exception:
        pass
    noms = [nom] if nom else []
    noms += [n for n in (BUNDLES['chrome'][2], BUNDLES['edge'][2]) if n not in noms]
    for n in noms:
        p = os.path.join(app, 'Contents', 'MacOS', n)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def _executable(p):
    """Chemin donné (exécutable ou dossier .app) -> exécutable, ou None."""
    if not p:
        return None
    p = os.path.expanduser(p)
    if os.path.isdir(p) and p.rstrip('/').endswith('.app'):
        return _exe_du_bundle(p)
    if os.path.isfile(p) and (WINDOWS or os.access(p, os.X_OK)):
        return p
    return None


def trouver_exe(nav):
    var = 'CU_EDGE' if nav == 'edge' else 'CU_CHROME'
    v = os.environ.get(var, '').strip().strip('"')
    if v:
        e = _executable(v)
        if not e:
            raise Erreur('%s vaut « %s », qui n\'est ni un exécutable ni un dossier .app : corrigez ou retirez '
                         'cette variable.' % (var, v))
        return e
    if MACOS:
        app, bundle_id, _ = BUNDLES[nav]
        maison = os.path.expanduser('~')
        for d in ('/Applications', os.path.join(maison, 'Applications'), os.path.join(maison, 'Desktop')):
            e = _exe_du_bundle(os.path.join(d, app))
            if e:
                return e
        try:  # Spotlight : appli rangée ailleurs (lecture seule, aucun lancement)
            r = subprocess.run(['mdfind', "kMDItemCFBundleIdentifier == '%s'" % bundle_id],
                               capture_output=True, text=True, timeout=15)
            for ligne in r.stdout.splitlines():
                ligne = ligne.strip()
                if ligne.endswith('.app') and '/.Trash/' not in ligne:
                    e = _exe_du_bundle(ligne)
                    if e:
                        return e
        except (OSError, subprocess.SubprocessError):
            pass
        return None
    if WINDOWS:
        pf, pf86, local = (os.environ.get('ProgramFiles', ''), os.environ.get('ProgramFiles(x86)', ''),
                           os.environ.get('LOCALAPPDATA', ''))
        if nav == 'edge':
            c = [(pf86, r'Microsoft\Edge\Application\msedge.exe'), (pf, r'Microsoft\Edge\Application\msedge.exe'),
                 (local, r'Microsoft\Edge\Application\msedge.exe')]
        else:
            c = [(pf, r'Google\Chrome\Application\chrome.exe'), (pf86, r'Google\Chrome\Application\chrome.exe'),
                 (local, r'Google\Chrome\Application\chrome.exe')]
        for base, rel in c:
            if base and os.path.isfile(os.path.join(base, rel)):
                return os.path.join(base, rel)
        return None
    noms = (['microsoft-edge', 'microsoft-edge-stable'] if nav == 'edge'
            else ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
    for n in noms:
        e = shutil.which(n)
        if e:
            return e
    return None


def introuvable(nav):
    autre = 'chrome' if nav == 'edge' else 'edge'
    var = 'CU_EDGE' if nav == 'edge' else 'CU_CHROME'
    return ('%s introuvable aux emplacements habituels : indiquez son chemin (exécutable ou dossier .app) dans '
            'la variable %s, ou essayez --navigateur %s' % (nav, var, autre))


# --------------------------------------------------------------------------------------------------------
# Profil, port, processus
# --------------------------------------------------------------------------------------------------------
def dossier_temp():
    return os.path.realpath(tempfile.gettempdir())


def _norm(p):
    return os.path.normcase(os.path.normpath(p))


def verifier_profil(p):
    temp = dossier_temp()
    if not p:
        fail('précisez --profil <dossier noté au lancement> (un dossier cu-* de %s).' % temp)
    full = os.path.realpath(os.path.expanduser(p))
    parent, nom = os.path.split(full.rstrip('/\\'))
    if _norm(parent) != _norm(temp) or not re.fullmatch(r'cu-[A-Za-z0-9_.-]+', nom):
        fail('profil refusé : seul un dossier « cu-* » placé directement dans %s peut être fermé et supprimé '
             'par cet outil.' % temp)
    return os.path.join(parent, nom)


def port_libre():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]
    finally:
        s.close()


def port_occupe(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        return s.connect_ex(('127.0.0.1', port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def _contient_profil(cmd, chemins):
    """Vrai si la ligne de commande passe l'un de ces chemins comme VALEUR d'option (--user-data-dir=<profil>,
    --database=<profil>/Crashpad…). Un shell, un grep ou ce script, qui ont le chemin en argument séparé,
    ne sont pas visés."""
    texte = cmd.lower() if WINDOWS else cmd
    for ch in chemins:
        ch = ch.lower() if WINDOWS else ch
        i = texte.find(ch)
        while i >= 0:
            avant = texte[max(0, i - 2):i]
            apres = texte[i + len(ch):i + len(ch) + 1]
            if (avant.endswith('=') or avant in ('="', "='")) and apres in ('', '/', '\\', '"', "'", ' ', '\t'):
                return True
            i = texte.find(ch, i + 1)
    return False


def _processus():
    """[(pid, ppid, nom, ligne de commande)] de tous les processus visibles."""
    res = []
    if WINDOWS:  # non testé : Get-CimInstance, comme headless.ps1 (commande encodée : aucun souci de guillemets)
        ps = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "
              "\"Name='chrome.exe' OR Name='msedge.exe'\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine "
              "| ConvertTo-Json -Compress")
        enc = base64.b64encode(ps.encode('utf-16-le')).decode('ascii')
        r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', enc],
                           capture_output=True, timeout=60)
        try:
            data = json.loads(r.stdout.decode('utf-8', 'replace') or '[]')
        except ValueError:
            raise OSError('liste des processus illisible (powershell Get-CimInstance)')
        for d in data if isinstance(data, list) else [data]:
            res.append((int(d.get('ProcessId') or 0), int(d.get('ParentProcessId') or 0), d.get('Name') or '',
                        d.get('CommandLine') or ''))
        return res
    r = subprocess.run(['ps', '-A', '-ww', '-o', 'pid=,ppid=,command='], capture_output=True, timeout=30)
    if r.returncode != 0:
        raise OSError('ps a échoué (%s)' % r.stderr.decode('utf-8', 'replace').strip()[:200])
    for ligne in r.stdout.decode('utf-8', 'replace').splitlines():
        parts = ligne.strip().split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        cmd = parts[2]
        exe = cmd.split(' --', 1)[0]  # « …/Google Chrome Helper (Renderer) --type=renderer … »
        res.append((int(parts[0]), int(parts[1]), os.path.basename(exe) or exe, cmd))
    return res


def miens(full, autres=()):
    """Processus vivants dont la ligne de commande contient CE profil (ni ce script ni ses parents)."""
    tous = _processus()
    parents = {pid: ppid for pid, ppid, _, _ in tous}
    exclus, p = set(), os.getpid()
    while p and p not in exclus:
        exclus.add(p)
        p = parents.get(p, 0)
    chemins = [full] + [c for c in autres if c and c != full]
    res = []
    for pid, _, nom, cmd in tous:
        if pid in exclus or not cmd:
            continue
        if WINDOWS and nom.lower() not in ('chrome.exe', 'msedge.exe'):
            continue
        if _contient_profil(cmd, chemins):
            res.append((pid, nom))
    return res


def arreter(pid, fort=False):
    try:
        os.kill(pid, signal.SIGKILL if (fort and not WINDOWS) else signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass  # déjà terminé, ou pas à nous


def supprimer_profil(full):
    if not os.path.lexists(full):
        return True
    cible = ('\\\\?\\' + full) if WINDOWS and not full.startswith('\\\\') else full  # chemins longs
    try:
        if os.path.islink(full):
            os.unlink(full)
        else:
            shutil.rmtree(cible)
    except OSError:
        pass
    return not os.path.lexists(full)


def run_cdp(args):
    try:
        r = subprocess.run([sys.executable, '-I', CDP] + args, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return 127, '', 'cdp_eval.py non lancé (%s)' % e
    dec = lambda b: (b or b'').decode('utf-8', 'replace').strip()
    return r.returncode, dec(r.stdout), dec(r.stderr)


def _ecouteurs(port):
    """PID qui écoutent sur ce port (lsof, macOS/Linux), ou None si on ne peut pas le savoir."""
    lsof = shutil.which('lsof') or ('/usr/sbin/lsof' if os.path.exists('/usr/sbin/lsof') else None)
    if WINDOWS or not lsof:
        return None
    try:
        r = subprocess.run([lsof, '-nP', '-t', '-iTCP:%d' % port, '-sTCP:LISTEN'], capture_output=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    pids = {int(x) for x in r.stdout.split() if x.isdigit()}
    return pids if r.returncode in (0, 1) and pids else None


def _tient(ecoute, prof):
    """Vrai si l'un des PID à l'écoute est un processus de ce profil (ou si on ne peut pas le savoir)."""
    try:
        return any(pid in ecoute for pid, _ in miens(prof))
    except (OSError, subprocess.SubprocessError):
        return True


# --------------------------------------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------------------------------------
def lancer(a):
    try:
        exe = trouver_exe(a.navigateur)
    except Erreur as e:
        fail(str(e))
    if not exe:
        fail(introuvable(a.navigateur))
    port = a.port
    if port == 0:
        port = port_libre()
    elif port < 1024 or port > 65535:
        fail('port %s refusé : choisir entre 1024 et 65535 (habitude du plugin : 9333), ou --port 0 pour un port '
             'libre.' % port)
    elif port_occupe(port):
        fail('le port %s est déjà occupé (autre navigateur, autre capture ?) : prenez-en un autre, ou --port 0 pour '
             'un port libre.' % port)
    m = re.fullmatch(r'(\d+)x(\d+)', a.viewport or '')
    if not m:
        fail('--viewport attendu sous la forme LARGEURxHAUTEUR, ex. 1536x791')
    vw, vh = int(m.group(1)), int(m.group(2))
    court = 'edge' if a.navigateur == 'edge' else 'chrome'
    prof = os.path.join(dossier_temp(), 'cu-%s-%s' % (court, uuid.uuid4().hex[:8]))
    try:
        os.makedirs(prof, mode=0o700)
    except OSError as e:
        fail('profil temporaire impossible à créer : %s (%s)' % (prof, e))
    # Fenêtre un peu plus grande que le viewport (la fenêtre headless retire une marge), corrigée par « size ».
    args = [exe, '--headless=new', '--remote-debugging-port=%d' % port, '--user-data-dir=%s' % prof,
            '--window-size=%d,%d' % (max(520, vw + 18), vh + 96),
            '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen']
    if MACOS:
        args.append('--use-mock-keychain')  # jamais le trousseau de l'utilisateur (ni invite « Chrome Safe Storage »)
    if a.echelle and a.echelle > 0:
        args.append('--force-device-scale-factor=%s' % ('%g' % a.echelle))
    if a.langue:
        args.append('--lang=%s' % a.langue)
    args.append('about:blank')
    opts = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    if WINDOWS:
        opts['creationflags'] = (getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x200)
                                 | getattr(subprocess, 'DETACHED_PROCESS', 0x8))
    else:
        opts['start_new_session'] = True  # détaché du shell de l'outil Bash
    try:
        p = subprocess.Popen(args, **opts)
    except OSError as e:
        supprimer_profil(prof)
        fail('lancement impossible de %s (%s)' % (exe, e))
    # Le port répond-il, et pour CE navigateur ? (port pris entre-temps, lancements en parallèle) : vérifié AVANT
    # « size », pour ne jamais redimensionner le navigateur d'un autre.
    fin = time.time() + 20
    while time.time() < fin and p.poll() is None and not port_occupe(port):
        time.sleep(0.25)
    ecoute = _ecouteurs(port) if p.poll() is None else None
    if p.poll() is not None:
        rc, sortie, texte = 1, '', 'le navigateur s\'est arrêté au lancement (code %s)' % p.returncode
    elif ecoute and p.pid not in ecoute and not _tient(ecoute, prof):
        rc, sortie, texte = 1, '', ('le port %s répond, mais pas pour ce navigateur (il est tenu par le PID %s) : '
                                    'relancer avec un autre port' % (port, ', '.join(str(x) for x in sorted(ecoute))))
    else:
        rc, sortie, err = run_cdp(['--port', str(port), '--wait-port', '10', 'size', '--viewport', a.viewport])
        texte = '\n'.join(t for t in (sortie, err) if t)
    mm = re.search(r'viewport (\d+x\d+)', sortie)  # « OK size : viewport 1536x791 (DPR 1)… » sur stdout
    obtenu = mm.group(1) if mm else ''
    avert = []
    # ok = le navigateur répond ; un viewport différent de celui demandé (petit écran < 500 px, écart d'1 px à
    # l'échelle 1,25) n'est qu'un avertissement : --viewport sur nav/eval/shot donne alors la taille exacte.
    o = {'ok': bool(obtenu), 'navigateur': court, 'exe': exe, 'port': port, 'pid': p.pid, 'profil': prof,
         'viewport': obtenu,
         'message': ('prêt : cdp_eval.py --port %s list' % port) if (rc == 0 and obtenu) else texte}
    if obtenu and obtenu != a.viewport:
        avert.insert(0, 'viewport %s au lieu de %s : ajouter --viewport %s à nav, eval, shot et hover'
                     % (obtenu, a.viewport, a.viewport))
    if avert:
        o['avertissement'] = ' ; '.join(avert)
    if not obtenu:
        o['message'] += ' — nettoyer : headless.py fermer --profil "%s"' % prof
    out_json(o)
    return 0 if obtenu else 1


def etat(a):
    full = verifier_profil(a.profil)
    try:
        m = miens(full, [os.path.abspath(os.path.expanduser(a.profil))])
    except (OSError, subprocess.SubprocessError) as e:
        fail('liste des processus impossible (%s)' % e)
    out_json({'ok': True, 'profil': full, 'existe': os.path.isdir(full),
              'processus': [{'pid': pid, 'nom': nom} for pid, nom in m]})
    return 0


def fermer(a):
    full = verifier_profil(a.profil)
    donne = os.path.abspath(os.path.expanduser(a.profil))
    notes = []
    if a.port and a.port > 0:
        ecoute = _ecouteurs(a.port)  # mauvais port noté : ne jamais fermer le navigateur d'un autre
        if ecoute and not _tient(ecoute, full):
            notes.append('Browser.close non envoyé : le port %s est tenu par le PID %s, pas par ce profil'
                         % (a.port, ', '.join(str(x) for x in sorted(ecoute))))
        else:
            rc, sortie, err = run_cdp(['--port', str(a.port), 'close', '--browser'])
            premiere = ((sortie + '\n' + err).strip().split('\n') or [''])[0]
            notes.append('Browser.close : ' + ('ok' if rc == 0 else 'sans effet (%s)' % premiere))
    t0 = time.time()
    m = []
    try:
        while time.time() - t0 < 20:
            m = miens(full, [donne])
            if not m:
                break
            fort = time.time() - t0 > 14  # dernier recours, sur ces mêmes PID (relus avec le profil)
            for pid, _ in m:
                arreter(pid, fort)
            if fort and 'SIGKILL' not in ' '.join(notes):
                notes.append('SIGKILL en dernier recours : %s' % ', '.join(str(pid) for pid, _ in m))
            time.sleep(0.7)
        rest = len(miens(full, [donne]))
    except (OSError, subprocess.SubprocessError) as e:
        fail('liste des processus impossible (%s) : rien n\'a été supprimé' % e)
    suppr = False
    if rest == 0:
        while True:
            if supprimer_profil(full):
                suppr = True
                break
            if time.time() - t0 >= a.attente:
                break
            time.sleep(2)
    if rest > 0:
        msg = '%s processus encore vivants pour ce profil : relancer fermer dans quelques secondes' % rest
    elif not suppr:
        msg = ('processus arrêtés, mais le profil est encore verrouillé : relancer fermer plus tard, ou le signaler '
               '(chemin : %s)' % full)
    else:
        msg = 'navigateur arrêté, profil supprimé'
    out_json({'ok': rest == 0 and suppr, 'restants': rest, 'profilSupprime': suppr, 'profil': full, 'message': msg,
              'notes': notes, 'secondes': round(time.time() - t0, 1)})
    return 0 if (rest == 0 and suppr) else 1


def trouver(a):
    try:
        exe = trouver_exe(a.navigateur)
    except Erreur as e:
        exe, msg = None, str(e)
    else:
        msg = introuvable(a.navigateur)
    if not exe:
        print('erreur : ' + msg, file=sys.stderr, flush=True)
        return 1
    print(exe, flush=True)
    return 0


def build_parser():
    p = Parser(prog='headless.py', allow_abbrev=False, formatter_class=argparse.RawDescriptionHelpFormatter,
               description='Chrome/Edge headless sur un profil temporaire (lancer, etat, fermer, trouver). '
                           'Plugin copieur-universel.', epilog=EXEMPLES)
    p.add_argument('action', nargs='?', default='lancer', choices=['lancer', 'fermer', 'etat', 'trouver'],
                   help='lancer (défaut), fermer, etat ou trouver')
    p.add_argument('--navigateur', choices=['chrome', 'edge'], default='chrome', help='défaut : chrome')
    p.add_argument('--port', type=int, default=0,
                   help='lancer : port de débogage (défaut 0 = port libre) ; fermer : Browser.close sur ce port')
    p.add_argument('--profil', help='etat, fermer : dossier de profil noté au lancement (cu-* du dossier temporaire)')
    p.add_argument('--viewport', default='1536x791', help='LARGEURxHAUTEUR (défaut 1536x791)')
    p.add_argument('--echelle', type=float, default=0, help='facteur de zoom (ex. 2 pour un écran Retina, 1.25)')
    p.add_argument('--langue', default='', help='langue du navigateur (ex. fr)')
    p.add_argument('--attente', type=float, default=60, help='fermer : attente max de suppression du profil, en s')
    p.add_argument('--version', action='version', version='headless.py ' + VERSION)
    return p


def main(argv=None):
    _setup_console()
    a = build_parser().parse_args(argv)
    try:
        return {'lancer': lancer, 'fermer': fermer, 'etat': etat, 'trouver': trouver}[a.action](a)
    except KeyboardInterrupt:
        print('interrompu', file=sys.stderr)
        return 130


if __name__ == '__main__':
    sys.exit(main())
