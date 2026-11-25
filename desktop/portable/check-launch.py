"""Launch the installed player and verify that it reaches the extension home page."""
from contextlib import closing
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time


def wait_for_home(history, started, process):
    home = "chrome-extension://clmdeglkjmdcjhlhemjglfhaefehclkg/home.html"
    chrome_time = int((started + 11644473600) * 1_000_000)
    for _ in range(120):
        if process is not None and process.poll() is not None:
            raise RuntimeError("Player exited before reaching its home page")
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
    raise RuntimeError("Installed player did not reach its home page")


def verify(app):
    started = time.time() - 1
    if sys.platform == "darwin":
        subprocess.run(["open", app, "--args", "-videoURL", "home"], check=True)
        wait_for_home(Path.home() / "Library/Application Support/声格/练习/Default/History", started, None)
        return
    with tempfile.TemporaryDirectory() as temp:
        env = {**os.environ, "APPDATA": temp, "XDG_CONFIG_HOME": temp}
        process = subprocess.Popen([app], env=env, start_new_session=os.name != "nt")
        try:
            wait_for_home(Path(temp) / "Shengge/Practice/Default/History", started, process)
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False)
                else:
                    os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=20)


if __name__ == "__main__":
    verify(Path(sys.argv[1]).resolve())
