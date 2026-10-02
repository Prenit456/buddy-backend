import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyApi } from '../src/services.mjs';

function wav24k() {
  const samples = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++) samples.writeInt16LE(Math.round(Math.sin(i / 20) * 4000), i * 2);
  const wav = Buffer.alloc(44 + samples.length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + samples.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length, 40); samples.copy(wav, 44);
  return wav;
}

async function tts(env) {
  let status, headers, body;
  const response = { writeHead(code, fields) { status = code; headers = fields; return this; },
    end(value) { body = value; return this; } };
  await legacyApi(env, { method: 'POST' }, response, { pathname: '/api/tts' },
    async () => ({ text: 'Hello there.', voiceId: 'bella', format: 'pcm' }),
    (_, code, value) => { status = code; body = value; });
  return { status, headers, body };
}

test('Gemini 24k WAV is converted to ESP 16k PCM', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [
    { inlineData: { data: wav24k().toString('base64') } }
  ] } }] }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const result = await tts({ GEMINI_API_KEY: 'synthetic' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Type'], 'application/octet-stream');
    assert.equal(result.body.length, 32000);
  } finally { globalThis.fetch = original; }
});

test('ElevenLabs is tried before Gemini when both are configured', async () => {
  const original = globalThis.fetch;
  const destinations = [];
  globalThis.fetch = async url => {
    destinations.push(String(url));
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  };
  try {
    const result = await tts({ GEMINI_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Type'], 'application/octet-stream');
    assert.equal(result.body.byteLength, 4);
    assert.deepEqual(destinations.length, 1);
    assert.match(destinations[0], /api\.elevenlabs\.io/);
  } finally { globalThis.fetch = original; }
});

test('Gemini is used when ElevenLabs is unavailable', async () => {
  const original = globalThis.fetch;
  const destinations = [];
  globalThis.fetch = async url => {
    destinations.push(String(url));
    if (destinations.length === 1) return new Response('', { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { inlineData: { data: wav24k().toString('base64') } }
    ] } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await tts({ GEMINI_API_KEY: 'synthetic', ELEVENLABS_API_KEY: 'synthetic' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Type'], 'application/octet-stream');
    assert.equal(result.body.length, 32000);
    assert.match(destinations[0], /api\.elevenlabs\.io/);
    assert.match(destinations[1], /generativelanguage\.googleapis\.com/);
  } finally { globalThis.fetch = original; }
});

test('Gemini raw little-endian PCM is resampled and request uses a real prebuilt voice',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{
    const request=JSON.parse(options.body);
    assert.equal(request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Sulafat');
    return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:wav24k().subarray(44).toString('base64'),mimeType:'audio/L16;codec=pcm;rate=24000'}}]}}]}));
  };
  try{const result=await tts({GEMINI_API_KEY:'synthetic'});assert.equal(result.status,200);assert.equal(result.body.length,32000);}finally{globalThis.fetch=original;}
});

test('speech reserves time for Gemini instead of retrying old keys indefinitely',async()=>{
  const original=globalThis.fetch,clock=Date.now;let now=100000,calls=0;
  Date.now=()=>now;
  globalThis.fetch=async url=>{
    ++calls;
    if(String(url).includes('elevenlabs')){now+=12000;return new Response('',{status:429});}
    return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:wav24k().toString('base64')}}]}}]}));
  };
  try{const result=await tts({ELEVENLABS_API_KEYS:'old1,old2,old3,old4',GEMINI_API_KEY:'synthetic'});assert.equal(result.status,200);assert.equal(calls,4);assert.equal(result.headers['X-Buddy-TTS-Provider'],'Gemini');}
  finally{globalThis.fetch=original;Date.now=clock;}
});
