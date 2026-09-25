// Renderer with one API and two backends.
//
// WebGL2: sprites and backdrop go to a base buffer, lights accumulate into a
// half-resolution light map (ambient + additive falloff quads), the two are
// multiplied, emissive draws (fire, spells, particles) are added on top, and
// a bloom chain + tone map + vignette/flash/CRT pass writes the screen.
// Canvas2D: the same passes with composite operations, minus bloom and rim.
//
// All positions are logical scene pixels (320x180 view); the camera maps
// them to device pixels.
//
//   r.begin({ ambient, camera: { x, y, zoom }, shake: [x, y] })
//   r.draw(tex, sx, sy, sw, sh, dx, dy, dw, dh, { pass: 'base'|'glow', color: [r,g,b,a], flipX, rim: [dx, dy, r, g, b, s], angle, px, py })
//   r.quad(tex, [u0,v0,u1,v1], [x0,y0, x1,y1, x2,y2, x3,y3], color, pass)
//   r.light(x, y, radius, [r,g,b], intensity)
//   r.end({ bloom, threshold, exposure, vignette, flash: [r,g,b,a], retro, enrage, grain })

const LW = 320, LH = 180;

export function createRenderer(canvas, { forceCanvas = false } = {}) {
  if (!forceCanvas) {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
      if (gl) return new GLRenderer(canvas, gl);
    } catch (e) { console.warn('WebGL2 unavailable', e); }
  }
  return new CanvasRenderer(canvas);
}

// ---------- shared view math ----------

class Base {
  constructor(canvas) { this.canvas = canvas; this.dpr = 1; this.scale = 4; this.base = []; this.glow = []; this.baseF = []; this.glowF = []; this.phase = 0; this.lights = []; this.cam = { x: 0, y: 0, zoom: 1 }; this.shake = [0, 0]; this.stats = { draws: 0 }; this.texId = 1; }
  resize(cssW, cssH, dpr) {
    this.dpr = dpr;
    const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.onResize && this.onResize(w, h); }
    this.scale = Math.min(w / LW, h / LH);
    this.offX = (w - LW * this.scale) / 2; this.offY = (h - LH * this.scale) / 2;
  }
  // logical -> device
  tx(x) { return (x - LW / 2 - this.cam.x) * this.cam.zoom * this.scale + this.canvas.width / 2 + this.shake[0] * this.scale; }
  ty(y) { return (y - LH / 2 - this.cam.y) * this.cam.zoom * this.scale + this.canvas.height / 2 + this.shake[1] * this.scale; }
  get k() { return this.scale * this.cam.zoom; }
  begin(o = {}) {
    this.base.length = 0; this.glow.length = 0; this.baseF.length = 0; this.glowF.length = 0; this.lights.length = 0; this.phase = 0;
    this.ambient = o.ambient || [1, 1, 1];
    this.cam = { x: 0, y: 0, zoom: 1, ...(o.camera || {}) };
    this.shake = o.shake || [0, 0];
  }
  draw(tex, sx, sy, sw, sh, dx, dy, dw, dh, o = {}) {
    if (!tex) return;
    let u0 = sx / tex.w, v0 = sy / tex.h, u1 = (sx + sw) / tex.w, v1 = (sy + sh) / tex.h;
    if (o.flipX) [u0, u1] = [u1, u0];
    let pts;
    if (o.angle) {
      const px = dx + (o.px ?? dw / 2), py = dy + (o.py ?? dh / 2), c = Math.cos(o.angle), s = Math.sin(o.angle);
      const rot = (x, y) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c];
      pts = [...rot(dx, dy), ...rot(dx + dw, dy), ...rot(dx + dw, dy + dh), ...rot(dx, dy + dh)];
    } else pts = [dx, dy, dx + dw, dy, dx + dw, dy + dh, dx, dy + dh];
    this.quad(tex, [u0, v0, u1, v1], pts, o.color, o.pass, o.rim);
  }
  quad(tex, uv, pts, color, pass = 'base', rim = null) {
    const f = this.phase === 1;
    // 'under': additive but in draw order (glows behind a sprite); encoded as a negative alpha
    if (pass === 'under') { const c = color || [1, 1, 1, 1]; color = [c[0], c[1], c[2], -Math.abs(c[3] ?? 1)]; pass = 'base'; }
    (pass === 'glow' ? (f ? this.glowF : this.glow) : (f ? this.baseF : this.base)).push({ tex, uv, pts, color: color || [1, 1, 1, 1], rim });
  }
  // Everything drawn after split() is foreground: lit separately and drawn
  // over the backdrop's own glow (lava, flames), so emissive scenery stays behind characters.
  split() { this.phase = 1; }
  light(x, y, r, c, s = 1) { if (s > 0.003 && r > 0) this.lights.push([x, y, r, c, s]); }
  // A segment drawn with a soft line texture (lightning, trails, beams).
  line(tex, x1, y1, x2, y2, width, color, pass = 'glow') {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * width / 2, ny = (dx / len) * width / 2;
    this.quad(tex, [0, 0, 1, 1], [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny], color, pass);
  }
}

// ---------- WebGL2 ----------

const VS = `#version 300 es
layout(location=0) in vec2 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in vec4 a_col;
layout(location=3) in vec4 a_rim; layout(location=4) in vec3 a_rimc;
uniform vec4 u_view; // scale x, scale y, offset x, offset y (logical -> clip)
out vec2 v_uv; out vec4 v_col; out vec4 v_rim; out vec3 v_rimc;
void main() { v_uv = a_uv; v_col = a_col; v_rim = a_rim; v_rimc = a_rimc; gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0); }`;

const FS_SPRITE = `#version 300 es
precision mediump float;
uniform sampler2D u_tex; uniform vec2 u_texel;
in vec2 v_uv; in vec4 v_col; in vec4 v_rim; in vec3 v_rimc; out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < 0.004) discard;
  vec3 rgb = c.rgb;
  if (v_rim.z > 0.0) {
    float n = texture(u_tex, v_uv + v_rim.xy * u_texel).a;
    float n2 = texture(u_tex, v_uv + v_rim.xy * u_texel * 2.0).a;
    float edge = (1.0 - step(0.5, n)) + 0.45 * (1.0 - step(0.5, n2)) * step(0.5, n);
    rgb += v_rimc * v_rim.z * edge;
  }
  float a = c.a * abs(v_col.a);
  o = vec4(rgb * v_col.rgb * a, v_col.a < 0.0 ? 0.0 : a);
}`;

const FS_LIGHT = `#version 300 es
precision mediump float;
in vec2 v_uv; in vec4 v_col; out vec4 o;
uniform float u_lscale;
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float d = dot(p, p);
  float f = max(0.0, 1.0 - d); f = f * f * (0.55 + 0.45 * f);
  o = vec4(v_col.rgb * v_col.a * f * u_lscale, 1.0);
}`;

const VS_FULL = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const FS_COMP = `#version 300 es
precision mediump float;
uniform sampler2D u_base, u_light; uniform float u_lscale;
in vec2 v_uv; out vec4 o;
void main() { vec4 b = texture(u_base, v_uv); vec3 l = texture(u_light, v_uv).rgb / u_lscale; vec3 e = max(l - 1.0, 0.0); l = min(l, vec3(1.0)) + e / (1.0 + e * 1.4); o = vec4(b.rgb * l, 1.0); }`;

const FS_FG = `#version 300 es
precision mediump float;
uniform sampler2D u_base, u_light; uniform float u_lscale;
in vec2 v_uv; out vec4 o;
void main() { vec4 b = texture(u_base, v_uv); vec3 l = texture(u_light, v_uv).rgb / u_lscale; vec3 e = max(l - 1.0, 0.0); l = min(l, vec3(1.0)) + e / (1.0 + e * 1.4); o = vec4(b.rgb * l, b.a); }`;

const FS_BRIGHT = `#version 300 es
precision mediump float;
uniform sampler2D u_src; uniform vec2 u_texel; uniform float u_th;
in vec2 v_uv; out vec4 o;
void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float w = smoothstep(u_th, u_th + 0.35, l);
  o = vec4(c * w, 1.0);
}`;

const FS_DOWN = `#version 300 es
precision mediump float;
uniform sampler2D u_src; uniform vec2 u_texel;
in vec2 v_uv; out vec4 o;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 4.0;
  c += texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;

const FS_UP = `#version 300 es
precision mediump float;
uniform sampler2D u_src; uniform vec2 u_texel;
in vec2 v_uv; out vec4 o;
void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + u_texel * vec2(-2.0, 0.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(2.0, 0.0)).rgb;
  c += texture(u_src, v_uv + u_texel * vec2(0.0, -2.0)).rgb; c += texture(u_src, v_uv + u_texel * vec2(0.0, 2.0)).rgb;
  c += 2.0 * texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb; c += 2.0 * texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  c += 2.0 * texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb; c += 2.0 * texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 12.0, 1.0);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D u_scene, u_bloom;
uniform float u_bloomK, u_exposure, u_vignette, u_retro, u_enrage, u_time, u_grain, u_dpr;
uniform vec4 u_flash; uniform vec2 u_res;
in vec2 v_uv; out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  if (u_retro > 0.5) { vec2 cc = uv - 0.5; uv = 0.5 + cc * (1.0 + 0.035 * dot(cc, cc)); }
  vec3 c = texture(u_scene, uv).rgb + texture(u_bloom, uv).rgb * u_bloomK;
  c = aces(c * u_exposure);
  c = pow(c, vec3(0.94));
  vec2 q = v_uv - 0.5;
  float vig = 1.0 - u_vignette * dot(q * vec2(1.15, 1.0), q * vec2(1.15, 1.0)) * 1.6;
  c *= clamp(vig, 0.0, 1.0);
  float e = max(abs(q.x) * 2.0, abs(q.y) * 2.0);
  c = mix(c, vec3(0.85, 0.05, 0.05), u_enrage * smoothstep(0.7, 1.0, e));
  c = mix(c, u_flash.rgb, u_flash.a);
  if (u_retro > 0.5) {
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    l = floor(l * 6.0 + 0.5) / 6.0;
    c = vec3(0.04 + l * 0.2, 0.08 + l * 0.95, 0.05 + l * 0.3);
    float sl = 0.78 + 0.22 * sin(gl_FragCoord.y * 3.14159 / max(1.0, 1.5 * u_dpr));
    c *= sl;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) c = vec3(0.0);
  }
  c += (h(gl_FragCoord.xy + u_time) - 0.5) * u_grain;
  o = vec4(c, 1.0);
}`;

const STRIDE = 15;

class GLRenderer extends Base {
  constructor(canvas, gl) {
    super(canvas);
    this.kind = 'webgl2';
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.progSprite = this.program(VS, FS_SPRITE);
    this.progLight = this.program(VS, FS_LIGHT);
    this.progComp = this.program(VS_FULL, FS_COMP);
    this.progFg = this.program(VS_FULL, FS_FG);
    this.progBright = this.program(VS_FULL, FS_BRIGHT);
    this.progDown = this.program(VS_FULL, FS_DOWN);
    this.progUp = this.program(VS_FULL, FS_UP);
    this.progFinal = this.program(VS_FULL, FS_FINAL);
    this.cap = 8192;
    this.verts = new Float32Array(this.cap * 4 * STRIDE);
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    const idx = new Uint32Array(this.cap * 6);
    for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const F = 4;
    [[0, 2, 0], [1, 2, 2], [2, 4, 4], [3, 4, 8], [4, 3, 12]].forEach(([loc, n, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, STRIDE * F, off * F); });
    this.emptyVao = gl.createVertexArray();
    this.white = this.texture({ data: new Uint8Array([255, 255, 255, 255]), w: 1, h: 1 }, { filter: 'nearest' });
    this.fbos = {};
    this.time = 0;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  texture(src, { filter = 'linear', wrap = 'clamp' } = {}) {
    const gl = this.gl, t = gl.createTexture();
    const tex = { gl: t, id: this.texId++, w: 1, h: 1, filter };
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    this.update(tex, src);
    return tex;
  }
  update(tex, src, rows) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.gl);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (src.data) {
      const data = src.data instanceof Uint8ClampedArray ? new Uint8Array(src.data.buffer, src.data.byteOffset, src.data.byteLength) : src.data;
      if (tex.w === src.w && tex.h === src.h && rows) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.w, Math.min(src.h, rows), gl.RGBA, gl.UNSIGNED_BYTE, data.subarray(0, src.w * Math.min(src.h, rows) * 4));
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      tex.w = src.w; tex.h = src.h;
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      tex.w = src.width; tex.h = src.height;
    }
  }
  free(tex) { if (tex && tex.gl) this.gl.deleteTexture(tex.gl); }

  fbo(name, w, h, hdr) {
    const gl = this.gl;
    let f = this.fbos[name];
    if (f && f.w === w && f.h === h) return f;
    if (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const useF = hdr && this.hdr;
    gl.texImage2D(gl.TEXTURE_2D, 0, useF ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, useF ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    f = this.fbos[name] = { fb, tex, w, h };
    return f;
  }

  viewUniform(prog, w, h) {
    // logical -> clip for a target of w x h device-ish pixels (same aspect as canvas)
    const cw = this.canvas.width, ch = this.canvas.height;
    const k = this.scale * this.cam.zoom;
    const sx = (2 * k) / cw, sy = (-2 * k) / ch;
    const ox = (-LW / 2 - this.cam.x + this.shake[0] / this.cam.zoom) * sx;
    const oy = (-LH / 2 - this.cam.y + this.shake[1] / this.cam.zoom) * sy;
    this.gl.uniform4f(prog.u.u_view, sx, sy, ox, oy);
    void w; void h;
  }

  flushList(list, prog, blend) {
    const gl = this.gl;
    if (!list.length) return;
    gl.useProgram(prog.p);
    this.viewUniform(prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enable(gl.BLEND);
    if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let i = 0;
    while (i < list.length) {
      const tex = list[i].tex;
      let n = 0;
      const V = this.verts;
      while (i < list.length && list[i].tex === tex && n < this.cap) {
        const q = list[i], [u0, v0, u1, v1] = q.uv, p = q.pts, c = q.color, r = q.rim;
        const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
        for (let k = 0; k < 4; k++) {
          const o = (n * 4 + k) * STRIDE;
          V[o] = p[k * 2]; V[o + 1] = p[k * 2 + 1]; V[o + 2] = uvs[k * 2]; V[o + 3] = uvs[k * 2 + 1];
          V[o + 4] = c[0]; V[o + 5] = c[1]; V[o + 6] = c[2]; V[o + 7] = c[3] ?? 1;
          if (r) { V[o + 8] = r[0]; V[o + 9] = r[1]; V[o + 10] = r[5]; V[o + 11] = 0; V[o + 12] = r[2]; V[o + 13] = r[3]; V[o + 14] = r[4]; }
          else { V[o + 8] = 0; V[o + 9] = 0; V[o + 10] = 0; V[o + 11] = 0; V[o + 12] = 0; V[o + 13] = 0; V[o + 14] = 0; }
        }
        n++; i++;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, V.subarray(0, n * 4 * STRIDE));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, (tex || this.white).gl);
      if (prog.u.u_tex) gl.uniform1i(prog.u.u_tex, 0);
      if (prog.u.u_texel) gl.uniform2f(prog.u.u_texel, 1 / (tex || this.white).w, 1 / (tex || this.white).h);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_INT, 0);
      this.stats.draws++;
    }
  }

  full(prog, target, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.emptyVao);
    setup && setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  bind(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }

  end(o = {}) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) return;
    this.stats.draws = 0;
    this.time = (this.time + 1) % 1000;
    const W = this.canvas.width, H = this.canvas.height;
    const base = this.fbo('base', W, H, false);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    const light = this.fbo('light', hw, hh, true);
    const comp = this.fbo('comp', W, H, true);
    const lscale = this.hdr ? 1 : 0.5;

    // 1. base colors
    gl.bindFramebuffer(gl.FRAMEBUFFER, base.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this.flushList(this.base, this.progSprite, 'alpha');

    // 2. light map: ambient + additive lights
    gl.bindFramebuffer(gl.FRAMEBUFFER, light.fb);
    gl.viewport(0, 0, hw, hh);
    const a = this.ambient;
    gl.clearColor(a[0] * lscale, a[1] * lscale, a[2] * lscale, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.lights.length) {
      const L = this.lights.map(([x, y, r, c, s]) => ({ tex: null, uv: [0, 0, 1, 1], pts: [x - r, y - r, x + r, y - r, x + r, y + r, x - r, y + r], color: [c[0], c[1], c[2], s], rim: null }));
      gl.useProgram(this.progLight.p);
      gl.uniform1f(this.progLight.u.u_lscale, lscale);
      this.flushList(L, this.progLight, 'add');
    }

    // 3. composite, then emissive on top
    this.full(this.progComp, comp, (u) => { gl.disable(gl.BLEND); this.bind(0, base.tex, u.u_base); this.bind(1, light.tex, u.u_light); gl.uniform1f(u.u_lscale, lscale); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fb);
    gl.viewport(0, 0, W, H);
    this.flushList(this.glow, this.progSprite, 'add');
    gl.disable(gl.BLEND);
    // foreground: its own base buffer, lit by the same light map, blended over
    if (this.baseF.length) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, base.fb);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.flushList(this.baseF, this.progSprite, 'alpha');
      this.full(this.progFg, comp, (u) => { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); this.bind(0, base.tex, u.u_base); this.bind(1, light.tex, u.u_light); gl.uniform1f(u.u_lscale, lscale); });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fb);
    gl.viewport(0, 0, W, H);
    this.flushList(this.glowF, this.progSprite, 'add');
    gl.disable(gl.BLEND);

    // 4. bloom: bright pass then a dual-filter blur chain
    const levels = [];
    let w = hw, h = hh;
    for (let i = 0; i < 5 && w > 8 && h > 8; i++) { levels.push(this.fbo(`bl${i}`, w, h, true)); w >>= 1; h >>= 1; }
    const bloomK = o.bloom ?? 0.8;
    if (levels.length && bloomK > 0) {
      this.full(this.progBright, levels[0], (u) => { this.bind(0, comp.tex, u.u_src); gl.uniform2f(u.u_texel, 1 / W, 1 / H); gl.uniform1f(u.u_th, o.threshold ?? 0.72); });
      for (let i = 1; i < levels.length; i++) { const src = levels[i - 1]; this.full(this.progDown, levels[i], (u) => { this.bind(0, src.tex, u.u_src); gl.uniform2f(u.u_texel, 1 / src.w, 1 / src.h); }); }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels.length - 1; i > 0; i--) { const src = levels[i]; this.full(this.progUp, levels[i - 1], (u) => { this.bind(0, src.tex, u.u_src); gl.uniform2f(u.u_texel, 0.5 / src.w, 0.5 / src.h); }); }
      gl.disable(gl.BLEND);
    }

    // 5. final
    const fl = o.flash || [1, 1, 1, 0];
    this.full(this.progFinal, null, (u) => {
      this.bind(0, comp.tex, u.u_scene); this.bind(1, levels.length ? levels[0].tex : comp.tex, u.u_bloom);
      gl.uniform1f(u.u_bloomK, levels.length ? (bloomK * 1.6) / levels.length : 0); // the upsample chain sums every level
      gl.uniform1f(u.u_exposure, o.exposure ?? 1.05);
      gl.uniform1f(u.u_vignette, o.vignette ?? 0.55);
      gl.uniform1f(u.u_retro, o.retro ? 1 : 0);
      gl.uniform1f(u.u_enrage, o.enrage || 0);
      gl.uniform1f(u.u_time, this.time);
      gl.uniform1f(u.u_grain, o.grain ?? 0.018);
      gl.uniform1f(u.u_dpr, this.dpr);
      gl.uniform4f(u.u_flash, fl[0], fl[1], fl[2], fl[3]);
      gl.uniform2f(u.u_res, W, H);
    });
  }
}

// ---------- Canvas2D fallback ----------

class CanvasRenderer extends Base {
  constructor(canvas) {
    super(canvas);
    this.kind = 'canvas2d';
    this.ctx = canvas.getContext('2d');
    this.lightCv = document.createElement('canvas');
    this.lctx = this.lightCv.getContext('2d');
    this.tints = new Map();
  }
  texture(src, { filter = 'linear' } = {}) {
    const tex = { id: this.texId++, filter, w: 1, h: 1, cv: null };
    this.update(tex, src);
    return tex;
  }
  update(tex, src) {
    if (src.data) {
      if (!tex.cv || tex.cv.width !== src.w || tex.cv.height !== src.h) { tex.cv = document.createElement('canvas'); tex.cv.width = src.w; tex.cv.height = src.h; }
      const img = new ImageData(new Uint8ClampedArray(src.data.buffer, src.data.byteOffset, src.w * src.h * 4), src.w, src.h);
      tex.cv.getContext('2d').putImageData(img, 0, 0);
      tex.w = src.w; tex.h = src.h;
    } else { tex.cv = src; tex.w = src.width; tex.h = src.height; }
    tex.ver = (tex.ver || 0) + 1;
  }
  free() {}
  // Colored copy of a (white) texture for glow draws.
  tinted(tex, c) {
    const q = (v) => Math.round(Math.min(1, v) * 15);
    const key = `${tex.id}:${tex.ver}:${q(c[0])},${q(c[1])},${q(c[2])}`;
    let cv = this.tints.get(key);
    if (!cv) {
      if (this.tints.size > 400) this.tints.clear();
      cv = document.createElement('canvas'); cv.width = tex.w; cv.height = tex.h;
      const x = cv.getContext('2d');
      x.drawImage(tex.cv, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${(q(c[0]) / 15) * 255},${(q(c[1]) / 15) * 255},${(q(c[2]) / 15) * 255})`;
      x.fillRect(0, 0, cv.width, cv.height);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(tex.cv, 0, 0);
      this.tints.set(key, cv);
    }
    return cv;
  }
  drawList(ctx, list, add) {
    ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
    for (const q of list) {
      const tex = q.tex;
      if (!tex || !tex.cv) continue;
      const [u0, v0, u1, v1] = q.uv, p = q.pts.map((v, i) => (i % 2 ? this.ty(v) : this.tx(v)));
      const sw = (u1 - u0) * tex.w, sh = (v1 - v0) * tex.h;
      // affine from the source rect to the quad's first three corners
      const ax = (p[2] - p[0]) / sw, ay = (p[3] - p[1]) / sw, bx = (p[6] - p[0]) / sh, by = (p[7] - p[1]) / sh;
      ctx.setTransform(ax, ay, bx, by, p[0], p[1]);
      ctx.imageSmoothingEnabled = tex.filter !== 'nearest';
      const c = q.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, Math.abs(c[3] ?? 1)));
      ctx.globalCompositeOperation = add || (c[3] ?? 1) < 0 ? 'lighter' : 'source-over';
      const white = c[0] > 0.97 && c[1] > 0.97 && c[2] > 0.97;
      const img = white ? tex.cv : this.tinted(tex, c);
      const sx = Math.min(u0, u1) * tex.w, sy = Math.min(v0, v1) * tex.h;
      if (u1 < u0) { ctx.transform(-1, 0, 0, 1, Math.abs(sw), 0); }
      ctx.drawImage(img, sx, sy, Math.abs(sw), Math.abs(sh), 0, 0, Math.abs(sw), Math.abs(sh));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
  end(o = {}) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    this.drawList(ctx, this.base, false);
    // light map
    const lw = W >> 1, lh = H >> 1;
    if (this.lightCv.width !== lw || this.lightCv.height !== lh) { this.lightCv.width = lw; this.lightCv.height = lh; }
    const l = this.lctx, a = this.ambient;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = `rgb(${a[0] * 255},${a[1] * 255},${a[2] * 255})`;
    l.fillRect(0, 0, lw, lh);
    l.globalCompositeOperation = 'lighter';
    for (const [x, y, r, c, s] of this.lights) {
      const cx = this.tx(x) / 2, cy = this.ty(y) / 2, rr = (r * this.k) / 2;
      const g = l.createRadialGradient(cx, cy, 0, cx, cy, rr);
      const col = (k) => `rgba(${Math.min(255, c[0] * 255 * s * k)},${Math.min(255, c[1] * 255 * s * k)},${Math.min(255, c[2] * 255 * s * k)},1)`;
      g.addColorStop(0, col(1)); g.addColorStop(0.5, col(0.35)); g.addColorStop(1, 'rgba(0,0,0,1)');
      l.fillStyle = g; l.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lightCv, 0, 0, W, H);
    this.drawList(ctx, this.glow, true);
    this.drawList(ctx, this.baseF, false);
    this.drawList(ctx, this.glowF, true);
    ctx.globalCompositeOperation = 'source-over';
    // vignette, enrage and flash
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.55 * (o.vignette ?? 0.55)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (o.enrage) { ctx.strokeStyle = `rgba(220,20,20,${o.enrage})`; ctx.lineWidth = H * 0.06; ctx.strokeRect(0, 0, W, H); }
    const f = o.flash;
    if (f && f[3] > 0) { ctx.fillStyle = `rgba(${f[0] * 255},${f[1] * 255},${f[2] * 255},${f[3]})`; ctx.fillRect(0, 0, W, H); }
    if (o.retro) {
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(60,255,110)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,0.22)';
      const step = Math.max(2, Math.round(2 * this.dpr));
      for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1);
    }
  }
}

export { LW, LH };
