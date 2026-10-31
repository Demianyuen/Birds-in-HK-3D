import { PRESET_WORDS } from './contentRules';

/**
 * One-tap words for the memorial. Most people want to say something simple and
 * kind; these are shared at once (see isPresetWords), and writing your own stays open.
 */
export function createWordChips(onPick: (words: string) => void, caption = '一按留下'): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'word-chips';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', caption);
  for (const words of PRESET_WORDS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'word-chip';
    chip.textContent = words;
    // Keep the text box focused (the line over the bird closes when it loses focus).
    chip.addEventListener('pointerdown', event => event.preventDefault());
    chip.addEventListener('click', () => onPick(words));
    row.append(chip);
  }
  return row;
}
