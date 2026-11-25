"""Seal the pinned runtime inside out before signing the Shengge launcher."""
import pathlib
import subprocess
import sys

bundle = pathlib.Path(sys.argv[1])
identity = sys.argv[2]
options = ["--options", "runtime", "--timestamp"] if identity != "-" else []
framework, = (bundle / "Contents/Frameworks").glob("*.framework")
version = (framework / "Versions/Current").resolve(strict=True)
helpers = version / "Helpers"
def sign(path):
    subprocess.run(["codesign", "--force", "--sign", identity, "--preserve-metadata=entitlements,identifier", *options, str(path)],check=True)
for library in sorted((version / "Libraries").rglob("*.dylib")):
    if not library.is_symlink(): sign(library)
for helper in sorted(helpers.iterdir()):
    if helper.suffix == ".app" or helper.is_file(): sign(helper)
sign(framework)
sign(bundle)
subprocess.run(["codesign","--verify","--deep","--strict",str(bundle)],check=True)
