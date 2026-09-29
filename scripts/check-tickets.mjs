import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const failures = [];
let checked = 0;

async function entries(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

for (const feature of await entries(join(root, '.scratch'))) {
  if (!feature.isDirectory()) continue;
  const directory = join(root, '.scratch', feature.name);
  for (const ticket of await entries(join(directory, 'issues'))) {
    if (!ticket.isFile() || !ticket.name.endsWith('.md')) continue;
    const path = join(directory, 'issues', ticket.name);
    const fail = message => failures.push(`${relative(root, path)}: ${message}`);
    const body = (await readFile(path, 'utf8'))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
    const header = body.split(/^##\s/m)[0];
    const field = name => header.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'))?.[1].trim();
    const type = field('Type');
    // Wayfinding tickets answer questions under a map, rather than implementing a spec.
    if (['research', 'prototype', 'grilling', 'task'].includes(type) && await isFile(join(directory, 'map.md'))) continue;
    checked++;
    for (const name of ['Status', 'Spec', 'Blocked by', 'Acceptance depends on', 'Integration owner']) {
      if (!field(name)) fail(`missing nonempty ${name}: field before the first section`);
    }
    if (type && type !== 'implementation') fail('unknown Type: or wayfinding ticket without map.md');
    if (field('Spec')) {
      const target = field('Spec').match(/^\[[^\]]+\]\(([^\s)]+)\)$/)?.[1];
      if (!target || resolve(dirname(path), target) !== join(directory, 'spec.md') || !await isFile(join(directory, 'spec.md'))) {
        fail('Spec: must link to the existing canonical ../spec.md');
      }
    }
    const acceptance = body.match(/^## Acceptance criteria[ \t]*\r?\n([\s\S]*)/m)?.[1].split(/^## /m)[0];
    if (!acceptance?.split('\n').some(line => {
      const item = line.match(/^\s*(?:[-*+] |\d+\. )(.*)$/)?.[1];
      return item?.replace(/^\[[ xX]\](?:\s|$)/, '').trim();
    })) {
      fail('Acceptance criteria must contain at least one nonempty list item');
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} implementation tickets.`);
}
