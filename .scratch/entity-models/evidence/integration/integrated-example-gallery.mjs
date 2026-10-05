import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(pathToFileURL(resolve('node_modules/playwright/index.mjs')).href);
const output = '/tmp/ridgeline-model-context';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width:1440,height:900 }, deviceScaleFactor:1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tiles.openfreemap.org/styles/*', route => route.fulfill({ json: { version:8,glyphs:'https://example.test/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9efea'}}] } }));
  await page.route('https://example.test/fonts/**', route => route.fulfill({ path:resolve('tests/fixtures/noto-sans/0-255.pbf') }));
  await page.route('https://tiles.mapterhorn.com/tilejson.json', route => route.fulfill({ json: { tilejson:'3.0.0',tiles:['https://tiles.mapterhorn.com/flat/{z}/{x}/{y}.png'],minzoom:0,maxzoom:12,encoding:'terrarium' } }));
  await page.route('https://tiles.mapterhorn.com/flat/**', route => route.fulfill({ path:resolve('tests/fixtures/flat-terrain.png'),contentType:'image/png' }));
  await page.goto('http://127.0.0.1:5175/?scenario=models');
  await page.getByRole('status',{name:'Model example status'}).filter({hasText:'8 models · 0 icons'}).waitFor({timeout:90000});
  await page.getByLabel('Model sample',{exact:true}).selectOption('model-drone-color');
  await page.mouse.move(5,5);
  await page.screenshot({path:output+'/integrated-example-ui.png'});
  const canvas = await page.locator('#map canvas').first().evaluate(canvas => ({css:[canvas.clientWidth,canvas.clientHeight],physical:[canvas.width,canvas.height],devicePixelRatio:devicePixelRatio}));
  const metadata = {capturedUtc:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD:src'],{encoding:'utf8'}).trim(),uncommittedFiles:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().split('\n').filter(Boolean),browser:await browser.version(),launchArgs:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],viewportCss:[1440,900],canvas,configuredCamera:{center:[6.869,45.925],zoom:17,pitch:50,bearing:-20},cameraObservation:'Initial model example configuration; no camera input during capture',projection:'flat',terrain:true,elevation:'512px zero-meter Terrarium test fixture',modelStatus:await page.getByRole('status',{name:'Model example status'}).innerText(),selected:await page.locator('#selected-name').innerText(),errors,image:'integrated-example-ui.png',purpose:'Current integrated production-playground visual corroboration; no hardware performance or idle claim'};
  await writeFile(output+'/integrated-example-gallery.json',JSON.stringify(metadata,null,2)+'\n');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify(metadata));
} finally {await browser.close();}
