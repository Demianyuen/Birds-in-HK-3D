export const AGENT_IDS = ['dou-dou', 'nian-nian', 'map-agent', 'qa-agent', 'asset-agent'] as const;
export type AgentId = typeof AGENT_IDS[number];

export const AGENT_STATES = ['working', 'reviewing', 'handoff', 'done', 'waiting', 'blocked', 'offline'] as const;
export type AgentState = typeof AGENT_STATES[number];
export type StudioView = 'current' | 'week' | 'deliverables' | 'next';

export interface Milestone {
  date: string;
  title: string;
  detail: string;
  proof: string;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  initials: string;
  role: string;
  runtime: string;
  state: AgentState;
  focus: string;
  summary: string;
  accent: number;
  milestones: Milestone[];
  deliverables: string[];
  next: string[];
}

export interface LiveAgentState {
  id: AgentId;
  state: AgentState;
  task: string;
  runtime: string;
  updatedAt: string;
}

export interface StudioLiveState {
  source: 'local-feed';
  updatedAt: string;
  agents: LiveAgentState[];
}

export const STATE_LABELS: Record<AgentState, string> = {
  working: '製作中',
  reviewing: '驗收中',
  handoff: '交接中',
  done: '已完成',
  waiting: '等候中',
  blocked: '受阻',
  offline: '未連線',
};

export const AGENTS: AgentProfile[] = [
  {
    id: 'dou-dou',
    name: '豆豆',
    initials: '豆',
    role: 'CFO / Codex 作戰編排',
    runtime: 'Codex runtime',
    state: 'working',
    focus: '把專案、證據與 agent 工作收進同一個藝術村視圖。',
    summary: '負責工作拆解、風險邊界、交付追蹤與最後驗收。',
    accent: 0x177b68,
    milestones: [
      { date: '07/15', title: '建立 Birds in HK 可玩基礎', detail: '完成主流程、官方 CSDI 世界與可重跑的 runtime evidence。', proof: 'Git history / runtime-evidence' },
      { date: '07/22', title: '確認唯一正式專案', detail: '以 F:\\Project\\Birds-in-HK-3D 為唯一主 repo；兩個 Codex 工作目錄已盤點，但永久移除仍受主機策略阻擋。', proof: 'Filesystem inventory' },
      { date: '07/22', title: '建立統一藝術村', detail: '把角色、工作流與本週進度放進可互動的 3D 村落。', proof: 'studio.html' },
    ],
    deliverables: ['正式 repo 與安全清理邊界', '3D 藝術村 dashboard', '本機狀態 feed 與更新指令'],
    next: ['關閉目前 Codex task 後移除兩個同名工作目錄', '讓每次 Codex 任務自動寫入脫敏狀態事件', '把跨專案里程碑彙總為穩定週報'],
  },
  {
    id: 'nian-nian',
    name: '念念',
    initials: '念',
    role: 'CEO / Hermes 方向與交接',
    runtime: 'Hermes bridge 未連線',
    state: 'waiting',
    focus: '等待最小、脫敏的 Hermes 狀態 bridge 接入。',
    summary: '維持長期方向與創作脈絡；私人記憶不會直接進入 dashboard。',
    accent: 0x4d6a95,
    milestones: [
      { date: '07/20', title: '穩定 Hermes gateway', detail: '收斂為單一 Telegram owner，並以多輪 retry 狀態驗證穩定性。', proof: 'Hermes runtime verification' },
      { date: '07/20', title: '延續 Blender 工作', detail: '沿用最完整 session 與既有 artifacts，完成直接診斷而不重烘焙。', proof: 'Blender diagnostic exit 0' },
      { date: '07/22', title: '界定公開工作狀態', detail: '只讓角色、短任務、狀態與交接時間進入工作室。', proof: 'docs/studio-roadmap.md' },
    ],
    deliverables: ['Hermes 單一 gateway owner', 'Blender checkpoint 恢復', '隱私安全的 bridge 邊界'],
    next: ['建立 Hermes allow-list 事件 adapter', '驗證斷線、過期狀態與重新連線行為'],
  },
  {
    id: 'map-agent',
    name: '地圖工坊',
    initials: '圖',
    role: 'Subagent / CSDI 世界管線',
    runtime: '任務型 subagent',
    state: 'done',
    focus: '官方香港 3D Tiles、地形與底圖管線已完成本輪驗收。',
    summary: '讓飛行世界只使用核准的香港官方建築來源，並保持座標與碰撞一致。',
    accent: 0x2f7652,
    milestones: [
      { date: '07/15', title: '鎖定官方 3D 世界', detail: 'CSDI Building 與 Infrastructure 透過 server-side proxy 載入。', proof: 'ADR-0006 / CSDI QA' },
      { date: '07/15', title: '完成區域地形', detail: 'Terrarium elevation 與 LandsD basemap 組成有邊界的飛行區域。', proof: 'Terrain tests / runtime frame' },
      { date: '07/15', title: '補齊道路脈絡', detail: '道路只作導航資料，避免覆蓋官方底圖造成破裂表面。', proof: 'ADR-0008 / road tests' },
    ],
    deliverables: ['16 terrain meshes', '64 LandsD basemap tiles', 'CSDI Building / Infrastructure', '2,327 road features'],
    next: ['擴大區域前先建立碰撞與效能預算', '持續保存真實水體與道路的 runtime 證據'],
  },
  {
    id: 'qa-agent',
    name: '驗收小屋',
    initials: '驗',
    role: 'Subagent / Runtime QA',
    runtime: '任務型 subagent',
    state: 'reviewing',
    focus: '驗證 dashboard 的 build、互動、桌面與手機畫面。',
    summary: '以事件、畫面像素與可重跑測試證明功能真的工作。',
    accent: 0x397f8e,
    milestones: [
      { date: '07/15', title: '建立畫面證據鏈', detail: '紀錄 world.ready、render.frame、flight.state 與 PNG capture。', proof: 'runtime-evidence/events.jsonl' },
      { date: '07/15', title: '完成多鳥種 smoke flow', detail: '白鴿、麻雀、黑鳶皆保存 boot、menu、loading、game 畫面。', proof: 'runtime-evidence/browser-smoke' },
      { date: '07/22', title: '擴充資產與 studio 測試', detail: '新增 GLB、入口文件與安全欄位檢查。', proof: 'Vitest suite' },
    ],
    deliverables: ['TypeScript check', 'Vitest suite', 'Vite production build', 'desktop / mobile visual QA'],
    next: ['把 studio 狀態 API 加入 smoke test', '加入 renderer context loss 的復原驗證'],
  },
  {
    id: 'asset-agent',
    name: '模型工坊',
    initials: '模',
    role: 'Subagent / 鳥類與美術資產',
    runtime: '任務型 subagent',
    state: 'handoff',
    focus: '三種鳥類已接入；dove 與 eagle 的上游授權仍待確認。',
    summary: '整理模型來源、完整性、rig 限制與可安全回退的載入行為。',
    accent: 0xb96243,
    milestones: [
      { date: '07/22', title: '找回 dove 與 eagle', detail: '兩個 GLB 通過 magic header、大小與 SHA-256 驗證。', proof: 'birdAssets.test.ts' },
      { date: '07/22', title: '接入三種 flight profile', detail: 'pigeon、dove、eagle 各自載入對應模型與飛行參數。', proof: 'birdProfiles tests' },
      { date: '07/22', title: '保留安全回退', detail: '缺少 wing pivots 時維持非破壞 idle 動畫，不修改上游模型。', proof: 'Pigeon loader behavior' },
    ],
    deliverables: ['pigeon.glb', 'dove.glb', 'eagle.glb', '模型完整性檢查'],
    next: ['確認 dove / eagle 上游來源與授權', '評估 wing pivots 或內建 animation clips'],
  },
];

const sensitiveText = /(?:api[ _-]?key|access[ _-]?token|password|credential|bearer\s+|sk-[a-z0-9_-]{8,})/i;

export function parseLiveState(value: unknown): StudioLiveState | null {
  if (!isRecord(value) || value.source !== 'local-feed' || !isIsoDate(value.updatedAt) || !Array.isArray(value.agents)) return null;
  const agents: LiveAgentState[] = [];
  for (const item of value.agents) {
    if (!isRecord(item) || !isAgentId(item.id) || !isAgentState(item.state)) return null;
    if (!isSafeText(item.task, 160) || !isSafeText(item.runtime, 60) || !isIsoDate(item.updatedAt)) return null;
    agents.push({ id: item.id, state: item.state, task: item.task, runtime: item.runtime, updatedAt: item.updatedAt });
  }
  return { source: 'local-feed', updatedAt: value.updatedAt, agents };
}

export function applyLiveState(profiles: AgentProfile[], live: StudioLiveState | null): AgentProfile[] {
  if (!live) return profiles.map(profile => ({ ...profile }));
  const byId = new Map(live.agents.map(agent => [agent.id, agent]));
  return profiles.map(profile => {
    const update = byId.get(profile.id);
    return update ? { ...profile, state: update.state, focus: update.task, runtime: update.runtime } : { ...profile };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !sensitiveText.test(value);
}
