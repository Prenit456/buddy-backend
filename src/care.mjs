import { randomUUID } from 'node:crypto';

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  if(Number(value.slice(0,4))<2024||Number(value.slice(0,4))>2100)return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !isNaN(date) && date.toISOString().slice(0,10) === value;
}
export function validateCareSettings(value) {
  if (!value || typeof value !== 'object' || typeof value.person?.name !== 'string' || !value.person.name.trim()) return 'A preferred name is required';
  if (!Array.isArray(value.contacts) || value.contacts.length > 12) return 'Use no more than 12 contacts';
  if (!Array.isArray(value.reminders) || value.reminders.length > 64) return 'Use no more than 64 scheduled times';
  if (value.device?.callName && !/^[a-zA-Z][a-zA-Z ]{1,23}$/.test(value.device.callName.trim())) return 'Choose a call name with 2–24 letters';
  if (value.display?.orientation && value.display.orientation!=='landscape') return 'The current hardware supports landscape 320 × 240 only';
  const numeric=[['voice','rate',40,120],['voice','volume',0,100],['voice','repeatCount',1,3],['display','eyeColor',0,65535],['safety','sosCountdownSeconds',3,30],['safety','missedReminderMinutes',1,120]];
  for(const [section,key,min,max] of numeric)if(value[section]?.[key]!==undefined&&(!Number.isInteger(value[section][key])||value[section][key]<min||value[section][key]>max))return `Invalid ${key}: use ${min}–${max}`;
  if(value.voice?.voiceId&&!['bella','sarah','brian','daniel'].includes(value.voice.voiceId))return 'Choose one of the supported voices';
  if(value.preferences?.privacyMode&&!['wake-phrase','microphone-off'].includes(value.preferences.privacyMode))return 'Choose hands-free listening or microphone off';
  const zones={'Asia/Kolkata':'IST-5:30','UTC':'UTC0','Europe/London':'GMT0BST,M3.5.0/1,M10.5.0','America/New_York':'EST5EDT,M3.2.0,M11.1.0'};
  if(!zones[value.device?.timezone||'Asia/Kolkata'])return 'Choose one of the hardware-supported time zones';
  if(value.device?.timezonePosix&&value.device.timezonePosix!==zones[value.device.timezone||'Asia/Kolkata'])return 'The app and device timezone must match';
  try { new Intl.DateTimeFormat('en',{timeZone:value.device?.timezone||'Asia/Kolkata'}); } catch { return 'Choose a valid timezone'; }
  if (['quietStart','quietEnd'].some(k=>value.safety?.[k] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.safety[k]))) return 'Set valid quiet-hour times';
  if(value.device?.voiceServerUrl)return 'Local voice gateways are not used in the Cloudflare build';
  const ids = new Set();
  for (const r of value.reminders) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id)) return 'Every reminder needs a unique ID';
    ids.add(r.id);
    if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 120) return 'Give each reminder a short title';
    if(r.id.length>100||String(r.detail||'').length>240)return 'Keep reminder instructions under 240 characters';
    if(r.snoozeMinutes!==undefined&&(!Number.isInteger(r.snoozeMinutes)||r.snoozeMinutes<1||r.snoozeMinutes>120))return 'Snooze must be 1–120 minutes';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time || '')) return `Invalid time for ${r.title}`;
    if (!Array.isArray(r.days) || !r.days.length || r.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return `Choose at least one weekday for ${r.title}`;
    if ((r.startDate && !validDate(r.startDate)) || (r.endDate && !validDate(r.endDate))) return `Invalid date for ${r.title}`;
    if (r.startDate && r.endDate && r.endDate < r.startDate) return `End date precedes start date for ${r.title}`;
  }
  if(JSON.stringify(value).length>36000)return 'Settings are too large for this Buddy; shorten reminder text';
  return null;
}

// OCR is transcription, never a medication recommendation. Preserve original
// lines and only extract explicit clock times; frequency abbreviations require review.
export function prescriptionDraft(text, today) {
  const lines = String(text || '').split(/\n/).map(s => s.trim()).filter(Boolean);
  const candidates = lines.filter(line => /\b(tab(?:let)?s?|cap(?:sule)?s?|syrup|mg|mcg|ml|drops|ointment|inhaler)\b/i.test(line)).slice(0, 16);
  const items = candidates.map(line => {
    const times = [...line.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)].map(m => {
      let h = Number(m[1]); const minute=Number(m[2]);
      if (m[3]) { if(h<1||h>12)return null; h=h%12+(/^pm$/i.test(m[3])?12:0); }
      return h<24 && minute<60 ? `${String(h).padStart(2,'0')}:${m[2]}` : null;
    }).filter(Boolean);
    return { id:randomUUID(), title:line.slice(0,120), detail:line, times:[...new Set(times)], startDate:today, endDate:'', confirmed:false };
  });
  return { text, items, warnings:[
    'Check every medicine name, dose, instruction and date against the original prescription.',
    'Times are filled only when written explicitly. Confirm times and duration for instructions such as twice daily or after food.',
    ...(items.length ? [] : ['No medicine lines were identified. Edit the extracted text or add a reminder manually.'])
  ] };
}

export function reviewedReminders(items) {
  if (!Array.isArray(items) || !items.length || items.length>16) throw new Error('Select 1–16 reviewed medicines');
  return items.flatMap(item => {
    if (item.confirmed !== true || typeof item.title !== 'string' || !item.title.trim() || !validDate(item.startDate)) throw new Error('Review each selected medicine and set a start date');
    if (!item.endDate || !validDate(item.endDate) || item.endDate<item.startDate) throw new Error('Confirm an end date for each prescription medicine');
    if (!Array.isArray(item.times) || !item.times.length || item.times.length>8 || item.times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Set valid, confirmed reminder times');
    return [...new Set(item.times)].map(time=>({ id:`rx-${randomUUID()}`, title:item.title.trim().slice(0,120), detail:String(item.detail||'').slice(0,240), time, days:[0,1,2,3,4,5,6], startDate:item.startDate, endDate:item.endDate, kind:'medicine', enabled:true, snoozeMinutes:10, source:'reviewed-prescription' }));
  });
}
