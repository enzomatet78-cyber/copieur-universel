#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scan_pii.py — recherche de données personnelles et de secrets dans un clone (ou tout dossier).
Plugin copieur-universel, skill verifier-copie. Python 3.8+ STANDARD (aucune dépendance). Lecture seule.

  py scan_pii.py --root <dossier> [--allow "titulaire@domaine.fr"] [--allow-domain "exemple.*"]
                 [--deny "Nom Réel"] [--deny-file noms.txt] [--out rapport.json]

Détecte :
  - emails (y compris écrits &#64; / %40 / \\u0040, et encodés en URL : mailto%3A…, %3C…%3E) ;
  - téléphones : internationaux (+33 6 …, +1 …), français (06 12 34 56 78), nord-américains (555-123-4567),
    liens tel: (pas les formats nationaux étrangers sans indicatif, ex. 07911 123456 britannique) ;
  - IBAN (clé ISO 13616 mod 97 et longueur par pays vérifiées) ;
  - numéros de carte bancaire (13 à 19 chiffres, préfixe d'émetteur plausible et clé de Luhn) ;
  - clés et jetons : Stripe (sk_live/sk_test/rk_/pk_live/whsec_), AWS (AKIA…), GitHub (ghp_…, github_pat_),
    GitLab, Slack (xox…, webhooks), Discord (webhooks), Google (AIza…, GOCSPX-), OpenAI / Anthropic (sk-…),
    SendGrid, Mailgun, Mailchimp, Twilio, npm, Shopify, Square, DSN Sentry, clés privées PEM, JWT,
    identifiants dans une URL (https://user:pass@…), en-têtes Bearer, affectations « api_key = '…' » ;
  - chemins locaux qui révèlent un nom de session : C:\\Users\\<nom>, file:///Users/<nom>/, /Users/<nom>/
    (fréquents dans les dumps d'une appli Electron : vscode-file://…/c:/Users/<nom>/…) ;
  - adresses IPv4 publiques (option --ip) ;
  - valeurs interdites que vous fournissez (--deny / --deny-file : vrais noms relevés pendant la capture…),
    sans tenir compte de la casse ni des accents.

Autorisé d'office (désactivable avec --no-builtin-allow) : domaines réservés aux exemples (example.com/.net/.org,
*.example, *.test, *.invalid, *.localhost), plages de téléphones réservées à la fiction (France ARCEP :
01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49, 06 39 98 ; Amérique du Nord 555-0100 à 0199 ; Royaume-Uni :
07700 900xxx, 020 7946 0xxx, 01632 960xxx, 0113…0161 496 0xxx, 0191 498 0xxx, 028 9018 0xxx, 029 2018 0xxx,
0306 999 0xxx, 0808 157 0xxx, 0909 879 0xxx — sous forme internationale +44), cartes de test publiées
(4242 4242 4242 4242…), IBAN d'exemple des documentations, valeurs manifestement factices (0123456789…).
Les secrets sont MASQUÉS dans le rapport (préfixe + 4 derniers caractères) : le rapport ne les propage pas.

Codes de sortie : 0 = rien trouvé (au-dessus du seuil) ; 1 = au moins un constat ; 2 = erreur d'usage.
"""
import argparse
import base64
import bisect
import fnmatch
import ipaddress
import json
import os
import re
import sys
import time
import unicodedata

VERSION = '1.1'
DEFAULT_EXCLUDED_DIRS = {'.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv'}
BINARY_EXT = {
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'psd',
    'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'm4a',
    'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin', 'pyc', 'pyo',
    'class', 'jar', 'wasm', 'db', 'sqlite', 'asar', 'node', 'msi', 'cab', 'iso', 'dat', 'pak',
}
FILE_TLDS = {
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'js', 'mjs', 'cjs', 'css', 'scss', 'less',
    'html', 'htm', 'json', 'map', 'ts', 'tsx', 'jsx', 'vue', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'webm',
    'mp3', 'wav', 'ogg', 'pdf', 'zip', 'gz', 'txt', 'xml', 'md', 'py', 'php', 'rb', 'java', 'kt', 'swift',
    'lock', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'env', 'ps1', 'cmd', 'bat', 'exe', 'dll', 'jpe', 'tiff',
}
RESERVED_EMAIL_DOMAINS = ['example.com', 'example.net', 'example.org', 'example.edu', '*.example', '*.test',
                          '*.invalid', '*.localhost', 'localhost', 'example']
# Plages réservées à la fiction, en chiffres E.164 sans « + »
FICTION_PHONE_PREFIXES = [
    '3319900', '3326191', '3335301', '3346571', '3353649', '3363998',            # France (ARCEP)
    '447700900', '442079460', '441632960', '441134960', '441144960', '441154960', '441164960',
    '441174960', '441184960', '441214960', '441314960', '441414960', '441514960', '441614960',
    '441914980', '442890180', '442920180', '443069990', '448081570', '449098790',   # Royaume-Uni (Ofcom)
]
NANP_FICTION_RX = re.compile(r'^1?\d{3}55501\d{2}$')
TEST_CARDS = {
    '4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222', '5200828282828210',
    '5105105105105100', '378282246310005', '371449635398431', '6011111111111117', '6011000990139424',
    '3056930009020004', '36227206271667', '3566002020360505', '6200000000000005', '4111111111111111',
    '4012888888881881', '4000000000000002', '4000000000009995', '4000002500003155', '4000000000003220',
    '5454545454545454', '4917610000000000', '6250941006528599', '30569309025904', '38520000023237',
    '4000000000000077', '4000000000000093', '4000000000000341', '4000000000000127', '4000000000000069',
    '4000000000000119', '4000000000000101', '4000000000000259', '4000000000000010', '4000000000000028',
    '4012888888881', '4222222222222', '378734493671000', '6011000000000004', '5431111111111111',
}
EXAMPLE_IBANS = {
    'GB82WEST12345698765432', 'DE89370400440532013000', 'FR1420041010050500013M02606',
    'FR7630006000011234567890189', 'NL91ABNA0417164300', 'BE68539007547034', 'CH9300762011623852957',
    'ES9121000418450200051332', 'IT60X0542811101000000123456', 'GB29NWBK60161331926819',
    'FR7630001007941234567890185', 'LU280019400644750000', 'AT611904300234573201',
}
IBAN_LENGTHS = {
    'AD': 24, 'AE': 23, 'AL': 28, 'AT': 20, 'AZ': 28, 'BA': 20, 'BE': 16, 'BG': 22, 'BH': 22, 'BR': 29,
    'CH': 21, 'CR': 22, 'CY': 28, 'CZ': 24, 'DE': 22, 'DK': 18, 'DO': 28, 'EE': 20, 'EG': 29, 'ES': 24,
    'FI': 18, 'FO': 18, 'FR': 27, 'GB': 22, 'GE': 22, 'GI': 23, 'GL': 18, 'GR': 27, 'GT': 28, 'HR': 21,
    'HU': 28, 'IE': 22, 'IL': 23, 'IS': 26, 'IT': 27, 'JO': 30, 'KW': 30, 'KZ': 20, 'LB': 28, 'LI': 21,
    'LT': 20, 'LU': 20, 'LV': 21, 'MC': 27, 'MD': 24, 'ME': 22, 'MK': 19, 'MR': 27, 'MT': 31, 'MU': 30,
    'NL': 18, 'NO': 15, 'PK': 24, 'PL': 28, 'PS': 29, 'PT': 25, 'QA': 29, 'RO': 24, 'RS': 22, 'SA': 24,
    'SE': 24, 'SI': 19, 'SK': 24, 'SM': 27, 'TN': 24, 'TR': 26, 'UA': 29, 'VG': 24, 'XK': 20,
}
PLACEHOLDER_WORDS = ('your', 'votre', 'example', 'exemple', 'placeholder', 'changeme', 'dummy', 'sample',
                     'xxxx', 'fake', 'factice', 'redacted', 'masqu', 'test_key', 'insert', 'todo', 'replace')

SP = '[ \\u00a0\\u202f]'
SEPC = '[ \\u00a0\\u202f.\\-]'
EMAIL_RX = re.compile(r'(?<![A-Za-z0-9._%+\-])([A-Za-z0-9][A-Za-z0-9._%+\-]{0,63})@'
                      r'((?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24})(?![A-Za-z0-9\-])')
ENCODED_AT_RX = re.compile(r'&#0*64;|&#x0*40;|%40|\\u0040|\\x40', re.I)
# séparateurs encodés en URL autour d'un email (mailto%3A…, %3C…%3E, %20, %22…) et caractères d'adresse encodés
URL_SEP_RX = re.compile(r'%(?:3[ABCE]|2[0279C]|28|29|5[BD]|7[BD]|0[9AD])', re.I)
URL_CHARS = {'%2E': '.', '%2B': '+', '%2D': '-', '%5F': '_'}
URL_CHAR_RX = re.compile(r'%(?:2[EBD]|5F)', re.I)
TEL_RX = re.compile(r'\btel:([+\d][\d \u00a0.\-()%2Bb]{5,30}\d)', re.I)
INTL_RX = re.compile(r'(?<![\w+/=#&%.-])\+\(?\d[\d \u00a0\u202f.\-()]{6,22}\d(?![\w])')
FR_RX = re.compile(r'(?<![\w.,+/=#&%-])0[1-9](' + SEPC + r'?)\d{2}(?:\1\d{2}){3}(?!\w)(?![.,]\d)')
NANP_RX = re.compile(r'(?<![\w.+/=#-])(?:\(\d{3}\)' + SP + r'?|\d{3}[\-.])\d{3}[\-.]\d{4}(?![\w])(?![.,]\d)')
IBAN_RX = re.compile(r'(?<![A-Za-z0-9])([A-Z]{2}\d{2}(?:' + SP + r'?[A-Z0-9]{4}){2,7}(?:' + SP + r'?[A-Z0-9]{1,3})?)(?![A-Za-z0-9])')
CARD_RX = re.compile(r'(?<![\w.,+\-/=#])(\d(?:[ \u00a0\-]?\d){12,18})(?![\w])(?![.,]\d)')
# Chemins locaux qui contiennent un nom de session (Electron : vscode-file://.../c:/Users/<nom>/..., messages
# d'erreur) : C:\Users\<nom>, file:///Users/<nom>/, /Users/<nom>/ (macOS), file:///home/<nom>/ (Linux).
UPATH_RX = re.compile(r'(?i)(?<![\w])([a-z]:(?:\\{1,2}|/)+(?:users|utilisateurs|documents and settings)(?:\\{1,2}|/)+)'
                      r'([^\\/\s"\'<>|:*?%$]{1,64})')
UPATH_NIX_RX = re.compile(r'((?:file://)?/Users/|file:///home/)([^/\s"\'<>%$]{1,64})(?=/)')
UPATH_KEEP = {'public', 'default', 'default user', 'all users', 'shared', 'utilisateur', '<utilisateur>', 'username',
              '<username>', 'user', '<user>', 'nom', '<nom>', 'xxx', '...', 'moi', 'vous', 'you', 'me'}
IPV4_RX = re.compile(r'(?<![\w.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\w.])')
SVG_DATA_RX = re.compile(r'\b(?:d|points|viewBox|transform|path|values|keyTimes|keySplines|stroke-dasharray)\s*=\s*'
                         r'("[^"]*"|\'[^\']*\')', re.I)
DATA_URI_RX = re.compile(r'data:[\w/+.\-]+;base64,[A-Za-z0-9+/=\s]{40,}')

SECRET_PATTERNS = [
    # (type, regex, confiance, groupe de la valeur)
    ('cle-privee-pem', r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----', 'haute', 0),
    ('stripe-secret', r'\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b', 'haute', 0),
    ('stripe-test', r'\b(?:sk|rk)_test_[0-9A-Za-z]{16,}\b', 'haute', 0),
    ('stripe-publique-live', r'\bpk_live_[0-9A-Za-z]{16,}\b', 'moyenne', 0),
    ('stripe-webhook', r'\bwhsec_[0-9A-Za-z]{24,}\b', 'haute', 0),
    ('aws-cle-acces', r'\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b', 'haute', 0),
    ('aws-secret', r'(?i)aws.{0,20}?(?:secret|private).{0,20}?[\'"\s:=]+([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])', 'haute', 1),
    ('github-jeton', r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b', 'haute', 0),
    ('github-jeton-fin', r'\bgithub_pat_[A-Za-z0-9_]{60,255}\b', 'haute', 0),
    ('gitlab-jeton', r'\bglpat-[A-Za-z0-9_\-]{20,}\b', 'haute', 0),
    ('slack-jeton', r'\bxox[abposr]-(?:[A-Za-z0-9]+-){1,4}[A-Za-z0-9]{6,}\b', 'haute', 0),
    ('slack-jeton-appli', r'\bxapp-\d-[A-Z0-9]+-\d+-[a-z0-9]{20,}\b', 'haute', 0),
    ('slack-webhook', r'https://hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9/_\-]{20,}', 'haute', 0),
    ('discord-webhook', r'https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_\-]{20,}', 'haute', 0),
    ('google-cle-api', r'\bAIza[0-9A-Za-z_\-]{35}(?![0-9A-Za-z_\-])', 'haute', 0),
    ('google-secret-oauth', r'\bGOCSPX-[A-Za-z0-9_\-]{20,}', 'haute', 0),
    ('anthropic-cle', r'\bsk-ant-[A-Za-z0-9_\-]{32,}', 'haute', 0),
    ('openai-cle', r'\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{32,}', 'haute', 0),
    ('sendgrid-cle', r'\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b', 'haute', 0),
    ('mailgun-cle', r'\bkey-[0-9a-f]{32}\b', 'haute', 0),
    ('mailchimp-cle', r'\b[0-9a-f]{32}-us\d{1,2}\b', 'haute', 0),
    ('twilio-cle', r'\bSK[0-9a-fA-F]{32}\b', 'moyenne', 0),
    ('npm-jeton', r'\bnpm_[A-Za-z0-9]{36}\b', 'haute', 0),
    ('shopify-jeton', r'\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b', 'haute', 0),
    ('square-jeton', r'\bsq0(?:atp|csp)-[0-9A-Za-z\-_]{22,43}\b', 'haute', 0),
    ('sentry-dsn', r'https://[0-9a-f]{32}(?::[0-9a-f]{32})?@[a-z0-9.\-]*sentry\.io/\d+', 'moyenne', 0),
    ('jwt', r'\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}', 'haute', 0),
    ('identifiants-url', r'\b[a-z][a-z0-9+.\-]{1,15}://[^\s/:@\'"<>`]{1,64}:([^\s/@\'"<>`]{3,128})@[^\s/\'"<>`]+', 'haute', 0),
    ('bearer', r'(?i)\bbearer\s+([A-Za-z0-9\-._~+/]{20,}=*)', 'moyenne', 1),
    ('affectation-secret', r'(?i)\b(?:api[_\-]?key|apikey|secret(?:[_\-]?key)?|client[_\-]?secret|access[_\-]?token|'
                           r'auth[_\-]?token|refresh[_\-]?token|private[_\-]?key|password|passwd|pwd|mot_de_passe)\b'
                           r'["\']?\s*[:=]\s*["\']([^"\'\s<>]{12,200})["\']', 'moyenne', 1),
]
# Préfiltre : mots (en minuscules) dont l'un doit figurer dans le fichier pour que le motif soit essayé
NEEDLES = {
    'cle-privee-pem': ('private key',), 'stripe-secret': ('_live_',), 'stripe-test': ('_test_',),
    'stripe-publique-live': ('pk_live_',), 'stripe-webhook': ('whsec_',),
    'aws-cle-acces': ('akia', 'asia', 'agpa', 'aida', 'aroa', 'aipa', 'anpa', 'anva'), 'aws-secret': ('aws',),
    'github-jeton': ('ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'), 'github-jeton-fin': ('github_pat_',),
    'gitlab-jeton': ('glpat-',), 'slack-jeton': ('xox',), 'slack-jeton-appli': ('xapp-',),
    'slack-webhook': ('hooks.slack.com',), 'discord-webhook': ('/api/webhooks/',), 'google-cle-api': ('aiza',),
    'google-secret-oauth': ('gocspx-',), 'anthropic-cle': ('sk-ant-',), 'openai-cle': ('sk-',),
    'sendgrid-cle': ('sg.',), 'mailgun-cle': ('key-',), 'mailchimp-cle': ('-us',), 'npm-jeton': ('npm_',),
    'shopify-jeton': ('shpat_', 'shpca_', 'shppa_', 'shpss_'), 'square-jeton': ('sq0',),
    'sentry-dsn': ('sentry.io',), 'jwt': ('eyj',), 'identifiants-url': ('://',), 'bearer': ('bearer',),
}
SECRET_RX = [(t, re.compile(rx), conf, g) for t, rx, conf, g in SECRET_PATTERNS]
PRIORITY = {'secret': 0, 'refuse': 1, 'iban': 2, 'carte': 3, 'telephone': 4, 'email': 5, 'chemin': 6, 'ip': 7}


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


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').casefold()


def luhn_ok(d):
    total, alt = 0, False
    for ch in reversed(d):
        n = ord(ch) - 48
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def card_brand(d):
    n = len(d)
    if d[0] == '4' and n in (13, 16, 19):
        return 'visa'
    p2, p4, p6 = int(d[:2]), int(d[:4]), int(d[:6])
    if (51 <= p2 <= 55 or 2221 <= p4 <= 2720) and n == 16:
        return 'mastercard'
    if p2 in (34, 37) and n == 15:
        return 'amex'
    if (d.startswith('6011') or d.startswith('65') or 644 <= int(d[:3]) <= 649 or 622126 <= p6 <= 622925) and 16 <= n <= 19:
        return 'discover'
    if 3528 <= p4 <= 3589 and 16 <= n <= 19:
        return 'jcb'
    if (300 <= int(d[:3]) <= 305 or p2 in (36, 38, 39)) and 14 <= n <= 19:
        return 'diners'
    if p2 == 62 and 16 <= n <= 19:
        return 'unionpay'
    if d[:4] in ('5018', '5020', '5038', '6304', '6759', '6761', '6762', '6763') and 12 <= n <= 19:
        return 'maestro'
    return None


def iban_ok(compact):
    cc = compact[:2]
    if cc in IBAN_LENGTHS:
        if len(compact) != IBAN_LENGTHS[cc]:
            return False
    elif not 15 <= len(compact) <= 34:
        return False
    rearr = compact[4:] + compact[:4]
    num = ''.join(str(int(ch, 36)) for ch in rearr)
    return int(num) % 97 == 1


def norm_phone(s):
    """Chiffres E.164 sans « + » (meilleur effort) : '06 39 98 12 34' -> '33639981234'."""
    raw = re.sub(r'\(0\)', '', s.strip())          # +33 (0)6 … -> +33 6 …
    digits = re.sub(r'\D', '', raw)
    if raw.startswith('+'):
        return digits
    if digits.startswith('00'):
        return digits[2:]
    if len(digits) == 10 and digits[0] == '0' and digits[1] != '0':
        return '33' + digits[1:]       # format national français
    if len(digits) == 11 and digits.startswith('07700'):
        return '44' + digits[1:]
    return digits


def obviously_fake_digits(d):
    """Numéros que personne ne peut détenir : partie abonné faite d'un seul chiffre (+33 6 00 00 00 00),
    ou suite complète 0123456789 / 1234567890. Attention : 06 12 34 56 78 est un VRAI numéro attribué,
    il n'est donc PAS considéré comme factice (utiliser la plage de fiction 06 39 98 xx xx)."""
    if len(set(d[-8:])) == 1:
        return True
    return d in ('0123456789', '1234567890', '123456789', '9876543210', '0987654321')


def is_arithmetic_pairs(m):
    pairs = [int(x) for x in re.findall(r'\d{2}', re.sub(r'\D', '', m))]
    if len(pairs) < 4:
        return False
    diffs = {b - a for a, b in zip(pairs, pairs[1:])}
    return len(diffs) == 1 and 0 not in diffs


def masked_like(v):
    low = v.lower()
    return (any(c in v for c in '\u2022\u25cf\u2026*<>{}$')
            or 'xxxx' in low or '....' in v or any(w in low for w in PLACEHOLDER_WORDS))


def entropy(s):
    from math import log2
    if not s:
        return 0.0
    counts = {}
    for c in s:
        counts[c] = counts.get(c, 0) + 1
    return -sum(n / len(s) * log2(n / len(s)) for n in counts.values())


def mask_value(kind, v, typ=''):
    if kind in ('carte',):
        d = re.sub(r'\D', '', v)
        return '\u2022\u2022\u2022\u2022 ' + d[-4:]
    if kind == 'iban':
        c = re.sub(r'\s', '', v)
        return c[:4] + '\u2026' + c[-4:]
    if kind == 'secret':
        v = v.strip()
        if typ.startswith('cle-privee'):
            return v                                   # l'en-t\u00eate PEM n'est pas secret en soi
        if typ == 'identifiants-url':
            return re.sub(r'(://[^:/@\s]+:)[^@\s]+@', '\\1\u2022\u2022\u2022\u2022@', v)
        if len(v) <= 12:
            return v[:3] + '\u2026'
        m = re.match(r'^([A-Za-z]{2,8}[_\-][A-Za-z]{0,6}[_\-]?)', v)
        head = m.group(1) if m and len(m.group(1)) <= 12 else v[:6]
        return head + '\u2026' + v[-4:]
    return v


def iter_emails(text):
    """(début, fin, email) ; ignore logo@2x.png & co ; retire un échappement JS/JSON collé devant
    (barre oblique inverse + u003c ou x3c)."""
    for m in EMAIL_RX.finditer(text):
        if m.group(2).rsplit('.', 1)[-1].lower() in FILE_TLDS:
            continue
        s0, val = m.start(), m.group(0)
        if s0 > 0 and text[s0 - 1] == '\\':
            esc = re.match(r'(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})', val)
            if esc:
                s0, val = s0 + esc.end(), val[esc.end():]
                if not re.match(r'[A-Za-z0-9]', val):
                    continue
        yield s0, m.end(), val


def scrub(s):
    """Masque les secrets et longues suites de chiffres d'un extrait de contexte (le rapport ne doit rien propager)."""
    for typ, rx, _, _ in SECRET_RX:
        if typ in ('affectation-secret', 'bearer', 'cle-privee-pem'):
            continue
        s = rx.sub(lambda m: mask_value('secret', m.group(0), typ), s)
    return re.sub(r'\d(?:[  \-]?\d){11,}', lambda m: '••••' + re.sub(r'\D', '', m.group(0))[-4:], s)


# ----------------------------------------------------------------------------------------------------
class Scanner:
    def __init__(self, a):
        self.a = a
        self.root = os.path.abspath(a.root)
        self.allow_values = set()
        self.allow_phones = set()
        self.allow_domains = []
        self.allow_phone_prefixes = [re.sub(r'\D', '', norm_phone(p)) for p in (a.allow_phone_prefix or [])]
        self.deny = []
        for v in a.allow or []:
            self._add_allow(v)
        for d in a.allow_domain or []:
            self.allow_domains.append(d.strip().lstrip('@').lower())
        if a.allow_file:
            for line in self._read_list(a.allow_file):
                if line.startswith('@') or line.lower().startswith('domaine:'):
                    self.allow_domains.append(line.split(':', 1)[-1].strip().lstrip('@').lower())
                else:
                    self._add_allow(line)
        if not a.no_builtin_allow:
            self.allow_domains.extend(RESERVED_EMAIL_DOMAINS)
        for v in a.deny or []:
            self._add_deny(v)
        if a.deny_file:
            for line in self._read_list(a.deny_file):
                self._add_deny(line)
        self.findings = []
        self.allowed = {}
        self.skipped = []
        self.files_scanned = 0
        self.bytes_scanned = 0
        excl_out = os.path.abspath(a.out) if a.out else None
        self.exclude_files = {excl_out} if excl_out else set()

    @staticmethod
    def _read_list(path):
        try:
            with open(path, encoding='utf-8-sig') as f:
                return [l.strip() for l in f if l.strip() and not l.strip().startswith('#')]
        except OSError as e:
            die('liste illisible : ' + path + ' (' + str(e) + ')')

    def _add_allow(self, v):
        v = v.strip()
        if not v:
            return
        self.allow_values.add(v.lower())
        self.allow_values.add(re.sub(r'\s', '', v).upper())
        digits = re.sub(r'\D', '', v)
        if len(digits) >= 6 and not re.search(r'[A-Za-z@]', v):
            self.allow_phones.add(norm_phone(v))
            self.allow_values.add(digits)

    def _add_deny(self, v):
        v = v.strip()
        if len(v) >= 3:
            self.deny.append((v, fold(v)))

    # ---------- listes blanches ----------
    def email_allowed(self, email):
        low = email.lower()
        if low in self.allow_values:
            return 'liste --allow'
        dom = low.split('@', 1)[1]
        for pat in self.allow_domains:
            if pat.startswith('*.'):
                ok = dom == pat[2:] or fnmatch.fnmatch(dom, pat)
            else:
                ok = fnmatch.fnmatch(dom, pat) or fnmatch.fnmatch(dom, '*.' + pat)   # sous-domaines compris
            if ok:
                return 'domaine autorisé (' + pat + ')'
        return None

    def phone_allowed(self, raw):
        n = norm_phone(raw)
        if n in self.allow_phones or re.sub(r'\D', '', raw) in self.allow_values:
            return 'liste --allow'
        for p in self.allow_phone_prefixes:
            if p and n.startswith(p):
                return 'préfixe autorisé (' + p + ')'
        if not self.a.no_builtin_allow:
            for p in FICTION_PHONE_PREFIXES:
                if n.startswith(p):
                    return 'plage réservée à la fiction (+' + p + ')'
            if NANP_FICTION_RX.match(n):
                return 'plage réservée à la fiction (555-01xx)'
            if obviously_fake_digits(n) or obviously_fake_digits(re.sub(r'\D', '', raw)):
                return 'manifestement factice'
        return None

    def value_allowed(self, v):
        if v.lower() in self.allow_values or re.sub(r'\s', '', v).upper() in self.allow_values:
            return 'liste --allow'
        return None

    # ---------- fichiers ----------
    def excluded(self, rel, name):
        if name in DEFAULT_EXCLUDED_DIRS:
            return True
        for pat in self.a.exclude or []:
            if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(name, pat):
                return True
        return False

    def walk(self):
        if os.path.isfile(self.root):
            yield self.root, os.path.basename(self.root)
            return
        for dirpath, dirnames, filenames in os.walk(self.root):
            rel_dir = os.path.relpath(dirpath, self.root).replace('\\', '/')
            rel_dir = '' if rel_dir == '.' else rel_dir
            dirnames[:] = sorted(d for d in dirnames if not self.excluded((rel_dir + '/' + d).lstrip('/'), d))
            for fn in sorted(filenames):
                rel = (rel_dir + '/' + fn).lstrip('/')
                if self.excluded(rel, fn):
                    continue
                yield os.path.join(dirpath, fn), rel

    def read(self, path, rel):
        if os.path.abspath(path) in self.exclude_files:
            return None
        ext = rel.rsplit('.', 1)[-1].lower() if '.' in rel else ''
        if ext in BINARY_EXT:
            self.skipped.append({'fichier': rel, 'raison': 'binaire (.' + ext + ')'})
            return None
        try:
            size = os.path.getsize(path)
            if size > self.a.max_size * 1024 * 1024:
                self.skipped.append({'fichier': rel, 'raison': 'trop gros (%d Mo > --max-size)' % (size // 1048576)})
                return None
            with open(path, 'rb') as f:
                raw = f.read()
        except OSError as e:
            self.skipped.append({'fichier': rel, 'raison': 'illisible : ' + str(e)})
            return None
        if raw.startswith(b'\xef\xbb\xbf'):
            return raw[3:].decode('utf-8', errors='replace')
        if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
            return raw.decode('utf-16', errors='replace')
        if b'\x00' in raw[:8192]:
            self.skipped.append({'fichier': rel, 'raison': 'binaire (octets nuls)'})
            return None
        return raw.decode('utf-8', errors='replace')

    # ---------- détection ----------
    def scan_text(self, text, rel):
        starts = [0] + [m.end() for m in re.finditer('\n', text)]

        def pos(i):
            ln = bisect.bisect_right(starts, i)
            return ln, i - starts[ln - 1] + 1

        cands = []   # (début, fin, catégorie, type, valeur, confiance, détail)

        # 1. secrets
        low = text.lower()
        for typ, rx, conf, g in SECRET_RX:
            needles = NEEDLES.get(typ)
            if needles and not any(n in low for n in needles):
                continue
            for m in rx.finditer(text):
                val = m.group(g) if g else m.group(0)
                if typ in ('affectation-secret', 'bearer', 'identifiants-url'):
                    probe = m.group(1) if typ == 'identifiants-url' else val      # le mot de passe seul
                    if masked_like(probe) or probe.lower() in ('password', 'motdepasse', 'pass', 'user'):
                        continue
                    if typ != 'identifiants-url' and (entropy(val) < 3.0 or not (re.search(r'\d', val) and re.search(r'[A-Za-z]', val))):
                        continue
                detail = None
                if typ == 'jwt':
                    try:
                        h = m.group(0).split('.')[0]
                        hdr = json.loads(base64.urlsafe_b64decode(h + '=' * (-len(h) % 4)).decode('utf-8', 'replace'))
                        detail = 'en-tête JWT : alg=' + str(hdr.get('alg'))
                    except Exception:
                        conf, detail = 'moyenne', 'ressemble à un JWT (en-tête illisible)'
                cands.append((m.start(), m.end(), 'secret', typ, val, conf, detail))

        # 2. IBAN
        for m in IBAN_RX.finditer(text):
            v = m.group(1)
            c = re.sub(r'\s', '', v)
            if iban_ok(c):
                cands.append((m.start(1), m.end(1), 'iban', 'iban', v, 'haute', 'clé mod 97 valide'))

        # 3. cartes
        for m in CARD_RX.finditer(text):
            v = m.group(1)
            d = re.sub(r'\D', '', v)
            if not 13 <= len(d) <= 19 or len(set(d)) <= 2:
                continue
            brand = card_brand(d)
            if brand and luhn_ok(d):
                near = text[max(0, m.start(1) - 60):m.start(1)].lower()
                grouped = bool(re.search(r'[ \- ]', v))
                conf = 'haute' if grouped or re.search(r'cart|card|\bcb\b|visa|master|amex|\bpan\b|\bcc\b', near) else 'moyenne'
                cands.append((m.start(1), m.end(1), 'carte', 'carte-' + brand, v, conf,
                              'Luhn valide' + ('' if grouped else ', chiffres collés (peut être un identifiant)')))

        # 4. téléphones (sur une copie où les données SVG / data: sont neutralisées, même longueur)
        ptext = SVG_DATA_RX.sub(lambda m: m.group(0)[:m.start(1) - m.start(0)] + ' ' * len(m.group(1)), text)
        ptext = DATA_URI_RX.sub(lambda m: ' ' * len(m.group(0)), ptext)
        for m in TEL_RX.finditer(ptext):
            v = re.sub(r'%2B', '+', m.group(1), flags=re.I)
            if 6 <= len(re.sub(r'\D', '', v)) <= 15:
                cands.append((m.start(1), m.end(1), 'telephone', 'telephone-lien-tel', v, 'haute', None))
        for m in INTL_RX.finditer(ptext):
            v = m.group(0)
            d = re.sub(r'\D', '', v)
            if not 8 <= len(d) <= 15 or re.search(r'[ .\-]{2,}|\(\(|\)\)', v):
                continue
            groups = [g for g in re.split(r'[^\d]+', v) if g]
            if len(groups) > 1 and max(len(g) for g in groups[1:]) > 6:
                continue
            cands.append((m.start(), m.end(), 'telephone', 'telephone-international', v, 'haute', None))
        for m in FR_RX.finditer(ptext):
            v = m.group(0)
            if is_arithmetic_pairs(v):
                continue
            conf = 'haute' if m.group(1) else 'moyenne'
            cands.append((m.start(), m.end(), 'telephone', 'telephone-fr', v, conf, None))
        for m in NANP_RX.finditer(ptext):
            cands.append((m.start(), m.end(), 'telephone', 'telephone-amerique-nord', m.group(0), 'moyenne', None))

        # 5. emails (texte brut + version où &#64; %40 \u0040 sont décodés)
        for s0, e0, val in iter_emails(text):
            cands.append((s0, e0, 'email', 'email', val, 'haute', None))
        if ENCODED_AT_RX.search(text) or ('@' in text and URL_SEP_RX.search(text)):
            # mailto%3A…%40…, %3C…%3E, %20 : séparateurs encodés en URL remplacés par une espace
            dec = ENCODED_AT_RX.sub('@', text)
            dec = URL_SEP_RX.sub(' ', dec)
            dec = URL_CHAR_RX.sub(lambda mm: URL_CHARS[mm.group(0).upper()], dec)
            seen = {c[4].lower() for c in cands if c[2] == 'email'}
            dstarts = [0] + [mm.end() for mm in re.finditer('\n', dec)]
            for s0, _, val in iter_emails(dec):
                if val.lower() in seen:
                    continue
                seen.add(val.lower())
                ln = bisect.bisect_right(dstarts, s0)
                # position approchée : début de la ligne correspondante dans le texte brut
                st = starts[ln - 1] if ln - 1 < len(starts) else 0
                cands.append((st, st, 'email', 'email-encode', val, 'haute', "écrit avec un @ encodé"))

        # 6. chemins locaux qui révèlent un nom de session (C:\Users\<nom>, /Users/<nom>/)
        if re.search(r'(?i)users|utilisateurs|home/', text):
            for rx, conf in ((UPATH_RX, 'haute'), (UPATH_NIX_RX, 'moyenne')):
                for m in rx.finditer(text):
                    nom = m.group(2).strip()
                    if not nom or nom.lower() in UPATH_KEEP or nom.startswith(('$', '%', '<', '{')):
                        continue
                    if rx is UPATH_NIX_RX and not m.group(1).startswith('file:'):
                        before = text[max(0, m.start() - 1):m.start()]
                        if before and before not in ' "\'(=`\t\n>;,':
                            continue     # /Users/Edit/5 au milieu d'une URL : pas un chemin local
                        if re.search(r'(?i)(?:href|src|action|to|path|url|route)\s*[:=]\s*["\']?$',
                                     text[max(0, m.start() - 12):m.start()]):
                            continue     # href="/Users/Edit/5" : route d'une appli web
                    cands.append((m.start(), m.end(), 'chemin', 'chemin-utilisateur', m.group(0), conf,
                                  'nom de session « ' + nom + ' » : le remplacer (utilisateur, chemin relatif)'))

        # 6b. IPv4 publiques (option)
        if self.a.ip:
            for m in IPV4_RX.finditer(ptext):
                v = m.group(1)
                try:
                    ip = ipaddress.ip_address(v)
                except ValueError:
                    continue
                if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_multicast or ip.is_unspecified \
                        or ip.is_link_local:
                    continue
                before = text[max(0, m.start() - 12):m.start()].lower()
                if re.search(r'(?:version|ver|v|@)\s*[:=]?\s*["\']?$', before):
                    continue
                cands.append((m.start(1), m.end(1), 'ip', 'ipv4-publique', v, 'moyenne', None))

        # 7. valeurs interdites (--deny), sans casse ni accents
        if self.deny:
            if text.isascii():
                ftext, index = text.lower(), range(len(text))
            else:
                ftext, index = [], []
                for i, ch in enumerate(text):
                    f = fold(ch) if ord(ch) > 127 else ch.lower()
                    ftext.append(f)
                    index.extend([i] * len(f))
                ftext = ''.join(ftext)
            for orig, needle in self.deny:
                startpos = 0
                while True:
                    k = ftext.find(needle, startpos)
                    if k < 0:
                        break
                    startpos = k + 1
                    a0 = index[k]
                    a1 = index[min(k + len(needle) - 1, len(index) - 1)] + 1
                    if (a0 > 0 and text[a0 - 1].isalnum()) or (a1 < len(text) and text[a1].isalnum()):
                        continue
                    cands.append((a0, a1, 'refuse', 'valeur-interdite', text[a0:a1], 'haute', 'liste --deny : ' + orig))

        # résolution des chevauchements : priorité de catégorie, puis la plus longue
        cands.sort(key=lambda c: (PRIORITY[c[2]], -(c[1] - c[0]), c[0]))
        # zones sensibles du fichier : masquées dans tous les extraits de contexte
        self._spans = sorted((c[0], c[1]) for c in cands if c[2] in ('secret', 'carte', 'iban') and c[1] > c[0])
        taken = []
        for c in cands:
            s, e = c[0], c[1]
            if e > s and any(s < te and ts < e for ts, te in taken):
                continue
            taken.append((s, e))
            self.record(c, rel, text, pos)

    def cover(self, text, a, b):
        """text[a:b] avec les zones sensibles (secrets, cartes, IBAN) remplacées par des puces."""
        out, i = [], a
        for s, e in self._spans:
            if e <= a or s >= b:
                continue
            s2, e2 = max(s, a), min(e, b)
            if s2 > i:
                out.append(text[i:s2])
            if s2 >= i:
                out.append('••••')
            i = max(i, e2)
        out.append(text[i:b])
        return ''.join(out)

    def record(self, c, rel, text, pos):
        s, e, cat, typ, val, conf, detail = c
        reason = None
        if cat == 'email':
            reason = self.email_allowed(val)
        elif cat == 'telephone':
            reason = self.phone_allowed(val)
        elif cat == 'carte':
            d = re.sub(r'\D', '', val)
            reason = self.value_allowed(d) or (None if self.a.no_builtin_allow else
                                               ('carte de test publiée' if d in TEST_CARDS else None))
        elif cat == 'iban':
            c2 = re.sub(r'\s', '', val).upper()
            reason = self.value_allowed(c2) or (None if self.a.no_builtin_allow else
                                                ('IBAN d’exemple des documentations' if c2 in EXAMPLE_IBANS else None))
        elif cat in ('secret', 'ip', 'chemin'):
            reason = self.value_allowed(val)
        if cat in ('secret', 'carte', 'iban'):
            shown = mask_value(cat, val, typ)
        elif self.a.mask_all:
            shown = (val[:2] + '…' + val[-3:]) if len(val) > 6 else '…'
        else:
            shown = val
        if reason:
            key = (cat, shown if cat in ('secret', 'carte', 'iban') else val.lower(), reason)
            a = self.allowed.setdefault(key, {'categorie': cat, 'valeur': shown, 'raison': reason,
                                              'occurrences': 0, 'fichiers': []})
            a['occurrences'] += 1
            if rel not in a['fichiers'] and len(a['fichiers']) < 10:
                a['fichiers'].append(rel)
            return
        line, col = pos(s)
        lo, hi = max(0, s - 40), min(len(text), e + 40)
        ctx = scrub(self.cover(text, lo, s)) + shown + scrub(self.cover(text, e, hi))
        ctx = re.sub(r'\s+', ' ', ctx).strip()
        self.findings.append({'categorie': cat, 'type': typ, 'valeur': shown, 'fichier': rel, 'ligne': line,
                              'colonne': col, 'confiance': conf, 'detail': detail, 'contexte': ctx[:200]})

    def run(self):
        if not os.path.exists(self.root):
            die('dossier introuvable : ' + self.root)
        t0 = time.time()
        for path, rel in self.walk():
            text = self.read(path, rel)
            if text is None:
                continue
            self.files_scanned += 1
            self.bytes_scanned += len(text)
            self.scan_text(text, rel)
        seuil = self.a.seuil
        main, weak = [], []
        for f in self.findings:
            (main if seuil == 'moyenne' or f['confiance'] == 'haute' else weak).append(f)
        by_cat, by_type = {}, {}
        for f in main:
            by_cat[f['categorie']] = by_cat.get(f['categorie'], 0) + 1
            by_type[f['type']] = by_type.get(f['type'], 0) + 1
        by_value = {}
        for f in main:
            k = (f['categorie'], f['valeur'])
            v = by_value.setdefault(k, {'categorie': f['categorie'], 'valeur': f['valeur'], 'occurrences': 0,
                                        'fichiers': []})
            v['occurrences'] += 1
            if f['fichier'] not in v['fichiers'] and len(v['fichiers']) < 20:
                v['fichiers'].append(f['fichier'])
        allowed = sorted(self.allowed.values(), key=lambda a: (-a['occurrences'], a['valeur']))
        report = {
            'outil': 'scan_pii.py', 'version': VERSION, 'date': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'racine': self.root,
            'options': {'allow': sorted(set(self.a.allow or [])), 'allowDomain': [d for d in self.allow_domains],
                        'allowPhonePrefix': self.a.allow_phone_prefix or [], 'deny': len(self.deny),
                        'builtinAllow': not self.a.no_builtin_allow, 'ip': bool(self.a.ip), 'seuil': seuil},
            'resume': {'fichiersAnalyses': self.files_scanned, 'octets': self.bytes_scanned,
                       'fichiersIgnores': len(self.skipped), 'constats': len(main), 'valeursDistinctes': len(by_value),
                       'parCategorie': by_cat, 'parType': by_type, 'aVerifier': len(weak),
                       'autorises': sum(a['occurrences'] for a in allowed), 'duree_s': round(time.time() - t0, 2)},
            'parValeur': sorted(by_value.values(), key=lambda v: (PRIORITY[v['categorie']], -v['occurrences'])),
            'constats': main,
            'aVerifier': weak,
            'autorises': allowed,
            'fichiersIgnores': self.skipped,
        }
        report['resultat'] = 'TROUVE' if main else 'PROPRE'
        return report, bool(main)


LABELS = {'secret': 'Secrets / clés', 'refuse': 'Valeurs interdites (--deny)', 'iban': 'IBAN',
          'carte': 'Cartes bancaires', 'telephone': 'Téléphones', 'email': 'Emails',
          'chemin': 'Chemins locaux (nom de session)', 'ip': 'Adresses IP'}


def print_summary(rep, out_path, max_list):
    r = rep['resume']
    print('scan_pii.py ' + VERSION + ' — dossier : ' + rep['racine'])
    print('Fichiers analysés : %d (%d ignorés : binaires, trop gros, exclus)' % (r['fichiersAnalyses'], r['fichiersIgnores']))
    print('Autorisés (liste blanche, exemples, fiction) : %d occurrences' % r['autorises'])
    for a in rep['autorises'][:min(10, max_list)]:
        print('  = %s x%d — %s' % (a['valeur'], a['occurrences'], a['raison']))
    print('Constats : %d occurrences, %d valeurs distinctes' % (r['constats'], r['valeursDistinctes']))
    groups = {}
    for v in rep['parValeur']:
        groups.setdefault(v['categorie'], []).append(v)
    for cat in sorted(groups, key=lambda c: PRIORITY[c]):
        vals = groups[cat]
        print('  %s : %d valeur(s), %d occurrence(s)' % (LABELS[cat], len(vals), sum(v['occurrences'] for v in vals)))
        for v in vals[:max_list]:
            occ = [f for f in rep['constats'] if f['categorie'] == cat and f['valeur'] == v['valeur']][:3]
            where = ', '.join('%s:%d' % (f['fichier'], f['ligne']) for f in occ)
            more = (' (+%d)' % (v['occurrences'] - len(occ))) if v['occurrences'] > len(occ) else ''
            print('    - %s — %s%s' % (v['valeur'], where, more))
        if len(vals) > max_list:
            print('    … %d autres valeurs (voir le rapport JSON)' % (len(vals) - max_list))
    if r['aVerifier']:
        print('Sous le seuil (« aVerifier » du JSON, sans effet sur le code retour) : %d' % r['aVerifier'])
    if out_path:
        print('Rapport JSON : ' + out_path)
    print('Résultat : ' + rep['resultat'])


def main(argv=None):
    _setup_console()
    p = argparse.ArgumentParser(
        prog='scan_pii.py',
        description='Recherche emails, téléphones, IBAN, cartes, clés API et jetons dans un dossier (copieur-universel).',
        epilog='Exemple : py scan_pii.py --root "C:\\clones\\monappli" --allow "titulaire@sa-societe.fr" '
               '--allow-domain "exemple.*" --out rapport-pii.json')
    p.add_argument('--root', required=True, help='dossier (ou fichier) à analyser')
    p.add_argument('--allow', action='append', metavar='VALEUR',
                   help='valeur autorisée exacte (email, téléphone, IBAN…), répétable')
    p.add_argument('--allow-domain', action='append', metavar='MOTIF',
                   help='domaine d’email autorisé, sous-domaines compris ; motifs fnmatch acceptés (exemple.*), répétable')
    p.add_argument('--allow-phone-prefix', action='append', metavar='PREFIXE',
                   help='préfixe de téléphone fictif autorisé (ex. "+33 6 39 98"), répétable')
    p.add_argument('--allow-file', help='fichier : une valeur autorisée par ligne ; « @domaine » pour un domaine ; # commentaire')
    p.add_argument('--no-builtin-allow', action='store_true',
                   help='ne pas autoriser d’office les domaines d’exemple, plages de fiction, cartes de test, IBAN d’exemple')
    p.add_argument('--deny', action='append', metavar='VALEUR',
                   help='valeur réelle à ne jamais trouver (nom, email…), sans casse ni accents, répétable')
    p.add_argument('--deny-file', help='fichier : une valeur interdite par ligne')
    p.add_argument('--ip', action='store_true', help='chercher aussi les adresses IPv4 publiques')
    p.add_argument('--exclude', action='append', metavar='MOTIF',
                   help='motif fnmatch (chemin relatif ou nom) à ignorer, répétable ; toujours ignorés : '
                        + ', '.join(sorted(DEFAULT_EXCLUDED_DIRS)))
    p.add_argument('--max-size', type=float, default=10, help='taille max d’un fichier en Mo (défaut 10)')
    p.add_argument('--seuil', choices=['moyenne', 'haute'], default='moyenne',
                   help='confiance minimale qui compte dans le résultat et le code retour (défaut moyenne)')
    p.add_argument('--mask-all', action='store_true', help='masquer aussi emails et téléphones dans le rapport')
    p.add_argument('--out', help='fichier du rapport JSON (UTF-8)')
    p.add_argument('--json', action='store_true', help='écrire le rapport JSON sur la sortie standard au lieu du résumé')
    p.add_argument('--max-list', type=int, default=25, help='valeurs max par catégorie dans le résumé (défaut 25)')
    p.add_argument('--version', action='version', version='scan_pii.py ' + VERSION)
    a = p.parse_args(argv)

    sc = Scanner(a)
    report, found = sc.run()
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    if a.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_summary(report, os.path.abspath(a.out) if a.out else None, a.max_list)
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
