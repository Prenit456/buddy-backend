import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCareSettings,reviewedReminders} from '../src/care.mjs';
const defaults=JSON.parse(readFileSync(new URL('../src/default-settings.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(defaults);
test('hardware settings reject unsupported controls and conflicting timezones',()=>{
  const settings=fresh();assert.equal(validateCareSettings(settings),null);
  settings.display.orientation='portrait';assert.match(validateCareSettings(settings),/landscape/);
  settings.display.orientation='landscape';settings.device.timezone='UTC';assert.match(validateCareSettings(settings),/timezone must match/);
  settings.device.timezonePosix='UTC0';assert.equal(validateCareSettings(settings),null);
  settings.preferences.privacyMode='always-upload';assert.match(validateCareSettings(settings),/microphone off/);
});
test('physical reminder settings reject oversized, ambiguous and duplicate entries',()=>{
  const settings=fresh(),reminder=settings.reminders[0];
  reminder.enabled=true;reminder.snoozeMinutes=0;assert.match(validateCareSettings(settings),/Snooze/);
  reminder.snoozeMinutes=10;reminder.days=[];assert.match(validateCareSettings(settings),/weekday/);
  reminder.days=[1];settings.reminders.push({...reminder});assert.match(validateCareSettings(settings),/unique ID/);
  settings.reminders.pop();reminder.detail='x'.repeat(241);assert.match(validateCareSettings(settings),/240/);
});
test('prescriptions cannot reach the ESP without human review and explicit duration',()=>{
  const item={title:'Fictional prescription',detail:'Only a synthetic test',startDate:'2026-10-01',times:['09:00'],confirmed:false};
  assert.throws(()=>reviewedReminders([item]),/Review/);
  item.confirmed=true;assert.throws(()=>reviewedReminders([item]),/end date/);
  item.endDate='2026-10-03';assert.equal(reviewedReminders([item])[0].source,'reviewed-prescription');
});
