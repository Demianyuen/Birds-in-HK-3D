export type ScreenName = 'boot' | 'menu' | 'loading' | 'error' | 'game';
export type FlowEvent = 'continue' | 'start' | 'retry' | 'world-ready' | 'world-error';

const transitions: Record<ScreenName, Partial<Record<FlowEvent, ScreenName>>> = {
  boot: { continue: 'menu' },
  menu: { start: 'loading' },
  loading: { 'world-ready': 'game', 'world-error': 'error' },
  error: { retry: 'loading' },
  game: {},
};

export function transitionFlow(current: ScreenName, event: FlowEvent): ScreenName {
  const next = transitions[current][event];
  if (!next) throw new Error(`Invalid game flow transition: ${current} + ${event}.`);
  return next;
}
