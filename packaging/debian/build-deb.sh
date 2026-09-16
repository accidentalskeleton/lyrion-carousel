#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
VERSION=${1:-0.8.2}
PACKAGE=hifi-album-browser-poc
STAGE="$PROJECT_DIR/.deb-build/${PACKAGE}_${VERSION}_all"
OUTPUT="$PROJECT_DIR/dist/${PACKAGE}_${VERSION}_all.deb"

case "$VERSION" in
    *[!0-9A-Za-z.+:~-]*|'')
        echo "Invalid Debian version: $VERSION" >&2
        exit 2
        ;;
esac

rm -rf -- "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$PROJECT_DIR/dist"

install -Dm0644 "$PROJECT_DIR/index.html" "$STAGE/opt/$PACKAGE/index.html"
install -Dm0755 "$PROJECT_DIR/server.py" "$STAGE/opt/$PACKAGE/server.py"
install -Dm0644 "$PROJECT_DIR/README.md" "$STAGE/usr/share/doc/$PACKAGE/README.md"
install -Dm0644 "$SCRIPT_DIR/hifi-album-browser-poc.service" "$STAGE/lib/systemd/system/hifi-album-browser-poc.service"
install -Dm0644 "$SCRIPT_DIR/hifi-album-browser-poc.default" "$STAGE/etc/default/hifi-album-browser-poc"

sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/control.in" > "$STAGE/DEBIAN/control"
install -m0755 "$SCRIPT_DIR/postinst" "$STAGE/DEBIAN/postinst"
install -m0755 "$SCRIPT_DIR/prerm" "$STAGE/DEBIAN/prerm"
install -m0755 "$SCRIPT_DIR/postrm" "$STAGE/DEBIAN/postrm"

dpkg-deb --build --root-owner-group "$STAGE" "$OUTPUT"
echo "Built $OUTPUT"
