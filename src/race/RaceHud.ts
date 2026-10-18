import { formatRaceTime, type RacePhase, type RaceStanding } from './course';

export interface RaceHudView {
  mode: 'solo' | 'online';
  phase: RacePhase;
  /** Milliseconds left in the current phase, or elapsed race time for solo. */
  clockMs: number;
  ring: number;
  totalRings: number;
  distanceMetres: number | null;
  standings: RaceStanding[];
  selfId: string | null;
  bestMs: number | null;
  message?: string;
}

/** Race overlay: phase banner, ring counter, timer and leaderboard. */
export class RaceHud {
  public readonly element = document.createElement('section');
  private readonly banner = document.createElement('p');
  private readonly clock = document.createElement('p');
  private readonly counter = document.createElement('p');
  private readonly board = document.createElement('ol');
  private readonly startButton = document.createElement('button');
  private boardSignature = '';

  public constructor(onStartSolo: () => void) {
    this.element.className = 'race-hud';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '飛環賽');
    this.banner.className = 'race-banner';
    this.clock.className = 'race-clock';
    this.counter.className = 'race-counter';
    this.board.className = 'race-board';
    this.board.setAttribute('aria-label', '排名');
    this.startButton.type = 'button';
    this.startButton.className = 'race-start';
    this.startButton.textContent = '開始計時賽 (R)';
    this.startButton.addEventListener('click', () => { this.startButton.blur(); onStartSolo(); });
    const top = document.createElement('div');
    top.className = 'race-top';
    top.append(this.banner, this.clock, this.counter);
    this.element.append(top, this.board, this.startButton);
  }

  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  public render(view: RaceHudView): void {
    const banner = view.message ?? bannerText(view);
    if (this.banner.textContent !== banner) this.banner.textContent = banner;
    this.element.dataset.phase = view.phase;
    const clock = view.phase === 'countdown'
      ? String(Math.max(1, Math.ceil(view.clockMs / 1000)))
      : view.phase === 'racing' || view.phase === 'results'
        ? formatRaceTime(view.clockMs)
        : '';
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const counter = view.phase === 'racing'
      ? `光環 ${Math.min(view.ring + 1, view.totalRings)} / ${view.totalRings}${view.distanceMetres !== null ? ` · ${Math.round(view.distanceMetres)} 米` : ''}`
      : view.bestMs !== null && view.mode === 'solo' ? `個人最佳 ${formatRaceTime(view.bestMs)}` : '';
    if (this.counter.textContent !== counter) this.counter.textContent = counter;
    this.startButton.hidden = view.mode !== 'solo' || view.phase === 'racing' || view.phase === 'countdown';

    const signature = JSON.stringify([view.standings.map(s => [s.id, s.rings, s.finishMs]), view.selfId, view.totalRings]);
    if (signature === this.boardSignature) return;
    this.boardSignature = signature;
    this.board.replaceChildren();
    this.board.hidden = view.standings.length === 0;
    for (const standing of view.standings.slice(0, 8)) {
      const item = document.createElement('li');
      if (standing.id === view.selfId) item.className = 'self';
      const name = document.createElement('span');
      name.textContent = standing.name;
      const score = document.createElement('span');
      score.textContent = standing.finishMs !== null ? formatRaceTime(standing.finishMs) : `${standing.rings}/${view.totalRings}`;
      item.append(name, score);
      this.board.append(item);
    }
  }
}

function bannerText(view: RaceHudView): string {
  if (view.phase === 'countdown') return '準備起飛';
  if (view.phase === 'racing') return view.mode === 'online' ? '多人飛環賽' : '計時賽';
  if (view.phase === 'results') {
    const self = view.standings.find(standing => standing.id === view.selfId);
    if (self?.finishMs != null) return view.mode === 'online'
      ? `完成！第 ${view.standings.indexOf(self) + 1} 名`
      : '完成！';
    return '時間到';
  }
  return view.mode === 'online' ? '等待下一局…' : '自由飛行 · 按 R 開始計時賽';
}
