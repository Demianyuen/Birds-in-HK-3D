const baseUrl = process.env.BIRDS_IN_HK_URL ?? 'http://127.0.0.1:5173';
const assets = [
  {
    name: 'Terrarium elevation',
    path: '/terrain-elevation/13/6694/3571.png',
    validate: data => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    name: 'Blender pigeon GLB',
    path: '/models/pigeon.glb',
    validate: data => data.subarray(0, 4).toString('ascii') === 'glTF',
  },
  {
    name: 'Basis transcoder JavaScript',
    path: '/basis/basis_transcoder.js',
    validate: data => data.length > 10_000,
  },
  {
    name: 'Basis transcoder WASM',
    path: '/basis/basis_transcoder.wasm',
    validate: data => data.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])),
  },
];

for (const asset of assets) {
  const response = await fetch(`${baseUrl}${asset.path}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok || !asset.validate(data)) {
    throw new Error(`${asset.name} failed verification: HTTP ${response.status}, ${data.length} bytes.`);
  }
  console.log(`${asset.name}: HTTP ${response.status}, ${data.length} bytes`);
}
