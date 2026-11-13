import type { ServerResponse } from 'node:http';
import { readQuiet } from './_lib/quiet.js';
import { sendError, sendJson, supabaseConfig, type ApiRequest } from './_lib/openWorld.js';

/** GET /api/settings → { quiet } — whether visitors' words are shown to others right now. */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(res, 200, { quiet: await readQuiet(supabaseConfig()) }, 15);
  } catch (error) {
    sendError(res, error);
  }
}
