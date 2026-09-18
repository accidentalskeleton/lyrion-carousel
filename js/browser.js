// Pure circular shelf geometry; no DOM reads or animation scheduling.
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const modulo = (value, length) => length ? ((value % length) + length) % length : 0;
// Retained for older cached app modules during an upgrade.
export const smoothstep = value => value * value * (3 - 2 * value);

export function circularDelta(index, centre, total) {
  if (!total) return 0;
  let delta = modulo(index - modulo(centre, total), total);
  if (delta > total / 2) delta -= total;
  return delta;
}

export function nearestPositionForIndex(index, position, total) {
  return position + circularDelta(index, position, total);
}
