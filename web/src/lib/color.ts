/**
 * Colour maths: sRGB <-> OKLab/OKLCH and WCAG contrast.
 *
 * Team colours are fixed by the teams, not chosen for legibility — Mercedes'
 * teal is nearly invisible on white. adaptForSurface() keeps the hue (so the
 * colour still reads as "Mercedes") but walks lightness in OKLCH until the
 * mark clears 3:1 against the surface it is drawn on.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface OKLCH {
  l: number;
  c: number;
  h: number;
}

export function hexToOklch(hex: string): OKLCH | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

export function oklchToHex({ l, c, h }: OKLCH): string {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return rgbToHex({ r: fromLinear(Math.min(1, Math.max(0, r))), g: fromLinear(Math.min(1, Math.max(0, g))), b: fromLinear(Math.min(1, Math.max(0, b))) });
}

/** Nudge a colour's lightness (hue and chroma kept) until it reaches `min` contrast on `surface`. */
export function adaptForSurface(hex: string, surface: string, min = 3): string {
  if (contrast(hex, surface) >= min) return hex.toUpperCase();
  const lch = hexToOklch(hex);
  if (!lch) return hex;
  const darken = relativeLuminance(surface) > 0.4;
  let best = hex;
  for (let i = 1; i <= 40; i++) {
    const l = darken ? lch.l - i * 0.015 : lch.l + i * 0.015;
    if (l <= 0.05 || l >= 0.98) break;
    const candidate = oklchToHex({ l, c: lch.c * (darken ? 1 : 0.92), h: lch.h });
    best = candidate;
    if (contrast(candidate, surface) >= min) return candidate;
  }
  return best;
}

/** Ink colour (black or white) that reads on top of a filled background. */
export function inkOn(background: string): '#0B0D10' | '#FFFFFF' {
  return contrast('#0B0D10', background) >= contrast('#FFFFFF', background) ? '#0B0D10' : '#FFFFFF';
}

/** Deterministic fallback hue for an unknown team id. */
export function hashedColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return oklchToHex({ l: 0.66, c: 0.13, h: ((h % 360) * Math.PI) / 180 });
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
