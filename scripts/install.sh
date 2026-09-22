#!/usr/bin/env bash
# Download fully before invoking this script. No root privileges are required.
set -euo pipefail
umask 077

fail() { printf 'Installation failed: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Usage: bash install.sh [options]
  --repo OWNER/REPO       GitHub repository (AlexWhitehouse/local-document-extraction)
  --version TAG          Published release tag (default: latest)
  --ref COMMIT           Source archive bootstrap; requires --sha256
  --archive PATH         Local release archive; requires --sha256
  --sha256 HEX           Expected archive checksum
  --install-dir DIR      Application releases and launcher
  --config-dir DIR       Persistent config.env directory
  --state-dir DIR        Persistent databases, files, mail and secrets
  --no-start             Verify startup, then leave the application stopped
USAGE
}

repo=AlexWhitehouse/local-document-extraction
version=latest
ref=
archive=
expected=
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/document-extraction"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/document-extraction"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/document-extraction"
no_start=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --no-start) no_start=true; shift ;;
    --repo|--version|--ref|--archive|--sha256|--install-dir|--config-dir|--state-dir)
      [ "$#" -ge 2 ] || fail "Missing value for $1"
      case "$1" in
        --repo) repo=$2 ;; --version) version=$2 ;; --ref) ref=$2 ;;
        --archive) archive=$2 ;; --sha256) expected=$2 ;;
        --install-dir) install_dir=$2 ;; --config-dir) config_dir=$2 ;; --state-dir) state_dir=$2 ;;
      esac
      shift 2 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Invalid repository name'
[[ "$version" =~ ^[A-Za-z0-9_.-]+$ ]] || fail 'Invalid release tag'
[ -z "$ref" ] || [[ "$ref" =~ ^[a-fA-F0-9]{40}$ ]] || fail '--ref must be a full Git commit SHA'
[ -z "$archive" ] || [ -z "$ref" ] || fail 'Choose --archive or --ref'
if [ -n "$archive$ref" ]; then
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Local/source archives require --sha256 with 64 hexadecimal characters'
fi
for prerequisite in curl tar unzip; do
  command -v "$prerequisite" >/dev/null 2>&1 || fail "Install prerequisite: $prerequisite"
done
if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  fail 'Install sha256sum or shasum'
fi
case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux)
    platform=linux
    if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
      fail 'This installer currently supports glibc Linux. Other Linux variants need manual qualification.'
    fi ;;
  *) fail 'Supported systems are macOS and glibc Linux' ;;
esac
case "$(uname -m)" in
  arm64|aarch64) architecture=aarch64 ;;
  x86_64|amd64) architecture=x64-baseline ;;
  *) fail 'Supported architectures are x86_64 and ARM64' ;;
esac
work=$(mktemp -d "${TMPDIR:-/tmp}/document-extraction-install.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
download() { curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 300 "$1" -o "$2"; }

if [ -n "$archive" ]; then
  cp "$archive" "$work/application.tar.gz"
elif [ -n "$ref" ]; then
  download "https://codeload.github.com/$repo/tar.gz/$ref" "$work/application.tar.gz"
else
  if [ "$version" = latest ]; then
    release_url="https://github.com/$repo/releases/latest/download"
  else
    release_url="https://github.com/$repo/releases/download/$version"
  fi
  download "$release_url/document-extraction.tar.gz" "$work/application.tar.gz" || fail 'Release archive unavailable. Publish a release first or use the documented source bootstrap.'
  download "$release_url/document-extraction.tar.gz.sha256" "$work/checksum"
  published=$(awk 'NR==1 {print $1}' "$work/checksum")
  [ -n "$expected" ] || expected=$published
fi
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Invalid archive checksum'
[ "$(hash_file "$work/application.tar.gz")" = "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ] || fail 'Archive checksum mismatch'
tar -tzf "$work/application.tar.gz" > "$work/entries"
if awk '/^\// || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit !bad}' "$work/entries"; then
  fail 'Archive contains unsafe paths'
fi
mkdir "$work/source"
if [ -n "$ref" ]; then
  tar -xzf "$work/application.tar.gz" -C "$work/source" --strip-components=1
else
  tar -xzf "$work/application.tar.gz" -C "$work/source"
fi
[ -f "$work/source/package.json" ] && [ -f "$work/source/scripts/installApplication.ts" ] || fail 'Archive does not contain the application installer'
bun_version=$(sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' "$work/source/package.json")
[[ "$bun_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Archive does not pin a stable Bun version'
if command -v bun >/dev/null 2>&1 && [ "$(bun --version)" = "$bun_version" ]; then
  cp "$(command -v bun)" "$work/bun"
else
  bun_asset="bun-$platform-$architecture"
  bun_release="https://github.com/oven-sh/bun/releases/download/bun-v$bun_version"
  download "$bun_release/$bun_asset.zip" "$work/bun.zip"
  download "$bun_release/SHASUMS256.txt" "$work/bun-checksums"
  bun_expected=$(awk -v asset="$bun_asset.zip" '$2==asset || $2=="*"asset {print $1}' "$work/bun-checksums")
  [ -n "$bun_expected" ] && [ "$(hash_file "$work/bun.zip")" = "$bun_expected" ] || fail 'Bun checksum mismatch'
  unzip -q "$work/bun.zip" -d "$work/runtime"
  cp "$work/runtime/$bun_asset/bun" "$work/bun"
fi
chmod 700 "$work/bun"
[ "$("$work/bun" --version)" = "$bun_version" ] || fail 'Pinned Bun runtime failed validation'
"$work/bun" --no-env-file "$work/source/scripts/installApplication.ts" \
  --source "$work/source" --bun "$work/bun" --repo "$repo" --version "${ref:-$version}" \
  --sha256 "$expected" --install-dir "$install_dir" --config-dir "$config_dir" \
  --state-dir "$state_dir" --no-start "$no_start"
