/**
 * The way in (landing page, bird choice, loading and error screens) in Traditional Chinese
 * or English. Chinese is written in the page itself; English replaces it. An element marked
 * data-i18n="key" (text), data-i18n-placeholder or data-i18n-aria takes EN[key] in English
 * and its original Chinese back in Chinese. The choice is remembered in this browser.
 */
export type Lang = 'zh' | 'en';

const KEY = 'birds-in-hk:lang';

const EN: Readonly<Record<string, string>> = {
  'canvas': 'Birds in HK view',
  'boot.place': 'Tai Po · Wang Fuk Court',
  'boot.tagline': 'Become a dove, carry a flower over Tai Po, and lay it gently at Wang Fuk Court.',
  'boot.name': 'Your name',
  'boot.namePlaceholder': 'e.g. Mrs Chan, a Tai Po neighbour',
  'boot.flower': 'Bring a flower',
  'flower.white-chrysanthemum': 'White chrysanthemum',
  'flower.lily': 'White lily',
  'flower.white-rose': 'White rose',
  'flower.white-carnation': 'White carnation',
  'flower.ginger-lily': 'Ginger lily',
  'flower.white-lotus': 'White lotus',
  'flower.white-orchid': 'White moth orchid',
  'flower.yellow-chrysanthemum': 'Yellow chrysanthemum',
  'flower.lantern': 'Paper lantern',
  'boot.continue': 'Set off with the flower',
  'boot.privacy': 'Others can see your name and flower straight away. When you land at Wang Fuk Court to lay it, you can also write a few words.',
  'boot.credit': '3D: Lands Department CSDI · Ground: OpenStreetMap · Elevation: AWS Terrarium',
  'menu.title': 'Your bird',
  'menu.birds': 'Choose a bird',
  'menu.region': 'Flight area',
  'menu.regionName': 'Tai Po · Wang Fuk Court',
  'menu.regionNote': 'Official CSDI buildings and infrastructure · LandsD street map',
  'menu.start': 'Start flying',
  'menu.meta': 'Flight area 01 · Tai Po',
  'bird.spotted.label': 'Spotted dove',
  'bird.spotted.note': 'Common round the estates, gentle',
  'bird.pigeon.label': 'Feral pigeon',
  'bird.pigeon.note': 'The street pigeon, flaps and glides in turn',
  'bird.dove.label': 'White dove',
  'bird.dove.note': 'The dove of peace, light and steady',
  'bird.sparrow.label': 'Tree sparrow',
  'bird.sparrow.note': 'Small and nimble, often in flocks',
  'bird.magpie.label': 'Oriental magpie',
  'bird.magpie.note': 'Black and white, long-tailed, a bird of good news',
  'bird.eagle.label': 'Black kite',
  'bird.eagle.note': 'Long wings, circles and glides high up',
  'loading.title': 'Building the world',
  'loading.detail': 'Connecting to the official 3D map data.',
  'error.title': 'The official map could not load',
  'error.message': 'The official 3D map could not load just now.',
  'error.retry': 'Reload',
  'error.back': 'Back to the area choice',
  'feedback.open': 'Feedback or a problem? Tell us',
  'feedback.button': 'Feedback',
  'feedback.title': 'A note for the moderator',
  'feedback.note': 'Only the moderator sees this; it does not appear on the map. If something went wrong, saying which phone or computer you use helps a lot.',
  'feedback.placeholder': 'e.g. the view froze, could not find the square, it would be good to add…',
  'feedback.cancel': 'Cancel',
  'feedback.send': 'Send',
};

/** Messages from the landing form, by their Chinese text. */
const EN_MESSAGES: Readonly<Record<string, string>> = {
  '請選擇一種花。': 'Please choose a flower.',
  '請先輸入內容。': 'Please write something first.',
  '內容太長了。': 'That is too long.',
  '內容包含不適合在紀念場所出現的字詞。': 'It contains words that do not belong in a place of remembrance.',
  '這裡是悼念的地方，請不要寫口號或政治訴求。': 'This is a place of mourning. Please leave out slogans and political demands.',
  '為保障大家，留言不可以包含網址。': 'For everyone\'s safety, links are not allowed.',
  '為保障私隱，留言不可以包含電話號碼。': 'For privacy, phone numbers are not allowed.',
  '未能接受這段內容。': 'This could not be accepted.',
};
const EN_PREFIXES: ReadonlyArray<[string, string]> = [['名字：', 'Name: '], ['留言：', 'Words: ']];

const originals = new WeakMap<Element, { text?: string; placeholder?: string; aria?: string }>();
let lang: Lang = 'zh';

export function currentLang(): Lang {
  return lang;
}

/** A message from the page's own code, in the chosen language when there is a translation. */
export function message(chinese: string): string {
  if (lang !== 'en') return chinese;
  for (const [zh, en] of EN_PREFIXES) {
    if (chinese.startsWith(zh)) return en + message(chinese.slice(zh.length));
  }
  return EN_MESSAGES[chinese] ?? chinese;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // storage blocked
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some(item => /^zh|^yue/i.test(item ?? '')) ? 'zh' : 'en';
}

export function applyLang(next: Lang, root: ParentNode = document): void {
  lang = next;
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-Hant';
  for (const element of root.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-aria]')) {
    let original = originals.get(element);
    if (!original) {
      original = {
        text: element.getAttribute('data-i18n') ? element.textContent ?? '' : undefined,
        placeholder: element.getAttribute('placeholder') ?? undefined,
        aria: element.getAttribute('aria-label') ?? undefined,
      };
      originals.set(element, original);
    }
    const textKey = element.getAttribute('data-i18n');
    if (textKey && original.text !== undefined) element.textContent = next === 'en' ? EN[textKey] ?? original.text : original.text;
    const placeholderKey = element.getAttribute('data-i18n-placeholder');
    if (placeholderKey && original.placeholder !== undefined) element.setAttribute('placeholder', next === 'en' ? EN[placeholderKey] ?? original.placeholder : original.placeholder);
    const ariaKey = element.getAttribute('data-i18n-aria');
    if (ariaKey && original.aria !== undefined) element.setAttribute('aria-label', next === 'en' ? EN[ariaKey] ?? original.aria : original.aria);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.lang-toggle')) {
    button.textContent = next === 'en' ? '繁' : 'EN';
    button.setAttribute('aria-label', next === 'en' ? '切換至繁體中文' : 'Switch to English');
    button.lang = next === 'en' ? 'zh-Hant' : 'en';
  }
}

/** Call once the page (including the bird list) is built. */
export function initLanguage(onChange?: (lang: Lang) => void): void {
  applyLang(initialLang());
  for (const button of document.querySelectorAll<HTMLButtonElement>('.lang-toggle')) {
    button.addEventListener('click', () => {
      const next: Lang = lang === 'en' ? 'zh' : 'en';
      try { localStorage.setItem(KEY, next); } catch { /* per-browser convenience */ }
      applyLang(next);
      onChange?.(next);
    });
  }
}

/** For tests. */
export const ENGLISH = EN;
