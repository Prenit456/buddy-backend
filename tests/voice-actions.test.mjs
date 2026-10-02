import {test} from 'node:test';
import assert from 'node:assert/strict';
import {voiceIntent,agendaAnswer} from '../src/voice-actions.mjs';
test('explicit care actions are grounded; ambiguous medicine talk never confirms a dose',()=>{
  assert.deepEqual(voiceIntent('Hi ESP, I feel lonely.'),{action:'check_in',answer:'lonely'});
  assert.deepEqual(voiceIntent('please call family'),{action:'call',name:'family'});
  assert.equal(voiceIntent('Should I take my medicine?'),null);
  assert.equal(voiceIntent('My neighbour said help me yesterday'),null);
  assert.deepEqual(voiceIntent('snooze reminder'),{action:'snooze'});
});
test('agenda uses the device timezone, dates, weekdays and enabled reminders',()=>{
  const settings={device:{timezone:'Asia/Kolkata'},reminders:[
    {title:'Morning appointment',time:'09:00',days:[4],enabled:true,startDate:'2026-10-01',endDate:'2026-10-01'},
    {title:'Wrong weekday',time:'10:00',days:[3],enabled:true},
    {title:'Disabled',time:'11:00',days:[4],enabled:false}
  ]};
  const answer=agendaAnswer(settings,new Date('2026-09-30T20:00:00Z'));
  assert.match(answer,/Morning appointment at 09:00/);assert.doesNotMatch(answer,/Wrong weekday|Disabled/);
});
