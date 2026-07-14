const baseUrl = process.env.BIRDS_IN_HK_URL ?? 'http://127.0.0.1:5173';

for (const layer of ['building', 'infrastructure']) {
  await verifyTileset(`${layer} root`, `${baseUrl}/csdi-3d/${layer}/tileset.json`);
  await verifyTileset(
    `Tai Po regional ${layer}`,
    `${baseUrl}/csdi-region/${layer}/tai-po/tileset.json`,
  );
}

async function verifyTileset(name, rootUrl) {
  const rootResponse = await fetch(rootUrl);
  if (!rootResponse.ok) throw new Error(`${name} tileset returned HTTP ${rootResponse.status}.`);

  let currentUrl = rootUrl;
  let tileset = await rootResponse.json();
  let contentUrl = null;

  for (let depth = 0; depth < 16 && !contentUrl; depth += 1) {
    const queue = [tileset.root];
    let nestedTilesetUrl = null;
    while (queue.length > 0 && !contentUrl && !nestedTilesetUrl) {
      const tile = queue.shift();
      const uri = tile?.content?.uri ?? tile?.content?.url;
      if (uri) {
        const resolved = new URL(uri, currentUrl).toString();
        if (/\.b3dm(?:$|\?)/i.test(resolved)) contentUrl = resolved;
        else if (/\.json(?:$|\?)/i.test(resolved)) nestedTilesetUrl = resolved;
      }
      if (tile?.children) queue.push(...tile.children);
    }

    if (!contentUrl && nestedTilesetUrl) {
      currentUrl = nestedTilesetUrl;
      const response = await fetch(currentUrl);
      if (!response.ok) throw new Error(`${name} nested tileset returned HTTP ${response.status}.`);
      tileset = await response.json();
    } else if (!contentUrl) {
      break;
    }
  }

  if (!contentUrl) throw new Error(`No B3DM content was found for ${name}.`);
  const contentResponse = await fetch(contentUrl);
  const data = Buffer.from(await contentResponse.arrayBuffer());
  const magic = data.subarray(0, 4).toString('ascii');
  if (!contentResponse.ok || magic !== 'b3dm') {
    throw new Error(`${name} content failed: HTTP ${contentResponse.status}, magic ${magic}.`);
  }

  console.log(`${name}: root 200, B3DM 200, ${data.length} bytes`);
}
