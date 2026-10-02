import { Buffer } from 'node:buffer';
import { prescriptionDraft, reviewedReminders } from './care.mjs';
import { agendaAnswer } from './voice-actions.mjs';

const voices = {
  bella: 'hpp4J3VqNfWAUOO0d1Us', sarah: 'EXAVITQu4vr4xnSDxMaL',
  brian: 'nPczCjzI2devNBz1zQrb', daniel: 'onwK4e9ZLuTAKqWW03F9'
};
const geminiVoices = { bella: 'Sulafat', sarah: 'Gacrux', brian: 'Iapetus', daniel: 'Charon' };
const short = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
const readableError = (status, provider) => `${provider} is unavailable (${status}). Please retry later.`;
const keyPool = (env, name) => [...new Set([env[name], ...String(env[name+'S']||'').split(/[\s,]+/)].filter(Boolean))];

export async function assistant(env, message, history = [], settings = {}) {
  const question = short(message);
  if (!question) throw Object.assign(new Error('Ask Buddy a question first.'), { status: 400 });
  const person = String(settings.person?.name || 'the user').slice(0, 70);
  const system = `You are ${settings.device?.callName||'Buddy'}, a kind voice companion for ${settings.person?.formOfAddress||person}, an older adult. Reply in the user's language (${settings.person?.language||'en-IN'}). Answer accurately in plain language, usually 1-2 short sentences and at most 65 words. Do not use filler, markdown or emojis. Never invent calendar events, contacts, current facts or completed actions. Do not diagnose, prescribe or change medication. For urgent danger advise calling local emergency services or a trusted person. If unsure, say so. Actual schedule: ${agendaAnswer(settings)}. Actions only happen after the device reports them; never claim to have called or confirmed medicine.`;
  const messages = [{ role: 'system', content: system }, ...history.slice(-6).filter(x =>
    ['user', 'assistant'].includes(x.role) && typeof x.content === 'string').map(x =>
    ({ role: x.role, content: short(x.content) })), { role: 'user', content: question }];
  const providers = [
    ...keyPool(env,'GROQ_API_KEY').map(key=>({ url: 'https://api.groq.com/openai/v1/chat/completions', key, model: env.GROQ_MODEL || 'openai/gpt-oss-20b' })),
    ...keyPool(env,'OPENROUTER_API_KEY').map(key=>({ url: 'https://openrouter.ai/api/v1/chat/completions', key, model: env.OPENROUTER_MODEL || 'openrouter/free' })),
    ...keyPool(env,'NVIDIA_API_KEY').map(key=>({url:'https://integrate.api.nvidia.com/v1/chat/completions',key,model:env.NVIDIA_MODEL||'meta/llama-3.3-70b-instruct'}))
  ];
  const deadline=Date.now()+45_000;
  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { method: 'POST',
        headers: { authorization: `Bearer ${provider.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: provider.model, messages, max_tokens: 170, temperature: 0.25 }),
        signal: AbortSignal.timeout(Math.max(1,Math.min(12_000,deadline-Date.now()))) });
      if (!response.ok) continue;
      const result = await response.json();
      const answer = short(result.choices?.[0]?.message?.content).split(/\s+/).slice(0, 65).join(' ');
      if (answer) return { answer, model: provider.model };
    } catch { /* Try the next configured provider. */ }
    if(Date.now()>=deadline)break;
  }
  if(env.GEMINI_API_KEY&&Date.now()<deadline){
    try{
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_CHAT_MODEL||'gemini-2.5-flash')}:generateContent`,{method:'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY,'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:messages.slice(1).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:220,temperature:.25,thinkingConfig:{thinkingBudget:0}}}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
      if(response.ok){const answer=short((await response.json()).candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join(' ')).split(/\s+/).slice(0,65).join(' ');if(answer)return {answer,model:env.GEMINI_CHAT_MODEL||'gemini-2.5-flash'};}
    }catch{/* The caller gets a truthful error, never a fabricated answer. */}
  }
  throw Object.assign(new Error('Buddy’s AI is unavailable. Configure a Worker chat secret or try again later.'), { status: 503 });
}

function pcmFromGemini(data, mime='audio/wav') {
  const buffer = Buffer.from(data, 'base64');
  const isWav=buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WAVE';
  if(!isWav&&!/^audio\/(?:L16|pcm)/i.test(mime))throw new Error('Gemini returned unsupported audio.');
  if(isWav&&buffer.length<44)throw new Error('Gemini WAV is incomplete.');
  const channels = isWav?buffer.readUInt16LE(22):1, rate = isWav?buffer.readUInt32LE(24):Number(/rate=(\d+)/.exec(mime)?.[1]||24000), bits = isWav?buffer.readUInt16LE(34):16;
  if (channels !== 1 || bits !== 16 || ![16000, 24000].includes(rate))
    throw new Error('Gemini returned an unsupported sample format.');
  let offset = 12, samples=isWav?null:buffer;
  while (isWav && offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (size > buffer.length - offset - 8) throw new Error('Gemini WAV is incomplete.');
    if (buffer.toString('ascii', offset, offset + 4) === 'data') {
      samples = buffer.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (!samples || !samples.length || samples.length % 2) throw new Error('Gemini WAV has no valid audio.');
  if (rate === 16000) return Buffer.from(samples);
  const frames = Math.floor(samples.length / 2 * 16000 / rate);
  const out = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    const at = i * rate / 16000, before = Math.floor(at), after = Math.min(before + 1, samples.length / 2 - 1);
    const value = samples.readInt16LE(before * 2) * (1 - (at - before)) +
      samples.readInt16LE(after * 2) * (at - before);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  return out;
}

function wavFromPcm(pcm) {
  const out = Buffer.allocUnsafe(44 + pcm.length);
  out.write('RIFF', 0); out.writeUInt32LE(36 + pcm.length, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return out;
}

async function geminiSpeech(env, value, text, timeout = 35_000) {
  const voice = geminiVoices[value.voiceId] || geminiVoices.bella;
  const rate = Math.max(40, Math.min(120, Number(value.rate) || 72));
  const style = rate < 70 ? 'Warm, clear, calm, and a little slower than normal.' :
    rate > 95 ? 'Warm, clear, and conversational, with a brisk pace.' :
      'Warm, clear, and conversational, with a comfortable pace.';
  const model = encodeURIComponent(env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text:style+' Read only these words: '+text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig:{voiceName:voice} } } } }),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`Gemini speech returned HTTP ${response.status}.`);
  const result = await response.json();
  const inline = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
  if (!inline) throw new Error('Gemini speech returned no audio.');
  const pcm = pcmFromGemini(inline.data,inline.mimeType);
  return value.format === 'pcm' ? { body: pcm, mime: 'application/octet-stream', provider:'Gemini' } :
    { body: wavFromPcm(pcm), mime: 'audio/wav', provider:'Gemini' };
}

async function elevenLabsSpeech(env, value, text, timeout = 12_000) {
  const voice = voices[value.voiceId] || voices.bella;
  const rate = Math.max(40, Math.min(120, Number(value.rate) || 72));
  const speed = Math.max(0.7, Math.min(1.2, 0.75 + (rate - 40) / 160));
  const pcm = value.format === 'pcm';
  const format = pcm ? 'pcm_16000' : 'mp3_44100_128';
  const result = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${format}`, {
    method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.58, similarity_boost: 0.82, style: 0.12, use_speaker_boost: true, speed } }),
    signal: AbortSignal.timeout(timeout)
  });
  if (!result.ok) throw Object.assign(new Error(readableError(result.status, 'Voice service')), { status: 502 });
  return { body: await result.arrayBuffer(), mime: pcm ? 'application/octet-stream' : 'audio/mpeg',provider:'ElevenLabs' };
}

async function textToSpeech(env, value) {
  const text = short(value.text).slice(0, 600);
  if (!text) throw Object.assign(new Error('Text is required.'), { status: 400 });
  const deadline = Date.now() + 55_000;
  const elevenDeadline = env.GEMINI_API_KEY ? deadline - 25_000 : deadline;
  for(const key of keyPool(env,'ELEVENLABS_API_KEY')) {
    if (Date.now() >= elevenDeadline) break;
    try { return await elevenLabsSpeech({...env,ELEVENLABS_API_KEY:key}, value, text,
      Math.max(1, Math.min(12_000, elevenDeadline-Date.now()))); }
    catch { /* Try the other saved key, then the backup provider. */ }
  }
  if (env.GEMINI_API_KEY && Date.now() < deadline)
    return geminiSpeech(env, value, text, Math.max(1, deadline-Date.now()));
  throw Object.assign(new Error('No speech provider is available. Configure ElevenLabs or Gemini on the Worker.'), { status: 503 });
}

async function transcribe(env, value) {
  const match = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/.exec(value.audio || '');
  if (!match || match[1].length > 430_000) throw Object.assign(new Error('Send at most ten seconds of WAV audio.'), { status: 400 });
  const wav = Buffer.from(match[1], 'base64');
  if (wav.length < 44 || wav.length > 320_044 || wav.toString('ascii', 0, 4) !== 'RIFF' ||
      wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(24) !== 16_000 ||
      wav.readUInt16LE(22)!==1 || wav.readUInt16LE(20)!==1 || wav.readUInt16LE(34) !== 16 || wav.readUInt32LE(40)!==wav.length-44) throw Object.assign(new Error('Use 16 kHz mono PCM WAV.'), { status: 400 });
  const form = new FormData();
  form.set('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
  form.set('model_id', 'scribe_v2');
  form.set('tag_audio_events', 'false');
  const deadline = Date.now() + 45_000;
  const hasBackup = keyPool(env,'GROQ_API_KEY').length > 0;
  const elevenDeadline = hasBackup ? deadline-15_000 : deadline;
  for(const key of keyPool(env,'ELEVENLABS_API_KEY')) {try{
  if (Date.now() >= elevenDeadline) break;
  const result = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': key }, body: form,
    signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, elevenDeadline-Date.now()))) });
  if(result.ok)return { text: String((await result.json()).text || '').slice(0, 500),provider:'ElevenLabs' };
  }catch{/* Try backup recognition. */}}
  for(const key of keyPool(env,'GROQ_API_KEY')){try{
    if (Date.now() >= deadline) break;
    const fallback=new FormData();fallback.set('file',new Blob([wav],{type:'audio/wav'}),'utterance.wav');fallback.set('model','whisper-large-v3-turbo');fallback.set('response_format','json');
    const result=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+key},body:fallback,signal:AbortSignal.timeout(Math.max(1,Math.min(12_000,deadline-Date.now())))});
    if(result.ok)return {text:String((await result.json()).text||'').slice(0,500),provider:'Groq'};
  }catch{}}
  throw Object.assign(new Error('Speech recognition is unavailable. Check the Worker voice secrets or retry later.'),{status:503});
}

async function scanPrescription(env, value) {
  let text = String(value.text || '').slice(0, 12_000);
  if (value.image) {
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(value.image);
    if (!match || match[2].length > 6_000_000) throw Object.assign(new Error('Use a JPEG or PNG photo under 4 MB.'), { status: 400 });
    if (!env.GEMINI_API_KEY) throw Object.assign(new Error('Set GEMINI_API_KEY as a Worker secret for photo reading, or paste the prescription text.'), { status: 503 });
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL || 'gemini-2.5-flash')}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [
        { text: 'Transcribe only the visible prescription text, line by line. Do not infer missing drug names, doses, dates, or times. Mark unreadable text as [unclear].' },
        { inlineData: { mimeType: `image/${match[1]}`, data: match[2] } }
      ] }] }), signal: AbortSignal.timeout(35_000) });
    if (!response.ok) throw Object.assign(new Error(readableError(response.status, 'Photo reading')), { status: 502 });
    const result = await response.json();
    text = String(result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n') || '').slice(0, 12_000);
  }
  if (!text.trim()) throw Object.assign(new Error('No readable text found. Retake the photo or paste the text.'), { status: 400 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return { ...prescriptionDraft(text, today), confidence: null, engine: value.image ? 'gemini-vision-review-required' : 'reviewed-text' };
}

export async function legacyApi(env, req, res, url, bodyJson, json) {
  try {
    if (url.pathname === '/api/tts/voices' && req.method === 'GET')
      return json(res, 200, { engine: keyPool(env,'ELEVENLABS_API_KEY').length ? (env.GEMINI_API_KEY ? 'elevenlabs-with-gemini-fallback' : 'elevenlabs') : env.GEMINI_API_KEY ? 'gemini' : 'unavailable',
        voices: Object.keys(voices).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })) });
    if (url.pathname === '/api/tts' && req.method === 'POST') {
      const audio = await textToSpeech(env, await bodyJson());
      res.writeHead(200, { 'Content-Type': audio.mime, 'Cache-Control': 'no-store', 'X-Buddy-TTS-Provider':audio.provider }).end(audio.body);
      return true;
    }
    if (url.pathname === '/api/transcribe' && req.method === 'POST')
      return json(res, 200, await transcribe(env, await bodyJson()));
    if (url.pathname === '/api/prescription/scan' && req.method === 'POST')
      return json(res, 200, await scanPrescription(env, await bodyJson()));
    if (url.pathname === '/api/prescription/review' && req.method === 'POST')
      return json(res, 200, { reminders: reviewedReminders((await bodyJson()).items) });
    return json(res, 404, { error: 'Service route not found.' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Service unavailable.' });
  }
}
