import { initCareUI } from './care-ui.js';
import { authFetch as fetch, inHub, bridgeBase, settingsCache, cacheKey, requireCircle } from './session.js';
let careUI;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEFAULTS = {
  version: 1,
  person: { name: "Anita", language: "en-IN", pronouns: "she/her", formOfAddress: "" },
  voice: { voiceId: "bella", rate: 72, pitch: 64, volume: 82, repeatCount: 2 },
  display: { brightness: 220, orientation:'landscape', eyeColor:20127, highContrast: true, fontScale: "large", eyesEnabled: true },
  safety: { sosCountdownSeconds: 8, webhookUrl: "", missedReminderMinutes: 20, quietStart: "22:00", quietEnd: "07:00" },
  device: { timezonePosix: "IST-5:30", timezone:'Asia/Kolkata', deviceName: "Living Room Buddy", callName:'Buddy' },
  contacts: [{ id: "contact-1", name: "Priya", relationship: "Daughter", phone: "+91 ", receivesSos: true, receivesMissedReminders: true }],
  reminders: [{ id: "reminder-morning", title: "Example medicine reminder", detail: "Replace this example with the instructions on your prescription", time: "09:00", kind: "medicine", enabled: false, snoozeMinutes: 10, days: [0,1,2,3,4,5,6] }],
  preferences: { dailyGreeting: true, hydrationPrompts: true, familyMessages: true, privacyMode: "wake-phrase" }
};

const state = {
  settings: structuredClone(DEFAULTS),
  status: null,
  dirty: false,
  connected: false,
  apiBase: inHub ? bridgeBase : localStorage.getItem("buddy.apiBase") || location.origin,
  saveTimer: null
};

const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

function cloneMerge(base, incoming) {
  if (Array.isArray(incoming)) return structuredClone(incoming);
  if (!incoming || typeof incoming !== "object") return incoming ?? base;
  const output = structuredClone(base || {});
  Object.entries(incoming).forEach(([key, value]) => {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? cloneMerge(output[key] || {}, value)
      : structuredClone(value);
  });
  return output;
}

function pathGet(path) {
  return path.split(".").reduce((value, key) => value?.[key], state.settings);
}

function pathSet(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((value, key) => value[key] ??= {}, state.settings);
  parent[last] = value;
  markDirty();
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), inHub ? 15000 : 4500);
  try {
    const response = await fetch(`${state.apiBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.text();
    const parsed = body ? JSON.parse(body) : {};
    if (!response.ok) throw new Error(parsed.error || `Buddy returned ${response.status}`);
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function connect({ quiet = false } = {}) {
  try {
    const [settings, status] = await Promise.all([api("/api/settings"), api("/api/status")]);
    state.settings = cloneMerge(DEFAULTS, settings);
    state.status = status;
    state.connected = true;
    state.dirty = false;
    if(!inHub)localStorage.setItem("buddy.apiBase", state.apiBase);
    settingsCache.setItem(cacheKey, JSON.stringify(state.settings));
    bindSettingsToForm();
    renderCollections();
    renderStatus();
    updateSaveState();
    syncClock();
    if (!quiet) toast("Connected to Buddy");
  } catch (error) {
    state.connected = false;
    const local = settingsCache.getItem(cacheKey);
    if (local) {
      try { state.settings = cloneMerge(DEFAULTS, JSON.parse(local)); } catch {}
    }
    bindSettingsToForm();
    renderCollections();
    renderStatus();
    if (!quiet) toast("Buddy is offline. You can still review settings.", true);
  }
}

async function syncClock() {
  if (!state.connected) return;
  try { await api("/api/time", { method: "POST", body: JSON.stringify({ epochMs: Date.now() }) }); } catch {}
}

let savingSettings=null;
async function saveSettings() {
  if(savingSettings){await savingSettings;if(state.dirty)return saveSettings();return;}
  savingSettings=saveSettingsOnce();
  try { await savingSettings; } finally { savingSettings=null; }
}
async function saveSettingsOnce() {
  clearTimeout(state.saveTimer);
  if (!state.connected) {
    settingsCache.setItem(cacheKey, JSON.stringify(state.settings));
    toast("Draft kept in this tab. Reconnect before saving to Buddy.");
    state.dirty = true;
    updateSaveState();
    return;
  }
  $("#saveButton").disabled = true;
  $("#saveState").textContent = "Saving…";
  const submitted=JSON.stringify(state.settings);
  try {
    const saved = await api("/api/settings", { method: "PUT", body: submitted });
    const changed=JSON.stringify(state.settings)!==submitted;
    if(!changed)state.settings = cloneMerge(DEFAULTS, saved);
    else state.settings._revision=saved._revision;
    state.dirty = changed;
    settingsCache.setItem(cacheKey, JSON.stringify(state.settings));
    updateSaveState();
    toast(inHub?"Saved to your circle. Buddy syncs when online.":"Changes saved to Buddy");
    careUI?.refresh();
  } catch (error) {
    $("#saveState").textContent = "Could not save";
    toast(error.message, true);
  } finally {
    $("#saveButton").disabled = false;
  }
}

function markDirty() {
  state.dirty = true;
  updateSaveState();
  settingsCache.setItem(cacheKey, JSON.stringify(state.settings));
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => state.connected && saveSettings(), 1400);
  updateSummaries();
}

function updateSaveState() {
  $("#saveState").textContent = state.dirty ? "Unsaved changes" : "All changes saved";
  $("#saveState").classList.toggle("dirty", state.dirty);
}

function bindSettingsToForm() {
  const voiceMigration = { warm:"bella", gentle:"sarah", bright:"bella", robot:"brian", grounded:"brian", tara:"bella", rishi:"brian", samantha:"sarah" };
  state.settings.voice.voiceId = voiceMigration[state.settings.voice.voiceId] || state.settings.voice.voiceId || "bella";
  $$('[data-path]').forEach(input => {
    const value = pathGet(input.dataset.path);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  });
  $$('[data-voice]').forEach(button => button.classList.toggle("active", button.dataset.voice === state.settings.voice.voiceId));
  $("#deviceUrl").value = state.apiBase;
  updateSummaries();
}

function updateSummaries() {
  const { settings } = state;
  $("#profileAvatar").textContent = (settings.person.name || "B")[0].toUpperCase();
  $("#rateOutput").textContent = settings.voice.rate;
  $("#pitchOutput").textContent = settings.voice.pitch;
  $("#volumeOutput").textContent = settings.voice.volume;
  $("#brightnessOutput").textContent = settings.display.brightness;
  $("#sosOutput").textContent = `${settings.safety.sosCountdownSeconds} seconds`;
  $("#voiceSummary").textContent = `${title(settings.voice.voiceId)} · pace ${settings.voice.rate}`;
  $("#todayReminderCount").textContent = settings.reminders.filter(item => item.enabled).length;
  $("#careCircleCount").textContent = settings.contacts.length;
}

function renderCollections() {
  renderContacts();
  renderReminders();
  updateSummaries();
}

function renderContacts() {
  const list = $("#contactsList");
  list.replaceChildren();
  if (!state.settings.contacts.length) list.innerHTML = '<p class="empty">No trusted contacts yet.</p>';
  state.settings.contacts.forEach((contact, index) => {
    const card = $("#contactTemplate").content.firstElementChild.cloneNode(true);
    $(".list-avatar", card).textContent = (contact.name || "?")[0].toUpperCase();
    $$('[data-field]', card).forEach(input => {
      const field = input.dataset.field;
      if (input.type === "checkbox") input.checked = Boolean(contact[field]);
      else input.value = contact[field] ?? "";
      input.addEventListener("input", () => {
        contact[field] = input.type === "checkbox" ? input.checked : input.value;
        $(".list-avatar", card).textContent = (contact.name || "?")[0].toUpperCase();
        markDirty();
      });
    });
    $(".remove", card).addEventListener("click", () => {
      state.settings.contacts.splice(index, 1);
      renderContacts(); markDirty();
    });
    list.append(card);
  });
}

function renderReminders() {
  const list = $("#remindersList");
  list.replaceChildren();
  if (!state.settings.reminders.length) list.innerHTML = '<p class="empty">No reminders yet.</p>';
  state.settings.reminders.forEach((reminder, index) => {
    const card = $("#reminderTemplate").content.firstElementChild.cloneNode(true);
    $(".reminder-kind", card).textContent = ({medicine:"✚",meal:"⌂",hydration:"◌",appointment:"▣",activity:"↗"})[reminder.kind] || "◷";
    $$('[data-field]', card).forEach(input => {
      const field = input.dataset.field;
      if (input.type === "checkbox") input.checked = Boolean(reminder[field]);
      else input.value = reminder[field] ?? "";
      input.addEventListener("input", () => {
        reminder[field] = input.type === "checkbox" ? input.checked : input.value;
        if (field === "kind") renderReminders();
        markDirty();
      });
    });
    const days = $(".days", card);
    dayNames.forEach((name, day) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.title = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][day];
      button.classList.toggle("active", reminder.days.includes(day));
      button.addEventListener("click", () => {
        reminder.days = reminder.days.includes(day) ? reminder.days.filter(value => value !== day) : [...reminder.days, day].sort();
        button.classList.toggle("active", reminder.days.includes(day));
        markDirty();
      });
      days.append(button);
    });
    $(".remove", card).addEventListener("click", () => {
      state.settings.reminders.splice(index, 1);
      renderReminders(); markDirty();
    });
    list.append(card);
  });
}

async function pollStatus() {
  try {
    state.status = await api("/api/status");
    state.connected = true;
  } catch {
    state.connected = false;
  }
  renderStatus();
}

function renderStatus() {
  const status = state.status;
  // A successful Care Hub request is not proof that the physical device is
  // online. Keep hub reachability for saving queued settings, but render the
  // device heartbeat separately.
  const online = state.connected && (!inHub || status?.online === true);
  const unpaired = inHub && state.connected && status?.paired === false;
  $("#sidebarDot").classList.toggle("online", online);
  $("#sidebarStatus").textContent = unpaired ? "No ESP32 paired" : online ? "Buddy is online" : "Buddy is offline";
  $("#sidebarDevice").textContent = state.settings.device.deviceName || "Buddy";
  $("#connectionBadge").classList.toggle("online", online);
  $("#connectionBadge").innerHTML = `<i></i> ${unpaired ? "No ESP32 paired" : online ? "ESP32 connected" : "Buddy offline"}`;
  $("#deviceGreeting").textContent = unpaired ? "Pair your physical Buddy." : online ? status?.headline || "Buddy is ready." : "Trying to reach Buddy.";
  $("#deviceMessage").textContent = unpaired ? "Open My Buddy and enter the code shown by the ESP32." : online ? status?.detail || "Buddy is ready." : inHub ? "Changes can be saved to the care circle and will sync when Buddy reconnects." : "Reminders stored on Buddy will continue offline.";
  $("#factStatus").textContent = online ? title(status?.mode || "online") : "Offline";
  $("#factIp").textContent = status?.ip || "—";
  $("#factFirmware").textContent = status?.firmwareVersion || "—";
  $("#factMemory").textContent = status?.freeHeap ? `${Math.round(status.freeHeap / 1024)} KB heap` : "—";
  $("#factAudio").textContent = status?.audioMode ? title(status.audioMode) : "—";

  const pupils = $$(".mini-eye i");
  pupils.forEach(pupil => pupil.style.transform = `translate(${(status?.gazeX || 0) * 8}px, ${(status?.gazeY || 0) * 5}px)`);

  const events = status?.events || [];
  const latest = events.at(-1);
  $("#lastEvent").textContent = latest?.message || "No events yet";
  const list = $("#activityList");
  list.replaceChildren();
  if (!events.length) list.innerHTML = '<p class="empty">No activity has been recorded yet.</p>';
  events.slice(-6).reverse().forEach(event => {
    const row = document.createElement("div");
    row.className = "activity-item";
    row.innerHTML = `<i></i><span><b>${escapeHtml(event.message)}</b><small>${escapeHtml(title(event.type))}</small></span><time>${formatUptime(event.atMs)}</time>`;
    list.append(row);
  });
}

async function action(name, details = {}) {
  if (!state.connected) return toast("Connect to Buddy first.", true);
  try {
    await api("/api/actions", { method: "POST", body: JSON.stringify({ action: name, ...details }) });
    await pollStatus();
    toast(name === "sos" ? "SOS countdown started" : "Buddy received the action");
  } catch (error) { toast(error.message, true); }
}

function navigate(page) {
  const target = $(`#page-${page}`) || $("#page-dashboard");
  $$(".page").forEach(item => item.classList.toggle("active", item === target));
  $$('[data-page]').forEach(item => item.classList.toggle("active", item.dataset.page === page));
  $("#pageTitle").textContent = target.dataset.title;
  $("#pageEyebrow").textContent = target.dataset.eyebrow;
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let previewAudio;
async function previewVoice() {
  const text = `Hello ${state.settings.person.name}. I'm ${state.settings.device.callName||'Buddy'}, and I'm here whenever you need me.`;
  $("#previewVoice").disabled = true;
  $("#previewVoice").textContent = "Preparing natural voice…";
  try {
    if (previewAudio) { previewAudio.pause(); URL.revokeObjectURL(previewAudio.src); }
    const base=state.settings.device.voiceServerUrl?.replace(/\/$/,'')||state.apiBase;
    const response = await fetch(`${base}/api/tts`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ text, voiceId:state.settings.voice.voiceId, language:state.settings.person.language, rate:state.settings.voice.rate }),signal:AbortSignal.timeout(35000) });
    if (!response.ok) throw new Error((await response.json()).error || "Voice service unavailable");
    const url = URL.createObjectURL(await response.blob());
    previewAudio = new Audio(url); previewAudio.volume = state.settings.voice.volume / 100;
    previewAudio.addEventListener("ended", () => URL.revokeObjectURL(url), { once:true });
    await previewAudio.play();
  } catch (error) {
    if (!("speechSynthesis" in window)) return toast(error.message, true);
    toast('Natural voice unavailable; playing the browser fallback.',true);
    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = state.settings.person.language;
    speech.rate = .78 + (state.settings.voice.rate - 40) / 200;
    speech.pitch = .92 + (state.settings.voice.pitch - 64) / 300;
    speech.volume = state.settings.voice.volume / 100;
    const preferred = { bella:["Samantha","Tara"], sarah:["Samantha","Karen"], brian:["Rishi","Daniel"], daniel:["Daniel","Reed"] }[state.settings.voice.voiceId] || [];
    const voices = speechSynthesis.getVoices();
    speech.voice = preferred.map(name => voices.find(voice => voice.name.includes(name))).find(Boolean) || voices.find(voice => voice.lang === speech.lang) || voices.find(voice => voice.lang.startsWith(speech.lang.split("-")[0]));
    speechSynthesis.speak(speech);
  } finally {
    $("#previewVoice").disabled = false;
    $("#previewVoice").textContent = "▶ Preview voice";
  }
}

function title(value) { return String(value || "").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
function formatUptime(ms) { if (ms == null) return ""; const seconds = Math.max(0, ((state.status?.uptimeMs || ms) - ms) / 1000); if (seconds < 60) return "now"; if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`; return `${Math.round(seconds / 3600)}h ago`; }
let toastTimer;
function toast(message, error = false) { const element = $("#toast"); element.textContent = message; element.classList.toggle("error", error); element.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove("show"), 3200); }

function installEvents() {
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "dashboard"));
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#saveButton").addEventListener("click", saveSettings);
  $("#refreshButton").addEventListener("click", pollStatus);
  $$('[data-go]').forEach(button => button.addEventListener("click", () => { location.hash = button.dataset.go; }));
  $$('[data-action]').forEach(button => button.addEventListener("click", () => {
    const name = button.dataset.action;
    action(name, {});
  }));
  $$('[data-path]').forEach(input => input.addEventListener("input", () => {
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (input.type === "range" || input.dataset.number !== undefined) value = Number(value);
    pathSet(input.dataset.path, value);
    updateSummaries();
  }));
  $$('[data-voice]').forEach(button => button.addEventListener("click", () => {
    state.settings.voice.voiceId = button.dataset.voice;
    $$('[data-voice]').forEach(item => item.classList.toggle("active", item === button));
    markDirty();
  }));
  $("#previewVoice").addEventListener("click", previewVoice);
  $("#addContact").addEventListener("click", () => {
    state.settings.contacts.push({ id: id("contact"), name: "New contact", relationship: "Family", phone: "", receivesSos: true, receivesMissedReminders: false });
    renderContacts(); markDirty();
  });
  $("#addReminder").addEventListener("click", () => {
    state.settings.reminders.push({ id: id("reminder"), title: "New reminder", detail: "It's time", time: "09:00", kind: "activity", enabled: true, snoozeMinutes: 10, days: [0,1,2,3,4,5,6] });
    renderReminders(); markDirty();
  });
  $("#messageText").addEventListener("input", event => $("#messageCount").textContent = event.target.value.length);
  $$(".suggestion-row button").forEach(button => button.addEventListener("click", () => {
    $("#messageText").value = button.textContent;
    $("#messageCount").textContent = button.textContent.length;
  }));
  $("#sendMessage").addEventListener("click", async () => {
    const message = $("#messageText").value.trim();
    if (!message) return toast("Write a message first.", true);
    await action("say", { headline: "A message from your family", message });
    $("#messageText").value = ""; $("#messageCount").textContent = "0";
  });
  $("#connectButton").addEventListener("click", () => {
    state.apiBase = $("#deviceUrl").value.trim().replace(/\/$/, "") || location.origin;
    connect();
  });
  $("#resetWifi").addEventListener("click", async () => {
    if (!state.connected || !confirm("Reset Buddy's saved Wi-Fi network?")) return;
    try { await api("/api/reset-wifi", { method: "POST", body: "{}" }); toast("Buddy is restarting in setup mode."); } catch (error) { toast(error.message, true); }
  });
  window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
}

async function boot() {
  if(!await requireCircle())return;
  careUI=initCareUI({state,api,saveSettings,renderCollections,bindSettingsToForm,toast,id});
  installEvents();
  if(inHub){document.body.classList.add('hub-editor');$('#deviceUrl').disabled=true;$('#connectButton').hidden=true;$('#resetWifi').hidden=true;}
  navigate(location.hash.slice(1) || "dashboard");
  await connect({ quiet: true });
  if(inHub&&new URLSearchParams(location.search).has('readOnly')){
    const lock=()=>$$('input,select,textarea,button').forEach(el=>{if(!['previousMonth','nextMonth','currentMonth','previewVoice','refreshButton'].includes(el.id))el.disabled=true;});
    lock();new MutationObserver(lock).observe(document.body,{childList:true,subtree:true});
  }
  careUI.refresh();
  setInterval(pollStatus, 1800);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
