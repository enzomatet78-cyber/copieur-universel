# -*- coding: utf-8 -*-
"""textes.py - comparer les textes d'une capture (dom-*.html) et du clone, caractere par caractere.
Outil du plugin copieur-universel (skill verifier-copie, references/methode.md section 4).
  py textes.py capture dom-page.html > capture-textes.json
  py textes.py diff capture-textes.json clone-textes.json [--masquer-chiffres] [--attributs]
clone-textes.json = resultat de __textes('<selecteur>') (outils/verif.js) lance dans le clone, ecrit tel
quel (la chaine JSON renvoyee par javascript_tool est acceptee).
--attributs : placeholder, aria-label, alt, title, value. Un attribut present des deux cotes mais un nombre
de fois different (aria-label repete sur li, a et badge) est signale a part (« ~ nombre different »), pas
comme absent.
Code de sortie : 0 identique, 1 ecarts, 2 usage."""
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter
from html.parser import HTMLParser

SKIP = {'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'video', 'audio'}
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

    def flush(self):
        t = norm(''.join(self.buf))
        self.buf = []
        if t:
            self.textes.append(t)

    def handle_starttag(self, tag, attrs, closed=False):
        opens = not closed and tag not in VOID
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
        if self.skip:
            if tag in SKIP:
                self.skip -= 1
            return
        if tag not in INLINE:
            self.flush()

    def handle_data(self, data):
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


def load(path):
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    return json.loads(data) if isinstance(data, str) else data


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == 'capture':
        p = Extract()
        with open(args[1], encoding='utf-8-sig') as f:
            p.feed(f.read())
        p.close()
        p.flush()
        print(json.dumps({'source': args[1], 'textes': p.textes, 'attributs': p.attributs}, ensure_ascii=False, indent=0))
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
                k = min(len(a), len(b))
                for x, y in zip(a[:k], b[:k]):
                    n['modifies'] += 1
                    print('~ capture : %s\n  clone   : %s\n  ecart   : %s' % (x, y, chardiff(x, y)))
                a, b = a[k:], b[k:]
            for x in a:
                n['absents'] += 1
                print('- absent du clone : %s' % x)
            for y in b:
                n['enTrop'] += 1
                print('+ en trop dans le clone : %s' % y)
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
              + (' ; %d attribut(s) absent(s) ou en trop' % n['attributs'] if 'attributs' in n else ''))
        return 1 if (n['modifies'] or n['absents'] or n['enTrop'] or n.get('attributs')) else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
