// GARGANTUA — self-test probe. Loaded only with ?probe=1 (never in normal use).
// Renders, inspects its own framebuffer, smoke-tests the hotkey/API surface, then
// POSTs a JSON report to /__probe and a full-res PNG to /__shot (tools/test_server.py).

export async function runProbe(ctx) {
  const { app, renderer, renderFrame, perspCam } = ctx;
  const checks = [];
  const ok = (name, cond) => checks.push((cond ? 'PASS ' : 'FAIL ') + name);

  const key = (code, shiftKey = false) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true }));

  /* --- framebuffer statistics (same-task readback, no preserveDrawingBuffer) --- */
  function stats() {
    renderFrame();
    const c = document.createElement('canvas');
    c.width = 96; c.height = 54;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(renderer.domElement, 0, 0, 96, 54);
    const d = g.getImageData(0, 0, 96, 54).data;
    let sum = 0, max = 0, nonblack = 0, warm = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      if (l > max) max = l;
      if (l > 8) nonblack++;
      if (d[i] > 140 && d[i] > d[i + 2] + 20) warm++;
    }
    const n = d.length / 4;
    return {
      mean: +(sum / n).toFixed(2),
      max: Math.round(max),
      nonblackPct: +((100 * nonblack) / n).toFixed(1),
      warmPct: +((100 * warm) / n).toFixed(1),
    };
  }

  const tag = new URLSearchParams(location.search).get('tag') || 'probe';

  /* shot first, in the exact state the URL configured */
  const beauty = stats();
  renderFrame();
  let shot = null;
  try { shot = renderer.domElement.toDataURL('image/png'); } catch { /* tainted? */ }
  try {
    if (shot) await fetch('/__shot?tag=' + tag, { method: 'POST', body: shot });
  } catch { /* sink not running */ }

  ok('render.notBlack (nonblack>3%)', beauty.nonblackPct > 3);
  ok('render.hasHighlights (max>200)', beauty.max > 200);
  ok('render.hasWarmDisk (warm>0.3%)', beauty.warmPct > 0.3);

  /* --- HUD DOM assertions --- */
  const hudEl = document.getElementById('hud');
  ok('hud.sliders21', hudEl.querySelectorAll('input[type=range]').length === 21);
  ok('hud.presets4', hudEl.querySelectorAll('[data-t=presets] .btn').length === 4);
  ok('hud.quality3', hudEl.querySelectorAll('[data-t=quality] .btn').length === 3);
  const panel = hudEl.querySelector('[data-t=panel]');
  const wasClosed = panel.classList.contains('closed');
  hudEl.querySelector('[data-t=drawer]').click();
  ok('hud.drawerToggles', panel.classList.contains('closed') !== wasClosed);
  hudEl.querySelector('[data-t=drawer]').click();
  ok('hud.telemetryLive', !hudEl.querySelector('[data-t=fps]').textContent.includes('—'));

  /* --- hotkey / API smoke tests --- */
  key('Digit2');
  ok('key.debug2', app.debug === 2);
  const diskOnly = stats();
  ok('debug2.diskVisible', diskOnly.nonblackPct > 0.5);
  key('Digit1');
  const skyOnly = stats();
  ok('debug1.skyVisible', skyOnly.nonblackPct > 1);
  key('Digit0');
  ok('key.debug0', app.debug === 0);

  const posBefore = perspCam.position.clone();
  key('Digit3', true);
  ok('key.preset3.cameraMoved', perspCam.position.distanceTo(posBefore) > 0.5);
  ok('key.preset3.polarView', perspCam.position.y > 10);

  key('KeyQ');
  ok('key.qualityCycle', app.quality !== undefined);
  const resAfterQ = `${ctx.getInternal().w}x${ctx.getInternal().h}`;

  key('KeyH');
  const hudHidden = document.getElementById('hud').hidden === true;
  key('KeyH');
  ok('key.hudToggle', hudHidden);

  window.GARGANTUA.set('bloom', 1.5);
  ok('api.setParam', Math.abs(window.GARGANTUA.params.bloom - 1.5) < 1e-6);
  window.GARGANTUA.set('bloom', 0.7);

  window.GARGANTUA.freeze(10);
  const a = stats();
  const b = stats();
  ok('api.freeze.deterministic', a.mean === b.mean && a.max === b.max);
  window.GARGANTUA.thaw();

  const cineWas = app.cine;
  key('Space');
  ok('key.cineToggle', app.cine !== cineWas);
  key('Space');

  /* --- report --- */
  const report = {
    ua: navigator.userAgent.slice(0, 80),
    webgl2: renderer.capabilities.isWebGL2,
    hdr: ctx.getHDR(),
    internal: ctx.getInternal(),
    out: { w: renderer.domElement.width, h: renderer.domElement.height },
    resAfterQualityCycle: resAfterQ,
    beauty, diskOnly, skyOnly,
    fpsEMA: Math.round(1000 / ctx.getEmaDt()),
    jsErrors: ctx.getErrLog(),
    checks,
  };
  try {
    await fetch('/__probe', { method: 'POST', body: JSON.stringify(report, null, 1) });
  } catch { /* sink not running */ }
  window.GARGANTUA.thaw();
  console.log('[GARGANTUA] PROBE_DONE ' + checks.filter((c) => c.startsWith('FAIL')).length + ' failures');
}
