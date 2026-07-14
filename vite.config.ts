import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { FLIGHT_REGIONS, type CsdiRegionLayer } from './src/game/regions';

interface MiddlewareRequest extends NodeJS.ReadableStream {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface MiddlewareResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface Middlewares {
  use: (path: string, handler: (request: MiddlewareRequest, response: MiddlewareResponse, next: () => void) => void) => void;
}

function runtimeEvidencePlugin(): Plugin {
  const evidencePath = resolve(process.cwd(), 'runtime-evidence', 'events.jsonl');
  const framesPath = resolve(process.cwd(), 'runtime-evidence', 'frames');
  const installMiddleware = (middlewares: Middlewares): void => {
    middlewares.use('/__runtime-event', (request, response, next) => {
      if (request.method !== 'POST') {
        next();
        return;
      }
      let body = '';
      request.on('data', chunk => {
        if (body.length < 16_384) body += String(chunk);
      });
      request.on('end', () => {
        try {
          const event = JSON.parse(body) as Record<string, unknown>;
          mkdirSync(dirname(evidencePath), { recursive: true });
          appendFileSync(evidencePath, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...event })}\n`, 'utf8');
          response.statusCode = 204;
          response.end();
        } catch {
          response.statusCode = 400;
          response.end('Invalid runtime event.');
        }
      });
    });

    middlewares.use('/__runtime-frame', (request, response, next) => {
      if (request.method !== 'POST') {
        next();
        return;
      }
      const sessionHeader = request.headers?.['x-runtime-session'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (!sessionId || !/^[a-zA-Z0-9-]{1,80}$/.test(sessionId)) {
        response.statusCode = 400;
        response.end('Invalid runtime session.');
        return;
      }

      const chunks: Buffer[] = [];
      let byteLength = 0;
      let oversized = false;
      request.on('data', chunk => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += data.length;
        if (byteLength > 16 * 1024 * 1024) {
          oversized = true;
          return;
        }
        chunks.push(data);
      });
      request.on('end', () => {
        const data = Buffer.concat(chunks);
        const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (oversized || data.length < 8 || !data.subarray(0, 8).equals(pngMagic)) {
          response.statusCode = 400;
          response.end('Invalid runtime frame.');
          return;
        }
        mkdirSync(framesPath, { recursive: true });
        writeFileSync(resolve(framesPath, `${sessionId}.png`), data);
        response.statusCode = 204;
        response.end();
      });
    });
  };

  return {
    name: 'runtime-evidence',
    configureServer: server => installMiddleware(server.middlewares),
    configurePreviewServer: server => installMiddleware(server.middlewares),
  };
}

function csdiRegionPlugin(apiKey: string | undefined): Plugin {
  const cache = new Map<string, string>();

  const installMiddleware = (middlewares: Middlewares): void => {
    middlewares.use('/csdi-region', (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }
      const match = request.url?.match(/^\/(building|infrastructure)\/([a-z-]+)\/tileset\.json(?:\?.*)?$/);
      if (!match) {
        next();
        return;
      }
      void createRegionalTileset(match[1] as CsdiRegionLayer, match[2])
        .then(body => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(body);
        })
        .catch(error => {
          response.statusCode = 502;
          response.end(error instanceof Error ? error.message : 'Regional CSDI tileset failed.');
        });
    });
  };

  const createRegionalTileset = async (layer: CsdiRegionLayer, regionId: string): Promise<string> => {
    const cacheKey = `${layer}/${regionId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    if (!apiKey) throw new Error('The server is missing its CSDI API credential.');
    const region = FLIGHT_REGIONS.find(candidate => candidate.id === regionId);
    if (!region) throw new Error('Unknown Hong Kong flight region.');

    const upstreamUrl = new URL(`https://data.map.gov.hk/api/3d-data/3dsd/WGS84/${layer}/tileset.json`);
    upstreamUrl.searchParams.set('key', apiKey);
    const upstreamResponse = await fetch(upstreamUrl);
    if (!upstreamResponse.ok) {
      throw new Error(`CSDI ${layer} index returned HTTP ${upstreamResponse.status}.`);
    }
    const upstream = await upstreamResponse.json() as {
      asset: Record<string, unknown>;
      root: {
        transform?: number[];
        children?: Array<{
          boundingVolume: Record<string, unknown>;
          content?: { uri?: string; url?: string };
          geometricError: number;
          refine?: string;
        }>;
      };
    };
    const expectedUri = region.csdiTiles[layer];
    const selected = upstream.root.children?.find(child => {
      return (child.content?.uri ?? child.content?.url) === expectedUri;
    });
    if (!selected || !upstream.root.transform) {
      throw new Error(`CSDI ${layer} does not contain the configured ${region.englishLabel} tile.`);
    }

    const regional = {
      asset: upstream.asset,
      geometricError: selected.geometricError,
      root: {
        ...selected,
        transform: upstream.root.transform,
        content: { uri: `/csdi-3d/${layer}/${expectedUri}` },
      },
    };
    const body = JSON.stringify(regional);
    cache.set(cacheKey, body);
    return body;
  };

  return {
    name: 'csdi-regional-tilesets',
    configureServer: server => installMiddleware(server.middlewares),
    configurePreviewServer: server => installMiddleware(server.middlewares),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.CSDI_3D_API_KEY?.trim();
  const proxy: Record<string, string | ProxyOptions> = {
    '/terrain-elevation': {
      target: 'https://s3.amazonaws.com',
      changeOrigin: true,
      secure: true,
      rewrite: path => path.replace(
        /^\/terrain-elevation/,
        '/elevation-tiles-prod/terrarium',
      ),
    },
    '/csdi-3d': {
      target: 'https://data.map.gov.hk',
      changeOrigin: true,
      secure: true,
      rewrite: path => path.replace(/^\/csdi-3d/, '/api/3d-data/3dsd/WGS84'),
      configure: proxyServer => {
        proxyServer.on('proxyReq', proxyRequest => {
          if (!apiKey) return;
          const separator = proxyRequest.path.includes('?') ? '&' : '?';
          proxyRequest.path = `${proxyRequest.path}${separator}key=${encodeURIComponent(apiKey)}`;
        });
      },
    },
  };

  return {
    plugins: [runtimeEvidencePlugin(), csdiRegionPlugin(apiKey)],
    build: {
      chunkSizeWarningLimit: 750,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy,
    },
  };
});
