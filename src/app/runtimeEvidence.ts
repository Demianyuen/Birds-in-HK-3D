const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const evidenceSchema = 2;

export function reportRuntimeEvent(type: string, details: Record<string, unknown> = {}): void {
  const payload = {
    sessionId,
    evidenceSchema,
    type,
    clientTime: new Date().toISOString(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    details,
  };
  void fetch('/__runtime-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Runtime evidence must never interrupt the game.
  });
}
