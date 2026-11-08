import { useEffect, useRef } from 'react';
import art from './assets/background.webp';

// Draws the city art with a slow camera drift, a soft neon glow, small shooting stars, and the two characters swaying.
// The art is one flat image, so the characters are moved by bending the picture around them.
// Where this can't run (reduced motion, no WebGL) the page shows the still image from styles.css.

const VERT = `
attribute vec2 a;
varying vec2 p;
void main() { p = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;

const FRAG = `
precision highp float;
uniform sampler2D img;
uniform vec2 view;
uniform float t;
varying vec2 p;
const vec2 SIZE = vec2(1672., 941.);

float region(vec2 q, vec2 c, vec2 r) { return 1. - smoothstep(.72, 1., length((q - c) / r)); }

float hash(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }

// Five independent stars. Each period picks a random moment, place and direction, or skips its turn.
float shootingStars(vec2 q) {
  const float DUR = .7;
  float sum = 0.;
  for (int i = 0; i < 5; i++) {
    float f = float(i);
    float period = 6. + f * 1.3;
    float time = t + f * 2.7;
    float k = floor(time / period);
    vec2 seed = vec2(f, k);
    if (hash(seed + 9.) > .75) continue;
    float age = time - k * period - hash(seed + 3.) * (period - DUR);
    if (age < 0. || age > DUR) continue;

    float high = hash(seed + 2.);
    vec2 start = vec2(mix(30., 1640., hash(seed + 1.)), mix(8., 260., high * high));
    float angle = mix(.45, .95, hash(seed + 5.));
    vec2 dir = vec2((hash(seed + 4.) < .5 ? -1. : 1.) * cos(angle), sin(angle));
    vec2 d = q - (start + dir * mix(130., 230., hash(seed + 6.)) * age / DUR);

    float behind = dot(d, -dir);
    if (behind < -1.) continue;
    float tail = 1. - smoothstep(0., mix(45., 85., hash(seed + 7.)), behind);
    float core = 1. - smoothstep(.4, 1.4, abs(dot(d, vec2(-dir.y, dir.x))));
    sum += core * tail * tail * sin(3.14159 * age / DUR);
  }
  return sum;
}

void main() {
  float va = view.x / view.y, ia = SIZE.x / SIZE.y;
  vec2 s = va > ia ? vec2(1., ia / va) : vec2(va / ia, 1.);
  vec2 q = ((p - .5) * s / 1.02 + .5 + .004 * vec2(sin(t * .16), cos(t * .12))) * SIZE;

  // Bear: leans from the feet.
  float bear = region(q, vec2(150., 665.), vec2(175., 225.));
  float bearH = clamp((812. - q.y) / 290., 0., 1.);
  // Raccoon and ghost: hang like a pendulum from the top of the picture, with a small bob.
  float hang = region(q, vec2(1545., 225.), vec2(185., 265.));
  float hangH = clamp(q.y / 420., 0., 1.);

  vec2 at = q;
  at.x -= bear * pow(bearH, 1.5) * 7. * sin(t * 1.4);
  at.x -= hang * hangH * 11. * sin(t * 1.1);
  at.y -= hang * 3. * sin(t * .9 + 1.);

  vec3 c = texture2D(img, at / SIZE).rgb;

  // Neon and lit windows breathe; a soft wave passes across the city. Characters stay steady.
  float lit = smoothstep(.35, .85, max(c.r, c.b)) * (1. - max(bear, hang));
  float wave = sin(q.x * .012 - t * .7) * sin(q.y * .017 + t * .45);
  c *= 1. + lit * (.05 * sin(t * .8) + .16 * wave);

  // Stars only show against dark sky, so they pass behind the characters, clouds and buildings.
  float sky = (1. - smoothstep(.22, .5, max(c.r, c.b))) * (1. - max(bear, hang));
  c += vec3(.85, .9, 1.) * shootingStars(q) * sky;

  gl_FragColor = vec4(c, 1.);
}`;

const FRAME_MS = 1000 / 30;

export default function MovingBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current!;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uView = gl.getUniformLocation(prog, 'view');
    const uT = gl.getUniformLocation(prog, 't');

    let raf = 0;
    let last = 0;
    let stopped = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uView, w, h);
      gl.uniform1f(uT, now / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const image = new Image();
    image.onload = () => {
      if (stopped) return;
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      raf = requestAnimationFrame(frame);
    };
    image.src = art;

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="bgmotion" aria-hidden="true" />;
}
