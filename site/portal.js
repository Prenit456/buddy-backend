import { BuddyCalls } from './calls.js';
import { renderHardware } from './hardware-controls.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('buddy.session')||'',me,view,tab='today',polling=false,editorKey='',editorPage='voice',todayItems=[],calendarAt=0,toastTimer,chatBusy=false;
const chatSessions=new Map();
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
async function request(path,body,method,timeoutMs=15000){const r=await fetch('/api/v2'+path,{method:method||(body?'POST':'GET'),headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});const value=await r.json();if(!r.ok){if(r.status===401&&me){token='';sessionStorage.removeItem('buddy.session');location.reload();}const message=value.error==='Link Buddy using the code on its TFT.'?'Cloudflare is still running the older pairing-only backend. Deploy the updated Buddy Worker before creating an account.':value.error;throw new Error(message||'Buddy is unavailable');}return value;}
const circlePath=()=>'/circles/'+view.id;
const owner=()=>view?.ownerId===me?.user.id;
const time=s=>new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const callUI=new BuddyCalls({request,toast,refresh});
const speakReply=document.createElement('button');speakReply.type='button';speakReply.className='secondary';speakReply.textContent='Read this reply on Buddy';speakReply.disabled=true;
$('#chatPanel .chat-suggestions').append(speakReply);
speakReply.onclick=async()=>{try{const last=(chatSessions.get(view.id)||[]).filter(m=>m.role==='assistant').at(-1);if(!last)return;await request(circlePath()+'/messages',{message:last.content});toast('Reply queued for the real Buddy.');await refresh();}catch(error){toast(error.message);}};
function renderChat(){
 const log=$('#chatLog');log.replaceChildren();log.dataset.circle=view?.id||'';
 const conversation=chatSessions.get(view?.id)||[];
 speakReply.disabled=!view?.devices.length||!view?.permissions.canCall||!conversation.some(m=>m.role==='assistant');
 if(!conversation.length){const intro=document.createElement('p');intro.className='empty-note';intro.textContent='Hi, I’m Buddy. What is on your mind?';log.append(intro);}
 for(const entry of conversation){const bubble=document.createElement('div');bubble.className='chat-bubble '+entry.role;const label=document.createElement('strong');label.textContent=entry.role==='user'?'You':'Buddy';const content=document.createElement('p');content.textContent=entry.content;bubble.append(label,content);log.append(bubble);}
 log.scrollTop=log.scrollHeight;
}
async function sendChat(message){
 if(chatBusy||!view?.id)return;
 const text=message.trim();if(!text||text.length>1000)return;
 const circleId=view.id,history=[...(chatSessions.get(circleId)||[])];
 chatBusy=true;$('#chatSend').disabled=true;$('#chatMessage').disabled=true;
 $('#chatStatus').textContent='Buddy is thinking…';
 chatSessions.set(circleId,[...history,{role:'user',content:text}].slice(-24));renderChat();
 try{const reply=await request('/circles/'+circleId+'/bridge/api/assistant',{message:text,history:history.slice(-6)},undefined,55000);
  if(typeof reply.answer!=='string'||!reply.answer.trim())throw new Error('Buddy returned an empty reply. Please try again.');
  chatSessions.set(circleId,[...(chatSessions.get(circleId)||[]),{role:'assistant',content:reply.answer.trim()}].slice(-24));
  if(view?.id===circleId)$('#chatStatus').textContent='Buddy is ready to talk. For exact care details, use Calendar.';
 }catch(error){chatSessions.set(circleId,history);if(view?.id===circleId){$('#chatMessage').value=text;$('#chatStatus').textContent='Buddy could not reply: '+error.message;}}
 finally{chatBusy=false;$('#chatSend').disabled=false;$('#chatMessage').disabled=false;if(view?.id===circleId)renderChat();}
}
async function boot(){try{me=await request('/me');callUI.iceServers=me.iceServers;$('#auth').hidden=true;$('#shell').hidden=false;$('#greeting').textContent='Hello, '+me.user.name;$('#roleLabel').textContent=me.user.role==='user'?'YOUR DAY, YOUR WAY':'SUPERVISOR · CARE TOGETHER';const selected=sessionStorage.getItem('buddy.circle');$('#circleSelect').innerHTML=me.circles.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===selected?'selected':'')+'>'+esc(c.name)+'</option>').join('');$('#noCircle').hidden=!!me.circles.length;$('#nav').hidden=!me.circles.length;$('#extraJoinForm').closest('.card').hidden=me.user.role!=='supervisor';await refresh();}catch(e){$('#auth').hidden=false;$('#shell').hidden=true;if(token)toast(e.message);}}
const hubAddress=document.createElement('p');
hubAddress.className='fine';
$('#pairSection').insertBefore(hubAddress,$('#pairForm'));
let shownHubUrl='';
function showHubAddress(target){
 if(target===shownHubUrl)return;shownHubUrl=target;hubAddress.replaceChildren();
 const url=new URL(target);
 if(url.hostname==='localhost'||url.hostname==='127.0.0.1'){
  hubAddress.textContent='The website is running on this computer, but its care data and device messages go through the Cloudflare Worker. Buddy does not need to share this Wi-Fi network.';
 }else{
  const address=document.createElement('code');address.textContent=url.origin;
  hubAddress.append('Cloudflare backend: ',address,'. Buddy and your phone can use separate internet connections.');
 }
}
showHubAddress(location.origin);
async function refresh(){if(polling||!me)return;polling=true;try{
 const id=$('#circleSelect').value;if(!id){document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=true);$('#connection').textContent='No circle linked';return;}
 view=await request('/circles/'+id);showHubAddress(me.deviceServerUrl||location.origin);sessionStorage.setItem('buddy.circle',id);
 const physical=view.devices,onlinePhysical=physical.filter(d=>d.online),pendingPhysical=physical.filter(d=>d.appliedRevision<view.revision);
 $('#connection').textContent=physical.length?(pendingPhysical.length?'ESP32 change pending':onlinePhysical.length?'ESP32 online · v'+view.revision:'ESP32 offline'):'No ESP32 paired';$('#connection').classList.toggle('warning',!onlinePhysical.length||!!pendingPhysical.length);
 $('#dayTitle').textContent=owner()?'A little company for your day.':'Looking after '+view.settings.person.name+'.';
 $('#daySummary').textContent=(owner()?'Your people are a call away. Let them know how you’re feeling, or ask Buddy for today’s plans.':'A shared view of reminders, check-ins and the people ready to help.')+(view.checkins.some(c=>c.status==='waiting')?' A check-in is waiting for a reply.':view.lastCheckin?' Last check-in: '+view.lastCheckin.mood.replaceAll('_',' ')+' · '+time(view.lastCheckin.at):'');
 const canVideo=d=>d.online&&d.capabilities.camera&&d.capabilities.audio;
 const videoBuddy=view.devices.find(canVideo);
 $('#checkinButtons').innerHTML=owner()?'<button class="primary" data-check="okay">I’m feeling okay</button><button class="secondary" data-check="lonely">I’d like some company</button><button class="danger" data-check="need_help">Ask my circle for help</button>':'<button class="primary" data-check="request" '+(!view.permissions.canCall?'disabled':'')+'>Request a check-in</button><button class="secondary" data-call="'+esc(videoBuddy?.id||'')+'" data-kind="video" '+(!view.permissions.canCall||!videoBuddy?'disabled':'')+'>Video call Buddy</button><button class="secondary" data-open="buddy">All call options</button>';
 if(Date.now()-calendarAt>15000){try{const month=new Intl.DateTimeFormat('en-CA',{timeZone:view.settings.device.timezone||'Asia/Kolkata'}).format(new Date()).slice(0,7);const cal=await request(circlePath()+'/bridge/api/calendar?month='+month);todayItems=cal.days.find(d=>d.date===cal.today)?.items||[];calendarAt=Date.now();}catch{todayItems=[];}}
 $('#todayReminders').innerHTML=todayItems.length?todayItems.map(r=>'<div class="row"><span class="time-tag">'+esc(r.time)+'</span><div class="content"><b>'+esc(r.title)+'</b><p>'+esc(r.detail)+'</p><small>'+esc(r.status)+' · '+esc(r.kind)+'</small></div></div>').join(''):'<p class="empty-note">Room for a gentle routine. Add reminders in the calendar.</p>';
 const alerts=view.alerts.filter(a=>!a.resolvedAt);$('#alertCount').textContent=alerts.length+' open';$('#alerts').innerHTML=alerts.map(a=>'<div class="row"><div class="content"><b>'+esc(a.title)+'</b><p>'+esc(a.detail)+'</p><small>'+esc(a.claimedName?'Responding: '+a.claimedName:time(a.at))+'</small><div class="button-row"><button class="secondary" data-claim="'+a.id+'" '+(a.claimedBy?'disabled':'')+'>I’m responding</button><button class="text-button" data-resolve="'+a.id+'">Resolved</button></div></div></div>').join('')||'<p class="empty-note">Nothing needs attention right now. No alerts is not a guarantee that someone is safe.</p>';
 $('#tasks').innerHTML=view.tasks.slice(0,12).map(t=>'<div class="row"><div class="content"><b>'+esc(t.title)+'</b><small>'+esc(t.doneAt?'Completed':t.assignedTo?'Claimed by '+(view.members.find(m=>m.id===t.assignedTo)?.name||'a member'):'Unclaimed · '+t.createdBy)+'</small></div>'+(!t.doneAt?'<button class="secondary" data-task="'+t.id+'" data-mode="'+(t.assignedTo?'done':'claim')+'" '+(t.assignedTo&&t.assignedTo!==me.user.id&&!owner()?'disabled':'')+'>'+(t.assignedTo?'Complete':'I’ll help')+'</button>':'')+'</div>').join('')||'<p class="empty-note">Share errands and visits so nobody has to do it all.</p>';
 $('#messages').innerHTML=view.messages.slice(0,4).map(m=>'<div class="row"><div class="content"><b>'+esc(m.from)+'</b><p>'+esc(m.message)+'</p><small>'+time(m.at)+' · '+esc(m.deliveredAt?m.delivery:'Queued for Buddy')+'</small></div></div>').join('');
 $('#audit').innerHTML=view.audit.slice(0,6).map(a=>'<div class="row"><div class="content"><b>'+esc(a.actor)+'</b> <small>'+esc(a.action)+'</small></div><small>'+time(a.at)+'</small></div>').join('')||'<p class="empty-note">Changes and care-circle activity will appear here.</p>';
 $('#people').innerHTML=view.members.map(m=>'<article class="card person-card"><div class="avatar">'+esc(m.name[0])+'</div><h3>'+esc(m.name)+'</h3><p>'+(m.id===view.ownerId?'Buddy user':'Supervisor')+' · '+(m.online?'App online':'App not currently open')+'</p>'+(m.id!==me.user.id?callButtons(m.id):'<span class="pill">That’s you</span>')+(owner()&&m.id!==view.ownerId?'<div class="permissions">'+['canEdit','canCall','canCamera'].map((p,i)=>'<label class="check"><input type="checkbox" data-permission="'+p+'" data-member="'+m.id+'" '+(m[p]?'checked':'')+'>'+['Edit settings','Audio & video calls','Request camera check-ins'][i]+'</label>').join('')+'<button class="text-button" data-remove="'+m.id+'">Remove from circle</button></div>':'')+'</article>').join('');
 $('#inviteSection').hidden=!owner();$('#pairSection').hidden=!owner();$('#cameraPrivacy').hidden=!owner();$('#cameraEnabled').checked=view.privacy.cameraRequests;
 $('#devices').innerHTML=view.devices.map(d=>'<article class="card person-card"><div class="avatar">▣</div><h3>'+esc(d.name)+'</h3><p>'+(d.online?'Online':'Offline')+' · Paired ESP32</p><p>Last contact: '+(d.lastSeen?esc(time(d.lastSeen)):'never')+'</p><p>Saved revision <b>'+view.revision+'</b> · Device revision <b>'+d.appliedRevision+'</b></p><span class="pill '+(d.appliedRevision<view.revision?'warning':'')+'">'+(d.appliedRevision<view.revision?'Waiting for Buddy to apply changes':d.online?'Settings delivered':'Last saved version delivered before disconnect')+'</span><p>'+esc(d.syncError||(!d.capabilities.camera?'Camera adapter not ready yet.':''))+'</p>'+(!owner()?callButtons(d.id,d):'')+'</article>').join('')||'<div class="card"><h3>No hardware paired yet</h3><p>Connect Buddy to Wi-Fi, then enter its 8-digit TFT code below. The cloud will carry changes even if Buddy is elsewhere.</p></div>';
 $('#deviceSettings').hidden=!view.permissions.canEdit;
 const settingsForm=$('#deviceSettingsForm'),settingsKey=view.id+':'+view.revision;
 if(settingsForm.dataset.settingsKey!==settingsKey){settingsForm.elements.namedItem('eyeColor').value=String(view.settings.display.eyeColor);settingsForm.elements.namedItem('orientation').value=view.settings.display.orientation;settingsForm.dataset.settingsKey=settingsKey;}
 renderHardware(view,owner());
 selectTab(tab,false);const peer=me.user.id;callUI.update(view.calls,peer,view.id);
 if(tab==='chat'&&$('#chatLog').dataset.circle!==view.id)renderChat();
 }catch(e){$('#connection').textContent='Server connection lost';$('#connection').classList.add('warning');callUI.stop();}finally{polling=false;}}
function callButtons(id,device){const disabled=!view.permissions.canCall||(device&&!device.online);return '<div class="button-row"><button class="secondary" data-call="'+id+'" data-kind="audio" '+(disabled?'disabled':'')+'>Audio call</button><button class="secondary" data-call="'+id+'" data-kind="video" '+(disabled||device&&!device.capabilities.camera?'disabled':'')+'>Video call</button>'+(device?'<button class="text-button" data-call="'+id+'" data-kind="camera" '+(disabled||!view.permissions.canCamera||!view.privacy.cameraRequests||!device.capabilities.camera?'disabled':'')+'>Request camera check-in</button>':'')+'</div>';}
function selectTab(next,fetchNow=true){if(tab!==next&&callUI.connected){toast('End the current call before changing views.');return;}tab=next;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=true);if(!view)return;const editor=['calendar','prescription','settings'].includes(tab);$('#'+(editor?'editor':tab)+'Panel').hidden=false;if(editor){const key=view.id+':'+tab+':'+editorPage+':'+view.permissions.canEdit;if(key!==editorKey){$('#editor').src='/settings?circle='+view.id+(view.permissions.canEdit?'':'&readOnly=1')+'#'+(tab==='settings'?editorPage:tab);editorKey=key;}$('#editorNav').hidden=tab!=='settings';$('#editorNote').textContent=view.permissions.canEdit?'Changes save to your circle. My Buddy shows delivery status.':'View-only access. Ask the user for editing permission before making changes.';}if(tab==='chat'&&fetchNow)renderChat();if(fetchNow)refresh();}
$('#authForm').onsubmit=async e=>{e.preventDefault();const action=e.submitter?.value==='login'?'login':'register';const buttons=[$('#authSubmit'),$('#loginSubmit')];buttons.forEach(button=>button.disabled=true);try{const b=Object.fromEntries(new FormData(e.currentTarget));const result=await request('/auth/'+action,b);token=result.token;sessionStorage.setItem('buddy.session',token);e.target.reset();await boot();}catch(error){toast(error.message);}finally{buttons.forEach(button=>button.disabled=false);}};
$('#logout').onclick=async()=>{callUI.stop();chatSessions.clear();try{await request('/auth/logout',{});}catch{}sessionStorage.clear();location.reload();};
$('#circleSelect').onchange=()=>{callUI.stop();view=null;calendarAt=0;editorKey='';refresh();};
for(const form of ['#joinForm','#extraJoinForm'])$(form).onsubmit=async e=>{e.preventDefault();try{const result=await request('/join',Object.fromEntries(new FormData(e.target)));sessionStorage.setItem('buddy.circle',result.circle.id);await boot();}catch(error){toast(error.message);}};
function formAction(selector,path,transform=b=>b){$(selector).onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await request(circlePath()+path,transform(Object.fromEntries(new FormData(e.target))));e.target.reset();await refresh();}catch(error){toast(error.message);}finally{button.disabled=false;}};}
formAction('#taskForm','/tasks');formAction('#messageForm','/messages');formAction('#pairForm','/devices/claim');
$('#deviceSettingsForm').onsubmit=async e=>{
 e.preventDefault();if(!view?.permissions.canEdit)return;
 const button=e.currentTarget.querySelector('button');button.disabled=true;
 try{
  const fields=new FormData(e.currentTarget),updated=structuredClone(view.settings);
  updated.display.eyeColor=Number(fields.get('eyeColor'));
  updated.display.orientation=String(fields.get('orientation'));
  updated._revision=view.revision;
  await request(circlePath()+'/bridge/api/settings',updated,'PUT');
  await refresh();
  const hardware=view.devices;
  toast(!hardware.length?'Saved to your care circle. Pair the ESP32 to apply it there.':hardware.some(d=>d.online)?'Saved. Watch the ESP32 device revision until it matches the saved revision.':'Saved to the circle. Buddy will apply it when it reconnects.');
 }catch(error){toast('Could not save Buddy settings: '+error.message);await refresh();}
 finally{button.disabled=false;}
};
$('#inviteForm').onsubmit=async e=>{e.preventDefault();try{const result=await request(circlePath()+'/invite',{canEdit:e.target.canEdit.checked,canCamera:e.target.canCamera.checked});$('#inviteCode').textContent=result.code;}catch(error){toast(error.message);}};
$('#cameraEnabled').onchange=async e=>{try{await request(circlePath()+'/privacy',{cameraRequests:e.target.checked},'PUT');await refresh();}catch(error){toast(error.message);}};
$('#chatForm').onsubmit=e=>{e.preventDefault();const message=$('#chatMessage').value;$('#chatMessage').value='';sendChat(message);};
$('#chatMessage').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chatForm').requestSubmit();}};
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
 if(b.dataset.buddyAction){
   const action=b.dataset.buddyAction;
   if(action==='acknowledge'&&!confirm('Record the user’s confirmation for the active reminder? This does not verify a medicine dose.'))return;
   if(action==='check_in')await request(circlePath()+'/checkins',{minutes:15});
   else await request(circlePath()+'/bridge/api/actions',{action,reminderId:view.devices[0]?.status?.activeReminderId||''});
   toast('Queued for Buddy. Delivery results appear in My Buddy.');await refresh();return;
 }
 if(b.dataset.unpair){if(!confirm('Unpair this Buddy? It will stop using this circle and show a new pairing code.'))return;await request(circlePath()+'/devices/unpair',{deviceId:b.dataset.unpair});await refresh();return;}
 if(b.dataset.tab||b.dataset.open){selectTab(b.dataset.tab||b.dataset.open);return;}
 if(b.dataset.chatSuggestion){await sendChat(b.dataset.chatSuggestion);return;}
 if(b.dataset.editor){editorPage=b.dataset.editor;selectTab('settings');return;}
 if(b.dataset.check){await request(circlePath()+'/checkins',b.dataset.check==='request'?{minutes:15}:{answer:b.dataset.check});toast(b.dataset.check==='request'?'Buddy will ask for a check-in. The circle gets an alert if there’s no reply in 15 minutes.':'Your check-in is shared with your circle.');}
 if(b.dataset.claim||b.dataset.resolve)await request(circlePath()+'/alerts',{id:b.dataset.claim||b.dataset.resolve,resolve:!!b.dataset.resolve});
 if(b.dataset.task)await request(circlePath()+'/tasks',{id:b.dataset.task,[b.dataset.mode]:true});
 if(b.dataset.remove){if(!confirm('Remove this supervisor’s access to your circle?'))return;await request(circlePath()+'/members',{userId:b.dataset.remove,remove:true});}
 if(b.dataset.call)await request(circlePath()+'/calls',{to:b.dataset.call,kind:b.dataset.kind});
 if(Object.keys(b.dataset).length)await refresh();
 }catch(error){toast(error.message);}});
document.addEventListener('change',async e=>{if(!e.target.dataset.permission)return;try{await request(circlePath()+'/members',{userId:e.target.dataset.member,[e.target.dataset.permission]:e.target.checked});await refresh();}catch(error){toast(error.message);}});
window.addEventListener('pagehide',()=>callUI.stop());
await boot();setInterval(refresh,2500);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
