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
const webConfig = await read("web.config");

assert.match(
  packageJson.engines?.node || "",
  /22\.13\.0/,
  "package.json must declare Node.js 22.13.0 compatibility.",
);

for (const [name, command] of Object.entries({
  dev: "next dev",
  build: "next build",
  start: "next start",
  "start:smarterasp": "next start",
})) {
  assert.equal(
    packageJson.scripts?.[name],
    command,
    `${name} must use the official project-local Next.js CLI.`,
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
assert.equal(
  productionEnvironment,
  [
    "NODE_ENV=production",
    "SOCIAL_LISTENER_SERVICE_URL=https://<your-listener-domain>",
    "SOCIAL_LISTENER_SERVICE_TOKEN=<matching-service-token>",
    "",
  ].join("\n"),
  "The production environment template must contain only non-secret placeholders.",
);
assert.match(
  webConfig,
  /node_modules\\next\\dist\\bin\\next start/i,
  "web.config must launch the official Next.js production server.",
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

const nextExecutable = process.platform === "win32"
  ? "node_modules/.bin/next.cmd"
  : "node_modules/.bin/next";

await access(new URL(nextExecutable, projectRoot));
await access(new URL(".next/BUILD_ID", projectRoot));

console.log(
  "SmarterASP Next.js validation passed: official npm scripts, production dependencies, IIS dynamic PORT wiring, and build artifact.",
);
