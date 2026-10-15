import * as THREE from 'three';

const vertex = /* glsl */ `
in vec3 uvw;
out vec3 vUvw;
out vec3 vColor;
out float vDepth;
void main() {
  vUvw = uvw;
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uAlphaTest;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform vec2 uFog;
in vec3 vUvw;
in vec3 vColor;
in float vDepth;
out vec4 fragColor;
void main() {
  vec4 t = texture(uAtlas, vUvw);
  if (t.a < uAlphaTest) discard;
  vec3 c = t.rgb * vColor;
  float f = clamp((vDepth - uFog.x) / max(1.0, uFog.y - uFog.x), 0.0, 1.0);
  fragColor = vec4(mix(c, uFogColor, f * 0.55), uOpacity < 1.0 ? t.a * uOpacity : 1.0);
}
`;

export type LayerKind = 'opaque' | 'cutout' | 'translucent';

/**
 * Minecraft look: texel × (directional shade · ambient occlusion · biome tint) baked per vertex,
 * no dynamic lights. Values stay in sRGB end to end, like the game.
 */
export function createBlockMaterial(
  atlas: THREE.DataArrayTexture,
  kind: LayerKind,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vertex,
    fragmentShader: fragment,
    vertexColors: true,
    uniforms: {
      uAtlas: { value: atlas },
      uAlphaTest: { value: kind === 'opaque' ? 0 : kind === 'cutout' ? 0.35 : 0.02 },
      uOpacity: { value: kind === 'translucent' ? 0.97 : 1 },
      uFogColor: { value: new THREE.Color(0.75, 0.82, 0.92) },
      uFog: { value: new THREE.Vector2(1e6, 2e6) },
    },
    transparent: kind === 'translucent',
    depthWrite: kind !== 'translucent',
    side: kind === 'translucent' ? THREE.DoubleSide : THREE.FrontSide,
  });
  return mat;
}
