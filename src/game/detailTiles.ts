/** Load a child-tile mosaic, failing closed so callers retain their complete base map. */
export async function loadDetailTiles(
  parentX: number,
  parentY: number,
  scale: number,
  load: (x: number, y: number, offsetX: number, offsetY: number) => Promise<boolean>,
): Promise<boolean> {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) throw new Error('Unsupported detail scale.');
  let next = 0;
  let successful = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < scale * scale) {
      const index = next++;
      const x = index % scale;
      const y = Math.floor(index / scale);
      try {
        if (await load(parentX * scale + x, parentY * scale + y, x, y)) successful++;
        else failed = true;
      } catch { failed = true; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, scale * scale) }, worker));
  return successful === scale * scale;
}
