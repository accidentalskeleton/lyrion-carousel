let requestId = 0;
let session = 0;
export function resetRpcSession() { session++; }

export async function rpc(targetPlayer, command) {
  const generation = session;
  const response = await fetch('/api/lms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lyrion-Request': '1' },
    body: JSON.stringify({ id: ++requestId, method: 'slim.request', params: [targetPlayer || '0', command] })
  });
  if (!response.ok) throw new Error('LMS returned HTTP ' + response.status);
  const body = await response.json();
  if (generation !== session) throw new Error('LMS server changed during request');
  if (!body || !body.result) throw new Error('LMS returned no result');
  return body.result;
}

export class CometDClient {
  constructor(onStatus, onState, onLibraryChanged = () => window.location.reload(), getLibraryAlbumCount = () => null) {
    this.onStatus = onStatus;
    this.onState = onState;
    this.onLibraryChanged = onLibraryChanged;
    this.getLibraryAlbumCount = getLibraryAlbumCount;
    this.generation = 0;
    this.messageId = 0;
    this.clientId = '';
    this.playerId = '';
    this.retryTimer = 0;
    this.statusTimer = 0;
    this.statusPollInFlight = null;
    this.serverWasScanning = null;
    this.libraryState = {lastscan:null, albums:null, songs:null};
  }

  async post(messages) {
    const response = await fetch('/api/cometd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lyrion-Request': '1' },
      body: JSON.stringify(messages)
    });
    if (!response.ok) throw new Error('CometD HTTP ' + response.status);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Invalid CometD response');
    return body;
  }

  resetLibraryState() {
    // A new LMS endpoint has unrelated scan timestamps and album identities.
    this.serverWasScanning = null;
    this.libraryState = {lastscan:null, albums:null, songs:null};
  }

  handleServerStatus(data) {
    if (!data || typeof data !== 'object') return;
    const scanning = data.rescan === true || String(data.rescan ?? '0') === '1';
    const finished = this.serverWasScanning === true && !scanning;
    // LMS can finish a short scan between CometD status deliveries. rescan
    // then reads 0 -> 0, but lastscan and/or the catalogue counts change.
    const lastscan = data.lastscan == null || data.lastscan === '' ? null : String(data.lastscan);
    const count = value => {
      if (value === null || value === undefined || value === '') return null;
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };
    const albums = count(data['info total albums']);
    const songs = count(data['info total songs']);
    const previous = this.libraryState;
    const lastscanChanged = lastscan !== null && previous.lastscan !== null && lastscan !== previous.lastscan;
    const totalsChanged = (albums !== null && previous.albums !== null && albums !== previous.albums) ||
      (songs !== null && previous.songs !== null && songs !== previous.songs);
    // Catch a change during initial subscription, when the browser's live
    // album count may already differ from its persistent server-side snapshot.
    const displayed = count(this.getLibraryAlbumCount());
    const initialMismatch = previous.albums === null && albums !== null &&
      displayed !== null && albums !== displayed;
    this.serverWasScanning = scanning;
    this.libraryState = {
      lastscan:lastscan ?? previous.lastscan,
      albums:albums ?? previous.albums,
      songs:songs ?? previous.songs
    };
    if (!scanning && (finished || lastscanChanged || totalsChanged || initialMismatch)) {
      this.onLibraryChanged(data);
    }
  }

  async pollServerStatus(generation) {
    if (generation !== this.generation || this.statusPollInFlight === generation) return;
    this.statusPollInFlight = generation;
    try {
      const status = await rpc('0', ['serverstatus', 0, 0]);
      // Switching LMS or stopping the client invalidates any old response.
      if (generation === this.generation) this.handleServerStatus(status);
    } catch (_) {
      // CometD and the next lightweight check can recover independently.
    } finally {
      if (this.statusPollInFlight === generation) this.statusPollInFlight = null;
    }
  }

  handle(messages) {
    for (const message of messages) {
      if (!message?.data || !message?.channel) continue;
      if (message.channel.includes('/playerstatus/')) this.onStatus(message.data);
      else if (message.channel.includes('/serverstatus')) this.handleServerStatus(message.data);
    }
  }

  stop() {
    ++this.generation;
    clearTimeout(this.retryTimer);
    clearInterval(this.statusTimer);
    this.retryTimer = 0;
    this.statusTimer = 0;
    const clientId = this.clientId;
    this.clientId = '';
    this.playerId = '';
    // Preserve the scan revision across a reconnect to the SAME LMS.
    if (clientId) {
      this.post([{ channel: '/meta/disconnect', clientId, id: String(++this.messageId) }]).catch(() => {});
    }
  }

  async start(playerId) {
    this.stop();
    if (!playerId) return;
    this.playerId = playerId;
    const generation = ++this.generation;
    // The periodic serverstatus request does not enumerate albums or touch
    // SQLite. It remains active even if CometD has temporarily disconnected.
    this.statusTimer = setInterval(() => { void this.pollServerStatus(generation); }, 60000);
    void this.pollServerStatus(generation);
    try {
      this.onState('connecting');
      const handshake = await this.post([{
        channel: '/meta/handshake',
        version: '1.0',
        supportedConnectionTypes: ['long-polling'],
        id: String(++this.messageId)
      }]);
      if (generation !== this.generation) return;
      const hello = handshake.find(message => message.channel === '/meta/handshake');
      if (!hello?.successful || !hello.clientId) throw new Error('CometD handshake failed');
      this.clientId = hello.clientId;

      const playerChannel = '/' + hello.clientId + '/slim/playerstatus/' + playerId;
      const serverChannel = '/' + hello.clientId + '/slim/serverstatus';
      const subscribed = await this.post([
        {
          channel: '/slim/subscribe',
          clientId: hello.clientId,
          id: String(++this.messageId),
          data: {
            request: [playerId, ['status', '-', 1, 'tags:alJenA', 'subscribe:30']],
            response: playerChannel
          }
        },
        {
          channel: '/slim/subscribe',
          clientId: hello.clientId,
          id: String(++this.messageId),
          data: {
            request: ['', ['serverstatus', 0, 0, 'subscribe:0']],
            response: serverChannel
          }
        }
      ]);
      if (generation !== this.generation) return;
      const failed = subscribed.find(message => message.channel === '/slim/subscribe' && message.successful === false);
      if (failed) throw new Error(failed.error || 'CometD subscription failed');
      this.handle(subscribed);
      this.onState('live');

      while (generation === this.generation && this.playerId === playerId) {
        const messages = await this.post([{
          channel: '/meta/connect',
          clientId: hello.clientId,
          connectionType: 'long-polling',
          id: String(++this.messageId)
        }]);
        if (generation !== this.generation) return;
        const connect = messages.find(message => message.channel === '/meta/connect');
        if (connect?.successful === false) throw new Error(connect.error || 'CometD connection failed');
        this.handle(messages);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn('CometD live updates failed:', error);
      this.onState('lost');
      this.retryTimer = setTimeout(() => {
        if (generation === this.generation && this.playerId === playerId) this.start(playerId);
      }, 2000);
    }
  }
}
