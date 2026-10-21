"""Regenerate tools/steam-to-reference.patch (maintainer tool).

Usage:
    node tools/extract.js "<Steam OMORI install>" <tmp-dir>   # decrypt first (patch step warns, that's expected)
    python tools/make_patch.py <tmp-dir> project

Writes a unified diff that turns every file in <decrypted-steam-www> that differs
from <reference-www> into the reference version. Lines are compared byte-for-byte
(latin1) so CRLF line endings are preserved; tools/extract.js applies it.
"""
import difflib
import os
import re
import sys

PATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "steam-to-reference.patch")


def split_lines(text):
    return re.findall(r"[^\n]*\n|[^\n]+$", text)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    steam, reference = sys.argv[1], sys.argv[2]
    chunks = []
    for folder, _, files in os.walk(steam):
        for name in files:
            rel = os.path.relpath(os.path.join(folder, name), steam).replace(os.sep, "/")
            ref_path = os.path.join(reference, rel)
            if not os.path.exists(ref_path):
                continue
            old = open(os.path.join(steam, rel), "rb").read()
            new = open(ref_path, "rb").read()
            if old == new or rel == "data/System.json":  # extract.js edits System.json directly
                continue
            try:
                old.decode("utf-8"), new.decode("utf-8")
            except UnicodeDecodeError:
                print("skipping binary file", rel)
                continue
            diff = list(difflib.unified_diff(split_lines(old.decode("latin1")), split_lines(new.decode("latin1")),
                                             "a/" + rel, "b/" + rel, n=3))
            for i, line in enumerate(diff):
                if i < 2 or line.startswith("@@"):
                    chunks.append(line if line.endswith("\n") else line + "\n")
                elif line.endswith("\n"):
                    chunks.append(line)
                else:
                    chunks.append(line + "\n\\ No newline at end of file\n")
            print("diffed", rel)
    with open(PATCH, "wb") as f:
        f.write("".join(chunks).encode("latin1"))
    print("wrote", PATCH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
