# Alianza CRM Marketing 360

Alianza CRM Marketing 360 uses an official Next.js dashboard, an Express
Social Listener service, and Microsoft SQL Server.

```text
Browser -> Next.js route handlers -> Express Social Listener -> SQL Server
```

Only the Social Listener owns the `mssql` connection pool. Database and
provider secrets stay on the server and are never returned to the browser.

## Requirements

- Node.js `22.13.0` or a compatible Node.js 22 release
- npm and the committed `package-lock.json`
- Microsoft SQL Server reachable from the Social Listener

## Configure SQL Server

Copy `.env.example` to the ignored `.env` file and configure either
`SQL_SERVER_CONNECTION_STRING` or the individual values `DB_SERVER`,
`DB_NAME`, `DB_USER`, and `DB_PASSWORD`. For SQL Express, use
`DB_SERVER=localhost\SQLEXPRESS` and leave `DB_PORT` empty, or configure a
fixed TCP port.

Set a strong `SERVICE_AUTH_TOKEN`. The hosted dashboard's
`SOCIAL_LISTENER_SERVICE_TOKEN` must contain the same value.

```powershell
npm ci
npm run db:test:mssql
npm run db:setup:mssql
```

The numbered scripts in `sql/` create the CRM, social-listener, campaign,
scoring, automation, integration, and audit storage surfaces. The application
form-to-table mapping is documented in `docs/form-table-mapping.md`.

## Launch locally

Start the complete SQL-backed application with one command:

```powershell
npm run dev:local
```

The launcher reads `.env`, starts the Social Listener, waits until its real SQL
health check succeeds, and then starts Next.js. Open
`http://localhost:3000/`. `LOCAL_APP_PORT` and `SOCIAL_LISTENER_PORT` can change
the two local ports. Press Ctrl+C to stop both processes.

To run the dashboard or listener independently:

```powershell
npm run dev
npm run start:social-listener
```

## Production deployment

The production launcher honors SmarterASP's host-provided `PORT`, starts the
Express/MSSQL Social Listener on an internal loopback port, requires its real
SQL health check to pass, and then starts Next.js. This gives the published app
the same SQL-backed data path as local development. GitHub and
IIS/httpPlatformHandler deployment instructions are in
`docs/smarterasp-deployment.md`.

Required single-app SmarterASP production variables:

```text
NODE_ENV=production
SERVICE_AUTH_TOKEN=<strong-random-token>
DB_SERVER=<SmarterASP SQL host>
DB_PORT=1433
DB_NAME=<database name>
DB_USER=<database user>
DB_PASSWORD=<database password>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
CHANNEL_CONFIG_ENCRYPTION_KEY=<strong-random-key>
BUFFER_API_KEY=<Buffer API key>
BUFFER_ORGANIZATION_ID=<Buffer organization ID>
BUFFER_API_URL=https://api.buffer.com
CAMPAIGN_MEDIA_DIRECTORY=<persistent writable directory>
CAMPAIGN_MEDIA_PUBLIC_BASE_URL=https://<public app domain>
CAMPAIGN_MEDIA_MAX_BYTES=104857600
```

An independently deployed listener remains supported by setting an external
HTTPS `SOCIAL_LISTENER_SERVICE_URL` and matching
`SOCIAL_LISTENER_SERVICE_TOKEN`; in that mode the dashboard launcher does not
start an internal listener. Never commit a filled `.env` file.

## Social and campaign services

Campaign publishing uses Buffer's server-side GraphQL API. The campaign form
loads its selectable channels live from the configured Buffer organization,
saves the campaign and a draft `CampaignPosts` row for every selected channel,
and only then sends exact `customScheduled` UTC requests to Buffer. The CRM
stores Buffer IDs, lifecycle state, publish times, platform URLs, and safe
failures in SQL Server. Use `npm run db:setup:mssql` after pulling this version
to apply migrations 006 and 007.

Buffer requires `BUFFER_API_KEY` and `BUFFER_ORGANIZATION_ID` in the listener
environment. Keep both server-only; never prefix them with `NEXT_PUBLIC_` or
commit them. The campaign editor accepts drag/drop or file browsing for JPEG,
PNG, WebP, GIF, MP4, and MOV media. Files are signature-, extension-, MIME-,
and size-validated on the server, written to `CAMPAIGN_MEDIA_DIRECTORY`, and
served from the stable HTTPS origin in `CAMPAIGN_MEDIA_PUBLIC_BASE_URL`. SQL
stores only the media URL and metadata, never the large binary. Use a persistent
writable SmarterASP directory so scheduled media remains available until Buffer
publishes it.

Campaigns support POST, REEL, and STORY. Instagram and Facebook receive their
documented channel-specific `metadata.<service>.type` values; Reel requires
video and Story requires image or video. Saved SQL campaigns reopen in the same
editor. Eligible scheduled posts use Buffer `editPost`, preserving
`CampaignPostId` and `BufferPostId`; published posts and unsafe channel removal
are rejected rather than duplicated. Buffer's public schema exposes the
`aiAssisted` tracking field but no AI content-generation operation, so this app
does not fabricate a Buffer AI endpoint or substitute another provider.

Provider connection checks make real read-only identity requests. A channel is
reported as connected only after the provider returns a valid identity. Meta
webhooks use `/api/social/webhook/meta`; X ingestion uses listener polling.

The CRM is the system of record for Facebook, Instagram, X, and Sprout data.
Lead social fields, campaigns, landing pages, webinars, generated drafts,
automation state, metrics, and integration actions are stored through
parameterized SQL Server procedures. Campaigns support independent production
mode, scheduling, retries, and attribution.

The existing Sprout and direct-provider adapters remain available to the
inbound Social Listener, but the campaign studio no longer uses their channel
configuration or publishing controls. Sprout configuration supports an API token or OAuth client credentials. Set
the applicable `SPROUT_*` values in the listener environment. Sprout publishing
creates reviewable drafts and stores its external identifiers and delivery
state in SQL Server.

## Commands

- `npm run dev:local` — start the local listener and Next.js dashboard
- `npm run dev` — start only the Next.js development server
- `npm run build` — create the production Next.js build
- `npm start` — start the production SQL-backed listener and Next.js dashboard using `PORT`
- `npm test` — build and run the complete regression suite
- `npm run lint` — run ESLint
- `npm run security:scan` — scan tracked files for credential patterns
- `npm run validate:smarterasp` — validate Next.js/IIS deployment prerequisites
- `npm run db:test:mssql` — test the real `.env` SQL connection
- `npm run db:setup:mssql` — apply the numbered T-SQL setup scripts
- `npm run test:social` — run social, API, automation, and SQL contract tests
- `npm run test:smoke` — run configured provider identity smoke tests
- `npm run verify:social` — print a non-secret channel readiness report
