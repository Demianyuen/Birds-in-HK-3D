import type { IncomingMessage, ServerResponse } from 'node:http';

type Service = 'csdi-3d' | 'csdi-region' | 'landsd-map' | 'terrain-elevation' | 'road-data';

const CSDI_ORIGIN = 'https://data.map.gov.hk';
const LANDSD_ORIGIN = 'https://mapapi.geodata.gov.hk';
const TERRARIUM_ORIGIN = 'https://s3.amazonaws.com';
const ROAD_TILE_JSON = 'https://tiles.openfreemap.org/planet';
const regionTiles: Record<string, Record<string, string>> = {
  building: {
    'tai-po': 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
    'sha-tin': 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
    central: 'Data/F_Tile_+3_1_0/F_Tile_+3_1_0+R9_0.json',
    'tsim-sha-tsui': 'Data/F_Tile_+4_1_0/F_Tile_+4_1_0+R9_0.json',
  },
  infrastructure: {
    'tai-po': 'Data/F_Tile_+4_3_0/F_Tile_+4_3_0+R9_0.json',
    'sha-tin': 'Data/F_Tile_+4_2_0/F_Tile_+4_2_0+R9_0.json',
    central: 'Data/F_Tile_+3_0_0/F_Tile_+3_0_0+R9_0.json',
    'tsim-sha-tsui': 'Data/F_Tile_+4_1_0/F_Tile_+4_1_0+R9_0.json',
  },
};

interface Request extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
}

export default async function handler(req: Request, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://vercel.local');
  const service = value(requestUrl.searchParams.get('service')) as Service | null;
  const route = value(requestUrl.searchParams.get('path')) ?? '';
  if (!service || !isService(service)) {
    res.statusCode = 400;
    res.end('Unknown map service.');
    return;
  }

  try {
    if (service === 'csdi-region') {
      await handleRegionalTileset(route, res);
      return;
    }
    const upstreamUrl = await buildUpstreamUrl(service, route);
    const upstream = await fetch(upstreamUrl);
    await relay(upstream, res);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(error instanceof Error ? error.message : 'Map data proxy failed.');
  }
}

async function buildUpstreamUrl(service: Exclude<Service, 'csdi-region'>, route: string): Promise<string> {
  const cleanRoute = route.replace(/^\/+/, '');
  if (!cleanRoute || cleanRoute.includes('..')) throw new Error('Invalid map route.');
  if (service === 'csdi-3d') {
    const url = new URL(`/api/3d-data/3dsd/WGS84/${cleanRoute}`, CSDI_ORIGIN);
    addCsdiKey(url);
    return url.toString();
  }
  if (service === 'landsd-map') {
    const match = cleanRoute.match(/^(basemap|imagery)\/WGS84\/(.+)$/);
    if (!match) throw new Error('Invalid LandsD map route.');
    const url = new URL(`/gs/api/v1.0.0/xyz/${match[1]}/WGS84/${match[2]}`, LANDSD_ORIGIN);
    addCsdiKey(url);
    return url.toString();
  }
  if (service === 'terrain-elevation') {
    return new URL(`/elevation-tiles-prod/terrarium/${cleanRoute}`, TERRARIUM_ORIGIN).toString();
  }
  const roadMatch = cleanRoute.match(/^(\d{1,2})\/(\d+)\/(\d+)\.pbf$/);
  if (!roadMatch) throw new Error('Invalid road tile route.');
  const tileJson = await fetch(ROAD_TILE_JSON);
  if (!tileJson.ok) throw new Error(`Road TileJSON returned HTTP ${tileJson.status}.`);
  const template = ((await tileJson.json()) as { tiles?: string[] }).tiles?.find(item => item.startsWith('https://'));
  if (!template) throw new Error('Road TileJSON did not provide a secure vector-tile URL.');
  return template.replace('{z}', roadMatch[1]).replace('{x}', roadMatch[2]).replace('{y}', roadMatch[3]);
}

async function handleRegionalTileset(route: string, res: ServerResponse): Promise<void> {
  const match = route.replace(/^\/+/, '').match(/^(building|infrastructure)\/([a-z-]+)\/tileset\.json$/);
  if (!match) throw new Error('Invalid regional CSDI route.');
  const layer = match[1];
  const regionId = match[2];
  const expectedUri = regionTiles[layer]?.[regionId];
  if (!expectedUri) throw new Error('Unknown Hong Kong flight region.');

  const upstreamUrl = new URL(`/api/3d-data/3dsd/WGS84/${layer}/tileset.json`, CSDI_ORIGIN);
  addCsdiKey(upstreamUrl);
  const upstreamResponse = await fetch(upstreamUrl);
  if (!upstreamResponse.ok) throw new Error(`CSDI ${layer} index returned HTTP ${upstreamResponse.status}.`);
  const upstream = await upstreamResponse.json() as {
    asset: Record<string, unknown>;
    root: { transform?: number[]; children?: Array<Record<string, unknown> & { content?: { uri?: string; url?: string } }> };
  };
  const selected = upstream.root.children?.find(child => (child.content?.uri ?? child.content?.url) === expectedUri);
  if (!selected || !upstream.root.transform) throw new Error(`CSDI ${layer} does not contain the configured regional tile.`);
  const body = JSON.stringify({
    asset: upstream.asset,
    geometricError: selected.geometricError,
    root: { ...selected, transform: upstream.root.transform, content: { uri: `/csdi-3d/${layer}/${expectedUri}` } },
  });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(body);
}

async function relay(upstream: Response, res: ServerResponse): Promise<void> {
  const body = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = upstream.status;
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', upstream.ok ? 'public, max-age=86400' : 'no-store');
  res.end(body);
}

function addCsdiKey(url: URL): void {
  const key = process.env.CSDI_3D_API_KEY?.trim();
  if (!key) throw new Error('The server is missing its CSDI API credential.');
  url.searchParams.set('key', key);
}

function isService(value: string): value is Service {
  return ['csdi-3d', 'csdi-region', 'landsd-map', 'terrain-elevation', 'road-data'].includes(value);
}

function value(value: string | null): string | null {
  return value && value.length <= 512 ? value : null;
}
