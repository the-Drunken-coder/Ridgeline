import { execFileSync } from 'node:child_process';
import { globSync, readFileSync, statSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';

function markdown(markdown) {
  const nodes = [], pending = [fromMarkdown(markdown)];
  while (pending.length) {
    const node = pending.pop();
    nodes.push(node);
    if (node.children) pending.push(...node.children.toReversed());
  }
  const definitions = new Map();
  for (const node of nodes) if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  const text = node => node.value ?? node.alt ?? node.children?.map(text).join('') ?? '';
  const headings = new Set();
  for (const node of nodes) if (node.type === 'heading') {
    const slug = text(node).toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    let id = slug, duplicate = 0;
    while (headings.has(id)) id = `${slug}-${++duplicate}`;
    headings.add(id);
  }
  const links = nodes.flatMap(node => {
    if (node.type === 'link' || node.type === 'image') return [node.url];
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const url = definitions.get(node.identifier);
      if (url === undefined) throw new Error(`Missing Markdown link definition: ${node.identifier}`);
      return [url];
    }
    return [];
  });
  return { links, headings };
}

/** Validate the archive consumers install, rather than the unpacked repository. */
export function checkPackage(root, archive) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const expected = new Set(['package.json']);
  for (const pattern of manifest.files) {
    const matches = globSync(pattern, { cwd: root });
    if (!matches.length) throw new Error(`Package inventory pattern matched no files: ${pattern}`);
    for (const match of matches) {
      const entries = statSync(resolve(root, match)).isDirectory() ? globSync(`${match}/**/*`, { cwd: root }) : [match];
      for (const entry of entries) if (statSync(resolve(root, entry)).isFile()) expected.add(entry);
    }
  }
  const tar = args => execFileSync('tar', args, { maxBuffer: 64 * 1024 * 1024 });
  const members = tar(['-tzf', archive]).toString().trim().split('\n').filter(name => !name.endsWith('/'));
  const files = new Set();
  for (const member of members) {
    if (!member.startsWith('package/') || posix.normalize(member) !== member || member.includes('\\'))
      throw new Error(`Unexpected package archive path: ${member}`);
    const file = member.slice('package/'.length);
    if (files.has(file)) throw new Error(`Duplicate package archive file: ${file}`);
    files.add(file);
  }
  const missing = [...expected].filter(file => !files.has(file));
  const unexpected = [...files].filter(file => !expected.has(file));
  if (missing.length || unexpected.length) throw new Error(`Package inventory differs. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
  const read = file => tar(['-xOzf', archive, '--', `package/${file}`]).toString();
  const documents = new Map([...files].filter(file => file.endsWith('.md')).map(file => [file, markdown(read(file))]));
  let verifiedLinks = 0;
  for (const [file, document] of documents) for (const link of document.links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')) continue;
    const hash = link.indexOf('#');
    const path = decodeURIComponent((hash < 0 ? link : link.slice(0, hash)).split('?')[0]);
    const fragment = hash < 0 ? '' : decodeURIComponent(link.slice(hash + 1));
    const target = path ? posix.normalize(posix.join(dirname(file), path)) : file;
    if (path.startsWith('/') || !files.has(target)) throw new Error(`Missing packaged file link in ${file}: ${link}`);
    if (fragment && !documents.get(target)?.headings.has(fragment)) throw new Error(`Missing packaged heading link in ${file}: ${link}`);
    verifiedLinks++;
  }
  return { files: files.size, markdownFiles: documents.size, verifiedLinks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [archive, ...extra] = process.argv.slice(2);
    if (!archive || extra.length) throw new Error('Usage: node scripts/check-package.mjs <archive.tgz>');
    console.log(`Validated final package: ${JSON.stringify(checkPackage(process.cwd(), resolve(archive)))}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
