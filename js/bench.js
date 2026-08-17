// Hidden shader benchmark. Loaded only by main.js under ?bench=1.

const WARMUP_FRAMES = 12;
const SAMPLE_COUNT = 30;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function timingSummary(values) {
  return {
    validSamples: values.length,
    medianMs: values.length ? +percentile(values, 0.5).toFixed(4) : null,
    p95Ms: values.length ? +percentile(values, 0.95).toFixed(4) : null,
  };
}

function byteHistogram(pixels, channel) {
  const bins = new Uint32Array(256);
  for (let i = channel; i < pixels.length; i += 4) bins[pixels[i]]++;
  return bins;
}

function histogramQuantile(bins, p) {
  let total = 0;
  for (const count of bins) total += count;
  const target = Math.ceil(total * p);
  let seen = 0;
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i];
    if (seen >= target) return i;
  }
  return bins.length - 1;
}

function diagnosticSummary(pixels) {
  const channels = [0, 1, 2, 3].map((c) => byteHistogram(pixels, c));
  const summarize = (bins, decode) => {
    let total = 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      total += bins[i];
      sum += bins[i] * decode(i);
    }
    return {
      mean: +(sum / Math.max(total, 1)).toFixed(3),
      median: +decode(histogramQuantile(bins, 0.5)).toFixed(3),
      p95: +decode(histogramQuantile(bins, 0.95)).toFixed(3),
      max: +decode(histogramQuantile(bins, 1)).toFixed(3),
    };
  };
  return {
    acceptedSteps: summarize(channels[0], (v) => v * 768 / 255),
    rejectedSteps: summarize(channels[1], (v) => v * 768 / 255),
    minStepRatio: summarize(channels[2], (v) => 0.0625 + v * 1.9375 / 255),
    attempts: summarize(channels[3], (v) => v * 768 / 255),
  };
}

function terminationSummary(pixels) {
  const counts = { unset: 0, escaped: 0, horizon: 0, phiBudget: 0, attemptExhausted: 0, invalid: 0 };
  for (let i = 0; i < pixels.length; i += 4) {
    const code = Math.round(pixels[i] * 5 / 255);
    if (code === 1) counts.escaped++;
    else if (code === 2) counts.horizon++;
    else if (code === 3) counts.phiBudget++;
    else if (code === 4) counts.attemptExhausted++;
    else if (code === 5) counts.invalid++;
    else counts.unset++;
  }
  return counts;
}

function imageDifference(candidate, reference, terminationCandidate, terminationReference) {
  const diffBins = new Uint32Array(256);
  let sum = 0;
  let roiSum = 0;
  let samples = 0;
  let roiSamples = 0;
  let statusMismatch = 0;
  let black = 0;
  const pixelCount = candidate.length / 4;
  for (let i = 0; i < candidate.length; i += 4) {
    let luminance = 0;
    const inRoi = terminationReference[i + 3] > 127;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(candidate[i + c] - reference[i + c]);
      diffBins[d]++;
      sum += d;
      samples++;
      if (inRoi) { roiSum += d; roiSamples++; }
      luminance += candidate[i + c];
    }
    if (luminance === 0) black++;
    const a = Math.round(terminationCandidate[i] * 5 / 255);
    const b = Math.round(terminationReference[i] * 5 / 255);
    if (a !== b) statusMismatch++;
  }
  return {
    rgbMae: +(sum / Math.max(samples, 1) / 255).toFixed(7),
    rgbP99: +(histogramQuantile(diffBins, 0.99) / 255).toFixed(7),
    photonRingRoi: {
      pixels: Math.round(roiSamples / 3),
      rgbMae: roiSamples ? +(roiSum / roiSamples / 255).toFixed(7) : null,
    },
    terminationMismatchPct: +(100 * statusMismatch / pixelCount).toFixed(5),
    blackPct: +(100 * black / pixelCount).toFixed(4),
  };
}

function rgbDifference(candidate, reference) {
  const bins = new Uint32Array(256);
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < candidate.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(candidate[i + c] - reference[i + c]);
      bins[d]++;
      sum += d;
      samples++;
    }
  }
  return {
    rgbMae: +(sum / Math.max(samples, 1) / 255).toFixed(7),
    rgbP99: +(histogramQuantile(bins, 0.99) / 255).toFixed(7),
  };
}

async function postPng(pixels, width, height, tag) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  try {
    await fetch('/__shot?tag=' + encodeURIComponent(tag), {
      method: 'POST',
      body: canvas.toDataURL('image/png'),
    });
  } catch { /* optional sink */ }
}

async function warmup(drawGeodesic) {
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    drawGeodesic();
    await nextFrame();
  }
}

async function collectGpuTimes(gl, ext, drawGeodesic) {
  const values = [];
  let disjointSamples = 0;
  let attempts = 0;
  while (values.length < SAMPLE_COUNT && attempts < SAMPLE_COUNT * 4) {
    attempts++;
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    drawGeodesic();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.flush();
    let available = false;
    for (let wait = 0; wait < 240 && !available; wait++) {
      await nextFrame();
      available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (available && !disjoint) {
      values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
    } else {
      disjointSamples++;
    }
    gl.deleteQuery(query);
  }
  return { ...timingSummary(values), disjointSamples, attemptedSamples: attempts };
}

function collectBlockingTimes(gl, draw) {
  const values = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const start = performance.now();
    draw();
    gl.finish();
    values.push(performance.now() - start);
  }
  return timingSummary(values);
}

export async function runBench(ctx) {
  const {
    app, renderer, renderFrame, setVariant, drawGeodesic, makeReadTarget,
    readTarget, readOutput, stopLoop, getInternal, getHDR,
  } = ctx;
  const q = new URLSearchParams(location.search);
  const variant = {
    integrator: q.get('int') === 'rkck' ? 'rkck' : 'rk4',
    tolerance: ['loose', 'balanced', 'strict'].includes(q.get('tol')) ? q.get('tol') : 'balanced',
    noiseMask: Math.max(0, Math.min(7, parseInt(q.get('noiseMask') || '0', 10) || 0)),
  };
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const glInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const saved = {
    fixedTime: app.fixedTime,
    cine: app.cine,
    paused: app.paused,
    grain: app.params.grain,
    chroma: app.params.chroma,
    steps: app.params.steps,
    maxOrbits: app.params.maxOrbits,
  };
  const requestedOrbits = parseFloat(q.get('orbits') || '4');

  stopLoop();
  app.fixedTime = app.fixedTime === null ? 10 : app.fixedTime;
  app.cine = false;
  app.paused = true;
  app.params.grain = 0;
  app.params.chroma = 0;
  app.params.maxOrbits = requestedOrbits === 2 ? 2 : 4;
  setVariant(variant);
  await warmup(drawGeodesic);

  const gpuSamples = ext ? await collectGpuTimes(gl, ext, drawGeodesic) : null;
  const gpu = gpuSamples
    ? { supported: true, promotionEligible: gpuSamples.validSamples === SAMPLE_COUNT, ...gpuSamples }
    : { supported: false, promotionEligible: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' };
  const geodesicBlockingWall = collectBlockingTimes(gl, drawGeodesic);
  const fullFrameBlockingWall = collectBlockingTimes(gl, renderFrame);
  const candidateDisplay = readOutput();

  const target = makeReadTarget();
  drawGeodesic(target, 0);
  const candidateImage = readTarget(target);
  drawGeodesic(target, 1);
  const candidateSteps = readTarget(target);
  drawGeodesic(target, 2);
  const candidateTermination = readTarget(target);

  /* Performance baseline: same workload and resolution, fixed RK4 with full FBM. */
  app.params.steps = saved.steps;
  setVariant({ integrator: 'rk4', tolerance: 'balanced', noiseMask: 0 });
  await warmup(drawGeodesic);
  const baselineSamples = ext ? await collectGpuTimes(gl, ext, drawGeodesic) : null;
  const baselineGpu = baselineSamples
    ? { supported: true, promotionEligible: baselineSamples.validSamples === SAMPLE_COUNT, ...baselineSamples }
    : { supported: false, promotionEligible: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' };
  const baselineDisplay = readOutput();
  drawGeodesic(target, 0);
  const baselineImage = readTarget(target);
  drawGeodesic(target, 2);
  const baselineTermination = readTarget(target);

  /* Accuracy reference: fixed RK4 at the maximum 768 steps. */
  app.params.steps = 768;
  drawGeodesic(target, 0);
  gl.finish();
  const referenceImage = readTarget(target);
  drawGeodesic(target, 2);
  const referenceTermination = readTarget(target);
  const referenceDisplay = readOutput();

  const internal = getInternal();
  const diff = imageDifference(candidateImage, referenceImage, candidateTermination, referenceTermination);
  const baselineDiff = imageDifference(baselineImage, referenceImage, baselineTermination, referenceTermination);
  const noiseDiff = imageDifference(candidateImage, baselineImage, candidateTermination, baselineTermination);
  const displayDiff = rgbDifference(candidateDisplay.pixels, referenceDisplay.pixels);
  const displayBaselineDiff = rgbDifference(baselineDisplay.pixels, referenceDisplay.pixels);
  const displayNoiseDiff = rgbDifference(candidateDisplay.pixels, baselineDisplay.pixels);
  const gpuDeltaPct = gpu.supported && baselineGpu.supported && baselineGpu.medianMs > 0
    ? +(100 * (gpu.medianMs / baselineGpu.medianMs - 1)).toFixed(3) : null;
  const roiImprovementPct = diff.photonRingRoi.rgbMae !== null
      && baselineDiff.photonRingRoi.rgbMae > 0
    ? +(100 * (1 - diff.photonRingRoi.rgbMae / baselineDiff.photonRingRoi.rgbMae)).toFixed(3)
    : null;
  const localSelection = {
    gpuTimerValid: gpu.validSamples === SAMPLE_COUNT && baselineGpu.validSamples === SAMPLE_COUNT,
    rkck: {
      roiImprovementPct,
      passesRoi: roiImprovementPct !== null && roiImprovementPct >= 50,
      passesClassification: diff.terminationMismatchPct <= baselineDiff.terminationMismatchPct,
      passesFullFrame: displayDiff.rgbMae <= displayBaselineDiff.rgbMae,
      passesGpu: gpuDeltaPct !== null && gpuDeltaPct <= 20,
    },
    fbm: {
      applicable: variant.integrator === 'rk4' && variant.noiseMask > 0,
      speedupPct: gpuDeltaPct === null ? null : -gpuDeltaPct,
      passesMean: displayNoiseDiff.rgbMae <= 2 / 255,
      passesP99: displayNoiseDiff.rgbP99 <= 16 / 255,
      passesGpu: gpuDeltaPct !== null && gpuDeltaPct <= -5,
    },
  };
  const report = {
    type: 'gargantua-shader-benchmark',
    version: 1,
    variant,
    frozenTime: app.fixedTime,
    quality: app.quality,
    steps: saved.steps,
    maxOrbits: app.params.maxOrbits,
    warmupFrames: WARMUP_FRAMES,
    gpuGeodesic: gpu,
    baselineGpuGeodesic: baselineGpu,
    gpuDeltaPct,
    geodesicBlockingWall: { label: 'blocking wall-time; never eligible for promotion', ...geodesicBlockingWall },
    fullFrameBlockingWall: { label: 'blocking wall-time including gl.finish', ...fullFrameBlockingWall },
    diagnostics: diagnosticSummary(candidateSteps),
    termination: terminationSummary(candidateTermination),
    reference: { integrator: 'rk4', steps: 768, noiseMask: 0 },
    differenceToRk4_768: diff,
    baselineDifferenceToRk4_768: baselineDiff,
    noiseDifferenceToFiveOctaveBaseline: noiseDiff,
    displayDifferenceToRk4_768: displayDiff,
    displayBaselineDifferenceToRk4_768: displayBaselineDiff,
    displayNoiseDifferenceToFiveOctaveBaseline: displayNoiseDiff,
    localSelection,
    thresholds: {
      fbmMeanRgbMax: 2 / 255,
      fbmP99Max: 16 / 255,
      fbmMinSpeedupPct: 5,
      rkckMaxGpuRegressionPct: 20,
      photonRingRoiRequiredImprovementPct: 50,
    },
    environment: {
      userAgent: navigator.userAgent,
      webglVersion: gl.getParameter(gl.VERSION),
      glslVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: glInfo ? gl.getParameter(glInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: glInfo ? gl.getParameter(glInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      hdr: getHDR(),
      internal,
      output: { width: renderer.domElement.width, height: renderer.domElement.height },
    },
  };

  await Promise.all([
    postPng(candidateDisplay.pixels, candidateDisplay.width, candidateDisplay.height,
      `bench_${variant.integrator}_${variant.tolerance}_n${variant.noiseMask}`),
    postPng(referenceDisplay.pixels, referenceDisplay.width, referenceDisplay.height,
      'bench_reference_rk4_768'),
    fetch('/__probe', { method: 'POST', body: JSON.stringify(report, null, 1) }).catch(() => {}),
  ]);
  target.dispose();

  app.fixedTime = saved.fixedTime;
  app.cine = saved.cine;
  app.paused = saved.paused;
  app.params.grain = saved.grain;
  app.params.chroma = saved.chroma;
  app.params.steps = saved.steps;
  app.params.maxOrbits = saved.maxOrbits;
  window.__GARGANTUA_BENCH_REPORT = report;
  window.__GARGANTUA_BENCH_DONE = true;
  console.log('[GARGANTUA] BENCH_DONE ' + JSON.stringify({ variant, gpu: report.gpuGeodesic }));
}

const AUTO_VISUAL_MEAN_MAX = 2 / 255;
const AUTO_VISUAL_P99_MAX = 16 / 255;
const AUTO_TERM_EPSILON_PCT = 0.05;

function variantLabel(variant) {
  return `${variant.integrator.toUpperCase()} / ${variant.integrator === 'rkck' ? variant.tolerance.toUpperCase() : 'FIXED'} / N${variant.noiseMask}`;
}

function gpuEligible(result) {
  return result.gpu.supported && result.gpu.validSamples === SAMPLE_COUNT;
}

function betterByGpu(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.gpu.medianMs !== b.gpu.medianMs) return a.gpu.medianMs < b.gpu.medianMs ? a : b;
  return a.gpu.p95Ms < b.gpu.p95Ms ? a : b;
}

function autoVisualPass(result, baseline) {
  const display = result.displayDiff;
  const baselineTerm = baseline.diff.terminationMismatchPct;
  return display.rgbMae <= baseline.displayDiff.rgbMae + AUTO_VISUAL_MEAN_MAX
    && display.rgbP99 <= baseline.displayDiff.rgbP99 + AUTO_VISUAL_P99_MAX
    && result.diff.terminationMismatchPct <= baselineTerm + AUTO_TERM_EPSILON_PCT
    && result.diff.blackPct <= baseline.diff.blackPct + AUTO_TERM_EPSILON_PCT;
}

async function captureReference(ctx) {
  const { app, drawGeodesic, makeReadTarget, readTarget, readOutput } = ctx;
  const target = makeReadTarget();
  try {
    app.params.steps = 768;
    ctx.setVariant({ integrator: 'rk4', tolerance: 'balanced', noiseMask: 0 });
    drawGeodesic(target, 0);
    ctx.renderer.getContext().finish();
    const image = readTarget(target);
    drawGeodesic(target, 2);
    const termination = readTarget(target);
    const display = readOutput();
    return { image, termination, display };
  } finally {
    target.dispose();
  }
}

async function runAutoCandidate(ctx, candidate, reference) {
  const { app, renderer, drawGeodesic, makeReadTarget, readTarget, readOutput } = ctx;
  ctx.setQuality(candidate.quality, false, false);
  app.params.maxOrbits = candidate.orbits;
  ctx.setVariant(candidate.variant);
  await warmup(drawGeodesic);
  ctx.throwIfShaderError?.();

  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const samples = ext ? await collectGpuTimes(gl, ext, drawGeodesic) : null;
  const gpu = samples
    ? { supported: true, promotionEligible: samples.validSamples === SAMPLE_COUNT, ...samples }
    : { supported: false, promotionEligible: false, reason: 'EXT_disjoint_timer_query_webgl2 unavailable' };
  const fullFrameBlockingWall = collectBlockingTimes(gl, ctx.renderFrame);

  if (!reference) return { candidate, gpu, fullFrameBlockingWall };

  const target = makeReadTarget();
  try {
    drawGeodesic(target, 0);
    const image = readTarget(target);
    drawGeodesic(target, 2);
    const termination = readTarget(target);
    const display = readOutput();
    return {
      candidate,
      gpu,
      fullFrameBlockingWall,
      diff: imageDifference(image, reference.image, termination, reference.termination),
      displayDiff: rgbDifference(display.pixels, reference.display.pixels),
    };
  } finally {
    target.dispose();
  }
}

/**
 * Interactive, local-only tuning suite. It intentionally uses a bounded staged
 * search instead of a 192-way cartesian product so the HUD remains usable.
 * main.js owns the transactional restoration and applies the returned winner.
 */
export async function runAutoBench(ctx) {
  const { app, qualityOrder, qualityP95Ms, onProgress } = ctx;
  const reports = { type: 'gargantua-auto-benchmark', version: 1, stages: {} };
  const shipped = { integrator: 'rk4', tolerance: 'balanced', noiseMask: 7 };
  const qualityCandidates = qualityOrder.map((quality) => ({ quality, variant: shipped, orbits: 4 }));
  const total = qualityCandidates.length + 1 + 8 + 1 + 3;
  let done = 0;
  const progress = (label) => onProgress?.(++done, total, label);

  // Quality uses end-to-end blocking wall-time as an advisory ladder. Shader
  // application itself still requires valid GPU timer samples below.
  const calibration = [];
  for (const candidate of qualityCandidates) {
    onProgress?.(done, total, `quality ${candidate.quality}`);
    const result = await runAutoCandidate(ctx, candidate, null);
    calibration.push(result);
    progress(`quality ${candidate.quality}`);
  }
  reports.stages.quality = calibration;
  const selectedQuality = qualityOrder.find((quality) => {
    const entry = calibration.find((x) => x.candidate.quality === quality);
    return entry && entry.fullFrameBlockingWall.p95Ms <= qualityP95Ms[quality];
  }) || qualityOrder[qualityOrder.length - 1];

  onProgress?.(done, total, 'reference');
  ctx.setQuality(selectedQuality, false, false);
  app.params.maxOrbits = 4;
  const savedSteps = app.params.steps;
  const reference = await captureReference(ctx);
  app.params.steps = savedSteps;
  progress('reference');

  const baselineCandidate = { quality: selectedQuality, variant: { integrator: 'rk4', tolerance: 'balanced', noiseMask: 0 }, orbits: 4 };
  onProgress?.(done, total, 'baseline');
  const baseline = await runAutoCandidate(ctx, baselineCandidate, reference);
  progress('baseline');
  reports.stages.baseline = baseline;

  const noise = [];
  for (let mask = 0; mask <= 7; mask++) {
    const candidate = { quality: selectedQuality, variant: { integrator: 'rk4', tolerance: 'balanced', noiseMask: mask }, orbits: 4 };
    onProgress?.(done, total, `noise ${mask}/7`);
    const result = mask === 0 ? baseline : await runAutoCandidate(ctx, candidate, reference);
    if (mask !== 0) progress(`noise ${mask}/7`);
    result.visualPass = autoVisualPass(result, baseline);
    result.eligible = gpuEligible(result) && result.visualPass
      && (mask === 0 || result.gpu.medianMs <= baseline.gpu.medianMs * 0.95);
    noise.push(result);
  }
  reports.stages.noise = noise;
  const noiseWinner = noise.filter((x) => x.eligible).reduce(betterByGpu, null) || baseline;

  onProgress?.(done, total, 'orbit 2');
  const orbitTwo = await runAutoCandidate(ctx, {
    quality: selectedQuality,
    variant: noiseWinner.candidate.variant,
    orbits: 2,
  }, reference);
  orbitTwo.visualPass = autoVisualPass(orbitTwo, noiseWinner);
  orbitTwo.eligible = gpuEligible(orbitTwo) && orbitTwo.visualPass
    && orbitTwo.gpu.medianMs < noiseWinner.gpu.medianMs;
  progress('orbit 2');
  reports.stages.orbits = { four: noiseWinner, two: orbitTwo };
  const orbitWinner = orbitTwo.eligible ? orbitTwo : noiseWinner;

  const rkck = [];
  for (const tolerance of ['loose', 'balanced', 'strict']) {
    onProgress?.(done, total, `RKCK ${tolerance}`);
    const result = await runAutoCandidate(ctx, {
      quality: selectedQuality,
      variant: { integrator: 'rkck', tolerance, noiseMask: orbitWinner.candidate.variant.noiseMask },
      orbits: orbitWinner.candidate.orbits,
    }, reference);
    const roiImprovementPct = result.diff.photonRingRoi.rgbMae !== null
      && orbitWinner.diff.photonRingRoi.rgbMae > 0
      ? 100 * (1 - result.diff.photonRingRoi.rgbMae / orbitWinner.diff.photonRingRoi.rgbMae) : null;
    result.roiImprovementPct = roiImprovementPct;
    result.visualPass = autoVisualPass(result, orbitWinner);
    result.eligible = gpuEligible(result) && result.visualPass
      && roiImprovementPct !== null && roiImprovementPct >= 50
      && result.gpu.medianMs <= orbitWinner.gpu.medianMs * 1.2;
    rkck.push(result);
    progress(`RKCK ${tolerance}`);
  }
  reports.stages.rkck = rkck;
  const rkckWinner = rkck.filter((x) => x.eligible).reduce(betterByGpu, null);
  const winner = rkckWinner || orbitWinner;

  reports.selectedQuality = selectedQuality;
  reports.winner = winner;
  reports.promotionEligible = gpuEligible(winner);
  reports.environment = {
    ...ctx.getEnvironment(),
    internal: ctx.getInternal(),
    output: ctx.getOutput(),
  };
  reports.summary = {
    variant: variantLabel(winner.candidate.variant),
    quality: selectedQuality,
    orbits: winner.candidate.orbits,
    gpuMedianMs: winner.gpu.medianMs,
    gpuP95Ms: winner.gpu.p95Ms,
  };
  return { winner, report: reports, promotionEligible: reports.promotionEligible };
}
