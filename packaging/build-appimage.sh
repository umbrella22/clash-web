#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname -- "$SCRIPT_DIR")"
VERSION="${1:-0.1.0}"
ARCH="${2:-x86_64}"
TARGET_TRIPLE="${3:-x86_64-unknown-linux-musl}"
APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-0}"

for argument in "${@:4}"; do
    case "$argument" in
        --appimage-extract-and-run)
            APPIMAGE_EXTRACT_AND_RUN=1
            ;;
        *)
            printf 'Unknown argument: %s\n' "$argument" >&2
            exit 2
            ;;
    esac
done

if [[ "$ARCH" != "x86_64" ]]; then
    printf 'Unsupported AppImage architecture: %s\n' "$ARCH" >&2
    exit 1
fi

if [[ ! -f "$PROJECT_DIR/web/public/favicon.svg" ]]; then
    printf 'AppImage icon source is missing: %s\n' "$PROJECT_DIR/web/public/favicon.svg" >&2
    exit 1
fi

resolve_command() {
    local command_name="$1"
    if command -v "$command_name" >/dev/null 2>&1; then
        command -v "$command_name"
    fi
}

APPIMAGETOOL="${APPIMAGETOOL:-$(resolve_command appimagetool || true)}"
if [[ -z "$APPIMAGETOOL" || ! -x "$APPIMAGETOOL" ]]; then
    printf '%s\n' "appimagetool is required. Set APPIMAGETOOL to an executable path or put it on PATH." >&2
    exit 1
fi

SVG_CONVERTER=""
for candidate in rsvg-convert magick convert; do
    if command -v "$candidate" >/dev/null 2>&1; then
        SVG_CONVERTER="$(command -v "$candidate")"
        break
    fi
done
if [[ -z "$SVG_CONVERTER" ]]; then
    printf '%s\n' "An SVG converter is required. Install rsvg-convert or ImageMagick." >&2
    exit 1
fi

configure_target_toolchain() {
    local target="$1"
    case "$target" in
        *-unknown-linux-musl)
            local sysroot
            sysroot="$(rustc --print sysroot)"
            local lld_dir="${TMPDIR:-/tmp}/clash-web-toolchain"
            mkdir -p "$lld_dir"
            ln -sf "${sysroot}/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld" "${lld_dir}/ld.lld"

            local target_env="${target//-/_}"
            local cargo_target_env="${target_env^^}"
            export "CC_${target_env}=clang"
            export "CARGO_TARGET_${cargo_target_env}_LINKER=clang"
            export "CFLAGS_${target_env}=--target=${target}"
            export RUSTFLAGS="-Clink-self-contained=yes -Clink-arg=--target=${target} -Clink-arg=-B${lld_dir} -Clink-arg=-fuse-ld=lld"
            ;;
        *)
            printf 'AppImage target must be a musl target: %s\n' "$target" >&2
            exit 1
            ;;
    esac
}

APPIMAGE_DIR="${PROJECT_DIR}/target/appimage"
APPDIR="${APPIMAGE_DIR}/clash-web.AppDir"
OUTPUT="${APPIMAGE_DIR}/clash-web_${VERSION}_${ARCH}.AppImage"

printf '=== Building Clash Web AppImage %s (%s, %s) ===\n' "$VERSION" "$ARCH" "$TARGET_TRIPLE"
cd "$PROJECT_DIR"

printf '%s\n' '[1/5] Building Rust backend (release)...'
configure_target_toolchain "$TARGET_TRIPLE"
cargo build --release --target "$TARGET_TRIPLE" --package clash-web-service

printf '%s\n' '[2/5] Building frontend...'
pnpm --dir web build

printf '%s\n' '[3/5] Assembling AppDir...'
rm -rf "$APPDIR"
mkdir -p \
    "$APPDIR/usr/bin" \
    "$APPDIR/usr/share/clash-web/ui"

cp "$PROJECT_DIR/packaging/appimage/AppRun" "$APPDIR/AppRun"
cp "$PROJECT_DIR/packaging/appimage/clash-web.desktop" "$APPDIR/clash-web.desktop"
chmod 755 "$APPDIR/AppRun"
cp -r "$PROJECT_DIR/web/dist/"* "$APPDIR/usr/share/clash-web/ui/"
cp "$PROJECT_DIR/target/$TARGET_TRIPLE/release/clash-web-service" "$APPDIR/usr/bin/clash-web-service"
chmod 755 "$APPDIR/usr/bin/clash-web-service"

ICON_PATH="$APPDIR/clash-web.png"
case "$(basename "$SVG_CONVERTER")" in
    rsvg-convert)
        "$SVG_CONVERTER" -w 256 -h 256 "$PROJECT_DIR/web/public/favicon.svg" -o "$ICON_PATH"
        ;;
    magick|convert)
        "$SVG_CONVERTER" "$PROJECT_DIR/web/public/favicon.svg" -background none -resize 256x256 "$ICON_PATH"
        ;;
esac
cp "$ICON_PATH" "$APPDIR/.DirIcon"

printf '%s\n' '[4/5] Building AppImage...'
mkdir -p "$APPIMAGE_DIR"
if [[ "$APPIMAGE_EXTRACT_AND_RUN" == "1" ]]; then
    "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$OUTPUT"
else
    "$APPIMAGETOOL" "$APPDIR" "$OUTPUT"
fi

printf '%s\n' '[5/5] Finished.'
printf '  Package: %s\n' "$OUTPUT"
printf '  Size:    %s\n' "$(du -h "$OUTPUT" | cut -f1)"
