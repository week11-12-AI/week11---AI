// Optional npm convenience launcher. All server/DBMS/test logic is Python.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const candidates = [process.env.PYTHON, join(root, ".venv", "Scripts", "python.exe"), join(root, ".venv", "bin", "python")];
if (process.env.LOCALAPPDATA) {
  for (const base of [join(process.env.LOCALAPPDATA, "Python"), join(process.env.LOCALAPPDATA, "Programs", "Python")]) {
    if (existsSync(base)) {
      for (const item of readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory() && /^(pythoncore-|Python3)/i.test(item.name)).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
        candidates.push(join(base, item.name, "python.exe"));
      }
    }
  }
}
candidates.push("python", "python3", "py");
let python;
for (const command of [...new Set(candidates.filter(Boolean))]) {
  try {
    execFileSync(command, ["-X", "utf8", "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
    python = command; break;
  } catch { /* Try the next installed interpreter. */ }
}
if (!python) throw new Error("Python 3.11+ is required. Install Python or set PYTHON to its executable path.");
const child = spawn(python, ["-X", "utf8", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  // Windows console sends Ctrl+C to the Python child too; kill() would bypass cleanup.
  if (process.platform !== "win32") child.kill(signal);
});
