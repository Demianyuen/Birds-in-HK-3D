import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  end: (body?: string | Uint8Array) => void;
}

function roadDataPlugin(): Plugin {
  const tileJsonUrl = 'https://tiles.openfreemap.org/planet';
  const tileCache = new Map<string, Uint8Array>();
  let tileTemplatePromise: Promise<string> | null = null;

  const resolveTileTemplate = (): Promise<string> => {
    tileTemplatePromise ??= fetch(tileJsonUrl)
      .then(async upstream => {
        if (!upstream.ok) throw new Error(`Road TileJSON returned HTTP ${upstream.status}.`);
        const tileJson = await upstream.json() as { tiles?: string[] };
        const template = tileJson.tiles?.find(candidate => candidate.startsWith('https://'));
        if (!template) throw new Error('Road TileJSON did not provide a secure vector-tile URL.');
        return template;
      })
      .catch(error => {
        tileTemplatePromise = null;
        throw error;
      });
    return tileTemplatePromise;
  };

  const installMiddleware = (middlewares: Middlewares): void => {
    middlewares.use('/road-data', (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }
      const match = request.url?.match(/^\/(\d{1,2})\/(\d+)\/(\d+)\.pbf(?:\?.*)?$/);
      if (!match) {
        next();
        return;
      }
      const [, zoom, x, y] = match;
      const cacheKey = `${zoom}/${x}/${y}`;
      void Promise.resolve(tileCache.get(cacheKey) ?? null)
        .then(async cached => {
          if (cached) return cached;
          const template = await resolveTileTemplate();
          const upstreamUrl = template
            .replace('{z}', zoom)
            .replace('{x}', x)
            .replace('{y}', y);
          const upstream = await fetch(upstreamUrl);
          if (!upstream.ok) throw new Error(`Road tile returned HTTP ${upstream.status}.`);
          const data = new Uint8Array(await upstream.arrayBuffer());
          if (data.byteLength === 0) throw new Error('Road tile was empty.');
          tileCache.set(cacheKey, data);
          return data;
        })
        .then(data => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/x-protobuf');
          response.setHeader('Cache-Control', 'public, max-age=86400');
          response.end(data);
        })
        .catch(error => {
          response.statusCode = 502;
          response.end(error instanceof Error ? error.message : 'Road tile failed.');
        });
    });
  };

  return {
    name: 'regional-road-data',
    configureServer: server => installMiddleware(server.middlewares),
    configurePreviewServer: server => installMiddleware(server.middlewares),
  };
}

interface Middlewares {
  use: (path: string, handler: (request: MiddlewareRequest, response: MiddlewareResponse, next: () => void) => void) => void;
}

function studioStatePlugin(): Plugin {
  const statePath = resolve(process.cwd(), 'runtime-evidence', 'studio-state.json');
  const agentIds = new Set(['dou-dou', 'nian-nian', 'map-agent', 'qa-agent', 'asset-agent']);
  const states = new Set(['working', 'reviewing', 'handoff', 'done', 'waiting', 'blocked', 'offline']);
  const sensitiveText = /(?:api[ _-]?key|access[ _-]?token|password|credential|bearer\s+|sk-[a-z0-9_-]{8,})/i;

  const safeText = (value: unknown, maxLength: number): value is string => {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !sensitiveText.test(value);
  };

  const sanitize = (input: unknown): Record<string, unknown> | null => {
    if (typeof input !== 'object' || input === null || !('agents' in input) || !Array.isArray(input.agents)) return null;
    const source = 'source' in input ? input.source : undefined;
    const updatedAt = 'updatedAt' in input ? input.updatedAt : undefined;
    if (source !== 'local-feed' || typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return null;
    const agents = [];
    for (const item of input.agents) {
      if (typeof item !== 'object' || item === null) return null;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.id !== 'string' || !agentIds.has(candidate.id)) return null;
      if (typeof candidate.state !== 'string' || !states.has(candidate.state)) return null;
      if (!safeText(candidate.task, 160) || !safeText(candidate.runtime, 60)) return null;
      if (typeof candidate.updatedAt !== 'string' || Number.isNaN(Date.parse(candidate.updatedAt))) return null;
      agents.push({
        id: candidate.id,
        state: candidate.state,
        task: candidate.task,
        runtime: candidate.runtime,
        updatedAt: candidate.updatedAt,
      });
    }
    return { source: 'local-feed', updatedAt, agents };
  };

  const installMiddleware = (middlewares: Middlewares): void => {
    middlewares.use('/api/studio-state', (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (!existsSync(statePath)) {
        response.statusCode = 404;
        response.end('{"source":"snapshot"}');
        return;
      }
      try {
        if (statSync(statePath).size > 32_768) throw new Error('Studio state is too large.');
        const state = sanitize(JSON.parse(readFileSync(statePath, 'utf8')));
        if (!state) throw new Error('Studio state does not match the public schema.');
        response.statusCode = 200;
        response.end(JSON.stringify(state));
      } catch {
        response.statusCode = 422;
        response.end('{"error":"Invalid studio state."}');
      }
    });
  };

  return {
    name: 'studio-state',
    configureServer: server => installMiddleware(server.middlewares),
    configurePreviewServer: server => installMiddleware(server.middlewares),
  };
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
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end('{"ok":true}');
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
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end('{"ok":true}');
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
    '/landsd-map': {
      target: 'https://mapapi.geodata.gov.hk',
      changeOrigin: true,
      secure: true,
      rewrite: path => path.replace(
        /^\/landsd-map\/(basemap|imagery)/,
        '/gs/api/v1.0.0/xyz/$1/WGS84',
      ),
      configure: proxyServer => {
        proxyServer.on('proxyReq', proxyRequest => {
          if (!apiKey) return;
          const separator = proxyRequest.path.includes('?') ? '&' : '?';
          proxyRequest.path = `${proxyRequest.path}${separator}key=${encodeURIComponent(apiKey)}`;
        });
      },
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
    plugins: [studioStatePlugin(), runtimeEvidencePlugin(), roadDataPlugin(), csdiRegionPlugin(apiKey)],
    build: {
      chunkSizeWarningLimit: 750,
      rollupOptions: {
        input: {
          app: resolve(process.cwd(), 'index.html'),
          studio: resolve(process.cwd(), 'studio.html'),
          cityStyle: resolve(process.cwd(), 'city-style.html'),
        },
      },
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
