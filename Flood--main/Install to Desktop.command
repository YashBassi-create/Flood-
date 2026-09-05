#!/bin/bash
# ==============================================================================
#  🌊 PRAVAHA — Desktop & Dock Shortcut Installer
#  Creates shortcuts for PRAVAHA on your macOS Desktop and Applications
# ==============================================================================
set -e
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

echo "======================================================"
echo "   🌊  PRAVAHA Desktop & Dock Shortcut Installer"
echo "======================================================"
echo ""

APP_SRC="$PROJECT_DIR/PRAVAHA.app"
DESKTOP_DIR="$HOME/Desktop"
USER_APPS="$HOME/Applications"

# Ensure PRAVAHA.app exists or recompile
if [ ! -d "$APP_SRC" ]; then
  echo "⏳ Generating PRAVAHA.app native application bundle..."
  osacompile -e "
tell application \"Terminal\"
    activate
    do script \"exec \\\"$PROJECT_DIR/Start App.command\\\"\"
end tell" -o "$APP_SRC"
fi

# Ensure user Applications directory exists
mkdir -p "$USER_APPS"

# 1. Install to ~/Applications
echo "⏳ Installing PRAVAHA.app to $USER_APPS..."
rm -rf "$USER_APPS/PRAVAHA.app"
cp -R "$APP_SRC" "$USER_APPS/"
xattr -dr com.apple.quarantine "$USER_APPS/PRAVAHA.app" 2>/dev/null || true
echo "✔ Successfully installed to $USER_APPS/PRAVAHA.app"

# 2. Create Desktop Shortcut
echo "⏳ Creating Desktop shortcut on $DESKTOP_DIR..."
rm -rf "$DESKTOP_DIR/PRAVAHA.app"
cp -R "$APP_SRC" "$DESKTOP_DIR/"
xattr -dr com.apple.quarantine "$DESKTOP_DIR/PRAVAHA.app" 2>/dev/null || true
echo "✔ Created Desktop shortcut: $DESKTOP_DIR/PRAVAHA.app"

# 3. Create Desktop Shell Shortcut (.command) as alternative
DESKTOP_CMD="$DESKTOP_DIR/Launch PRAVAHA.command"
cat << 'EOF' > "$DESKTOP_CMD"
#!/bin/bash
cd "$(dirname "$0")"
if [ -d "$HOME/Downloads/Flood--main" ]; then
  exec "$HOME/Downloads/Flood--main/Start App.command"
elif [ -d "/Users/yashv/Downloads/Flood--main" ]; then
  exec "/Users/yashv/Downloads/Flood--main/Start App.command"
else
  echo "Could not find Flood--main directory."
  read -r _
fi
EOF
chmod +x "$DESKTOP_CMD"
echo "✔ Created executable launcher: $DESKTOP_CMD"

echo ""
echo "🎉 INSTALLATION COMPLETE!"
echo "------------------------------------------------------"
echo "You can now:"
echo "1. Double-click 'PRAVAHA.app' directly from your Desktop."
echo "2. Drag 'PRAVAHA.app' from your Desktop or ~/Applications into your macOS Dock for 1-click launch!"
echo "------------------------------------------------------"
echo ""
read -r -p "Press Enter to close this window..."
