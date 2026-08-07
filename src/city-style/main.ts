import './styles.css';
import { CityStyleWorld, type ModelLoadState } from './CityStyleWorld';
import {
  CITY_STYLE_MODELS,
  MODEL_CATEGORY_LABELS,
  type CityStyleCategory,
  type CityStyleModel,
} from './modelCatalog';

declare global {
  interface Window {
    __CITY_STYLE_READY__?: {
      loaded: number;
      failed: number;
      completedAt: string;
    };
  }
}

const worldElement = required<HTMLElement>('city-style-world');
const sceneStatus = required<HTMLElement>('scene-status');
const resetButton = required<HTMLButtonElement>('camera-reset');
const assetList = required<HTMLElement>('asset-list');
renderAssetList();
const world = new CityStyleWorld(worldElement, updateModelCard);

resetButton.addEventListener('click', () => world.resetCamera());
window.addEventListener('beforeunload', () => world.dispose());

void world.loadModels().then(results => {
  const loaded = results.filter(result => result.state === 'loaded').length;
  const failed = results.length - loaded;
  document.documentElement.dataset.sceneState = failed === 0 ? 'ready' : loaded > 0 ? 'partial' : 'failed';
  sceneStatus.textContent = failed === 0
    ? `${CITY_STYLE_MODELS.length} 個 Free GLB 已載入`
    : `${loaded} 個已載入 · ${failed} 個失敗`;
  window.__CITY_STYLE_READY__ = { loaded, failed, completedAt: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent('city-style:ready', { detail: window.__CITY_STYLE_READY__ }));
});

function updateModelCard(model: CityStyleModel, result: ModelLoadState): void {
  const card = document.querySelector<HTMLElement>(`[data-model-card="${model.id}"]`);
  if (!card) return;
  const state = card.querySelector<HTMLElement>('[data-model-state]');
  const detail = card.querySelector<HTMLElement>('[data-model-detail]');
  if (!state || !detail) return;

  card.dataset.state = result.state;
  if (result.state === 'loaded') {
    state.textContent = '已載入';
    detail.textContent = `原始尺度 ${formatNumber(result.sourceSize)} · 縮放 ${formatNumber(result.scale)}x`;
    return;
  }
  state.textContent = '未載入';
  detail.textContent = result.message.includes('404')
    ? '本機缺少經官方授權下載的 GLB'
    : 'GLB 無法解析，請執行資產驗證';
}

function renderAssetList(): void {
  const categories: CityStyleCategory[] = ['building', 'environment', 'street'];
  const sections = categories.map(category => {
    const models = CITY_STYLE_MODELS.filter(model => model.category === category && !model.featured);
    const section = document.createElement('section');
    section.className = 'asset-group';
    const heading = document.createElement('div');
    heading.className = 'asset-group-heading';
    const title = document.createElement('h3');
    title.textContent = MODEL_CATEGORY_LABELS[category];
    const count = document.createElement('span');
    count.textContent = `${models.length} ITEMS`;
    heading.append(title, count);

    const list = document.createElement('div');
    list.className = 'asset-rows';
    for (const model of models) list.append(createAssetRow(model));
    section.append(heading, list);
    return section;
  });
  assetList.replaceChildren(...sections);
}

function createAssetRow(model: CityStyleModel): HTMLElement {
  const row = document.createElement('article');
  row.className = 'asset-row';
  row.dataset.modelCard = model.id;
  row.dataset.state = 'loading';

  const copy = document.createElement('div');
  const label = document.createElement('strong');
  label.textContent = model.label;
  const role = document.createElement('span');
  role.textContent = model.role;
  const detail = document.createElement('small');
  detail.dataset.modelDetail = '';
  detail.textContent = '正在讀取 GLB';
  copy.append(label, role, detail);

  const actions = document.createElement('div');
  const state = document.createElement('b');
  state.dataset.modelState = '';
  state.textContent = '載入中';
  const source = document.createElement('a');
  source.href = model.sourceUrl;
  source.target = '_blank';
  source.rel = 'noreferrer';
  source.textContent = '來源';
  actions.append(state, source);
  row.append(copy, actions);
  return row;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 2 }).format(value);
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing city style element #${id}`);
  return node as T;
}
