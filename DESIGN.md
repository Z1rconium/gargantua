# DESIGN — GARGANTUA

World: a scientific instrument etched in light over void. The raytraced spacetime IS the page;
every UI element is thin telemetry floating at the edges, never a card, never a filled panel
except the one functional drawer that needs legibility over a moving starfield.

## Tokens
- `--void: #030405` — page ground (the shader owns most pixels).
- `--ink: #d6dae0` — primary text (≥ 4.5:1 on void).
- `--ink-dim: #9a948b` — secondary, tinted warm from the accent hue, never neutral gray.
- `--accent: #f2a45c` — accretion gold (disk blackbody ~4500 K); the only accent.
- `--accent-hot: #ffd9a0` — value emphasis / active states.
- `--hairline: rgba(242,164,92,.16)` — 1px rules and borders only.
- `--danger: #ff6a5e` — errors only.
- Radii: 0. Shadows: none (light on glass, not floating cards).
- Type: `ui-monospace/SF Mono` for every number and datum; `system-ui` for labels,
  9–11px tracked caps (native HUD grammar — deliberate, brief-pinned).
- Wordmark: system-ui, weight 200, letter-spacing .42em.

## Rules
- HUD containers are transparent; the parameter drawer alone gets `rgba(5,6,8,.74)` +
  `backdrop-blur` (functional: legibility over motion).
- Corner ticks (6px L-brackets) mark interactive regions; no full borders on hover targets.
- One authored motion: the boot sequence (overlay resolves into the render, telemetry types in).
  HUD transitions ≤ 180ms exponential-out; `prefers-reduced-motion` kills them.
- Monospace is measurement, not costume: labels are sans; only values/units/keys are mono.
- Nothing overlaps the black hole silhouette at boot on a 16:9 desktop viewport.
- Focus-visible: 1px accent outline, offset 2px. All controls keyboard-reachable.
