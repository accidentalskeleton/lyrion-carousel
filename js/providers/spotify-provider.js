import { savedSpotifyAlbums, searchSpotifyAlbums, saveSpotifyAlbum, playSpotifyAlbum } from '../spotify.js?v=stable-spotify-album-1';

export function createSpotifyProvider({mapAlbum,getPlayerId}){
  const norm=value=>String(value||'').trim().toLocaleLowerCase();

  return {
    id:'spotify',
    label:'Spotify',
    supportsColourOrder:false,

    async load(){
      const playerId=getPlayerId();
      if(!playerId)throw Error('Choose an LMS player first');
      const items=await savedSpotifyAlbums(playerId);
      if(!items.length)throw Error('No saved Spotify albums found');
      const albums=items.map(mapAlbum);
      albums.sort((a,b)=>(a[1]+'\0'+a[0]).localeCompare(b[1]+'\0'+b[0]));
      return {albums,total:albums.length,libraryCount:albums.length,live:false};
    },

    async search(query){
      const items=await searchSpotifyAlbums(getPlayerId(),query);
      const albums=items.map(mapAlbum);
      return {albums,count:albums.length};
    },

    async play(album){
      const playerId=getPlayerId();
      if(!playerId||(!album?.[14]&&!album?.[16]))return {saved:false};
      const identity={spottyItemId:album[14],spotifyUrl:album[16]};
      await playSpotifyAlbum(playerId,identity);
      if(album[15]!=='search-preview')return {saved:false};
      try{
        await saveSpotifyAlbum(playerId,identity);
        album[15]='saved';
        return {saved:true};
      }catch(error){
        album[15]='search-added';
        return {saved:false,error};
      }
    },

    matchesNowPlaying(album,state){
      if(album?.[13]!=='spotify')return false;
      if(state.playingAlbumId!=null&&String(album[6])===String(state.playingAlbumId))return true;
      return !!state.albumTitle&&norm(album[0])===norm(state.albumTitle)&&(!state.albumArtist||norm(album[1])===norm(state.albumArtist));
    }
  };
}
