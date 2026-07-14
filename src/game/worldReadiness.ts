export interface WorldReadinessMetrics {
  parsedModels: number;
  visibleTiles: number;
  webglContextAvailable: boolean;
}

export interface WorldReadinessResult {
  ready: boolean;
  blockers: string[];
}

export function evaluateWorldReadiness(metrics: WorldReadinessMetrics): WorldReadinessResult {
  const blockers: string[] = [];
  if (!metrics.webglContextAvailable) blockers.push('WebGL context is unavailable or lost.');
  if (metrics.parsedModels < 1) blockers.push('No CSDI model containing renderable meshes has parsed.');
  if (metrics.visibleTiles < 1) blockers.push('No parsed CSDI tile is visible to the flight camera.');
  return { ready: blockers.length === 0, blockers };
}
