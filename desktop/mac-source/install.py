"""Compile and install the Apple Silicon launcher using Apple's Command Line Tools."""
import hashlib
from pathlib import Path
import platform
import plistlib
import subprocess
import sys
import tempfile
from uuid import uuid4

root = Path(__file__).resolve().parent
app_name = "声格.app"
runtime_name = "Google Chrome for Testing.app"
runtime_sha256 = "b86d3b393def1f87d369b022abff0a51acb015d6fcb79ddfd1c379c9d72fbbe2"

def run(*args):
    subprocess.run(args, check=True)

def build_and_install(directory):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("此安装包需要 Apple 芯片 Mac")
    run("xcrun", "--find", "clang")
    archive = root / "chrome.zip"
    digest = hashlib.sha256()
    with archive.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    if digest.hexdigest() != runtime_sha256:
        raise SystemExit("播放器资源校验失败，请重新下载安装包")
    directory.mkdir(exist_ok=True, parents=True)
    dest = directory / app_name
    if dest.exists():
        with (dest / "Contents/Info.plist").open("rb") as f:
            if dest.is_symlink() or plistlib.load(f).get("CFBundleIdentifier") != "app.shengge.desktop":
                raise SystemExit("目标位置已有其他应用")
    with tempfile.TemporaryDirectory(dir=directory, prefix=".shengge-build-") as stage:
        stage = Path(stage)
        contents = stage / app_name / "Contents"
        (contents/"MacOS").mkdir(parents=True)
        (contents/"Helpers").mkdir()
        run("ditto", root/"Resources", contents/"Resources")
        run("ditto", root/"Info.plist", contents/"Info.plist")
        run("ditto", "-x", "-k", archive, stage)
        runtime = contents/"Helpers"/runtime_name
        (stage/"chrome-mac-arm64"/runtime_name).rename(runtime)
        run("python3", root/"sign-runtime.py", runtime, "-")
        run("xcrun","clang","-fobjc-arc","-O2","-mmacosx-version-min=13.0","-framework","Cocoa","-framework","WebKit",root/"main.m","-o",contents/"MacOS/Shengge")
        run("codesign","--force","--sign","-",contents.parent)
        run("codesign","--verify","--deep","--strict",contents.parent)
        backup=None
        if dest.exists():
            backup=directory/(".shengge-previous-"+uuid4().hex+".app")
            dest.rename(backup)
        try:
            contents.parent.rename(dest)
        except OSError:
            if backup: backup.rename(dest)
            raise
        if backup: print("旧版本已备份到",backup)
    print("已安装",dest)

if __name__=="__main__":
    build_and_install(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.home()/"Applications")
