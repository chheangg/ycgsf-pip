// Turns flat text into thick liquid glass for Pip's app icon: a rounded bevel from the text's distance field,
// neon pink edges, an iridescent pink-to-cyan rim, a white highlight from the top left and a soft outer glow.
// A shader effect on the "Glass" frame (around the "pip" text) in the App Icon frame of design/untitled.pen.
precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Shape
 * @sdf
 */
uniform sampler2D u_sdf;

/**
 * @label Pink
 * @color
 * @default #FF5CA8
 */
uniform vec3 u_pink;

/**
 * @label Violet
 * @color
 * @default #7A3CFF
 */
uniform vec3 u_violet;

/**
 * @label Cyan
 * @color
 * @default #3CE0FF
 */
uniform vec3 u_cyan;

/**
 * @label Bevel
 * @default 46
 * @range 4, 120
 */
uniform float u_bevel;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 s = texture2D(u_sdf, uv);
  float d = s.r;
  vec2 g = length(s.gb) > 0.0 ? normalize(s.gb) : vec2(0.0);

  // Outside the letters: only a neon glow that fades out over ~25 px.
  float glow = exp(max(-d, 0.0) / -25.0) * 0.5;
  vec3 outC = u_pink * glow;
  float outA = glow;

  // Inside: a rounded bevel. The slope is steepest at the edge and flat after u_bevel px.
  float t = clamp(d / u_bevel, 0.0, 1.0);
  float slope = 1.0 - t;
  vec3 n = normalize(vec3(-g * slope * 1.6, 1.0));

  vec3 body = mix(u_violet * 0.4, u_pink * 0.75, uv.y);
  body *= 0.6 + 0.4 * t;

  float rim = pow(1.0 - n.z, 1.2);
  float ang = atan(n.y, n.x);
  vec3 irid = mix(u_pink, u_cyan, smoothstep(-0.2, 0.9, -n.y * 0.7 + n.x * 0.7));
  vec3 c = body + irid * rim * 1.6;

  c += mix(u_pink, vec3(1.0, 0.75, 0.9), 0.3) * exp(-d / 5.0) * 1.2;

  vec3 L = normalize(vec3(-0.45, 0.7, 0.9));
  float spec = pow(max(dot(n, L), 0.0), 70.0);
  c += vec3(1.0) * spec * 0.8;
  // A thin white line 8-16 px inside the edges that face the light.
  float streak = smoothstep(0.6, 1.0, dot(-g, normalize(vec2(-0.35, 1.0)))) * smoothstep(5.0, 9.0, d) * smoothstep(17.0, 11.0, d);
  c += vec3(1.0, 0.96, 1.0) * streak * 0.9;
  float sheen = smoothstep(0.35, 1.0, uv.y) * t * 0.18;
  c += vec3(1.0) * sheen;

  c = 1.0 - exp(-c * 1.3);
  float a = smoothstep(-0.8, 0.8, d);
  gl_FragColor = vec4(mix(outC, c, a), mix(outA, 1.0, a));
}
