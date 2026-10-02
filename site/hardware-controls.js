const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderHardware(view,isOwner){
  let panel=document.querySelector('#hardwareTools');
  if(!panel){panel=document.createElement('section');panel.id='hardwareTools';panel.className='card';document.querySelector('#devices').after(panel);}
  const buddy=view.devices[0],status=buddy?.status||{};
  if(!buddy){panel.hidden=true;return;}panel.hidden=false;
  const disabled=!view.permissions.canEdit?'disabled':'';
  const reminder=status.activeReminderId;
  panel.innerHTML=`<h2>Try it on the real Buddy</h2><p>These actions go through Cloudflare to the ESP. The device reports the result; a queued action is not proof of delivery.</p>
    <div class="button-row"><button class="secondary" data-buddy-action="ping" ${disabled}>Find / test Buddy</button><button class="secondary" data-buddy-action="agenda" ${disabled}>Read today’s schedule</button><button class="secondary" data-buddy-action="check_in" ${disabled}>Ask for a check-in</button></div>
    <p>${reminder?'Active reminder: '+esc(view.settings.reminders.find(r=>r.id===reminder)?.title||reminder):'No active reminder reported.'}</p>
    <div class="button-row"><button class="secondary" data-buddy-action="acknowledge" ${disabled||(!reminder?'disabled':'')}>Record confirmation</button><button class="secondary" data-buddy-action="snooze" ${disabled||(!reminder?'disabled':'')}>Snooze reminder</button><button class="secondary" data-buddy-action="hydration" ${disabled}>Log water check-in</button></div>
    <p class="fine">Wake phrase: Hi ESP · ${status.wakeReady?'offline detector ready':'detector not yet reported ready'} · Microphone ${status.microphoneEnabled===false?'off':'on'} · Clock ${status.clockValid?'set':'not confirmed'} · Firmware ${esc(status.firmwareVersion||'not reported')} · Free memory ${status.freeMemory?Math.round(status.freeMemory/1024)+' KiB':'not reported'}</p>
    ${buddy.results?.length?'<p class="fine">Latest device result: '+esc(buddy.results.at(-1).result)+'</p>':''}
    <p class="fine">A confirmation is a user report, not proof that medicine was taken. Help alerts require someone in the circle to have the app open.</p>
    ${isOwner?'<div class="button-row"><button class="secondary" data-call="'+esc(buddy.id)+'" data-kind="audio" '+(!buddy.online||!buddy.capabilities.audio?'disabled':'')+'>Audio call Buddy</button><button class="secondary" data-call="'+esc(buddy.id)+'" data-kind="video" '+(!buddy.online||!buddy.capabilities.audio||!buddy.capabilities.camera?'disabled':'')+'>Video call Buddy</button><button class="text-button" data-unpair="'+esc(buddy.id)+'">Unpair for a new account</button></div>':''}`;
}
