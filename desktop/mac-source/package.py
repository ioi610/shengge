"""Ship the launcher source and pinned resources for a native local build."""
from pathlib import Path
import shutil
import subprocess
import tempfile

here=Path(__file__).resolve().parent
root=here.parents[1]
release=root/"release"
contents=release/"声格.app/Contents"
with tempfile.TemporaryDirectory() as work:
    kit=Path(work)/"Shengge-Mac"
    kit.mkdir()
    for src in [here/"install.py",here/"安装说明.txt",here.parent/"main.m",here.parent/"sign-runtime.py",contents/"Info.plist"]:
        shutil.copy2(src,kit/src.name)
    shutil.copy2(Path.home()/"Library/Caches/Shengge/build/158.0.8127.36/chrome.zip",kit/"chrome.zip")
    shutil.copytree(contents/"Resources",kit/"Resources",ignore=shutil.ignore_patterns(".DS_Store"))
    subprocess.run(["ditto","-c","-k","--keepParent",kit,release/"Shengge-macOS-arm64-source.zip"],check=True)
