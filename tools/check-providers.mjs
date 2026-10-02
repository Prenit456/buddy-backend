// Explicit live smoke test: a tiny fictional chat/speech/STT request. May use
// provider credits. No real care accounts, cloud data or private key values log.
import {secrets} from './provision-secrets.mjs';
import {assistant,legacyApi} from '../src/services.mjs';
if(!process.argv.includes('--live')){
  console.log('Pass --live to send synthetic requests using saved private keys.');
  process.exit(0);
}
let failed=false;
async function check(name,run){
  try{console.log(JSON.stringify({check:name,ok:true,...await run()}));}
  catch(error){failed=true;console.log(JSON.stringify({check:name,ok:false,status:error.status||null}));}
}
async function service(env,path,body){
  let status,headers,result;
  const res={writeHead(s,h){status=s;headers=h;return this;},end(v){result=v;return this;}};
  await legacyApi(env,{method:'POST'},res,{pathname:path},async()=>body,(_,s,v)=>{status=s;result=v;});
  if(status!==200)throw Object.assign(new Error('Provider request failed'),{status});
  return {headers,result};
}
function wav(pcm){
  const b=Buffer.alloc(44+pcm.length);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);
  b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);
  b.writeUInt32LE(pcm.length,40);pcm.copy(b,44);return b;
}
let speech;
await check('chat provider pool',async()=>{const value=await assistant(secrets,'Say hello in one short sentence.',[],{person:{name:'Fictional test user'},reminders:[]});return {model:value.model,answerReceived:!!value.answer};});
await check('primary speech with fallback',async()=>{const value=await service(secrets,'/api/tts',{text:'Hello Buddy. This is a test.',voiceId:'bella',rate:72,format:'pcm'});speech=Buffer.from(value.result);return {provider:value.headers['X-Buddy-TTS-Provider'],bytes:speech.length};});
if(speech?.length&&speech.length<=320000)await check('transcription with fallback',async()=>{const value=await service(secrets,'/api/transcribe',{audio:'data:audio/wav;base64,'+wav(speech).toString('base64')});return {provider:value.result.provider,textRecognized:!!value.result.text};});
if(secrets.GEMINI_API_KEY)await check('Gemini speech backup',async()=>{const value=await service({GEMINI_API_KEY:secrets.GEMINI_API_KEY},'/api/tts',{text:'Buddy is ready.',voiceId:'bella',rate:72,format:'pcm'});return {provider:value.headers['X-Buddy-TTS-Provider'],bytes:value.result.length};});
process.exitCode=failed?1:0;
