export const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const BILERP = `
vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / max(tsize, vec2(1e-6)) - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
`;

const CHLADNI = `
const float PI = 3.14159265;
float chladni(vec2 q, float n, float m, float s) {
  return cos(n * PI * q.x) * cos(m * PI * q.y) + s * cos(m * PI * q.x) * cos(n * PI * q.y);
}
vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

const CLAMP_VEL = `
vec2 clampVel(vec2 v, float maxV) {
  float m = length(v);
  return m > maxV ? v * (maxV / m) : v;
}
`;

export const MAX_SPLATS = 40;

/**
 * Many gaussian splats in one pass. For dye the add saturates as a cell
 * fills and the result is capped, so no pile-up of emitters can wash the
 * field white. For velocity the result is clamped.
 */
export const MULTISPLAT = `#version 300 es
precision highp float;
#define MAXP ${MAX_SPLATS}
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform int uCount;
uniform vec4 uP[MAXP];
uniform vec4 uV[MAXP];
uniform float uAspect;
uniform float uDye;
uniform float uCap;
uniform float uMaxVel;
${CLAMP_VEL}
void main() {
  vec4 base = texture(uTarget, vUv);
  vec3 add = vec3(0.0);
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    vec2 d = vUv - uP[i].xy;
    d.x *= uAspect;
    float g = exp(-dot(d, d) * uP[i].z);
    add += uV[i].xyz * g;
  }
  if (uDye > 0.5) {
    float m = max(base.r, max(base.g, base.b));
    add *= 1.0 / (1.0 + m * m * 1.2);
    fragColor = vec4(min(base.rgb + add, vec3(uCap)), 1.0);
  } else {
    fragColor = vec4(clampVel(base.xy + add.xy, uMaxVel), 0.0, 1.0);
  }
}
`;

/** A Chladni plate figure pressed into the dye; the current then carries it away. */
export const PATTERN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uAspect;
uniform vec4 uMode;
uniform vec3 uColor;
uniform float uCap;
${CHLADNI}
void main() {
  vec4 base = texture(uTarget, vUv);
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  vec2 q = rot2(d / uRadius, uMode.z);
  float r = length(q);
  float f = chladni(q, uMode.x, uMode.y, uMode.w < 0.0 ? -1.0 : 1.0);
  float w = fwidth(f) * 1.8 + 0.02;
  float line = 1.0 - smoothstep(0.0, w, abs(f));
  float mask = smoothstep(1.0, 0.55, r);
  vec3 add = uColor * line * mask * abs(uMode.w);
  float m = max(base.r, max(base.g, base.b));
  add *= 1.0 / (1.0 + m * m * 1.2);
  fragColor = vec4(min(base.rgb + add, vec3(uCap)), 1.0);
}
`;

export const ADVECT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform vec2 uVelTexel;
uniform float uDt;
uniform float uDissipation;
${BILERP}
void main() {
  vec2 vel = bilerp(uVelocity, vUv, uVelTexel).xy;
  vec2 coord = vUv - uDt * vel * uVelTexel;
  fragColor = uDissipation * bilerp(uSource, coord, uTexel);
}
`;

export const DIVERGENCE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  vec2 C = texture(uVelocity, vUv).xy;
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  if (vUv.x - uTexel.x < 0.0) L = -C.x;
  if (vUv.x + uTexel.x > 1.0) R = -C.x;
  if (vUv.y - uTexel.y < 0.0) B = -C.y;
  if (vUv.y + uTexel.y > 1.0) T = -C.y;
  fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

export const CURL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  fragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

export const VORTICITY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;
uniform float uMaxVel;
${CLAMP_VEL}
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  float len = length(force) + 1e-4;
  force = (force / len) * uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy + force * uDt;
  fragColor = vec4(clampVel(vel, uMaxVel), 0.0, 1.0);
}
`;

export const PRESSURE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float C = texture(uPressure, vUv).x;
  float L = vUv.x - uTexel.x < 0.0 ? C : texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = vUv.x + uTexel.x > 1.0 ? C : texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = vUv.y - uTexel.y < 0.0 ? C : texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = vUv.y + uTexel.y > 1.0 ? C : texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  fragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform float uMaxVel;
${CLAMP_VEL}
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  fragColor = vec4(clampVel(vel, uMaxVel), 0.0, 1.0);
}
`;

export const CLEAR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform float uValue;
void main() {
  fragColor = uValue * texture(uTexture, vUv);
}
`;

/**
 * The current. A slowly turning stream function gives a divergence-free
 * drift (nothing for the pressure solve to fight, so no tearing), plus a
 * faint turn about the center and a little buoyancy for smoke.
 */
export const FORCES = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform float uDt;
uniform float uTime;
uniform float uAmbient;
uniform float uSwirl;
uniform float uBuoyancy;
uniform float uAspect;
uniform vec2 uCenter;
uniform float uMaxVel;
${CLAMP_VEL}
float psi(vec2 p, float t) {
  return 0.55 * sin(1.9 * p.x + 0.21 * t) * cos(1.5 * p.y - 0.17 * t)
       + 0.32 * sin(3.1 * p.y + 1.7 + 0.13 * t) * cos(2.6 * p.x - 0.29 * t + 0.6)
       + 0.16 * sin(5.3 * (p.x + 0.7 * p.y) - 0.41 * t);
}
uniform vec2 uTexel;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  // Damp the odd-even checkerboard a collocated grid breeds. Left alone it
  // grows under vorticity confinement into the cellular mosaic tear.
  vec2 nb = 0.25 * (texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).xy
                  + texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).xy
                  + texture(uVelocity, vUv + vec2(0.0, uTexel.y)).xy
                  + texture(uVelocity, vUv - vec2(0.0, uTexel.y)).xy);
  vel = mix(vel, nb, 0.3);
  vec3 dye = texture(uDye, vUv).rgb;
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.4;
  float e = 0.01;
  float dpdx = (psi(p + vec2(e, 0.0), uTime) - psi(p - vec2(e, 0.0), uTime)) / (2.0 * e);
  float dpdy = (psi(p + vec2(0.0, e), uTime) - psi(p - vec2(0.0, e), uTime)) / (2.0 * e);
  vel += vec2(dpdy, -dpdx) * uAmbient * uDt;

  vec2 q = vUv - uCenter;
  q.x *= uAspect;
  float env = exp(-dot(q, q) / 0.12);
  vel += vec2(-q.y, q.x) * uSwirl * env * uDt;

  float dens = max(dye.r, max(dye.g, dye.b));
  vel.y += dens * uBuoyancy * uDt;

  float wall = smoothstep(0.0, 0.025, vUv.x) * smoothstep(0.0, 0.025, 1.0 - vUv.x)
             * smoothstep(0.0, 0.025, vUv.y) * smoothstep(0.0, 0.025, 1.0 - vUv.y);
  fragColor = vec4(clampVel(vel * wall, uMaxVel), 0.0, 1.0);
}
`;

export const MAX_GLOWS = 6;

/**
 * Dye on a true-black ground (empty dye stays black), faint stars that hide
 * under smoke, and short-lived Chladni glows at the center gate.
 */
export const DISPLAY = `#version 300 es
precision highp float;
#define MAXG ${MAX_GLOWS}
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDye;
uniform sampler2D uCurl;
uniform float uMode;
uniform vec2 uTexel;
uniform vec2 uDyeTexel;
uniform float uExposure;
uniform float uAspect;
uniform float uTime;
uniform float uStarScale;
uniform vec2 uCenter;
uniform vec4 uGlowPos[MAXG];
uniform vec4 uGlowMode[MAXG];
uniform vec3 uGlowColor[MAXG];
${BILERP}
${CHLADNI}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec3 col;
  if (uMode < 0.5) {
    // Hue-preserving tone map: the brightest channel rolls off, the others
    // keep their ratio to it, so dense smoke stays colored instead of whitening.
    vec3 dye = max(bilerp(uDye, vUv, uDyeTexel).rgb, vec3(0.0));
    float peak = max(dye.r, max(dye.g, dye.b));
    col = peak > 1e-5 ? dye * ((1.0 - exp(-peak * uExposure)) / peak) : vec3(0.0);
  } else {
    float c = bilerp(uCurl, vUv, uTexel).x;
    float t = tanh(c * 0.12);
    col = t < 0.0 ? vec3(0.306, 0.804, 0.769) * -t : vec3(1.0, 0.52, 0.30) * t;
  }
  float lum = max(col.r, max(col.g, col.b));

  float cs = 6.0 * uStarScale;
  vec2 px = gl_FragCoord.xy;
  vec2 cell = floor(px / cs);
  float h = hash(cell);
  if (h > 0.991) {
    vec2 jitter = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
    vec2 c = (cell + 0.5 + jitter * 0.6) * cs;
    float d = length(px - c) / uStarScale;
    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + h * 2.2) + h * 91.0);
    float s = exp(-d * d / 0.8) * tw * (0.3 + (h - 0.991) * 70.0);
    col += vec3(0.78, 0.84, 1.0) * s * (1.0 - clamp(lum * 2.5, 0.0, 1.0));
  }

  for (int i = 0; i < MAXG; i++) {
    float k = uGlowMode[i].w;
    if (k <= 0.002) continue;
    vec2 d = vUv - uGlowPos[i].xy;
    d.x *= uAspect;
    vec2 q = rot2(d / uGlowPos[i].z, uGlowPos[i].w);
    float r = length(q);
    if (r > 1.05) continue;
    float f = chladni(q, uGlowMode[i].x, uGlowMode[i].y, uGlowMode[i].z);
    float w = fwidth(f);
    float core = 1.0 - smoothstep(0.0, w * 1.3, abs(f));
    float halo = 1.0 - smoothstep(0.0, w * 5.0, abs(f));
    float mask = smoothstep(1.0, 0.45, r);
    col += uGlowColor[i] * (core * 0.85 + halo * 0.22) * mask * k;
  }

  vec2 v = vUv - uCenter;
  v.x *= uAspect;
  col *= mix(0.6, 1.0, smoothstep(1.2, 0.3, length(v)));
  fragColor = vec4(col, 1.0);
}
`;
