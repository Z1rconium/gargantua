// GARGANTUA — application shell: WebGL2 pipeline (geodesic pass → bloom pyramid →
// film grade), camera system (cinematic loop / OrbitControls / presets), HUD wiring,
// hotkeys, persistence, URL screenshot automation, and context-loss recovery.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PARAM_SCHEMA, defaultParams, QUALITY, QUALITY_ORDER, PRESETS,
  DEBUG_NAMES, CINE_PERIOD, SHIPPED_SHADER_VARIANT, BENCHMARK_VERSION,
  BENCHMARK_QUALITY_P95_MS, normalizeShaderVariant,
} from './config.js';
import { VERT, BRIGHT_FRAG, BLUR_FRAG, FINAL_FRAG, geodesicShader } from './shaders.js';
import { loadState, saveState, clearState, parseQuery } from './state.js';
import { AmbientAudio } from './audio.js';
import { HUD } from './hud.js';

const TAU = Math.PI * 2;
const SCHEMA_BY_KEY = Object.fromEntries(PARAM_SCHEMA.map((s) => [s.key, s]));

/* ---------------- boot / fatal overlays ---------------- */

const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');
const fatalEl = document.getElementById('fatal');

function bootMsg(pct, msg) {
  bootFill.style.transform = `scaleX(${pct / 100})`;
  if (msg) bootStatus.textContent = msg;
}

function fatal(msg, hint) {
  document.getElementById('fatal-msg').textContent = msg;
  document.getElementById('fatal-hint').textContent = hint || '';
  fatalEl.hidden = false;
  bootEl.classList.add('gone');
  try { renderer && renderer.setAnimationLoop(null); } catch { /* already down */ }
}
document.getElementById('fatal-reload').addEventListener('click', () => location.reload());

/* ---------------- app state ---------------- */

const app = {
  booted: false,
  ctxLost: false,
  errLog: [],
  params: defaultParams(),
  quality: matchMedia('(pointer: coarse)').matches ? 'standard' : 'high',
  debug: 0,
  cine: true,
  musicOn: false,
  paused: false,
  hudVisible: true,
  time: 0,
  fixedTime: null,
  fixedSize: null,
  frame: 0,
  shotPending: false,
  shaderVariant: { ...SHIPPED_SHADER_VARIANT },
  benchmark: null,
  benchmarkRunning: false,
};
const shippedQuality = app.quality;

const query = parseQuery();
const stored = loadState();

/* merge: defaults < stored < query */
if (stored) {
  if (stored.params) {
    for (const s of PARAM_SCHEMA) {
      const v = Number(stored.params[s.key]);
      if (Number.isFinite(v)) app.params[s.key] = Math.min(s.max, Math.max(s.min, v));
    }
  }
  if (QUALITY[stored.quality]) app.quality = stored.quality;
  if (stored.tuning && stored.tuning.version === BENCHMARK_VERSION && stored.tuning.variant) {
    app.shaderVariant = normalizeShaderVariant(stored.tuning.variant);
    app.benchmark = stored.tuning;
  }
  if (typeof stored.cine === 'boolean') app.cine = stored.cine;
  if (typeof stored.music === 'boolean') app.musicOn = stored.music;
  if (typeof stored.hud === 'boolean') app.hudVisible = stored.hud;
}
if (query.quality && QUALITY[query.quality]) app.quality = query.quality;
if (query.debug !== null && query.debug >= 0 && query.debug <= 9) app.debug = query.debug;
if (query.cine !== null) app.cine = query.cine;
if (query.music !== null) app.musicOn = query.music;
if (query.hud === false) app.hudVisible = false;
if (query.t !== null && Number.isFinite(query.t)) app.fixedTime = query.t;
if (query.w && query.h) app.fixedSize = { w: query.w, h: query.h };
if (query.shot) { app.shotPending = true; app.cine = false; }
if (query.preset !== null) app.cine = false;

/* ---------------- three.js objects ---------------- */

let renderer, scene, quad, dummyCam, perspCam, controls, hud, audio;
let matGeo, matBright, matBlur, matFinal;
let rtScene = null, rtBright = null;
const rtB = [null, null, null, null];
const rtT = [null, null, null, null];
let rtType = THREE.HalfFloatType;
let outW = 2, outH = 2, sw = 2, sh = 2;
let frameLoop = null;
let loopRunning = false;
let candidateShaderError = null;
let applyShaderVariant = null;

function rendererSignature() {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    webglVersion: gl.getParameter(gl.VERSION),
    glslVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    hdr: rtType === THREE.HalfFloatType,
  };
}

function sameRendererSignature(a, b) {
  return !!a && !!b && a.vendor === b.vendor && a.renderer === b.renderer
    && a.webglVersion === b.webglVersion && a.glslVersion === b.glslVersion && a.hdr === b.hdr;
}

const camPos = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
const camFwd = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

function rawMat(frag, uniforms) {
  return new THREE.RawShaderMaterial({
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
}

function makeRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: rtType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function makeReadRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function allocRTs(w, h) {
  sw = w; sh = h;
  if (rtScene) rtScene.dispose();
  if (rtBright) rtBright.dispose();
  rtScene = makeRT(w, h);
  const bw = Math.max(8, w >> 1), bh = Math.max(8, h >> 1);
  rtBright = makeRT(bw, bh);
  for (let i = 0; i < 4; i++) {
    if (rtB[i]) rtB[i].dispose();
    if (rtT[i]) rtT[i].dispose();
    const mw = Math.max(4, bw >> i), mh = Math.max(4, bh >> i);
    rtB[i] = makeRT(mw, mh);
    rtT[i] = makeRT(mw, mh);
  }
}

function resize() {
  const tier = QUALITY[app.quality];
  if (app.fixedSize) {
    renderer.setPixelRatio(1);
    renderer.setSize(app.fixedSize.w, app.fixedSize.h, false);
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier.dprCap));
    renderer.setSize(innerWidth, innerHeight, false);
  }
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  outW = db.x; outH = db.y;

  let w = Math.max(16, Math.round(outW * tier.renderScale));
  let h = Math.max(16, Math.round(outH * tier.renderScale));
  const budget = 2600 * 1500;
  if (w * h > budget) {
    const k = Math.sqrt(budget / (w * h));
    w = Math.round(w * k); h = Math.round(h * k);
  }
  allocRTs(w, h);
  perspCam.aspect = outW / Math.max(outH, 1);
  perspCam.updateProjectionMatrix();
}

/* ---------------- camera ---------------- */

function setCameraSpherical(radius, polarDeg, azDeg) {
  const pol = (polarDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  perspCam.up.set(0, 1, 0);
  perspCam.position.set(
    radius * Math.sin(pol) * Math.cos(az),
    radius * Math.cos(pol),
    radius * Math.sin(pol) * Math.sin(az)
  );
  perspCam.lookAt(0, 0, 0);
  if (controls) controls.update();
}

/* seamless 120 s dolly-orbit; all rates are integer multiples of 1/T so it loops */
function cinePose(time) {
  const s = ((time % CINE_PERIOD) + CINE_PERIOD) % CINE_PERIOD / CINE_PERIOD;
  const az = TAU * s + 0.28 * Math.sin(TAU * 2 * s + 1.0);
  const pol = 1.35 + 0.16 * Math.sin(TAU * 3 * s + 0.6);
  const rad = 12.0 + 3.4 * Math.sin(TAU * 2 * s + 1.2);
  const roll = 0.055 * Math.sin(TAU * 2 * s + 2.1);

  const sp = Math.sin(pol), cp = Math.cos(pol);
  perspCam.position.set(rad * sp * Math.cos(az), rad * cp, rad * sp * Math.sin(az));

  tmpA.copy(perspCam.position).multiplyScalar(-1).normalize();       /* fwd */
  tmpB.set(0, 1, 0).addScaledVector(tmpA, -tmpA.y).normalize();      /* level up */
  tmpC.crossVectors(tmpA, tmpB);                                     /* right-ish */
  perspCam.up.copy(tmpB).multiplyScalar(Math.cos(roll)).addScaledVector(tmpC, Math.sin(roll));
  perspCam.lookAt(0, 0, 0);
}

function updateCameraBasis(time) {
  if (app.cine) cinePose(time);
  else controls.update();
  perspCam.updateMatrixWorld();
  const e = perspCam.matrixWorld.elements;
  camRight.set(e[0], e[1], e[2]);
  camUp.set(e[4], e[5], e[6]);
  camFwd.set(-e[8], -e[9], -e[10]);
  camPos.copy(perspCam.position);

  /* the razor-thin disk vanishes exactly edge-on: nudge the ray origin off the plane
     with a smooth odd function of y instead of a hard floor. It has no flat region
     and no branch/state, so pitching through y=0 stays continuous and never sticks
     or snaps the ray origin ("teleporting" the rendered view). */
  const r = camPos.length();
  const edge = 0.03 * r;
  const y = camPos.y;
  camPos.y = y + (edge * edge * y) / (y * y + edge * edge);
}

/* ---------------- render ---------------- */

function draw(mat, rt) {
  quad.material = mat;
  renderer.setRenderTarget(rt);
  renderer.render(scene, dummyCam);
}

function updateGeoUniforms(benchMode = 0) {
  const time = app.fixedTime !== null ? app.fixedTime : app.time;
  const p = app.params;
  updateCameraBasis(time);
  const U = matGeo.uniforms;
  U.uResolution.value.set(sw, sh);
  U.uTime.value = time % 4096;
  U.uCamPos.value.copy(camPos);
  U.uCamRight.value.copy(camRight);
  U.uCamUp.value.copy(camUp);
  U.uCamFwd.value.copy(camFwd);
  U.uFovTan.value = Math.tan((p.fov * Math.PI) / 360);
  U.uDiskInner.value = p.diskInner;
  U.uDiskOuter.value = Math.max(p.diskOuter, p.diskInner + 0.5);
  U.uDiskTemp.value = p.diskTemp;
  U.uDiskEmit.value = p.diskEmit;
  U.uDiskDensity.value = p.diskDensity;
  U.uTurb.value = p.turbulence;
  U.uTurbDetail.value = p.turbDetail;
  U.uFlowSpeed.value = p.flowSpeed;
  U.uDoppler.value = p.doppler;
  U.uRedshift.value = p.redshift;
  U.uSteps.value = Math.min(768, Math.round(p.steps));
  U.uPhiMax.value = p.maxOrbits * TAU;
  U.uStarDensity.value = p.starDensity;
  U.uMilkyWay.value = p.milkyWay;
  U.uDebug.value = app.debug;
  U.uBenchMode.value = benchMode;
}

function drawGeodesic(rt = rtScene, benchMode = 0) {
  updateGeoUniforms(benchMode);
  draw(matGeo, rt);
}

function renderFrame() {
  const time = app.fixedTime !== null ? app.fixedTime : app.time;
  const p = app.params;
  drawGeodesic(rtScene, 0);

  matBright.uniforms.tSrc.value = rtScene.texture;
  matBright.uniforms.uThr.value = p.bloomThr;
  draw(matBright, rtBright);

  let src = rtBright;
  for (let i = 0; i < 4; i++) {
    matBlur.uniforms.tSrc.value = src.texture;
    matBlur.uniforms.uDir.value.set(1 / rtT[i].width, 0);
    draw(matBlur, rtT[i]);
    matBlur.uniforms.tSrc.value = rtT[i].texture;
    matBlur.uniforms.uDir.value.set(0, 1 / rtT[i].height);
    draw(matBlur, rtB[i]);
    src = rtB[i];
  }

  const F = matFinal.uniforms;
  F.tScene.value = rtScene.texture;
  F.tB0.value = rtB[0].texture;
  F.tB1.value = rtB[1].texture;
  F.tB2.value = rtB[2].texture;
  F.tB3.value = rtB[3].texture;
  F.uRes.value.set(outW, outH);
  F.uExposure.value = p.exposure;
  F.uBloom.value = p.bloom;
  F.uVignette.value = p.vignette;
  F.uGrain.value = p.grain;
  F.uChroma.value = p.chroma;
  F.uTimePost.value = time % 4096;
  F.uBypass.value = app.debug >= 3 ? 1 : 0;
  draw(matFinal, null);
}

/* ---------------- interactions ---------------- */

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState({
      params: app.params,
      quality: app.quality,
      cine: app.cine,
      music: app.musicOn,
      hud: app.hudVisible,
      cam: perspCam ? perspCam.position.toArray() : null,
      tuning: app.benchmark,
    });
  }, 400);
}

function setParam(key, v, silent) {
  if (app.benchmarkRunning && !silent) return;
  const s = SCHEMA_BY_KEY[key];
  if (!s || !Number.isFinite(v)) return;
  app.params[key] = Math.min(s.max, Math.max(s.min, v));
  if (key === 'fov') {
    perspCam.fov = app.params.fov;
    perspCam.updateProjectionMatrix();
  }
  hud.syncParams(app.params);
  if (!silent) scheduleSave();
}

function setQuality(q, announce = true, persist = true) {
  if (app.benchmarkRunning && persist) return;
  if (!QUALITY[q]) return;
  app.quality = q;
  setParam('steps', QUALITY[q].steps, true);
  resize();
  hud.setQuality(q);
  if (announce) hud.toast(`QUALITY — ${q.toUpperCase()} · ${QUALITY[q].steps} STEPS`);
  if (persist) scheduleSave();
}

function applyPreset(i, announce = true) {
  const pr = PRESETS[i];
  if (!pr) return;
  if (app.cine) setCine(false, false);
  setCameraSpherical(pr.radius, pr.polar, pr.azimuth);
  setParam('fov', pr.fov);
  if (announce) hud.toast(`VIEW ${i + 1} — ${pr.name}`);
  scheduleSave();
}

function setCine(on, announce = true) {
  app.cine = on;
  if (!on) perspCam.up.set(0, 1, 0);
  hud.setCine(on);
  if (announce) hud.toast(on ? 'CINEMATIC ORBIT — 120 S LOOP' : 'MANUAL CONTROL');
  scheduleSave();
}

function setDebug(n, announce = true) {
  app.debug = n;
  hud.setDebug(n);
  if (announce) hud.toast(n === 0 ? 'BEAUTY PASS' : `DEBUG ${n} — ${DEBUG_NAMES[n]}`);
}

function toggleMusic() {
  app.musicOn = !app.musicOn;
  audio.setEnabled(app.musicOn);
  hud.setAudio(app.musicOn);
  hud.toast(app.musicOn
    ? (audio.available ? 'AMBIENT AUDIO — ON' : 'AUDIO ASSET MISSING')
    : 'AMBIENT AUDIO — OFF');
  scheduleSave();
}

function setHudVisible(on) {
  app.hudVisible = on;
  hud.root.hidden = !on;
  scheduleSave();
}

function captureShot(w, h) {
  const hadFixed = app.fixedSize;
  if (w && h) { app.fixedSize = { w, h }; resize(); }
  renderFrame();
  let url = null;
  try {
    url = renderer.domElement.toDataURL('image/png');
    window.__GARGANTUA_LAST_SHOT = url;
    const a = document.createElement('a');
    a.href = url;
    a.download = `gargantua_${outW}x${outH}_${Date.now()}.png`;
    a.click();
    hud.toast(`FRAME SAVED — ${outW}×${outH} PNG`);
  } catch {
    hud.toast('CAPTURE FAILED');
  }
  if (w && h) { app.fixedSize = hadFixed || null; resize(); }
  return url;
}

let resetArmed = 0;
function requestReset() {
  const now = performance.now();
  if (now - resetArmed < 2500) {
    clearState();
    location.reload();
  } else {
    resetArmed = now;
    hud.toast('PRESS AGAIN TO RESET EVERYTHING', 2500);
  }
}

async function runAutoBenchmark() {
  if (app.benchmarkRunning || app.ctxLost || !app.booted) return;
  if (document.visibilityState !== 'visible') {
    hud.toast('KEEP THIS TAB VISIBLE TO BENCHMARK');
    return;
  }

  const snapshot = {
    params: { ...app.params },
    quality: app.quality,
    variant: { ...app.shaderVariant },
    fixedTime: app.fixedTime,
    cine: app.cine,
    paused: app.paused,
    loopRunning,
  };
  const oldShaderHandler = renderer.debug.onShaderError;
  clearTimeout(saveTimer);
  app.benchmarkRunning = true;
  hud.setBenchmarkState({ running: true, label: '0/16' });
  stopRenderLoop();
  candidateShaderError = null;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    candidateShaderError = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || 'shader compile failed').trim();
  };
  app.fixedTime = app.fixedTime === null ? 10 : app.fixedTime;
  app.cine = false;
  app.paused = true;
  app.params.grain = 0;
  app.params.chroma = 0;

  const restore = () => {
    setQuality(snapshot.quality, false, false);
    Object.assign(app.params, snapshot.params);
    app.fixedTime = snapshot.fixedTime;
    app.cine = snapshot.cine;
    app.paused = snapshot.paused;
    applyShaderVariant(snapshot.variant);
    hud.syncParams(app.params);
    hud.setQuality(app.quality);
    hud.setCine(app.cine);
  };

  try {
    const { runAutoBench } = await import('./bench.js');
    const result = await runAutoBench({
      app,
      renderer,
      renderFrame,
      drawGeodesic,
      makeReadTarget: () => makeReadRT(sw, sh),
      readTarget: (rt) => {
        const pixels = new Uint8Array(rt.width * rt.height * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, pixels);
        return pixels;
      },
      readOutput: () => {
        renderFrame();
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(renderer.domElement, 0, 0, outW, outH);
        return { width: outW, height: outH, pixels: new Uint8Array(context.getImageData(0, 0, outW, outH).data) };
      },
      setVariant: (variant) => { candidateShaderError = null; applyShaderVariant(variant); },
      setQuality,
      qualityOrder: ['cinematic', 'high', 'standard'],
      qualityP95Ms: BENCHMARK_QUALITY_P95_MS,
      getInternal: () => ({ w: sw, h: sh }),
      getOutput: () => ({ width: outW, height: outH }),
      getEnvironment: rendererSignature,
      throwIfShaderError: () => {
        if (candidateShaderError) throw new Error(candidateShaderError.slice(0, 280));
      },
      onProgress: (done, total, label) => hud.setBenchmarkState({ running: true, label: `${done}/${total}` }),
    });
    window.__GARGANTUA_AUTO_BENCH_REPORT = result.report;
    if (!result.promotionEligible) {
      restore();
      hud.toast('BENCHMARK ADVISORY ONLY — GPU TIMER UNAVAILABLE', 3500);
      return result;
    }

    const winner = result.winner.candidate;
    restore();
    setQuality(winner.quality, false, false);
    app.params.maxOrbits = winner.orbits;
    applyShaderVariant(winner.variant);
    app.benchmark = {
      version: BENCHMARK_VERSION,
      variant: { ...winner.variant },
      quality: winner.quality,
      orbits: winner.orbits,
      environment: rendererSignature(),
      summary: result.report.summary,
    };
    hud.syncParams(app.params);
    hud.setQuality(app.quality);
    scheduleSave();
    hud.toast(`APPLIED — ${winner.quality.toUpperCase()} · ${winner.variant.integrator.toUpperCase()} · N${winner.variant.noiseMask} · ${winner.orbits}τ`, 4200);
    return result;
  } catch (err) {
    restore();
    app.errLog.push('auto bench: ' + String(err));
    hud.toast(`BENCHMARK KEPT CURRENT SETTINGS — ${String(err.message || err).slice(0, 72)}`, 4200);
    return null;
  } finally {
    renderer.debug.onShaderError = oldShaderHandler;
    app.benchmarkRunning = false;
    hud.setBenchmarkState({ running: false });
    if (snapshot.loopRunning && !app.ctxLost && fatalEl.hidden) startRenderLoop();
  }
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (app.benchmarkRunning) return;

  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (e.shiftKey && n >= 1 && n <= 4) applyPreset(n - 1);
    else if (!e.shiftKey) setDebug(n);
    return;
  }
  switch (e.code) {
    case 'Space': e.preventDefault(); setCine(!app.cine); break;
    case 'KeyH': setHudVisible(!app.hudVisible); break;
    case 'KeyM': toggleMusic(); break;
    case 'KeyS': captureShot(); break;
    case 'KeyQ': {
      const i = QUALITY_ORDER.indexOf(app.quality);
      setQuality(QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length]);
      break;
    }
    case 'KeyP':
      app.paused = !app.paused;
      hud.toast(app.paused ? 'TIME FROZEN' : 'TIME FLOWING');
      break;
    case 'KeyR': requestReset(); break;
    case 'KeyF':
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
      break;
  }
}

/* ---------------- telemetry ---------------- */

let emaDt = 16.7;
let lastTele = 0;
let lastFrame = performance.now();

function stopRenderLoop() {
  if (!renderer || !loopRunning) return;
  renderer.setAnimationLoop(null);
  loopRunning = false;
}

function startRenderLoop() {
  if (!renderer || loopRunning || app.ctxLost || !app.booted) return;
  lastFrame = performance.now();
  renderer.setAnimationLoop(frameLoop);
  loopRunning = true;
}

function updateTelemetry(now) {
  if (now - lastTele < 250 || !app.hudVisible) return;
  lastTele = now;
  const r = camPos.length();
  hud.setTelemetry({
    fps: Math.round(1000 / emaDt),
    ms: emaDt.toFixed(1),
    res: `${sw}×${sh}`,
    steps: String(Math.round(app.params.steps)),
    rcam: r.toFixed(1),
    dil: (1 / Math.sqrt(Math.max(1 - 1 / r, 1e-3))).toFixed(3),
    mode: app.paused ? 'PAUSED' : app.cine ? 'CINE ORBIT' : 'MANUAL',
  });
}

/* ---------------- boot ---------------- */

async function nextFrame() {
  return new Promise((res) => requestAnimationFrame(res));
}

async function start() {
  bootMsg(8, 'INITIALIZING WEBGL2 CONTEXT');
  const canvas = document.getElementById('view');
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: false,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    fatal('WebGL2 context creation failed.',
      'This raytracer needs WebGL2. Try Chrome, Edge, Firefox or Safari 16+, and check that hardware acceleration is enabled.');
    return;
  }
  if (!renderer.capabilities.isWebGL2) {
    fatal('WebGL2 is not available in this browser.',
      'Try a current Chrome, Edge, Firefox or Safari, and check that hardware acceleration is enabled.');
    return;
  }
  rtType = renderer.extensions.has('EXT_color_buffer_float')
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
  renderer.autoClear = false;
  if (app.benchmark && !sameRendererSignature(app.benchmark.environment, rendererSignature())) {
    app.benchmark = null;
    app.shaderVariant = { ...SHIPPED_SHADER_VARIANT };
    app.params.maxOrbits = defaultParams().maxOrbits;
    if (!(query.quality && QUALITY[query.quality])) {
      app.quality = shippedQuality;
      app.params.steps = QUALITY[shippedQuality].steps;
    }
  }
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || 'unknown').trim();
    fatal('GLSL compilation failed: ' + log.slice(0, 400), 'Your GPU/driver rejected the geodesic shader. Please report this log.');
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    app.ctxLost = true;
    stopRenderLoop();
    bootEl.classList.remove('gone');
    bootMsg(50, 'GPU CONTEXT LOST — WAITING FOR RESTORE');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    resize();
    app.ctxLost = false;
    bootEl.classList.add('gone');
    startRenderLoop();
  });

  bootMsg(28, 'BUILDING RENDER PIPELINE');
  scene = new THREE.Scene();
  dummyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quad = new THREE.Mesh(geom);
  quad.frustumCulled = false;
  scene.add(quad);

  const benchIntegrator = query.integrator === 'rkck' ? 'rkck' : 'rk4';
  const benchTolerance = ['loose', 'balanced', 'strict'].includes(query.tolerance)
    ? query.tolerance : 'balanced';
  const benchNoiseMask = Number.isInteger(query.noiseMask) ? Math.max(0, Math.min(7, query.noiseMask)) : 0;
  const initialVariant = query.bench
    ? { integrator: benchIntegrator, tolerance: benchTolerance, noiseMask: benchNoiseMask }
    : app.shaderVariant;
  app.shaderVariant = normalizeShaderVariant(initialVariant);
  const geoUniforms = () => ({
    uResolution: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uCamFwd: { value: new THREE.Vector3() },
    uFovTan: { value: 0.6 },
    uDiskInner: { value: 3 },
    uDiskOuter: { value: 14 },
    uDiskTemp: { value: 12000 },
    uDiskEmit: { value: 1 },
    uDiskDensity: { value: 1 },
    uTurb: { value: 0.65 },
    uTurbDetail: { value: 1 },
    uFlowSpeed: { value: 1 },
    uDoppler: { value: 1 },
    uRedshift: { value: 1 },
    uSteps: { value: 288 },
    uPhiMax: { value: TAU * 2 },
    uStarDensity: { value: 1 },
    uMilkyWay: { value: 1 },
    uDebug: { value: 0 },
    uBenchMode: { value: 0 },
  });
  matGeo = rawMat(geodesicShader(app.shaderVariant), geoUniforms());
  applyShaderVariant = (variant) => {
    const next = normalizeShaderVariant(variant);
    const old = matGeo;
    matGeo = rawMat(geodesicShader(next), geoUniforms());
    app.shaderVariant = next;
    if (old) old.dispose();
  };
  matBright = rawMat(BRIGHT_FRAG, {
    tSrc: { value: null },
    uThr: { value: 0.85 },
  });
  matBlur = rawMat(BLUR_FRAG, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2(1, 0) },
  });
  matFinal = rawMat(FINAL_FRAG, {
    tScene: { value: null },
    tB0: { value: null },
    tB1: { value: null },
    tB2: { value: null },
    tB3: { value: null },
    uRes: { value: new THREE.Vector2() },
    uExposure: { value: 1.15 },
    uBloom: { value: 0.7 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.28 },
    uChroma: { value: 0.35 },
    uTimePost: { value: 0 },
    uBypass: { value: 0 },
  });

  perspCam = new THREE.PerspectiveCamera(app.params.fov, 1, 0.1, 200);
  const cam = stored && Array.isArray(stored.cam) && stored.cam.length === 3 ? stored.cam : null;
  if (cam && Number.isFinite(cam[0])) {
    perspCam.position.set(cam[0], cam[1], cam[2]);
    const r = perspCam.position.length();
    if (r < 1.75 || r > 55 || !Number.isFinite(r)) setCameraSpherical(16.5, 84, -25);
    else perspCam.lookAt(0, 0, 0);
  } else {
    setCameraSpherical(16.5, 84, -25);
  }

  controls = new OrbitControls(perspCam, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 0.65;
  controls.minDistance = 1.75;
  controls.maxDistance = 55;
  controls.target.set(0, 0, 0);
  controls.addEventListener('start', () => {
    if (app.cine) setCine(false);
  });
  controls.addEventListener('end', scheduleSave);

  hud = new HUD(document.getElementById('hud'), {
    onParam: (k, v) => setParam(k, v),
    onParamReset: (k) => { setParam(k, SCHEMA_BY_KEY[k].def); hud.toast(`${SCHEMA_BY_KEY[k].label.toUpperCase()} — DEFAULT`); },
    onPreset: (i) => { if (!app.benchmarkRunning) applyPreset(i); },
    onQuality: (q) => setQuality(q),
    onCine: () => { if (!app.benchmarkRunning) setCine(!app.cine); },
    onAudio: () => { if (!app.benchmarkRunning) toggleMusic(); },
    onShot: () => { if (!app.benchmarkRunning) captureShot(); },
    onBench: () => runAutoBenchmark(),
    onReset: () => { if (!app.benchmarkRunning) requestReset(); },
  });
  hud.syncParams(app.params);
  hud.setQuality(app.quality);
  hud.setCine(app.cine);
  hud.setDebug(app.debug);
  if (stored && stored.panel) hud.togglePanel(true);

  audio = new AmbientAudio('assets/ambient.wav');
  hud.setAudio(app.musicOn);
  if (app.musicOn) audio.setEnabled(true);
  const gesture = () => audio.gesture();
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (!app.fixedSize) resize(); });

  if (query.preset !== null && query.preset >= 1 && query.preset <= 4) {
    applyPreset(query.preset - 1, false);
  }

  bootMsg(55, 'COMPILING GEODESIC INTEGRATOR');
  resize();
  await nextFrame();
  renderFrame(); /* first render compiles all four programs */
  if (!fatalEl.hidden) return; /* shader error already reported */

  bootMsg(88, 'FIRST LIGHT');
  await nextFrame();
  app.booted = true;
  hud.root.hidden = !app.hudVisible;
  bootEl.classList.add('gone');

  /* public automation API */
  window.GARGANTUA = {
    version: '1.0.0',
    get params() { return { ...app.params }; },
    set: (k, v) => setParam(k, v),
    preset: (i) => applyPreset(i - 1),
    quality: (q) => setQuality(q),
    debug: (n) => setDebug(n),
    cine: (on) => setCine(!!on),
    freeze: (t) => { app.fixedTime = Number.isFinite(t) ? t : 0; },
    thaw: () => { app.fixedTime = null; },
    capture: (w, h) => captureShot(w, h),
    benchmark: () => runAutoBenchmark(),
    benchmarkStatus: () => ({ running: app.benchmarkRunning, tuning: app.benchmark }),
    stats: () => ({ fps: Math.round(1000 / emaDt), ms: emaDt, res: [sw, sh], out: [outW, outH] }),
  };

  frameLoop = (now) => {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    emaDt = emaDt * 0.9 + dt * 0.1;
    if (!app.paused) app.time += dt / 1000;
    if (app.ctxLost) return;
    renderFrame();
    app.frame++;
    updateTelemetry(now);

    if (app.shotPending && app.frame === 6) {
      app.shotPending = false;
      captureShot();
      window.__GARGANTUA_SHOT_DONE = true;
      console.log('[GARGANTUA] SHOT_READY');
    }
  };
  startRenderLoop();

  if (query.probe) {
    setTimeout(() => {
      import('./probe.js')
        .then((m) => m.runProbe({
          app, renderer, renderFrame, perspCam,
          getInternal: () => ({ w: sw, h: sh }),
          getHDR: () => rtType === THREE.HalfFloatType,
          getEmaDt: () => emaDt,
          getErrLog: () => app.errLog.slice(0, 10),
        }))
        .catch((e) => console.log('[GARGANTUA] PROBE_FAILED ' + e.message));
    }, 1800);
  }

  if (query.bench) {
    setTimeout(() => {
      import('./bench.js')
        .then((m) => m.runBench({
          app, renderer, renderFrame,
          getInternal: () => ({ w: sw, h: sh }),
          getHDR: () => rtType === THREE.HalfFloatType,
          setVariant: (variant) => applyShaderVariant(variant),
          drawGeodesic,
          makeReadTarget: () => makeReadRT(sw, sh),
          readTarget: (rt) => {
            const pixels = new Uint8Array(rt.width * rt.height * 4);
            renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, pixels);
            return pixels;
          },
          readOutput: () => {
            renderFrame();
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(renderer.domElement, 0, 0, outW, outH);
            return {
              width: outW,
              height: outH,
              pixels: new Uint8Array(context.getImageData(0, 0, outW, outH).data),
            };
          },
          stopLoop: stopRenderLoop,
        }))
        .catch((e) => {
          app.errLog.push('bench: ' + String(e));
          window.__GARGANTUA_BENCH_DONE = { error: String(e) };
          console.log('[GARGANTUA] BENCH_FAILED ' + e.message);
        });
    }, 1800);
  }
}

window.addEventListener('error', (e) => {
  app.errLog.push(String(e.message || e.error || 'unknown').slice(0, 200));
  if (!app.booted && fatalEl.hidden) {
    fatal('Initialization failed: ' + (e.message || 'unknown error'),
      'Serve this folder over HTTP (python3 -m http.server) — ES modules do not load from file://.');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  app.errLog.push('rejection: ' + String(e.reason).slice(0, 200));
});

start().catch((err) => {
  fatal('Initialization failed: ' + (err && err.message ? err.message : String(err)),
    'Serve this folder over HTTP (python3 -m http.server) — ES modules do not load from file://.');
});
