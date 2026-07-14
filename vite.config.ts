import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

function runtimeEvidencePlugin(): Plugin {
  const evidencePath = resolve(process.cwd(), 'runtime-evidence', 'events.jsonl');
  const installMiddleware = (middlewares: { use: (path: string, handler: (request: NodeJS.ReadableStream & { method?: string }, response: { statusCode: number; end: (body?: string) => void }, next: () => void) => void) => void }): void => {
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
  };

  return {
    name: 'runtime-evidence',
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
    '/hk-imagery': {
      target: 'https://mapapi.geodata.gov.hk',
      changeOrigin: true,
      secure: true,
      rewrite: path => path.replace(
        /^\/hk-imagery/,
        '/gs/api/v1.0.0/xyz/imagery/WGS84',
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
    plugins: [runtimeEvidencePlugin()],
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
