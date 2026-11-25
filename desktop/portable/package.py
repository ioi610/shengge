"""Build portable players from the same desktop training bundle as macOS."""
import argparse, hashlib, os, pathlib, shutil, stat, subprocess, tarfile, tempfile, urllib.request, zipfile
from gzip import GzipFile
from io import BytesIO
from time import time

root = pathlib.Path(__file__).resolve().parents[2]
version = "158.0.8127.36"
digests = {"linux64": "dba9cc838e1ce269c33ea68170881127bd15d078fc3ca5891c90802819a4d7c7", "win64": "6a8ad290952cc612c7777ffb3eb62f345539a2a1a8d440cfac190c6d36b34d2c"}
model_hash = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"

def obtain(cache, name, url, digest):
    path = cache / name
    def valid(p):
        h = hashlib.sha256()
        with p.open("rb") as f:
            for block in iter(lambda: f.read(1<<20), b""): h.update(block)
        return h.hexdigest() == digest
    if path.exists() and valid(path): return path
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as f:
        temp = pathlib.Path(f.name)
    try:
        subprocess.run(["curl","-fL","--retry","3","-o",str(temp),url],check=True)
        if not valid(temp): raise ValueError(name+" checksum mismatch")
        temp.replace(path)
    finally: temp.unlink(missing_ok=True)
    return path

def archive_tar(path, source, prefix, sandbox=False):
    def metadata(info):
        info.uid=info.gid=0; info.uname=info.gname="root"
        if sandbox and info.name.endswith("/runtime/chrome_sandbox"): info.mode=0o4755
        return info
    with tarfile.open(path,"w:gz",compresslevel=5,format=tarfile.GNU_FORMAT) as tar:
        tar.add(source,arcname=prefix,filter=metadata)

def debian(stage, out, work):
    data=work/"data"; opt=data/"opt"/"shengge"; opt.parent.mkdir(parents=True)
    shutil.copytree(stage,opt)
    apps=data/"usr/share/applications"; apps.mkdir(parents=True)
    (apps/"shengge.desktop").write_text("[Desktop Entry]\nType=Application\nName=声格\nExec=/opt/shengge/Shengge\nIcon=/opt/shengge/training/icons/icon-128.png\nCategories=Education;AudioVideo;\nTerminal=false\n",encoding="utf-8")
    ctl=work/"control";ctl.mkdir()
    (ctl/"control").write_text("Package: shengge\nVersion: 0.3.6\nArchitecture: amd64\nMaintainer: Shengge\nDepends: libnss3, libatk-bridge2.0-0, libx11-6, libgbm1, libasound2 | libasound2t64, libgtk-3-0 | libgtk-3-0t64, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libcups2 | libcups2t64, libxfixes3\nDescription: Video listening and dialogue practice\n")
    (work/"debian-binary").write_bytes(b"2.0\n")
    archive_tar(work/"control.tar.gz",ctl,"."); archive_tar(work/"data.tar.gz",data,".",True)
    with out.open("wb") as f:
        f.write(b"!<arch>\n")
        for name in ["debian-binary","control.tar.gz","data.tar.gz"]:
            part=work/name; size=part.stat().st_size
            f.write(f"{name+'/':<16}{int(time()):<12}{0:<6}{0:<6}{'100644':<8}{size:<10}`\n".encode("ascii"))
            with part.open("rb") as stream: shutil.copyfileobj(stream,f)
            if size%2: f.write(b"\n")

def main():
    parser=argparse.ArgumentParser();parser.add_argument("platform",choices=digests);args=parser.parse_args()
    target=args.platform
    cache=pathlib.Path(os.environ.get("SHENGGE_CACHE",pathlib.Path.home()/".cache/shengge"/version));cache.mkdir(parents=True,exist_ok=True)
    stage=root/"dist"/("portable-"+target);release=root/"release";release.mkdir(exist_ok=True)
    runtime=obtain(cache,target+".zip",f"https://storage.googleapis.com/chrome-for-testing-public/{version}/{target}/chrome-{target}.zip",digests[target])
    model=obtain(cache,"ggml-small-q5_1.bin","https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin",model_hash)
    with tempfile.TemporaryDirectory(dir=root/"dist") as folder:
        work=pathlib.Path(folder); app=work/"app";app.mkdir()
        with zipfile.ZipFile(runtime) as z:
            for info in z.infolist():
                rel=pathlib.PurePosixPath(info.filename)
                if rel.parts[0]!="chrome-"+target or ".." in rel.parts: raise ValueError("invalid runtime path")
                dest=app/"runtime"/pathlib.Path(*rel.parts[1:])
                if info.is_dir(): dest.mkdir(parents=True,exist_ok=True); continue
                dest.parent.mkdir(parents=True,exist_ok=True)
                with z.open(info) as src,dest.open("wb") as out:shutil.copyfileobj(src,out)
                if info.external_attr>>16: dest.chmod((info.external_attr>>16)&0o777)
        shutil.copytree(root/"dist/desktop-training",app/"training",ignore=shutil.ignore_patterns(".DS_Store"))
        shutil.copy2(model,app/"training/asr/ggml-small-q5_1.bin")
        ui=app/"Contents/Resources/ui";ui.mkdir(parents=True);shutil.copy2(root/"desktop/training-launch.html",ui)
        windows=target=="win64";binary=app/("Shengge.exe" if windows else "Shengge")
        cmd=["go","build","-trimpath","-ldflags","-s -w"+(" -H=windowsgui" if windows else ""),"-o",str(binary),str(root/"desktop/portable/launcher.go")]
        subprocess.run(cmd,env={**os.environ,"CGO_ENABLED":"0","GOARCH":"amd64","GOOS":"windows" if windows else "linux"},check=True)
        if windows:
            with zipfile.ZipFile(release/"Shengge-Windows-x64.zip","w",zipfile.ZIP_DEFLATED,compresslevel=5) as z:
                for path in sorted(app.rglob("*")):
                    if path.is_file(): z.write(path,"Shengge/"+path.relative_to(app).as_posix())
        else: debian(app,release/"shengge_0.3.6_amd64.deb",work)
        if stage.exists():shutil.rmtree(stage)
        app.rename(stage)
if __name__=="__main__":main()
