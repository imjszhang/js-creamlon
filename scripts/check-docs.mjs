import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const docsRoot = join(root, 'docs');
const linkOnlyRoots = [
  join(root, 'README.md'),
  join(root, 'references'),
  join(root, 'extensions'),
];
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const releaseCheck = process.argv.includes('--release');
const requiredMetadata = ['title', 'audience', 'status', 'verified'];
const allowedStatuses = new Set(['current', 'experimental', 'deprecated']);
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const markdownLink = /!?\[[^\]]*]\(([^)]+)\)/g;
const failures = [];

async function walk(dir) {
  const dirStat = await stat(dir);
  if (dirStat.isFile()) return extname(dir) === '.md' ? [dir] : [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && extname(entry.name) === '.md') files.push(path);
  }
  return files;
}

function parseFrontmatter(content, file) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    failures.push(`${file}: missing YAML frontmatter`);
    return {};
  }

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    metadata[key] = value;
  }
  return metadata;
}

function localLinkTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, '');
  if (!target || target.startsWith('#')) return null;
  if (/^(?:[a-z]+:|\/\/)/i.test(target)) return null;
  return decodeURIComponent(target.split('#', 1)[0]);
}

async function checkLink(file, rawTarget) {
  const target = localLinkTarget(rawTarget);
  if (!target) return;

  const absolute = resolve(dirname(file), target);
  const relativeTarget = relative(root, absolute);
  if (relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..') {
    failures.push(`${relative(root, file)}: link escapes repository: ${rawTarget}`);
    return;
  }

  try {
    const targetStat = await stat(absolute);
    if (targetStat.isDirectory()) {
      await stat(join(absolute, 'README.md'));
    }
  } catch {
    failures.push(`${relative(root, file)}: missing link target: ${rawTarget}`);
  }
}

const docsFiles = await walk(docsRoot);
const linkOnlyFiles = (await Promise.all(linkOnlyRoots.map((path) => walk(path)))).flat();
const linkFiles = [...new Set([...docsFiles, ...linkOnlyFiles])];

for (const file of docsFiles) {
  const display = relative(root, file);
  const content = await readFile(file, 'utf8');
  const metadata = parseFrontmatter(content, display);

  for (const key of requiredMetadata) {
    if (!metadata[key]) failures.push(`${display}: missing metadata "${key}"`);
  }
  if (metadata.status && !allowedStatuses.has(metadata.status)) {
    failures.push(`${display}: invalid status "${metadata.status}"`);
  }
  if (metadata.verified && !semver.test(metadata.verified)) {
    failures.push(`${display}: invalid verified version "${metadata.verified}"`);
  }
  if (releaseCheck && metadata.verified !== packageJson.version) {
    failures.push(
      `${display}: verified ${metadata.verified || 'missing'}, expected ${packageJson.version}`,
    );
  }

}

for (const file of linkFiles) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(markdownLink)) await checkLink(file, match[1]);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${docsFiles.length} documentation pages and ${linkFiles.length} linked markdown files`
      + `${releaseCheck ? ` for release ${packageJson.version}` : ''}`,
  );
}
