/**
 * Where to draw the labels at the right-hand end of a line chart.
 *
 * Each label starts level with the last point of its line. When two would overlap, the lower
 * one moves down; if that pushes the bottom label out of the plot, it comes back in and pushes
 * the labels above it up. Only labels that actually collide move, so a lone label at the top
 * (a race winner at 100%) stays level with its line.
 */

export interface EndLabel {
  /** y of the line's last point. */
  y: number;
  /** y the label is drawn at. */
  ty: number;
}

/** Sets `ty` on every label and returns them sorted top to bottom. */
export function layoutEndLabels<T extends EndLabel>(items: readonly T[], bottom: number, gap = 13): T[] {
  const out = [...items].sort((a, b) => a.y - b.y);
  for (const it of out) it.ty = it.y;
  for (let i = 1; i < out.length; i++) if (out[i]!.ty - out[i - 1]!.ty < gap) out[i]!.ty = out[i - 1]!.ty + gap;
  const last = out[out.length - 1];
  if (last && last.ty > bottom) last.ty = bottom;
  for (let i = out.length - 2; i >= 0; i--) if (out[i + 1]!.ty - out[i]!.ty < gap) out[i]!.ty = out[i + 1]!.ty - gap;
  return out;
}
