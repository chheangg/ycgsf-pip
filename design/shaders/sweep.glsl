precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Base
 * @color
 * @default #3A1A2A
 */
uniform vec3 u_base;
/**
 * @label Shine
 * @color
 * @default #FF5CA8
 */
uniform vec3 u_shine;
/**
 * @label Speed
 * @default 0.7
 * @range 0.1, 3
 */
uniform float u_speed;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float p = fract(u_time * u_speed) * 1.8 - 0.4;
  float x = uv.x + (uv.y - 0.5) * 0.25;
  float band = exp(-pow((x - p) / 0.16, 2.0));
  vec3 c = mix(u_base, u_shine, band * 0.55);
  gl_FragColor = vec4(c, 1.0);
}
