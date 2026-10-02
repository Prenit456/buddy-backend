# Buddy hardware integration — October 2026

The website on localhost:4176 uses the Cloudflare Worker and D1. Buddy can use
another internet-connected Wi-Fi. No local CareHub is needed.

## Connected features

- Pairing, device name, voice selection, pace, volume, timezone, eye colour and
  eyes on/off sync to the ESP with explicit settings revision acknowledgements.
- Calendar and human-reviewed prescription reminders are cached on the ESP.
  Simultaneous reminders queue; confirmation, snooze, repeats and missed-reminder
  events update the cloud journal. Medicine confirmation is a user report, not
  proof of a dose. Overdue prompts never advise doubling a dose.
- Messages and “Read this reply on Buddy” reach its display/speaker. Receipts
  distinguish queued from displayed; speech requested is not proof it was heard.
- Audio/video calls ring; the physical button accepts/ends them. Camera check-ins
  require acceptance, use no microphone and end after two minutes. Voice calls
  to an invited calling-enabled carer now include outgoing call signaling.
- Check-ins, water logs, optional morning/water prompts, find/test Buddy, reading
  the actual day's agenda, microphone privacy and owner-controlled unpairing work
  through the same app/backend/firmware protocol.
- SOS: hold the button for two seconds or use an explicit voice command. The
  configured countdown can be cancelled with a press. An escalated care-circle
  alert appears only after the ESP reports it, not when an app command is queued.

## Wake and speech

Say **Hi ESP**, then a request. Espressif WakeNet9 detects that phrase locally,
without Wi-Fi or ElevenLabs. Recording ends after silence, at most ten seconds.
Wake detection pauses during calls and speaker activity. A button press remains
a fallback. Changing the introduction name does not retrain the wake model.

ElevenLabs is primary for STT/TTS; Groq STT and Gemini TTS are backups. AI provider
pools support saved Groq, OpenRouter, NVIDIA and Gemini credentials. All provider
keys stay in Worker secrets. A short conversation history stays in ESP RAM.

October 1 live checks with saved private keys passed for Groq gpt-oss-20b chat,
ElevenLabs speech/transcription and Gemini backup speech. These were tiny
synthetic requests, not calls from a flashed ESP. Older fallback keys were not
individually certified; quota and permissions can change. Re-run the explicit
`npm run test:providers` if needed (it may use provider credits).

## Activate

1. Commit/push the updated `buddy-backend` GitHub Desktop clone; wait for the
   Cloudflare build to finish. Do not copy private credentials into GitHub.
2. From `ideathon/buddy-remote-test`, run `npx wrangler login`, then
   `npm run secrets:upload`. This imports saved private credentials and the
   matching DEVICE_TOKEN without printing values. Rotate previously shared keys.
3. Open `ideathon/firmware/buddy_cloud` in PlatformIO and select **Upload**. It
   flashes firmware, partitions and the 284 KiB wake model together. Do not upload
   just main.cpp. Ordinary Upload preserves the old LittleFS address and size.
   If a NEW device has no filesystem, Upload Filesystem initializes it; this
   replaces locally saved settings, so do not do it to an existing device casually.
4. Run `npm run cloud-site`, open localhost:4176, pair if needed, and wait for
   Device revision to match Saved revision.
5. Test colour, message delivery, a reminder two minutes ahead, snooze, a call,
   microphone off, and “Hi ESP, what is my schedule today?” on the actual board.

## Limits and verification

Backlight brightness is disabled because it is wired to 3.3 V. There is no battery
sensor, RTC backup, offline speech synthesis, face tracking, SMS integration or
emergency-service dialer. Battery displays --%. Cold-boot offline reminders need
a valid clock; cached reminders survive a Wi-Fi outage after time synchronization.
The persisted event queue holds 40 events; SOS is prioritized, but nothing can
deliver without internet. This is not an emergency system.

Device video is low-frame-rate JPEG/PCM relay. Camera, acoustic feedback, wake
accuracy and network latency require physical tests. A carer's app must remain
open: background push/locked-phone ringing are not implemented. Browser-to-browser
calls on restrictive networks require TURN credentials in BUDDY_ICE_SERVERS;
the default STUN service is not a guarantee. Care tasks and access/audit features
are intentionally app collaboration features, not fake ESP controls.

Node tests cover authentication, relay, localhost proxy, safe voice intents,
timezone agendas and WAV/raw PCM conversion. The real local Worker/D1 integration
test covers pairing, settings, receipts, SOS lifecycle, both call directions and
bidirectional PCM relay, camera consent, and unpairing with a synthetic ESP.
PlatformIO compiles and links the real WakeNet
library. These results do not certify real microphone/speaker/call performance.

Upstream model/library: https://github.com/espressif/esp-sr/tree/v1.6.0
