// Compatibility for browser-cached versions of app.js and browser.js.
// Keep this URL available when upgrading from the former renderer. The current
// application draws the shelf directly and does not import this module.
export class JewelCaseRenderer {
  constructor(stage) {
    this.stage = stage;
    this.albums = [];
    this.displayLimit = 30;
    stage.classList.add('bf-shelf-active');
  }

  setAlbums(albums) { this.albums = albums || []; }
  setDisplayLimit(limit) {
    this.displayLimit = Math.max(10, Math.min(60, Number(limit) || 30));
  }
  focusAlbum() {}
  render() {}
  dispose() {}
}
