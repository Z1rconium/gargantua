# PRODUCT — GARGANTUA

Schwarzschild black-hole raytracer that runs entirely in a fullscreen WebGL2 fragment shader.
No build step; static-server only; vanilla ES modules + vendored Three.js.

## Truth
- The image is produced by numerically integrating null geodesics (Binet form, RK4) per pixel.
  Nothing is faked: no meshes, no textures, no video. This is the product's unique mechanism.
- Physics rendered: event horizon (r_s = 1), photon ring (r = 1.5 r_s), gravitational lensing,
  multiple thin-disk plane crossings, Doppler beaming, gravitational + kinematic redshift,
  Keplerian differential rotation with procedural turbulence, procedural starfield + Milky Way.
- Film pipeline: HDR half-float targets → threshold bloom pyramid → ACES → vignette,
  grain, slight chromatic dispersion.

## Audience & scene
Graphics programmers, physics students, film/VFX-curious visitors. Desktop first, dark room,
fullscreen; must also survive a phone in one hand. Mode: **Experience** — the artifact leads,
the interface recedes to instrument telemetry.

## Surface contract (from the brief — all pinned)
- Cinematic auto-orbit loop + OrbitControls + 4 view presets.
- HUD with live telemetry; exactly 21 tunable parameters; debug views on keys 0–9; hotkeys.
- Optional ambient audio (local asset, off by default, gesture-safe).
- Quality tiers Standard / High / Cinematic; Retina aware; mobile OK.
- State persisted to localStorage; URL query API for automated screenshots.
- WebGL context-loss recovery and styled fatal-error card. Zero console errors.

## Labeled assumptions (brief did not specify)
- Units: r_s = 1; camera distances quoted in r_s.
- Accent drawn from the disk's own blackbody gold; audio is a synthesized seamless drone (48 s loop).
- English HUD copy (scientific-instrument register); README bilingual where useful.
