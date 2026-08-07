import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = [
  ['Apartment Block 01', 'public/models/city-style/buildings/apartment-block-01.glb', 'AD47795EED042CE697259CF77F3BA9246772399E7E9E5713FFBAAC43884F4883'],
  ['Glass Skyscraper 01', 'public/models/city-style/buildings/glass-skyscraper-01.glb', '1C4F430B06C2259AEA9AAEF01E352C5BB6586FBDED5710A150D667427C662318'],
  ['Convenience Store 01', 'public/models/city-style/buildings/convenience-store-01.glb', 'DBAAA5EC4AE7E53A7B34ACF9A16310E077041462B5C4796072B0C998D05EECDC'],
  ['Corner Store 01', 'public/models/city-style/buildings/corner-store-01.glb', '956091AF8CE08F4306C0A8DA051D73F3AA84D4BC5856F5D50D2DC0FFCB7E5FAA'],
  ['Thatched House 01', 'public/models/city-style/buildings/home-thatched-house-01.glb', '76F8FA588F49BEB591A44A3B30F20457E71B3DF7961AE2A5AE6DFE04088CF98C'],
  ['Shop Awning 01', 'public/models/city-style/buildings/shop-awning-01.glb', 'E799FC3B21AF21C9F5DA25A28759829C9E7F4E15C5FC0526A69F0F76DF7DF18E'],
  ['Terrain Grass 01', 'public/models/city-style/environment/terrain-grass-01.glb', '52907ABEE0FF351D8709705C0588DC8421F8F8AD7DBA15801BFD3224446015CF'],
  ['Water Open Oasis', 'public/models/city-style/environment/water-open-oasis.glb', '96DD9660D519F51287BC2556F938BBEC07C5E8DC63C809941BFED262A1487CE6'],
  ['Tree Oak 01', 'public/models/city-style/environment/tree-oak-01.glb', 'ABA3D2E08109D5678BAEA5DA4F6039B476D1ED814F1F94755475DEFF2B7B7D0C'],
  ['Date Palm', 'public/models/city-style/environment/date-palm.glb', '6D1A7D7CD4B3EB12A88196C913F391CC6180BD47DD3C0BA569565E76E66305CF'],
  ['Bush Round 01', 'public/models/city-style/environment/bush-round-01.glb', 'D3DBF037CA645D2E84F80402D98DAAC376D0A838CF9870BBD8CA263252825C4B'],
  ['Cloud Puff 01', 'public/models/city-style/environment/cloud-puff-01.glb', '68CF90FB4A35E7D433C2D005680E452B7A2D455875682D21C682894F69B912F0'],
  ['Road Cobble Straight 01', 'public/models/city-style/street/road-cobble-straight-01.glb', 'E8962000911C83080EEED300724173C4F81EDE0410B2BBF824CFF2B22D6043C5'],
  ['Bench 01', 'public/models/city-style/street/bench-01.glb', '33CDC9258296465F72AB2B625C9F357CE5A8C9F6ABD9C454733A9E2593B6B1B9'],
  ['Trash Bin 01', 'public/models/city-style/street/trash-bin-01.glb', '8D2EC16A7E157AE200D1E470C0F7776A1A2407171A0AB3C3F176EFB6B6A43E40'],
  ['Fire Brazier', 'public/models/city-style/street/fire-brazier.glb', '0C85FBE84FEFC9207F0BF95B155A9BA722F60FD2D0DF88015BF3F0065279A560'],
];

let totalBytes = 0;
for (const [name, relativePath, expectedSha256] of assets) {
  const file = await readFile(resolve(process.cwd(), relativePath));
  if (file.length < 20 || file.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${name} is not a valid binary glTF file.`);
  }
  const declaredLength = file.readUInt32LE(8);
  if (declaredLength !== file.length) {
    throw new Error(`${name} declares ${declaredLength} bytes but contains ${file.length}.`);
  }
  const sha256 = createHash('sha256').update(file).digest('hex').toUpperCase();
  if (sha256 !== expectedSha256) {
    throw new Error(`${name} SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}.`);
  }
  totalBytes += file.length;
  console.log(`${name}: ${file.length} bytes, SHA-256 ${sha256}`);
}

console.log(`Verified ${assets.length} authenticated Free GLBs (${totalBytes} bytes total).`);
