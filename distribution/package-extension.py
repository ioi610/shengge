from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'release/Shengge-Chrome.zip','w',ZIP_DEFLATED,compresslevel=9) as z:
    z.write(root/'distribution/安装说明.html','安装说明.html')
    folder=root/'dist/extension'
    assert (folder/'manifest.json').is_file()
    for f in sorted(folder.rglob('*')):
        if f.is_file() and not f.name.startswith('.'): z.write(f,'extension/'+f.relative_to(folder).as_posix())
