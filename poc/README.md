# GSAP jewel-case proof of concept

Open `poc/gsap-jewel-case.html` in a browser, or serve the repository locally and visit that path.

This is **isolated** from the production Carousel: it does not import app.js, contact LMS, change playback or alter the existing shelf. It uses CSS 3D for the jewel case and GSAP 3.12.5 for interruptible cover and case rotations. The CDN dependency is deliberate for the experiment only; production would need a locally vendored, licence-reviewed dependency and offline tests.

Evaluate opening/closing while in motion, flipping, hinge alignment, touch response, browser GPU load and reduced-motion support. Artwork and realistic rear inlay are placeholders, not inferred from an album. Do not merge this POC directly into the production UI.

Architecture recommendation: retain the current framework-free browser, LMS proxy and state model. If this prototype succeeds, extract a standalone jewel-case component with explicit `open()`, `close()`, `flip()`, and `destroy()` methods. Keep GSAP scoped to the component and leave shelf scrolling and playback orchestration unchanged.
