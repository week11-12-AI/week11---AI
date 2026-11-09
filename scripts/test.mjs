import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { startServer } from "./server.mjs";

const execute = promisify(execFile);
const candidates = [
  process.env.BROWSER_PATH,
  ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .flatMap(base => [join(base, "Google", "Chrome", "Application", "chrome.exe"), join(base, "Microsoft", "Edge", "Application", "msedge.exe")]),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
];
const browser = candidates.find(candidate => candidate && existsSync(candidate));
if (!browser) throw new Error("Chrome or Edge was not found. Set BROWSER_PATH to a Chromium executable.");

const temp = await realpath(tmpdir());
const profile = await mkdtemp(join(temp, "mini-react-test-"));
let server;
try {
  server = await startServer(0);
  const url = `http://127.0.0.1:${server.address().port}/tests/browser.html`;
  const { stdout } = await execute(browser, [
    "--headless", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--no-proxy-server",
    `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=8000", url,
  ], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  const lines = [...stdout.matchAll(/<li class="(?:pass|fail)">([^<]+)<\/li>/g)];
  for (const [, line] of lines) console.log(line);
  if (!stdout.includes('data-tests="passed"') || lines.length === 0) {
    throw new Error("Browser tests did not pass. Open /tests/browser.html to inspect the results.");
  }
  console.log(`\n${lines.length} browser tests passed.`);
} finally {
  if (server) await new Promise(done => server.close(done));
  const resolved = await realpath(profile);
  if (dirname(resolved) === temp && basename(resolved).startsWith("mini-react-test-")) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  }
}
