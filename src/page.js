export const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Buddy remote-control test</title>
  <style>
    :root{font-family:system-ui,-apple-system,sans-serif;color:#153a34;background:#f2f6f2}
    *{box-sizing:border-box}body{max-width:660px;margin:0 auto;padding:24px}
    main{background:#fff;border:1px solid #dce8dd;border-radius:18px;padding:28px;box-shadow:0 8px 36px #173c3420}
    h1{margin:0 0 8px;font-size:2rem}p{line-height:1.5;color:#557269}
    label{display:block;font-weight:650;margin:20px 0 8px}
    input,textarea,button{font:inherit;border-radius:10px;padding:12px;width:100%}
    input,textarea{border:1px solid #aebfb5}input{font-size:1.5rem;letter-spacing:.2em;text-align:center}
    textarea{min-height:100px;resize:vertical}
    button{border:0;background:#195e4d;color:#fff;font-weight:700;margin-top:16px;cursor:pointer}
    button:disabled{opacity:.55;cursor:wait}
    output{display:block;margin-top:18px;padding:14px;background:#edf4ed;border-radius:10px;min-height:52px;white-space:pre-wrap;overflow-wrap:anywhere}
    small{color:#60786e}a{color:#195e4d}[hidden]{display:none!important}
  </style>
</head>
<body><main>
  <h1>Buddy remote-control test</h1>
  <p>Send one short line of text to Buddy through the Cloudflare backend. The laptop and Buddy may use different Wi-Fi networks.</p>
  <section id="link-panel">
    <form id="link-form">
      <label for="code">8-digit code on Buddy's TFT</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required placeholder="00000000">
      <button id="link-button">Link Buddy</button>
    </form>
    <small>The code refreshes automatically. You do not need an admin password.</small>
  </section>
  <section id="control-panel" hidden>
    <form id="message-form">
      <label for="message">Text to show on Buddy's TFT</label>
      <textarea id="message" maxlength="120" required placeholder="Hello from another Wi-Fi network"></textarea>
      <button id="send-button">Send to Buddy</button>
    </form>
  </section>
  <output id="status" role="status">Enter the code shown on Buddy to link this tab.</output>
</main>
<script>
  const linkPanel=document.querySelector('#link-panel'),controlPanel=document.querySelector('#control-panel');
  const linkForm=document.querySelector('#link-form'),messageForm=document.querySelector('#message-form');
  const code=document.querySelector('#code'),message=document.querySelector('#message'),status=document.querySelector('#status');
  sessionStorage.removeItem('buddyRemoteAdmin');
  sessionStorage.removeItem('buddyRemotePassword');
  let session=sessionStorage.getItem('buddyRemoteSession')||'';
  function showPanels(){linkPanel.hidden=!!session;controlPanel.hidden=!session;}
  function unlink(){session='';sessionStorage.removeItem('buddyRemoteSession');showPanels();}
  async function call(path,options={},needsSession=true){
    const headers={'Content-Type':'application/json'};
    if(needsSession)headers.Authorization='Bearer '+session;
    const response=await fetch(path,{...options,headers});
    const data=await response.json();
    if(!response.ok){const error=Error(data.error||'Request failed');error.status=response.status;throw error;}
    return data;
  }
  async function refresh(){
    if(!session){status.textContent='Enter the code shown on Buddy to link this tab.';return;}
    try{
      const data=await call('/api/status');
      status.textContent='Linked to Buddy\\nLatest revision: '+data.revision+'\\nBuddy confirmed revision: '+data.ackRevision+'\\nLatest text: '+(data.displayText||'(none yet)')+'\\nLast device confirmation: '+(data.ackAt||'not yet');
    }catch(error){if(error.status===401)unlink();status.textContent=error.message;}
  }
  linkForm.addEventListener('submit',async event=>{
    event.preventDefault();const button=document.querySelector('#link-button');button.disabled=true;
    try{
      const data=await call('/api/pair',{method:'POST',body:JSON.stringify({code:code.value.trim()})},false);
      session=data.token;sessionStorage.setItem('buddyRemoteSession',session);code.value='';showPanels();await refresh();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  messageForm.addEventListener('submit',async event=>{
    event.preventDefault();const button=document.querySelector('#send-button');button.disabled=true;
    try{const data=await call('/api/message',{method:'POST',body:JSON.stringify({text:message.value})});status.textContent='Saved revision '+data.revision+'. Waiting for Buddy to poll...';await refresh();}
    catch(error){if(error.status===401)unlink();status.textContent=error.message;}finally{button.disabled=false;}
  });
  showPanels();refresh();setInterval(()=>{if(session)refresh();},5000);
</script></body></html>`;
