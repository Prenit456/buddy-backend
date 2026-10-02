import { DurableObject } from 'cloudflare:workers';
import { CareHub } from './care-hub.mjs';
import { D1State } from './d1-state.mjs';
import defaults from './default-settings.json' with { type: 'json' };
import { assistant, legacyApi } from './services.mjs';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function captureResponse() {
  let status = 200, headers = {}, result;
  return {
    get result() { return result; },
    writeHead(nextStatus, nextHeaders = {}) { status = nextStatus; headers = nextHeaders; return this; },
    end(body = '') { result = new Response(body, { status, headers: { ...noStore, ...headers } }); return this; },
    json(nextStatus, body) {
      result = new Response(JSON.stringify(body), { status: nextStatus,
        headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8' } });
      return true;
    }
  };
}

// The Durable Object keeps concurrent app/device mutations in one queue. D1 is
// the durable database, while this object only coordinates access and live media.
export class CareState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.queue = Promise.resolve();
    this.hub = null;
  }

  async initialize() {
    if (this.hub) return;
    if (!this.env.DB) throw new Error('D1 binding DB is missing.');
    const relay = this.env.REMOTE_STATE.getByName('buddy-remote-test');
    const prepared = structuredClone(defaults);
    prepared.device = { ...prepared.device, callName: 'Buddy', timezone: 'Asia/Kolkata' };
    prepared.display = { ...prepared.display, orientation: 'landscape', eyeColor: 20127 };
    this.hub = await new CareHub({ directory: '/tmp/buddy-unused', defaults: prepared,
      stateStore: new D1State(this.env.DB), services: {
        cloud: true, deviceToken: this.env.DEVICE_TOKEN || '', publicDeviceUrl: '',
        iceServers: this.env.BUDDY_ICE_SERVERS ? JSON.parse(this.env.BUDDY_ICE_SERVERS) : [{urls:'stun:stun.cloudflare.com:3478'}],
        assistant: (message, history, settings) => assistant(this.env, message, history, settings),
        remotePair: code => relay.pair(code),
        remoteLink: (circleId, deviceId) => relay.linkCircle(circleId, deviceId),
        remoteUnlink: () => relay.unlinkCircle()
      } }).init();
    await this.ctx.storage.setAlarm(Date.now()+30000);
  }

  alarm(){
    const run=this.queue.then(async()=>{await this.initialize();await this.hub.maintenance();await this.ctx.storage.setAlarm(Date.now()+30000);});
    this.queue=run.catch(()=>{});return run;
  }

  fetch(request) {
    // Provider requests can take seconds. Authenticate/snapshot inside the state
    // queue, then release it before calling AI so ringing/media/sync never waits
    // for a speech provider. Credentials and permissions still use the same hub.
    const path=new URL(request.url).pathname;
    if (/\/(?:assistant|tts|transcribe|tts\/voices|prescription\/(?:scan|review))$/.test(path))
      return this.providerRequest(request);
    const current = this.queue.then(async () => {
      await this.initialize();
      await this.hub.maintenance();
      this.hub.services.publicDeviceUrl = new URL(request.url).origin;
      const parsedUrl = new URL(request.url);
      const limit = /prescription|transcribe|media/.test(parsedUrl.pathname) ? 8_000_000 : 512_000;
      let bodyPromise;
      const bodyJson = () => {
        bodyPromise ||= request.text().then(raw => {
          if (raw.length > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
          try { return JSON.parse(raw || '{}'); }
          catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
        });
        return bodyPromise;
      };
      const response = captureResponse();
      const req = { method: request.method, url: parsedUrl.pathname + parsedUrl.search,
        headers: Object.fromEntries(request.headers), socket: { remoteAddress:
          request.headers.get('CF-Connecting-IP') || 'local' } };
      const json = (res, status, value) => res.json(status, value);
      try {
        const handled = await this.hub.handle(req, response, parsedUrl, {
          json, bodyJson,
          legacy: (legacyReq, legacyRes, nextUrl) => legacyApi(this.env, legacyReq, legacyRes, nextUrl, bodyJson, json)
        });
        if (!handled) return response.json(404, { error: 'Unknown Buddy operation.' }) && response.result;
        return response.result || new Response(null, { status: 204, headers: noStore });
      } catch (error) {
        return response.json(error.status || 500, { error: error.message || 'Cloud request failed.' }) && response.result;
      }
    });
    this.queue = current.catch(() => {});
    return current;
  }

  async providerRequest(request) {
    const prepare=this.queue.then(async()=>{
      await this.initialize();
      const url=new URL(request.url),path=url.pathname;
      const req={method:request.method,headers:Object.fromEntries(request.headers),socket:{remoteAddress:request.headers.get('CF-Connecting-IP')||'local'}};
      const deviceRoute=path.startsWith('/api/v2/device/');
      let circle,device;
      if(deviceRoute){device=this.hub.device(req);circle=this.hub.db.circles.find(c=>c.id===device.circleId);if(!circle)throw Object.assign(new Error('Pair Buddy first.'),{status:403});}
      else{
        const match=/^\/api\/v2\/circles\/([^/]+)\/bridge\/api\//.exec(path);
        if(!match)throw Object.assign(new Error('Unknown service.'),{status:404});
        const user=this.hub.actor(req);circle=this.hub.circle(user,match[1],path.includes('prescription')?'canEdit':undefined);
      }
      this.hub.rate(req,'provider:'+(device?.id||circle.id),80);
      const raw=request.method==='POST'?await request.text():'';
      if(raw.length>8_000_000)throw Object.assign(new Error('Request is too large.'),{status:413});
      let body;try{body=JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('Send valid JSON.'),{status:400});}
      const settings=structuredClone(circle.settings);
      if(path.endsWith('/assistant')&&device){const action=await this.hub.voiceAction(device,body.message);if(action)return {action};}
      return {body,settings,path:path.replace(/^.*\/(?:bridge\/api|device)\//,'/api/')};
    });
    this.queue=prepare.catch(()=>{});
    const response=captureResponse();
    try{
      const context=await prepare;
      if(context.action)response.json(200,context.action);
      else if(context.path==='/api/assistant')response.json(200,await assistant(this.env,context.body.message,context.body.history||[],context.settings));
      else{
        const body={...context.body,voiceId:context.body.voiceId||context.settings.voice?.voiceId,rate:context.body.rate??context.settings.voice?.rate,language:context.settings.person?.language};
        await legacyApi(this.env,{method:request.method},response,{pathname:context.path},async()=>body,(res,status,value)=>res.json(status,value));
      }
    }catch(error){response.json(error.status||503,{error:error.message||'Voice service unavailable.'});}
    return response.result;
  }
}
