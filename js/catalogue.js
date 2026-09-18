export async function buildAlbumPositionIndex(rpc, totalAlbums, generation, currentGeneration, pageSize = 40) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid catalogue page size');
  if (!totalAlbums) return new Map();
  const index = new Map();
  for (let start = 0; start < totalAlbums; start += pageSize) {
    const count = Math.min(pageSize, totalAlbums - start);
    const result = await rpc('0', ['albums', start, count, 'sort:artflow', 'tags:s']);
    if (generation !== currentGeneration()) return null;
    (result.albums_loop || []).forEach((album, offset) => {
      if (album?.id !== undefined && album?.id !== null) index.set(String(album.id), start + offset);
    });
  }
  return index;
}

export async function locateAlbum(albumId, albums, positionIndex, pageSize, fetchBatch) {
  const wanted = String(albumId);
  let found = albums.findIndex(album => album && String(album[6]) === wanted);
  if (found >= 0) return found;
  const position = positionIndex.get(wanted);
  if (!Number.isFinite(position)) return -1;
  await fetchBatch(Math.floor(position / pageSize));
  found = albums.findIndex(album => album && String(album[6]) === wanted);
  return found;
}
