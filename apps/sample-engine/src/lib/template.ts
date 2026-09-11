/**
 * The deterministic template designer (ticket #22): a few knobs → one SVG.
 * Pure, so the browser preview and the server's Printfile come from the
 * same function. 3:4 portrait, 900×1200 user units.
 */
export interface Template {
  readonly text: string;
  readonly textColor: string;
  readonly background: string;
  readonly shape: 'circle' | 'square' | 'triangle' | 'none';
  readonly shapeColor: string;
}

export const WIDTH = 900;
export const HEIGHT = 1200;
export const ASPECT = { w: 3, h: 4 } as const;

export const defaultTemplate: Template = {
  text: 'Hello, print',
  textColor: '#ffffff',
  background: '#0a7d5a',
  shape: 'circle',
  shapeColor: '#ffd166',
};

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const HEX = /^#[0-9a-fA-F]{6}$/;
const colour = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);

/** Clamp free input into something the SVG can hold. */
export const sanitise = (t: Partial<Template>): Template => ({
  text: (t.text ?? defaultTemplate.text).slice(0, 40),
  textColor: colour(t.textColor ?? '', defaultTemplate.textColor),
  background: colour(t.background ?? '', defaultTemplate.background),
  shape: (['circle', 'square', 'triangle', 'none'] as const).includes(t.shape as never)
    ? (t.shape as Template['shape'])
    : 'circle',
  shapeColor: colour(t.shapeColor ?? '', defaultTemplate.shapeColor),
});

const shapeMarkup = (t: Template) => {
  switch (t.shape) {
    case 'circle':
      return `<circle cx="450" cy="520" r="260" fill="${t.shapeColor}"/>`;
    case 'square':
      return `<rect x="190" y="260" width="520" height="520" rx="40" fill="${t.shapeColor}"/>`;
    case 'triangle':
      return `<polygon points="450,240 730,780 170,780" fill="${t.shapeColor}"/>`;
    case 'none':
      return '';
  }
};

export const toSvg = (input: Partial<Template>): string => {
  const t = sanitise(input);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${t.background}"/>`,
    shapeMarkup(t),
    `<text x="450" y="1000" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="700" fill="${t.textColor}">${esc(t.text)}</text>`,
    `</svg>`,
  ].join('');
};
