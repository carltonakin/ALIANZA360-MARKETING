import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function publicEvidenceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !url.hostname.includes(".") || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || isIP(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

export function publicEvidenceAddress(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Pin the validated public address to the socket, including on redirects, to prevent DNS rebinding.
async function readPublicPage(value, signal, redirects = 0) {
  const url = publicEvidenceUrl(value);
  if (!url) throw new Error("Evidence URL must be a public HTTPS page.");
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (signal.aborted) throw new Error("Evidence request timed out.");
  if (!addresses.length || addresses.some(({ address }) => !publicEvidenceAddress(address))) throw new Error("Non-public evidence host.");
  const response = await new Promise((resolve, reject) => {
    const req = request(url, {
      signal, agent: false,
      headers: { "user-agent": "Next2TheTopAcquisition/1.0", accept: "text/html,text/plain", "accept-encoding": "identity" },
      lookup: (_host, options, callback) => callback(null, ...(options.all ? [[addresses[0]]] : [addresses[0].address, 4])),
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 512_000) { res.destroy(new Error("Evidence page exceeds the size limit.")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8"), url: url.href }));
    });
    req.on("error", reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 2 || !response.headers.location) throw new Error("Evidence redirect limit reached.");
    return readPublicPage(new URL(response.headers.location, url).href, signal, redirects + 1);
  }
  return response;
}

export function robotsAllows(text, path) {
  const groups = [];
  let group = { agents: [], rules: [] };
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, "").match(/^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    if (match[1].toLowerCase() === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(match[2].toLowerCase());
    } else if (match[2]) group.rules.push({ allow: match[1].toLowerCase() === "allow", path: match[2] });
  }
  groups.push(group);
  const specific = groups.filter((item) => item.agents.some((agent) => "next2thetopacquisition".includes(agent) && agent !== "*"));
  const selected = specific.length ? specific : groups.filter((item) => item.agents.includes("*"));
  const matches = selected.flatMap((item) => item.rules).filter((rule) => {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

export async function fetchAcquisitionEvidence(value, { signal = AbortSignal.timeout(5000) } = {}) {
  const url = publicEvidenceUrl(value);
  if (!url) throw new Error("Invalid evidence URL.");
  const robots = await readPublicPage(new URL("/robots.txt", url).href, signal);
  if (robots.status !== 404 && (robots.status !== 200 || !robotsAllows(robots.text, url.pathname + url.search))) throw new Error("Source access rules block evidence retrieval.");
  // Redirects to a different page require their own robots check; skip rather than bypass access rules.
  const page = await readPublicPage(url.href, signal, 2);
  if (page.status !== 200 || !/^(text\/html|text\/plain)/i.test(page.headers["content-type"] || "")) throw new Error("Evidence page is unavailable.");
  if (page.url !== url.href) throw new Error("Evidence redirect could not be verified.");
  return { url: page.url, text: evidenceText(page.text) };
}

export function evidenceText(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code) => {
      const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : " ";
    }).replace(/&(amp|nbsp|quot|apos|lt|gt);/gi, (_match, name) => ({ amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">" })[name.toLowerCase()])
    .replace(/\s+/g, " ").trim();
}
