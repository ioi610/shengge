"""Compile and install the Apple Silicon launcher using Apple's Command Line Tools."""
from runtime import install_runtime
from pathlib import Path
import platform
import plistlib
import subprocess
import sys
import tempfile
from uuid import uuid4

root = Path(__file__).resolve().parent
app_name = "声格.app"

def run(*args):
    subprocess.run(args, check=True)

def build_and_install(directory):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("此安装包需要 Apple 芯片 Mac")
    run("xcrun", "--find", "clang")
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
        install_runtime(root / "Brave.dmg", contents / "Helpers")
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
