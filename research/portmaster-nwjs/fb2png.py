# python fb2png.py <raw fb dump> <out prefix>  -- 640x960 BGRA framebuffer -> two 640x480 PNGs
import struct, sys, zlib

W, H, PAGES = 640, 480, 2
raw = open(sys.argv[1], "rb").read()

def png(path, rows):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    body = b"".join(b"\x00" + r for r in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(body, 6)) + chunk(b"IEND", b""))

for page in range(PAGES):
    rows = []
    for y in range(H):
        line = raw[(page * H + y) * W * 4:(page * H + y + 1) * W * 4]
        rgb = bytearray(W * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = line[2::4], line[1::4], line[0::4]  # BGRA -> RGB
        rows.append(bytes(rgb))
    png("%s_%d.png" % (sys.argv[2], page), rows)
print("ok")
