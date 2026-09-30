# Buddy remote-control connection test

This standalone Cloudflare Worker is only for testing laptop-to-ESP text delivery. It is not the Buddy Care Hub. The laptop and ESP need internet access but do not need to share a Wi-Fi network.

The ESP authenticates to the Worker with its private `DEVICE_TOKEN`. The Worker gives the ESP a short-lived, one-use 8-digit linking code, which appears on the TFT. Enter that code on the control page to link the current browser tab. The page receives a 24-hour session token and can then send text. **There is no `ADMIN_TOKEN` or `ADMIN_PASSWORD` requirement.** The code expires after ten minutes, and five incorrect attempts cause a one-minute lockout. Linking a new browser replaces the previous browser session.

Cloudflare Durable Objects hold the latest text, pairing code, and session between requests. There is **no D1 database, D1 binding, or SQL migration**. Cloudflare provisions the Durable Object binding from `wrangler.jsonc` when deploying. It uses Cloudflare-managed storage internally.

## Deploy the backend

The changed backend files have been synced into the local `buddy-backend` GitHub Desktop clone. Commit and push them there, then wait for Cloudflare's Worker deployment. Make sure `wrangler.jsonc` is included: it replaces the old D1 binding with the `REMOTE_STATE` Durable Object binding. Keep the existing `DEVICE_TOKEN` Worker Secret. Old `ADMIN_TOKEN` and `ADMIN_PASSWORD` secrets are ignored by this version and can be removed from Cloudflare settings later.

The existing D1 database is not deleted; this Worker simply stops using it. Do not put `DEVICE_TOKEN`, Wi-Fi credentials, or other secrets in GitHub.

## Run the control page on localhost

From this folder on the laptop, run `npm run local-page` and open `http://localhost:4175/`. The page is served on the laptop's loopback interface and forwards only its pairing and control API calls over HTTPS to the deployed Worker. No browser CORS change is needed. On a phone, use the Worker's HTTPS webpage instead; `localhost` on the phone is not the laptop.

1. Upload the updated firmware from `../firmware/remote_control_test` to the ESP with PlatformIO. Its local, Git-ignored `config.h` already contains the Worker URL, Wi-Fi, and `DEVICE_TOKEN` values from the earlier test.
2. When Buddy connects, read the **LINK CODE** at the bottom of its TFT.
3. Enter that code at `http://localhost:4175/` and click **Link Buddy**.
4. Type text and click **Send to Buddy**. The ESP polls every five seconds; the page shows when it confirms the message.

If the live Worker still has the old D1 code, linking will fail until the updated backend is committed, pushed, and deployed. `GET /health` alone only proves the Worker URL responds; it does not prove the pairing API is deployed.

## API

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | anyone | Confirm the Worker is deployed. |
| `GET /api/device/pairing` | ESP device token | Issue or fetch the current 8-digit TFT code. |
| `POST /api/pair` | browser with TFT code | Exchange a one-use code for a browser session. |
| `GET /api/status` | linked browser session | Read text and device confirmation. |
| `POST /api/message` | linked browser session | Send 1–120 characters of text. |
| `GET /api/device/config` | ESP device token | Fetch the latest text and revision. |
| `POST /api/device/ack` | ESP device token | Confirm a displayed revision. |

The ESP uses `Authorization: Bearer <device token>`. After pairing, the browser uses `Authorization: Bearer <session token>`, stored only in the current browser tab's session storage. Do not send private health information in test messages; this is not emergency infrastructure or a production authentication system.

Run `npm test` for local route and localhost-page tests.
