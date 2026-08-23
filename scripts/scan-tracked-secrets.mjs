import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = new URL("../", import.meta.url);
const tracked = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: projectRoot, encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);

const privateKeyMarker = [
  "-----BEGIN ",
  "PRIVATE KEY-----",
].join("");
const prohibitedEnvironmentFile = /(^|\/)\.env(?:\..+)?$/i;
const prohibitedPrivateKeyFile = /(?:^|\/)(?:id_rsa|id_ed25519|m360|Alianzam360)$/i;
const findings = [];
let checkedFiles = 0;

for (const relativePath of tracked) {
  const normalized = relativePath.replaceAll("\\", "/");

  if (
    prohibitedEnvironmentFile.test(normalized) &&
    ![
      ".env.example",
      ".env.production.example",
    ].includes(normalized)
  ) {
    findings.push(`${relativePath}: tracked environment file`);
    continue;
  }

  if (
    prohibitedPrivateKeyFile.test(normalized) ||
    [".pfx", ".p12", ".key"].includes(
      path.extname(normalized).toLowerCase()
    )
  ) {
    findings.push(`${relativePath}: tracked private-key file`);
    continue;
  }

  const fileUrl = new URL(normalized, projectRoot);
  const stats = await lstat(fileUrl).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!stats) continue;
  if (!stats.isFile() || stats.size > 1_000_000) continue;
  checkedFiles += 1;

  const source = await readFile(fileUrl, "utf8").catch(() => "");
  if (source.includes(privateKeyMarker)) {
    findings.push(`${relativePath}: embedded private key`);
  }
}

if (findings.length) {
  console.error("Tracked-secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Tracked-secret scan passed (${checkedFiles} files checked).`);
}
