import { rpc } from '../lms.js?v=display-choice-1';
import { buildAlbumPositionIndex, locateAlbum as locateIndexedAlbum } from '../catalogue.js?v=display-choice-1';

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
      const result=await rpc('0',['albums',0,PAGE_SIZE,'sort:artflow','tags:ajlysg',...genreArgs()]);
      const mapped=(result.albums_loop||[]).map(mapAlbum);
      const count=Number(result.count)||mapped.length;
      setLibraryCount(count);
      return {albums:mapped,total:count,libraryCount:count,live:true};
    },

    async search(query){
      const result=await rpc('0',['albums',0,getSearchLimit(),'sort:artflow','tags:ajlysg','search:'+query,...genreArgs()]);
      return {albums:(result.albums_loop||[]).map(mapAlbum),count:Number(result.count)||0};
    },

    async play(album){
      const playerId=getPlayerId();
      if(!playerId||!album?.[6])return;
      await rpc(playerId,['playlistcontrol','cmd:load','album_id:'+album[6]]);
    },

    async locate(id,{fetchBatch}={}){
      if(!id)return -1;
      let index=getPositionIndex()?.get(String(id));
      if(index==null){
        const positionIndex=await buildAlbumPositionIndex(getLibraryCount(),getPageSize(),(offset,limit)=>
          rpc('0',['albums',offset,limit,'sort:artflow','tags:ajlysg',...genreArgs()])
        );
        setPositionIndex(positionIndex);
        index=positionIndex.get(String(id));
      }
      if(index==null)return -1;
      if(fetchBatch)await fetchBatch(Math.floor(index/getPageSize()),false);
      return index;
    },

    matchesNowPlaying(album,state){
      return !!album&&state.playingAlbumId!=null&&String(album[6])===String(state.playingAlbumId);
    }
  };
}
