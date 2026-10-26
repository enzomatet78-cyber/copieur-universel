# -*- coding: utf-8 -*-
"""png_diff.py - comparer deux images PNG au pixel pres, sans dependance (Python standard).
Outil du plugin copieur-universel (skill verifier-copie, references/methode.md section 6).
Sous Windows, py remplace python3 (lanceur Python de Windows).

  python3 png_diff.py diff ORIGINAL.png CLONE.png [--seuil 24] [--zone x,y,l,h] [--decalage dx,dy]
                           [--out ecarts.png] [--json rapport.json]
  python3 png_diff.py encre IMAGE.png --zone x,y,l,h [--seuil 40]   boite de l'« encre » (texte, icone) d'une zone
  python3 png_diff.py couleur IMAGE.png x,y [x,y ...]                couleur exacte de pixels
  python3 png_diff.py info IMAGE.png                                 taille, type

diff : pixels dont un canal differe de plus de --seuil (24 par defaut : absorbe l'anticrenelage leger),
pourcentage, boite englobante, zones les plus touchees (grille de 64 px), ecart moyen par canal ; --out
ecrit une image : pixels identiques en gris pale, pixels differents en rouge. --zone limite la comparaison
(coordonnees de l'ORIGINAL) ; --decalage dx,dy compare original(x,y) a clone(x+dx,y+dy) (fenetre ou menu
decale). Les dossiers de --out et --json sont crees au besoin.
Tailles differentes sans --zone : la partie commune est comparee, mais le resultat est « different » (code 1,
« taillesDifferentes »: true dans le JSON) : un clone tronque, plus long, ou rendu a une autre echelle (DPR 2
d'un ecran Retina contre DPR 1) n'est jamais identique. Avec --zone, la zone doit exister dans les deux images
(sinon « zoneTronquee »: true et code 1).
Les deux images doivent etre a la meme echelle : une capture a 125 % se compare a un rendu du clone fait au
meme facteur (cdp_eval.py shot --viewport LxH@1.25). JPEG non pris en charge (convertir en PNG).
Code de sortie : 0 identique (0 pixel au-dessus du seuil ET tailles identiques ; avec --zone, zone presente
dans les deux images), 1 differences ou tailles differentes, 2 usage ou fichier illisible (PNG tronque compris).
PNG lus : 8 bits, gris / gris+alpha / RVB / RVBA / palette, non entrelaces (Chrome, Edge, window_shot.ps1)."""
import json
import os
import struct
import sys
import zlib


class PngError(Exception):
    pass


def load(path):
    try:
        d = open(path, 'rb').read()
    except OSError as e:
        raise PngError('lecture impossible de %s (%s)' % (path, e))
    if d[:8] != b'\x89PNG\r\n\x1a\n':
        raise PngError('%s n\'est pas un PNG (JPEG ? le convertir en PNG)' % path)
    i, idat, ihdr, plte, trns = 8, [], None, None, None
    while i + 8 <= len(d):
        n, t = struct.unpack('>I4s', d[i:i + 8])
        c = d[i + 8:i + 8 + n]
        i += 12 + n
        if t == b'IHDR':
            if len(c) != 13:
                raise PngError('%s : en-tete PNG tronque (fichier incomplet ?)' % path)
            ihdr = struct.unpack('>IIBBBBB', c)
        elif t == b'PLTE':
            plte = c
        elif t == b'tRNS':
            trns = c
        elif t == b'IDAT':
            idat.append(c)
        elif t == b'IEND':
            break
    if not ihdr:
        raise PngError('%s : en-tete PNG absent' % path)
    w, h, bd, ct, _, _, il = ihdr
    if bd != 8 or il != 0 or ct not in (0, 2, 3, 4, 6):
        raise PngError('%s : PNG %d bits, type %d%s non pris en charge (8 bits non entrelace attendu)'
                       % (path, bd, ct, ', entrelace' if il else ''))
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    try:
        raw = zlib.decompress(b''.join(idat))
    except zlib.error as e:
        raise PngError('%s : donnees d\'image illisibles (PNG tronque ou corrompu : %s)' % (path, e))
    stride = w * bpp
    if len(raw) < h * (1 + stride):
        raise PngError('%s : donnees d\'image incompletes (PNG tronque ?)' % path)
    rows = []
    prev = bytearray(stride)
    k = 0
    for _ in range(h):
        f = raw[k]
        line = bytearray(raw[k + 1:k + 1 + stride])
        k += 1 + stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            raise PngError('%s : filtre PNG inconnu %d' % (path, f))
        rows.append(line)
        prev = line
    # Normaliser en RVB (3 octets par pixel) : la transparence est composee sur du blanc.
    out = []
    for line in rows:
        if ct == 2:
            out.append(bytes(line))
            continue
        o = bytearray(w * 3)
        for x in range(w):
            if ct == 6:
                r, g, b, a = line[x * 4:x * 4 + 4]
            elif ct == 4:
                r = g = b = line[x * 2]
                a = line[x * 2 + 1]
            elif ct == 0:
                r = g = b = line[x]
                a = 255
            else:
                p = line[x]
                if not plte or p * 3 + 2 >= len(plte) + 0:
                    r = g = b = 0
                else:
                    r, g, b = plte[p * 3:p * 3 + 3]
                a = trns[p] if trns and p < len(trns) else 255
            if a < 255:
                r = (r * a + 255 * (255 - a)) // 255
                g = (g * a + 255 * (255 - a)) // 255
                b = (b * a + 255 * (255 - a)) // 255
            o[x * 3:x * 3 + 3] = bytes((r, g, b))
        out.append(bytes(o))
    return w, h, out, {0: 'gris', 2: 'RVB', 3: 'palette', 4: 'gris+alpha', 6: 'RVBA'}[ct]


def save(path, w, h, rows):
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(t, c):
        return struct.pack('>I', len(c)) + t + c + struct.pack('>I', zlib.crc32(t + c) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
    ecrire(path, data)


def ecrire(path, data):
    """Ecrit un fichier (octets ou texte UTF-8) en creant son dossier au besoin (ex. <TRAVAIL>/verif/)."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        if isinstance(data, str):
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(data)
        else:
            with open(path, 'wb') as f:
                f.write(data)
    except OSError as e:
        raise PngError('ecriture impossible de %s (%s)' % (path, e))


def parse_ints(s, n, what):
    try:
        v = [int(round(float(x))) for x in s.replace(';', ',').split(',')]
    except ValueError:
        v = []
    if len(v) != n:
        raise PngError('%s attendu sous la forme %s' % (what, ','.join(['n'] * n)))
    return v


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            raise PngError('%s attend une valeur' % name)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def cmd_diff(args):
    seuil = int(opt(args, '--seuil', '24'))
    zone = opt(args, '--zone')
    dec = opt(args, '--decalage')
    out = opt(args, '--out')
    rapport = opt(args, '--json')
    if len(args) != 2:
        raise PngError('diff attend deux images : ORIGINAL.png CLONE.png')
    wa, ha, A, _ = load(args[0])
    wb, hb, B, _ = load(args[1])
    dx, dy = parse_ints(dec, 2, '--decalage') if dec else (0, 0)
    x0, y0, x1, y1 = 0, 0, wa, ha
    if zone:
        zx, zy, zw, zh = parse_ints(zone, 4, '--zone')
        x0, y0, x1, y1 = max(0, zx), max(0, zy), min(wa, zx + zw), min(ha, zy + zh)
    demande = (x0, y0, x1, y1)
    x0, y0 = max(x0, -dx), max(y0, -dy)
    x1, y1 = min(x1, wb - dx), min(y1, hb - dy)
    notes = []
    tailles_diff = (wa, ha) != (wb, hb)
    # Sans --zone, des tailles differentes rendent le resultat « different » meme si la partie commune est
    # identique (clone tronque, page plus courte, autre echelle). Avec --zone, la zone doit exister dans le clone.
    zone_tronquee = bool(zone) and (x0, y0, x1, y1) != demande
    incomplet = zone_tronquee if zone else tailles_diff
    if tailles_diff:
        msg = 'tailles differentes : %dx%d (original) contre %dx%d (clone)' % (wa, ha, wb, hb)
        if wa and ha and abs(wb / wa - hb / ha) < 0.02 and abs(wb / wa - 1) > 0.02:
            msg += ', rapport x%.2f : autre echelle (devicePixelRatio, capture Retina ?)' % (wb / wa)
        if zone:
            msg += ' ; seule la zone demandee compte'
        else:
            msg += ' ; partie commune comparee, mais le resultat ne peut pas etre « identique » (meme echelle et meme taille de page, ou --zone pour une partie)'
        notes.append(msg)
    if zone_tronquee:
        notes.append('zone tronquee : elle depasse du clone (decalage compris) ; seule la partie presente dans les deux images est comparee, resultat « different »')
    if x1 <= x0 or y1 <= y0:
        raise PngError('aucune partie commune a comparer (zone ou decalage hors des images)')
    n_diff, total = 0, (x1 - x0) * (y1 - y0)
    box = [x1, y1, -1, -1]
    cells = {}
    somme = [0, 0, 0]
    vis = [] if out else None
    for y in range(y0, y1):
        ra = A[y]
        rb = B[y + dy]
        sa = ra[x0 * 3:x1 * 3]
        sb = rb[(x0 + dx) * 3:(x1 + dx) * 3]
        if vis is not None:
            vrow = bytearray()
        if sa == sb:
            if vis is not None:
                for x in range(x0, x1):
                    g = 170 + (sum(ra[x * 3:x * 3 + 3]) // 3) // 3
                    vrow += bytes((g, g, g))
                vis.append(bytes(vrow))
            continue
        for x in range(x0, x1):
            i, j = x * 3, (x + dx) * 3
            d0, d1, d2 = abs(ra[i] - rb[j]), abs(ra[i + 1] - rb[j + 1]), abs(ra[i + 2] - rb[j + 2])
            somme[0] += d0
            somme[1] += d1
            somme[2] += d2
            if max(d0, d1, d2) > seuil:
                n_diff += 1
                if x < box[0]:
                    box[0] = x
                if y < box[1]:
                    box[1] = y
                if x > box[2]:
                    box[2] = x
                if y > box[3]:
                    box[3] = y
                c = (x // 64, y // 64)
                cells[c] = cells.get(c, 0) + 1
                if vis is not None:
                    vrow += b'\xe0\x10\x10'
            elif vis is not None:
                g = 170 + (sum(ra[i:i + 3]) // 3) // 3
                vrow += bytes((g, g, g))
        if vis is not None:
            vis.append(bytes(vrow))
    top = sorted(cells.items(), key=lambda kv: -kv[1])[:10]
    res = {
        'original': args[0], 'clone': args[1], 'seuil': seuil,
        'zone': [x0, y0, x1 - x0, y1 - y0], 'decalage': [dx, dy],
        'tailles': {'original': [wa, ha], 'clone': [wb, hb]},
        'taillesDifferentes': tailles_diff, 'zoneTronquee': zone_tronquee,
        'identique': not n_diff and not incomplet,
        'pixelsDifferents': n_diff, 'pixelsCompares': total,
        'pourcentage': round(100.0 * n_diff / total, 3),
        'boite': ([box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1] if n_diff else None),
        'ecartMoyen': [round(s / total, 2) for s in somme],
        'zonesLesPlusTouchees': [{'x': c[0] * 64, 'y': c[1] * 64, 'l': 64, 'h': 64, 'pixels': n} for c, n in top],
        'notes': notes,
    }
    for nt in notes:
        print('attention : ' + nt)
    print('%s : %d pixels differents sur %d (%.3f %%, seuil %d)%s ; ecart moyen par canal %s'
          % (args[1], n_diff, total, res['pourcentage'], seuil,
             (' ; boite x=%d y=%d l=%d h=%d' % tuple(res['boite'])) if n_diff else '', res['ecartMoyen']))
    for z in res['zonesLesPlusTouchees'][:5]:
        print('  zone x %d-%d, y %d-%d : %d pixels' % (z['x'], z['x'] + 63, z['y'], z['y'] + 63, z['pixels']))
    if incomplet:
        print('DIFFERENT : %s (code 1)' % ('tailles differentes' if not zone else 'zone absente du clone en partie'))
    if out:
        save(out, x1 - x0, y1 - y0, vis)
        print('image des ecarts : %s (rouge = different)' % out)
    if rapport:
        ecrire(rapport, json.dumps(res, ensure_ascii=False, indent=1))
    return 1 if n_diff or incomplet else 0


def cmd_encre(args):
    zone = opt(args, '--zone')
    seuil = int(opt(args, '--seuil', '40'))
    if len(args) != 1 or not zone:
        raise PngError('encre attend : IMAGE.png --zone x,y,l,h')
    w, h, R, _ = load(args[0])
    zx, zy, zw, zh = parse_ints(zone, 4, '--zone')
    x0, y0, x1, y1 = max(0, zx), max(0, zy), min(w, zx + zw), min(h, zy + zh)
    if x1 <= x0 or y1 <= y0:
        raise PngError('zone hors de l\'image (%dx%d)' % (w, h))
    # Fond = couleur la plus frequente de la zone.
    freq = {}
    for y in range(y0, y1):
        r = R[y]
        for x in range(x0, x1):
            k = bytes(r[x * 3:x * 3 + 3])
            freq[k] = freq.get(k, 0) + 1
    fond = max(freq.items(), key=lambda kv: kv[1])[0]
    box = [x1, y1, -1, -1]
    n = 0
    for y in range(y0, y1):
        r = R[y]
        for x in range(x0, x1):
            if max(abs(r[x * 3 + c] - fond[c]) for c in range(3)) > seuil:
                n += 1
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
    if not n:
        print('aucune encre dans la zone (fond rgb%s, seuil %d)' % (tuple(fond), seuil))
        return 1
    print('encre : x=%d y=%d l=%d h=%d (%d pixels) ; fond rgb%s ; seuil %d'
          % (box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1, n, tuple(fond), seuil))
    return 0


def cmd_couleur(args):
    if len(args) < 2:
        raise PngError('couleur attend : IMAGE.png x,y [x,y ...]')
    w, h, R, _ = load(args[0])
    for s in args[1:]:
        x, y = parse_ints(s, 2, 'point')
        if not (0 <= x < w and 0 <= y < h):
            print('%d,%d : hors de l\'image (%dx%d)' % (x, y, w, h))
            continue
        r, g, b = R[y][x * 3:x * 3 + 3]
        print('%d,%d : rgb(%d, %d, %d) #%02x%02x%02x' % (x, y, r, g, b, r, g, b))
    return 0


def cmd_info(args):
    if len(args) != 1:
        raise PngError('info attend : IMAGE.png')
    w, h, _, t = load(args[0])
    print('%s : %dx%d, %s 8 bits' % (args[0], w, h, t))
    return 0


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass
    args = sys.argv[1:]
    if args and args[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if not args:
        print(__doc__)
        return 2
    cmd = args.pop(0) if args[0] in ('diff', 'encre', 'couleur', 'info') else 'diff'
    try:
        return {'diff': cmd_diff, 'encre': cmd_encre, 'couleur': cmd_couleur, 'info': cmd_info}[cmd](args)
    except PngError as e:
        print('erreur : %s' % e, file=sys.stderr)
        return 2
    except ValueError as e:
        print('erreur : valeur invalide (%s)' % e, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
