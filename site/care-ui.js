import { authFetch as fetch, settingsCache, cacheKey } from './session.js';
export function initCareUI({state,api,saveSettings,renderCollections,bindSettingsToForm,toast,id}) {
 const $=s=>document.querySelector(s);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:state.settings.device.timezone||'Asia/Kolkata'}).format(new Date());
 let month=today().slice(0,7), selected=today(), calendar=null, journal=[],photo=null,draft=[];
 async function request(path,value){const r=await fetch(state.apiBase+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(150000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;}
 async function loadCalendar(){
  try{
   calendar=await api('/api/calendar?month='+month);
   $('#calendarSource').textContent='Schedule saved on Buddy · '+calendar.source;
   $('#calendarMonth').textContent=new Date(month+'-01T12:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'});
   const start=new Date(month+'-01T12:00:00').getDay();
   $('#calendarGrid').innerHTML='<span class="calendar-blank"></span>'.repeat(start)+calendar.days.map(day=>'<button class="calendar-day '+(day.date===selected?'selected ':'')+(day.date===calendar.today?'today':'')+'" data-date="'+day.date+'" aria-label="'+day.date+', '+day.items.length+' reminders"><b>'+Number(day.date.slice(-2))+'</b><span>'+day.items.slice(0,2).map(r=>'<i class="calendar-pill '+esc(r.kind)+'">'+esc(r.time)+' '+esc(r.title)+'</i>').join('')+(day.items.length>2?'<small>+'+(day.items.length-2)+' more</small>':'')+'</span></button>').join('');
   $('#calendarGrid').querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{selected=button.dataset.date;renderDay();$('#calendarGrid').querySelectorAll('[data-date]').forEach(b=>b.classList.toggle('selected',b.dataset.date===selected));});
   renderDay();
  }catch(error){$('#calendarSource').textContent='Calendar unavailable: '+error.message;}
 }
 function renderDay(){
  $('#selectedDate').textContent=new Date(selected+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'long'});
  const items=calendar?.days.find(d=>d.date===selected)?.items||[];
  $('#dayAgenda').innerHTML=items.map(r=>'<div class="agenda-item"><time>'+esc(r.time)+'</time><div><b>'+esc(r.title)+'</b><p>'+esc(r.detail)+'</p><small class="care-status '+esc(r.status)+'">'+esc(r.status)+'</small></div></div>').join('')||'<p class="empty">Nothing scheduled. A calm day ahead.</p>';
 }
 const shift=n=>{const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+n);month=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');selected=month+'-01';loadCalendar();};
 $('#previousMonth').onclick=()=>shift(-1);$('#nextMonth').onclick=()=>shift(1);$('#currentMonth').onclick=()=>{month=today().slice(0,7);selected=today();loadCalendar();};
 $('#newCalendarItem').onclick=()=>{$('#calendarEditor').hidden=false;$('#calendarStart').value=selected;$('#calendarEnd').value=selected;$('#calendarTitle').focus();};
 $('#cancelCalendarItem').onclick=()=>$('#calendarEditor').hidden=true;
 $('#calendarEditor').onsubmit=async event=>{
  event.preventDefault();const start=$('#calendarStart').value,end=$('#calendarEnd').value,repeat=$('#calendarRepeat').value;
  if(end<start)return toast('End date must be on or after the start date.',true);
  state.settings.reminders.push({id:id('calendar'),title:$('#calendarTitle').value.trim(),detail:$('#calendarDetail').value.trim(),time:$('#calendarTime').value,kind:$('#calendarKind').value,startDate:start,endDate:repeat==='once'?start:end,days:repeat==='weekly'?[new Date(start+'T12:00:00').getDay()]:[0,1,2,3,4,5,6],enabled:true,snoozeMinutes:10});state.dirty=true;
  await saveSettings();if(state.dirty)return;
  $('#calendarEditor').hidden=true;$('#calendarEditor').reset();renderCollections();await loadCalendar();
 };
 $('#timezoneChoice').onchange=async()=>{
  const zones={'Asia/Kolkata':'IST-5:30','UTC':'UTC0','Europe/London':'GMT0BST,M3.5.0/1,M10.5.0','America/New_York':'EST5EDT,M3.2.0,M11.1.0'};
  state.settings.device.timezone=$('#timezoneChoice').value;state.settings.device.timezonePosix=zones[$('#timezoneChoice').value];state.dirty=true;await saveSettings();month=today().slice(0,7);selected=today();loadCalendar();
 };
 $('#prescriptionPhoto').onchange=async()=>{
  const file=$('#prescriptionPhoto').files[0];if(!file)return;
  if(!['image/jpeg','image/png'].includes(file.type)||file.size>12*1024*1024){toast('Choose a JPEG or PNG under 12 MB.',true);return;}
  const url=URL.createObjectURL(file), image=new Image();
  try{
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
   const scale=Math.min(1,1800/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   photo=canvas.toDataURL('image/jpeg',.9);$('#prescriptionPreview').src=photo;$('#prescriptionPreview').hidden=false;$('#scanStatus').textContent='Photo ready. Review the original alongside the result.';
  }catch{toast('Could not load this photo.',true);}finally{URL.revokeObjectURL(url);}
 };
 async function scan(value){
  $('#scanPrescription').disabled=true;$('#parsePrescription').disabled=true;$('#scanStatus').textContent='Reading locally and preparing review…';
  try{const result=await request('/api/prescription/scan',value);$('#prescriptionText').value=result.text;draft=result.items;renderDraft();$('#scanStatus').textContent=draft.length+' possible medicine lines. Check every item before saving.';}
  catch(e){$('#scanStatus').textContent=e.message;}
  finally{$('#scanPrescription').disabled=false;$('#parsePrescription').disabled=false;}
 }
 $('#scanPrescription').onclick=()=>photo?scan({image:photo}):toast('Choose a photo first.',true);
 $('#parsePrescription').onclick=()=>scan({text:$('#prescriptionText').value});
 function renderDraft(){
  $('#prescriptionReview').hidden=false;
  $('#prescriptionItems').innerHTML=draft.map((item,i)=>'<article class="rx-item"><label><span>Medicine / reminder title</span><input data-rx="title" data-index="'+i+'" value="'+esc(item.title)+'" /></label><label><span>Exact instructions (check dose)</span><input data-rx="detail" data-index="'+i+'" value="'+esc(item.detail)+'" /></label><div class="form-grid"><label><span>Times · comma separated</span><input data-rx="times" data-index="'+i+'" value="'+esc(item.times.join(', '))+'" placeholder="09:00, 20:00" /></label><label><span>Start date</span><input type="date" data-rx="startDate" data-index="'+i+'" value="'+esc(item.startDate)+'" /></label><label><span>Confirmed course end</span><input type="date" data-rx="endDate" data-index="'+i+'" value="'+esc(item.endDate)+'" /></label></div><label class="review-check"><input type="checkbox" data-rx="confirmed" data-index="'+i+'" /> I checked this item against the prescription and want to add it.</label></article>').join('')||'<p>No medicine lines found. Correct the text above or add it in Calendar.</p>';
  $('#prescriptionItems').querySelectorAll('[data-rx]').forEach(input=>input.oninput=()=>{const item=draft[Number(input.dataset.index)],field=input.dataset.rx;item[field]=field==='times'?input.value.split(',').map(t=>t.trim()).filter(Boolean):field==='confirmed'?input.checked:input.value;});
 }
 $('#importPrescription').onclick=async()=>{
  const selectedItems=draft.filter(item=>item.confirmed);
  if(!selectedItems.length)return toast('Review and tick the items you want to add.',true);
  $('#importPrescription').disabled=true;
  try{
   if(!state.connected)throw new Error('Connect to Buddy before importing a prescription.');
   await saveSettings();if(state.dirty)throw new Error('Save your other settings before importing.');
   const result=await request('/api/prescription/review',{items:selectedItems});
   const previous=state.settings.reminders.slice();
   state.settings.reminders.push(...result.reminders);state.dirty=true;
   await saveSettings();
   if(state.dirty){state.settings.reminders=previous;throw new Error('Prescription was not saved. Check the connection and retry.');}
   bindSettingsToForm();renderCollections();settingsCache.setItem(cacheKey,JSON.stringify(state.settings));
   draft=[];$('#prescriptionReview').hidden=true;photo=null;$('#prescriptionPreview').removeAttribute('src');$('#prescriptionPreview').hidden=true;$('#prescriptionPhoto').value='';$('#prescriptionText').value='';
   toast(result.reminders.length+' reminder times added to Buddy.');month=selectedItems[0].startDate.slice(0,7);selected=selectedItems[0].startDate;await loadCalendar();location.hash='calendar';
  }catch(e){toast(e.message,true);}finally{$('#importPrescription').disabled=false;}
 };
 const routines={
 hydration:{title:'Water check-in',detail:'Have you had some water? Follow any fluid guidance from your clinician.',time:'11:00',kind:'hydration'},
 movement:{title:'A little movement',detail:'If it is comfortable and safe for you, take a gentle movement break.',time:'16:00',kind:'activity'},
 connection:{title:'Stay connected',detail:'Would you like to call someone in your care circle?',time:'18:00',kind:'activity'},
 wellbeing:{title:'Evening check-in',detail:'How are you feeling? Use your wake phrase and say I feel good, I feel okay, I feel lonely or I feel unwell.',time:'19:00',kind:'wellbeing'}
 };
 document.querySelectorAll('[data-routine]').forEach(button=>button.onclick=async()=>{
  const kind=button.dataset.routine;if(state.settings.reminders.some(r=>r.routine===kind))return toast('This routine is already in the calendar.');
  state.settings.reminders.push({...routines[kind],id:id('routine'),routine:kind,days:[0,1,2,3,4,5,6],startDate:today(),endDate:'',enabled:true,snoozeMinutes:10});state.dirty=true;await saveSettings();renderCollections();loadCalendar();
 });
 async function loadJournal(){
  try{journal=(await api('/api/journal')).events;const daily=journal.filter(e=>e.date===today());
   const done=daily.filter(e=>e.type==='reminder_acknowledged').length,water=daily.filter(e=>e.type==='hydration').length,mood=daily.filter(e=>e.type==='check_in').at(-1);
   $('#careMetrics').innerHTML=[['Confirmations today',done],['Water check-ins',water],['Latest wellbeing',mood?.reminderId||'Not recorded']].map(([label,value])=>'<article class="card care-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></article>').join('');
   $('#careJournal').innerHTML=journal.slice(-60).reverse().map(e=>'<div class="journal-row"><time>'+esc(new Date(e.at).toLocaleString())+'</time><div><b>'+esc(e.message)+'</b><small>'+esc(e.type.replaceAll('_',' '))+'</small></div></div>').join('')||'<p class="empty">Voice confirmations and check-ins will appear here.</p>';
  }catch{$('#careJournal').textContent='Care history needs the companion server connection.';}
 }
 $('#exportJournal').onclick=()=>{const blob=new Blob([JSON.stringify(journal,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='buddy-care-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function refresh(){ $('#timezoneChoice').value=state.settings.device.timezone||'Asia/Kolkata';if(location.hash==='#calendar')loadCalendar();if(location.hash==='#wellbeing')loadJournal(); }
 window.addEventListener('hashchange',refresh);setInterval(refresh,15000);
 return {refresh,loadCalendar,loadJournal};
}
