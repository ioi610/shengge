"""Launch the installed player and verify that it reaches the extension home page."""
from contextlib import closing, contextmanager
import json
import urllib.request
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time


def wait_for_home(history, started, process):
    home = "chrome-extension://clmdeglkjmdcjhlhemjglfhaefehclkg/home.html"
    chrome_time = int((started + 11644473600) * 1_000_000)
    targets = []
    for _ in range(120):
        if process is not None and process.poll() is not None:
            raise RuntimeError("Player exited before reaching its home page")
        if process is not None:
            port_file = history.parents[1] / "DevToolsActivePort"
            if port_file.exists():
                try:
                    port = int(port_file.read_text().splitlines()[0])
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as response:
                        targets = json.load(response)
                    if any(t.get("type") == "page" and t.get("url") == home and t.get("title") == "声格" for t in targets):
                        print("Installed player rendered the home page")
                        return
                except (OSError, ValueError, IndexError):
                    pass
        if history.exists():
            for mode in ["mode=ro", "immutable=1"]:
                try:
                    with closing(sqlite3.connect(history.as_uri() + "?" + mode, uri=True, timeout=0.2)) as conn:
                        if conn.execute("SELECT 1 FROM urls WHERE url=? AND last_visit_time>=?", (home, chrome_time)).fetchone():
                            print("Installed player opened its home page")
                            return
                except sqlite3.OperationalError:
                    pass
        time.sleep(0.5)
    print("Last targets:", [(t.get("type"), t.get("url"), t.get("title")) for t in targets])
    if history.exists():
        with closing(sqlite3.connect(history.as_uri() + "?immutable=1", uri=True)) as db:
            print("Test profile URLs:", db.execute("SELECT url FROM urls ORDER BY last_visit_time DESC LIMIT 3").fetchall())
    raise RuntimeError("Installed player did not reach its home page")


@contextmanager
def temporary_profile():
    directory = Path(tempfile.mkdtemp(prefix="shengge-install-test-"))
    try:
        yield directory
    finally:
        for attempt in range(25):
            try:
                shutil.rmtree(directory)
                break
            except PermissionError:
                if attempt == 24:
                    raise
                time.sleep(0.4)


def close_player(process, profile):
    port_file = profile / "DevToolsActivePort"
    if process.poll() is None and port_file.exists():
        port, endpoint = port_file.read_text().splitlines()[:2]
        url = f"ws://127.0.0.1:{int(port)}{endpoint}"
        script = """const ws = new WebSocket(process.argv[1]);
            ws.onopen = () => ws.send(JSON.stringify({id:1,method:'Browser.close'}));
            ws.onerror = () => process.exit(1);
            setTimeout(() => process.exit(1), 4000).unref();"""
        subprocess.run(["node", "-e", script, url], check=False, timeout=8)
        try:
            process.wait(timeout=8)
            return
        except subprocess.TimeoutExpired:
            pass
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False)
        else:
            os.killpg(process.pid, signal.SIGTERM)
    process.wait(timeout=20)


def verify(app):
    started = time.time() - 1
    if sys.platform == "darwin":
        subprocess.run(["open", app, "--args", "-videoURL", "home"], check=True)
        wait_for_home(Path.home() / "Library/Application Support/声格/练习/Default/History", started, None)
        return
    with temporary_profile() as temp:
        env = {**os.environ, "APPDATA": str(temp), "XDG_CONFIG_HOME": str(temp)}
        process = subprocess.Popen([app, "--verify-install"], env=env, start_new_session=os.name != "nt")
        try:
            wait_for_home(Path(temp) / "Shengge/Practice/Default/History", started, process)
        finally:
            close_player(process, temp / "Shengge/Practice")


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())
