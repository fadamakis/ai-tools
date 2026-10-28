"""Extract a release ZIP without links, traversal, duplicate paths or oversized output."""
import pathlib
import stat
import sys
import zipfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
with zipfile.ZipFile(archive) as bundle:
    seen = set()
    total = 0
    for entry in bundle.infolist():
        name = entry.filename
        relative = pathlib.PurePosixPath(name)
        mode = entry.external_attr >> 16
        if (not name or name.startswith('/') or '\\' in name or
                any(part in ('', '.', '..') for part in name.rstrip('/').split('/')) or
                ':' in name or stat.S_ISLNK(mode) or
                (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
            raise ValueError(f'Unsafe archive entry: {name}')
        key = str(relative).casefold()
        if key in seen:
            raise ValueError(f'Duplicate archive entry: {name}')
        seen.add(key)
        total += entry.file_size
        if total > 512 * 1024 * 1024 or len(seen) > 20000:
            raise ValueError('Release archive exceeds extraction limits')
    root.mkdir(parents=True, exist_ok=False)
    bundle.extractall(root)
