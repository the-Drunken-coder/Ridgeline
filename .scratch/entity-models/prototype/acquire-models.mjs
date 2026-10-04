// Throwaway acquisition script. Runtime parsing has no glTF-Transform dependency.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const output = resolve('playground/public/entity-models');
await mkdir(output, { recursive: true });
const samples = [
  ['drone', 'DNbUoMtG3H', 'NateGazzard'],
  ['tank', 'egcLMSGiuA', 'KolosStudios'],
  ['plane', '6fyLMORhgGK', 'jeremy'],
];
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
const sources = [];
for (const [name, id, author] of samples) {
  const page = `https://poly.pizza/m/${id}`;
  const html = new TextDecoder().decode(await download(page));
  const resource = html.match(/https:\/\/static\.poly\.pizza\/([a-f0-9-]+)\.glb/);
  if (!resource) throw new Error(`GLB link missing from ${page}`);
  const url = `https://static.poly.pizza/${resource[1]}.glb`;
  const bytes = await download(url);
  await writeFile(join(output, `${name}.glb`), bytes);
  sources.push({name, author, page, url, bytes: bytes.byteLength, license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/'});
}
const temporary = await mkdtemp(join(tmpdir(), 'ridgeline-model-acquisition-'));
try {
  const page = 'https://kenney.nl/assets/watercraft-kit';
  const html = new TextDecoder().decode(await download(page));
  const zipUrl = html.match(/https:\/\/kenney\.nl\/[^'"\s]+\.zip/)?.[0];
  if (!zipUrl) throw new Error('Kenney ZIP missing');
  const zip = join(temporary, 'watercraft.zip');
  await writeFile(zip, await download(zipUrl));
  execFileSync('python3', ['-m', 'zipfile', '-e', zip, join(temporary, 'kit')]);
  const input = join(temporary, 'kit', 'Models', 'GLB format', 'boat-speed-a.glb');
  // This is the single packaging step requested in #74, embedding the kit PNG.
  execFileSync('pnpm', ['dlx', '@gltf-transform/cli@4.5.1', 'copy', input, join(output, 'boat.glb')], {stdio: 'inherit'});
  const license = await readFile(join(temporary, 'kit', 'License.txt'), 'utf8');
  await writeFile(join(output, 'Kenney-License.txt'), license.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n'));
  sources.push({name: 'boat', author: 'Kenney', page, url: zipUrl, sourceBytes: (await readFile(input)).byteLength, bytes: (await readFile(join(output, 'boat.glb'))).byteLength, license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', modification: 'One gltf-transform copy pass to embed colormap.png'});
} finally {
  await rm(temporary, {recursive: true, force: true});
}
await writeFile(join(output, 'sources.json'), `${JSON.stringify({acquired: new Date().toISOString(), sources}, null, 2)}\n`);
