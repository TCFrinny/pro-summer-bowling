# Cloudflare Deployment — Pro Summer Bowling

## Architecture note (read first)

This project builds an SSR app with TanStack Start + Nitro. The Nitro build
preset here is **`cloudflare-module`** — a Cloudflare **Worker with Static
Assets**, not a classic Cloudflare Pages static build. Evidence from
`dist/nitro.json`:

```json
{ "preset": "cloudflare-module", "serverEntry": "server/index.mjs", "publicDir": "client" }
```

Cloudflare's own guidance (2025+) is that new SSR/Nitro projects deploy on
**Workers** (via **Workers Builds** for Git integration). Cloudflare Pages'
Git integration expects a static output directory (with optional Pages
Functions) — this build does not produce that shape (no `_worker.js`, no
`functions/`, and it ships a real Nitro server entry plus a `wrangler.json`
with an `assets` binding).

Use **Cloudflare Workers → Workers Builds** connected to
`TCFrinny/pro-summer-bowling` on branch `main`. That flow gives the same
"push to `main` → auto-build/deploy" UX the user wants; a custom domain is
added afterwards on the Worker just like on Pages.

If you specifically must use the Cloudflare Pages product, the project would
first need to be reconfigured to Nitro's `cloudflare-pages` preset (emits
`_worker.js` into the static output) — that is not what this repo produces
today.

## What the build produces

Running `bun run build` at the repo root:

```
dist/
  nitro.json                       # preset + serverEntry + publicDir
  client/                          # static assets (immutable, cache 1y)
    _headers                       # Cloudflare edge cache headers
    assets/                        # hashed JS/CSS
    favicon.ico
  server/
    index.mjs                      # Worker entry (SSR + server functions)
    wrangler.json                  # auto-generated Worker config
    _ssr/  _libs/  _chunks/        # code-split SSR bundles
```

Auto-generated `dist/server/wrangler.json`:

```json
{
  "name": "tanstack-start-ts",
  "main": "index.mjs",
  "compatibility_date": "2026-07-14",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "directory": "../client" },
  "no_bundle": true,
  "rules": [{ "type": "ESModule", "globs": ["**/*.mjs", "**/*.js"] }]
}
```

`.wrangler/deploy/config.json` is also generated and points wrangler at that
file, so a plain `wrangler deploy` from the repo root Just Works after
`bun run build`.

Routing: the Worker handles every request. `assets` binding serves hashed
files under `/assets/*` from `dist/client/`; anything else (including
`/bowlers/b35`, `/admin/*`, and SSR error pages) falls through to the SSR
Worker (`server/index.mjs`). No `_redirects` / SPA fallback is needed —
adding one would bypass SSR.

## Cloudflare Workers Builds — dashboard settings

Create a Worker → **Deploy from Git** → repo `TCFrinny/pro-summer-bowling`.

| Field                        | Value                                 |
| ---------------------------- | ------------------------------------- |
| Production branch            | `main`                                |
| Build command                | `bun install && bun run build`        |
| Deploy command               | `bunx wrangler deploy`                |
| Root directory               | `/` (repo root)                       |
| Non-production branch deploy | Optional — enable for preview builds  |

Compatibility settings are already embedded in the generated
`dist/server/wrangler.json` (`compatibility_date: 2026-07-14`,
`compatibility_flags: ["nodejs_compat"]`); no dashboard override needed.

## Environment variables to set in the Worker

Names only — set values in Cloudflare → Worker → Settings → Variables.
Never paste the service-role key into a `VITE_*` name; `VITE_*` vars are
inlined into the client bundle at build time.

Client bundle (public, required at BUILD time — must exist during the
Workers Builds step, not just at runtime):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Server-only (used by SSR + server functions at REQUEST time):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  ← must remain server-only; never as `VITE_*`

The server-side Supabase clients read `process.env.*` inside handler bodies
(see `src/integrations/supabase/client.server.ts` and `auth-middleware.ts`).
Any `VITE_*` variable is safe to expose in the browser; anything else must
NOT be prefixed `VITE_`.

## Custom domain

After the first successful deploy, add the domain on the Worker
(Settings → Domains & Routes → Add Custom Domain). DNS is managed
automatically when the zone is on Cloudflare.

## Local verification (no deploy)

```
bun run typecheck
bun run test:deterministic
bun run build
# optional: npx wrangler dev  (from repo root — reads .wrangler/deploy/config.json)
```
