# Security policy

[← Project overview](README.md)

## Supported versions

Security fixes are considered for the latest code on `main`. Older releases
and third-party forks are not guaranteed support.

## Reporting a vulnerability

**Do not post exploitable details in a public GitHub issue, discussion or pull request.**

Use GitHub's private vulnerability reporting feature if it is enabled for this
repository: open the repository's **Security → Advisories → Report a vulnerability**
page. If private reporting is not enabled, contact the repository maintainer
privately through an established channel without publishing details. Do not
include credentials or private data in an initial public message.

Useful reports include affected version or commit, reproduction steps, impact
and suggested remediation. Please allow time for a response and coordinated
disclosure before publicising the issue.

## Deployment precautions

Lyrion Carousel is primarily designed for a trusted local network. Its
HTTP endpoints can control playback and alter appliance settings. It does not
provide general user authentication or TLS termination. **Do not expose port
8088 or LMS port 9000 directly to the public internet.** Restrict network
access to trusted clients (for example by host firewall/VPN) and keep the
service and its dependencies updated.

Never commit production secrets, local music databases, private configurations,
cache files or access tokens. Rotate any secret that has accidentally entered
Git history before making the repository public.
