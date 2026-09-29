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
    input,textarea{border:1px solid #aebfb5}textarea{min-height:100px;resize:vertical}
    button{border:0;background:#195e4d;color:#fff;font-weight:700;margin-top:16px;cursor:pointer}
    button:disabled{opacity:.55;cursor:wait}output{display:block;margin-top:18px;padding:14px;background:#edf4ed;border-radius:10px;min-height:52px;white-space:pre-wrap;overflow-wrap:anywhere}
    small{color:#60786e}a{color:#195e4d}
  </style>
</head>
<body><main>
  <h1>Buddy remote-control test</h1>
  <p>Send one short line of text to Buddy from anywhere with internet access. This test does not use the Care Hub.</p>
  <label for="token">Admin token</label>
  <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your private ADMIN_TOKEN">
  <small>Kept only in this browser tab. Never put it in GitHub or send it to someone else.</small>
  <form id="form">
    <label for="message">Text to show on Buddy's TFT</label>
    <textarea id="message" maxlength="120" required placeholder="Hello from another Wi-Fi network"></textarea>
    <button id="send">Send to Buddy</button>
  </form>
  <output id="status">Enter the admin token to see the latest status.</output>
</main>
<script>
  const token=document.querySelector('#token'),form=document.querySelector('#form'),status=document.querySelector('#status'),message=document.querySelector('#message');
  token.value=sessionStorage.getItem('buddyRemoteAdmin')||'';
  token.addEventListener('input',()=>{sessionStorage.setItem('buddyRemoteAdmin',token.value);refresh();});
  async function call(path,options={}){
    const response=await fetch(path,{...options,headers:{'Authorization':'Bearer '+token.value,'Content-Type':'application/json'}});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
  }
  async function refresh(){
    if(!token.value){status.textContent='Enter the admin token to see the latest status.';return;}
    try{
      const data=await call('/api/status');
      status.textContent='Latest revision: '+data.revision+'\\nBuddy confirmed revision: '+data.ackRevision+'\\nLatest text: '+(data.displayText||'(none yet)')+'\\nLast device confirmation: '+(data.ackAt||'not yet');
    }catch(error){status.textContent=error.message;}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=document.querySelector('#send');button.disabled=true;
    try{const data=await call('/api/message',{method:'POST',body:JSON.stringify({text:message.value})});status.textContent='Saved revision '+data.revision+'. Waiting for Buddy to poll...';await refresh();}
    catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  refresh();setInterval(refresh,5000);
</script></body></html>`;
