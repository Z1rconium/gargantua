// GARGANTUA — GLSL sources (GLSL ES 3.00, used with RawShaderMaterial + glslVersion GLSL3).
//
// The geodesic pass integrates the Binet equation for Schwarzschild null geodesics,
//   u'' = -u + (3/2) rs u^2,  u = 1/r,  rs = 1,
// with RK4 in the ray's orbital plane. Thin-disk crossings are found analytically:
// the plane-crossing anomalies phi_k = phi0 + k*pi are known in closed form, and u(phi)
// is Hermite-interpolated inside the step that brackets each crossing. Multiple
// crossings accumulate front-to-back with transmittance, which produces the upper and
// lower disk images and the higher-order photon-ring images without any geometry.

export const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GEO_FRAG = /* glsl */ `
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uFovTan;

uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskTemp;
uniform float uDiskEmit;
uniform float uDiskDensity;
uniform float uTurb;
uniform float uTurbDetail;
uniform float uFlowSpeed;
uniform float uDoppler;
uniform float uRedshift;

uniform int   uSteps;
uniform float uPhiMax;
uniform float uStarDensity;
uniform float uMilkyWay;
uniform int   uDebug;

#define MAXS 768
const float PI = 3.141592653589793;

/* ---------------- hashing / noise ---------------- */

uint pcg(uint v) {
  v = v * 747796405u + 2891336453u;
  uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}

float hashI(vec3 ip, uint seed) {
  uvec3 q = uvec3(ivec3(ip)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return float(pcg(q.x ^ q.y ^ q.z ^ (seed * 1979u))) * (1.0 / 4294967295.0);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 s = f * f * (3.0 - 2.0 * f);
  float n000 = hashI(i + vec3(0.0, 0.0, 0.0), 5u);
  float n100 = hashI(i + vec3(1.0, 0.0, 0.0), 5u);
  float n010 = hashI(i + vec3(0.0, 1.0, 0.0), 5u);
  float n110 = hashI(i + vec3(1.0, 1.0, 0.0), 5u);
  float n001 = hashI(i + vec3(0.0, 0.0, 1.0), 5u);
  float n101 = hashI(i + vec3(1.0, 0.0, 1.0), 5u);
  float n011 = hashI(i + vec3(0.0, 1.0, 1.0), 5u);
  float n111 = hashI(i + vec3(1.0, 1.0, 1.0), 5u);
  return mix(mix(mix(n000, n100, s.x), mix(n010, n110, s.x), s.y),
             mix(mix(n001, n101, s.x), mix(n011, n111, s.x), s.y), s.z);
}

float fbm(vec3 p) {
  float a = 0.5, r = 0.0;
  for (int i = 0; i < 5; i++) {
    r += a * vnoise(p);
    p = p * 2.03 + vec3(11.7, 5.3, 7.1);
    a *= 0.5;
  }
  return r; /* ~[0,1) */
}

/* ---------------- radiometry ---------------- */

/* Planck radiance sampled at 615/535/465 nm, normalized to white at 6500 K. */
vec3 blackbody(float T) {
  T = clamp(T, 400.0, 120000.0);
  return vec3( 35.56 / (exp(23395.0 / T) - 1.0),
               61.62 / (exp(26893.0 / T) - 1.0),
              115.90 / (exp(30942.0 / T) - 1.0));
}

vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.02, 0.03, 0.12), vec3(0.05, 0.45, 0.70), smoothstep(0.00, 0.35, x));
  c = mix(c, vec3(1.00, 0.65, 0.15), smoothstep(0.35, 0.70, x));
  c = mix(c, vec3(1.0), smoothstep(0.70, 1.00, x));
  return c;
}

/* ---------------- deep field ---------------- */

vec3 starLayer(vec3 d, float grid, float bright, uint seed) {
  vec3 p = d * grid;
  vec3 ip = floor(p);
  vec3 fp = p - ip;
  float presence = hashI(ip, seed);
  float thr = 0.16 * clamp(uStarDensity, 0.0, 3.0);
  if (presence > thr) return vec3(0.0);
  vec3 spos = vec3(hashI(ip, seed + 1u), hashI(ip, seed + 2u), hashI(ip, seed + 3u)) * 0.6 + 0.2;
  float dist = length(fp - spos);
  float m = hashI(ip, seed + 4u);
  float mag = pow(m, 7.0);
  float radius = 0.045 + 0.16 * mag;
  float core = exp(-(dist * dist) / (radius * radius * 0.35));
  float Ts = mix(2500.0, 15000.0, m * m);
  vec3 tint = blackbody(Ts);
  tint /= max(max(tint.r, tint.g), max(tint.b, 1e-4));
  return tint * core * (0.035 + 2.4 * mag) * bright;
}

vec3 skyColor(vec3 d) {
  vec3 col = vec3(0.0);
  col += starLayer(d, 24.0, 1.0, 11u);
  col += starLayer(d, 64.0, 0.55, 37u);
  col += starLayer(d, 141.0, 0.30, 71u);

  /* Milky Way: tilted band with fbm nebulosity, dust lanes and a warm core. */
  const vec3 galN = vec3(0.2481, 0.8535, 0.4368);
  const vec3 galC = vec3(0.9060, 0.0000, -0.4232);
  float band = dot(d, galN);
  float core = dot(d, galC);
  float dens = exp(-band * band * 22.0);
  float neb  = fbm(d * 7.0 + 3.1);
  float fine = fbm(d * 19.0 - 7.7);
  float dust = fbm(d * 11.0 + vec3(4.2, -8.8, 1.5));
  float mw = dens * (0.30 + 0.55 * neb + 0.35 * fine * neb);
  mw *= 1.0 - 0.72 * smoothstep(0.48, 0.78, dust) * dens;
  float coreGlow = pow(max(core, 0.0), 3.0) * dens;
  vec3 mwcol = mix(vec3(0.32, 0.38, 0.62), vec3(1.0, 0.82, 0.60),
                   clamp(0.15 + 0.85 * coreGlow, 0.0, 1.0));
  col += mwcol * (0.10 * mw + 0.32 * coreGlow * (0.3 + 0.7 * neb)) * uMilkyWay;

  /* faint galactic haze floor so the void never dithers to pure black */
  col += vec3(0.0022, 0.0028, 0.0045) * (0.4 + 0.6 * neb) * uMilkyWay;
  return col;
}

/* ---------------- accretion disk ---------------- */

/* Shade one thin-disk crossing.
   P world position (y ~ 0), marchDir unit direction of integration at the crossing
   (camera -> scene), camR camera Schwarzschild radius. Returns emitted radiance;
   alpha is the crossing opacity; dbg = (g-factor, T_local, turbulence). */
vec3 diskSample(vec3 P, vec3 marchDir, float camR, out float alpha, out vec3 dbg) {
  float r = length(P);
  float psi = atan(P.z, P.x);

  /* Keplerian angular velocity (geometric units, M = rs/2 = 1/2): omega = sqrt(M/r^3) */
  float omega = 0.70710678 / (r * sqrt(r));
  float psiM = psi - omega * uTime * uFlowSpeed;   /* material coordinate */
  float a = psiM + 2.6 * log(r);                   /* trailing spiral phase */
  /* the angle enters through (cos,sin), so the noise domain is periodic in psi
     by construction — no radial seam at the atan branch cut */
  vec3 q = vec3(1.8 * cos(a), 1.8 * sin(a), log(r) * 6.0) * uTurbDetail;
  q += uTime * 0.045 * uFlowSpeed * vec3(0.31, 0.17, 0.23);
  float n = fbm(q);
  n = mix(n, fbm(q * 2.7 + 13.1), 0.35);

  float x = clamp((r - uDiskInner) / max(uDiskOuter - uDiskInner, 1e-3), 0.0, 1.0);
  float prof = smoothstep(0.0, 0.06, x) * (0.25 + 0.75 * pow(1.0 - x, 2.2));
  float sigma = prof * mix(1.0, 0.12 + 1.9 * n * n, uTurb);
  alpha = clamp(sigma * uDiskDensity * 0.9, 0.0, 1.0);

  /* Shakura-Sunyaev-like temperature: zero-torque taper at the inner edge */
  float rr = uDiskInner / r;
  float Tloc = uDiskTemp * pow(rr, 0.75) * pow(max(1.0 - 0.985 * sqrt(rr), 1e-3), 0.25);

  /* local orbital speed relative to a static observer: v = sqrt(M/(r - rs)) */
  float v = clamp(sqrt(0.5 / max(r - 1.0, 0.51)), 0.0, 0.985);
  vec3 that = normalize(vec3(-P.z, 0.0, P.x));    /* prograde tangent */
  vec3 nphot = -marchDir;                          /* photon direction disk -> camera */
  float gam = inversesqrt(1.0 - v * v);
  float dopp = 1.0 / (gam * (1.0 - v * dot(that, nphot)));
  float gGrav = sqrt(max(1.0 - 1.0 / r, 0.0)) / sqrt(max(1.0 - 1.0 / camR, 1e-3));
  float g = dopp * gGrav;

  float Tobs = Tloc * mix(1.0, g, clamp(uRedshift, 0.0, 2.0));
  float beam = pow(max(g, 1e-3), 3.0 * uDoppler);

  dbg = vec3(g, Tloc, n);
  vec3 emit = blackbody(Tobs) * (uDiskEmit * beam) * (0.30 + 1.5 * sigma);
  /* inner-edge glow: the material plunging past ISCO stays luminous briefly */
  emit *= 1.0 + 0.6 * exp(-14.0 * (x + 0.02));
  return emit;
}

/* ---------------- main ---------------- */

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uResolution.x / uResolution.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamFwd + uFovTan * (ndc.x * uCamRight + ndc.y * uCamUp));

  float r0 = length(ro);
  vec3 er = ro / r0;
  float ddr = dot(rd, er);
  vec3 perp = rd - ddr * er;
  float pl = length(perp);

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  bool escaped = false;
  bool captured = false;
  vec3 escDir = rd;

  int stepsUsed = 0;
  int nCross = 0;
  vec3 dbgFirst = vec3(0.0);
  float bImpact = r0 * pl / sqrt(max(1.0 - 1.0 / r0, 0.01));

  if (pl < 1e-4) {
    /* exactly radial ray: falls in or leaves in a straight line */
    if (ddr < 0.0) captured = true;
    else { escaped = true; escDir = rd; }
  } else {
    vec3 ep = perp / pl;
    float u = 1.0 / r0;
    float w = -u * ddr / pl;   /* du/dphi */
    float phi = 0.0;

    float rEsc = max(r0, uDiskOuter) * 1.15 + 2.0;
    float uEsc = 1.0 / rEsc;

    /* analytic plane-crossing anomalies: A cos(phi) + B sin(phi) = 0 */
    float A = er.y, B = ep.y;
    bool hasCross = (abs(A) + abs(B)) > 1e-6;
    float nextCross = 1e9;
    if (hasCross) {
      float phi0 = atan(-A, B);
      nextCross = phi0 + ceil((1e-3 - phi0) / PI) * PI;
    }

    float h = uPhiMax / float(uSteps);

    for (int i = 0; i < MAXS; i++) {
      if (i >= uSteps) break;
      float u0 = u, w0 = w, phi0i = phi;

      /* RK4 on u'' = 1.5 u^2 - u */
      float k1u = w0;
      float k1w = 1.5 * u0 * u0 - u0;
      float au = u0 + 0.5 * h * k1u;
      float k2u = w0 + 0.5 * h * k1w;
      float k2w = 1.5 * au * au - au;
      float bu = u0 + 0.5 * h * k2u;
      float k3u = w0 + 0.5 * h * k2w;
      float k3w = 1.5 * bu * bu - bu;
      float cu = u0 + h * k3u;
      float k4u = w0 + h * k3w;
      float k4w = 1.5 * cu * cu - cu;
      u = u0 + (h / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
      w = w0 + (h / 6.0) * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
      phi += h;
      stepsUsed++;

      if (u > 1.0 || u > 1e4) { captured = true; break; }

      if (hasCross && phi >= nextCross) {
        float t = clamp((nextCross - phi0i) / h, 0.0, 1.0);
        float t2 = t * t, t3 = t2 * t;
        float uc = (2.0 * t3 - 3.0 * t2 + 1.0) * u0 + (t3 - 2.0 * t2 + t) * h * w0
                 + (-2.0 * t3 + 3.0 * t2) * u + (t3 - t2) * h * w;
        float wc = mix(w0, w, t);
        if (uc > 1e-6) {
          float rc = 1.0 / uc;
          if (rc > uDiskInner && rc < uDiskOuter && trans > 0.012) {
            float cph = cos(nextCross), sph = sin(nextCross);
            vec3 erp = cph * er + sph * ep;
            vec3 epp = -sph * er + cph * ep;
            vec3 P = rc * erp;
            vec3 mdir = normalize((-wc / (uc * uc)) * erp + rc * epp);
            float alphaC; vec3 dbgC;
            vec3 emit = diskSample(P, mdir, r0, alphaC, dbgC);
            if (uDebug != 1) {
              acc += trans * emit * alphaC;
              trans *= 1.0 - alphaC;
            }
            nCross++;
            if (nCross == 1) dbgFirst = dbgC;
          }
        }
        nextCross += PI;
      }

      if (u < uEsc && w < 0.0) {
        float cph = cos(phi), sph = sin(phi);
        vec3 erp = cph * er + sph * ep;
        vec3 epp = -sph * er + cph * ep;
        escDir = normalize((-w / (u * u)) * erp + (1.0 / u) * epp);
        escaped = true;
        break;
      }
    }
    if (!escaped && !captured) captured = true; /* wound past phi budget: inside the ring */
  }

  vec3 col = acc;
  if (escaped && uDebug != 2) col += trans * skyColor(escDir);
  /* captured -> horizon: contributes nothing. The shadow stays deep black. */

  /* ---------------- debug views ---------------- */
  if (uDebug == 3) col = heat(float(stepsUsed) / float(uSteps));
  else if (uDebug == 4) col = heat(float(nCross) / 5.0);
  else if (uDebug == 5) {
    col = heat(clamp(bImpact / 8.0, 0.0, 1.0)) * 0.85;
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.05, abs(bImpact - 2.5981)));
  }
  else if (uDebug == 6) {
    if (nCross > 0) {
      float gx = clamp((dbgFirst.x - 1.0) * 1.6, -1.0, 1.0);
      col = gx > 0.0 ? mix(vec3(1.0), vec3(0.30, 0.55, 1.00), gx)
                     : mix(vec3(1.0), vec3(1.00, 0.25, 0.15), -gx);
    } else col = vec3(0.0);
  }
  else if (uDebug == 7) col = nCross > 0 ? blackbody(dbgFirst.y) * 0.55 : vec3(0.0);
  else if (uDebug == 8) col = vec3(nCross > 0 ? dbgFirst.z : 0.0);
  else if (uDebug == 9) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = heat(log2(1.0 + lum) / 4.0);
  }

  outColor = vec4(col, 1.0);
}
`;

/* ---------------- post: threshold bright pass ---------------- */

export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
uniform float uThr;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uThr * 0.5 + 1e-4;
  float soft = clamp(l - uThr + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float f = max(soft, l - uThr) / max(l, 1e-4);
  outColor = vec4(c * f, 1.0);
}
`;

/* ---------------- post: separable gaussian ---------------- */

export const BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
uniform vec2 uDir; /* texel-scaled direction */
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  c += texture(tSrc, vUv + o1).rgb * 0.3162162162;
  c += texture(tSrc, vUv - o1).rgb * 0.3162162162;
  c += texture(tSrc, vUv + o2).rgb * 0.0702702703;
  c += texture(tSrc, vUv - o2).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}
`;

/* ---------------- post: combine, dispersion, ACES, vignette, grain ---------------- */

export const FINAL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D tScene;
uniform sampler2D tB0;
uniform sampler2D tB1;
uniform sampler2D tB2;
uniform sampler2D tB3;
uniform vec2  uRes;
uniform float uExposure;
uniform float uBloom;
uniform float uVignette;
uniform float uGrain;
uniform float uChroma;
uniform float uTimePost;
uniform int   uBypass;

uint pcg(uint v) {
  v = v * 747796405u + 2891336453u;
  uint w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(vec2 fc, float t) {
  uint n = uint(fc.x) * 1973u ^ uint(fc.y) * 9277u ^ uint(t * 1000.0) * 26699u;
  return float(pcg(n)) * (1.0 / 4294967295.0);
}

vec3 fetch(vec2 uv) {
  vec3 c = texture(tScene, uv).rgb;
  vec3 b = texture(tB0, uv).rgb * 0.390
         + texture(tB1, uv).rgb * 0.268
         + texture(tB2, uv).rgb * 0.195
         + texture(tB3, uv).rgb * 0.147;
  return c + uBloom * b;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  if (uBypass == 1) {
    outColor = vec4(srgb(clamp(texture(tScene, vUv).rgb, 0.0, 1.0)), 1.0);
    return;
  }

  vec2 cv = vUv - 0.5;
  float d2 = dot(cv, cv);
  vec2 off = cv * d2 * uChroma * 0.020;

  vec3 col;
  col.r = fetch(vUv - off).r;
  col.g = fetch(vUv).g;
  col.b = fetch(vUv + off).b;

  col *= uExposure;
  col = aces(col);

  float aspect = uRes.x / max(uRes.y, 1.0);
  float vr = length(cv * vec2(mix(1.0, aspect, 0.5), 1.0));
  col *= 1.0 - uVignette * smoothstep(0.30, 0.85, vr);

  float g = rnd(gl_FragCoord.xy, uTimePost) - 0.5;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * uGrain * 0.055 * (0.35 + 0.65 * (1.0 - lum));
  col += (rnd(gl_FragCoord.xy + 31.7, uTimePost + 7.0) - 0.5) / 255.0; /* dither */

  outColor = vec4(srgb(col), 1.0);
}
`;
