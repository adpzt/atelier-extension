#!/bin/bash
# Installe Atelier sur ce Mac avec mise à jour automatique depuis GitHub.
#  - copie de l'extension dans ~/Library/Application Support/Atelier/extension
#  - tâche de fond (LaunchAgent) qui récupère la dernière version toutes les 15 min
# L'extension se recharge ensuite toute seule quand une nouvelle version arrive.
set -euo pipefail

REPO_URL="${ATELIER_REPO:-https://github.com/adpzt/atelier-extension.git}"
BASE="$HOME/Library/Application Support/Atelier"
EXT="$BASE/extension"
LABEL="com.atelier.updater"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1; then
  echo "❌ git est nécessaire. Lance : xcode-select --install, puis relance ce script."
  exit 1
fi

mkdir -p "$BASE" "$HOME/Library/LaunchAgents"

echo "→ Téléchargement de l'extension…"
if [ -d "$EXT/.git" ]; then
  git -C "$EXT" fetch --depth 1 --quiet origin release
  git -C "$EXT" reset --hard --quiet origin/release
else
  rm -rf "$EXT"
  git clone --quiet --depth 1 --branch release --single-branch "$REPO_URL" "$EXT"
fi

cat > "$BASE/update.sh" <<'EOS'
#!/bin/bash
# Récupère la dernière version publiée (appelé par launchd toutes les 15 min).
EXT="$HOME/Library/Application Support/Atelier/extension"
cd "$EXT" || exit 1
git fetch --depth 1 --quiet origin release || exit 0
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/release)" ]; then
  git reset --hard --quiet origin/release && git clean -fdq
  echo "$(date '+%Y-%m-%d %H:%M') mise à jour : $(grep '"version"' manifest.json | tr -d ' ,')"
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

VERSION=$(grep '"version"' "$EXT/manifest.json" | tr -d ' ",' | cut -d: -f2)
printf '%s' "$EXT" | pbcopy
cat <<EOM

✅ Atelier v$VERSION installé, mises à jour automatiques activées.

Dernière étape (une seule fois) dans Chrome :
  1. Ouvre chrome://extensions et active le « Mode développeur » (en haut à droite)
  2. Clique « Charger l'extension non empaquetée »
  3. Dans la fenêtre, fais ⌘⇧G, colle (⌘V) le chemin ci-dessous, puis Entrée et « Sélectionner » :
     $EXT
     (le chemin est déjà copié dans ton presse-papier)

Laisse le Mode développeur activé : c'est ce qui permet les mises à jour automatiques.
Forcer une mise à jour tout de suite : bash "$BASE/update.sh"
Désinstaller : bash "$BASE/uninstall.sh"
EOM

cat > "$BASE/uninstall.sh" <<EOU
#!/bin/bash
launchctl bootout "gui/\$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$BASE"
echo "Atelier désinstallé. Pense à retirer l'extension dans chrome://extensions."
EOU
chmod +x "$BASE/uninstall.sh"
