import html
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from .server_process import ServerProcess


def find_browser():
    candidates = [os.getenv("BROWSER_PATH")]
    for base in (os.getenv("ProgramFiles"), os.getenv("ProgramFiles(x86)"), os.getenv("LOCALAPPDATA")):
        if base:
            candidates.extend(str(Path(base) / path) for path in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"))
    candidates.extend([shutil.which("chromium"), shutil.which("chromium-browser"), shutil.which("google-chrome"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"])
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("Chrome or Edge was not found. Set BROWSER_PATH.")


def run_browser(browser, profile, url):
    result = subprocess.run([browser, "--headless", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
                             "--disable-background-networking", "--disable-component-update", "--no-proxy-server",
                             f"--user-data-dir={profile}", "--dump-dom", "--virtual-time-budget=8000", url],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=40,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    lines = re.findall(r'<li class="(?:pass|fail)">([^<]+)</li>', result.stdout)
    for line in lines:
        print(html.unescape(line))
    if result.returncode or 'data-tests="passed"' not in result.stdout or not lines:
        raise RuntimeError("Browser tests did not pass. Open /tests/browser.html to inspect results.")
    return len(lines)


def main():
    browser = find_browser()
    # All DB writes and browser profiles are disposable, never the user's data/.
    with tempfile.TemporaryDirectory(prefix="mini-react-python-test-", ignore_cleanup_errors=True) as folder:
        directory = Path(folder)
        server = ServerProcess(directory / "data")
        try:
            port = server.port
            passed = run_browser(browser, directory / "chrome", server.url + "/tests/browser.html?lifecycle=prepare")
            server.close()
            server = None
            server = ServerProcess(directory / "data", port)
            passed += run_browser(browser, directory / "chrome", server.url + "/tests/browser.html?lifecycle=restart")
            print(f"\n{passed} browser tests passed against the Python server.")
        finally:
            if server:
                server.close()


if __name__ == "__main__":
    main()
