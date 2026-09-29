# Buddy remote-control test — independent Cloudflare backend

This folder deploys by itself as a Cloudflare Worker. It is **not** the Buddy Care Hub and does not use the laptop as a server. Its tiny website saves one line of text in Cloudflare D1. A future ESP32 test firmware will poll `/api/device/config`, display the text on the TFT, and acknowledge it with `/api/device/ack`. The phone and ESP can be on different networks as long as both have internet access.

The Worker is ready to deploy and its API has tests. **It does not yet include ESP32 firmware**, so deploying it alone will not change the physical Buddy. Once you have its `*.workers.dev` URL, the separate ESP test can be configured for that URL and your device token.

## Deploy without buying a domain

1. In Cloudflare, open **Storage & databases → D1 SQL Database → Create database**. Name it `buddy-remote-test`. Copy its **database ID**.
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc` with that ID. Keep the Worker name `buddy-remote-test` unless you also change it in Cloudflare.
3. In the new D1 database's **Console**, run the SQL from `migrations/0001_remote_state.sql`. The single row with `id = 1` must exist before the API can store changes. Alternatively, after installing dependencies locally, run `npm run migrate` from this folder.
4. Put **only this folder** in a new GitHub repository. Keep `wrangler.jsonc` at that repository's root. Do not upload the entire `ideathon` folder or any `.env`, `.dev.vars`, passwords, Wi-Fi credentials, or API keys.
5. In **Compute → Workers & Pages → Create application → Import a repository**, select that GitHub repository. The Worker name must match `wrangler.jsonc`: `buddy-remote-test`. Leave the build command empty; use `npx wrangler deploy` as the deploy command. If you instead put this folder inside a larger repository, set the root directory to `buddy-remote-test`.
6. In the deployed Worker's **Settings → Variables and Secrets**, add **two different Secret values** named `ADMIN_TOKEN` and `DEVICE_TOKEN`. Generate each locally with `openssl rand -hex 32`; each should be a different 64-character string. Do **not** add either token to `wrangler.jsonc`, GitHub, a public screenshot, or chat. The website uses `ADMIN_TOKEN`; the ESP will use `DEVICE_TOKEN`. Cloudflare may ask you to deploy again after adding the secrets.
7. Open the Worker's `https://buddy-remote-test.<your-subdomain>.workers.dev/` address. Paste `ADMIN_TOKEN` into the page, send test text, and check that the revision increases. It will say Buddy has not confirmed it until the ESP test firmware is added.

The web page keeps the admin token only in the current browser tab's session storage. Treat both tokens as passwords. If either leaks, replace it in Cloudflare and update the ESP's private configuration. No token is baked into the Worker code.

## API

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /health` | anyone | Confirm the Worker is deployed. |
| `GET /api/status` | admin token | Read saved text, revision, and device confirmation. |
| `POST /api/message` | admin token | Save `{ "text": "Hello Buddy" }` (1–120 characters). |
| `GET /api/device/config` | device token | Fetch the latest revision and text. |
| `POST /api/device/ack` | device token | Confirm `{ "revision": 1 }` after displaying it. |

Use `Authorization: Bearer <token>` for every `/api/` request. The API does not allow browser cross-origin requests; use the included same-origin control page. `GET /health` is not an authentication check.

Run `npm test` inside this folder for local route tests. They use a fake D1 binding and do not require Cloudflare credentials.

This is a limited experiment, **not** an emergency, medication, or secure general-purpose remote-control system. It supports one Buddy and one administrator, no account recovery, and no reliable real-time delivery guarantees. Do not send sensitive health information in this test text.
