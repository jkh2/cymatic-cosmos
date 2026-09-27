/**
 * Orbit camera for the relief view. The smoke sheet lies in the XZ plane:
 * x = (u - 0.5) * aspect, z = 0.5 - v, height along +y. Pitch is the angle
 * above the sheet (90° looks straight down, matching the flat view).
 */
export interface Cam {
  yaw: number;
  pitch: number;
  dist: number;
  target: [number, number, number];
  fov: number;
}

type V3 = [number, number, number];

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function basis(cam: Cam) {
  const cp = Math.cos(cam.pitch);
  const off: V3 = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
  const eye: V3 = [cam.target[0] + off[0] * cam.dist, cam.target[1] + off[1] * cam.dist, cam.target[2] + off[2] * cam.dist];
  const f: V3 = [-off[0], -off[1], -off[2]];
  const r: V3 = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const u = cross(r, f);
  return { eye, f, r, u };
}

/** Column-major projection × view. */
export function viewProj(cam: Cam, aspect: number) {
  const { eye, f, r, u } = basis(cam);
  const near = 0.02;
  const far = 20;
  const t = 1 / Math.tan(cam.fov / 2);
  const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += P[k * 4 + row] * V[c * 4 + k];
      out[c * 4 + row] = s;
    }
  }
  return { matrix: out, eye };
}

/** World point to CSS pixels. `k` is a perspective size factor (1 at the target distance). */
export function project(vp: Float32Array, w: number, h: number, p: V3, dist: number) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (cw <= 0.01) return null;
  return { x: (x / cw * 0.5 + 0.5) * w, y: (1 - (y / cw * 0.5 + 0.5)) * h, k: dist / cw };
}

/** Screen pixel to sheet uv, by casting a ray onto the y = 0 plane. */
export function screenToUv(cam: Cam, w: number, h: number, sx: number, sy: number, aspect: number) {
  const { eye, f, r, u } = basis(cam);
  const t = Math.tan(cam.fov / 2);
  const nx = (sx / w) * 2 - 1;
  const ny = 1 - (sy / h) * 2;
  const vw = w / h;
  const d: V3 = [
    f[0] + nx * t * vw * r[0] + ny * t * u[0],
    f[1] + nx * t * vw * r[1] + ny * t * u[1],
    f[2] + nx * t * vw * r[2] + ny * t * u[2],
  ];
  if (d[1] > -1e-4) return null;
  const s = -eye[1] / d[1];
  const px = eye[0] + s * d[0];
  const pz = eye[2] + s * d[2];
  return { x: px / aspect + 0.5, y: 0.5 - pz };
}

export const uvToWorld = (x: number, y: number, aspect: number, height = 0): V3 => [(x - 0.5) * aspect, height, 0.5 - y];
