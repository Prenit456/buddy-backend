import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCareSettings, validDate } from './care.mjs';
import { voiceIntent, agendaAnswer } from './voice-actions.mjs';

const scrypt=promisify(scryptCallback), hash=s=>createHash('sha256').update(String(s)).digest('hex');
const token=()=>randomBytes(32).toString('base64url'), code=()=>randomBytes(6).toString('hex').toUpperCase();
const id=p=>p+'_'+randomUUID(), iso=()=>new Date().toISOString(), text=(s,n=240)=>String(s||'').trim().slice(0,n);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const active=c=>['ringing','accepted'].includes(c.status);
const safeUser=u=>({id:u.id,name:u.name,username:u.username||null,role:u.role});
function calendar(c,month,dateToday){
  const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate(),days=[];
  for(let day=1;day<=count;day++){
    const date=month+'-'+String(day).padStart(2,'0'),weekday=new Date(Date.UTC(year,m-1,day)).getUTCDay();
    const items=c.settings.reminders.filter(r=>r.enabled&&r.days.includes(weekday)&&(!r.startDate||date>=r.startDate)&&(!r.endDate||date<=r.endDate)).map(r=>{
      const latest=c.journal.filter(e=>e.date===date&&e.reminderId===r.id&&e.type.startsWith('reminder_')).at(-1);
      return {...r,status:latest?.type.slice('reminder_'.length)||'scheduled'};
    }).sort((a,b)=>a.time.localeCompare(b.time));
    days.push({date,items});
  }
  return {month,days,today:dateToday,source:'Cloudflare care schedule'};
}

export class CareHub {
  constructor({directory,defaults,services,stateStore=null}) {
    Object.assign(this,{directory,defaults,services,stateStore});
    this.path=join(directory,'care-hub.json');this.media=new Map();this.signals=new Map();this.presence=new Map();this.limits=new Map();this.writes=Promise.resolve();
    this.db={version:1,users:[],sessions:[],circles:[],devices:[],invites:[],calls:[]};
  }
  async init(){
    if(this.stateStore){
      const saved=await this.stateStore.load();
      if(saved!==null){
        if(!saved || !Array.isArray(saved.users) || !Array.isArray(saved.devices) || !Array.isArray(saved.circles))
          throw new Error('Supabase contains invalid Buddy state. Refusing to overwrite it.');
        this.db=saved;
      }
    }else{
      try{this.db=JSON.parse(await readFile(this.path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    // Legacy virtual devices must never be presented as live hardware.
    this.db.devices=this.db.devices.filter(d=>!d.simulated);
    if(!this.services.cloud)for(const call of this.db.calls)if(active(call)){call.status='ended';call.endedAt=iso();call.reason='Server restarted';}
    await this.commit();if(!this.services.cloud)this.timer=setInterval(()=>this.maintenance().catch(()=>{}),5000);return this;
  }
  commit(){
    const snapshot=JSON.stringify(this.db);
    this.writes=this.writes.catch(()=>{}).then(async()=>{
      if(this.stateStore)await this.stateStore.save(JSON.parse(snapshot));
      else{await mkdir(this.directory,{recursive:true});await writeFile(this.path+'.tmp',snapshot,{mode:0o600});await rename(this.path+'.tmp',this.path);}
    });return this.writes;
  }
  rate(req,kind,limit=30){
    const key=kind+':'+req.socket.remoteAddress,now=Date.now();let bucket=this.limits.get(key);
    if(!bucket||now-bucket.at>60000){bucket={at:now,count:0};this.limits.set(key,bucket);}
    if(++bucket.count>limit)fail(429,'Please wait a minute before trying again.');
  }
  bearer(req){return String(req.headers.authorization||'').replace(/^Bearer /,'');}
  actor(req){
    const session=this.db.sessions.find(s=>s.hash===hash(this.bearer(req))&&s.expires>Date.now());
    if(!session)fail(401,'Log in to Buddy to continue.');
    const user=this.db.users.find(u=>u.id===session.userId);if(!user)fail(401,'Session expired.');
    this.presence.set(user.id,Date.now());return user;
  }
  device(req){const d=this.db.devices.find(d=>d.tokenHash&&d.tokenHash===hash(this.bearer(req)));if(!d)fail(401,'Device credentials are not valid.');return d;}
  circle(user,circleId,permission){
    const c=this.db.circles.find(c=>c.id===circleId),m=c?.members.find(m=>m.userId===user.id);
    if(!m)fail(403,'This care circle is not shared with your account.');
    if(permission&&user.id!==c.ownerId&&!m[permission])fail(403,'The user has not granted this permission.');return c;
  }
  owner(user,c){if(user.id!==c.ownerId)fail(403,'Only the user can manage access to their care circle.');}
  date(c){return new Intl.DateTimeFormat('en-CA',{timeZone:c.settings.device.timezone||'Asia/Kolkata'}).format(new Date());}
  audit(c,actor,action){c.audit.unshift({id:id('audit'),at:iso(),actor:text(actor,80),action});c.audit=c.audit.slice(0,400);}
  alert(c,title,detail,kind='care',ref=''){
    if(ref&&c.alerts.some(a=>a.ref===ref&&!a.resolvedAt))return;
    c.alerts.unshift({id:id('alert'),at:iso(),title,detail,kind,ref,claimedBy:null,resolvedAt:null});c.alerts=c.alerts.slice(0,250);
  }
  command(d,type,payload={}){
    const item={id:id('cmd'),type,payload,createdAt:Date.now(),expiresAt:Date.now()+600000};d.commands.push(item);d.commands=d.commands.slice(-50);
    return item;
  }
  publicDevice(d){return {id:d.id,name:d.name,capabilities:d.capabilities,lastSeen:d.lastSeen||null,online:Date.now()-(d.lastSeen||0)<20000,appliedRevision:d.appliedRevision||0,status:d.status||{},results:d.results||[],syncError:d.syncError||null};}
  summary(c,u){
    const member=c.members.find(m=>m.userId===u.id);
    return {id:c.id,name:c.name,ownerId:c.ownerId,revision:c.revision,permissions:{canEdit:u.id===c.ownerId||member.canEdit,canCall:u.id===c.ownerId||member.canCall,canCamera:u.id===c.ownerId||member.canCamera},privacy:c.privacy};
  }
  view(c,u){
    const devices=this.db.devices.filter(d=>d.circleId===c.id);
    return {...this.summary(c,u),lastCheckin:c.lastCheckin||null,devices:devices.map(d=>this.publicDevice(d)),members:c.members.map(m=>({...m,...safeUser(this.db.users.find(u=>u.id===m.userId)),online:Date.now()-(this.presence.get(m.userId)||0)<20000})),alerts:c.alerts,tasks:c.tasks,checkins:c.checkins,messages:c.messages,audit:c.audit.slice(0,60),journal:c.journal.slice(-100),calls:this.db.calls.filter(call=>call.circleId===c.id).slice(-40).reverse(),settings:c.settings};
  }
  async saveSettings(c,user,incoming,expected){
    if(Number(expected)!==c.revision)fail(409,'Another person changed these settings. Reload before saving.');
    const value=structuredClone(incoming);delete value._revision;
    const error=validateCareSettings(value);if(error)fail(400,error);
    c.settings=value;c.revision++;this.audit(c,user.name,'Updated Buddy settings · revision '+c.revision);
    await this.commit();return {...c.settings,_revision:c.revision};
  }
  async deviceEvent(d,e){
    const c=this.db.circles.find(c=>c.id===d.circleId);if(!c)return;
    const eventId=text(e.eventId||e.id,100);if(!eventId||c.eventIds.includes(eventId))return;
    c.eventIds.push(eventId);c.eventIds=c.eventIds.slice(-2000);
    const type=text(e.type,40),reminderId=text(e.reminderId??e.id,100);
    if(type==='wake_detected')return;
    if(type==='call_control'){
      if(e.createdAt&&Math.abs(Date.now()-Number(e.createdAt))>45000)return; // Never dial from a stale offline request.
      const action=reminderId;
      if(action==='start'){
        const members=c.members.filter(m=>m.userId!==c.ownerId&&m.canCall),name=text(e.message,80).toLowerCase();
        const target=members.find(m=>this.db.users.find(u=>u.id===m.userId)?.name.toLowerCase()===name)||((name==='supervisor'||name==='family')?members[0]:null);
        if(target){try{this.createCall(c,d.id,target.userId,'audio');}catch(error){this.command(d,'say',{message:error.message});}}
        else this.command(d,'say',{message:'That person is not connected to your care circle. Ask them to join in the app.'});
      } else {
        const call=this.db.calls.find(call=>call.circleId===c.id&&active(call)&&(call.to===d.id||call.from===d.id));
        if(call){if(action==='accept'&&call.to===d.id)this.acceptCall(call,c);else if(action==='decline'||action==='end')this.endCall(call,action==='decline'?'declined':'ended');}
      }
      return;
    }
    if(type==='command_result'){
      const result={id:eventId,commandId:reminderId,at:iso(),result:text(e.message,240)};
      d.results=[...(d.results||[]),result].slice(-40);
      const message=c.messages.find(m=>m.commandIds?.includes(reminderId));
      if(message){message.deliveredAt=iso();message.delivery=result.result;}
      return;
    }
    const allowed=['reminder_due','reminder_acknowledged','reminder_snoozed','reminder_missed','sos_started','sos_cancelled','sos_escalated','check_in','hydration'];
    if(!allowed.includes(type))return;
    const occurred=Number(e.createdAt),at=Number.isFinite(occurred)&&occurred>=1700000000000&&occurred<=Date.now()+60000?new Date(occurred):new Date();
    c.journal.push({id:eventId,at:at.toISOString(),date:new Intl.DateTimeFormat('en-CA',{timeZone:c.settings.device.timezone||'Asia/Kolkata'}).format(at),type,reminderId,message:text(e.message)});c.journal=c.journal.slice(-2000);
    if(type==='sos_escalated')this.alert(c,'Buddy needs help','An SOS was raised on '+d.name+'. A supervisor should respond now.','sos',eventId);
    if(type==='reminder_missed')this.alert(c,'A reminder needs a check-in',text(e.message),'reminder',eventId);
    if(type==='check_in'){
      c.lastCheckin={at:at.toISOString(),mood:reminderId};
      for(const check of c.checkins)if(['waiting','overdue'].includes(check.status)&&at>=new Date(check.at)) {check.status='answered';check.answer=reminderId;check.answeredAt=iso();}
      if(['unwell','lonely','need_help'].includes(reminderId))this.alert(c,reminderId==='need_help'?'Help requested':'A check-in needs attention','The user reported feeling '+reminderId.replaceAll('_',' ')+'.',reminderId==='need_help'?'sos':'wellbeing',eventId);
    }
  }
  async voiceAction(d,message){
    const c=this.db.circles.find(c=>c.id===d.circleId),intent=voiceIntent(message);
    if(!c||!intent)return null;
    if(intent.action==='agenda')return {answer:agendaAnswer(c.settings),model:'local-care-actions'};
    if(intent.action==='time')return {answer:'It is '+new Intl.DateTimeFormat('en-IN',{timeZone:c.settings.device.timezone||'Asia/Kolkata',hour:'numeric',minute:'2-digit'}).format(new Date())+'.',model:'local-care-actions'};
    if(intent.action==='call'){
      const members=c.members.filter(m=>m.canCall&&m.userId!==c.ownerId);
      const target=members.find(m=>this.peerName(m.userId).toLowerCase()===intent.name)||(['family','carer','supervisor'].includes(intent.name)?members[0]:null);
      if(!target)return {answer:'That person is not in your care circle. Ask them to join in the app.',model:'local-care-actions'};
      try{this.createCall(c,d.id,target.userId,'audio');await this.commit();return {answer:'Calling '+this.peerName(target.userId)+'.',model:'local-care-actions'};}
      catch(error){return {answer:error.message,model:'local-care-actions'};}
    }
    if(['acknowledge','snooze'].includes(intent.action)&&!d.status?.activeReminderId)return {answer:'There is no active reminder to '+(intent.action==='snooze'?'snooze':'confirm')+'.',model:'local-care-actions'};
    const item=this.command(d,'action',{...intent,reminderId:d.status?.activeReminderId||''});await this.commit();
    const answers={sos:'Starting the help countdown. Press the button to cancel.',cancel_sos:'Cancelling the help request.',snooze:'I will snooze the active reminder.',acknowledge:'I will record your confirmation of the active reminder.',hydration:'I will record your water check-in.',check_in:'Thank you. I will share how you are feeling with your care circle.'};
    return {answer:answers[intent.action],commandId:item.id,model:'local-care-actions'};
  }
  peerName(peer){return this.db.users.find(u=>u.id===peer)?.name||this.db.devices.find(d=>d.id===peer)?.name||'Buddy';}
  createCall(c,from,to,kind){
    if(!['audio','video','camera'].includes(kind))fail(400,'Choose audio, video or a camera check-in.');
    if(from===to)fail(400,'Choose someone else to call.');
    const members=c.members.map(m=>m.userId),devices=this.db.devices.filter(d=>d.circleId===c.id);
    for(const peer of [from,to])if(!members.includes(peer)&&!devices.some(d=>d.id===peer))fail(403,'Calls stay inside your care circle.');
    for(const peer of [from,to]){const m=c.members.find(m=>m.userId===peer);if(m&&peer!==c.ownerId&&!m.canCall)fail(403,'Calling permission is disabled.');}
    const device=devices.find(d=>d.id===to||d.id===from);
    if(kind==='camera'&&!device)fail(400,'A camera check-in targets Buddy. Use a video call for the app.');
    if(device&&!this.publicDevice(device).online)fail(409,'Buddy is offline. Try calling the person’s app instead.');
    if(device&&kind!=='audio'&&!device.capabilities.camera)fail(409,'This device has not reported a working camera yet.');
    if(device&&kind!=='camera'&&!device.capabilities.audio)fail(409,'This device has not reported a working audio adapter yet.');
    if(kind==='camera'&&!c.privacy.cameraRequests)fail(403,'Camera check-ins are paused by the user.');
    if(this.db.calls.some(call=>active(call)&&[from,to].some(peer=>call.from===peer||call.to===peer)))fail(409,'One person is already in another call.');
    const call={id:id('call'),circleId:c.id,from,to,fromName:this.peerName(from),toName:this.peerName(to),kind,transport:device?'buddy-media':'webrtc',status:'ringing',createdAt:iso(),expiresAt:Date.now()+45000,signals:0};
    this.db.calls.push(call);this.db.calls=this.db.calls.slice(-300);
    if(device&&to===device.id)this.command(device,'call_ring',{callId:call.id,name:call.fromName,kind});
    if(device&&from===device.id)this.command(device,'call_dialing',{callId:call.id,name:call.toName,kind,expiresAt:call.expiresAt});
    this.audit(c,call.fromName,(kind==='camera'?'Requested a camera check-in with ':'Started a '+kind+' call to ')+call.toName);return call;
  }
  acceptCall(call,c){
    if(call.status!=='ringing'||Date.now()>call.expiresAt)fail(409,'This call is no longer ringing.');
    call.status='accepted';call.acceptedAt=iso();call.expiresAt=Date.now()+(call.kind==='camera'?120000:1800000);
    for(const d of this.db.devices.filter(d=>d.id===call.from||d.id===call.to))this.command(d,'call_start',{callId:call.id,kind:call.kind,expiresAt:call.expiresAt});
    this.audit(c,this.peerName(call.to),'Accepted '+(call.kind==='camera'?'a two-minute camera check-in':'the call'));
  }
  endCall(call,status='ended'){
    if(!active(call))return;call.status=status;call.endedAt=iso();this.media.delete(call.id);this.signals.delete(call.id);
    for(const d of this.db.devices.filter(d=>d.id===call.from||d.id===call.to))this.command(d,'call_end',{callId:call.id});
  }
  callFor(user,callId){
    const call=this.db.calls.find(c=>c.id===callId);if(!call)fail(404,'Call not found.');const c=this.circle(user,call.circleId,'canCall');
    if(call.from!==user.id&&call.to!==user.id)fail(403,'This call belongs to its two participants.');
    if(call.kind==='camera'&&user.id!==c.ownerId&&!c.members.find(m=>m.userId===user.id)?.canCamera)fail(403,'Camera permission is disabled.');return call;
  }
  mediaExchange(call,peer,input){
    if(call.status!=='accepted'||Date.now()>call.expiresAt)fail(409,'Media is available only during an accepted call.');
    if(call.transport!=='buddy-media')fail(400,'This call uses WebRTC.');
    if(!this.media.has(call.id))this.media.set(call.id,new Map());
    const peers=this.media.get(call.id),other=call.from===peer?call.to:call.from;
    if(!peers.has(peer))peers.set(peer,{seq:0,chunks:[],jpeg:null,frameSeq:0});
    const mine=peers.get(peer);
    if(input.audio){
      if(call.kind==='camera')fail(400,'Camera check-ins do not open a microphone.');
      if(!/^[A-Za-z0-9+/=]+$/.test(input.audio)||input.audio.length>22000)fail(400,'Audio chunk is too large.');
      const bytes=Buffer.from(input.audio,'base64');if(bytes.length%2)fail(400,'Use mono 16-bit PCM audio.');
      mine.chunks.push({seq:++mine.seq,audio:input.audio});mine.chunks=mine.chunks.slice(-10);
    }
    if(input.jpeg){
      if(call.kind==='audio')fail(403,'An audio call cannot upload camera frames.');
      if(!/^[A-Za-z0-9+/=]+$/.test(input.jpeg)||input.jpeg.length>120000)fail(400,'Camera frame is too large. Use 320 × 240 JPEG.');
      const jpeg=Buffer.from(input.jpeg,'base64');if(jpeg[0]!==255||jpeg[1]!==216)fail(400,'Use a JPEG frame.');
      mine.jpeg=input.jpeg;mine.frameSeq++;
    }
    const remote=peers.get(other);
    return {status:call.status,audio:remote?.chunks.filter(a=>a.seq>Number(input.after||0))||[],jpeg:remote&&remote.frameSeq>Number(input.frameAfter||0)?remote.jpeg:null,frameSeq:remote?.frameSeq||0,expiresAt:call.expiresAt};
  }
  async maintenance(){
    let changed=false;const now=Date.now();
    for(const call of this.db.calls)if(active(call)&&call.expiresAt<now){const missed=call.status==='ringing';this.endCall(call,missed?'missed':'ended');const c=this.db.circles.find(c=>c.id===call.circleId);if(missed&&c)this.alert(c,'Missed call',call.fromName+' tried to reach '+call.toName+'.','call',call.id);changed=true;}
    for(const c of this.db.circles){
      for(const check of c.checkins)if(check.status==='waiting'&&check.deadline<now){check.status='overdue';this.alert(c,'Check-in has no reply yet','A supervisor should contact '+c.name+'.','checkin',check.id);changed=true;}
      for(const d of this.db.devices.filter(d=>d.circleId===c.id))if(d.lastSeen&&now-d.lastSeen>90000&&!c.alerts.some(a=>a.ref==='offline:'+d.id&&!a.resolvedAt)){this.alert(c,'Buddy lost its connection',d.name+' has not checked in recently.','offline','offline:'+d.id);changed=true;}
    }
    if(changed)await this.commit();
  }
  async handle(req,res,url,{json,bodyJson,legacy}){
    const p=url.pathname;if(!p.startsWith('/api/v2/'))return false;
    const send=(value,status=200)=>{json(res,status,value);return true;};
    const method=req.method;
    try {
      if(p==='/api/v2/auth/register'&&method==='POST'){
        this.rate(req,'auth',12);const b=await bodyJson(req),enteredUsername=String(b.username||'').trim().replace(/\s+/g,' '),username=enteredUsername.toLowerCase(),name=text(b.name,70)||enteredUsername;
        if(!/^[a-z0-9][a-z0-9._ -]{2,39}$/.test(username)||!['user','supervisor'].includes(b.role)||typeof b.password!=='string'||b.password.length<8||b.password.length>256)fail(400,'Choose a 3–40 character username using letters, numbers, spaces, dots, dashes or underscores, a role, and a password of at least 8 characters.');
        if(this.db.users.some(u=>u.username===username))fail(409,'That username is already taken. Use Log in if it is yours.');
        const salt=randomBytes(16).toString('hex'),passwordHash=(await scrypt(b.password,salt,32)).toString('hex');
        const user={id:id('user'),name,username,role:b.role,salt,passwordHash,createdAt:iso()};this.db.users.push(user);
        if(user.role==='user'){
          const settings=structuredClone(this.defaults);settings.person.name=name;settings.reminders=[];settings.contacts=[];settings.safety.webhookUrl='';
          this.db.circles.push({id:id('circle'),ownerId:user.id,name:name+'’s circle',members:[{userId:user.id,canEdit:true,canCall:true,canCamera:true}],settings,revision:1,privacy:{cameraRequests:true},journal:[],eventIds:[],audit:[],alerts:[],tasks:[],checkins:[],messages:[]});
        }
        const session=token();this.db.sessions.push({hash:hash(session),userId:user.id,expires:Date.now()+7*86400000});await this.commit();return send({token:session,user:safeUser(user)},201);
      }
      if(p==='/api/v2/auth/login'&&method==='POST'){
        this.rate(req,'auth',12);const b=await bodyJson(req),username=text(b.username||b.email,160).replace(/\s+/g,' ').toLowerCase();
        const u=this.db.users.find(u=>u.username===username||u.email===username);
        const candidate=await scrypt(String(b.password||'').slice(0,256),u?.salt||'missing-user',32);
        if(!u||!timingSafeEqual(candidate,Buffer.from(u.passwordHash,'hex')))fail(401,'Username or password is incorrect.');
        const session=token();this.db.sessions.push({hash:hash(session),userId:u.id,expires:Date.now()+7*86400000});this.db.sessions=this.db.sessions.filter(s=>s.expires>Date.now()).slice(-500);await this.commit();return send({token:session,user:safeUser(u)});
      }
      if(p==='/api/v2/device/enroll'&&method==='POST'){
        this.rate(req,'enroll',10);const b=await bodyJson(req),secret=token(),pairCode=code();
        this.db.devices=this.db.devices.filter(d=>d.circleId||Date.now()-d.lastSeen<86400000);
        if(this.db.devices.length>=500)fail(503,'Device registration capacity reached.');
        const d={id:id('device'),name:text(b.name,70)||'Buddy',capabilities:{camera:!!b.capabilities?.camera,audio:!!b.capabilities?.audio},tokenHash:hash(secret),pairHash:hash(pairCode),pairExpires:Date.now()+600000,circleId:null,commands:[],appliedRevision:0,lastSeen:Date.now()};
        this.db.devices.push(d);await this.commit();return send({deviceId:d.id,deviceToken:secret,pairCode,pairExpires:d.pairExpires},201);
      }
      if(p.startsWith('/api/v2/device/')){
        const d=this.device(req),previousSeen=d.lastSeen||0;d.lastSeen=Date.now();
        if(['/api/v2/device/tts','/api/v2/device/transcribe'].includes(p)){
          if(!d.circleId)fail(403,'Pair Buddy first.');this.rate(req,'speech:'+d.id,80);
          const next=new URL(url);next.pathname=p.replace('/api/v2/device','/api');await legacy(req,res,next);return true;
        }
        const b=method==='POST'?await bodyJson(req):{};
        if(p.endsWith('/unpair')&&method==='POST'){
          const c=this.db.circles.find(c=>c.id===d.circleId);
          for(const call of this.db.calls.filter(call=>active(call)&&(call.to===d.id||call.from===d.id)))
            this.endCall(call);
          this.db.devices=this.db.devices.filter(item=>item.id!==d.id);
          if(c)this.audit(c,'Buddy','Unpaired '+d.name+' for re-pairing');
          await this.commit();if(d.cloud)await this.services.remoteUnlink();return send({ok:true});
        }
        if(p.endsWith('/assistant')&&method==='POST'){
          if(!d.circleId)fail(403,'Pair Buddy first.');this.rate(req,'assistant:'+d.id,30);
          return send(await this.services.assistant(b.message,b.history||[],this.db.circles.find(c=>c.id===d.circleId).settings));
        }
        if(p.endsWith('/pair-code')&&method==='POST'){
          if(d.circleId)fail(409,'This device is already paired.');const pairCode=code();d.pairHash=hash(pairCode);d.pairExpires=Date.now()+600000;await this.commit();return send({pairCode,pairExpires:d.pairExpires});
        }
        if(p.endsWith('/sync')&&method==='POST'){
          if(!d.circleId)return send({paired:false,deviceId:d.id});
          const c=this.db.circles.find(c=>c.id===d.circleId);
          const before=JSON.stringify({capabilities:d.capabilities,appliedRevision:d.appliedRevision,status:d.status,syncError:d.syncError,commands:d.commands});
          if(b.capabilities)d.capabilities={camera:b.capabilities.camera===true,audio:b.capabilities.audio===true};
          d.appliedRevision=Math.min(c.revision,Math.max(0,Number(b.appliedRevision)||0));
          d.name=text(c.settings.device.deviceName,70)||'Buddy';
          d.status={mode:text(b.status?.mode,30),batteryPercent:Number.isFinite(b.status?.batteryPercent)?b.status.batteryPercent:null,headline:text(b.status?.headline),detail:text(b.status?.detail),activeReminderId:text(b.status?.activeReminderId,100),wakeReady:b.status?.wakeReady===true,microphoneEnabled:b.status?.microphoneEnabled!==false,freeMemory:Number(b.status?.freeMemory)||0,firmwareVersion:text(b.status?.firmwareVersion,40),pendingEvents:Number(b.status?.pendingEvents)||0,clockValid:b.status?.clockValid===true};
          d.syncError=b.syncError?text(b.syncError):null;
          const ack=Array.isArray(b.ack)?b.ack.slice(0,50):[];d.commands=d.commands.filter(cmd=>cmd.expiresAt>Date.now()&&!ack.includes(cmd.id));
          for(const event of (Array.isArray(b.events)?b.events:[]).slice(0,40))await this.deviceEvent(d,event);
          const peers=c.members.filter(m=>m.canCall&&m.userId!==c.ownerId).map(m=>({id:m.userId,name:this.peerName(m.userId)}));
          let resolvedOfflineAlert=false;
          for(const alert of c.alerts)if(alert.ref==='offline:'+d.id&&!alert.resolvedAt){alert.resolvedAt=iso();resolvedOfflineAlert=true;}
          // Keep online presence current in RAM, but avoid rewriting the whole
          // Supabase document every three seconds when nothing else changed.
          const changed=before!==JSON.stringify({capabilities:d.capabilities,appliedRevision:d.appliedRevision,status:d.status,syncError:d.syncError,commands:d.commands});
          if(changed||resolvedOfflineAlert||Array.isArray(b.events)&&b.events.length||Date.now()-previousSeen>=15000)await this.commit();
          return send({paired:true,deviceId:d.id,revision:c.revision,settings:d.appliedRevision<c.revision?c.settings:null,commands:d.commands,peers,serverTime:Date.now()});
        }
        if(p.endsWith('/media')&&method==='POST'){
          const call=this.db.calls.find(c=>c.id===b.callId&&(c.to===d.id||c.from===d.id));if(!call)fail(403,'No call is assigned to this device.');return send(this.mediaExchange(call,d.id,b));
        }
        fail(404,'Unknown device operation.');
      }
      const u=this.actor(req);
      if(p==='/api/v2/auth/logout'&&method==='POST'){this.db.sessions=this.db.sessions.filter(s=>s.hash!==hash(this.bearer(req)));await this.commit();return send({ok:true});}
      if(p==='/api/v2/me'&&method==='GET')return send({user:safeUser(u),circles:this.db.circles.filter(c=>c.members.some(m=>m.userId===u.id)).map(c=>this.summary(c,u)),iceServers:this.services.iceServers||[{urls:'stun:stun.cloudflare.com:3478'}],deviceServerUrl:this.services.publicDeviceUrl||null});
      if(p==='/api/v2/join'&&method==='POST'){
        this.rate(req,'join',15);if(u.role!=='supervisor')fail(400,'Supervisor accounts join care circles.');
        const b=await bodyJson(req),invite=this.db.invites.find(i=>i.hash===hash(text(b.code,20).toUpperCase())&&!i.used&&i.expires>Date.now());if(!invite)fail(400,'This invitation is invalid or expired.');
        const c=this.db.circles.find(c=>c.id===invite.circleId);if(c.members.some(m=>m.userId===u.id))fail(409,'You already belong to this circle.');
        c.members.push({userId:u.id,canEdit:invite.canEdit,canCall:true,canCamera:invite.canCamera});invite.used=true;this.audit(c,u.name,'Joined the care circle by invitation');await this.commit();return send({circle:this.summary(c,u)});
      }
      if(p.startsWith('/api/v2/calls/')){
        const [, , , ,callId,operation]=p.split('/'),call=this.callFor(u,callId),c=this.circle(u,call.circleId);
        if(!operation&&method==='GET')return send({call});
        const b=method==='POST'?await bodyJson(req):{};
        if(operation==='accept'&&method==='POST'){if(call.to!==u.id)fail(403,'Only the recipient can answer.');this.acceptCall(call,c);await this.commit();return send({call});}
        if(operation==='end'&&method==='POST'){this.endCall(call,b.decline?'declined':'ended');await this.commit();return send({call});}
        if(operation==='signal'){
          if(call.transport!=='webrtc'||call.status!=='accepted')fail(409,'Accept the call before connecting media.');
          if(!this.signals.has(call.id))this.signals.set(call.id,[]);const signals=this.signals.get(call.id);
          if(method==='POST'){if(!['offer','answer','candidate'].includes(b.type)||JSON.stringify(b.data).length>50000)fail(400,'Invalid call signal.');signals.push({seq:++call.signals,from:u.id,type:b.type,data:b.data});if(signals.length>300)signals.shift();return send({ok:true});}
          return send({signals:signals.filter(s=>s.from!==u.id&&s.seq>Number(url.searchParams.get('after')||0))});
        }
        if(operation==='media'&&method==='POST')return send(this.mediaExchange(call,u.id,b));
        fail(404,'Unknown call operation.');
      }
      const match=/^\/api\/v2\/circles\/([^/]+)(.*)$/.exec(p);if(!match)fail(404,'Unknown Buddy operation.');
      const c=this.circle(u,match[1]),path=match[2];
      if(path.startsWith('/bridge/'))return await this.bridge(req,res,url,c,u,path.slice(7),{json,bodyJson,legacy});
      if(!path&&method==='GET')return send(this.view(c,u));
      const b=['POST','PUT','PATCH','DELETE'].includes(method)?await bodyJson(req):{};
      if(path==='/invite'&&method==='POST'){
        this.owner(u,c);const inviteCode=code();this.db.invites.push({hash:hash(inviteCode),circleId:c.id,expires:Date.now()+86400000,used:false,canEdit:b.canEdit!==false,canCamera:b.canCamera===true});await this.commit();return send({code:inviteCode,expires:Date.now()+86400000});
      }
      if(path==='/members'&&method==='POST'){
        this.owner(u,c);const m=c.members.find(m=>m.userId===b.userId&&m.userId!==c.ownerId);if(!m)fail(404,'Supervisor not found.');
        if(b.remove)c.members=c.members.filter(item=>item!==m);else for(const key of ['canEdit','canCall','canCamera'])if(typeof b[key]==='boolean')m[key]=b[key];
        for(const call of this.db.calls.filter(call=>call.circleId===c.id&&active(call)&&(call.to===m.userId||call.from===m.userId)))if(b.remove||!m.canCall||(call.kind==='camera'&&!m.canCamera))this.endCall(call);
        this.audit(c,u.name,(b.remove?'Removed ':'Updated access for ')+this.peerName(m.userId));await this.commit();return send({ok:true});
      }
      if(path==='/privacy'&&method==='PUT'){
        this.owner(u,c);c.privacy.cameraRequests=!!b.cameraRequests;
        if(!c.privacy.cameraRequests)for(const call of this.db.calls.filter(call=>call.circleId===c.id&&call.kind==='camera'))this.endCall(call);
        this.audit(c,u.name,c.privacy.cameraRequests?'Enabled camera requests (each still needs acceptance)':'Paused camera check-ins');await this.commit();return send(c.privacy);
      }
      if(path==='/devices/claim'&&method==='POST'){
        this.owner(u,c);this.rate(req,'pair',15);
        let d=this.db.devices.find(d=>!d.circleId&&d.pairExpires>Date.now()&&d.pairHash===hash(text(b.code,20).toUpperCase()));
        if(!d&&this.services.remotePair&&/^\d{8}$/.test(String(b.code||''))){
          if(this.db.devices.some(item=>item.cloud&&item.circleId))fail(409,'This Buddy is already linked to a care circle. Unpair it on the device before linking a different circle.');
          const result=await this.services.remotePair(String(b.code));
          if(result.error)fail(result.status||400,result.error);
          d={id:id('device'),name:'Buddy',capabilities:{camera:false,audio:false},tokenHash:hash(this.services.deviceToken),circleId:null,commands:[],appliedRevision:0,lastSeen:0,cloud:true};
          this.db.devices.push(d);
        }
        if(!d)fail(400,'The pairing code is invalid or expired.');
        d.circleId=c.id;delete d.pairHash;this.audit(c,u.name,'Paired '+d.name);await this.commit();
        if(d.cloud)await this.services.remoteLink(c.id,d.id);
        return send({device:this.publicDevice(d)});
      }
      if(path==='/devices/unpair'&&method==='POST'){
        this.owner(u,c);const d=this.db.devices.find(d=>d.id===b.deviceId&&d.circleId===c.id);if(!d)fail(404,'Device not found.');
        for(const call of this.db.calls.filter(call=>active(call)&&(call.to===d.id||call.from===d.id)))this.endCall(call);
        this.db.devices=this.db.devices.filter(item=>item.id!==d.id);this.audit(c,u.name,'Unpaired '+d.name);await this.commit();
        if(d.cloud)await this.services.remoteUnlink();return send({ok:true});
      }
      if(path==='/calls'&&method==='POST'){
        this.circle(u,c.id,b.kind==='camera'?'canCamera':'canCall');const call=this.createCall(c,u.id,text(b.to,80),b.kind||'audio');await this.commit();return send({call},201);
      }
      if(path==='/checkins'&&method==='POST'){
        if(b.answer){this.owner(u,c);const answer=text(b.answer,40);if(!['okay','need_help','lonely','unwell'].includes(answer))fail(400,'Choose a check-in response.');
          const pending=c.checkins.filter(check=>check.status==='waiting'||check.status==='overdue');for(const check of pending){check.status='answered';check.answer=answer;check.answeredAt=iso();}
          c.lastCheckin={at:iso(),mood:answer};c.journal.push({id:id('evt'),at:iso(),date:this.date(c),type:'check_in',reminderId:answer,message:u.name+' checked in: '+answer.replaceAll('_',' ')});
          if(answer!=='okay')this.alert(c,answer==='need_help'?'Help requested':'A check-in needs attention',u.name+' says '+answer.replaceAll('_',' '),answer==='need_help'?'sos':'wellbeing');
        }else{this.circle(u,c.id,'canCall');const item={id:id('check'),askedBy:u.name,at:iso(),deadline:Date.now()+Math.max(1,Math.min(120,Number(b.minutes)||15))*60000,status:'waiting'};c.checkins.unshift(item);c.checkins=c.checkins.slice(0,50);for(const d of this.db.devices.filter(d=>d.circleId===c.id))this.command(d,'say',{message:u.name+' would like to check on you. Say Hi ESP, I feel okay, or call for help.'});}
        await this.commit();return send({ok:true});
      }
      if(path==='/tasks'&&method==='POST'){
        if(b.id){const task=c.tasks.find(t=>t.id===b.id);if(!task)fail(404,'Task not found.');if(b.claim){if(task.assignedTo&&task.assignedTo!==u.id)fail(409,'Someone already claimed this task.');task.assignedTo=u.id;}if(b.done){if(task.assignedTo&&task.assignedTo!==u.id&&u.id!==c.ownerId)fail(403,'Only the assigned person can complete this task.');task.doneAt=iso();}this.audit(c,u.name,'Updated task: '+task.title);}
        else{if(!text(b.title,100))fail(400,'Give the task a title.');c.tasks.unshift({id:id('task'),title:text(b.title,100),note:text(b.note),createdBy:u.name,createdAt:iso(),dueDate:validDate(b.dueDate)?b.dueDate:null,assignedTo:null,doneAt:null});c.tasks=c.tasks.slice(0,100);this.audit(c,u.name,'Added task: '+text(b.title,100));}
        await this.commit();return send({ok:true});
      }
      if(path==='/alerts'&&method==='POST'){
        const alert=c.alerts.find(a=>a.id===b.id);if(!alert)fail(404,'Alert not found.');
        if(b.resolve){alert.resolvedAt=iso();alert.resolvedBy=u.name;}else{if(alert.claimedBy&&alert.claimedBy!==u.id)fail(409,'Another supervisor is already responding.');alert.claimedBy=u.id;alert.claimedName=u.name;alert.claimedAt=iso();}
        this.audit(c,u.name,(b.resolve?'Resolved: ':'Is responding to: ')+alert.title);await this.commit();return send({ok:true});
      }
      if(path==='/messages'&&method==='POST'){
        this.circle(u,c.id,'canCall');const message=text(b.message);if(!message)fail(400,'Write a message first.');
        const item={id:id('msg'),from:u.name,message,at:iso()};c.messages.unshift(item);c.messages=c.messages.slice(0,100);
        item.commandIds=[];
        for(const d of this.db.devices.filter(d=>d.circleId===c.id))item.commandIds.push(this.command(d,'say',{headline:'Message from '+u.name,message,messageId:item.id}).id);
        await this.commit();return send({message:item});
      }
      fail(404,'Unknown care-circle operation.');
    }catch(error){return send({error:error.message},error.status||500);}
  }
  async bridge(req,res,url,c,u,path,{json,bodyJson,legacy}){
    const send=(value,status=200)=>{json(res,status,value);return true;},method=req.method;
    const device=this.db.devices.find(d=>d.circleId===c.id);
    if(path==='/api/settings'&&method==='GET')return send({...c.settings,_revision:c.revision});
    if(path==='/api/settings'&&method==='PUT'){this.circle(u,c.id,'canEdit');const b=await bodyJson(req);return send(await this.saveSettings(c,u,b,b._revision));}
    if(path==='/api/status'&&method==='GET')return send({...(device?.status||{}),online:device?this.publicDevice(device).online:false,paired:!!device,lastSeen:device?.lastSeen||null,syncError:device?.syncError||null,deviceName:device?.name||'No Buddy paired',ip:'Cloudflare',firmwareVersion:device?.status?.firmwareVersion||'—',events:c.journal.slice(-20),commandResults:device?.results||[],audioMode:'cloud-gateway',settingsRevision:c.revision,appliedRevision:device?.appliedRevision||0});
    if(path==='/api/journal'&&method==='GET')return send({events:c.journal});
    if(path==='/api/calendar'&&method==='GET'){const month=url.searchParams.get('month')||this.date(c).slice(0,7);if(!validDate(month+'-01'))fail(400,'Choose a valid month.');return send(calendar(c,month,this.date(c)));}
    if(path==='/api/actions'&&method==='POST'){
      this.circle(u,c.id,'canEdit');const b=await bodyJson(req);if(!device)fail(409,'Pair Buddy first.');
      const allowed=['sos','cancel_sos','snooze','acknowledge','check_in','hydration','agenda','ping'];
      let command;
      if(b.action==='agenda')command=this.command(device,'say',{message:agendaAnswer(c.settings).slice(0,500)});
      else if(allowed.includes(b.action))command=this.command(device,'action',{action:b.action,reminderId:text(b.reminderId,100)});
      else if(b.action==='say'){
        if(!text(b.message))fail(400,'Write a message first.');
        command=this.command(device,'say',{message:text(b.message),headline:text(b.headline,80)});
      }else fail(400,'Unknown Buddy action.');
      await this.commit();return send({ok:true,commandId:command.id,delivery:'queued',online:this.publicDevice(device).online});
    }
    if(path==='/api/time'&&method==='POST')return send({ok:true});
    if(path==='/api/assistant'&&method==='POST'){this.rate(req,'assistant:'+u.id,30);const b=await bodyJson(req);return send(await this.services.assistant(b.message,b.history||[],c.settings));}
    if(['/api/tts','/api/tts/voices','/api/transcribe','/api/prescription/scan','/api/prescription/review'].includes(path)){
      if(path.includes('prescription'))this.circle(u,c.id,'canEdit');
      this.rate(req,'services:'+u.id,80);const next=new URL(url);next.pathname=path;await legacy(req,res,next);return true;
    }
    fail(404,'This setting is managed through the paired device.');
  }
  close(){if(this.timer)clearInterval(this.timer);}
}
