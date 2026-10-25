precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Lit
 * @color
 * @default #FF5CA8
 */
uniform vec3 u_color;
/**
 * @label Off
 * @color
 * @default #262521
 */
uniform vec3 u_dim;
/**
 * @label Columns
 * @default 24
 * @range 4, 64
 */
uniform float u_cols;
/**
 * @label Rows
 * @default 9
 * @range 3, 25
 */
uniform float u_rows;
/**
 * @label Energy
 * @default 1
 * @range 0, 1
 */
uniform float u_energy;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float col = floor(uv.x * u_cols);
  float row = floor(uv.y * u_rows);
  vec2 cell = vec2(fract(uv.x * u_cols), fract(uv.y * u_rows));
  float t = u_time;
  float a = 0.5 + 0.5 * sin(col * 0.55 + t * 3.1) * sin(col * 0.23 - t * 1.7 + sin(t * 0.7));
  a = mix(0.06, a, u_energy);
  float hh = floor(a * (u_rows * 0.5) + 0.5);
  float d = abs(row - (u_rows - 1.0) * 0.5);
  float lit = step(d, hh - 0.5) + step(d, 0.01);
  lit = clamp(lit, 0.0, 1.0);
  float inCell = step(0.14, cell.x) * step(cell.x, 0.86) * step(0.18, cell.y) * step(cell.y, 0.82);
  vec3 c = mix(u_dim, u_color, lit);
  gl_FragColor = vec4(c * inCell, inCell);
}
