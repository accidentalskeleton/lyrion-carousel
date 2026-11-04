# Public-release security checklist

Repository owner: `accidentalskeleton`

## Confirmed configuration (4 November 2026)

- The repository is **private** as of the initial review; keep it private until
  all checklist items are complete.
- An active repository ruleset called **Protect main** targets the default
  branch. It requires a pull request with resolved review conversations,
  blocks force pushes and blocks deletion.
- The ruleset has a repository-role **administrator bypass**, intentionally
  retained at the owner's request. As a result, the owner can bypass PR
  enforcement; ordinary contributors cannot.
- The PR ruleset currently has **zero required approvals**. The owner
  retains merge authority through repository permissions; GitHub will not
  count a review of the owner's own PR as an approval.

## Before changing visibility

- [x] Confirm Actions CI passes on a PR and on `main` for v0.11.0. Add the exact
      **JavaScript and Python regressions** job as a required check under
      **Protect main** (ruleset ID `23564317`; confirmed 4 November 2026).
      The strict update-to-date setting is enabled; administrator bypass retained.
- [ ] Set **Settings → Actions → General → Workflow permissions** to
      **Read repository contents and packages permissions**.
- [ ] Review fork pull-request workflow approval policies and avoid exposing
      secrets to pull-request CI. This workflow only asks for `contents: read`.
- [ ] In **Settings → Security / Advanced Security**, enable applicable
      Dependabot alerts, Dependabot security updates, secret scanning, push
      protection and private vulnerability reporting as available on the plan.
- [ ] Review access under **Settings → Collaborators** and remove unnecessary
      write/maintain/admin access.
- [x] Run Gitleaks against all fetched local branches and tags using
      `gitleaks detect --source . --log-opts="--all" --redact`:
      **544 commits scanned, no leaks found** on 4 November 2026.
      This is pattern-based detection, not proof every historical file and
      workflow log is free of private information. Review unusual historical
      material manually; rotate credentials if uncovered later.
- [ ] Review the deployment defaults: `BIND_ADDRESS=0.0.0.0` listens
      on all interfaces; **never port-forward 8088 to the internet**.
      Configure LAN firewall or localhost binding as appropriate.
- [x] Select **GPL-3.0-only** for original source code and add the official complete `LICENSE` text.
- [ ] Confirm copyright ownership/contributor rights and audit third-party assets before publishing. The repository licence does not grant rights to material you do not own.
- [x] Create a dependency and visual-asset attribution inventory in `THIRD_PARTY_NOTICES.md`.
- [x] Confirm creator of the README banner and MP4 feature tour: **Stuart Roberts** (owner-confirmed on 4 November 2026).
- [x] Confirm the feature-tour MP4 has **no audio soundtrack** (confirmed by its creator).
- [ ] **Manually review the underlying visual content in the banner and feature tour** for third-party commercial album covers and logos; replace or secure permissions for any uncleared material.
- [ ] Resolve [Spotify/Spotty content attribution, link-back and artwork presentation](https://github.com/accidentalskeleton/lyrion-carousel/issues/32) before public release.
      Current `js/app.js` does not preserve a verified Spotify album permalink,
      and Spotify covers are composited into jewel-case artwork. The precise
      applicability of Spotify's developer terms to Spotty-mediated playback
      must still be assessed.
- [ ] Check third-party artwork, fonts, image templates, sample screenshots
      and video assets for publication and redistribution rights.
- [ ] Verify local host names/URLs, documentation and tests contain no
      private information intended to remain confidential.
- [ ] Check that the repository's public README and issue templates do
      not publish sensitive operational details.
- [ ] **Do not interpret v0.11.0 being tagged/released as repository-publication
      clearance.** At this stage `main` and the release are still private.
- [ ] After completing the checks, change visibility manually in
      **Settings → General → Danger Zone → Change repository visibility**.

## Recommended contributor workflow

Create a feature branch → open a PR → review and discuss → pass CI →
maintainer merges. The owner has explicitly approved retaining an admin bypass.
