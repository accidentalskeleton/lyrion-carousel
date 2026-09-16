import { JewelCaseRenderer } from './jewel-case-3d.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const modulo = (value, length) => length ? ((value % length) + length) % length : 0;
export const smoothstep = value => value * value * (3 - 2 * value);

let jewelRenderer = null;
let latestCentre = 0;
let latestTotal = 0;
let renderQueued = false;

function collectAlbums(total) {
  const albums = new Array(total);
  document.querySelectorAll('#book-fan-browser .bf-album[data-index]').forEach(el => {
    const index = Number(el.dataset.index);
    if (!Number.isFinite(index)) return;
    const label = el.getAttribute('aria-label') || 'Untitled';
    const marker = label.lastIndexOf(' by ');
    const title = marker >= 0 ? label.slice(0, marker) : label;
    const artist = marker >= 0 ? label.slice(marker + 4) : '';
    const art = el.style.getPropertyValue('--art') || '';
    const match = art.match(/url\(["']?([^"')]+)["']?\)/i);
    albums[index] = [title, artist, art, '', '', '', el.dataset.albumId || '', true, match ? match[1] : '', ''];
  });
  return albums;
}

function queueJewelRender() {
  if (renderQueued || typeof document === 'undefined') return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const stage = document.querySelector('#book-fan-browser .bf-stage');
    if (!stage || !latestTotal) return;
    if (!jewelRenderer) jewelRenderer = new JewelCaseRenderer(stage);
    jewelRenderer.setAlbums(collectAlbums(latestTotal));
    jewelRenderer.render(latestCentre, latestTotal);
  });
}

export function circularDelta(index, centre, total) {
  latestCentre = centre;
  latestTotal = total;
  queueJewelRender();
  if (!total) return 0;
  let delta = modulo(index - modulo(centre, total), total);
  if (delta > total / 2) delta -= total;
  return delta;
}

export function nearestPositionForIndex(index, position, total) {
  return position + circularDelta(index, position, total);
}
