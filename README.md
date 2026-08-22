# Alianza CRM Marketing 360

## Microsoft SQL Server client/server setup

The Vinext browser application never connects to SQL Server. It calls its own `/api/*` routes, which proxy authenticated requests to the TypeScript service in `social/server.mjs`; only that service owns the `mssql` connection pool.

1. Copy `.env.example` to `.env` and set `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, and `DB_TRUST_SERVER_CERTIFICATE`. For SQL Express named instances, use `DB_SERVER=localhost\SQLEXPRESS` and leave `DB_PORT` empty. The application passes the instance name to the SQL driver so SQL Server Browser can resolve the dynamic port. If SQL Server Browser is unavailable, use a fixed TCP port instead: `DB_SERVER=localhost` and `DB_PORT=<actual TCP port>`.
2. Use a least-privilege SQL login dedicated to this application. Do not commit `.env`.
3. Run `npm run db:test:mssql` first. It performs a real connection test and reports whether the failure is configuration, network/instance discovery, authentication, database access, or TLS.
4. Run `npm run db:setup:mssql` to install the tables, relationships, indexes and stored procedures.
5. Set a strong `SERVICE_AUTH_TOKEN`, then run `npm run start:social-listener`.
6. Configure the Vinext server with `SOCIAL_LISTENER_SERVICE_URL` and the matching `SOCIAL_LISTENER_SERVICE_TOKEN`.
7. Run `npm test`.

The complete form mapping is in `docs/form-table-mapping.md`. SQL Server setup scripts are applied in numeric order from `sql/`.

## Frontend development

The responsive CRM frontend runs on [vinext](https://github.com/cloudflare/vinext).
Persistent application data is owned by the separate TypeScript SQL Server service.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Social Listener

The Social Listener is a separate Node.js service so the Cloudflare Sites
dashboard can retain its runtime while social leads are persisted to Microsoft
SQL Server. The dashboard proxies status, validation, sync, metrics, campaign
automation, scoring and unified lead-timeline requests to that service.
Provider tokens never enter browser state or API responses.

1. Run `npm run db:setup:mssql`. It applies every numbered migration in `sql/`,
   including the core CRM, CRUD, social interaction, scoring and automation
   schema.
2. Copy `.env.example` to a local ignored environment file and configure the
   listener service values. `SERVICE_AUTH_TOKEN` and
   `SOCIAL_LISTENER_SERVICE_TOKEN` must contain the same secret value in their
   respective deployments.
3. Run `npm run start:social-listener` for the Node service.
4. Configure `SOCIAL_LISTENER_SERVICE_URL` and
   `SOCIAL_LISTENER_SERVICE_TOKEN` in the Vinext/Sites environment. Configure
   `SOCIAL_LISTENER_ADMIN_EMAIL` when management routes should be restricted to
   one signed-in owner.

Provider connection checks make real read-only identity requests. A channel is
reported as `connected` only after its provider returns a valid account ID.
Meta webhook delivery should target `/api/social/webhook/meta`; X ingestion uses
polling through the listener service because no X webhook capability is assumed.

### CRM brain and Sprout Social

The CRM remains the system of record and decision-maker. Campaign actions are
created in `dbo.IntegrationEvents`, claimed idempotently, executed through the
Sprout adapter, and completed with the Sprout post ID, external delivery state,
retry information, workflow run and audit history. Sprout messages and
Listening Topic results are normalized through the same CRM lead-scoring and
deduplication pipeline as direct Instagram, Facebook and X traffic.

Configure the Sprout adapter in `.env` with `SPROUT_CUSTOMER_ID`,
`SPROUT_GROUP_ID` and `SPROUT_PROFILE_IDS`. Use either `SPROUT_API_TOKEN` with
`SPROUT_AUTH_MODE=api_token`, or use the recommended machine-to-machine mode
with `SPROUT_AUTH_MODE=client_credentials`, `SPROUT_CLIENT_ID` and
`SPROUT_CLIENT_SECRET`. Add comma-separated `SPROUT_LISTENING_TOPIC_IDS` to
ingest listening messages. Run `npm run db:setup:mssql` after pulling this
version so migration `005_crm_integration_orchestration.sql` creates the action,
workflow and audit tables.

The current Sprout Public API creates posts in draft status only. “Create
Sprout draft” therefore places a draft on the Sprout Publishing Calendar and
records its `PENDING` delivery state; a user must review/publish it in Sprout.
Paid-ad account data is not available from the Sprout Public API, so paid Meta
lead forms and metrics continue to use the direct Meta adapter. X Listening is
also kept on the direct integration path.

Authenticated integration endpoints:

- `GET /integrations` and `POST /integrations/sprout/test`
- `POST /integrations/sprout/sync`
- `POST /integrations/sprout/metrics`
- `GET/POST /integration-actions`
- `POST /integration-actions/run-due`

Lead create/edit forms expose separate Facebook, Instagram, and X values. Those
values are trimmed, sent through the authenticated listener API, and persisted
in the SQL Server `dbo.Leads` table through parameterized stored procedures.
Saving empty values clears the corresponding nullable SQL columns. Editing a
legacy dashboard lead promotes/upserts it into SQL Server by email, after which
the SQL-backed record is the one displayed by the CRM.

### Multi-campaign automation

Campaigns can be `PAID` or `ORGANIC`, assigned provider campaign,
advertisement and lead-form IDs, and scheduled at an independent continuous
polling cadence. Start, pause, resume and stop operate on each campaign without
blocking other campaigns. The automation engine claims due work with SQL row
locks, executes campaigns concurrently, records metrics and last/next run
timestamps, and applies bounded retry backoff. The service checks for due
campaigns every `CAMPAIGN_AUTOMATION_INTERVAL_MS`; batch size is controlled by
`CAMPAIGN_AUTOMATION_BATCH_SIZE`.

Incoming comments, messages, mentions and lead forms are normalized into
`SocialInteractions`. Passive likes, reactions, shares, reposts and profile
visits are recorded but do not create leads. Genuine buying intent is scored
using the configurable rules in Settings, deduplicated by social account,
email or phone, and shown in the lead's 360 timeline. Raw provider payloads are
purgeable after `SOCIAL_RAW_EVENT_RETENTION_DAYS`; extracted CRM data remains.

Authenticated listener endpoints added for these modules:

- `GET/PUT /campaign-automation` and `POST /campaign-automation/action`
- `POST /campaign-automation/run-due`
- `GET/PUT /scoring`
- `GET /leads/:id/unified`

Additional commands:

- `npm run test:social`: run normalization, pipeline, API, provider-mock, and
  T-SQL contract tests
- `npm run test:smoke`: run harmless real provider identity checks, skipping
  channels whose credentials are absent
- `npm run verify:social`: print the non-secret per-channel verification report
- `npm run start:social-listener`: start the SQL Server-backed listener service

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
