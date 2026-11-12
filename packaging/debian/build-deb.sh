#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
CANONICAL_VERSION=$(tr -d '[:space:]' < "$PROJECT_DIR/VERSION")
VERSION=${1:-$CANONICAL_VERSION}
PACKAGE=lyrion-carousel
STAGE="$PROJECT_DIR/.deb-build/${PACKAGE}_${VERSION}_all"
OUTPUT="$PROJECT_DIR/dist/${PACKAGE}_${VERSION}_all.deb"

case "$VERSION" in
    *[!0-9A-Za-z.+:~-]*|'') echo "Invalid Debian version: $VERSION" >&2; exit 2 ;;
esac

rm -rf -- "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$PROJECT_DIR/dist"
install -Dm0644 "$PROJECT_DIR/index.html" "$STAGE/opt/$PACKAGE/index.html"
install -Dm0644 "$PROJECT_DIR/spotty-diagnostic.html" "$STAGE/opt/$PACKAGE/spotty-diagnostic.html"
install -Dm0644 "$PROJECT_DIR/VERSION" "$STAGE/opt/$PACKAGE/VERSION"
install -Dm0644 "$PROJECT_DIR/manifest.webmanifest" "$STAGE/opt/$PACKAGE/manifest.webmanifest"
install -Dm0755 "$PROJECT_DIR/server.py" "$STAGE/opt/$PACKAGE/server.py"
install -Dm0644 "$PROJECT_DIR/indexed_order.py" "$STAGE/opt/$PACKAGE/indexed_order.py"
install -Dm0644 "$PROJECT_DIR/metadata_db.py" "$STAGE/opt/$PACKAGE/metadata_db.py"
install -Dm0644 "$PROJECT_DIR/README.md" "$STAGE/usr/share/doc/$PACKAGE/README.md"
install -Dm0644 "$PROJECT_DIR/LICENSE" "$STAGE/usr/share/doc/$PACKAGE/LICENSE"
install -Dm0644 "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$STAGE/usr/share/doc/$PACKAGE/THIRD_PARTY_NOTICES.md"
cp -a "$PROJECT_DIR/assets" "$PROJECT_DIR/css" "$PROJECT_DIR/js" "$STAGE/opt/$PACKAGE/"
install -Dm0644 "$SCRIPT_DIR/lyrion-carousel.service" "$STAGE/lib/systemd/system/lyrion-carousel.service"
install -Dm0644 "$SCRIPT_DIR/lyrion-carousel.default" "$STAGE/etc/default/lyrion-carousel"
sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/control.in" > "$STAGE/DEBIAN/control"
install -m0755 "$SCRIPT_DIR/postinst" "$STAGE/DEBIAN/postinst"
install -m0755 "$SCRIPT_DIR/prerm" "$STAGE/DEBIAN/prerm"
install -m0755 "$SCRIPT_DIR/postrm" "$STAGE/DEBIAN/postrm"
dpkg-deb --build --root-owner-group "$STAGE" "$OUTPUT"
echo "Built $OUTPUT"
