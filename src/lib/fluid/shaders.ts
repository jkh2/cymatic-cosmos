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

export const SPLAT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float g = exp(-dot(p, p) / max(uRadius, 1e-6));
  vec4 base = texture(uTarget, vUv);
  fragColor = base + vec4(uColor * g, g);
}
`;

export const VORTEX = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform float uStrength;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  float g = exp(-dot(d, d) / max(uRadius, 1e-6));
  vec2 tang = vec2(-d.y, d.x);
  float len = length(d) + 1e-5;
  tang /= len;
  vec4 base = texture(uTarget, vUv);
  fragColor = base + vec4(tang * (uStrength * g), 0.0, 0.0);
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
  vec2 coord = vUv - uDt * vel * uTexel;
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
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
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
  fragColor = vec4(R - L - T + B, 0.0, 0.0, 1.0);
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
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  float len = length(force) + 1e-5;
  force = (force / len) * uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel += force * uDt;
  float mag = length(vel);
  if (mag > 18.0) vel *= 18.0 / mag;
  fragColor = vec4(vel, 0.0, 1.0);
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
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
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
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel -= vec2(R - L, T - B);
  float mag = length(vel);
  if (mag > 18.0) vel *= 18.0 / mag;
  fragColor = vec4(vel, 0.0, 1.0);
}
`;

export const DIFFUSE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTexture;
uniform vec2 uTexel;
uniform float uAlpha;
uniform float uBeta;
void main() {
  vec4 L = texture(uTexture, vUv - vec2(uTexel.x, 0.0));
  vec4 R = texture(uTexture, vUv + vec2(uTexel.x, 0.0));
  vec4 B = texture(uTexture, vUv - vec2(0.0, uTexel.y));
  vec4 T = texture(uTexture, vUv + vec2(0.0, uTexel.y));
  vec4 C = texture(uTexture, vUv);
  fragColor = (L + R + B + T + uAlpha * C) / uBeta;
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

export const FORCES = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform float uDt;
uniform float uBuoyancy;
uniform float uIdle;
uniform float uStretch;
uniform float uAspect;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec3 dye = texture(uDye, vUv).rgb;
  float dens = dot(dye, vec3(0.299, 0.587, 0.114));
  vel.y += dens * uBuoyancy * uDt;

  vec2 fromC = vUv - vec2(0.5);
  fromC.x *= uAspect;
  vec2 tang = vec2(-fromC.y, fromC.x);
  vel += tang * uIdle * uDt;

  vec2 q = vUv - vec2(0.5);
  q.x *= uAspect;
  float r2 = dot(q, q);
  float env = exp(-r2 / 0.16);
  float r = sqrt(r2) + 1e-4;
  vec2 radial = -q;
  vec2 spin = vec2(-q.y, q.x);
  vec2 spiral = (radial * 0.9 + spin * (0.65 / r)) * env;
  vec2 axial = vec2(0.0, q.y) * env;
  vel += (spiral + axial * 1.4) * uStretch * uDt;

  float wall = smoothstep(0.0, 0.03, vUv.x) * smoothstep(0.0, 0.03, 1.0 - vUv.x)
             * smoothstep(0.0, 0.03, vUv.y) * smoothstep(0.0, 0.03, 1.0 - vUv.y);
  vel *= wall;

  fragColor = vec4(vel, 0.0, 1.0);
}
`;

export const DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uDye;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uPressure;
uniform float uMode;
uniform vec2 uTexel;
uniform vec2 uDyeTexel;
${BILERP}
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.020, 0.024, 0.039);
  vec3 c1 = vec3(0.118, 0.294, 0.420);
  vec3 c2 = vec3(0.306, 0.804, 0.769);
  vec3 c3 = vec3(1.000, 0.420, 0.420);
  vec3 c4 = vec3(0.910, 0.886, 0.839);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 diverging(float x) {
  float t = tanh(x * 0.35);
  vec3 teal = vec3(0.306, 0.804, 0.769);
  vec3 ember = vec3(1.000, 0.420, 0.420);
  vec3 mid = vec3(0.08, 0.07, 0.05);
  if (t < 0.0) return mix(mid, teal, -t);
  return mix(mid, ember, t);
}

void main() {
  vec3 col = vec3(0.020, 0.024, 0.039);
  if (uMode < 0.5) {
    vec3 dye = bilerp(uDye, vUv, uDyeTexel).rgb;
    col = 1.0 - exp(-dye * 0.72);
  } else if (uMode < 1.5) {
    vec2 vel = bilerp(uVelocity, vUv, uTexel).xy;
    float mag = length(vel);
    col = ramp(mag * 0.045);
  } else if (uMode < 2.5) {
    float c = bilerp(uCurl, vUv, uTexel).x;
    col = diverging(c);
  } else {
    float p = bilerp(uPressure, vUv, uTexel).x;
    col = diverging(p * 4.0);
  }
  float v = smoothstep(1.18, 0.28, length(vUv - 0.5));
  col *= mix(0.72, 1.0, v);
  fragColor = vec4(col, 1.0);
}
`;
