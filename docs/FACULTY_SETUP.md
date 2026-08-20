# Faculty Setup

How to stand up your own copy of the CDP Social Bot on Cloudflare.

## Status

Working today:

- Discord sign-in (OAuth), session cookies, sign-out
- The profile form renders and knows who you are

Not built yet:

- Saving profiles (`POST /api/profile`)
- Discord slash commands (`/interactions`)

Deploying now gives you a working sign-in flow and nothing past it.

## Prerequisites

Node.js 22 or newer. Wrangler refuses to run on older versions:

```bash
node -v
```

If that prints v20 or lower, switch before continuing (`nvm use 22`).

## 1. Create the Discord application

At <https://discord.com/developers/applications>, create an app, then:

- **OAuth2 → Client ID** and **Client Secret** — copy both, you need them in step 3
- **OAuth2 → Redirects** — add one entry per environment you use:
  - `http://localhost:5174/auth/discord/callback` (local)
  - `https://<your-worker>.workers.dev/auth/discord/callback` (deployed)

Discord rejects any redirect URI not listed here, so the deployed URL must be
added before sign-in will work in production.

## 2. Create the D1 database

```bash
npx wrangler d1 create cdp-social-bot-db
```

Put the returned `database_id` into `wrangler.jsonc` under `d1_databases`.

Apply the schema to **both** environments — they are separate databases:

```bash
npx wrangler d1 migrations apply cdp-social-bot-db --local
```

```bash
npx wrangler d1 migrations apply cdp-social-bot-db --remote
```

Skipping `--remote` is the most common setup mistake. Everything looks fine
locally, then every deployed route that touches the database returns 500.

## 3. Configure credentials

Local development reads `.dev.vars`, which is gitignored and never leaves your
machine. Create it with:

```
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
```

Production does **not** read that file. Upload the same two values as secrets:

```bash
npx wrangler secret put DISCORD_CLIENT_ID
```

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET
```

Without these the deployed worker builds a sign-in URL with an undefined client
id, and the callback fails with a 502.

## 4. Run it locally

```bash
npm run dev
```

Serves on <http://localhost:5174>.

Use `npm run dev`, not `wrangler dev`. This project builds through Vite, and
`wrangler dev` loads a redirected config that points at the last `dist/` build
rather than your source — you end up testing stale code without any warning.

## 5. Deploy

Authenticate once:

```bash
npx wrangler login
```

Then deploy. This rebuilds before uploading, so it always ships current source:

```bash
npm run deploy
```

Cloudflare prints the deployed URL, of the form
`https://cdp-social-bot.<your-subdomain>.workers.dev`.

## 6. Verify

```bash
curl -H 'Cookie: session=probe' https://<your-worker>.workers.dev/api/session
```

Expect `{"authenticated":false}`. The fake cookie is the point: it forces the
worker to look the session up in D1, so a 200 proves the current code is live
**and** the database is reachable. A 500 means migrations were never applied
remotely.

Two weaker checks that can mislead you:

- `/api/health` returns 200 even when secrets are missing, migrations were never
  applied remotely, or the deploy is months stale — it touches none of them.
- `/api/session` **without** a cookie also returns a clean
  `{"authenticated":false}`, because it answers from the missing-cookie branch
  before it ever queries. Always pass the fake cookie.

Then open the site in a browser and click **Sign in with Discord**. You should
land back on the form with your Discord name filled in. If Discord shows an
invalid-redirect error, revisit step 1.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Wrangler requires at least Node.js v22` | Old Node; see Prerequisites |
| Routes 404 in production but work locally | Deploy hasn't run since those routes were added |
| Deployed routes return 500 (`error code: 1101`) | Migrations not applied with `--remote`; check with `wrangler d1 migrations list cdp-social-bot-db --remote` |
| Sign-in returns 502 | Secrets not uploaded with `wrangler secret put` |
| Discord shows "Invalid OAuth2 redirect_uri" | Deployed callback URL not registered in the Discord app |
| Local changes don't appear | Using `wrangler dev` instead of `npm run dev` |
