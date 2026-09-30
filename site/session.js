export const circleId = new URLSearchParams(location.search).get('circle') || sessionStorage.getItem('buddy.circle') || '';
export const inHub = !!circleId;
export const bridgeBase = inHub ? location.origin+'/api/v2/circles/'+encodeURIComponent(circleId)+'/bridge' : location.origin;
export const settingsCache = inHub ? sessionStorage : localStorage;
export const cacheKey = inHub ? 'buddy.settings.'+circleId : 'buddy.lastSettings';
export async function requireCircle(){
  if(inHub)return true;
  try{const r=await fetch('/api/health');if(r.status===401){location.replace('/');return false;}}catch{}
  return true; // Preserve the explicitly enabled standalone legacy test mode.
}
export function authFetch(input, options={}) {
  let url=new URL(input,location.origin);
  const headers=new Headers(options.headers);
  if(inHub){
    // Never forward a care-circle session to a configurable speech-server URL.
    const index=url.pathname.lastIndexOf('/api/');
    if(index>=0&&!url.pathname.startsWith('/api/v2/'))url=new URL(bridgeBase+url.pathname.slice(index)+url.search);
    if(url.origin!==location.origin)throw new Error('Care-circle requests must use this Buddy server.');
    headers.set('authorization','Bearer '+(sessionStorage.getItem('buddy.session')||''));
  }
  return fetch(url,{...options,headers});
}
