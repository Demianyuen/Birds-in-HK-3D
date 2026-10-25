import type { ServerResponse } from 'node:http';
import {
  ApiError,
  readJson,
  requireModerator,
  rest,
  sendError,
  sendJson,
  supabaseConfig,
  type ApiRequest,
} from './_lib/openWorld';

type Action = 'approve' | 'reject' | 'hide-flower' | 'hide-chat';
const ACTIONS: readonly Action[] = ['approve', 'reject', 'hide-flower', 'hide-chat'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moderator-only (Authorization: Bearer MODERATOR_TOKEN).
 * GET  /api/moderate?view=pending → messages waiting for approval
 * GET  /api/moderate?view=chat    → the last day of live chat
 * POST /api/moderate { action, id } → approve / reject a message, hide a flower or a chat line
 */
export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    requireModerator(req);
    const config = supabaseConfig();
    if (req.method === 'GET') {
      const view = new URL(req.url ?? '/', 'http://vercel.local').searchParams.get('view');
      if (view === 'chat') {
        const response = await rest(config, 'memorial_chat?select=id,created_at,name,body,hidden&order=created_at.desc&limit=200');
        sendJson(res, 200, { chat: await response.json() });
        return;
      }
      const response = await rest(
        config,
        'memorial_flowers?select=id,created_at,name,message,kind,hidden&message_status=eq.pending&order=created_at.asc&limit=200',
      );
      sendJson(res, 200, { pending: await response.json() });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new ApiError(405, 'Method not allowed.');
    }
    const body = await readJson(req);
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) throw new ApiError(422, 'Unknown action.');
    if (action === 'hide-chat') {
      if (!Number.isSafeInteger(body.id)) throw new ApiError(422, 'Invalid chat id.');
      await rest(config, `memorial_chat?id=eq.${body.id}`, { method: 'PATCH', body: { hidden: true }, headers: { Prefer: 'return=minimal' } });
    } else {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new ApiError(422, 'Invalid flower id.');
      const patch = action === 'approve' ? { message_status: 'approved' }
        : action === 'reject' ? { message_status: 'rejected' }
          : { hidden: true };
      await rest(config, `memorial_flowers?id=eq.${body.id}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}
