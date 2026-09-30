# Buddy cloud backend (Cloudflare Worker + D1)

This folder contains the Buddy care-circle API, remote ESP relay, D1 migration, and a localhost website server. The ESP and browser use HTTPS to reach the same Worker; they do not need to share Wi-Fi. The old `care-hub` Node server is not used by this path. The older text-only relay page is retained at `/remote-test` for historical tests, but it cannot replace the full care-circle website.

## Before the website can work against Cloudflare

1. Copy **this folder's complete contents** into the root of the `buddy-backend` GitHub Desktop clone, replacing that clone's old Worker files. Also copy the sibling `companion-app` folder into the clone as `site/` so its localhost website and tests work independently. Keep the clone's `.git` folder. Do not copy `.env.local`, private `config.h`, `.wrangler`, or `.pio` files.
2. Commit and push with GitHub Desktop. Check that the Cloudflare Worker builds and deploys from the new commit. `wrangler.jsonc` already has the supplied D1 UUID and both Durable Object bindings.
3. Apply `migrations/0001_care_state.sql` to the **remote** `buddy` D1 database. In Cloudflare's D1 console, select `buddy` and run that SQL, or run `npx wrangler d1 migrations apply DB --remote` after `wrangler login`. Do not confuse `--local` with the live database.
4. In the Worker Settings → Variables and Secrets, retain the `DEVICE_TOKEN` secret used by the ESP. Set `ELEVENLABS_API_KEY` for primary speech and transcription, `GEMINI_API_KEY` for speech fallback and prescription-photo reading, and `GROQ_API_KEY` for AI chat. `OPENROUTER_API_KEY` is an optional chat fallback. Keep all keys as Worker secrets, not GitHub files or browser code. The default Gemini fallback speech model is `gemini-3.8-flash-tts`; if your account uses another compatible TTS model, set `GEMINI_TTS_MODEL` as a Worker variable.
5. Verify `/api/v2/me` without a session returns `{"error":"Log in to Buddy to continue."}`. If it says `Link Buddy using the code on its TFT`, the old Worker is still deployed.

Cloudflare deployment is not automatic from this workspace. Wrangler is not authenticated here, and this workspace is not the GitHub Desktop clone.

## Run the website on the laptop

Run `npm run cloud-site` in this folder, then open `http://localhost:4176/`. The same server serves `companion-app` and proxies `/api/v2/*` to the deployed HTTPS Worker. Create a user or carer account with a unique username and password; use **Log in** on the same screen when returning. No email is required. Connect the ESP to internet Wi-Fi, and enter its eight-digit TFT code under **My Buddy**. The ESP's `DEVICE_TOKEN` must match the Worker secret. The site uses a fresh cloud account; local Care Hub accounts are not migrated. The current localhost form needs this updated Worker deployed before registration will succeed.

`npm test` checks the relay and local page. The optional `tests/cloud_flow.mjs` checks fresh registration, pairing, settings sync, messages, and call signaling against a locally running Wrangler Worker with a synthetic `DEVICE_TOKEN`; it never uses real accounts. Cloud build and firmware compile do not prove physical audio/video quality.

## Important limits

This is an ideathon prototype, not a medical or emergency service. D1 stores care data as a single JSON snapshot behind one Durable Object: appropriate for a demonstration but not a production multi-device architecture. Real-time audio/video is relayed as short polling requests, not WebRTC to the ESP; expect latency and bandwidth limits. The website camera requires a secure browser context for phone use. Care-circle alerts require a person to see/respond; there is no cellular emergency connection. Never publish API keys, Wi-Fi credentials, or device tokens.
