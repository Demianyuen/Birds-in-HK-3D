import { type PerspectiveCamera, Vector3 } from 'three';

export interface WorldLabel {
  id: string;
  /** Plain text only; never interpreted as HTML. */
  title: string;
  body?: string;
  position: Vector3;
  tone?: 'flower' | 'player' | 'speech';
}

/**
 * Screen-space text labels for things in the 3D world (names over other
 * birds, words left with flowers, chat bubbles). HTML keeps Chinese text crisp
 * and accessible; elements are reused between frames.
 */
export class WorldLabels {
  public readonly element = document.createElement('div');
  private readonly nodes = new Map<string, HTMLDivElement>();
  private readonly projected = new Vector3();

  public constructor() {
    this.element.className = 'world-labels';
    this.element.setAttribute('aria-hidden', 'true');
  }

  public render(labels: readonly WorldLabel[], camera: PerspectiveCamera, width: number, height: number): void {
    const seen = new Set<string>();
    for (const label of labels) {
      this.projected.copy(label.position).project(camera);
      if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.1 || Math.abs(this.projected.y) > 1.1) continue;
      seen.add(label.id);
      let node = this.nodes.get(label.id);
      if (!node) {
        node = document.createElement('div');
        node.append(document.createElement('strong'), document.createElement('span'));
        this.nodes.set(label.id, node);
        this.element.append(node);
      }
      node.className = `world-label world-label-${label.tone ?? 'player'}`;
      const [title, body] = node.children as unknown as [HTMLElement, HTMLElement];
      if (title.textContent !== label.title) title.textContent = label.title;
      const bodyText = label.body ?? '';
      if (body.textContent !== bodyText) body.textContent = bodyText;
      body.hidden = !bodyText;
      const x = (this.projected.x * 0.5 + 0.5) * width;
      const y = (-this.projected.y * 0.5 + 0.5) * height;
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.nodes.delete(id);
    }
  }

  public clear(): void {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
  }
}
