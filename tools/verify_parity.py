"""Check a game folder against the known-good OMORI file manifest.

Usage:
    python tools/verify_parity.py <game-dir>                   check <game-dir> against tools/reference.sha256
    python tools/verify_parity.py <game-dir> --write-manifest  regenerate the manifest from <game-dir>

The manifest was generated from a working decrypted copy of OMORI's www folder.
It only stores hashes, never game content. Player data (save/) is skipped.
"""
import hashlib
import os
import sys

MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference.sha256")
SKIP_DIRS = {"save"}


def hash_tree(root):
    hashes = {}
    for folder, dirs, files in os.walk(root):
        if folder == root:
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            path = os.path.join(folder, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            with open(path, "rb") as f:
                hashes[rel] = hashlib.sha256(f.read()).hexdigest()
    return hashes


def read_manifest():
    hashes = {}
    with open(MANIFEST, encoding="utf-8") as f:
        for line in f:
            digest, rel = line.rstrip("\n").split("  ", 1)
            hashes[rel] = digest
    return hashes


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    actual = hash_tree(sys.argv[1])

    if "--write-manifest" in sys.argv:
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            for rel in sorted(actual):
                f.write(actual[rel] + "  " + rel + "\n")
        print("wrote", len(actual), "entries to", MANIFEST)
        return 0

    expected = read_manifest()
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(rel for rel in set(expected) & set(actual) if expected[rel] != actual[rel])

    for label, files in (("MISSING", missing), ("EXTRA", extra), ("CHANGED", changed)):
        for rel in files:
            print(label, rel)
    print(f"{len(expected)} expected, {len(missing)} missing, {len(extra)} extra, {len(changed)} changed")
    return 1 if missing or extra or changed else 0


if __name__ == "__main__":
    sys.exit(main())
