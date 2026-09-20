// Experimental Spotty/LMS catalogue provider.
// Keeps Spotify playback inside LMS: Carousel -> LMS -> Spotty -> selected LMS player.
// Spotty exposes its UI through LMS BrowseLibrary; no Spotify credentials are handled here.
import { rpc } from './lms.js?v=spotify-spotty-1';

const asArray=value=>Array.isArray(value)?value:[];
const loop=result=>result?.item_loop||result?.items_loop||result?.items||[];

export function spotifyUri(item){
  const fixed=item?.actions?.go?.params||item?.actions?.play?.params||{};
  const pass=asArray(item?.passthrough)[0]||{};
  return item?.favorites_url||pass.uri||fixed.uri||item?.playlist||item?.play||'';
}

export function normalizeSpottyAlbum(item){
  const uri=spotifyUri(item);
  const image=item?.image||item?.icon||'';
  return {
    source:'spotify', id:uri, playableId:uri,
    title:item?.line1||item?.name||item?.text||'Untitled',
    artist:item?.line2||item?.artist||'',
    artwork:image, year:item?.year||'', raw:item
  };
}

// Spotty registers its own LMS XMLBrowser/CLI tag (`spotty`) via initPlugin.
// Query that tag directly; subsequent navigation replays actions supplied by LMS
// rather than hard-coding Spotify Web API endpoints.
export async function browseSpotty(playerId, command=['spotty','items',0,200]){
  return rpc(playerId,command);
}

export async function spottyRoot(playerId){
  const result=await browseSpotty(playerId);
  return loop(result);
}

function commandFromAction(item){
  const go=item?.actions?.go;
  if(!go?.cmd)return null;
  const cmd=[...go.cmd];
  const params={...(go.fixedParams||{}),...(go.params||{})};
  for(const [key,value] of Object.entries(params))cmd.push(key+':'+value);
  return cmd;
}

export async function followSpottyItem(playerId,item){
  const command=commandFromAction(item);
  if(!command)throw new Error('Spotty item has no LMS browse action');
  return rpc(playerId,command);
}

export async function findSpottySection(playerId,label){
  const wanted=label.toLocaleLowerCase();
  const items=await spottyRoot(playerId);
  return items.find(item=>String(item?.name||item?.text||'').toLocaleLowerCase()===wanted)||null;
}

export async function savedSpotifyAlbums(playerId){
  const section=await findSpottySection(playerId,'Albums');
  if(!section)throw new Error('Spotty Albums section not available');
  const result=await followSpottyItem(playerId,section);
  return loop(result).map(normalizeSpottyAlbum).filter(album=>/^spotify:album:/i.test(album.id));
}

export async function playSpotifyAlbum(playerId,album){
  const uri=typeof album==='string'?album:album?.playableId;
  if(!/^spotify:album:/i.test(uri||''))throw new Error('Invalid Spotify album URI');
  return rpc(playerId,['playlist','play',uri]);
}

export async function probeSpotty(playerId){
  try{
    const items=await spottyRoot(playerId);
    return {available:true,items:items.map(item=>({name:item?.name||item?.text||'',type:item?.type||'',uri:spotifyUri(item),hasAction:!!commandFromAction(item)}))};
  }catch(error){
    return {available:false,error:String(error?.message||error),items:[]};
  }
}
