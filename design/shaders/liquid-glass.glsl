precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Backdrop
 * @mipmap
 */
uniform sampler2D u_bg;

/** @sdf */
uniform sampler2D u_sdf;

/**
 * @label Tint
 * @color
 * @default #FFFFFF
 */
uniform vec3 u_tint;

/**
 * @label Tint amount
 * @default 0.08
 * @range 0, 1
 */
uniform float u_tintAmt;

/**
 * @label Bezel width
 * @default 16
 * @range 1, 60
 */
uniform float u_bezel;

/**
 * @label Refraction
 * @default 22
 * @range 0, 80
 */
uniform float u_refract;

/**
 * @label Frost (blur radius, px)
 * @default 10
 * @range 0, 40
 */
uniform float u_frost;

/**
 * @label Highlight
 * @default 0.7
 * @range 0, 1.5
 */
uniform float u_spec;

/**
 * @label Dispersion
 * @default 0.12
 * @range 0, 0.5
 */
uniform float u_disp;

/**
 * @label Light from top (1) or bottom (-1)
 * @default 1
 * @range -1, 1
 */
uniform float u_lightY;

// Frosted backdrop: 16-tap spiral blur, with each color channel bent a little differently.
vec3 backdrop(vec2 p, vec2 off) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    vec2 tap = vec2(cos(a), sin(a)) * sqrt((fi + 0.5) / 16.0) * u_frost;
    acc.r += texture2D(u_bg, (p + tap + off * (1.0 + u_disp)) / u_resolution).r;
    acc.g += texture2D(u_bg, (p + tap + off) / u_resolution).g;
    acc.b += texture2D(u_bg, (p + tap + off * (1.0 - u_disp)) / u_resolution).b;
  }
  return acc / 16.0;
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 s = texture2D(u_sdf, p / u_resolution);
  float d = max(s.r, 0.0);
  float gl = length(s.gb);
  vec2 n = gl > 0.0001 ? s.gb / gl : vec2(0.0);

  // Lens: near the edge, pull in light from just outside the shape.
  float e = clamp(1.0 - d / u_bezel, 0.0, 1.0);
  float bend = e * e;
  vec3 col = backdrop(p, -n * bend * u_refract);
  col = mix(col, u_tint, u_tintAmt);

  // Specular rim: bright on the edge facing the light, softer on the far edge.
  vec2 L = normalize(vec2(-1.0, u_lightY));
  float facing = dot(-n, L);
  float rim = 1.0 - smoothstep(0.0, 1.6, d);
  float spec = rim * (0.85 * pow(max(facing, 0.0), 1.5) + 0.35 * pow(max(-facing, 0.0), 1.5) + 0.1);
  float sheen = bend * 0.05 * (0.4 + 0.6 * max(facing, 0.0));
  col += u_spec * (spec + sheen);

  gl_FragColor = vec4(col, 1.0);
}
