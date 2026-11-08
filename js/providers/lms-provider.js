import { rpc } from '../lms.js?v=display-choice-1';

export function createLmsProvider({
  mapAlbum,
  getPlayerId,
  getPageSize,
  getSearchLimit,
  getDisabledGenres,
  getOrderMode,
  getLibraryCount,
  setLibraryCount,
  getPositionIndex,
  setPositionIndex
}){
  const genreArgs=()=>[...getDisabledGenres()].map(id=>'exclude_genre_id:'+id);

  return {
    id:'library',
    label:'LMS Library',
    supportsColourOrder:true,

    async load(){
      const PAGE_SIZE=getPageSize(),order=getOrderMode();
      const result=await rpc('0',['albums',0,PAGE_SIZE,'sort:artflow','tags:ajlysgiq',...genreArgs()]);
      const mapped=(result.albums_loop||[]).map(mapAlbum);
      const count=Number(result.count)||mapped.length;
      setLibraryCount(count);
      return {albums:mapped,total:count,libraryCount:count,live:true};
    },

    async search(query){
      const command=['albums',0,getSearchLimit(),'sort:artflow','tags:ajlysgiq','search:'+query];
      const disabled=[...getDisabledGenres()].map(String).filter(id=>/^[1-9]\d*$/.test(id));
      // LMS supports genre_id but not exclude_genre_id. Find the excluded
      // matches with the same sort and limit, then subtract them by album ID.
      // This also removes albums which have both enabled and disabled genres.
      const [result,excluded]=await Promise.all([
        rpc('0',command),
        disabled.length?rpc('0',[...command,'genre_id:'+disabled.join(',')]):Promise.resolve({albums_loop:[]})
      ]);
      const hidden=new Set((excluded.albums_loop||[]).map(album=>String(album.id)));
      const albums=(result.albums_loop||[]).filter(album=>!hidden.has(String(album.id))).map(mapAlbum);
      return {albums,count:albums.length};
    },

    async play(album){
      const playerId=getPlayerId();
      if(!playerId||!album?.[6])return;
      await rpc(playerId,['playlistcontrol','cmd:load','album_id:'+album[6]]);
    },

    matchesNowPlaying(album,state){
      return !!album&&state.playingAlbumId!=null&&String(album[6])===String(state.playingAlbumId);
    }
  };
}
