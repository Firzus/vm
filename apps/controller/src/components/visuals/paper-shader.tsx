"use client";

/**
 * PaperShader — a single full-viewport WebGL <canvas> sitting behind every
 * page. Renders an editorial paper backdrop:
 *
 *   • warm ivory base (#f5f1e8)
 *   • subtle FBM noise → paper grain
 *   • two slow-drifting vermilion ink stains
 *   • a hairline rule near the upper third
 *
 * The shader runs at devicePixelRatio capped to 1 on viewports < 768px to
 * keep mobile GPUs happy. It pauses entirely under prefers-reduced-motion
 * (the canvas still renders one frame so the page doesn't feel naked, it
 * just doesn't animate).
 *
 * Falls back to a CSS gradient + SVG noise pattern if WebGL is unavailable.
 */

import { useEffect, useRef, useState } from "react";

const VERTEX_SHADER = /* glsl */ `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Editorial paper fragment shader. Designed to be visually quiet — just
// enough texture to make every surface above it feel like paper.
const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform vec2 u_mouse;       // 0..1
uniform float u_time;       // seconds
uniform float u_octaves;    // 2.0 on mobile, 3.0 on desktop
uniform float u_grain;      // 0..1 grain intensity
uniform float u_motion;     // 0 = frozen (reduced-motion), 1 = animated

vec3 PAPER       = vec3(0.961, 0.945, 0.910); // #f5f1e8
vec3 INK_VEIN    = vec3(0.55, 0.50, 0.43);
vec3 VERMILION   = vec3(1.000, 0.227, 0.090); // #ff3a17

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (float i = 0.0; i < 4.0; i++) {
    if (i >= u_octaves) break;
    v += a * noise(p);
    p *= 2.07;
    a *= 0.55;
  }
  return v;
}

// A soft asymmetric ink stain centered at \`c\`, with radius \`r\` and a
// per-stain randomness offset \`seed\`. Returns 0..1 alpha.
float inkStain(vec2 uv, vec2 c, float r, float seed) {
  vec2 d = uv - c;
  float dist = length(d);
  // Wobble the boundary with low-frequency noise so the stain feels
  // hand-pulled rather than mathematically clean.
  float wobble = fbm(d * 3.0 + vec2(seed * 7.13, seed * 3.31));
  float edge = smoothstep(r, r * 0.55, dist - wobble * r * 0.35);
  return clamp(edge, 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  // Aspect-correct uvs centered around (0.5, 0.5) so stains keep shape.
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 cuv = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float t = u_time * u_motion;

  // Base paper color with a tiny large-scale tint variation.
  vec3 col = PAPER;
  float wash = fbm(cuv * 0.9 + t * 0.01);
  col -= 0.012 * (wash - 0.5);

  // Mouse-driven warm spot, very subtle.
  vec2 m = u_mouse - vec2(0.5);
  m.x *= aspect;
  float mouseGlow = exp(-length(cuv - m) * 4.0) * 0.04;
  col -= vec3(mouseGlow * 0.8, mouseGlow, mouseGlow * 1.2);

  // Two slow-drifting vermilion ink stains.
  vec2 c1 = vec2(-0.55, 0.18) + 0.04 * vec2(sin(t * 0.10), cos(t * 0.07));
  vec2 c2 = vec2( 0.62, -0.22) + 0.05 * vec2(cos(t * 0.06), sin(t * 0.09));
  float s1 = inkStain(cuv, c1, 0.42, 0.21);
  float s2 = inkStain(cuv, c2, 0.36, 0.83);
  // Stains aren't pure overlays — they "soak" into the paper, so we mix
  // toward vermilion at low intensity instead of hard-blending.
  col = mix(col, VERMILION, s1 * 0.13);
  col = mix(col, VERMILION, s2 * 0.10);

  // High-frequency paper grain (multiplicative, very subtle).
  float grain = fbm(uv * vec2(u_resolution.x, u_resolution.y) * 0.55) - 0.5;
  col -= grain * u_grain * 0.10;

  // A faint horizontal hairline rule at ~33% — the magazine "fold" line.
  float ruleY = 0.330;
  float ruleW = 0.0008 + 0.0006 * (sin(uv.x * 12.0 + t * 0.05) * 0.5 + 0.5);
  float rule = smoothstep(ruleW, 0.0, abs(uv.y - ruleY));
  col = mix(col, INK_VEIN, rule * 0.18);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[paper-shader] compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function PaperShader() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [webglOk, setWebglOk] = useState(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", { antialias: false, alpha: false }) as
        | WebGLRenderingContext
        | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) {
      setWebglOk(false);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) {
      setWebglOk(false);
      return;
    }
    const program = gl.createProgram();
    if (!program) {
      setWebglOk(false);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[paper-shader] link error:", gl.getProgramInfoLog(program));
      setWebglOk(false);
      return;
    }
    gl.useProgram(program);

    // Full-screen triangle pair.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uOctaves = gl.getUniformLocation(program, "u_octaves");
    const uGrain = gl.getUniformLocation(program, "u_grain");
    const uMotion = gl.getUniformLocation(program, "u_motion");

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isMobile = window.innerWidth < 768;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);

    const setSize = () => {
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        gl.viewport(0, 0, w, h);
      }
    };
    setSize();

    let mouseX = 0.5;
    let mouseY = 0.5;
    const onMove = (e: PointerEvent) => {
      mouseX = e.clientX / window.innerWidth;
      mouseY = 1 - e.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", setSize);

    const start = performance.now();
    let raf = 0;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uOctaves, isMobile ? 2 : 3);
      gl.uniform1f(uGrain, isMobile ? 0.55 : 0.85);
      gl.uniform1f(uMotion, reduceMotion ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reduceMotion) {
        raf = requestAnimationFrame(render);
      }
    };
    render(start);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", setSize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  if (!webglOk) {
    // CSS fallback — still warm and quietly textured.
    return (
      <div
        aria-hidden
        className="paper-wash fixed inset-0 -z-10 pointer-events-none"
        data-paper-shader="fallback"
      >
        <div className="paper-noise" />
      </div>
    );
  }

  return (
    <canvas
      ref={ref}
      data-paper-shader="webgl"
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none"
    />
  );
}
