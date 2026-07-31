// GARGANTUA — static configuration: parameter schema (exactly 21), quality tiers,
// camera presets, debug views, key map. Units: Schwarzschild radius r_s = 1.

export const STORAGE_KEY = 'gargantua.v1';

// The 21 parameters. min/max are UI bounds; def is the shipped default.
export const PARAM_SCHEMA = [
  // ACCRETION DISK (8)
  { key: 'diskInner',   label: 'Inner radius',     unit: 'rs', min: 1.6,  max: 6,     step: 0.05, def: 3.0,   group: 'Accretion disk', d: 2 },
  { key: 'diskOuter',   label: 'Outer radius',     unit: 'rs', min: 6,    max: 30,    step: 0.25, def: 14.0,  group: 'Accretion disk', d: 1 },
  { key: 'diskTemp',    label: 'Temperature',      unit: 'K',  min: 3000, max: 30000, step: 100,  def: 9000,  group: 'Accretion disk', d: 0 },
  { key: 'diskEmit',    label: 'Emission gain',    unit: '',   min: 0,    max: 4,     step: 0.02, def: 1.25,  group: 'Accretion disk', d: 2 },
  { key: 'diskDensity', label: 'Optical density',  unit: '',   min: 0,    max: 3,     step: 0.02, def: 1.0,   group: 'Accretion disk', d: 2 },
  { key: 'turbulence',  label: 'Turbulence',       unit: '',   min: 0,    max: 1,     step: 0.01, def: 0.65,  group: 'Accretion disk', d: 2 },
  { key: 'turbDetail',  label: 'Turbulence scale', unit: '',   min: 0.2,  max: 2.5,   step: 0.01, def: 1.0,   group: 'Accretion disk', d: 2 },
  { key: 'flowSpeed',   label: 'Orbital flow',     unit: '×',  min: 0,    max: 4,     step: 0.02, def: 1.0,   group: 'Accretion disk', d: 2 },
  // RELATIVITY (2)
  { key: 'doppler',     label: 'Doppler beaming',  unit: '',   min: 0,    max: 2,     step: 0.01, def: 1.0,   group: 'Relativity', d: 2 },
  { key: 'redshift',    label: 'Redshift',         unit: '',   min: 0,    max: 2,     step: 0.01, def: 1.0,   group: 'Relativity', d: 2 },
  // INTEGRATOR (2)
  { key: 'steps',       label: 'Geodesic steps',   unit: '',   min: 96,   max: 768,   step: 8,    def: 288,   group: 'Integrator', d: 0 },
  { key: 'maxOrbits',   label: 'Max windings',     unit: 'τ',  min: 0.75, max: 4,     step: 0.05, def: 2.0,   group: 'Integrator', d: 2 },
  // DEEP FIELD (2)
  { key: 'starDensity', label: 'Star density',     unit: '',   min: 0,    max: 3,     step: 0.02, def: 1.0,   group: 'Deep field', d: 2 },
  { key: 'milkyWay',    label: 'Milky way',        unit: '',   min: 0,    max: 2.5,   step: 0.02, def: 1.0,   group: 'Deep field', d: 2 },
  // OPTICS (1)
  { key: 'fov',         label: 'Field of view',    unit: '°',  min: 25,   max: 110,   step: 1,    def: 62,    group: 'Optics', d: 0 },
  // FILM GRADE (6)
  { key: 'exposure',    label: 'Exposure',         unit: 'EV', min: 0.1,  max: 3,     step: 0.02, def: 1.15,  group: 'Film grade', d: 2 },
  { key: 'bloom',       label: 'Bloom strength',   unit: '',   min: 0,    max: 2,     step: 0.02, def: 0.7,   group: 'Film grade', d: 2 },
  { key: 'bloomThr',    label: 'Bloom threshold',  unit: '',   min: 0,    max: 2,     step: 0.02, def: 0.85,  group: 'Film grade', d: 2 },
  { key: 'vignette',    label: 'Vignette',         unit: '',   min: 0,    max: 1,     step: 0.01, def: 0.42,  group: 'Film grade', d: 2 },
  { key: 'grain',       label: 'Film grain',       unit: '',   min: 0,    max: 1,     step: 0.01, def: 0.28,  group: 'Film grade', d: 2 },
  { key: 'chroma',      label: 'Dispersion',       unit: '',   min: 0,    max: 1,     step: 0.01, def: 0.35,  group: 'Film grade', d: 2 },
];

export const PARAM_COUNT = PARAM_SCHEMA.length; // must be 21

export function defaultParams() {
  const p = {};
  for (const s of PARAM_SCHEMA) p[s.key] = s.def;
  return p;
}

// Quality tiers: internal render scale for the geodesic pass (relative to CSS px),
// device-pixel-ratio cap, and the default geodesic step count applied on switch.
export const QUALITY = {
  standard:  { label: 'STD',  renderScale: 0.62, dprCap: 1.5, steps: 176 },
  high:      { label: 'HIGH', renderScale: 0.85, dprCap: 2.0, steps: 288 },
  cinematic: { label: 'CINE', renderScale: 1.0,  dprCap: 2.0, steps: 420 },
};
export const QUALITY_ORDER = ['standard', 'high', 'cinematic'];

// Camera presets: spherical coords around the singularity (radius in rs,
// polar from +y axis in degrees, azimuth degrees) + field of view.
export const PRESETS = [
  { name: 'EQUATORIAL',   radius: 16.5, polar: 84, azimuth: -25, fov: 58 },
  { name: 'ORBITAL',      radius: 9.5,  polar: 72, azimuth: 35,  fov: 55 },
  { name: 'POLAR',        radius: 17,   polar: 14, azimuth: 0,   fov: 48 },
  { name: 'PHOTON RING',  radius: 5.4,  polar: 83, azimuth: 110, fov: 40 },
];

export const DEBUG_NAMES = [
  'BEAUTY',
  'LENSED DEEP FIELD',
  'DISK ISOLATED',
  'INTEGRATION STEPS',
  'PLANE CROSSINGS',
  'IMPACT PARAMETER',
  'G-FACTOR (DOPPLER×GRAV)',
  'DISK TEMPERATURE',
  'TURBULENCE FIELD',
  'HDR LUMINANCE',
];

// Cinematic loop: exact period so the shot loops seamlessly.
export const CINE_PERIOD = 120; // seconds
