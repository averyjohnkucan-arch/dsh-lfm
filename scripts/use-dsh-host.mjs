// Exercise the plugin against one complete, independently installed DSH.
import {readdir, mkdir, rm, symlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const host=resolve(process.argv[2] || '');
const plugin=resolve(process.argv[3] || '.');
assert.ok(process.argv[2], 'Pass the isolated DSH installation directory');
assert.notEqual(host, plugin, 'Host installation must be separate from the plugin');
const scope=join(host,'node_modules/@deepseek-ai');
const target=join(plugin,'node_modules/@deepseek-ai');
await mkdir(target,{recursive:true});
for(const name of await readdir(scope)){
 await rm(join(target,name),{recursive:true,force:true});
 await symlink(join(scope,name),join(target,name),process.platform==='win32'?'junction':'dir');
}
// Storage schemas must use the same Zod version and identity as their host.
const require=createRequire(pathToFileURL(join(plugin,'package.json')));
const manifest=require(join(plugin,'package.json'));
if(manifest.name==='dsh-knowledge'){
 const storage=createRequire(require.resolve('@deepseek-ai/dsh-storage-domain'));
 const zodRoot=dirname(storage.resolve('zod/package.json'));
 await rm(join(plugin,'node_modules/zod'),{recursive:true,force:true});
 await symlink(zodRoot,join(plugin,'node_modules/zod'),process.platform==='win32'?'junction':'dir');
}
console.log('Plugin DSH modules now resolve from the isolated host');
