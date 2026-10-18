/**
 * A timeout that only counts time while the page is visible.
 *
 * Tile streaming runs on requestAnimationFrame, which browsers pause in
 * background tabs. A plain 60 s timer would fail a load just because the
 * player switched tabs; this one waits until they come back.
 */
export interface VisibleTimeoutOptions {
  isHidden?: () => boolean;
  now?: () => number;
  setTick?: (callback: () => void, intervalMs: number) => () => void;
  tickMs?: number;
}

export function createVisibleTimeout(
  limitMs: number,
  onTimeout: () => void,
  options: VisibleTimeoutOptions = {},
): () => void {
  const isHidden = options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const now = options.now ?? (() => performance.now());
  const setTick = options.setTick ?? ((callback, intervalMs) => {
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  });
  let visibleMs = 0;
  let last = now();
  let done = false;
  const stop = setTick(() => {
    if (done) return;
    const current = now();
    if (!isHidden()) visibleMs += current - last;
    last = current;
    if (visibleMs >= limitMs) {
      done = true;
      stop();
      onTimeout();
    }
  }, options.tickMs ?? 500);
  return () => {
    done = true;
    stop();
  };
}
