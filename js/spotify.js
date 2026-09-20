// Experimental Spotty/LMS catalogue provider.
// Keeps Spotify playback inside LMS: Carousel -> LMS -> Spotty -> selected LMS player.
import { rpc } from './lms.js?v=spotify-spotty-1';

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
