import * as S from "./shaders";

export type FluidView = "dye" | "vorticity";
export type FluidQuality = "low" | "medium" | "high";

export interface FluidParams {
  /** Dye fade per second of real time. Higher fades faster. */
  dissipation: number;
  /** Velocity fade per second of real time. */
  velocityDissipation: number;
  vorticity: number;
  buoyancy: number;
  /** Strength of the divergence-free background current. */
  ambient: number;
  /** Gentle turn about the score center. */
  swirl: number;
  /** tempo / 96 — speeds advection and forces, never dissipation. */
  motion: number;
  /** Velocity ceiling in sim texels per second. */
  maxVelocity: number;
  exposure: number;
  view: FluidView;
  quality: FluidQuality;
}

export interface Glow {
  x: number;
  y: number;
  /** Radius in uv-height units. */
  radius: number;
  rotation: number;
  n: number;
  m: number;
  sign: number;
  intensity: number;
  color: [number, number, number];
  /** How far the figure reaches, in plate radii, before it fades out. */
  spread?: number;
}

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texel: [number, number];
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap: () => void;
}

interface Program {
  id: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface PatternJob {
  x: number;
  y: number;
  radius: number;
  n: number;
  m: number;
  rotation: number;
  amount: number;
  color: [number, number, number];
  spread?: number;
}

const QUALITY: Record<FluidQuality, { sim: number; dye: number; pressure: number }> = {
  low: { sim: 112, dye: 540, pressure: 16 },
  medium: { sim: 160, dye: 900, pressure: 22 },
  high: { sim: 224, dye: 1280, pressure: 28 },
};

const DYE_CAP = 2.0;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Failed to create shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    const log = gl.getShaderInfoLog(sh) || "empty log";
    gl.deleteShader(sh);
    throw new Error(`${kind} shader: ${log}`);
  }
  return sh;
}

function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const prog = gl.createProgram();
  if (!prog) throw new Error("Failed to create program");
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? "program link failed");
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(prog, info.name);
  }
  return { id: prog, uniforms };
}

function supportFormat(gl: WebGL2RenderingContext, internal: number, format: number, type: number) {
  const tex = gl.createTexture();
  if (!tex) return false;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 8, 8, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return ok;
}

/** Float targets sampled NEAREST with manual bilerp, so mobile GPUs without linear-float filtering still work. */
function pickFormat(gl: WebGL2RenderingContext) {
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_color_buffer_half_float");
  if (supportFormat(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)) {
    return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
  }
  if (supportFormat(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT)) {
    return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
  }
  throw new Error("This GPU cannot render float textures, which the smoke needs.");
}

function resolution(res: number, width: number, height: number) {
  let aspect = width / Math.max(height, 1);
  if (aspect < 1) aspect = 1 / aspect;
  const min = Math.round(res);
  const max = Math.round(res * aspect);
  return width > height ? { width: max, height: min } : { width: min, height: max };
}

export class FluidEngine {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private format: ReturnType<typeof pickFormat>;
  private programs: Record<
    | "multisplat"
    | "pattern"
    | "advect"
    | "divergence"
    | "curl"
    | "vorticity"
    | "pressure"
    | "gradient"
    | "clear"
    | "forces"
    | "display",
    Program
  >;
  private vao: WebGLVertexArrayObject;
  private dye!: DoubleFBO;
  private velocity!: DoubleFBO;
  private pressure!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  params: FluidParams;
  private lastQuality: FluidQuality;
  private lastW = 0;
  private lastH = 0;
  private time = 0;
  private realTime = 0;
  /** Score center in uv, used for swirl and vignette. */
  center: [number, number] = [0.5, 0.5];
  private splatP = new Float32Array(S.MAX_SPLATS * 4);
  private splatVel = new Float32Array(S.MAX_SPLATS * 4);
  private splatDye = new Float32Array(S.MAX_SPLATS * 4);
  private splatCount = 0;
  private patterns: PatternJob[] = [];
  private glows: Glow[] = [];
  private glowPos = new Float32Array(S.MAX_GLOWS * 4);
  private glowMode = new Float32Array(S.MAX_GLOWS * 4);
  private glowColor = new Float32Array(S.MAX_GLOWS * 3);
  private glowSpread = new Float32Array(S.MAX_GLOWS);
  destroyed = false;

  constructor(canvas: HTMLCanvasElement, params: FluidParams) {
    this.canvas = canvas;
    this.params = { ...params };
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is required for the smoke field.");
    this.gl = gl;
    this.format = pickFormat(gl);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    this.programs = {
      multisplat: makeProgram(gl, S.VERT, S.MULTISPLAT),
      pattern: makeProgram(gl, S.VERT, S.PATTERN),
      advect: makeProgram(gl, S.VERT, S.ADVECT),
      divergence: makeProgram(gl, S.VERT, S.DIVERGENCE),
      curl: makeProgram(gl, S.VERT, S.CURL),
      vorticity: makeProgram(gl, S.VERT, S.VORTICITY),
      pressure: makeProgram(gl, S.VERT, S.PRESSURE),
      gradient: makeProgram(gl, S.VERT, S.GRADIENT),
      clear: makeProgram(gl, S.VERT, S.CLEAR),
      forces: makeProgram(gl, S.VERT, S.FORCES),
      display: makeProgram(gl, S.VERT, S.DISPLAY),
    };

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.lastQuality = params.quality;
    this.resize(true);
  }

  get aspect() {
    return this.canvas.width / Math.max(this.canvas.height, 1);
  }

  setParams(next: Partial<FluidParams>) {
    Object.assign(this.params, next);
    if (next.quality && next.quality !== this.lastQuality) {
      this.lastQuality = next.quality;
      this.resize(true);
    }
  }

  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (this.canvas.clientWidth < 4 || this.canvas.clientHeight < 4) return;
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (!force && w === this.lastW && h === this.lastH) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.lastW = w;
    this.lastH = h;
    const q = QUALITY[this.params.quality];
    const sim = resolution(q.sim, w, h);
    const dye = resolution(q.dye, w, h);
    this.velocity = this.makeDouble(sim.width, sim.height);
    this.dye = this.makeDouble(dye.width, dye.height);
    this.pressure = this.makeDouble(sim.width, sim.height);
    this.divergence = this.makeFBO(sim.width, sim.height);
    this.curl = this.makeFBO(sim.width, sim.height);
  }

  private makeFBO(width: number, height: number): FBO {
    const gl = this.gl;
    const { internal, format, type } = this.format;
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error("Failed to allocate field buffer");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, fbo, width, height, texel: [1 / width, 1 / height] };
  }

  private makeDouble(width: number, height: number): DoubleFBO {
    let a = this.makeFBO(width, height);
    let b = this.makeFBO(width, height);
    return {
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      swap() {
        const t = a;
        a = b;
        b = t;
      },
    };
  }

  private blit(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bind(unit: number, texture: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  /**
   * Queue a splat for the next step.
   * x, y in uv. vx, vy in uv per second (added to the flow).
   * sigma is the gaussian width in uv-height units. dye is added color.
   */
  splat(
    x: number,
    y: number,
    vx: number,
    vy: number,
    dye: [number, number, number],
    sigma: number,
  ) {
    if (this.splatCount >= S.MAX_SPLATS || !this.velocity) return;
    const i = this.splatCount++;
    const sim = this.velocity.read;
    this.splatP[i * 4] = x;
    this.splatP[i * 4 + 1] = y;
    this.splatP[i * 4 + 2] = 1 / Math.max(sigma * sigma, 1e-7);
    this.splatVel[i * 4] = vx * sim.width;
    this.splatVel[i * 4 + 1] = vy * sim.height;
    this.splatDye[i * 4] = dye[0];
    this.splatDye[i * 4 + 1] = dye[1];
    this.splatDye[i * 4 + 2] = dye[2];
  }

  get splatRoom() {
    return S.MAX_SPLATS - this.splatCount;
  }

  pattern(job: PatternJob) {
    if (this.patterns.length < 6) this.patterns.push(job);
  }

  setGlows(glows: Glow[]) {
    this.glows = glows;
  }

  clear() {
    const gl = this.gl;
    if (!this.dye) return;
    for (const fbo of [
      this.dye.read,
      this.dye.write,
      this.velocity.read,
      this.velocity.write,
      this.pressure.read,
      this.pressure.write,
      this.divergence,
      this.curl,
    ]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, fbo.width, fbo.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  private flushSplats() {
    const n = this.splatCount;
    if (!n) return;
    const gl = this.gl;
    const p = this.programs.multisplat;
    gl.useProgram(p.id);
    gl.uniform1i(p.uniforms.uCount, n);
    gl.uniform4fv(p.uniforms.uP, this.splatP);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform1f(p.uniforms.uCap, DYE_CAP);
    gl.uniform1f(p.uniforms.uMaxVel, this.params.maxVelocity);

    this.bind(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uTarget, 0);
    gl.uniform1f(p.uniforms.uDye, 0);
    gl.uniform4fv(p.uniforms.uV, this.splatVel);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.bind(0, this.dye.read.texture);
    gl.uniform1f(p.uniforms.uDye, 1);
    gl.uniform4fv(p.uniforms.uV, this.splatDye);
    this.blit(this.dye.write);
    this.dye.swap();

    this.splatCount = 0;
  }

  private flushPatterns() {
    if (!this.patterns.length) return;
    const gl = this.gl;
    const p = this.programs.pattern;
    gl.useProgram(p.id);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform1f(p.uniforms.uCap, DYE_CAP);
    for (const job of this.patterns) {
      this.bind(0, this.dye.read.texture);
      gl.uniform1i(p.uniforms.uTarget, 0);
      gl.uniform2f(p.uniforms.uPoint, job.x, job.y);
      gl.uniform1f(p.uniforms.uRadius, job.radius);
      gl.uniform4f(p.uniforms.uMode, job.n, job.m, job.rotation, job.amount);
      gl.uniform3f(p.uniforms.uColor, job.color[0], job.color[1], job.color[2]);
      gl.uniform1f(p.uniforms.uSpread, job.spread ?? 1);
      this.blit(this.dye.write);
      this.dye.swap();
    }
    this.patterns.length = 0;
  }

  step(dt: number) {
    if (this.destroyed) return;
    this.resize();
    if (!this.dye) return;
    const gl = this.gl;
    const t = Math.min(Math.max(dt, 0.001), 0.033);
    const flow = t * Math.min(2.4, Math.max(0.25, this.params.motion || 1));
    this.time += flow;
    this.realTime += t;
    const vel = this.velocity;
    const dye = this.dye;
    const texel = vel.read.texel;
    const q = QUALITY[this.params.quality];
    const maxV = this.params.maxVelocity;

    this.flushSplats();
    this.flushPatterns();

    const forces = this.programs.forces;
    gl.useProgram(forces.id);
    this.bind(0, vel.read.texture);
    this.bind(1, dye.read.texture);
    gl.uniform1i(forces.uniforms.uVelocity, 0);
    gl.uniform1i(forces.uniforms.uDye, 1);
    gl.uniform1f(forces.uniforms.uDt, flow);
    gl.uniform1f(forces.uniforms.uTime, this.time);
    gl.uniform1f(forces.uniforms.uAmbient, this.params.ambient);
    gl.uniform1f(forces.uniforms.uSwirl, this.params.swirl);
    gl.uniform1f(forces.uniforms.uBuoyancy, this.params.buoyancy);
    gl.uniform1f(forces.uniforms.uAspect, this.aspect);
    gl.uniform2f(forces.uniforms.uCenter, this.center[0], this.center[1]);
    gl.uniform1f(forces.uniforms.uMaxVel, maxV);
    gl.uniform2f(forces.uniforms.uTexel, texel[0], texel[1]);
    this.blit(vel.write);
    vel.swap();

    const curlP = this.programs.curl;
    gl.useProgram(curlP.id);
    this.bind(0, vel.read.texture);
    gl.uniform1i(curlP.uniforms.uVelocity, 0);
    gl.uniform2f(curlP.uniforms.uTexel, texel[0], texel[1]);
    this.blit(this.curl);

    const vort = this.programs.vorticity;
    gl.useProgram(vort.id);
    this.bind(0, vel.read.texture);
    this.bind(1, this.curl.texture);
    gl.uniform1i(vort.uniforms.uVelocity, 0);
    gl.uniform1i(vort.uniforms.uCurl, 1);
    gl.uniform2f(vort.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform1f(vort.uniforms.uCurlStrength, this.params.vorticity);
    gl.uniform1f(vort.uniforms.uDt, flow);
    gl.uniform1f(vort.uniforms.uMaxVel, maxV);
    this.blit(vel.write);
    vel.swap();

    const divP = this.programs.divergence;
    gl.useProgram(divP.id);
    this.bind(0, vel.read.texture);
    gl.uniform1i(divP.uniforms.uVelocity, 0);
    gl.uniform2f(divP.uniforms.uTexel, texel[0], texel[1]);
    this.blit(this.divergence);

    const clearP = this.programs.clear;
    gl.useProgram(clearP.id);
    this.bind(0, this.pressure.read.texture);
    gl.uniform1i(clearP.uniforms.uTexture, 0);
    gl.uniform1f(clearP.uniforms.uValue, 0.8);
    this.blit(this.pressure.write);
    this.pressure.swap();

    const press = this.programs.pressure;
    gl.useProgram(press.id);
    this.bind(1, this.divergence.texture);
    gl.uniform1i(press.uniforms.uDivergence, 1);
    gl.uniform2f(press.uniforms.uTexel, texel[0], texel[1]);
    for (let i = 0; i < q.pressure; i++) {
      this.bind(0, this.pressure.read.texture);
      gl.uniform1i(press.uniforms.uPressure, 0);
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    const grad = this.programs.gradient;
    gl.useProgram(grad.id);
    this.bind(0, this.pressure.read.texture);
    this.bind(1, vel.read.texture);
    gl.uniform1i(grad.uniforms.uPressure, 0);
    gl.uniform1i(grad.uniforms.uVelocity, 1);
    gl.uniform2f(grad.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform1f(grad.uniforms.uMaxVel, maxV);
    this.blit(vel.write);
    vel.swap();

    const adv = this.programs.advect;
    gl.useProgram(adv.id);
    this.bind(0, vel.read.texture);
    this.bind(1, vel.read.texture);
    gl.uniform1i(adv.uniforms.uVelocity, 0);
    gl.uniform1i(adv.uniforms.uSource, 1);
    gl.uniform2f(adv.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform2f(adv.uniforms.uVelTexel, texel[0], texel[1]);
    gl.uniform1f(adv.uniforms.uDt, flow);
    gl.uniform1f(adv.uniforms.uDissipation, Math.exp(-this.params.velocityDissipation * t));
    this.blit(vel.write);
    vel.swap();

    this.bind(0, vel.read.texture);
    this.bind(1, dye.read.texture);
    gl.uniform2f(adv.uniforms.uTexel, dye.read.texel[0], dye.read.texel[1]);
    gl.uniform2f(adv.uniforms.uVelTexel, texel[0], texel[1]);
    gl.uniform1f(adv.uniforms.uDissipation, Math.exp(-this.params.dissipation * t));
    this.blit(dye.write);
    dye.swap();

    this.draw();
  }

  draw() {
    const gl = this.gl;
    const p = this.programs.display;
    gl.useProgram(p.id);
    this.bind(0, this.dye.read.texture);
    this.bind(2, this.curl.texture);
    gl.uniform1i(p.uniforms.uDye, 0);
    gl.uniform1i(p.uniforms.uCurl, 2);
    gl.uniform1f(p.uniforms.uMode, this.params.view === "dye" ? 0 : 1);
    gl.uniform2f(p.uniforms.uTexel, this.velocity.read.texel[0], this.velocity.read.texel[1]);
    gl.uniform2f(p.uniforms.uDyeTexel, this.dye.read.texel[0], this.dye.read.texel[1]);
    gl.uniform1f(p.uniforms.uExposure, this.params.exposure);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform1f(p.uniforms.uTime, this.realTime);
    gl.uniform1f(p.uniforms.uStarScale, Math.min(window.devicePixelRatio || 1, 1.5));
    gl.uniform2f(p.uniforms.uCenter, this.center[0], this.center[1]);
    this.glowPos.fill(0);
    this.glowMode.fill(0);
    this.glowColor.fill(0);
    this.glowSpread.fill(1);
    this.glows.slice(0, S.MAX_GLOWS).forEach((g, i) => {
      this.glowPos.set([g.x, g.y, Math.max(g.radius, 1e-4), g.rotation], i * 4);
      this.glowMode.set([g.n, g.m, g.sign, g.intensity], i * 4);
      this.glowColor.set(g.color, i * 3);
      this.glowSpread[i] = g.spread ?? 1;
    });
    gl.uniform4fv(p.uniforms.uGlowPos, this.glowPos);
    gl.uniform4fv(p.uniforms.uGlowMode, this.glowMode);
    gl.uniform3fv(p.uniforms.uGlowColor, this.glowColor);
    gl.uniform1fv(p.uniforms.uGlowSpread, this.glowSpread);
    this.blit(null);
  }

  destroy() {
    this.destroyed = true;
  }
}
