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
 * @label Blinks per second
 * @default 1.1
 * @range 0.2, 4
 */
uniform float u_rate;

void main() {
  float p = fract(u_time * u_rate);
  float on = 1.0 - smoothstep(0.55, 0.62, p) + smoothstep(0.94, 1.0, p);
  gl_FragColor = vec4(u_color * on, on);
}
