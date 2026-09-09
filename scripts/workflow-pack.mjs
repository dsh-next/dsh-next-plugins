#!/usr/bin/env node
/**
 * Shared scoped workflow interface (all operations are async).
 * discoverPackages(root) => [{ name, version, slug, dir, manifest, buildOnly }].
 * planPackages(selectors, {root}) => {root, requested, packages, buildPackages}:
 * requested preserves selector order; packages is the dependency-first runtime
 * closure; buildPackages additionally includes local development prerequisites.
 * packPackages(plan, options) => dependency-first immutable artifact records
 * {name, version, path, sha256, manifest, files}. dryRun returns [] without writes.
 * installPackages(artifacts, options) => {profile, home, profileDir, packages,
 * bundles, commands, dryRun, stage}; failures carry error.report (not rollback).
 * run(command, argv, {cwd, env}) => {stdout, stderr, code}; argv is never a shell.
 * Persistent artifacts and pnpm overrides must remain while profiles use them.
 * Optional local dependencies/peers are edges only when independently selected.
 * Installation changes only local overrides and selected bundle ordering; the
 * latter uses guarded atomic replacement preserving unrelated slots and fields.
 * The cooperative profile lock does not serialize external direct DSH commands.
 */
import { readdir, readFile, mkdir, mkdtemp, writeFile, copyFile, chmod, rm, lstat, realpath, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, resolve, join, isAbsolute, sep, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline/promises';
import semver from 'semver';
import { runCommand, withoutModelCredentials } from './workflow-runtime.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localName = name => name.startsWith('@dsh-next/') || name === 'dsh-next-shared';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = error => error.code === 'ENOENT';
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
}
function checkVersion(manifest) {
  if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(manifest.name)) throw new Error('Invalid package name');
  if (!semver.valid(manifest.version)) throw new Error(`Invalid version for ${manifest.name}: ${manifest.version}`);
}
function engineCheck(manifest, dshVersion) {
  for (const [engine, range, version] of [
    ['node', manifest.engines?.node, process.versions.node],
    ['dsh', manifest.dsh?.engines?.dsh, dshVersion],
  ]) {
    if (range === undefined) continue;
    if (typeof range !== 'string' || !semver.validRange(range)) throw new Error(`Invalid ${engine} engine range in ${manifest.name}`);
    if (version && !semver.satisfies(version, range, { includePrerelease: true })) throw new Error(`${manifest.name} requires ${engine} ${range}; found ${version}`);
  }
}

export async function discoverPackages(root = repositoryRoot) {
  root = resolve(root);
  const records = [];
  const entries = await readdir(join(root, 'packages'), { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => join(root, 'packages', entry.name));
  if (await exists(join(root, 'shared', 'package.json'))) dirs.push(join(root, 'shared'));
  for (const dir of dirs.sort()) {
    if (!await exists(join(dir, 'package.json'))) continue;
    const manifest = await json(join(dir, 'package.json'));
    checkVersion(manifest);
    const buildOnly = dir === join(root, 'shared');
    records.push({ name: manifest.name, version: manifest.version, slug: basename(dir).replace(/^dsh-next-/, ''), dir, manifest, buildOnly });
  }
  if (new Set(records.map(p => p.name)).size !== records.length) throw new Error('Duplicate local package names');
  return records;
}

function localEdges(record, byName, build, optionalNames) {
  const result = [];
  const { manifest } = record;
  const groups = [
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => !(name in (manifest.optionalDependencies ?? {}))),
    Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional || optionalNames.has(name)),
    Object.entries(manifest.optionalDependencies ?? {}).filter(([name]) => optionalNames.has(name)),
    ...(build ? [Object.entries(manifest.devDependencies ?? {})] : []),
  ];
  for (const [name, spec] of groups.flat()) {
    const dependency = byName.get(name);
    if (!dependency && !localName(name) && !(typeof spec === 'string' && spec.startsWith('workspace:'))) continue;
    if (!dependency) throw new Error(`Missing local required dependency ${name} of ${record.name}`);
    let range = spec;
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      range = range.slice(10);
      if (['*', '^', '~'].includes(range)) range = range === '*' ? '*' : range + dependency.version;
    }
    if (typeof range !== 'string' || !semver.validRange(range)) throw new Error(`Invalid local range ${name}@${spec} in ${record.name}`);
    if (!semver.satisfies(dependency.version, range)) throw new Error(`Local version mismatch: ${record.name} needs ${name}@${spec}, found ${dependency.version}`);
    if (!build && dependency.buildOnly) throw new Error('shared is build-only and cannot be a runtime dependency');
    result.push(dependency);
  }
  return result;
}
function ordered(roots, byName, build, optionalNames = new Set()) {
  const visiting = new Set(), visited = new Set(), output = [];
  function visit(record, chain) {
    if (visiting.has(record.name)) throw new Error(`Local dependency cycle: ${[...chain, record.name].join(' -> ')}`);
    if (visited.has(record.name)) return;
    visiting.add(record.name);
    engineCheck(record.manifest);
    for (const dependency of localEdges(record, byName, build, optionalNames)) visit(dependency, [...chain, record.name]);
    visiting.delete(record.name);
    visited.add(record.name);
    output.push(record);
  }
  roots.forEach(root => visit(root, []));
  return output;
}
export async function planPackages(selectors, { root = repositoryRoot } = {}) {
  if (!Array.isArray(selectors) || !selectors.length) throw new Error('Select at least one package slug');
  const all = await discoverPackages(root), byName = new Map(all.map(p => [p.name, p]));
  const requested = [];
  for (const selector of selectors) {
    const matches = all.filter(p => [p.name, p.slug, basename(p.dir)].includes(selector));
    if (matches.length !== 1 || matches[0].buildOnly) throw new Error(`Unknown or ambiguous package selector: ${selector}`);
    if (!requested.includes(matches[0])) requested.push(matches[0]);
  }
  const runtime = ordered(requested, byName, false);
  const optionalNames = new Set(runtime.map(record => record.name));
  return { root: resolve(root), requested, packages: ordered(requested, byName, false, optionalNames), buildPackages: ordered(requested, byName, true, optionalNames) };
}
async function execute(run, command, args, options) {
  const result = await run(command, args, options);
  if (result?.code !== 0) throw new Error(`${command} failed (exit ${result?.code ?? 'unknown'}); inspect command output`);
  return result;
}

// Inspect, never extract, package archives. Reject links and unsafe names.
function tarFiles(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const files = new Map();
  let extended = {};
  const text = (block, start, length) => block.subarray(start, start + length).toString().replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) break;
    const size = Number.parseInt(text(block, 124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid tar size');
    const checksum = Number.parseInt(text(block, 148, 8).trim(), 8);
    const actual = block.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== actual) throw new Error('Invalid tar checksum');
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(block[156]);
    if (type === 'x' || type === 'g') {
      if (type === 'g') throw new Error('Global PAX headers are not supported');
      extended = {};
      for (let pos = 0; pos < body.length;) {
        const space = body.indexOf(32, pos), length = Number(body.subarray(pos, space).toString());
        if (space < pos || !Number.isSafeInteger(length) || length <= space - pos + 1 || pos + length > body.length) throw new Error('Invalid PAX header');
        const line = body.subarray(space + 1, pos + length - 1).toString(), equal = line.indexOf('=');
        extended[line.slice(0, equal)] = line.slice(equal + 1);
        pos += length;
      }
      continue;
    }
    const prefix = text(block, 345, 155);
    const name = extended.path ?? (prefix ? prefix + '/' : '') + text(block, 0, 100);
    extended = {};
    if (!name.startsWith('package/') || name.includes('\\') || name.split('/').includes('..')) throw new Error(`Unsafe tar path: ${name}`);
    if (type === '5') continue;
    if (type !== '0' && type !== '\0') throw new Error(`Unsupported tar entry: ${name}`);
    const path = name.slice(8);
    if (!path || files.has(path)) throw new Error('Duplicate or empty tar path');
    files.set(path, body);
  }
  if (!files.has('package.json')) throw new Error('Archive lacks package.json');
  return files;
}
function inspect(bytes, expected) {
  const files = tarFiles(bytes), manifest = JSON.parse(files.get('package.json').toString());
  checkVersion(manifest);
  if (manifest.name !== expected.name || manifest.version !== expected.version) throw new Error('Packed artifact identity does not match plan');
  if (manifest.name === 'dsh-next-shared') throw new Error('shared must never be packed or mounted');
  const targets = [];
  const collect = value => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(manifest.exports);
  collect(manifest.main); collect(manifest.module); collect(manifest.types); collect(manifest.typings); collect(manifest.bin);
  collect(manifest.dsh?.bundle?.patch);
  if (!manifest.main && !manifest.exports) throw new Error('Package lacks runtime entry points');
  for (const target of targets) {
    const path = target.replace(/^\.\//, '');
    // Existing repository convention: source-only development subpath export.
    if (path === 'src/*') continue;
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) throw new Error(`Unsafe export target: ${target}`);
    if (path.includes('*')) {
      const expression = new RegExp('^' + path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      if (![...files.keys()].some(file => expression.test(file))) throw new Error(`Missing exported files: ${target}`);
    } else if (!files.has(path)) throw new Error(`Missing exported file: ${target}`);
  }
  for (const path of files.keys()) {
    if (!/^(?:package\.json|cordis\.patch\.ya?ml|(?:README|LICENSE|LICENCE|NOTICE|CHANGELOG)(?:\.[^/]+)?|lib\/[^]+|media\/[^]+\.(?:png|jpe?g|webp|gif|svg|woff2?|ttf|ico))$/.test(path)
      || /(?:^|\/)(?:node_modules|\.git|\.env[^/]*|\.npmrc|__tests__)(?:\/|$)/.test(path)
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) throw new Error(`Unexpected published file: ${path}`);
  }
  engineCheck(manifest);
  return { manifest, files: [...files.keys()].sort() };
}

export async function packPackages(plan, { artifactRoot = join(plan.root, 'artifacts', 'packages'), run = runCommand, env = process.env, pnpm = 'pnpm', dryRun = false, signal, timeoutMs } = {}) {
  if (dryRun) return [];
  env = withoutModelCredentials(env);
  artifactRoot = resolve(artifactRoot);
  const artifacts = [];
  for (const record of plan.buildPackages) {
    if (record.manifest.scripts?.build) await execute(run, pnpm, ['run', 'build'], { cwd: record.dir, env, signal, timeoutMs });
  }
  await mkdir(artifactRoot, { recursive: true });
  for (const record of plan.packages) {
    if (record.buildOnly) throw new Error('shared must never be packed');
    const stage = await mkdtemp(join(artifactRoot, '.pack-'));
    try {
      // pnpm pack intentionally runs prepare; a build is not a substitute for it.
      await execute(run, pnpm, ['pack', '--pack-destination', stage], { cwd: record.dir, env, signal, timeoutMs });
      const tarballs = (await readdir(stage)).filter(name => name.endsWith('.tgz'));
      if (tarballs.length !== 1) throw new Error(`Expected one tarball for ${record.name}`);
      const source = join(stage, tarballs[0]), bytes = await readFile(source), sha256 = hash(bytes);
      const inspected = inspect(bytes, record);
      const path = join(artifactRoot, `${record.name.replace(/^@/, '').replaceAll('/', '-')}-${record.version}-${sha256}.tgz`);
      try { await copyFile(source, path, constants.COPYFILE_EXCL); await chmod(path, 0o444); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if ((await lstat(path)).isSymbolicLink() || hash(await readFile(path)) !== sha256) throw new Error('Existing content-addressed artifact was modified');
      }
      artifacts.push({ name: record.name, version: record.version, path, sha256, ...inspected });
    } catch (error) { error.artifacts = artifacts; throw error; }
    finally { await rm(stage, { recursive: true, force: true }); }
  }
  return artifacts;
}

async function noSymlinks(path) {
  const absolute = resolve(path), root = parse(absolute).root;
  let cursor = root;
  for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    const stat = await exists(cursor);
    if (stat?.isSymbolicLink()) throw new Error(`Symlink not allowed in profile path: ${cursor}`);
  }
}
async function canonicalPath(path) {
  try { return await realpath(path); } catch (error) {
    if (!missing(error)) throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}
async function targetHome({ home, profile = 'web', env = process.env }) {
  home ??= env.DSH_HOME || join(homedir(), '.dsh');
  if (typeof home !== 'string' || !isAbsolute(home) || resolve(home) === parse(home).root) throw new Error('home must be an absolute non-root path');
  if (typeof profile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) throw new Error('Invalid profile name');
  home = await canonicalPath(resolve(home));
  if (home === parse(home).root) throw new Error('home must not resolve to filesystem root');
  const profileDir = join(home, 'profiles', profile);
  await noSymlinks(profileDir);
  for (const file of ['package.json', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml', 'cordis.patch.yml']) await noSymlinks(join(profileDir, file));
  return { home, profile, profileDir };
}
async function confirmation({ yes = false, confirm, isTTY = process.stdin.isTTY }, target) {
  if (yes) return;
  if (!isTTY) throw new Error('Non-interactive installation requires --yes');
  if (!confirm) {
    confirm = async message => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return /^y(?:es)?$/i.test((await rl.question(message)).trim()); } finally { rl.close(); }
    };
  }
  if (!await confirm(`Install into ${target.profileDir}? Existing profile state may change. [y/N] `)) throw new Error('Installation cancelled');
}

export async function installPackages(artifacts, options = {}) {
  const { dsh = 'dsh', pnpm = 'pnpm', run = runCommand, dryRun = false } = options;
  const target = await targetHome(options);
  const env = { ...withoutModelCredentials(options.env ?? process.env), DSH_HOME: target.home };
  if (!Array.isArray(artifacts) || !artifacts.length) throw new Error('No artifacts to install');
  const checked = [];
  for (const artifact of artifacts) {
    if (!isAbsolute(artifact.path) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('Invalid artifact identity');
    const bytes = await readFile(artifact.path);
    if (hash(bytes) !== artifact.sha256) throw new Error('Artifact checksum mismatch');
    checked.push({ ...artifact, ...inspect(bytes, artifact) });
  }
  if (new Set(checked.map(a => a.name)).size !== checked.length) throw new Error('Duplicate install artifact');
  const byName = new Map(checked.map(a => [a.name, { ...a, buildOnly: false }]));
  const orderedArtifacts = ordered([...byName.values()], byName, false, new Set(byName.keys()));
  const report = { ...target, packages: orderedArtifacts.map(a => a.name), bundles: orderedArtifacts.filter(a => a.manifest.dsh?.bundle?.patch).map(a => a.name), commands: [], dryRun, stage: 'validated' };
  const invoke = async (command, args, cwd = target.profileDir, { captureRawStdout = false } = {}) => {
    // Merged user configuration can contain credentials unrelated to our plugins.
    const reportArgs = args[0] === 'config' && args[1] === 'set'
      ? [...args.slice(0, -1), '[private merged overrides]'] : args;
    report.commands.push({ command, args: reportArgs, cwd });
    return execute(run, command, args, { cwd, env, signal: options.signal, timeoutMs: options.timeoutMs, captureRawStdout });
  };
  const addArgs = ['plugin', '--profile', target.profile, 'add', ...orderedArtifacts.map(a => 'file:' + a.path)];
  if (dryRun) {
    report.commands.push({ command: pnpm, args: ['config', 'set', '--location=project', '--json', 'overrides', JSON.stringify(Object.fromEntries(checked.map(a => [a.name, 'file:' + a.path])))], cwd: target.profileDir });
    report.commands.push({ command: dsh, args: addArgs, cwd: target.profileDir });
    return report;
  }
  await confirmation(options, target);
  const versionResult = await invoke(dsh, ['--version'], repositoryRoot);
  const dshVersion = versionResult.stdout.trim().match(/(?:^|\s)(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/)?.[1];
  if (!dshVersion) throw new Error('Cannot determine DSH runtime version');
  checked.forEach(a => engineCheck(a.manifest, dshVersion));
  await mkdir(join(target.home, 'profiles'), { recursive: true });
  const lock = join(target.home, 'profiles', '.workflow-' + target.profile + '.lock');
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error(`Profile is locked: ${lock}; inspect the owner before removing a stale lock`); throw error; }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), profile: target.profile }));
    await targetHome(target);
    if (!await exists(join(target.profileDir, 'package.json'))) {
      report.stage = 'initializing-profile';
      await invoke(dsh, ['plugin', '--profile', target.profile, '--version'], repositoryRoot);
    }
    await targetHome(target);
    const workspace = join(target.profileDir, 'pnpm-workspace.yaml');
    // Anchor pnpm project configuration here, never at an ancestor or user home.
    if (!await exists(workspace)) await writeFile(workspace, '{}\n', { flag: 'wx' });
    report.stage = 'configuring-overrides';
    const output = await invoke(pnpm, ['config', 'get', '--json', 'overrides'], target.profileDir, { captureRawStdout: true });
    const raw = (output.rawStdout ?? output.stdout).trim();
    let overrides;
    try { overrides = !raw || raw === 'undefined' || raw === 'null' ? {} : JSON.parse(raw); }
    catch { throw new Error('Existing pnpm overrides could not be decoded'); }
    if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Existing pnpm overrides are not an object');
    for (const artifact of checked) {
      for (const key of Object.keys(overrides)) {
        if (key !== artifact.name && key.includes(artifact.name)) throw new Error('Conflicting scoped pnpm override for ' + artifact.name);
      }
      overrides[artifact.name] = 'file:' + artifact.path;
    }
    await invoke(pnpm, ['config', 'set', '--location=project', '--json', 'overrides', JSON.stringify(overrides)]);
    report.stage = 'installing';
    await invoke(dsh, addArgs);
    report.stage = 'verifying-profile';
    await targetHome(target);
    const manifestPath = join(target.profileDir, 'package.json');
    const originalText = await readFile(manifestPath, 'utf8');
    const installed = JSON.parse(originalText);
    for (const artifact of checked) {
      const spec = installed.dependencies?.[artifact.name];
      if (typeof spec !== 'string' || !spec.startsWith('file:') || resolve(target.profileDir, spec.slice(5)) !== artifact.path) throw new Error('Profile does not reference expected artifact for ' + artifact.name);
    }
    const bundles = installed.dsh?.profile?.bundles;
    for (const bundle of report.bundles) {
      if (!Array.isArray(bundles) || bundles.filter(name => name === bundle).length !== 1) throw new Error('Profile is missing required local bundle or contains duplicates: ' + bundle);
    }
    if (report.bundles.length) {
      let index = 0;
      const selected = new Set(report.bundles);
      const normalized = bundles.map(name => selected.has(name) ? report.bundles[index++] : name);
      if (normalized.some((name, index) => name !== bundles[index])) {
        report.stage = 'ordering-bundles';
        installed.dsh.profile.bundles = normalized;
        const stage = await mkdtemp(join(target.profileDir, '.workflow-metadata-'));
        try {
          const temporary = join(stage, 'package.json');
          await writeFile(temporary, JSON.stringify(installed, null, 2) + '\n', { flag: 'wx', mode: (await lstat(manifestPath)).mode & 0o777 });
          await targetHome(target);
          if (await readFile(manifestPath, 'utf8') !== originalText) throw new Error('Profile metadata changed concurrently; refusing to overwrite');
          await rename(temporary, manifestPath);
        } finally { await rm(stage, { recursive: true, force: true }); }
      }
      const actual = (await json(manifestPath)).dsh.profile.bundles.filter(name => selected.has(name));
      if (JSON.stringify(actual) !== JSON.stringify(report.bundles)) throw new Error('Profile local bundle order does not match dependency plan');
    }
    report.stage = 'verifying-composition';
    await invoke(dsh, ['--profile', target.profile, '--dump-config']);
    report.stage = 'complete';
    return report;
  } catch (error) {
    report.partial = true;
    const failure = new Error(`${error.message ?? String(error)}. Profile may be partially changed at ${report.stage}; no rollback or cleanup was attempted. Persistent artifacts retained.`, { cause: error });
    failure.report = report;
    throw failure;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export function parseCli(argv) {
  argv = [...argv];
  if (argv[0] === '--') argv.shift();
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { command: 'help', selectors: [], options: {} };
  const [command, ...args] = argv;
  if (['pack', 'install'].includes(command) && args.length === 1 && ['--help', '-h'].includes(args[0])) return { command: 'help', selectors: [], options: {} };
  if (args[0] === '--') args.shift();
  if (!['pack', 'install'].includes(command)) throw new Error('Usage: workflow-pack.mjs pack|install <slug...> [--profile web] [--home PATH] [--dry-run] [--yes]');
  const selectors = [], options = {}, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('-')) { selectors.push(argument); continue; }
    if (!['--profile', '--home', '--dry-run', '--yes'].includes(argument) || seen.has(argument)) throw new Error(`Invalid or duplicate flag: ${argument}`);
    seen.add(argument);
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--yes') options.yes = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = value;
    }
  }
  if (!selectors.length) throw new Error('Select at least one package slug');
  if (command === 'pack' && (options.home || options.profile || options.yes)) throw new Error('pack accepts only selectors and --dry-run');
  return { command, selectors, options };
}
export async function runCli(argv, dependencies = {}) {
  const { command, selectors, options } = parseCli(argv);
  if (command === 'help') return { usage: 'workflow-pack.mjs pack|install <slug...> [--profile web] [--home PATH] [--dry-run] [--yes]', artifacts: 'artifacts/packages (persistent; do not delete while profiles use them)' };
  const settings = { ...dependencies, ...options };
  const plan = await planPackages(selectors, settings);
  if (command === 'install') {
    const target = await targetHome(settings);
    if (!options.dryRun) await confirmation(settings, target);
    settings.yes = true;
  }
  if (options.dryRun) return { dryRun: true, command, requested: plan.requested.map(p => p.name), packages: plan.packages.map(p => p.name), buildPackages: plan.buildPackages.map(p => p.name), ...(command === 'install' ? await targetHome(settings) : {}) };
  const artifacts = await packPackages(plan, settings);
  return command === 'pack' ? artifacts : installPackages(artifacts, settings);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  let interrupted = 0;
  const onInt = () => { interrupted = 130; controller.abort(); };
  const onTerm = () => { interrupted = 143; controller.abort(); };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  runCli(process.argv.slice(2), { signal: controller.signal }).then(result => {
    if (!interrupted) console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error.message);
    if (error.report) console.error(JSON.stringify(error.report, null, 2));
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (interrupted) process.exitCode = interrupted;
  });
}
