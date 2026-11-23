#!/usr/bin/env python3
"""Prepare the Blaze-locked WebRTC SDK for a Cargo build."""

import argparse
import hashlib
import platform
import sys
import tomllib
import urllib.request
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent
TARGETS = {
    ("Linux", "aarch64"): "aarch64-unknown-linux-gnu",
    ("Linux", "x86_64"): "x86_64-unknown-linux-gnu",
    ("Windows", "AMD64"): "x86_64-pc-windows-msvc",
}


def locked_artifact(target):
    with (ROOT / "Cargo.fetches.lock").open("rb") as file:
        fetches = tomllib.load(file)
    with (ROOT / "Cargo.lock").open("rb") as file:
        packages = tomllib.load(file)["package"]
    entries = [
        entry
        for entry in fetches["fetch"]
        if entry["package"] == "webrtc-sys" and entry["target"] == target
    ]
    if fetches["version"] != 1 or len(entries) != 1:
        raise ValueError(f"No unique WebRTC artifact locked for {target}")
    entry = entries[0]
    if not any(
        package["name"] == entry["package"]
        and package["version"] == entry["version"]
        and package.get("checksum") == entry["locked"]
        for package in packages
    ):
        raise ValueError("The WebRTC lock is stale. Run ./blaze.sh lock-native.")
    return entry


def download(entry, archive):
    checksum = hashlib.sha256()
    remaining = entry["size"]
    with (
        urllib.request.urlopen(entry["url"], timeout=60) as source,
        archive.open("wb") as output,
    ):
        while chunk := source.read(1024 * 1024):
            remaining -= len(chunk)
            if remaining < 0:
                raise ValueError("The download exceeds its locked size")
            checksum.update(chunk)
            output.write(chunk)
    if remaining or checksum.hexdigest() != entry["sha256"]:
        raise ValueError(
            "The WebRTC archive does not match its locked size and SHA-256"
        )


def valid_sdk(directory, library):
    return (directory / "include").is_dir() and (directory / "lib" / library).is_file()


def prepare(entry, target):
    cache = ROOT / "target" / "webrtc-locked"
    destination = cache / entry["sha256"]
    sdk = destination / entry["names"]
    library = "webrtc.lib" if target.endswith("-msvc") else "libwebrtc.a"
    if valid_sdk(sdk, library):
        return sdk

    cache.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=cache) as temporary:
        temporary = Path(temporary)
        archive = temporary / "webrtc.zip"
        extracted = temporary / "sdk"
        download(entry, archive)
        with zipfile.ZipFile(archive) as contents:
            contents.extractall(extracted)
        if not valid_sdk(extracted / entry["names"], library):
            raise ValueError("The verified WebRTC archive has an unexpected layout")
        try:
            extracted.rename(destination)
        except OSError:
            if not valid_sdk(sdk, library):
                raise
    return sdk


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=TARGETS.values())
    args = parser.parse_args()
    target = args.target or TARGETS.get((platform.system(), platform.machine()))
    if target is None:
        parser.error(
            "This host has no default WebRTC target. Pass --target explicitly."
        )
    try:
        print(prepare(locked_artifact(target), target))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        sys.exit(f"Could not prepare WebRTC: {error}")


if __name__ == "__main__":
    main()
