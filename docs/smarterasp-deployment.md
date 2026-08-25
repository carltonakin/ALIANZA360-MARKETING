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
BUFFER_API_KEY=<Buffer API key>
BUFFER_ORGANIZATION_ID=<Buffer organization ID>
BUFFER_API_URL=https://api.buffer.com
CAMPAIGN_MEDIA_DIRECTORY=<persistent writable media directory>
CAMPAIGN_MEDIA_PUBLIC_BASE_URL=https://<your SmarterASP app domain>
CAMPAIGN_MEDIA_MAX_BYTES=104857600
```

Do not set `PORT`; the host injects it when the process starts. The launcher
passes that port only to Next.js and uses `SOCIAL_LISTENER_PORT` for the private
listener. Use `.env.production.example` only as a non-secret checklist. Provider
tokens and webhook secrets remain server-side control-panel values. Apply all
SQL migrations with `npm run db:setup:mssql` before using the campaign studio;
the Buffer lifecycle and campaign editing procedures are installed by
migrations 006 and 007. Grant the Node.js application write access to
`CAMPAIGN_MEDIA_DIRECTORY` and keep that directory persistent across GitHub
deployments. `CAMPAIGN_MEDIA_PUBLIC_BASE_URL` must be the stable HTTPS origin
that Buffer can reach without authentication. The included `web.config` allows
the documented 100 MB media limit plus multipart overhead. If the account-level
IIS request limit is lower, raise it in the SmarterASP control panel or ask the
host to allow the same limit.

If `SOCIAL_LISTENER_ADMIN_EMAIL` is used, the reverse proxy or authentication
layer must supply the corresponding trusted user-email header. Otherwise leave
it unset until SmarterASP authentication is configured.

## Optional separate Social Listener deployment

To keep the listener as a second Node.js application, set these dashboard
variables instead of the single-app database variables:

```text
SOCIAL_LISTENER_SERVICE_URL=https://<listener-host>
SOCIAL_LISTENER_SERVICE_TOKEN=<same value as SERVICE_AUTH_TOKEN on the listener>
```

External production URLs must use HTTPS. The separate listener starts with
`npm run start:social-listener` and owns its own `DB_*`/`SQL_SERVER_*` values.

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

Open `http://127.0.0.1:43131/` and require HTTP 200. Test `/api/data` and
`/api/social/status`; startup logs must report the MSSQL data source and a
healthy production MSSQL connection.

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

Roll back by redeploying a known-good Git commit or tag. Dashboard rollback does
not alter listener or SQL Server data.
