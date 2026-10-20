"""Assemble a runnable OMORI build from this repository.

Usage:
    python tools/build.py [--platform windows|linux] [--sdk] [--out DIR]

Output (default build/<platform>/), laid out like the shipped game:
    OMORI.exe / OMORI      NW.js 0.29.0 runtime, renamed
    package.json           launcher manifest (main: www/index.html)
    launcher/compat.js     cross-platform fixes
    www/                   copy of project/ (checked with verify_parity.py)

NW.js is downloaded once from dl.nwjs.io and cached in build/.cache/.
--sdk uses the SDK flavor, which adds the F12 developer console.
Saves already in project/save/ are copied into the build so playtests can continue them.
"""
import argparse
import json
import os
import shutil
import sys
import tarfile
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_parity

NW_VERSION = "0.29.0"
# OMORI ships the 32-bit Windows runtime; Linux has no official 32-bit-only need, so x64.
PLATFORMS = {
    "windows": ("win-ia32", ".zip", "nw.exe", "OMORI.exe"),
    "linux": ("linux-x64", ".tar.gz", "nw", "OMORI"),
}

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Editor-only files that the shipped game does not contain.
SKIP_IN_WWW = {"Game.rpgproject", "save"}


def download_runtime(platform, sdk):
    arch, ext, _, _ = PLATFORMS[platform]
    name = "nwjs-%sv%s-%s" % ("sdk-" if sdk else "", NW_VERSION, arch)
    cache = os.path.join(REPO, "build", ".cache")
    archive = os.path.join(cache, name + ext)
    extracted = os.path.join(cache, name)
    if not os.path.isdir(extracted):
        os.makedirs(cache, exist_ok=True)
        if not os.path.exists(archive):
            url = "https://dl.nwjs.io/v%s/%s%s" % (NW_VERSION, name, ext)
            print("downloading", url)
            # dl.nwjs.io answers 403 to Python's default User-Agent.
            request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
            with urllib.request.urlopen(request) as response, open(archive + ".part", "wb") as f:
                shutil.copyfileobj(response, f)
            os.replace(archive + ".part", archive)
        print("extracting", archive)
        if ext == ".zip":
            with zipfile.ZipFile(archive) as z:
                z.extractall(cache)
        else:
            with tarfile.open(archive) as t:
                t.extractall(cache)
    return extracted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=sorted(PLATFORMS), default="windows")
    parser.add_argument("--sdk", action="store_true")
    parser.add_argument("--out")
    args = parser.parse_args()

    out = args.out or os.path.join(REPO, "build", args.platform)
    _, _, nw_name, exe_name = PLATFORMS[args.platform]
    runtime = download_runtime(args.platform, args.sdk)

    if os.path.exists(out):
        print("removing old", out)
        shutil.rmtree(out)

    print("copying runtime")
    shutil.copytree(runtime, out)
    os.rename(os.path.join(out, nw_name), os.path.join(out, exe_name))

    print("copying game files")
    project = os.path.join(REPO, "project")
    shutil.copytree(project, os.path.join(out, "www"),
                    ignore=lambda folder, names: SKIP_IN_WWW & set(names) if folder == project else [])
    shutil.copytree(os.path.join(REPO, "launcher"), os.path.join(out, "launcher"))

    saves = os.path.join(project, "save")
    if os.path.isdir(saves):
        shutil.copytree(saves, os.path.join(out, "www", "save"))

    with open(os.path.join(REPO, "package.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    manifest["main"] = manifest["main"].replace("project/", "www/", 1)
    manifest["window"]["icon"] = manifest["window"]["icon"].replace("project/", "www/", 1)
    with open(os.path.join(out, "package.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=4)

    print("checking www/ against the reference manifest")
    sys.argv = ["verify_parity.py", os.path.join(out, "www")]
    if verify_parity.main() != 0:
        print("BUILD FAILED: www/ does not match the reference")
        return 1
    print("built", os.path.join(out, exe_name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
