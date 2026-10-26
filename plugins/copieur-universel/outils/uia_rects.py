# -*- coding: utf-8 -*-
"""uia_rects.py - rectangles d'un releve uia_dump.ps1 convertis en px CSS, pour les comparer au clone.
Outil du plugin copieur-universel (skill verifier-copie, references/methode.md section 8).

  python3 uia_rects.py uia-principale.json [profondeur=4] [--echelle 1.25] [--json]   (Windows : py)

Chaque ligne : type, nom, x, y, largeur, hauteur en px CSS (px physiques / echelle du releve), relatifs au
cadre visible de la fenetre, comme getBoundingClientRect() dans la fenetre du clone. A comparer a
__mesures('body', 3) de verif.js.
Attention (WinUI 3 / Windows 11) : le Name UIA est le nom ACCESSIBLE (« Ligne 1, colonne 1 ») et non
toujours le texte affiche (« Ln 1, Col 1 ») ; le rectangle d'un TextBlock ou d'un menu deroulant peut differer
de l'encre visible : mesurer ces elements sur l'image (png_diff.py encre)."""
import json
import sys


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass
    args = [a for a in sys.argv[1:]]
    if args and args[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if not args:
        print(__doc__)
        return 2
    as_json = '--json' in args
    echelle = None
    if '--echelle' in args:
        i = args.index('--echelle')
        try:
            echelle = float(args[i + 1].replace(',', '.'))
        except (IndexError, ValueError):
            print('erreur : --echelle attend un nombre (ex. 1.25)', file=sys.stderr)
            return 2
        del args[i:i + 2]
    args = [a for a in args if a != '--json']
    try:
        with open(args[0], encoding='utf-8-sig') as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        print('erreur : lecture impossible de %s (%s)' % (args[0], e), file=sys.stderr)
        return 2
    prof = int(args[1]) if len(args) > 1 and args[1].isdigit() else 4
    k = echelle or (d.get('dpi') or {}).get('echelle') or (d.get('fenetre') or {}).get('echelle') or 1
    out = []

    def walk(n, p=0):
        r = n.get('BoundingRectangle')
        if r and p <= prof:
            out.append({'profondeur': p, 'type': n.get('ControlType'), 'nom': (n.get('Name') or '')[:60],
                        'x': round(r['x'] / k, 1), 'y': round(r['y'] / k, 1),
                        'l': round(r['w'] / k, 1), 'h': round(r['h'] / k, 1)})
        for c in n.get('Children') or []:
            walk(c, p + 1)

    if 'arbre' not in d:
        print('erreur : pas de cle « arbre » : est-ce bien une sortie de uia_dump.ps1 ?', file=sys.stderr)
        return 2
    walk(d['arbre'])
    for w in d.get('autresFenetres') or []:
        if w.get('arbre'):
            walk(w['arbre'], 1)
    if as_json:
        print(json.dumps({'echelle': k, 'rectangles': out}, ensure_ascii=False, indent=1))
        return 0
    print('echelle %s : px CSS = px physiques / %s' % (k, k))
    for o in out:
        print('%s%s « %s » x=%g y=%g l=%g h=%g' % ('  ' * o['profondeur'], o['type'], o['nom'], o['x'], o['y'], o['l'], o['h']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
