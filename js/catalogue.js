export async function buildAlbumPositionIndex(rpc, totalAlbums, generation, currentGeneration) {
  if (!totalAlbums) return new Map();
  const result = await rpc('0', ['albums', 0, totalAlbums, 'sort:artflow', 'tags:s']);
  if (generation !== currentGeneration()) return null;
  const index = new Map();
  (result.albums_loop || []).forEach((album, position) => {
    if (album?.id !== undefined && album?.id !== null) index.set(String(album.id), position);
  });
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
