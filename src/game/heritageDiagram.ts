import { WANG_FUK_ADDRESS_POINTS } from './wangFukLocations';

/** A reference diagram only; no invented building outlines or in-world collision. */
export function createHeritageDiagram(): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'heritage-diagram';
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 260 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '宏福苑 A 至 H 座官方地址點示意圖，北向上，非建築輪廓');
  const direction = document.createElementNS(namespace, 'text');
  direction.setAttribute('x', '225');
  direction.setAttribute('y', '16');
  direction.textContent = '↑ N';
  svg.append(direction);
  for (const point of WANG_FUK_ADDRESS_POINTS) {
    const x = 28 + (point.easting - 836069) * 1.42;
    const y = 30 + (834204 - point.northing) * 1.42;
    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', String(x));
    circle.setAttribute('cy', String(y));
    circle.setAttribute('r', '5');
    const title = document.createElementNS(namespace, 'title');
    title.textContent = `${point.block} 座 ${point.name}：${point.latitude}, ${point.longitude}`;
    circle.append(title);
    const label = document.createElementNS(namespace, 'text');
    label.setAttribute('x', String(x + 8));
    label.setAttribute('y', String(y + 4));
    label.textContent = point.block;
    svg.append(circle, label);
  }
  const caption = document.createElement('figcaption');
  caption.textContent = '官方地址點 · 非建築輪廓或初建成圖則';
  const list = document.createElement('p');
  list.textContent = WANG_FUK_ADDRESS_POINTS.map(point => `${point.block} ${point.name}`).join(' · ');
  const link = document.createElement('a');
  link.href = 'https://www.als.gov.hk/';
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '政府地址查詢服務';
  figure.append(svg, caption, list, link);
  return figure;
}
