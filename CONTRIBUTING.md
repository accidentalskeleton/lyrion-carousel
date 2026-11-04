# Contributing to Lyrion Carousel

Thank you for helping improve Lyrion Carousel.

## Submitting changes

1. Open an issue to discuss significant features or behaviour changes.
2. Fork the repository or create a feature branch. Never push directly to `main`.
3. Make a focused change and add regression coverage for affected behaviour.
4. Run the checks below and open a pull request against `main`.
5. Resolve reviewer feedback and all CI failures. The maintainer decides whether and when to merge.

```bash
node tests/regressions.mjs
python3 -m py_compile server.py tests/test_server.py
python3 -W always::ResourceWarning -m unittest discover -s tests -p 'test_*.py'
```

Python tests require Pillow (`python3-pil` on Debian or the `Pillow` Python package).
Node.js and Python 3 are required for the checks. Full hardware/LMS integration
and Debian-package deployment should also be exercised where relevant.

## Security and privacy

Do not commit access tokens, passwords, SSH keys, real private network details,
personal data, credentials, library contents or local cache snapshots. Use
sanitised examples. Report vulnerabilities privately using [SECURITY.md](SECURITY.md);
do not open public issues or pull requests containing exploit details.

Pull requests from forks do not need repository write access. CI for pull requests
has read-only repository permissions and must not access secrets.

## Style and scope

Keep the existing lightweight browser architecture and bounded caches.
Avoid adding new runtime dependencies without discussing the trade-offs.
Protect the permanent playing-case preview and manual-preview timeout behaviour.
Do not change `VERSION` for ordinary fixes or development work.
