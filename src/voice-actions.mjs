// Only explicit, deterministic phrases can perform care actions. The LLM never
// gets permission to invent a contact, confirm a dose, or execute arbitrary JSON.
export function voiceIntent(message) {
  const phrase = String(message || '').toLowerCase().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hi esp|hey esp|buddy)\s+/, '');
  if (/^(?:please )?call (.+)$/.test(phrase)) return { action: 'call', name: phrase.replace(/^(?:please )?call /, '') };
  if (['help me', 'emergency', 'send sos', 'i need help'].includes(phrase)) return { action: 'sos' };
  if (['cancel sos', 'cancel help request'].includes(phrase)) return { action: 'cancel_sos' };
  if (['snooze', 'snooze reminder', 'remind me later'].includes(phrase)) return { action: 'snooze' };
  if (['done', 'reminder done', 'i have taken my medicine', 'i took my medicine', 'confirm reminder'].includes(phrase)) return { action: 'acknowledge' };
  if (['i had water', 'i drank water', 'log water'].includes(phrase)) return { action: 'hydration' };
  const moods = { 'i feel okay': 'okay', 'i am okay': 'okay', 'i feel good': 'okay', 'i feel lonely': 'lonely', 'i feel unwell': 'unwell' };
  if (moods[phrase]) return { action: 'check_in', answer: moods[phrase] };
  if (/^(?:what(?: is|'s|s| are)|tell me|read|show).*(?:today|schedule|reminders|calendar)/.test(phrase)) return { action: 'agenda' };
  if (['what time is it', 'tell me the time'].includes(phrase)) return { action: 'time' };
  return null;
}

export function todayAgenda(settings, now = new Date()) {
  const zone = settings.device?.timezone || 'Asia/Kolkata';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return (settings.reminders || []).filter(r => r.enabled && r.days.includes(day) &&
    (!r.startDate || r.startDate <= date) && (!r.endDate || r.endDate >= date)).sort((a,b) => a.time.localeCompare(b.time));
}

export function agendaAnswer(settings, now = new Date()) {
  const items = todayAgenda(settings, now);
  if (!items.length) return 'You have no reminders scheduled for today.';
  return `Today you have ${items.length} reminder${items.length === 1 ? '' : 's'}. ` +
    items.slice(0, 4).map(r => `${r.title} at ${r.time}`).join('. ') +
    (items.length > 4 ? '. The remaining reminders are in your calendar.' : '.');
}
