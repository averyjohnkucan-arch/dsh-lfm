// Check a built/packed plugin against the installed DSH, without starting engines.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root = resolve(process.argv[2] || '.');
const require = createRequire(pathToFileURL(resolve(root, 'package.json')));
const hostRequire = process.env.DSH_COMPAT_HOST
  ? createRequire(pathToFileURL(resolve(process.env.DSH_COMPAT_HOST, 'package.json'))) : require;
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const {evaluatePluginCompatibility, getDshRuntimeVersion, loadOverlayPatches} =
  await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-app-boot')));
const version = getDshRuntimeVersion();
assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined,
  `${manifest.name} rejects DSH ${version}`);
// These checks prevent an accidental return to exact prerelease pins or an
// unbounded declaration that would silently accept the next breaking minor.
for (const accepted of ['0.2.1-rc.2', '0.2.1-rc.5', '0.2.1', '0.2.2']) {
  assert.equal(evaluatePluginCompatibility(manifest, {}, accepted), undefined);
}
for (const rejected of ['0.2.0', '0.3.0-alpha.1', '0.3.0', '1.0.0']) {
  assert.ok(evaluatePluginCompatibility(manifest, {}, rejected));
}
const patches = loadOverlayPatches('compatibility', resolve(root, manifest.dsh.bundle.patch));
const entries = [];
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.name === 'string' &&
      (value.name === manifest.name || value.name.startsWith(manifest.name + '/'))) entries.push(value.name);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(visit);
    else if (child && typeof child === 'object') visit(child);
  }
}
patches.forEach(visit);
assert.ok(entries.length, 'bundle has no plugin entries');
for (const entry of new Set(entries)) {
  // Actual module evaluation catches missing exports and removed DSH host APIs.
  const mod = await import(pathToFileURL(require.resolve(entry)));
  assert.ok(typeof mod.apply === 'function' || typeof mod.default === 'function' ||
    typeof mod.default?.apply === 'function', `${entry} does not export a Cordis plugin`);
}
if (manifest.dsh.client) {
  // Check real client module identifiers through the host's export map; never
  // substitute fake modules that would hide a rename/removal in DSH.
  const frontend = dirname(hostRequire.resolve('@deepseek-ai/dsh-web-frontend/package.json'));
  const assets = resolve(frontend, 'dist/assets');
  const shellSources = (await Promise.all((await readdir(assets))
    .filter(name => name.endsWith('.js')).map(name => readFile(resolve(assets, name), 'utf8')))).join('\n');
  function resolveClient(id) {
    try { hostRequire.resolve(id); return; } catch (error) {
      // Baseline browser modules are frozen into the shell, not npm modules.
      if (!shellSources.includes(JSON.stringify(id) + ':') &&
          !shellSources.includes("'" + id + "':")) throw error;
    }
  }
  for (const id of [...manifest.dsh.client.inject || [], ...manifest.dsh.client.external || []]) resolveClient(id);
  const filename = require.resolve(manifest.name + '/client');
  const source = await readFile(filename, 'utf8');
  for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) resolveClient(match[1]);
  let registration;
  vm.runInNewContext(source, {window: {__ModuleLoader__: {load(value) {
    assert.equal(registration, undefined, 'duplicate client registration'); registration = value;
  }}}}, {filename, timeout: 5000});
  assert.equal(registration?.id, manifest.name);
  assert.equal(typeof registration?.factory, 'function');
}
console.log(`${manifest.name}@${manifest.version}: DSH ${version}; ${new Set(entries).size} host entries and client declarations passed`);
