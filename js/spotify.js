// Spotty/LMS catalogue provider.
// Keeps Spotify playback inside LMS: Carousel -> LMS -> Spotty -> selected LMS player.
import { rpc } from './lms.js?v=0.10.0';

const asArray=value=>Array.isArray(value)?value:[];
export const spottyLoop=result=>result?.loop_loop||result?.item_loop||result?.items_loop||result?.items||[];

export function spotifyUri(item){
  const fixed=item?.actions?.go?.params||item?.actions?.play?.params||{};
  const pass=asArray(item?.passthrough)[0]||{};
  return item?.favorites_url||pass.uri||fixed.uri||item?.playlist||item?.play||'';
}

function splitAlbumName(name=''){
  // LMS's compact XMLBrowser response formats saved albums as "<album> by <artist>".
  // Split on the final separator so album titles containing " by " remain usable.
  const marker=' by ', at=name.lastIndexOf(marker);
  return at>0?{title:name.slice(0,at),artist:name.slice(at+marker.length)}:{title:name||'Untitled',artist:''};
}

export function normalizeSpottyAlbum(item){
  const named=splitAlbumName(item?.name||item?.text||'');
  const uri=spotifyUri(item);
  return {
    source:'spotify',
    id:uri||('spotty-item:'+String(item?.id??'')),
    playableId:uri,
    spottyItemId:String(item?.id??''),
    title:item?.line1||named.title,
    artist:item?.line2||item?.artist||named.artist,
    artwork:item?.image||item?.icon||'',
    year:item?.year||'',
    raw:item
  };
}

export async function browseSpotty(playerId, command=['spotty','items',0,200]){
  return rpc(playerId,command);
}

export async function spottyRoot(playerId){ return spottyLoop(await browseSpotty(playerId)); }

export async function savedSpotifyAlbums(playerId){
  // Spotty's XMLBrowser root assigns an item_id to Albums. Discover it by label
  // instead of assuming the observed value (7) is permanent.
  const root=await spottyRoot(playerId);
  const section=root.find(item=>String(item?.name||item?.text||'').toLocaleLowerCase()==='albums');
  if(!section)throw new Error('Spotty Albums section not available');
  const result=await browseSpotty(playerId,['spotty','items',0,200,'item_id:'+section.id]);
  return spottyLoop(result).map(normalizeSpottyAlbum);
}

export async function searchSpotifyAlbums(playerId,query){
  const root=await spottyRoot(playerId);
  let searchNode=root.find(item=>String(item?.name||item?.text||'').toLocaleLowerCase()==='search');
  if(!searchNode)throw new Error('Spotty Search section not available');

  if(String(searchNode.type||'').toLocaleLowerCase()!=='search'){
    const recent=spottyLoop(await browseSpotty(playerId,['spotty','items',0,50,'item_id:'+searchNode.id]));
    const newSearch=recent.find(item=>String(item?.type||'').toLocaleLowerCase()==='search')
      ||recent.find(item=>/new\s+search/i.test(String(item?.name||item?.text||'')));
    if(!newSearch?.id)throw new Error('Spotty New Search action not available');
    searchNode=newSearch;
  }

  // First submit the user's free-form query. It may be an artist, album or
  // track name. Spotty responds with typed result-category actions whose
  // passthrough data already contains both the query and the required type.
  const searchMenu=spottyLoop(await browseSpotty(playerId,[
    'spotty','items',0,50,'item_id:'+searchNode.id,'search:'+query
  ]));
  const albumsAction=searchMenu.find(item=>{
    const label=String(item?.name||item?.text||'').toLocaleLowerCase();
    const pass=asArray(item?.passthrough)[0]||{};
    const fixed=item?.actions?.go?.params||{};
    return String(pass.type||fixed.type||'').toLocaleLowerCase()==='album'||label==='albums';
  });
  if(!albumsAction)throw new Error('Spotty album-search action not available');

  // XMLBrowser item IDs are navigation-state identifiers. Replaying only the
  // ID can lose the passthrough query/type, so explicitly carry Spotty's own
  // parameters into the Albums request.
  const pass=asArray(albumsAction?.passthrough)[0]||{};
  const fixed=albumsAction?.actions?.go?.params||{};
  const albumQuery=pass.query||fixed.query||query;
  const command=['spotty','items',0,50];
  if(albumsAction.id!=null&&albumsAction.id!=='')command.push('item_id:'+albumsAction.id);
  command.push('search:'+albumQuery,'query:'+albumQuery,'type:album');
  const result=await browseSpotty(playerId,command);

  // At this point Spotty's albumList() rows are type=playlist. Do not require
  // favorites_url/spotify:album URI because XMLBrowser's compact response can
  // omit it; reject known category/search rows instead.
  return spottyLoop(result)
    .filter(item=>{
      const type=String(item?.type||'').toLocaleLowerCase();
      const label=String(item?.name||item?.text||'').toLocaleLowerCase();
      return type==='playlist'&&!['artists','albums','playlists','songs','podcasts','podcast episodes','users','new search'].includes(label);
    })
    .map(normalizeSpottyAlbum);
}
export async function spotifyAlbumInformation(playerId,album){
  const itemId=typeof album==='string'?album:album?.spottyItemId;
  if(!itemId)throw new Error('Spotify album has no Spotty item id');
  const detail=spottyLoop(await browseSpotty(playerId,['spotty','items',0,500,'item_id:'+itemId]));
  const rows=detail.filter(item=>!/^add\s+album\s+to\s+library$/i.test(String(item?.name||item?.text||'')));
  const tracks=rows.filter(item=>{
    const type=String(item?.type||'').toLocaleLowerCase();
    const name=String(item?.line1||item?.name||item?.text||'');
    return type==='audio'||type==='track'||/^\s*\d+[.\s-]/.test(name);
  }).map((item,index)=>{
    const raw=String(item?.line1||item?.name||item?.text||'Untitled');
    const match=raw.match(/^\s*(\d+)[.\s-]+(.+)$/);
    return {tracknum:item?.tracknum||match?.[1]||index+1,disc:item?.disc||item?.discnumber||null,artist:item?.trackartist||item?.artist||'',title:match?.[2]||raw,duration:Number(item?.duration)||0};
  });
  const meta=rows.find(item=>item?.genre||item?.genres||item?.year||item?.album)||{};
  const genres=[meta.genre,meta.genres].flat().filter(Boolean).join(', ');
  return {tracks,genre:genres,year:meta.year||''};
}

export async function saveSpotifyAlbum(playerId,album){
  const itemId=typeof album==='string'?album:album?.spottyItemId;
  if(!itemId)throw new Error('Spotify album has no Spotty item id');
  // Opening an album through Spotty exposes its native "Add Album to Library"
  // action. Invoke that action rather than maintaining separate Spotify OAuth.
  const detail=spottyLoop(await browseSpotty(playerId,['spotty','items',0,200,'item_id:'+itemId]));
  const save=detail.find(item=>/add\s+album\s+to\s+library/i.test(String(item?.name||item?.text||'')));
  if(!save?.id)throw new Error('Spotty did not expose Add Album to Library for this album');
  await browseSpotty(playerId,['spotty','items',0,20,'item_id:'+save.id]);
  return true;
}

export async function playSpotifyAlbum(playerId,album){
  // Compact XMLBrowser album rows do not expose spotify:album URIs. LMS does,
  // however, expose each as a playable XMLBrowser node, so use Spotty's playlist
  // command with its item_id.
  const itemId=typeof album==='string'?album:album?.spottyItemId;
  if(!itemId)throw new Error('Spotify album has no Spotty item id');
  return rpc(playerId,['spotty','playlist','play','item_id:'+itemId]);
}

export async function probeSpotty(playerId){
  try{
    const items=await spottyRoot(playerId);
    return {available:items.length>0,items:items.map(item=>({id:item?.id,name:item?.name||item?.text||'',type:item?.type||'',hasItems:!!item?.hasitems}))};
  }catch(error){ return {available:false,error:String(error?.message||error),items:[]}; }
}
