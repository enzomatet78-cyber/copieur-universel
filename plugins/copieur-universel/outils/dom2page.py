# -*- coding: utf-8 -*-
"""dom2page.py - prepare le contenu d'une page du clone a partir d'un dump du kit de capture.
Outil du plugin copieur-universel (skill reconstruire-appli, references/conventions.md section 10).

  py dom2page.py dom-initial.html main.html        (sans SORTIE : resultat sur la sortie standard)

- inverse les echappements du kit s'il en reste (mode par defaut de capture-kit.js : « § » -> « ; »,
  « (AMP) » -> « & », « (Q) » -> « ? », puis « (SECT) » -> « § ») ;
- transforme les icones reconnues (<svg icon="lib:nom" .../>) en espaces reserves <svg data-icon="lib:nom">
  hydrates par shell-base.js ; garde le SVG complet des icones sans nom ;
- liste sur la sortie d'erreur les icones a enregistrer et ce qui reste a reconstruire a la main
  (IFRAME, WISTIA, SVG complexe, CANVAS, VIDEO, IMG signales par le kit en commentaire).
Ensuite, a la main : retirer les commentaires du capteur, remplacer les lignes de donnees par un rendu FAKE,
rebrancher les etats, reconstruire les elements listes.
Code de sortie : 0 fait, 2 usage ou fichier illisible."""
import pathlib
import re
import sys


def main():
    for f in (sys.stdout, sys.stderr):
        try:
            f.reconfigure(encoding='utf-8', errors='replace')   # console Windows (cp1252)
        except (AttributeError, ValueError):
            pass
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        return 2
    try:
        src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')
    except (OSError, UnicodeDecodeError) as e:
        print('erreur : lecture impossible de %s (%s)' % (sys.argv[1], e), file=sys.stderr)
        return 2
    sect = '§'
    # Echappements du kit encore presents ? Marqueurs (AMP)/(Q)/(SECT), ou des « § » sans aucun « ; & ? » :
    # un dump echappe n'en contient plus (meme un simple style="a: b§ c: d" doit etre inverse).
    if re.search(r'\(AMP\)|\(Q\)|\(SECT\)', src) or (sect in src and not re.search(r'[;&?]', src)):
        src = src.replace(sect, ';').replace('(AMP)', '&').replace('(Q)', '?').replace('(SECT)', sect)
    src = re.sub(r'<svg tabler="([^"]+)"([^>]*?)\s*/>', r'<svg data-icon="tabler:\1"\2></svg>', src)   # ancien kit
    src = re.sub(r'<svg icon="([^"#]+)"([^>]*?)\s*/>', r'<svg data-icon="\1"\2></svg>', src)           # kit v2
    src = re.sub(r'(<svg)\s+icon="[^"]*"', r'\1', src)                  # icones sans nom : SVG complet garde
    todo = re.findall(r'<!--\s*((?:IFRAME|WISTIA|SVG complexe|CANVAS|VIDEO|IMG)(?:(?!-->).){0,120})', src)
    out = sys.argv[2] if len(sys.argv) > 2 else None
    if out:
        pathlib.Path(out).write_text(src, encoding='utf-8')
    else:
        sys.stdout.write(src)
    icons = sorted(set(re.findall(r'data-icon="([^"]+)"', src)))
    sys.stderr.write('icones a enregistrer (%d) : %s\n' % (len(icons), ', '.join(icons)))
    sys.stderr.write('a reconstruire (%d) :\n' % len(todo) + ''.join('  - ' + t.strip() + '\n' for t in todo))
    return 0


if __name__ == '__main__':
    sys.exit(main())
