import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const command = (name, args, cwd, options = {}) => execFileSync(name, args, { cwd, ...options });

function validateProvenance(record) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
  if (!object(record) || !text(record.spec) || !text(record.integrationOwner) || !text(record.hostedVerification)
    || !Array.isArray(record.remainingLimits) || !record.remainingLimits.every(text)) {
    throw new Error('Provenance requires a spec, integration owner, hosted verification (or unavailable), and remaining limits.');
  }
  if (!object(record.reviewed) || !revision(record.reviewed.base) || !revision(record.reviewed.head) || !text(record.reviewed.result)) {
    throw new Error('Provenance requires reviewed base/head commit SHAs and a review outcome.');
  }
  if (!Array.isArray(record.localVerification) || !record.localVerification.length || !record.localVerification.every(check =>
    object(check) && text(check.revision) && /^[a-f0-9]{40}(?:$|\s)/i.test(check.revision) && text(check.command) && text(check.result))) {
    throw new Error('Provenance requires local verification records with an exercised commit SHA, command, and outcome.');
  }
}

function markdownLinks(markdown) {
  const nodes = [], pending = [fromMarkdown(markdown)];
  while (pending.length) {
    const node = pending.pop();
    nodes.push(node);
    // Preserve document order: Markdown uses the first definition for a label.
    if (node.children) pending.push(...node.children.toReversed());
  }
  const definitions = new Map();
  for (const node of nodes) if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  return nodes.flatMap(node => {
    if (node.type === 'link' || node.type === 'image') return [node.url];
    if (node.type === 'linkReference' || node.type === 'imageReference') return [definitions.get(node.identifier)];
    return [];
  });
}

function rejectSymlinks(root, path) {
  let current = root;
  for (const part of relative(root, path).split('/')) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function promote(plan, root, dryRun) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Provide a promotion plan object.');
  if (typeof plan.destination !== 'string' || !/^\.scratch\/[A-Za-z0-9][A-Za-z0-9._-]*\/evidence(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(plan.destination)) throw new Error('Destination must be a new .scratch/<feature>/evidence directory.');
  const destination = resolve(root, plan.destination);
  rejectSymlinks(root, destination);
  if (existsSync(destination)) throw new Error(`Destination already exists: ${plan.destination}`);
  validateProvenance(plan.provenance);
  if (!Array.isArray(plan.reproduction) || !plan.reproduction.length || plan.reproduction.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Provide reproduction commands.');
  if (!Array.isArray(plan.files) || !plan.files.length || !Array.isArray(plan.rawReports) || !plan.rawReports.length) throw new Error('Select curated files and raw reports explicitly.');
  const artifacts = resolve(root, '.artifacts');
  rejectSymlinks(root, artifacts);
  mkdirSync(artifacts, { recursive: true });
  const stage = mkdtempSync(join(artifacts, 'promotion-'));
  try {
    const names = new Set(['README.md', 'manifest.json', 'raw-reports.tar.gz']);
    function snapshot(entries, target, reserved) {
      const found = new Set(reserved);
      return entries.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Provide a file entry with source and name.');
        if (typeof entry.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name) || found.has(entry.name)) throw new Error('Output names must be unique simple filenames.');
        found.add(entry.name);
        if (typeof entry.source !== 'string' || !entry.source.startsWith('.artifacts/')) throw new Error('Sources must be ignored .artifacts files.');
        const source = resolve(root, entry.source);
        if (!source.startsWith(`${artifacts}/`)) throw new Error('Sources must stay inside the declared artifact area.');
        rejectSymlinks(root, source);
        if (!lstatSync(source).isFile()) throw new Error(`Source is not a regular file: ${entry.source}`);
        if (command('git', ['ls-files', '--cached', '--', `:(literal)${relative(root, source)}`], root, { encoding: 'utf8' }).trim()) throw new Error(`Refusing tracked producer: ${entry.source}`);
        command('git', ['check-ignore', '--quiet', '--', relative(root, source)], root);
        copyFileSync(source, join(target, entry.name));
        const bytes = readFileSync(join(target, entry.name));
        return { path: entry.name, source: entry.source, bytes: bytes.length, sha256: sha256(bytes) };
      });
    }
    const output = join(stage, 'output'), raw = join(stage, 'raw');
    mkdirSync(output); mkdirSync(raw);
    const files = snapshot(plan.files, output, names), members = snapshot(plan.rawReports, raw, []);
    const archive = join(output, 'raw-reports.tar.gz');
    command('tar', ['-czf', archive, '-C', raw, '--', ...members.map(member => member.path)], root);
    for (const member of members) {
      const bytes = command('tar', ['-xOzf', archive, '--', member.path], root, { maxBuffer: Math.max(1024 * 1024, member.bytes + 1) });
      if (sha256(bytes) !== member.sha256 || !bytes.equals(readFileSync(resolve(root, member.source)))) throw new Error(`Archive does not match producer bytes: ${member.source}`);
    }
    for (const file of files) if (!readFileSync(join(output, file.path)).equals(readFileSync(resolve(root, file.source)))) throw new Error(`Curated file changed during promotion: ${file.source}`);
    const archiveBytes = readFileSync(archive);
    const manifest = { promotedAt: new Date().toISOString(), provenance: plan.provenance, reproduction: plan.reproduction, files,
      rawArchive: { path: 'raw-reports.tar.gz', bytes: archiveBytes.length, sha256: sha256(archiveBytes), members } };
    writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(output, 'README.md'), `# Curated evidence\n\n[Revision/check record and hashes](manifest.json)\n\n${files.map(file => `- [${file.path}](${file.path})`).join('\n')}\n- [Byte-exact raw producer reports](raw-reports.tar.gz)\n\n## Reproduction\n\n${plan.reproduction.map(value => `\`\`\`sh\n${value}\n\`\`\``).join('\n\n')}\n\nExtract the raw archive into a separate directory with \`tar -xzf raw-reports.tar.gz -C <directory>\`. Promotion verifies retained bytes; it does not rerun the recorded checks.\n`);
    let links = 0;
    for (const file of ['README.md', ...files.filter(file => file.path.endsWith('.md')).map(file => file.path)]) {
      for (const link of markdownLinks(readFileSync(join(output, file), 'utf8'))) {
        if (link.includes('://') || link.startsWith('mailto:')) continue;
        const [path, fragment] = link.split('#');
        const finalTarget = resolve(destination, path || file);
        const local = relative(destination, finalTarget);
        const retained = !local.startsWith('..') && existsSync(join(output, local));
        if (!retained) {
          if (relative(root, finalTarget).startsWith('..')) throw new Error(`Evidence links must use retained files or repository documents: ${link}`);
          rejectSymlinks(root, finalTarget);
          const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', relative(root, finalTarget)], { cwd: root });
          if (ignored.error) throw ignored.error;
          if (ignored.status === 0) throw new Error(`Evidence link depends on transient ignored output: ${link}`);
          if (ignored.status !== 1) throw new Error(`Unable to check evidence link ownership: ${link}`);
        }
        const target = retained ? join(output, local) : finalTarget;
        if (!existsSync(target)) throw new Error(`Missing evidence link in ${file}: ${link}`);
        if (!retained && !command('git', ['ls-files', '--cached', '--', `:(literal)${relative(root, finalTarget)}`], root, { encoding: 'utf8' }).trim()) {
          throw new Error(`Evidence link depends on an untracked repository file: ${link}`);
        }
        if (fragment) {
          const headings = [...readFileSync(target, 'utf8').matchAll(/^#+\s+(.+)$/gm)].map(match => match[1].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'));
          if (!headings.includes(fragment)) throw new Error(`Missing evidence heading in ${file}: ${link}`);
        }
        links++;
      }
    }
    if (!dryRun) { mkdirSync(dirname(destination), { recursive: true }); renameSync(output, destination); }
    return { dryRun, destination: plan.destination, files: files.length, rawReports: members.length, verifiedLinks: links, rawArchiveSha256: manifest.rawArchive.sha256 };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

try {
  const [planPath, mode, ...extra] = process.argv.slice(2);
  if (!planPath || extra.length || mode && mode !== '--dry-run') throw new Error('Usage: node scripts/promote-evidence.mjs <plan.json> [--dry-run]');
  const root = command('git', ['rev-parse', '--show-toplevel'], process.cwd(), { encoding: 'utf8' }).trim();
  const plan = JSON.parse(readFileSync(resolve(process.cwd(), planPath), 'utf8'));
  console.log(JSON.stringify(promote(plan, root, mode === '--dry-run')));
} catch (error) { console.error(error.message); process.exitCode = 1; }
