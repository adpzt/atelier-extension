#!/bin/bash
# Installe Kotak sur ce Mac, avec mises à jour automatiques depuis GitHub.
#  - l'extension (dossier à charger dans Chrome / Brave) : ~/Extension Kotak
#    (ou le dossier passé en argument — pas sur un disque externe, macOS y bloque les mises à jour)
#  - le moteur Médias : yt-dlp + ffmpeg (open source) dans ~/Library/Application Support/Kotak
#  - une tâche de fond (LaunchAgent) qui récupère les nouvelles versions toutes les 15 min
# Désinstallation : bash ~/Library/Application\ Support/Kotak/uninstall.sh
set -euo pipefail

REPO_URL="${KOTAK_REPO:-https://github.com/adpzt/kotak.git}"
EXT="${1:-${KOTAK_DIR:-$HOME/Extension Kotak}}"
BASE="$HOME/Library/Application Support/Kotak"
BIN="$BASE/bin"
LABEL="com.kotak.updater"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# Identifiant fixe de l'extension (clé publique du manifeste) : seul Kotak peut lancer le moteur.
EXT_ID="pgimopnhknnafkfghffffkjckckedngg"

if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1; then
  echo "❌ git est nécessaire. Lance : xcode-select --install, puis relance ce script."
  exit 1
fi
if ! /usr/bin/python3 -c 'import sys' >/dev/null 2>&1; then
  echo "❌ Python 3 (outils de ligne de commande Apple) est nécessaire. Lance : xcode-select --install"
  exit 1
fi

# ---------- Ancienne version « Atelier » ----------
if [ -f "$HOME/Library/LaunchAgents/com.atelier.updater.plist" ]; then
  echo "→ Retrait de l'ancienne version (Atelier)…"
  launchctl bootout "gui/$(id -u)/com.atelier.updater" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.atelier.updater.plist"
  rm -rf "$HOME/Library/Application Support/Atelier" "$HOME/Extension Atelier"
fi

mkdir -p "$BASE" "$BIN" "$HOME/Library/LaunchAgents" "$(dirname "$EXT")"

# ---------- Extension ----------
echo "→ Téléchargement de l'extension dans : $EXT"
if [ -d "$EXT/.git" ]; then
  git -C "$EXT" remote set-url origin "$REPO_URL"
  git -C "$EXT" fetch --depth 1 --quiet origin release
  git -C "$EXT" reset --hard --quiet origin/release
else
  rm -rf "$EXT"
  git clone --quiet --depth 1 --branch release --single-branch "$REPO_URL" "$EXT"
fi

# ---------- Moteur Médias : yt-dlp + ffmpeg ----------
# yt-dlp en version « dossier » : décompressée une seule fois ici (la version « fichier unique »
# se décompresse à chaque lancement, ce que macOS bloque quand c'est le navigateur qui la lance).
install_ytdlp() {
  echo "→ Téléchargement de yt-dlp…"
  local tmp
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/yt-dlp.zip" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip"
  rm -rf "$BIN/yt-dlp-dist"
  mkdir -p "$BIN/yt-dlp-dist"
  unzip -q "$tmp/yt-dlp.zip" -d "$BIN/yt-dlp-dist"
  chmod +x "$BIN/yt-dlp-dist/yt-dlp_macos"
  rm -rf "$tmp"
  cat > "$BIN/yt-dlp" <<'EOW'
#!/bin/bash
exec "$(dirname "$0")/yt-dlp-dist/yt-dlp_macos" "$@"
EOW
  chmod +x "$BIN/yt-dlp"
}
[ -x "$BIN/yt-dlp-dist/yt-dlp_macos" ] || install_ytdlp

ARCH=$(uname -m)
FFARCH=$([ "$ARCH" = "x86_64" ] && echo "x64" || echo "arm64")
FFREL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"
for tool in ffmpeg ffprobe; do
  if [ ! -x "$BIN/$tool" ]; then
    echo "→ Téléchargement de ${tool}…"
    curl -fsSL "$FFREL/$tool-darwin-$FFARCH.gz" | gunzip > "$BIN/$tool"
    chmod +x "$BIN/$tool"
  fi
done

# Lanceur du moteur (le script Python est livré avec l'extension et se met à jour avec elle).
HOST="$BASE/kotak-engine"
cat > "$HOST" <<EOH
#!/bin/bash
exec /usr/bin/python3 "$EXT/host/kotak_host.py" "\$@"
EOH
chmod +x "$HOST"

# Déclaration auprès des navigateurs (Native Messaging) : uniquement pour l'extension Kotak.
ORIGINS="\"chrome-extension://$EXT_ID/\""
for id in ${KOTAK_EXTRA_IDS:-}; do ORIGINS="$ORIGINS, \"chrome-extension://$id/\""; done
MANIFEST="{
  \"name\": \"com.kotak.engine\",
  \"description\": \"Moteur local Kotak (yt-dlp + ffmpeg)\",
  \"path\": \"$HOST\",
  \"type\": \"stdio\",
  \"allowed_origins\": [$ORIGINS]
}"
for dir in "Google/Chrome" "BraveSoftware/Brave-Browser" "Chromium" "Microsoft Edge" "Vivaldi" "Arc/User Data"; do
  if [ -d "$HOME/Library/Application Support/$dir" ]; then
    mkdir -p "$HOME/Library/Application Support/$dir/NativeMessagingHosts"
    printf '%s\n' "$MANIFEST" > "$HOME/Library/Application Support/$dir/NativeMessagingHosts/com.kotak.engine.json"
  fi
done

# ---------- Mises à jour automatiques ----------
cat > "$BASE/update.sh" <<EOS
#!/bin/bash
# Appelé par launchd toutes les 15 min : nouvelle version de Kotak, et de yt-dlp une fois par jour.
EXT="$EXT"
BIN="$BIN"
if cd "\$EXT" 2>/dev/null && git fetch --depth 1 --quiet origin release; then
  if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/release)" ]; then
    git reset --hard --quiet origin/release && git clean -fdq
    echo "\$(date '+%Y-%m-%d %H:%M') Kotak : \$(grep '"version"' manifest.json | tr -d ' ,')"
  fi
fi
# yt-dlp suit les changements des sites : vérification quotidienne de la dernière version.
STAMP="$BASE/.ytdlp-check"
if [ -z "\$(find "\$STAMP" -mtime -1 2>/dev/null)" ]; then
  touch "\$STAMP"
  LATEST=\$(curl -fsSL https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
  CURRENT=\$("\$BIN/yt-dlp" --version 2>/dev/null)
  if [ -n "\$LATEST" ] && [ "\$LATEST" != "\$CURRENT" ]; then
    TMP=\$(mktemp -d)
    if curl -fsSL -o "\$TMP/y.zip" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip" && unzip -q "\$TMP/y.zip" -d "\$TMP/d"; then
      rm -rf "\$BIN/yt-dlp-dist" && mv "\$TMP/d" "\$BIN/yt-dlp-dist" && chmod +x "\$BIN/yt-dlp-dist/yt-dlp_macos"
      echo "\$(date '+%Y-%m-%d %H:%M') yt-dlp : \$CURRENT → \$LATEST"
    fi
    rm -rf "\$TMP"
  fi
fi
EOS
chmod +x "$BASE/update.sh"

cat > "$PLIST" <<EOP
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$BASE/update.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$BASE/update.log</string>
  <key>StandardErrorPath</key><string>$BASE/update.log</string>
</dict>
</plist>
EOP
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

cat > "$BASE/uninstall.sh" <<EOU
#!/bin/bash
launchctl bootout "gui/\$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
find "\$HOME/Library/Application Support" -maxdepth 4 -name com.kotak.engine.json -path '*NativeMessagingHosts*' -delete 2>/dev/null
rm -rf "$EXT" "$BASE"
echo "Kotak désinstallé. Retire aussi l'extension dans chrome://extensions (ou brave://extensions)."
EOU
chmod +x "$BASE/uninstall.sh"

VERSION=$(grep '"version"' "$EXT/manifest.json" | tr -d ' ",' | cut -d: -f2)
printf '%s' "$EXT" | pbcopy
cat <<EOM

✅ Kotak v$VERSION installé, mises à jour automatiques activées.
   Moteur Médias : yt-dlp $("$BIN/yt-dlp" --version) · ffmpeg $("$BIN/ffmpeg" -hide_banner -version | head -1 | cut -d' ' -f3)

Dernière étape (une seule fois) dans Chrome ou Brave :
  1. Ouvre chrome://extensions (ou brave://extensions) et active le « Mode développeur »
  2. Clique « Charger l'extension non empaquetée »
  3. Choisis ce dossier (⌘⇧G puis colle le chemin, déjà copié dans ton presse-papier) :
     $EXT

Laisse le Mode développeur activé : c'est ce qui permet les mises à jour automatiques.
Forcer une mise à jour : bash "$BASE/update.sh"
Désinstaller : bash "$BASE/uninstall.sh"
EOM
