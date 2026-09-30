// Browser-to-browser uses WebRTC. The ESP32-compatible relay exchanges small
// JPEG frames and 16 kHz mono PCM, without storing media on disk.
export class BuddyCalls {
 constructor({request,toast,refresh}){Object.assign(this,{request,toast,refresh});this.$=s=>document.querySelector(s);this.busy=false;this.generation=0;
  this.$('#answerCall').onclick=()=>this.answer();this.$('#connectMedia').onclick=()=>this.connect();this.$('#endCall').onclick=()=>this.end();
  this.$('#muteCall').onclick=()=>{this.muted=!this.muted;for(const t of this.stream?.getAudioTracks()||[])t.enabled=!this.muted;this.$('#muteCall').textContent=this.muted?'Unmute microphone':'Mute microphone';};
 }
 update(calls,peer,circle){
  const next=calls.find(c=>['ringing','accepted'].includes(c.status)&&(c.from===peer||c.to===peer));
  if(!next){if(this.call){this.stop();this.call=null;}this.$('#callPanel').hidden=true;return;}
  if(this.call?.id!==next.id){this.stop();this.autoConnectFor=null;}this.call=next;this.peer=peer;this.circle=circle;this.isDevice=peer.startsWith('device_');
  this.$('#callPanel').hidden=false;this.$('#callKind').textContent=(next.kind==='camera'?'CAMERA CHECK-IN':next.kind.toUpperCase()+' CALL')+(this.isDevice?' · ON BUDDY':'');
  this.$('#callTitle').textContent=next.from===peer?next.toName:next.fromName;
  this.$('#callState').textContent=next.status==='accepted'?'Connected · '+Math.max(0,Math.ceil((next.expiresAt-Date.now())/1000))+'s left':'Ringing';
  this.$('#callNotice').textContent=next.kind==='camera'?'Visible, microphone-free, and limited to two minutes. End it whenever you like.':next.transport==='buddy-media'?'Live Buddy link · low-frame-rate video and audio relay.':'Private app-to-app call. Both participants choose when to connect media.';
  this.$('#answerCall').hidden=next.status!=='ringing'||next.to!==peer;
  this.$('#connectMedia').hidden=next.status!=='accepted'||!!this.connected||this.busy;
  this.$('#endCall').textContent=next.status==='ringing'?(next.to===peer?'Decline':'Cancel call'):'End call';
  // The caregiver already clicked Video call Buddy. Once the physical Buddy
  // answers, start browser media automatically; Connect remains as a fallback
  // if the browser requires a fresh gesture for camera/microphone permission.
  if(next.transport==='buddy-media'&&next.status==='accepted'&&next.from===peer&&
     !this.connected&&!this.busy&&this.autoConnectFor!==next.id){
   this.autoConnectFor=next.id;queueMicrotask(()=>{if(this.call?.id===next.id)this.connect();});
  }
 }
 async control(operation,body={}){if(this.isDevice)return this.request('/circles/'+this.circle+'/device-call/answer',{callId:this.call.id,...body,...(operation==='end'?{end:true}:{})});return this.request('/calls/'+this.call.id+'/'+operation,body);}
 async answer(){try{await this.control('accept');await this.refresh();await this.connect();}catch(e){this.toast(e.message);}}
 async end(){try{await this.control('end',{decline:this.call.status==='ringing'&&this.call.to===this.peer});}catch(e){this.toast(e.message);}finally{this.stop();await this.refresh();}}
 async connect(){
  if(this.busy||this.connected||this.call?.status!=='accepted')return;this.busy=true;const generation=this.generation,call=this.call;
  try{
   const cameraOnly=call.kind==='camera',wantVideo=call.kind==='video'||(cameraOnly&&this.isDevice),wantAudio=!cameraOnly;
   if((wantAudio||wantVideo)&&!navigator.mediaDevices?.getUserMedia)throw new Error('Camera and microphone require HTTPS or localhost.');
   let stream=(wantAudio||wantVideo)?await navigator.mediaDevices.getUserMedia({audio:wantAudio?{channelCount:1,echoCancellation:true,noiseSuppression:true}:false,video:wantVideo?{width:{ideal:320},height:{ideal:240},frameRate:{ideal:10,max:15}}:false}):new MediaStream();
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;this.muted=false;
   const local=this.$('#localVideo');local.srcObject=stream;local.hidden=!wantVideo;if(wantVideo)await local.play();
   this.$('#remoteVideo').hidden=call.transport!=='webrtc'||call.kind==='audio';this.$('#remoteFrame').hidden=call.transport!=='buddy-media'||call.kind==='audio'||(cameraOnly&&this.isDevice);
   if(call.transport==='webrtc')await this.rtc(call,generation);else await this.relay(call,generation,wantAudio,wantVideo);
   if(generation!==this.generation)return;this.connected=true;
   this.$('#connectMedia').hidden=true;this.$('#muteCall').hidden=!wantAudio;
   this.$('#mediaStatus').textContent=wantVideo?'● CAMERA ON · Live, not recorded.':cameraOnly?'Viewing Buddy’s camera. Your camera and microphone are off.':'Media connected. No camera is open on this side.';
  }catch(e){this.stop();this.toast(e.message);this.$('#mediaStatus').textContent=e.message;}finally{this.busy=false;}
 }
 async rtc(call,generation){
  this.pc=new RTCPeerConnection({iceServers:this.iceServers||[]});const pc=this.pc;
  this.stream.getTracks().forEach(track=>pc.addTrack(track,this.stream));
  pc.ontrack=e=>{const el=this.$(call.kind==='audio'?'#remoteAudio':'#remoteVideo');el.srcObject=e.streams[0];el.play().catch(()=>this.toast('Tap Connect to enable call audio.'));};
  const signal=(type,data)=>this.request('/calls/'+call.id+'/signal',{type,data});
  pc.onicecandidate=e=>{if(e.candidate)signal('candidate',e.candidate.toJSON()).catch(()=>{});};
  pc.onconnectionstatechange=()=>{if(generation!==this.generation)return;this.$('#mediaStatus').textContent='Call connection: '+pc.connectionState+(pc.connectionState==='failed'?'. Across different networks, configure a TURN server.':'');};
  let after=0,candidates=[];
  if(call.from===this.peer){await pc.setLocalDescription(await pc.createOffer());await signal('offer',pc.localDescription.toJSON());}
  const poll=async()=>{if(generation!==this.generation)return;
   try{const result=await this.request('/calls/'+call.id+'/signal?after='+after);
    for(const s of result.signals){after=s.seq;
     if(s.type==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(s.data);else candidates.push(s.data);}
     else{await pc.setRemoteDescription(s.data);for(const c of candidates)await pc.addIceCandidate(c);candidates=[];if(s.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());await signal('answer',pc.localDescription.toJSON());}}
    }
   }catch(e){if(generation===this.generation)this.$('#mediaStatus').textContent=e.message;}
   if(generation===this.generation)this.timer=setTimeout(poll,500);
  };poll();
 }
 async relay(call,generation,audio,video){
  this.chunks=[];this.after=0;this.frameAfter=0;this.nextPlay=0;this.lastFrame=0;
  if(audio){this.context=new AudioContext();await this.context.resume();this.source=this.context.createMediaStreamSource(this.stream);this.processor=this.context.createScriptProcessor(4096,1,1);this.silence=this.context.createGain();this.silence.gain.value=0;this.source.connect(this.processor);this.processor.connect(this.silence);this.silence.connect(this.context.destination);
   this.processor.onaudioprocess=e=>{if(this.muted)return;const input=e.inputBuffer.getChannelData(0),ratio=this.context.sampleRate/16000,buffer=new ArrayBuffer(Math.floor(input.length/ratio)*2),view=new DataView(buffer);for(let i=0;i<buffer.byteLength/2;i++){const start=Math.floor(i*ratio),end=Math.min(input.length,Math.floor((i+1)*ratio));let sum=0;for(let j=start;j<end;j++)sum+=input[j];view.setInt16(i*2,Math.max(-1,Math.min(1,sum/Math.max(1,end-start)))*32767,true);}this.chunks.push(new Uint8Array(buffer));if(this.chunks.length>8)this.chunks.shift();};
  }
  this.captureCanvas=document.createElement('canvas');this.captureCanvas.width=320;this.captureCanvas.height=240;
  const exchange=async()=>{if(generation!==this.generation)return;
   if(Date.now()>call.expiresAt){this.stop();return;}
   try{
    const body={callId:call.id,after:this.after,frameAfter:this.frameAfter};
    if(this.chunks.length){const chunks=this.chunks.splice(0,3);let binary='';for(const chunk of chunks)binary+=String.fromCharCode(...chunk);body.audio=btoa(binary);}
    if(video&&Date.now()-this.lastFrame>600&&this.$('#localVideo').readyState>=2){this.captureCanvas.getContext('2d').drawImage(this.$('#localVideo'),0,0,320,240);body.jpeg=this.captureCanvas.toDataURL('image/jpeg',.55).split(',')[1];this.lastFrame=Date.now();}
    const result=await this.request(this.isDevice?'/circles/'+this.circle+'/device-call/media':'/calls/'+call.id+'/media',body);
    if(generation!==this.generation)return;
    if(result.jpeg){this.$('#remoteFrame').src='data:image/jpeg;base64,'+result.jpeg;this.frameAfter=result.frameSeq;}
    for(const chunk of result.audio){this.after=chunk.seq;if(!this.context)continue;const bytes=Uint8Array.from(atob(chunk.audio),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),out=this.context.createBuffer(1,bytes.length/2,16000),samples=out.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
     const source=this.context.createBufferSource();source.buffer=out;source.connect(this.context.destination);this.nextPlay=Math.max(this.context.currentTime+.025,Math.min(this.nextPlay,this.context.currentTime+.6));source.start(this.nextPlay);this.nextPlay+=out.duration;
    }
   }catch(e){if(generation===this.generation){this.$('#mediaStatus').textContent=e.message;this.stop();return;}}
   if(generation===this.generation)this.timer=setTimeout(exchange,100);
  };exchange();
 }
 stop(){this.generation++;clearTimeout(this.timer);this.pc?.close();this.pc=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.processor?.disconnect();this.source?.disconnect();this.context?.close().catch(()=>{});this.context=null;this.connected=false;this.$('#muteCall').hidden=true;for(const id of ['#remoteVideo','#remoteAudio','#localVideo']){this.$(id).srcObject=null;this.$(id).hidden=true;}this.$('#remoteFrame').removeAttribute('src');this.$('#remoteFrame').hidden=true;}
}
