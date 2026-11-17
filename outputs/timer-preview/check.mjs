import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = await realpath(tmpdir());
const temporary = await mkdtemp(join(base, "mini-react-timer-preview-"));
const data = join(temporary, "data");
await mkdir(data);
await copyFile(join(root, "tests", "fixtures", "legacy-js.jsonl"), join(data, "transactions.jsonl"));
let server, chrome, socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
try {
  server = spawn(process.execPath, [join(root, "scripts", "python.mjs"), "server.py", "--port", "0", "--data-dir", data, "--stdio-control"], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const info = await new Promise((done, fail) => {
    let buffer = "", errors = "";
    const timeout = setTimeout(() => fail(new Error("Server startup timeout: " + errors)), 10000);
    server.stderr.on("data", chunk => { errors += chunk; });
    server.on("error", fail);
    server.stdout.on("data", chunk => { buffer += chunk; if (buffer.includes("\n")) { clearTimeout(timeout); done(JSON.parse(buffer.split("\n")[0])); } });
  });
  const url = `http://127.0.0.1:${info.port}`;
  const post = async (path, body) => {
    const response = await fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  };
  for (const [nickname, delay] of [["테스트 A", 350], ["테스트 B", 150]]) {
    const attempt = await post("/api/challenge/start", {});
    await sleep(delay);
    await post("/api/challenge/finish", { attemptId: attempt.attemptId, moves: attempt.scramble });
    await post("/api/records", { attemptId: attempt.attemptId, puzzleId: attempt.id, nickname });
  }
  const browser = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean)
    .flatMap(path => [join(path, "Google", "Chrome", "Application", "chrome.exe"), join(path, "Microsoft", "Edge", "Application", "msedge.exe")]).find(existsSync);
  const profile = join(temporary, "chrome");
  chrome = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let port;
  for (let i = 0; i < 200; i++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await sleep(25); }
  }
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  const pending = new Map(); let serial = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data), job = pending.get(message.id);
    if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.fail(new Error(JSON.stringify(message.error))) : job.done(message.result); }
  });
  const call = (method, params = {}) => new Promise((done, fail) => {
    const id = ++serial, timer = setTimeout(() => fail(new Error(`CDP timeout: ${method}`)), 10000);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1850, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise(done => {
    const listener = event => { if (JSON.parse(event.data).method === "Page.loadEventFired") { socket.removeEventListener("message", listener); done(); } };
    socket.addEventListener("message", listener);
  });
  await call("Page.navigate", { url }); await loaded;
  const ready = await call("Runtime.evaluate", { expression: `(async () => {
    const until = async check => { for (let i=0;i<100;i++) { if(check()) return; await new Promise(done=>setTimeout(done,30)); } throw new Error('UI timeout'); };
    await until(()=>document.querySelectorAll('#ranking-list li').length===3);
    document.querySelector('#start-challenge').click();
    await until(()=>document.querySelector('#game-mode').textContent.includes('랜덤') && !document.querySelector('#start-challenge').disabled);
    document.querySelector('[data-cell="12"]').click();
    await new Promise(done=>setTimeout(done,500)); return true;
  })()`, awaitPromise: true, returnByValue: true });
  if (ready.exceptionDetails) throw new Error(JSON.stringify(ready));
  for (const [name, width, height] of [["desktop", 1280, 1850], ["mobile", 390, 2400]]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: name === "mobile" });
    const layout = await call("Runtime.evaluate", { expression: "({width:innerWidth, overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})", returnByValue: true });
    if (layout.result.value.overflow) throw new Error(JSON.stringify(layout));
    const screenshot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
    const output = fileURLToPath(new URL(`./${name}.png`, import.meta.url));
    await writeFile(output, Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify({ ...layout.result.value, output }));
  }
  await call("Browser.close");
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(done => chrome.once("exit", done)); }
  if (server && server.exitCode === null) {
    const exited = new Promise(done => server.once("exit", done)); server.stdin.end("shutdown\n"); await exited;
  }
  const resolved = await realpath(temporary);
  if (dirname(resolved) === base && basename(resolved).startsWith("mini-react-timer-preview-")) await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
