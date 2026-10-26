# -*- coding: utf-8 -*-
"""dom2page.py - prepare le contenu d'une page du clone a partir d'un dump du kit de capture.
Outil du plugin copieur-universel (skill reconstruire-appli, references/conventions.md section 10).

  python3 dom2page.py dom-initial.html main.html   (sans SORTIE : resultat sur la sortie standard)
  python3 dom2page.py --echappe dom.html main.html (force l'inversion) ; --brut (ne rien inverser)
  (Windows : py au lieu de python3)

- inverse les echappements du kit s'il en reste (mode par defaut de capture-kit.js : « § » -> « ; »,
  « (AMP) » -> « & », « (Q) » -> « ? », puis « (SECT) » -> « § ») ; sans option, le dump est juge echappe
  s'il ne contient AUCUN « ; & ? » brut (un dump echappe n'en a jamais) et un marqueur ou un « § » ;
- transforme les icones reconnues (<svg icon="lib:nom" .../>) en espaces reserves <svg data-icon="lib:nom">
  hydrates par shell-base.js ; garde le SVG complet des icones sans nom ;
- liste sur la sortie d'erreur les icones a enregistrer et ce qui reste a reconstruire a la main (IFRAME,
  WISTIA, SVG complexe, CANVAS, OBJECT, EMBED et « +N lignes non captures » signales par le kit en
  commentaire ; avatars masques src="[AVATAR]").
Ensuite, a la main : retirer les commentaires du capteur, remplacer les lignes de donnees par un rendu FAKE,
rebrancher les etats, reconstruire les elements listes.
Code de sortie : 0 fait (--help aussi), 2 usage ou fichier illisible."""
import pathlib
import re
import sys


def main():
    for f in (sys.stdout, sys.stderr):
        try:
            f.reconfigure(encoding='utf-8', errors='replace')   # console Windows (cp1252)
        except (AttributeError, ValueError):
            pass
    args = sys.argv[1:]
    if args[:1] in (['-h'], ['--help']):
        print(__doc__)
        return 0
    mode = None
    for opt in ('--echappe', '--brut'):
        if opt in args:
            mode = opt
            args = [a for a in args if a != opt]
    if not args or args[0].startswith('-') or ('--echappe' in sys.argv and '--brut' in sys.argv):
        print(__doc__)
        return 2
    try:
        src = pathlib.Path(args[0]).read_text(encoding='utf-8-sig')
    except (OSError, UnicodeDecodeError) as e:
        print('erreur : lecture impossible de %s (%s)' % (args[0], e), file=sys.stderr)
        return 2
    sect = '§'
    # Echappements du kit encore presents ? Un dump echappe ne contient AUCUN « ; & ? » brut ; on l'inverse
    # alors s'il porte un marqueur (AMP)/(Q)/(SECT) ou un « § » (meme un simple style="a: b§ c: d").
    # Un dump brut (mode raw) qui cite « (Q) » ou « § » dans son texte n'est donc pas corrompu.
    if mode == '--echappe' or (mode is None and not re.search(r'[;&?]', src)
                               and (re.search(r'\(AMP\)|\(Q\)|\(SECT\)', src) or sect in src)):
        src = src.replace(sect, ';').replace('(AMP)', '&').replace('(Q)', '?').replace('(SECT)', sect)
    src = re.sub(r'<svg tabler="([^"]+)"([^>]*?)\s*/>', r'<svg data-icon="tabler:\1"\2></svg>', src)   # ancien kit
    src = re.sub(r'<svg icon="([^"#]+)"([^>]*?)\s*/>', r'<svg data-icon="\1"\2></svg>', src)           # kit v2
    src = re.sub(r'(<svg)\s+icon="[^"]*"', r'\1', src)                  # icones sans nom : SVG complet garde
    todo = re.findall(r'<!--\s*((?:IFRAME|WISTIA|SVG complexe|CANVAS|OBJECT|EMBED|\+\d+ (?:lignes|éléments) non captur)'
                      r'(?:(?!-->).){0,120})', src)
    avatars = src.count('src="[AVATAR]"')
    if avatars:
        todo.append('IMG src="[AVATAR]" x%d : avatar a initiales (FAKE.avatarColor) ou image neutre' % avatars)
    out = args[1] if len(args) > 1 else None
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
