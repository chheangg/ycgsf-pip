precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label State color
 * @color
 * @default #FF5CA8
 */
uniform vec3 u_color;
/**
 * @label Sparks
 * @color
 * @default #FFFFFF
 */
uniform vec3 u_spark;
/**
 * @label Base
 * @color
 * @default #07070A
 */
uniform vec3 u_base;
/**
 * @label Strength
 * @default 0.32
 * @range 0, 1
 */
uniform float u_strength;
/**
 * @label Speed
 * @default 1
 * @range 0, 3
 */
uniform float u_speed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }

// Data matrix: a faint dot grid over the whole screen. Data gathers in slow drifting clusters, a few dots flicker
// like live data, and a soft scan passes diagonally every few seconds, all in the state color (the top line's glyph).
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / u_resolution;
  float asp = u_resolution.x / u_resolution.y, t = u_time * u_speed, s = u_strength / 0.32, cs = 9.0;
  vec2 cell = floor(fc / cs);
  vec2 d = fc - cell * cs - 0.5 * cs;
  float pt = 1.0 - smoothstep(0.6, 1.3, max(abs(d.x), abs(d.y)));
  float field = smoothstep(0.4, 0.8, fbm(cell * 0.05 + vec2(0.0, 0.03 * t)));
  float wave = pow(0.5 + 0.5 * sin((uv.x * asp * 0.6 + uv.y) * 4.0 - 0.45 * t), 14.0);
  float h = hash(cell);
  float ph = 0.7 * t + 13.0 * h;
  float live = step(0.982, hash(cell + floor(ph))) * (1.0 - fract(ph));
  vec3 tint = mix(u_color, u_spark * 0.8, step(0.75, hash(cell + 3.1)));
  vec3 col = u_base + pt * (vec3(0.025 + 0.06 * field) + u_color * wave * (0.12 + 0.35 * field) + tint * live * 0.8) * s;
  col += u_color * wave * 0.012 * s;
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.9;
  col += (hash(fc) - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
