// Reads already-saved PRIVATE test credentials. Never logs their values, writes
// them into source, or copies them into site/. Run --upload after wrangler login.
import { readFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const backend=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const workspace=resolve(backend,'..');
let source='';
for(const path of ['.env.local','firmware/api_test/config.h','firmware/buddy_cloud/config.h']){
  try{source+='\n'+await readFile(resolve(workspace,path),'utf8');}catch{/* Clone may not contain private local files. */}
}
try{source+='\n'+await readFile(resolve(backend,'.secrets.local.json'),'utf8');}catch{}
const unique=pattern=>[...new Set(source.match(pattern)||[])];
const pools={GROQ_API_KEYS:unique(/gsk_[A-Za-z0-9_-]+/g),OPENROUTER_API_KEYS:unique(/sk-or-v1-[a-f0-9]{64}\b/g),NVIDIA_API_KEYS:unique(/nvapi-[A-Za-z0-9_-]+/g),ELEVENLABS_API_KEYS:unique(/sk_[a-f0-9]{40,80}\b/g),GEMINI_API_KEYS:unique(/AIza[A-Za-z0-9_-]{30,45}/g)};
const secrets={};
export {secrets};
for(const [name,keys] of Object.entries(pools)){
  console.log(`${name}: ${keys.length} saved key(s) found`);
  if(keys.length){secrets[name]=keys.join(',');secrets[name.slice(0,-1)]=keys[0];}
}
const device=/kDeviceToken\[\]\s*=\s*"([^"]+)"/.exec(source)?.[1];
if(device&&device.length>=32)secrets.DEVICE_TOKEN=device;
console.log('DEVICE_TOKEN: '+(secrets.DEVICE_TOKEN?'found':'not found'));
if(!Object.keys(secrets).length)throw new Error('No saved private credentials found. Use wrangler secret put in this clone instead.');
if(process.argv.includes('--upload')){
  const result=spawnSync(resolve(backend,'node_modules/.bin/wrangler'),['secret','bulk'],{cwd:backend,input:JSON.stringify(secrets),encoding:'utf8',stdio:['pipe','pipe','pipe']});
  // Wrangler normally lists secret NAMES only. Redact every value defensively.
  let output=(result.stdout||'')+(result.stderr||'');for(const value of Object.values(secrets))for(const part of value.split(','))output=output.replaceAll(part,'<redacted>');
  console.log(output);process.exitCode=result.status||0;
}else console.log('Inventory only. After wrangler login, run: node tools/provision-secrets.mjs --upload');
