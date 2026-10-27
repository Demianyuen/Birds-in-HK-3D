/**
 * The LandsD 3D Visualisation Map stores its photo textures as KTX2 images
 * but references them as plain images (no KHR_texture_basisu), so three.js
 * would try to decode them as PNG/JPEG and leave the mesh white. This glTF
 * loader plugin points those textures at the KTX2 path before parsing.
 */
export interface GltfJson {
  textures?: Array<{ source?: number; extensions?: Record<string, unknown> }>;
  images?: Array<{ mimeType?: string }>;
  extensionsUsed?: string[];
}

/** Rewrites the glTF JSON in place; returns true when anything changed. */
export function patchKtx2Images(json: GltfJson): boolean {
  let patched = false;
  for (const texture of json.textures ?? []) {
    const image = texture.source === undefined ? undefined : json.images?.[texture.source];
    if (!image || image.mimeType !== 'image/ktx2' || texture.extensions?.KHR_texture_basisu) continue;
    texture.extensions = { ...texture.extensions, KHR_texture_basisu: { source: texture.source } };
    patched = true;
  }
  if (patched) json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_texture_basisu'])];
  return patched;
}

export class Ktx2ImageFix {
  public readonly name = 'LANDSD_KTX2_IMAGE_FIX';
  public static patchedCount = 0;
  public constructor(private readonly parser: { json: GltfJson }) {}
  public beforeRoot(): null {
    if (patchKtx2Images(this.parser.json)) Ktx2ImageFix.patchedCount += 1;
    return null;
  }
}

/** Absolute links back to the upstream service go through our keyed proxy. */
export function landsdProxyUrl(uri: string | URL, origin: string): string {
  const local = uri.toString().replace(/^https?:\/\/data\.map\.gov\.hk\/api\/3d-data\/3dtiles\/f2\//, `${origin}/landsd-3dvis/`);
  const url = new URL(local, `${origin}/`);
  url.searchParams.delete('key');
  return url.toString();
}
