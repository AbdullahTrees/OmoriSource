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


def compare(root):
    """Return {expected, missing, extra, changed} for the game folder at root."""
    actual = hash_tree(root)
    expected = read_manifest()
    return {
        "expected": len(expected),
        "missing": sorted(set(expected) - set(actual)),
        "extra": sorted(set(actual) - set(expected)),
        "changed": sorted(rel for rel in set(expected) & set(actual) if expected[rel] != actual[rel]),
    }


def report(result):
    for label in ("missing", "extra", "changed"):
        for rel in result[label]:
            print(label.upper(), rel)
    print(f"{result['expected']} expected, {len(result['missing'])} missing, "
          f"{len(result['extra'])} extra, {len(result['changed'])} changed")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    if "--write-manifest" in sys.argv:
        actual = hash_tree(sys.argv[1])
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            for rel in sorted(actual):
                f.write(actual[rel] + "  " + rel + "\n")
        print("wrote", len(actual), "entries to", MANIFEST)
        return 0

    result = compare(sys.argv[1])
    report(result)
    return 1 if result["missing"] or result["extra"] or result["changed"] else 0


if __name__ == "__main__":
    sys.exit(main())
