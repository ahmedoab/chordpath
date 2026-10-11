/* ChordPath — tools/make-icon.js
 * Turns desktop/icon.svg into desktop/icon.ico (what Windows shows for the
 * app and its installer) and desktop/icon.png. Only needed again if the icon
 * is redrawn:
 *
 *   npx electron tools/make-icon.js
 *
 * Electron draws the SVG at each size, so no image tools need installing.
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DESKTOP = path.join(__dirname, '..', 'desktop');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Draws the SVG once, large; every icon size is scaled down from that.
async function drawLarge() {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(DESKTOP, 'icon.svg'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const shot = await win.webContents.capturePage();
  win.destroy();
  return shot;
}

// An .ico file is a short directory followed by the images, here stored as PNG.
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, at);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(image.png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header].concat(images.map(image => image.png)));
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const large = await drawLarge();
  const images = SIZES.map(size => ({ size, png: large.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(DESKTOP, 'icon.ico'), ico(images));
  fs.writeFileSync(path.join(DESKTOP, 'icon.png'), images[images.length - 1].png);
  console.log('wrote desktop/icon.ico (' + SIZES.join(', ') + ' px) and desktop/icon.png');
  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
