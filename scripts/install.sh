#!/usr/bin/env sh

set -eu

REPOSITORY="oduan/podium"

fail() {
  printf 'podium installer: %s\n' "$1" >&2
  exit 1
}

download() {
  url="$1"
  destination="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$destination"
  else
    fail "curl or wget is required"
  fi
}

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

version="${PODIUM_VERSION:-latest}"
install_dir="${PODIUM_INSTALL_DIR:-$HOME/.local/bin}"
asset="podium-${os}-${arch}.tar.gz"

if [ -n "${PODIUM_DOWNLOAD_BASE_URL:-}" ]; then
  download_base="${PODIUM_DOWNLOAD_BASE_URL%/}"
elif [ "$version" = "latest" ]; then
  download_base="https://github.com/${REPOSITORY}/releases/latest/download"
else
  download_base="https://github.com/${REPOSITORY}/releases/download/${version}"
fi

tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t podium)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

archive="$tmp_dir/$asset"
checksums="$tmp_dir/checksums.txt"

printf 'Downloading Podium %s for %s/%s...\n' "$version" "$os" "$arch"
download "$download_base/$asset" "$archive"
download "$download_base/checksums.txt" "$checksums"

expected="$(awk -v file="$asset" '$2 == file || $2 == ("*" file) { print $1; exit }' "$checksums")"
[ -n "$expected" ] || fail "checksum not found for $asset"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$archive" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
else
  fail "sha256sum or shasum is required to verify the download"
fi

[ "$actual" = "$expected" ] || fail "checksum verification failed for $asset"

tar -xzf "$archive" -C "$tmp_dir"
[ -f "$tmp_dir/podium" ] || fail "release archive does not contain podium"

mkdir -p "$install_dir"
if command -v install >/dev/null 2>&1; then
  install -m 0755 "$tmp_dir/podium" "$install_dir/podium"
else
  cp "$tmp_dir/podium" "$install_dir/podium"
  chmod 0755 "$install_dir/podium"
fi

printf 'Installed Podium to %s/podium\n' "$install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH, then run: podium\n' "$install_dir" ;;
esac
