# python3 fetchdeb.py <dest-sysroot> <package>...
# Downloads Debian bookworm arm64 packages (no dependency resolution) and unpacks
# their files into dest-sysroot. Runs on the device; stdlib only.
import io, lzma, os, sys, tarfile, urllib.request

MIRROR = "http://deb.debian.org/debian/"
dest, wanted = sys.argv[1], sys.argv[2:]
here = os.path.dirname(os.path.abspath(__file__))
index_path = os.path.join(here, "Packages-bookworm-arm64")
if not os.path.exists(index_path):
    data = urllib.request.urlopen(MIRROR + "dists/bookworm/main/binary-arm64/Packages.xz").read()
    open(index_path, "wb").write(lzma.decompress(data))

files = {}
for block in open(index_path, encoding="utf-8", errors="replace").read().split("\n\n"):
    fields = dict(l.split(": ", 1) for l in block.splitlines() if ": " in l and not l.startswith(" "))
    if "Package" in fields:
        files[fields["Package"]] = fields["Filename"]

def ar_members(blob):
    pos = 8
    while pos < len(blob):
        name = blob[pos:pos + 16].decode().strip().rstrip("/")
        size = int(blob[pos + 48:pos + 58].decode().strip())
        yield name, blob[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)

for pkg in wanted:
    if pkg not in files:
        print("NOT IN INDEX:", pkg); continue
    deb = urllib.request.urlopen(MIRROR + files[pkg]).read()
    for name, member in ar_members(deb):
        if name.startswith("data.tar"):
            mode = "r:xz" if name.endswith(".xz") else "r:gz" if name.endswith(".gz") else "r:*"
            with tarfile.open(fileobj=io.BytesIO(member), mode=mode) as t:
                t.extractall(dest, filter="tar") if sys.version_info >= (3, 12) else t.extractall(dest)
    print("unpacked", pkg)
