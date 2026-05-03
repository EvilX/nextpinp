#!/usr/bin/env bash
set -euo pipefail

UUID="nextpinp@leonid.nasedkin"
ARCHIVE="$UUID.shell-extension.zip"
TMPDIR=$(mktemp -d)

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# Runtime JS and metadata
cp metadata.json extension.js prefs.js "$TMPDIR/"

# Compiled GSettings schema (only the binary, not the XML source)
mkdir -p "$TMPDIR/schemas"
cp schemas/*.xml "$TMPDIR/schemas/"
glib-compile-schemas "$TMPDIR/schemas/"
rm "$TMPDIR/schemas/"*.xml

# Compiled translations (only .mo, not .po sources)
for po_file in po/*.po; do
    lang=$(basename "$po_file" .po)
    mkdir -p "$TMPDIR/locale/$lang/LC_MESSAGES"
    msgfmt "$po_file" -o "$TMPDIR/locale/$lang/LC_MESSAGES/$UUID.mo"
done

# Create the zip from inside the temp dir so there is no top-level subfolder
(cd "$TMPDIR" && zip -r "$OLDPWD/$ARCHIVE" .)

echo "Created: $ARCHIVE"
echo ""
echo "Contents:"
unzip -l "$ARCHIVE"
