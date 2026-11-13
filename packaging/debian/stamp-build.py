#!/usr/bin/env python3
"""Stamp the staged Debian app with its exact Git SHA and cache-bust JS/CSS.

The tracked source tree is never modified, so the SHA always identifies
the actual build commit. A clean checkout is required by build-deb.sh.
"""
import json
import re
import sys
from pathlib import Path


def rewrite_local_assets(text: str, commit: str) -> str:
    """Use a unique query per build for HTML assets and JS module imports."""
    text = re.sub(
        r"""((?:src|href)=["\'](?:js|css)/[^"\']+?\.(?:js|css))(?:\?[^"\']*)?""",
        lambda m: m.group(1) + "?build=" + commit, text,
    )
    text = re.sub(
        r"""((?:from\s*|import\s*)["\']\.{1,2}/[^"\']+?\.js)(?:\?[^"\']*)?""",
        lambda m: m.group(1) + "?build=" + commit, text,
    )
    return text


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("usage: stamp-build.py STAGED_APP VERSION COMMIT BASE_VERSION")
    root = Path(sys.argv[1])
    version, commit, base = sys.argv[2:]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("A full 40-character Git SHA is required")
    short = commit[:10]
    (root / "VERSION").write_text(version + "\n", encoding="utf-8")
    (root / "BUILD_INFO.json").write_text(
        json.dumps({"version": version, "commit": commit, "base_version": base}, indent=2) + "\n",
        encoding="utf-8",
    )
    app = root / "js/app.js"
    content = app.read_text(encoding="utf-8")
    marker = "__CAROUSEL_BROWSER_BUILD_VERSION__"
    if content.count(marker) != 1:
        raise SystemExit("Expected exactly one browser-build marker in js/app.js")
    app.write_text(content.replace(marker, version), encoding="utf-8")
    for path in [root / "index.html", *sorted((root / "js").rglob("*.js"))]:
        content = path.read_text(encoding="utf-8")
        stamped = rewrite_local_assets(content, short)
        if stamped != content:
            path.write_text(stamped, encoding="utf-8")


if __name__ == "__main__":
    main()
