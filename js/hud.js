// GARGANTUA — HUD: telemetry, presets, quality, toggles and the 21-parameter drawer.
// Pure DOM, no framework. All actions round-trip through callbacks supplied by main.js.

import { PARAM_SCHEMA, PARAM_COUNT, PRESETS, QUALITY, QUALITY_ORDER, DEBUG_NAMES } from './config.js';

export class HUD {
  /* cb: { onParam(key, value), onParamReset(key), onPreset(i), onQuality(q),
           onCine(), onAudio(), onShot(), onReset() } */
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.els = {};
    this.sliders = {};
    this.svals = {};
    this._toastTimer = null;
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-corner hud-tl">
        <div class="mark">GARGANTUA</div>
        <div class="mark-sub">Schwarzschild Null-Geodesic Raytracer</div>
      </div>
      <div class="hud-corner hud-tr">
        <div class="tele">
          <span class="label">FPS</span><span class="value" data-t="fps">—</span>
          <span class="label">Frame</span><span class="value" data-t="ms">—</span>
          <span class="label">Render</span><span class="value" data-t="res">—</span>
          <span class="label row-xtra">Steps</span><span class="value row-xtra" data-t="steps">—</span>
          <span class="label row-xtra">r cam</span><span class="value row-xtra" data-t="rcam">—</span>
          <span class="label row-xtra">Dilation</span><span class="value row-xtra" data-t="dil">—</span>
          <span class="label">Mode</span><span class="value" data-t="mode">—</span>
        </div>
      </div>
      <div class="debug-chip" data-t="chip"></div>
      <div class="hud-corner hud-bl">
        <div class="panel closed ticked" data-t="panel"></div>
        <button class="btn drawer-toggle ticked" data-t="drawer" type="button">
          Parameters <span class="value">${PARAM_COUNT}</span>
        </button>
      </div>
      <div class="hud-corner hud-br">
        <div class="btn-row" data-t="presets"></div>
        <div class="btn-row" data-t="quality"></div>
        <div class="btn-row">
          <button class="btn" data-t="cine" type="button" title="Cinematic orbit (Space)">Cine</button>
          <button class="btn" data-t="audio" type="button" title="Ambient audio (M)">Audio</button>
          <button class="btn" data-t="shot" type="button" title="Save PNG (S)">Shot</button>
          <button class="btn" data-t="reset" type="button" title="Reset everything (R,R)">Reset</button>
        </div>
      </div>
      <div class="hud-bc">
        <div class="toast" data-t="toast"></div>
        <div class="hints">
          <span class="k">drag</span> orbit
          <span class="k">wheel</span> dolly
          <span class="k">⇧1–4</span> views
          <span class="k">0–9</span> debug
          <span class="k">space</span> cine
          <span class="k">h</span> hud
          <span class="k">m</span> audio
          <span class="k">s</span> shot
          <span class="k">q</span> quality
          <span class="k">f</span> fullscreen
        </div>
      </div>`;

    this.root.querySelectorAll('[data-t]').forEach((el) => { this.els[el.dataset.t] = el; });

    /* presets */
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = p.name;
      b.title = `Camera preset (Shift+${i + 1})`;
      b.addEventListener('click', () => { b.blur(); this.cb.onPreset(i); });
      this.els.presets.appendChild(b);
    });

    /* quality */
    QUALITY_ORDER.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.dataset.q = q;
      b.textContent = QUALITY[q].label;
      b.title = `${q} quality (Q cycles)`;
      b.addEventListener('click', () => { b.blur(); this.cb.onQuality(q); });
      this.els.quality.appendChild(b);
    });

    /* toggles */
    this.els.drawer.addEventListener('click', () => { this.els.drawer.blur(); this.togglePanel(); });
    this.els.cine.addEventListener('click', () => { this.els.cine.blur(); this.cb.onCine(); });
    this.els.audio.addEventListener('click', () => { this.els.audio.blur(); this.cb.onAudio(); });
    this.els.shot.addEventListener('click', () => { this.els.shot.blur(); this.cb.onShot(); });
    this.els.reset.addEventListener('click', () => { this.els.reset.blur(); this.cb.onReset(); });

    this._buildPanel();
  }

  _buildPanel() {
    const groups = new Map();
    for (const s of PARAM_SCHEMA) {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    }
    for (const [name, items] of groups) {
      const g = document.createElement('div');
      g.className = 'pgroup';
      const t = document.createElement('div');
      t.className = 'pgroup-title';
      t.innerHTML = `<span>${name}</span><span class="count">${items.length}</span>`;
      g.appendChild(t);
      for (const s of items) {
        const row = document.createElement('div');
        row.className = 'prow';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = s.label;
        label.title = 'Double-click to reset';
        const val = document.createElement('span');
        val.className = 'value';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.setAttribute('aria-label', s.label);
        input.addEventListener('input', () => {
          this.cb.onParam(s.key, parseFloat(input.value));
        });
        label.addEventListener('dblclick', () => this.cb.onParamReset(s.key));
        row.append(label, val, input);
        g.appendChild(row);
        this.sliders[s.key] = input;
        this.svals[s.key] = val;
      }
      this.els.panel.appendChild(g);
    }
  }

  syncParams(params) {
    for (const s of PARAM_SCHEMA) {
      const v = params[s.key];
      const input = this.sliders[s.key];
      if (document.activeElement !== input) input.value = v;
      const pct = ((v - s.min) / (s.max - s.min)) * 100;
      input.style.setProperty('--fill', pct.toFixed(1) + '%');
      this.svals[s.key].textContent = v.toFixed(s.d) + (s.unit ? ' ' + s.unit : '');
    }
  }

  setTelemetry(t) {
    if ('fps' in t) this.els.fps.innerHTML = `<b>${t.fps}</b>`;
    if ('ms' in t) this.els.ms.textContent = t.ms + ' ms';
    if ('res' in t) this.els.res.textContent = t.res;
    if ('steps' in t) this.els.steps.textContent = t.steps;
    if ('rcam' in t) this.els.rcam.textContent = t.rcam + ' rs';
    if ('dil' in t) this.els.dil.textContent = '× ' + t.dil;
    if ('mode' in t) this.els.mode.textContent = t.mode;
  }

  setQuality(q) {
    this.els.quality.querySelectorAll('.btn').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  }

  setCine(on) { this.els.cine.classList.toggle('on', on); }
  setAudio(on) { this.els.audio.classList.toggle('on', on); }

  setDebug(n) {
    const chip = this.els.chip;
    if (n > 0) {
      chip.textContent = `DEBUG ${n} — ${DEBUG_NAMES[n]}`;
      chip.classList.add('on');
    } else {
      chip.classList.remove('on');
    }
  }

  togglePanel(force) {
    const el = this.els.panel;
    const open = force !== undefined ? force : el.classList.contains('closed');
    el.classList.toggle('closed', !open);
    return open;
  }

  get panelOpen() { return !this.els.panel.classList.contains('closed'); }

  toast(msg, ms = 1800) {
    const t = this.els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
}
