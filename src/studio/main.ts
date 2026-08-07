import './styles.css';
import { StudioWorld } from './StudioWorld';
import {
  AGENTS,
  STATE_LABELS,
  applyLiveState,
  parseLiveState,
  type AgentId,
  type AgentProfile,
  type StudioLiveState,
  type StudioView,
} from './data';

const worldElement = required<HTMLElement>('studio-world');
const agentList = required<HTMLElement>('agent-list');
const inspectorName = required<HTMLElement>('inspector-name');
const inspectorStatus = required<HTMLElement>('inspector-status');
const inspectorRole = required<HTMLElement>('inspector-role');
const inspectorSummary = required<HTMLElement>('inspector-summary');
const inspectorContent = required<HTMLElement>('inspector-content');
const feedSource = required<HTMLElement>('feed-source');
const feedTime = required<HTMLTimeElement>('feed-time');
const motionToggle = required<HTMLInputElement>('motion-toggle');
const cameraReset = required<HTMLButtonElement>('camera-reset');

let profiles = applyLiveState(AGENTS, null);
let selectedId: AgentId = 'dou-dou';
let selectedView: StudioView = 'current';
let liveState: StudioLiveState | null = null;

const world = new StudioWorld(worldElement, profiles, selectAgent);
renderAgentList();
renderInspector();
void refreshLiveState();
const refreshTimer = window.setInterval(() => void refreshLiveState(), 15_000);

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view as StudioView | undefined;
    if (!view) return;
    selectedView = view;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const active = candidate === tab;
      candidate.classList.toggle('is-selected', active);
      candidate.setAttribute('aria-selected', String(active));
    }
    renderInspector();
  });
}

motionToggle.addEventListener('change', () => world.setMotionEnabled(motionToggle.checked));
cameraReset.addEventListener('click', () => world.resetCamera());
window.addEventListener('beforeunload', () => {
  window.clearInterval(refreshTimer);
  world.dispose();
});

function selectAgent(id: AgentId): void {
  selectedId = id;
  world.setSelected(id);
  renderAgentList();
  renderInspector();
}

function renderAgentList(): void {
  const nodes = profiles.map(profile => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent-chip';
    button.dataset.agent = profile.id;
    button.dataset.state = profile.state;
    button.classList.toggle('is-selected', profile.id === selectedId);
    button.setAttribute('aria-pressed', String(profile.id === selectedId));
    button.setAttribute('aria-label', `查看 ${profile.name}：${STATE_LABELS[profile.state]}`);
    button.addEventListener('click', () => selectAgent(profile.id));

    const mark = document.createElement('span');
    mark.className = 'agent-chip-mark';
    mark.textContent = profile.initials;
    mark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'agent-chip-copy';
    copy.append(textNode('strong', profile.name), textNode('small', STATE_LABELS[profile.state]));
    const state = document.createElement('span');
    state.className = 'state-indicator';
    state.dataset.state = profile.state;
    state.setAttribute('aria-hidden', 'true');
    button.append(mark, copy, state);
    return button;
  });
  agentList.replaceChildren(...nodes);
}

function renderInspector(): void {
  const profile = getSelectedProfile();
  inspectorName.textContent = profile.name;
  inspectorStatus.textContent = STATE_LABELS[profile.state];
  inspectorStatus.dataset.state = profile.state;
  inspectorRole.textContent = profile.role;
  inspectorSummary.textContent = profile.summary;
  inspectorContent.replaceChildren(renderView(profile));
}

function renderView(profile: AgentProfile): HTMLElement {
  if (selectedView === 'current') {
    const wrapper = element('div', 'current-work');
    const focus = element('section', 'focus-block');
    focus.append(textNode('span', '現在在做', 'section-label'), textNode('p', profile.focus));
    const runtime = element('dl', 'work-facts');
    runtime.append(
      fact('運行來源', profile.runtime),
      fact('更新方式', liveState?.agents.some(agent => agent.id === profile.id) ? '本機狀態 feed' : '本週證據快照'),
      fact('公開範圍', '狀態、短任務、runtime、時間'),
    );
    wrapper.append(focus, runtime);
    return wrapper;
  }

  if (selectedView === 'week') {
    const list = element('ol', 'milestone-list');
    for (const milestone of profile.milestones) {
      const item = document.createElement('li');
      const date = document.createElement('time');
      date.textContent = milestone.date;
      const copy = element('div', 'milestone-copy');
      copy.append(textNode('strong', milestone.title), textNode('p', milestone.detail), textNode('small', milestone.proof));
      item.append(date, copy);
      list.append(item);
    }
    return list;
  }

  const items = selectedView === 'deliverables' ? profile.deliverables : profile.next;
  const list = element('ul', 'work-list');
  for (const value of items) {
    const item = document.createElement('li');
    const marker = document.createElement('span');
    marker.className = 'work-list-marker';
    marker.textContent = selectedView === 'deliverables' ? 'OK' : 'NEXT';
    item.append(marker, document.createTextNode(value));
    list.append(item);
  }
  return list;
}

async function refreshLiveState(): Promise<void> {
  try {
    const response = await fetch('/api/studio-state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Studio state returned ${response.status}`);
    const parsed = parseLiveState(await response.json());
    if (!parsed) throw new Error('Studio state did not match the public schema.');
    liveState = parsed;
    profiles = applyLiveState(AGENTS, liveState);
    feedSource.textContent = '本機 feed 已連線';
    feedSource.dataset.mode = 'live';
    feedTime.dateTime = parsed.updatedAt;
    feedTime.textContent = `更新 ${formatTime(parsed.updatedAt)}`;
  } catch {
    liveState = null;
    profiles = applyLiveState(AGENTS, null);
    feedSource.textContent = '本週證據快照';
    feedSource.dataset.mode = 'snapshot';
    feedTime.removeAttribute('datetime');
    feedTime.textContent = 'feed 尚未連線';
  }
  world.updateProfiles(profiles);
  renderAgentList();
  renderInspector();
}

function getSelectedProfile(): AgentProfile {
  const profile = profiles.find(candidate => candidate.id === selectedId);
  if (!profile) throw new Error(`Unknown studio agent ${selectedId}`);
  return profile;
}

function fact(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.append(textNode('dt', label), textNode('dd', value));
  return row;
}

function textNode<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-HK', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing studio element #${id}`);
  return node as T;
}
