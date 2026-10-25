precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/** @label Content */
uniform sampler2D u_content;
/**
 * @label Speed
 * @default 1.4
 * @range 0.2, 4
 */
uniform float u_speed;
/**
 * @label Low
 * @default 0.35
 * @range 0, 1
 */
uniform float u_low;

void main() {
  vec4 c = texture2D(u_content, gl_FragCoord.xy / u_resolution);
  float k = mix(u_low, 1.0, 0.5 + 0.5 * sin(u_time * u_speed * 3.14159));
  gl_FragColor = c * k;
}
