// GARGANTUA — persistence (localStorage) and the URL automation interface.

import { STORAGE_KEY } from './config.js';

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) — run stateless */
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/* URL query interface, all optional:
   ?w=1920&h=1080      fixed drawing-buffer size (deterministic output)
   ?t=12.5             freeze simulation time at t seconds
   ?preset=1..4        camera preset
   ?q=standard|high|cinematic
   ?debug=0..9         debug view
   ?cine=0|1           cinematic loop on/off
   ?music=0|1          ambient audio on/off
   ?hud=0              hide HUD
   ?shot=1             render, auto-download a PNG, set window.__GARGANTUA_SHOT_DONE */
export function parseQuery() {
  const q = new URLSearchParams(location.search);
  const num = (k) => (q.has(k) ? parseFloat(q.get(k)) : null);
  const int = (k) => (q.has(k) ? parseInt(q.get(k), 10) : null);
  const bool = (k) => (q.has(k) ? q.get(k) !== '0' : null);
  return {
    w: int('w'), h: int('h'),
    t: num('t'),
    preset: int('preset'),
    quality: q.get('q'),
    debug: int('debug'),
    cine: bool('cine'),
    music: bool('music'),
    hud: bool('hud'),
    shot: bool('shot'),
    probe: bool('probe'),
  };
}
