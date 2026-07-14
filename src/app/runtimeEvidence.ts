const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const evidenceSchema = 5;

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

export async function captureRuntimeFrame(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const response = await fetch('/__runtime-frame', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-Runtime-Session': sessionId,
      },
      body: blob,
    });
    return response.ok;
  } catch {
    return false;
  }
}
