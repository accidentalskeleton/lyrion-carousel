#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
short=$(git rev-parse --short=10 HEAD)
base=$(tr -d '[:space:]' < VERSION)
package_version="${base}~git${short}"
./packaging/debian/build-deb.sh
if git tag --points-at HEAD | grep -Eq "^v?${base}$"; then package_version=$base; fi
deb="dist/lyrion-carousel_${package_version}_all.deb"
test -s "$deb"
test "$(dpkg-deb -f "$deb" Version)" = "$package_version"
test "$(dpkg-deb -f "$deb" Package)" = lyrion-carousel
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
dpkg-deb -x "$deb" "$stage"
app="$stage/opt/lyrion-carousel"
test "$(cat "$app/VERSION")" = "$package_version"
python3 - "$app" "$package_version" "$(git rev-parse HEAD)" "$short" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);version,commit,short=sys.argv[2:]
data=json.loads((root/'BUILD_INFO.json').read_text())
assert data['version']==version and data['commit']==commit,data
html=(root/'index.html').read_text()
assert 'js/app.js?build='+short in html,html[-500:]
assert 'js/settings.js?build='+short in html,html[-500:]
assert 'css/album-browser.css?build='+short in html
app=(root/'js/app.js').read_text()
assert 'CAROUSEL_BROWSER_BUILD=\''+version+'\'' in app
assert 'fast-navigation.js?build='+short in app
assert '__CAROUSEL_BROWSER_BUILD_VERSION__' not in app
settings=(root/'js/settings.js').read_text()
assert 'lms.js?build='+short in settings
print('Verified package, server manifest, loaded-browser stamp and fingerprinted assets:',version)
PY
