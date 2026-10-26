#!/bin/bash
# ==========================================================================================
#  lancer-app.command : ouvre le clone dans une fenetre d'application (Chrome --app), comme un logiciel.
#  Plugin copieur-universel, skill reconstruire-appli. Equivalent macOS de lancer-app.cmd (Windows).
#  A placer a la RACINE du clone, executable (chmod +x) : double-clic dans le Finder, ou dans un terminal :
#    ./lancer-app.command              ouvrir (demarre le serveur local si besoin)
#    ./lancer-app.command --verifier   afficher la configuration et l'etat, sans rien lancer
#    ./lancer-app.command --serveur    demarrer seulement le serveur local
#    ./lancer-app.command --arreter    arreter le serveur demarre par CE lanceur, s'il sert bien CE clone
#  Reglages : ci-dessous, ou variables d'environnement du meme nom (CU_PORT=8771 ./lancer-app.command).
#  Bash 3.2 (celui de macOS), fins de ligne LF ; commentaires sans accents, messages en UTF-8.
#  Le navigateur s'ouvre par « open -na » avec un profil DEDIE au clone : jamais le profil de l'utilisateur
#  (sans -n, les arguments partiraient au Chrome deja ouvert). Un lien symbolique pose sur le Bureau marche
#  aussi (ln -s ".../lancer-app.command" ~/Desktop/"Mon appli (clone).command") : le vrai dossier est retrouve.
# ==========================================================================================
set -u

# ---- Reglages : a adapter (chacun peut aussi venir d'une variable d'environnement du meme nom) ----
: "${CU_TITRE:=Mon appli (clone)}"
: "${CU_ID:=mon-appli}"
: "${CU_PORT:=8770}"
: "${CU_PAGE:=/ecrans/principal/}"
: "${CU_LARGEUR:=1280}"
: "${CU_HAUTEUR:=800}"
# Position facultative de la fenetre, ex. 100,60 (vide = choisie par macOS)
: "${CU_POSITION:=}"
# Profil de navigateur dedie au clone : fenetre independante, localStorage du clone conserve
: "${CU_PROFIL:=$HOME/Library/Application Support/copieur-universel/profils/$CU_ID}"
# Arguments supplementaires pour le navigateur (facultatif), ex. --remote-debugging-port=9230
: "${CU_NAV_EXTRA:=}"
# Navigateur impose : dossier .app ou executable (vide = recherche : Chrome, Edge, Chromium)
: "${CU_CHROME:=}"
: "${CU_EDGE:=}"
# CU_ESSAI=1 : affiche la commande d'ouverture sans l'executer ; CU_SANS_PAUSE=1 : pas de pause sur erreur
: "${CU_ESSAI:=}"
: "${CU_SANS_PAUSE:=}"
# ---------------------------------------------------------------------------------------------------

MODE=ouvrir
case "${1:-}" in
  --verifier) MODE=verifier ;;
  --serveur) MODE=serveur ;;
  --arreter) MODE=arreter ;;
  --aide|-h|--help) MODE=aide ;;
  "") ;;
  *) echo "Option inconnue : $1 (voir --aide)"; exit 2 ;;
esac

fin() {   # $1 = code de sortie ; pause sur erreur quand le lanceur a ete ouvert d'un double-clic
  if [ "$1" != 0 ] && [ "$MODE" = ouvrir ] && [ -z "$CU_SANS_PAUSE" ] && [ -t 0 ] && [ -t 1 ]; then
    printf 'Appuyer sur Entrée pour fermer… '; read -r _
  fi
  exit "$1"
}

if [ "$MODE" = aide ]; then
  echo "lancer-app.command              ouvre le clone dans une fenêtre d'application (démarre le serveur si besoin)"
  echo "lancer-app.command --verifier   affiche la configuration et l'état, sans rien lancer"
  echo "lancer-app.command --serveur    démarre seulement le serveur local (127.0.0.1:$CU_PORT)"
  echo "lancer-app.command --arreter    arrête le serveur démarré par ce lanceur, s'il sert bien ce clone"
  echo "Réglages en tête du fichier : CU_TITRE, CU_ID, CU_PORT, CU_PAGE, CU_LARGEUR, CU_HAUTEUR, CU_POSITION,"
  echo "CU_PROFIL, CU_NAV_EXTRA, CU_CHROME (ou CU_EDGE) ; aussi en variables d'environnement (CU_PORT=8771 ./lancer-app.command)."
  echo "CU_ESSAI=1 : affiche la commande d'ouverture sans l'exécuter."
  exit 0
fi

# ---- Reglages valides ? (CU_ID sert dans un chemin, CU_PORT dans les commandes) ----
case "$CU_PORT" in ''|*[!0-9]*) echo "[ERREUR] CU_PORT doit être un nombre : « $CU_PORT »."; fin 2 ;; esac
case "$CU_ID" in ''|.*|*/*) echo "[ERREUR] CU_ID doit être un nom simple, sans « / » : « $CU_ID »."; fin 2 ;; esac
case "$CU_LARGEUR:$CU_HAUTEUR" in :*|*:|*[!0-9:]*) echo "[ERREUR] CU_LARGEUR et CU_HAUTEUR sont des nombres de px."; fin 2 ;; esac

# ---- Racine du clone = dossier du VRAI fichier (liens symboliques suivis) ----
SELF="$0"
while [ -L "$SELF" ]; do
  CIBLE="$(readlink "$SELF")"
  case "$CIBLE" in /*) SELF="$CIBLE" ;; *) SELF="$(dirname "$SELF")/$CIBLE" ;; esac
done
RACINE="$(cd "$(dirname "$SELF")" && pwd -P)"

# CU_PAGE = chemin d'URL d'une page du clone, sans parametres : /ecrans/principal/ (la barre finale est
# ajoutee si elle manque, sinon http.server repond par une redirection 301) ou /ecrans/x/page.html
case "$CU_PAGE" in /*) ;; *) CU_PAGE="/$CU_PAGE" ;; esac
case "$CU_PAGE" in
  *.html|*.htm) PAGE_FICHIER="$CU_PAGE" ;;
  */) PAGE_FICHIER="${CU_PAGE}index.html" ;;
  *) CU_PAGE="$CU_PAGE/"; PAGE_FICHIER="${CU_PAGE}index.html" ;;
esac
URL="http://127.0.0.1:$CU_PORT$CU_PAGE"
FICHIER="$RACINE$PAGE_FICHIER"

# PID du serveur demarre par ce lanceur (hors du clone : rien de ce dossier n'est servi)
ETAT_DIR="$HOME/Library/Application Support/copieur-universel/serveurs"
PIDFILE="$ETAT_DIR/$CU_ID-$CU_PORT.pid"
JOURNAL="$ETAT_DIR/$CU_ID-$CU_PORT.log"

PY="$(command -v python3 2>/dev/null)"

# ---- Navigateur : CU_CHROME / CU_EDGE, puis Chrome, Edge, Chromium aux emplacements habituels, puis Spotlight ----
app_de() {   # dossier .app a partir d'un .app ou d'un executable qu'il contient
  case "$1" in
    *.app|*.app/) [ -d "$1" ] && echo "${1%/}" ;;
    *.app/*) [ -d "${1%%.app/*}.app" ] && echo "${1%%.app/*}.app" ;;
  esac
}
trouver_nav() {
  local v a id
  for v in "$CU_CHROME" "$CU_EDGE"; do
    [ -n "$v" ] || continue
    a="$(app_de "$v")"
    if [ -n "$a" ]; then echo "$a"; return 0; fi
  done
  for a in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app" "$HOME/Desktop/Google Chrome.app" \
           "/Applications/Microsoft Edge.app" "$HOME/Applications/Microsoft Edge.app" "$HOME/Desktop/Microsoft Edge.app" \
           "/Applications/Chromium.app" "$HOME/Applications/Chromium.app"; do
    if [ -d "$a" ]; then echo "$a"; return 0; fi
  done
  for id in com.google.Chrome com.microsoft.edgemac org.chromium.Chromium; do
    a="$(mdfind "kMDItemCFBundleIdentifier == '$id'" 2>/dev/null | grep -v '/\.Trash/' | head -n 1)"
    if [ -n "$a" ] && [ -d "$a" ]; then echo "$a"; return 0; fi
  done
  return 1
}

# ---- Etat : CODE = code HTTP de la page (000 = rien), PID_PORT = processus a l'ecoute sur le port ----
etat() {
  CODE="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$URL" 2>/dev/null)"
  case "$CODE" in [0-9][0-9][0-9]) ;; *) CODE=000 ;; esac
  PID_PORT="$(lsof -nP -iTCP:"$CU_PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1)"
}
# La page servie est-elle identique, octet pour octet, au fichier du clone ? (sinon : autre projet)
sert_ce_clone() {
  local t
  [ -f "$FICHIER" ] || return 1
  t="$(mktemp "${TMPDIR:-/tmp}/cu-verif.XXXXXX")" || return 1
  curl -s -m 3 -o "$t" "$URL" 2>/dev/null
  if cmp -s "$t" "$FICHIER"; then rm -f "$t"; return 0; fi
  rm -f "$t"; return 1
}
pid_note() { [ -f "$PIDFILE" ] && tr -dc '0-9' < "$PIDFILE"; }

# ---- --arreter : seulement le serveur Python demarre par ce lanceur, qui ecoute sur le port ET sert ce clone ----
if [ "$MODE" = arreter ]; then
  etat
  NOTE="$(pid_note)"
  if [ -z "$PID_PORT" ]; then
    [ -n "$NOTE" ] && ! kill -0 "$NOTE" 2>/dev/null && rm -f "$PIDFILE"
    echo "Aucun serveur n'écoute sur le port $CU_PORT."
    fin 0
  fi
  CMD="$(ps -ww -p "$PID_PORT" -o command= 2>/dev/null)"
  if [ "$NOTE" != "$PID_PORT" ]; then
    echo "[ERREUR] Le port $CU_PORT est tenu par le PID $PID_PORT, qui n'a pas été démarré par ce lanceur : rien n'est arrêté."
    echo "         Commande : ${CMD:-inconnue}"
    echo "         L'arrêter là où il a été lancé (un serveur lancé par un agent s'arrête par son propre PID)."
    fin 1
  fi
  case "$CMD" in
    *http.server*"$CU_PORT"*"--directory $RACINE"*) ;;
    *) echo "[ERREUR] Le PID $PID_PORT n'est pas le serveur http.server de ce clone : rien n'est arrêté."
       echo "         Commande : ${CMD:-inconnue}"
       fin 1 ;;
  esac
  if ! sert_ce_clone; then
    echo "[ERREUR] Le serveur du port $CU_PORT (PID $PID_PORT) ne sert pas ce clone : $URL ne renvoie pas"
    echo "         $FICHIER. Rien n'est arrêté (vérifier CU_PORT et CU_PAGE)."
    fin 1
  fi
  kill "$PID_PORT" 2>/dev/null || { echo "[ERREUR] Impossible d'arrêter le PID $PID_PORT."; fin 1; }
  i=0
  while kill -0 "$PID_PORT" 2>/dev/null && [ $i -lt 10 ]; do sleep 0.5; i=$((i + 1)); done
  if kill -0 "$PID_PORT" 2>/dev/null; then echo "[ERREUR] Le PID $PID_PORT tourne encore après l'arrêt demandé."; fin 1; fi
  rm -f "$PIDFILE"
  echo "Serveur arrêté (PID $PID_PORT)."
  fin 0
fi

NAV="$(trouver_nav)"
ARGS=(--app="$URL" --window-size="$CU_LARGEUR,$CU_HAUTEUR" --user-data-dir="$CU_PROFIL" --no-first-run --no-default-browser-check)
[ -n "$CU_POSITION" ] && ARGS+=(--window-position="$CU_POSITION")
if [ -n "$CU_NAV_EXTRA" ]; then set -f; ARGS+=($CU_NAV_EXTRA); set +f; fi

etat

# ---- --verifier : diagnostic sans effet ----
if [ "$MODE" = verifier ]; then
  if [ -f "$FICHIER" ]; then T_PAGE="présente"; else T_PAGE="ABSENTE"; fi
  T_NAV="${NAV:-INTROUVABLE (navigateur par défaut)}"
  [ -n "$CU_CHROME$CU_EDGE" ] && [ -z "$(app_de "${CU_CHROME:-$CU_EDGE}")" ] && T_NAV="$T_NAV ; CU_CHROME/CU_EDGE ignoré (introuvable)"
  T_SERV="arrêté"
  if [ "$CODE" = 200 ]; then
    if sert_ce_clone; then T_SERV="prêt, sert ce clone"; else T_SERV="RÉPOND MAIS NE SERT PAS CE CLONE (changer CU_PORT)"; fi
  elif [ "$CODE" != 000 ] || [ -n "$PID_PORT" ]; then T_SERV="PORT OCCUPÉ par un autre programme (changer CU_PORT)"
  fi
  T_PID="${PID_PORT:-aucun}"
  if [ -n "$PID_PORT" ]; then
    if [ "$(pid_note)" = "$PID_PORT" ]; then T_PID="$T_PID (démarré par ce lanceur)"; else T_PID="$T_PID (démarré ailleurs : --arreter n'y touchera pas)"; fi
  fi
  echo "Clone           : $RACINE"
  echo "Page            : $URL"
  echo "Fichier page    : $T_PAGE - $FICHIER"
  echo "Python          : ${PY:-INTROUVABLE (xcode-select --install, ou python.org)}"
  echo "Navigateur      : $T_NAV"
  echo "Profil dédié    : $CU_PROFIL"
  echo "Serveur         : HTTP $CODE ($T_SERV) ; PID à l'écoute : $T_PID"
  printf 'Commande        : open -na "%s" --args' "${NAV:-?}"; printf ' "%s"' "${ARGS[@]}"; echo
  echo "Taille          : ${CU_LARGEUR}x${CU_HAUTEUR} = taille EXTÉRIEURE (barre de titre comprise) : contrôler innerWidth x innerHeight"
  exit 0
fi

# ---- Serveur local : deja la (et il sert ce clone) ? sinon le demarrer ----
if [ "$CODE" = 200 ]; then
  if ! sert_ce_clone; then
    echo "[ERREUR] Le port $CU_PORT sert $CU_PAGE, mais pas la page de ce clone ($FICHIER)."
    echo "         Un autre clone ou un autre projet l'utilise : changer CU_PORT dans ce fichier."
    fin 1
  fi
else
  if [ "$CODE" != 000 ]; then
    echo "[ERREUR] Le port $CU_PORT répond (HTTP $CODE) mais pas avec la page $CU_PAGE."
    echo "         Un autre programme ou un autre clone l'utilise : changer CU_PORT dans ce fichier."
    fin 1
  fi
  if [ -n "$PID_PORT" ]; then echo "[ERREUR] Le port $CU_PORT est déjà occupé (PID $PID_PORT) : changer CU_PORT dans ce fichier."; fin 1; fi
  if [ -z "$PY" ]; then echo "[ERREUR] python3 introuvable (xcode-select --install, ou https://www.python.org/)."; fin 1; fi
  if [ ! -f "$FICHIER" ]; then
    echo "[ERREUR] Page introuvable : $FICHIER"
    echo "         Corriger CU_PAGE dans ce fichier (chemin de l'écran principal, ex. /ecrans/principal/)."
    fin 1
  fi
  echo "Démarrage du serveur local sur le port $CU_PORT..."
  mkdir -p "$ETAT_DIR"
  nohup "$PY" -m http.server "$CU_PORT" --bind 127.0.0.1 --directory "$RACINE" </dev/null >"$JOURNAL" 2>&1 &
  SPID=$!
  echo "$SPID" > "$PIDFILE"
  i=0
  while [ $i -lt 30 ]; do
    sleep 0.5; etat
    [ "$CODE" = 200 ] && break
    kill -0 "$SPID" 2>/dev/null || break
    i=$((i + 1))
  done
  if [ "$CODE" != 200 ] || ! sert_ce_clone; then
    echo "[ERREUR] Le serveur ne répond pas sur $URL (code $CODE). Journal : $JOURNAL"
    kill -0 "$SPID" 2>/dev/null && kill "$SPID" 2>/dev/null
    rm -f "$PIDFILE"
    fin 1
  fi
fi

if [ "$MODE" = serveur ]; then
  echo "Serveur prêt : $URL (PID ${PID_PORT:-?})"
  if [ "$(pid_note)" = "$PID_PORT" ]; then echo "Pour l'arrêter : ./lancer-app.command --arreter"
  else echo "Serveur démarré ailleurs : l'arrêter là où il a été lancé (--arreter n'y touchera pas)."; fi
  fin 0
fi

if [ -z "$NAV" ]; then
  echo "Chrome, Edge et Chromium introuvables : ouverture dans le navigateur par défaut."
  if [ -n "$CU_ESSAI" ]; then echo "open \"$URL\""; fin 0; fi
  open "$URL"
  fin $?
fi
echo "Ouverture de « $CU_TITRE » : $URL"
if [ -n "$CU_ESSAI" ]; then printf 'open -na "%s" --args' "$NAV"; printf ' "%s"' "${ARGS[@]}"; echo; fin 0; fi
mkdir -p "$CU_PROFIL"
open -na "$NAV" --args "${ARGS[@]}" || { echo "[ERREUR] Ouverture impossible avec $NAV."; fin 1; }
fin 0
