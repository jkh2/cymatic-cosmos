import * as S from "./shaders";

export type FluidView = "dye" | "vorticity";
export type FluidQuality = "low" | "medium" | "high";

export interface FluidParams {
  viscosity: number;
  dissipation: number;
  velocityDissipation: number;
  vorticity: number;
  buoyancy: number;
  splatForce: number;
  splatRadius: number;
  idleFlow: number;
  stretchForce: number;
  motion: number;
  paused: boolean;
  view: FluidView;
  quality: FluidQuality;
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

const QUALITY: Record<FluidQuality, { sim: number; dye: number; pressure: number }> = {
  low: { sim: 96, dye: 480, pressure: 12 },
  medium: { sim: 160, dye: 900, pressure: 20 },
  high: { sim: 256, dye: 1440, pressure: 28 },
};

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
    uniforms[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return { id: prog, uniforms };
}

function supportFormat(gl: WebGL2RenderingContext, internal: number, format: number, type: number) {
  const tex = gl.createTexture();
  if (!tex) return false;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

function pickFormat(gl: WebGL2RenderingContext) {
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_color_buffer_half_float");
  gl.getExtension("OES_texture_float_linear");
  gl.getExtension("OES_texture_half_float_linear");
  if (supportFormat(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)) {
    return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.NEAREST };
  }
  if (supportFormat(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT)) {
    return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
  }
  return { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
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
  private programs: {
    splat: Program;
    vortex: Program;
    advect: Program;
    divergence: Program;
    curl: Program;
    vorticity: Program;
    pressure: Program;
    gradient: Program;
    diffuse: Program;
    clear: Program;
    forces: Program;
    display: Program;
  };
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
  private needsSeed = true;
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
    if (!gl) throw new Error("WebGL2 is required for the fluid solver.");
    this.gl = gl;
    this.format = pickFormat(gl);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    this.programs = {
      splat: makeProgram(gl, S.VERT, S.SPLAT),
      vortex: makeProgram(gl, S.VERT, S.VORTEX),
      advect: makeProgram(gl, S.VERT, S.ADVECT),
      divergence: makeProgram(gl, S.VERT, S.DIVERGENCE),
      curl: makeProgram(gl, S.VERT, S.CURL),
      vorticity: makeProgram(gl, S.VERT, S.VORTICITY),
      pressure: makeProgram(gl, S.VERT, S.PRESSURE),
      gradient: makeProgram(gl, S.VERT, S.GRADIENT),
      diffuse: makeProgram(gl, S.VERT, S.DIFFUSE),
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
    if (this.lastW > 2) {
      this.seed();
      this.draw();
    }
  }

  setParams(next: Partial<FluidParams>) {
    const qualityChanged = next.quality && next.quality !== this.lastQuality;
    Object.assign(this.params, next);
    if (qualityChanged && next.quality) {
      this.lastQuality = next.quality;
      this.resize(true);
    }
  }

  resize(force = false) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.clientWidth < 4 || this.canvas.clientHeight < 4) return;
    if (!force && w === this.lastW && h === this.lastH) return;
    const first = this.lastW === 0;
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
    gl.viewport(0, 0, w, h);
    if (first || force) this.needsSeed = true;
  }

  private makeFBO(width: number, height: number): FBO {
    const gl = this.gl;
    const { internal, format, type, filter } = this.format;
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error("Failed to allocate field buffer");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
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

  splat(
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: [number, number, number],
    dyeScale = 1,
  ) {
    if (this.destroyed || !this.dye) return;
    const gl = this.gl;
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    const radius = this.params.splatRadius * 0.25;
    const force = this.params.splatForce;
    const sp = this.programs.splat;
    gl.useProgram(sp.id);
    this.bind(0, this.velocity.read.texture);
    gl.uniform1i(sp.uniforms.uTarget, 0);
    gl.uniform2f(sp.uniforms.uPoint, x, y);
    gl.uniform3f(sp.uniforms.uColor, dx * force, dy * force, 0);
    gl.uniform1f(sp.uniforms.uRadius, radius);
    gl.uniform1f(sp.uniforms.uAspect, aspect);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.bind(0, this.dye.read.texture);
    gl.uniform1i(sp.uniforms.uTarget, 0);
    gl.uniform3f(sp.uniforms.uColor, color[0] * dyeScale, color[1] * dyeScale, color[2] * dyeScale);
    gl.uniform1f(sp.uniforms.uRadius, radius * 0.85);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  vortex(x: number, y: number, strength: number, radius: number) {
    if (this.destroyed || !this.velocity) return;
    const gl = this.gl;
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    const p = this.programs.vortex;
    gl.useProgram(p.id);
    this.bind(0, this.velocity.read.texture);
    gl.uniform1i(p.uniforms.uTarget, 0);
    gl.uniform2f(p.uniforms.uPoint, x, y);
    gl.uniform1f(p.uniforms.uStrength, strength);
    gl.uniform1f(p.uniforms.uRadius, radius);
    gl.uniform1f(p.uniforms.uAspect, aspect);
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  seed() {
    this.clearFields();
    const prevRadius = this.params.splatRadius;
    const prevForce = this.params.splatForce;
    this.params.splatRadius = 0.26;
    this.params.splatForce = 2800;
    const blobs: Array<{
      x: number;
      y: number;
      color: [number, number, number];
      spin: number;
      dx: number;
      dy: number;
    }> = [
      { x: 0.28, y: 0.42, color: [0.12, 0.72, 0.78], spin: 22, dx: 0.06, dy: 0.02 },
      { x: 0.72, y: 0.58, color: [0.9, 0.42, 0.1], spin: -18, dx: -0.05, dy: 0.02 },
      { x: 0.48, y: 0.7, color: [0.85, 0.7, 0.28], spin: 12, dx: 0.01, dy: 0.04 },
    ];
    for (const b of blobs) {
      this.splat(b.x, b.y, b.dx, b.dy, b.color);
      this.vortex(b.x, b.y, b.spin, 0.11);
    }
    this.params.splatRadius = prevRadius;
    this.params.splatForce = prevForce;
    this.needsSeed = false;
  }

  private clearFields() {
    const gl = this.gl;
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

  step(dt: number) {
    if (this.destroyed) return;
    this.resize();
    if (!this.dye) return;
    if (this.needsSeed && this.lastW > 2) this.seed();
    if (this.params.paused) {
      this.draw();
      return;
    }
    const gl = this.gl;
    const t = Math.min(Math.max(dt, 0.001), 0.033);
    const flow = t * Math.min(2.4, Math.max(0.2, this.params.motion || 1));
    const vel = this.velocity;
    const dye = this.dye;
    const texel = vel.read.texel;
    const q = QUALITY[this.params.quality];
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);

    const forces = this.programs.forces;
    gl.useProgram(forces.id);
    this.bind(0, vel.read.texture);
    this.bind(1, dye.read.texture);
    gl.uniform1i(forces.uniforms.uVelocity, 0);
    gl.uniform1i(forces.uniforms.uDye, 1);
    gl.uniform1f(forces.uniforms.uDt, flow);
    gl.uniform1f(forces.uniforms.uBuoyancy, this.params.buoyancy);
    gl.uniform1f(forces.uniforms.uIdle, this.params.idleFlow);
    gl.uniform1f(forces.uniforms.uStretch, this.params.stretchForce);
    gl.uniform1f(forces.uniforms.uAspect, aspect);
    this.blit(vel.write);
    vel.swap();

    if (this.params.viscosity > 0.01) {
      const nu = 0.00001 + this.params.viscosity * 0.08;
      const alpha = 1 / (nu * t);
      const beta = 4 + alpha;
      const iters = Math.max(4, Math.round(this.params.viscosity * 20));
      const diff = this.programs.diffuse;
      gl.useProgram(diff.id);
      gl.uniform2f(diff.uniforms.uTexel, texel[0], texel[1]);
      gl.uniform1f(diff.uniforms.uAlpha, alpha);
      gl.uniform1f(diff.uniforms.uBeta, beta);
      for (let i = 0; i < iters; i++) {
        this.bind(0, vel.read.texture);
        gl.uniform1i(diff.uniforms.uTexture, 0);
        this.blit(vel.write);
        vel.swap();
      }
    }

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
    gl.uniform1f(adv.uniforms.uDissipation, 1 - this.params.velocityDissipation * t);
    this.blit(vel.write);
    vel.swap();

    this.bind(0, vel.read.texture);
    this.bind(1, dye.read.texture);
    gl.uniform1i(adv.uniforms.uVelocity, 0);
    gl.uniform1i(adv.uniforms.uSource, 1);
    gl.uniform2f(adv.uniforms.uTexel, dye.read.texel[0], dye.read.texel[1]);
    gl.uniform2f(adv.uniforms.uVelTexel, texel[0], texel[1]);
    gl.uniform1f(adv.uniforms.uDissipation, 1 - this.params.dissipation * t);
    this.blit(dye.write);
    dye.swap();

    this.draw();
  }

  draw() {
    const gl = this.gl;
    const mode = this.params.view === "dye" ? 0 : 2;
    const p = this.programs.display;
    gl.useProgram(p.id);
    this.bind(0, this.dye.read.texture);
    this.bind(1, this.velocity.read.texture);
    this.bind(2, this.curl.texture);
    this.bind(3, this.pressure.read.texture);
    gl.uniform1i(p.uniforms.uDye, 0);
    gl.uniform1i(p.uniforms.uVelocity, 1);
    gl.uniform1i(p.uniforms.uCurl, 2);
    gl.uniform1i(p.uniforms.uPressure, 3);
    gl.uniform1f(p.uniforms.uMode, mode);
    gl.uniform2f(p.uniforms.uTexel, this.velocity.read.texel[0], this.velocity.read.texel[1]);
    gl.uniform2f(p.uniforms.uDyeTexel, this.dye.read.texel[0], this.dye.read.texel[1]);
    this.blit(null);
  }

  destroy() {
    this.destroyed = true;
  }
}
