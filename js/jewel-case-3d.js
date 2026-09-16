// Compatibility shim retained so app.js does not need to change in lock-step.
// Jewel cases are rendered by the DOM carousel using a pre-rendered transparent overlay asset.
export class JewelCaseRenderer {
  constructor(stage) { this.stage = stage; }
  setAlbums() {}
  resize() {}
  render() {}
  dispose() {}
}
