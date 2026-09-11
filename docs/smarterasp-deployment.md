# GitHub to SmarterASP.NET deployment

## Architecture

The dashboard uses official Next.js self-hosted on Node.js. By default, the
production launcher starts the existing Express Social Listener inside the
same SmarterASP Node application on a private loopback port. The listener owns
the existing Microsoft SQL Server repository and Next.js continues to call it
through the existing route handlers.

## Root cause resolved

Local startup launched the SQL-backed listener before Next.js, but the
published `npm start` command launched only Next.js. Without a separately
deployed listener URL, published API routes could not reach MSSQL. The
production command now launches and health-checks the listener before starting
the supported project-local Next.js server:

```text
Install: npm ci
Build:   npm run build
Start:   npm start
```

No global framework installation or shell-based child-process wrapper is
required.

## GitHub Deploy settings

Configure the SmarterASP Node.js application with:

- Repository: `https://github.com/carltonakin/ALIANZA360-MARKETING.git`
- Branch: `main`
- Node.js: `22.13.0` or a compatible Node.js 22 release
- Install Command: `npm ci`
- Build Command: `npm run build`
- Start Command: `npm start`
- Output Directory: leave empty
- Port: do not configure; SmarterASP supplies `PORT`

The deployment must include `package.json`, `package-lock.json`, `.next/` from
the hosting build, `public/`, `next.config.ts`, and the application source.
Do not upload a local `node_modules` directory.

## Single-app production environment variables

Set these through the hosting control panel, not GitHub:

```text
NODE_ENV=production
SERVICE_AUTH_TOKEN=<strong-random-service-token>
SOCIAL_LISTENER_PORT=8788
DB_SERVER=<SmarterASP SQL server>
DB_PORT=1433
DB_NAME=<database name>
DB_USER=<database user>
DB_PASSWORD=<database password>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
CHANNEL_CONFIG_ENCRYPTION_KEY=<strong-random-encryption-key>
AI_PROVIDER_ENCRYPTION_KEY=<strong-random-encryption-key>
AI_CAMPAIGN_AUTOMATION_INTERVAL_MS=300000
BUFFER_API_KEY=<Buffer API key>
BUFFER_ORGANIZATION_ID=<Buffer organization ID>
BUFFER_API_URL=https://api.buffer.com
CLOUDINARY_CLOUD_NAME=<Cloudinary cloud name>
CLOUDINARY_API_KEY=<Cloudinary API key>
CLOUDINARY_API_SECRET=<Cloudinary API secret>
CLOUDINARY_CAMPAIGN_FOLDER=crm-marketing/campaigns
CLOUDINARY_UPLOAD_PRESET=
CAMPAIGN_MEDIA_MAX_BYTES=314572800
```

Do not set `PORT`; the host injects it when the process starts. The launcher
passes that port only to Next.js and uses `SOCIAL_LISTENER_PORT` for the private
listener. Use `.env.production.example` only as a non-secret checklist. Provider
tokens and webhook secrets remain server-side control-panel values. Apply all
SQL migrations with `npm run db:setup:mssql` before using the campaign studio;
the Buffer lifecycle and campaign editing procedures are installed by
migrations 006 through 008, Cloudinary identity persistence by migration 010,
CRM authentication/user administration by migration 011, and live CRM reporting
by migration 015. Migration 017 adds landing-page video/CTA/player fields and
normalized registration handles. Migration 018 includes landing-page registrations
in the existing interaction-history lead scoring procedure. Migration 019
idempotently restores recognized legacy video links and repairs historical
landing registrations that predated the scoring event path. Migration 020 adds
Cloudinary-backed landing-page pictures, explicit video/picture selection and
ordering, and an independently persisted CTA enabled state; it does not modify
the scoring procedure, scoring rules, or temperature thresholds. Migration 021
installs the modular Landing Page Studio blocks and visitor analytics. Migration
022 makes MSSQL authoritative for new landing-registration UTC timestamps and
adds deterministic newest-first ordering to the unified lead query. Migration 023
keeps the same UTC storage while the browser formats timestamps in the active
device timezone. It also suppresses exact one-to-one interaction/activity mirrors
from the unified projection without deleting either source record. No historical
timestamps are rewritten. Create a
Cloudinary product environment and copy its cloud name, API key,
and API secret from Cloudinary's API Keys settings. Keep the secret server-side
and never use a `NEXT_PUBLIC_` name. The optional upload preset must permit
authenticated server uploads if configured. The included `web.config` allows the
documented 300 MB media limit plus multipart overhead. If the account-level IIS
request limit is lower, raise it in the SmarterASP control panel or ask the host
to allow the same limit.

Deploy the application code and set the `CLOUDINARY_*` variables before running
`npm run db:setup:mssql` for migration 010. Complete those steps in the same
maintenance window: migration 010 makes Cloudinary identity fields mandatory
for newly saved campaign media, so an older application build must not continue
writing campaigns after the procedure is upgraded.

The dashboard and listener both use `POST /api/media` for multipart uploads.
The listener validates the actual bytes and uploads them directly to Cloudinary.
It returns success only after Cloudinary supplies a valid HTTPS `secure_url`.
No application-root or `App_Data` write permission is required for campaign
media. Existing campaigns with legacy local media URLs must have their media
replaced through the campaign editor before they can be rescheduled.

Landing-page MP4/MOV videos and JPEG/PNG/WebP/GIF pictures reuse the same
authenticated `/api/media` route and Cloudinary configuration. Deploy migrations
017 through 023 before publishing the new builder and timeline update. Replacement and removal save
the landing-page record first, then ask
Cloudinary to delete the old asset only after both campaign and landing-page
references have been checked.

## Rebrand and landing-registration release checklist

1. Pull the release from `main` in the SmarterASP GitHub deployment.
2. Run `npm ci`, then `npm run build`.
3. With the production `DB_*` values loaded, run `npm run db:setup:mssql` so
   migration 018 updates `dbo.LeadScore_Recalculate`, migration 019 repairs
   pre-existing registration events and recognized legacy video links, and
   migration 020 installs picture/media-order/CTA-state persistence.
4. Restart the Node application with `npm start`; no new environment variables
   and no n8n scoring step are required.
5. Sign in and confirm the Next2TheTop CRM logo/name on the login and dashboard.
6. Save and reload a landing page with an HTTPS Post URL Link, submit a test
   registration, and confirm the Lead is persisted/scored before the redirect.
7. Submit a page with a blank Post URL Link and confirm the existing success card
   remains; verify `javascript:`, `data:`, and `file:` destinations are rejected.
8. Confirm the test Lead appears in Lead 360 and reports with `LeadScore`,
   `ScoreBand`, the five component scores, `ScoreReason`, and `LastScoredAt`.
9. Reload the edited landing page and its public URL. Confirm its configured
   Cloudinary, YouTube, Vimeo, or Canva player and optional Cloudinary picture
   appear above the teaser in the saved order. Video should attempt muted inline
   autoplay with controls, and the CTA should appear only when explicitly enabled.
10. Confirm the Unified Lead Timeline shows the newest event first, shows each
    source event once, and formats its canonical UTC timestamp in the browser's
    device timezone. Migrations 022 and 023 are idempotent and do not require new
    environment variables or an n8n workflow change. The read-only duplicate
    audit is available in `sql/diagnostics/timeline_duplicate_dry_run.sql`.

## Multi-provider AI campaign release checklist

1. Pull the release from `main`, run `npm ci`, and run `npm run build`.
2. Set `AI_PROVIDER_ENCRYPTION_KEY` to a base64-encoded 32-byte secret in the
   SmarterASP control panel. It may be omitted only when the existing
   `CHANNEL_CONFIG_ENCRYPTION_KEY` should intentionally encrypt both kinds of
   server-side credentials.
3. Set `AI_CAMPAIGN_AUTOMATION_INTERVAL_MS=300000` (or another value of at
   least 60000 milliseconds).
4. Run `npm run db:setup:mssql` with the production `DB_*` values so migration
   024 installs the Company Profile, provider configuration, AI campaign
   configuration, generation history, indexes, and stored procedures.
5. Restart the Node application. In Settings, save the Company Profile, save
   each provider API key and model, enable the intended providers, select one
   default, and run each connection test.
6. In Campaign Studio, create an AI campaign using only live Facebook or
   Instagram accounts returned by Buffer. Use draft publishing for review, or
   production publishing to schedule through the existing Buffer flow.
7. Confirm the first run creates ordinary `Campaigns` and `CampaignPosts`
   records, and confirm a repeated Generate Today action reports an idempotent
   skip instead of creating another post.

No AI provider key belongs in a `NEXT_PUBLIC_*` variable. Provider keys are
entered through the admin UI, encrypted in MSSQL, masked in all responses, and
never passed to n8n. Existing n8n webhook URLs and comment/DM workflows are
unchanged.

The CRM uses its own MSSQL-backed users and sessions. The listener creates the
`next2thetop` ADMIN account only when absent and never resets it during later
starts. Apply migration 011 before starting the new build; otherwise the
authentication bootstrap correctly fails rather than running without login
protection.

## Authentication route ownership and environments

Next.js App Router owns the single public login endpoint at
`app/api/auth/login/route.ts` and exports its `POST` handler. It delegates to
the existing Express listener at `/auth/login`; Express does not register a
competing public `/api/auth/login` route. Browser code uses only the relative
`/api/auth/login` URL, so the same code runs on localhost and the deployed
hostname.

Local development reads the ignored `.env` and uses its configured MSSQL
database through `npm run dev`. SmarterASP uses the control-panel `DB_*` values.
To share accounts between localhost and production, configure both environments
for the same intended MSSQL database; otherwise users created in one database
will not appear in the other. Never change either database target silently.

The session cookie is HttpOnly, SameSite=Lax, and scoped to `/`. Development
uses `Secure=false` for plain HTTP localhost. Production uses `Secure=true` and
must be served over HTTPS. No session token or password hash is exposed to the
browser.

## Optional separate Social Listener deployment

To keep the listener as a second Node.js application, set these dashboard
variables instead of the single-app database variables:

```text
SOCIAL_LISTENER_SERVICE_URL=https://<listener-host>
SOCIAL_LISTENER_SERVICE_TOKEN=<same value as SERVICE_AUTH_TOKEN on the listener>
```

External production URLs must use HTTPS. The separate listener starts with
`npm run start:social-listener` and owns its own `DB_*`/`SQL_SERVER_*` values.
The external listener also owns the `CLOUDINARY_*` credentials and performs all
campaign media uploads and safe unreferenced-asset deletions. The dashboard
never receives the Cloudinary API secret.

## Traditional IIS/httpPlatformHandler mode

The repository includes `web.config` for accounts that use traditional IIS
Node hosting instead of the GitHub runtime. It launches the production stack
with Node, enables stdout startup logs, and maps `%HTTP_PLATFORM_PORT%` to
`PORT`.

Confirm that the account has httpPlatformHandler enabled and that Node is
installed at `%ProgramFiles%\nodejs\node.exe`. If SmarterASP supplies a
different Node executable path, change only `processPath` in `web.config`.

## Pre-deployment validation

```powershell
npm ci
npm run lint
npm run build
npm run validate:smarterasp
$env:NODE_ENV = "production"
$env:PORT = "43131"
npm start
```

Open `http://127.0.0.1:43131/login` and require HTTP 200. Confirm unauthenticated
requests to `/api/data` return 401, sign in, and then test `/api/data` and
`/api/social/status`; startup logs must report the MSSQL data source and a
healthy production MSSQL connection.

Before publishing, also confirm:

- Migration 011 and its auth stored procedures exist in the target MSSQL
  database, and intended users have a non-plaintext `PasswordHash`, role, and
  active state.
- SmarterASP has `NODE_ENV=production`, the correct `DB_*` values,
  `SERVICE_AUTH_TOKEN`, and the remaining required server-only variables.
- `SOCIAL_LISTENER_SERVICE_URL` is empty for single-app mode, or is the intended
  external HTTPS listener with a matching `SOCIAL_LISTENER_SERVICE_TOKEN`.
- `npm run build` lists `/api/auth/login`, and a production-mode local POST to
  that route returns 401 for invalid credentials rather than 404.
- `.env` and all password/session/provider secrets remain untracked.

Publish the latest `main` commit with `npm ci`, `npm run build`, and `npm start`,
then restart or recycle the Node application so new routes and environment
values are loaded. Do not rewrite the browser's relative login URL.

After publishing, verify over the deployed HTTPS origin:

1. `/login` loads and `POST /api/auth/login` returns 401—not 404—for invalid
   credentials.
2. A valid ADMIN login sets a Secure, HttpOnly, SameSite=Lax cookie and can open
   User Management and Settings after a refresh.
3. A valid BASIC login succeeds but receives 403 for ADMIN-only APIs and cannot
   open User Management or Settings.
4. Logout expires the cookie and protected endpoints return 401 afterward.
5. `LastLoginAt` changes for the signed-in user, no duplicate user is created,
   and the request used the intended production `dbo.AppUsers` table.

## Troubleshooting

- HTTP 502: inspect `logs/stdout*.log`; verify `npm ci` and `npm run build`
  completed and that `PORT` was not overridden.
- `next` not recognized: confirm the committed lockfile was installed and the
  Start Command is `npm start`; do not install Next.js globally.
- Missing `.next/BUILD_ID`: the production build did not finish.
- Social API 502/503 in single-app mode: verify `SERVICE_AUTH_TOKEN`, `DB_*`,
  and `SOCIAL_LISTENER_PORT`; inspect the safe startup health message.
- Social API 502/503 in external mode: verify the HTTPS listener URL and that
  the two service tokens match.
- SQL connection failure: troubleshoot the listener's database variables and
  SmarterASP network access; the browser never connects directly to SQL Server.
- Campaign media HTTP 502/503: verify `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`, then inspect the safe server
  log. Upload a small image through `POST /api/media` and open the returned
  `mediaUrl` in a signed-out browser; it must return the media MIME type, not
  HTML. Never paste the API secret into browser code or logs.

Roll back by redeploying a known-good Git commit or tag. Dashboard rollback does
not alter listener or SQL Server data.
