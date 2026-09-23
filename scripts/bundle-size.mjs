import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const files = ['dist/ridgeline.js', 'dist/ridgeline.css', ...(await readdir('playground-dist/assets')).filter(name => /\.(js|css)$/.test(name)).map(name => `playground-dist/assets/${name}`)];
console.log('File | Raw bytes | Gzip bytes');
for (const file of files) {
  const data = await readFile(file);
  console.log(`${file} | ${data.length} | ${gzipSync(data).length}`);
}
console.log('Library excludes MapLibre; playground includes the renderer and its worker. Maps, tiles, glyphs, and sprites are network assets, excluded here.');
