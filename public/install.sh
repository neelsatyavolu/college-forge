#!/bin/sh
# Installs the collegeforge command-line tool:
#   curl -fsSL https://forge.xanom.co/install.sh | sh
# Puts `collegeforge` in ~/.local/bin (or $COLLEGEFORGE_BIN_DIR). Needs Node.js 20 or newer.
set -eu

BASE_URL="${COLLEGEFORGE_URL:-https://forge.xanom.co}"
BIN_DIR="${COLLEGEFORGE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/collegeforge"

if ! command -v node >/dev/null 2>&1; then
  echo "collegeforge needs Node.js 20 or newer. Install it from https://nodejs.org and run this again." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "collegeforge needs Node.js 20 or newer; this computer has $(node --version)." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
TMP="$(mktemp "$BIN_DIR/.collegeforge.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$BASE_URL/cli/collegeforge.mjs" -o "$TMP"
head -n 1 "$TMP" | grep -q '^#!/usr/bin/env node' || { echo "Download from $BASE_URL didn't look like the collegeforge tool." >&2; exit 1; }
chmod 755 "$TMP"
mv "$TMP" "$TARGET"
trap - EXIT

echo "Installed collegeforge $("$TARGET" --version) to $TARGET"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to your PATH, e.g.: echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc" ;;
esac
echo "Next: collegeforge login"
