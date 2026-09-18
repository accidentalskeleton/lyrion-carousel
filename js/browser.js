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

// Fan geometry from main's DOM carousel, shared by drawing and open-cover positioning.
export function fanLayout(delta, compact, height) {
  const size=compact?196:224,spread=compact?114:142,step=compact?16:20;
  const desktopScale=compact?1:clamp(height/330,1.25,1.55);
  const distance=Math.abs(delta),side=Math.tanh(delta*1.18);
  const open=smoothstep(Math.max(0,1-Math.min(1,distance)));
  return {
    x:side*spread+delta*step,
    transform:`translate3d(${-size/2+side*spread+delta*step}px, ${Math.min(distance,7)*1.8}px, ${open*82-Math.min(distance,8)*7}px) rotateY(${-side*(74-open*74)}deg) rotateZ(${side*Math.min(distance,4)*.75}deg) scale(${(.91+open*.09-Math.min(distance,8)*.006)*(size/(compact?196:224))*desktopScale})`,
    opacity:clamp(1-Math.max(0,distance-6)*.15,0,1),
    brightness:.68+open*.32,
    zIndex:50-Math.min(49,Math.round(distance*2)),
    interactive:distance<=7,
  };
}
