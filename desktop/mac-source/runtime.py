"""Install the unmodified, notarized arm64 browser used by the native player."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile

VERSION = "1.100.59"
DIGEST = "976e78ec17ee5bc5e758acb7a7ece8fbd36ae0134cfd4e523b2f411b4fcefc02"
NAME = "Brave Browser.app"
REQUIREMENT = 'anchor apple generic and identifier "com.brave.Browser" and certificate leaf[subject.OU] = "KL8N8XSYF4"'


def install_runtime(image, helpers):
    digest = hashlib.sha256()
    with image.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    if digest.hexdigest() != DIGEST:
        raise ValueError("播放器资源校验失败，请重新下载安装包")
    helpers.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as mount:
        subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, image], check=True)
        try:
            app = Path(mount) / NAME
            subprocess.run(["codesign", "--verify", "-R", "=" + REQUIREMENT, app], check=True)
            subprocess.run(["spctl", "--assess", "--type", "execute", app], check=True)
            # Skip legacy Finder resource forks from the HFS disk image. Retain quarantine.
            subprocess.run(["ditto", "--norsrc", "--qtn", app, helpers / NAME], check=True)
            subprocess.run(["codesign", "--verify", "--deep", "--strict", helpers / NAME], check=True)
        finally:
            subprocess.run(["hdiutil", "detach", mount], check=True)


if __name__ == "__main__":
    image = Path(sys.argv[1])
    if not image.exists():
        image.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://github.com/brave/brave-browser/releases/download/v{VERSION}/Brave-Browser-arm64.dmg"
        with tempfile.NamedTemporaryFile(dir=image.parent) as downloaded:
            subprocess.run(["curl", "-fL", "--retry", "3", url, "-o", downloaded.name], check=True)
            install_runtime(Path(downloaded.name), Path(sys.argv[2]))
            import shutil
            shutil.copyfile(downloaded.name, image)
    else:
        install_runtime(image, Path(sys.argv[2]))
