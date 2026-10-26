# -*- coding: utf-8 -*-
"""textes.py - comparer les textes d'une capture (dom-*.html) et du clone, caractere par caractere.
Outil du plugin copieur-universel (skill verifier-copie, references/methode.md section 4).
  python3 textes.py capture dom-page.html > capture-textes.json
  python3 textes.py diff capture-textes.json clone-textes.json [--masquer-chiffres] [--attributs]
  (Windows : py au lieu de python3)
clone-textes.json = resultat de __textes('<selecteur>') (outils/verif.js) lance dans le clone, ecrit tel
quel (la chaine JSON renvoyee par javascript_tool est acceptee).
--attributs : placeholder, aria-label, alt, title, value. Un attribut present des deux cotes mais un nombre
de fois different (aria-label repete sur li, a et badge) est signale a part (« ~ nombre different »), pas
comme absent.
Dans un bloc de textes differents, chaque texte de la capture est apparie au texte du clone le plus proche
(ressemblance > 0,6) ; le reste est « absent » ou « en trop ». Le <title> d'un dump de document complet est
releve a part (« titre ») et compare au titre renvoye par __textes quand les deux existent.
Code de sortie : 0 identique (et --help), 1 ecarts, 2 usage, fichier illisible ou __textes en erreur."""
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter
from html.parser import HTMLParser

SKIP = {'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'video', 'audio', 'title'}
INLINE = {'span', 'b', 'strong', 'i', 'em', 'small', 'code', 'sup', 'sub', 'abbr', 'mark', 'u', 's', 'time',
          'kbd', 'q', 'cite', 'dfn', 'var', 'bdi', 'bdo', 'wbr', 'font'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
WS = re.compile(r'[ \t\n\r\f]+')          # espaces ordinaires seulement : U+00A0 / U+202F sont gardes


def norm(s):
    return WS.sub(' ', s).strip()


class Extract(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.textes, self.attributs, self.buf, self.skip = [], [], [], 0
        self.titre, self.in_title = None, False   # <title> releve a part, comme « titre » de __textes

    def flush(self):
        t = norm(''.join(self.buf))
        self.buf = []
        if t:
            self.textes.append(t)

    def handle_starttag(self, tag, attrs, closed=False):
        opens = not closed and tag not in VOID
        if tag == 'title' and opens and not self.skip and self.titre is None:
            self.in_title, self.titre = True, ''
        if self.skip or tag in SKIP:
            if tag in SKIP and opens:
                self.skip += 1
            return
        if tag == 'br':
            self.buf.append(' ')
            return
        a = dict(attrs)
        for k in ('placeholder', 'aria-label', 'alt', 'title', 'value'):
            if k == 'value' and (tag != 'input' or (a.get('type') or '').lower() in ('hidden', 'password', 'checkbox', 'radio')):
                continue
            v = a.get(k)
            if v and norm(v):
                self.attributs.append(k + '=' + norm(v))
        if tag not in INLINE:
            self.flush()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs, closed=True)

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if self.skip:
            if tag in SKIP:
                self.skip -= 1
            return
        if tag not in INLINE:
            self.flush()

    def handle_data(self, data):
        if self.in_title:
            self.titre += data
        if not self.skip:
            self.buf.append(data)


def cp(c):
    if c.isprintable() and c != ' ' and (ord(c) < 128 or c.isalpha()):
        return c
    return '<U+%04X %s>' % (ord(c), unicodedata.name(c, '?'))


def chardiff(a, b):
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != 'equal':
            out.append('«%s» -> «%s»' % (''.join(cp(c) for c in a[i1:i2]), ''.join(cp(c) for c in b[j1:j2])))
    return ' ; '.join(out)


class Usage(Exception):
    """Fichier illisible ou resultat d'erreur : code 2 (pas 1, reserve aux ecarts)."""


def load(path):
    try:
        with open(path, encoding='utf-8-sig') as f:
            data = json.load(f)
        data = json.loads(data) if isinstance(data, str) else data
    except (OSError, ValueError) as e:
        raise Usage('lecture impossible de %s (%s)' % (path, e))
    if not isinstance(data, dict):
        raise Usage('%s : objet JSON attendu (resultat de textes.py capture ou de __textes)' % path)
    if 'erreur' in data:
        raise Usage('%s : __textes a echoue : %s (selecteur de la zone a corriger)' % (path, data['erreur']))
    if not isinstance(data.get('textes'), list):
        raise Usage('%s : champ « textes » absent (resultat de textes.py capture ou de __textes attendu)' % path)
    return data


def apparier(a, b):
    """Bloc « replace » : chaque texte de la capture va au texte du clone le plus proche (ratio > 0,6), dans
    l'ordre ; -> (paires, absents, enTrop)."""
    libres, paires, absents = list(range(len(b))), [], []
    for x in a:
        best, score = None, 0.6
        for j in libres:
            sm = difflib.SequenceMatcher(None, x, b[j], autojunk=False)
            if sm.real_quick_ratio() <= score or sm.quick_ratio() <= score:
                continue            # bornes rapides : un gros bloc reste rapide
            r = sm.ratio()
            if r > score:
                best, score = j, r
        if best is None:
            absents.append(x)
        else:
            libres.remove(best)
            paires.append((x, b[best]))
    return paires, absents, [b[j] for j in libres]


def main():
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    try:
        return run(sys.argv[1:])
    except Usage as e:
        print('erreur : %s' % e, file=sys.stderr)
        return 2


def run(args):
    if args and args[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if len(args) >= 2 and args[0] == 'capture':
        p = Extract()
        try:
            with open(args[1], encoding='utf-8-sig') as f:
                p.feed(f.read())
        except (OSError, UnicodeDecodeError) as e:
            raise Usage('lecture impossible de %s (%s)' % (args[1], e))
        p.close()
        p.flush()
        out = {'source': args[1], 'textes': p.textes, 'attributs': p.attributs}
        if p.titre is not None:
            out['titre'] = norm(p.titre)
        print(json.dumps(out, ensure_ascii=False, indent=0))
        return 0
    if len(args) >= 3 and args[0] == 'diff':
        A, B = load(args[1]), load(args[2])
        f = (lambda s: re.sub(r'\d', '#', s)) if '--masquer-chiffres' in args else (lambda s: s)
        ta, tb = [f(x) for x in A['textes']], [f(x) for x in B['textes']]
        n = {'identiques': 0, 'modifies': 0, 'absents': 0, 'enTrop': 0}
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
            if op == 'equal':
                n['identiques'] += i2 - i1
                continue
            a, b = ta[i1:i2], tb[j1:j2]
            if op == 'replace':
                paires, a, b = apparier(a, b)
                for x, y in paires:
                    n['modifies'] += 1
                    print('~ capture : %s\n  clone   : %s\n  ecart   : %s' % (x, y, chardiff(x, y)))
            for x in a:
                n['absents'] += 1
                print('- absent du clone : %s' % x)
            for y in b:
                n['enTrop'] += 1
                print('+ en trop dans le clone : %s' % y)
        if A.get('titre') is not None and B.get('titre') is not None:
            xa, xb = f(norm(A['titre'])), f(norm(B['titre']))
            if xa != xb:
                n['titre'] = 1
                print('~ titre : capture «%s» / clone «%s»\n  ecart   : %s' % (xa, xb, chardiff(xa, xb)))
        if '--attributs' in args:
            ca, cb = Counter(A.get('attributs', [])), Counter(B.get('attributs', []))
            n['attributs'] = 0
            for k in sorted(set(ca) | set(cb)):
                if k not in cb:
                    n['attributs'] += 1
                    print('- attribut absent du clone : %s' % k)
                elif k not in ca:
                    n['attributs'] += 1
                    print('+ attribut en trop dans le clone : %s' % k)
                elif ca[k] != cb[k]:  # même texte, répété un autre nombre de fois : à regarder, rarement un défaut
                    print('~ nombre different (capture %d, clone %d) : %s' % (ca[k], cb[k], k))
        print('Bilan : %(identiques)d identiques, %(modifies)d modifies, %(absents)d absents du clone, %(enTrop)d en trop' % n
              + (' ; %d attribut(s) absent(s) ou en trop' % n['attributs'] if 'attributs' in n else '')
              + (' ; titre different' if n.get('titre') else ''))
        return 1 if (n['modifies'] or n['absents'] or n['enTrop'] or n.get('attributs') or n.get('titre')) else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
