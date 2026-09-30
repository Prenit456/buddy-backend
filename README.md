# Buddy remote-control connection test

This is a standalone Cloudflare Worker for one simple test: type text on its webpage, and the ESP32 displays that text on the TFT. The laptop and ESP need internet access but do not need to share a Wi-Fi network. It is separate from the Buddy Care Hub.

The latest text and acknowledgement are held by one Cloudflare Durable Object. **No D1 database, D1 binding, SQL console, or manual database migration is needed.** Cloudflare creates the Durable Object binding from `wrangler.jsonc` during deployment. It uses Cloudflare-managed storage internally so the message survives separate laptop and ESP requests. Durable Objects with SQLite storage are available on the Workers Free plan, subject to Cloudflare's free-tier limits.

The separate ESP firmware is in `../firmware/remote_control_test`. Its Worker URL and `DEVICE_TOKEN` are already configured in its local Git-ignored `config.h`; do not upload that file to GitHub.

## Run the control page on localhost

From this folder on the laptop, run `npm run local-page` and open `http://localhost:4175/`. The page is served only on the laptop's loopback interface; it forwards `/api/status` and `/api/message` over HTTPS to the deployed Cloudflare Worker. Enter the Worker `ADMIN_PASSWORD` in the page. The ESP independently polls the same Worker, so the laptop and ESP may be on different Wi-Fi networks.

This local page does **not** run the backend on the laptop and does not need a D1 database or browser CORS changes. The updated Worker code must still be deployed to Cloudflare once, with `ADMIN_PASSWORD`, `DEVICE_TOKEN`, and the `REMOTE_STATE` Durable Object binding. If the live Worker still runs the old D1 code, localhost will show the same backend error until you push and deploy the updated code. `localhost` works on the laptop only; for a phone, use the Worker's HTTPS webpage instead.

## Update the deployed backend

1. Copy this folder's `src/worker.js`, `src/handler.js`, `src/page.js`, `wrangler.jsonc`, and `package.json` into the same locations in your cloned `buddy-backend` GitHub repository. The old `migrations/0001_remote_state.sql` and D1 binding are no longer used. Commit and push with GitHub Desktop. Cloudflare should redeploy the Worker using `npx wrangler deploy`. If you are using the clone on this computer, these files have already been synced there; you only need to commit and push.
2. In **Workers & Pages → buddy-remote-test → Settings → Variables and Secrets**, keep the existing `DEVICE_TOKEN` secret. Add `ADMIN_PASSWORD` as a **Secret** with your temporary test password. The old `ADMIN_TOKEN` is unused and can be removed after the updated Worker is deployed. Do not put the device token or password in GitHub or screenshots.
3. Once deployment is complete, open `https://buddy-remote-test.<your-subdomain>.workers.dev/`, enter the test password, and send a short line of text. Buddy polls every five seconds and should display it. The page shows when Buddy confirms the revision.

If the ESP already has the `remote_control_test` firmware and its URL/device token are correct, it does **not** need re-uploading. The API paths and response format are unchanged.

## API

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | anyone | Confirm the Worker is deployed. |
| `GET /api/status` | admin password | Read latest text and device confirmation. |
| `POST /api/message` | admin password | Send `{ "text": "Hello Buddy" }` (1–120 characters). |
| `GET /api/device/config` | device token | Fetch the latest revision and text. |
| `POST /api/device/ack` | device token | Confirm a displayed revision. |

Admin routes use `X-Admin-Password: <password>`; device routes use `Authorization: Bearer <device token>`. The included webpage is served from the same Worker origin. It stores the password only in that browser tab's session storage.

Run `npm test` in this folder for local route tests. This is a limited connection demo, not an emergency or secure remote-control system. A four-digit password is easily guessed on a public URL; replace it with strong authentication before real use, and do not send private health information in test messages.
