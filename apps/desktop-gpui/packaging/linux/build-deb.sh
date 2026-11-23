#!/bin/sh
set -eu
umask 022

if [ "$#" -ne 2 ]; then
  printf '%s\n' 'Usage: sh build-deb.sh /path/to/yapper-gpui /path/to/output-directory' >&2
  exit 2
fi

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
app=$(CDPATH='' cd -- "$here/../.." && pwd)
binary=$(realpath -- "$1")
output=$2
version=$(sed -n 's/^version = "\([0-9][0-9.]*\)"$/\1/p' "$app/Cargo.toml")
arch=$(dpkg --print-architecture)
machine=$(LC_ALL=C readelf -h "$binary" | sed -n 's/^ *Machine: *//p')
case "$arch:$machine" in
  amd64:*X86-64* | arm64:AArch64) ;;
  *) printf 'Binary does not match the package architecture %s\n' "$arch" >&2; exit 1 ;;
esac

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
install -d "$stage/DEBIAN" "$stage/usr/bin" "$stage/usr/share/applications" "$stage/usr/share/doc/yapper"
install -m 0755 "$binary" "$stage/usr/bin/yapper"
install -m 0644 "$here/yapper.desktop" "$stage/usr/share/applications/yapper.desktop"
install -m 0644 "$app/assets/fonts/LICENSE.txt" "$stage/usr/share/doc/yapper/Inter-LICENSE"
install -m 0644 "$app/assets/icons/LICENSE" "$stage/usr/share/doc/yapper/Lucide-LICENSE"
cat > "$stage/DEBIAN/control" <<EOF
Package: yapper
Version: $version
Section: net
Priority: optional
Architecture: $arch
Maintainer: Yapper maintainers
Depends: libc6, libgcc-s1, libasound2t64, libfontconfig1, libfreetype6, libglib2.0-0t64, libjpeg62-turbo | libjpeg-turbo8, libpulse0, libudev1, libvulkan1, libwayland-client0, libxcb1, libxcb-render0, libxcb-shape0, libxcb-xfixes0, libxkbcommon0, libxkbcommon-x11-0
Recommends: gnome-keyring, mesa-vulkan-drivers
Description: Private voice and text chat
 Yapper connects to a self-hosted Yapper server.
EOF
mkdir -p -- "$output"
package="yapper_${version}_${arch}.deb"
dpkg-deb --root-owner-group --build "$stage" "$output/$package"
(cd -- "$output" && sha256sum "$package" > "$package.sha256")
