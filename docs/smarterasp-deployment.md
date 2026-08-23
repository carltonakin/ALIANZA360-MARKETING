# GitHub to SmarterASP.NET deployment

## Architecture

The dashboard uses official Next.js self-hosted on Node.js. The existing
Express Social Listener and Microsoft SQL Server repository remain a separate
service. This keeps the existing App Router/API structure while removing the
Cloudflare-specific runtime from the SmarterASP production path.

## Root cause resolved

The previous production scripts invoked `vinext`, but that executable could be
absent from a production installation or unavailable on the Windows command
path. The project now uses the supported project-local Next.js CLI:

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

## Dashboard environment variables

Set these through the hosting control panel, not GitHub:

```text
NODE_ENV=production
SOCIAL_LISTENER_SERVICE_URL=https://<listener-host>
SOCIAL_LISTENER_SERVICE_TOKEN=<same value as SERVICE_AUTH_TOKEN on the listener>
```

Do not set `PORT`; the host injects it when the process starts. Use
`.env.production.example` only as a non-secret checklist.

If `SOCIAL_LISTENER_ADMIN_EMAIL` is used, the reverse proxy or authentication
layer must supply the corresponding trusted user-email header. Otherwise leave
it unset until SmarterASP authentication is configured.

## Separate Social Listener deployment

Deploy the listener as a second Node.js application when it is hosted on
SmarterASP. Its start command is:

```text
npm run start:social-listener
```

That application owns the `DB_*`/`SQL_SERVER_*` values, provider tokens,
webhook secrets, `SERVICE_AUTH_TOKEN`, and
`CHANNEL_CONFIG_ENCRYPTION_KEY`. Expose it over HTTPS and use that address as
the dashboard's `SOCIAL_LISTENER_SERVICE_URL`.

## Traditional IIS/httpPlatformHandler mode

The repository includes `web.config` for accounts that use traditional IIS
Node hosting instead of the GitHub runtime. It launches the project-local
Next.js CLI with Node, enables stdout startup logs, and maps
`%HTTP_PLATFORM_PORT%` to `PORT`.

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

Open `http://127.0.0.1:43131/` and require HTTP 200. Also test the deployed
`/api/social/status` route after the listener URL and token are configured.

## Troubleshooting

- HTTP 502: inspect `logs/stdout*.log`; verify `npm ci` and `npm run build`
  completed and that `PORT` was not overridden.
- `next` not recognized: confirm the committed lockfile was installed and the
  Start Command is `npm start`; do not install Next.js globally.
- Missing `.next/BUILD_ID`: the production build did not finish.
- Social API 502/503: verify the separate listener is reachable over HTTPS and
  the two service tokens match.
- SQL connection failure: troubleshoot the listener's database variables and
  network access; the dashboard does not connect directly to SQL Server.

Roll back by redeploying a known-good Git commit or tag. Dashboard rollback does
not alter listener or SQL Server data.

