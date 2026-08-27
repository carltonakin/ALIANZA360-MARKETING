import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

const packageJson = JSON.parse(await read("package.json"));
const lockfile = JSON.parse(await read("package-lock.json"));
const nextConfig = await read("next.config.ts");
const socialConfig = await read("app/api/social/_config.ts");
const productionEnvironment = await read(".env.production.example");
const productionLauncher = await read("scripts/start-production.mjs");
const webConfig = await read("web.config");

assert.match(
  packageJson.engines?.node || "",
  /22\.13\.0/,
  "package.json must declare Node.js 22.13.0 compatibility.",
);

for (const [name, command] of Object.entries({
  dev: "node scripts/start-local.mjs",
  "dev:local": "node scripts/start-local.mjs",
  "dev:next": "next dev",
  build: "next build",
  start: "node --env-file-if-exists=.env scripts/start-production.mjs",
  "start:smarterasp": "node --env-file-if-exists=.env scripts/start-production.mjs",
})) {
  assert.equal(
    packageJson.scripts?.[name],
    command,
    `${name} must use the expected official runtime command.`,
  );
}

assert.ok(
  Number(lockfile.lockfileVersion) >= 3,
  "A current npm lockfile is required for deterministic installation.",
);

for (const name of ["next", "react", "react-dom"]) {
  assert.ok(
    packageJson.dependencies?.[name],
    `${name} must be a production dependency for npm start.`,
  );
  const lockedPackage = lockfile.packages?.[`node_modules/${name}`];
  assert.ok(lockedPackage, `${name} must be present in package-lock.json.`);
  assert.notEqual(
    lockedPackage.dev,
    true,
    `${name} must not be omitted from a production installation.`,
  );
}

const removedPackages = [
  "vinext",
  "@cloudflare/vite-plugin",
  "@cloudflare/workers-types",
  "@openai/sites-vite-plugin",
  "@vitejs/plugin-react",
  "@vitejs/plugin-rsc",
  "react-server-dom-webpack",
  "vite",
  "wrangler",
];

for (const name of removedPackages) {
  assert.equal(
    packageJson.dependencies?.[name] || packageJson.devDependencies?.[name],
    undefined,
    `${name} must not remain a direct dependency.`,
  );
}

assert.ok(
  Object.values(packageJson.scripts || {}).every(
    (script) => !/vinext|vite|wrangler/i.test(script),
  ),
  "No production or development script may invoke the removed runtime.",
);
assert.match(
  nextConfig,
  /NextConfig/,
  "The project must retain a standard Next.js configuration.",
);
assert.match(
  socialConfig,
  /process\.env/,
  "The SmarterASP social configuration must read Node environment variables.",
);
assert.doesNotMatch(
  socialConfig,
  /cloudflare:workers/,
  "The SmarterASP Node runtime cannot load the cloudflare:workers URL scheme.",
);
for (const name of [
  "NODE_ENV",
  "SERVICE_AUTH_TOKEN",
  "SOCIAL_LISTENER_PORT",
  "DB_SERVER",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_ENCRYPT",
  "DB_TRUST_SERVER_CERTIFICATE",
  "CHANNEL_CONFIG_ENCRYPTION_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_CAMPAIGN_FOLDER",
  "CLOUDINARY_UPLOAD_PRESET",
  "CAMPAIGN_MEDIA_MAX_BYTES",
]) {
  assert.match(
    productionEnvironment,
    new RegExp(`^${name}=`, "m"),
    `.env.production.example must document ${name}.`,
  );
}
assert.doesNotMatch(
  productionEnvironment,
  /^(DB_PASSWORD|SERVICE_AUTH_TOKEN|CHANNEL_CONFIG_ENCRYPTION_KEY|CLOUDINARY_API_SECRET)=(?!<)[^\r\n]+/m,
  "The production environment template must contain only non-secret placeholders.",
);
assert.match(
  productionLauncher,
  /Production data source selected: MSSQL/i,
  "The production launcher must log the selected MSSQL data path without credentials.",
);
assert.match(
  productionLauncher,
  /SOCIAL_LISTENER_SERVICE_URL: serviceUrl/i,
  "The production launcher must route Next.js to the internal SQL-backed listener.",
);
assert.match(
  productionLauncher,
  /await waitForListener\(listener, topology\.healthUrl\)/i,
  "The dashboard must wait for a successful MSSQL health check.",
);
assert.match(
  webConfig,
  /scripts\\start-production\.mjs/i,
  "web.config must launch the production MSSQL/Next.js stack.",
);
assert.match(
  webConfig,
  /name="PORT" value="%HTTP_PLATFORM_PORT%"/i,
  "web.config must pass IIS's dynamic HTTP platform port as PORT.",
);
assert.match(
  webConfig,
  /stdoutLogEnabled="true"/i,
  "web.config must enable startup diagnostics.",
);
assert.match(
  webConfig,
  /maxAllowedContentLength="315621376"/i,
  "web.config must allow the documented 300 MB campaign media upload plus multipart overhead.",
);

const nextExecutable = process.platform === "win32"
  ? "node_modules/.bin/next.cmd"
  : "node_modules/.bin/next";

await access(new URL(nextExecutable, projectRoot));
await access(new URL(".next/BUILD_ID", projectRoot));

console.log(
  "SmarterASP validation passed: production MSSQL launcher, dependencies, IIS dynamic PORT wiring, and Next.js build artifact.",
);
