precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Color
 * @color
 * @default #FF5CA8
 */
uniform vec3 u_color;
/**
 * @label Grid
 * @default 26
 * @range 8, 64
 */
uniform float u_grid;

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / u_resolution;
  float y = 1.0 - fract(u_time * 0.32);
  float dy = uv.y - y;
  float line = exp(-abs(dy) * u_resolution.y * 0.35);
  float trail = (dy > 0.0) ? exp(-dy * 9.0) * 0.16 : 0.0;
  vec2 g = mod(px, u_grid);
  float dots = step(g.x, 1.6) * step(g.y, 1.6) * 0.22;
  float a = clamp(line + trail + dots, 0.0, 1.0);
  gl_FragColor = vec4(u_color * a, a);
}
