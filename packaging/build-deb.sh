#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-0.1.0}"
ARCH="${2:-$(dpkg --print-architecture)}"
TARGET_TRIPLE="${3:-}"
PKG_NAME="clash-web_${VERSION}_${ARCH}"
BUILD_DIR="${PROJECT_DIR}/target/deb/${PKG_NAME}"

resolve_target_triple() {
    local arch="$1"
    case "$arch" in
        amd64)
            echo "x86_64-unknown-linux-gnu"
            ;;
        arm64)
            # Use musl for a self-contained Raspberry Pi build that does not
            # require an external aarch64 GNU linker on the build host.
            echo "aarch64-unknown-linux-musl"
            ;;
        *)
            echo "Unsupported Debian architecture: ${arch}" >&2
            exit 1
            ;;
    esac
}

configure_target_toolchain() {
    local target="$1"
    case "$target" in
        aarch64-unknown-linux-musl)
            local sysroot
            sysroot="$(rustc --print sysroot)"
            local lld_dir="/tmp/clash-web-toolchain"
            mkdir -p "$lld_dir"
            ln -sf "${sysroot}/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld" "${lld_dir}/ld.lld"

            export CC_aarch64_unknown_linux_musl=clang
            export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=clang
            export CFLAGS_aarch64_unknown_linux_musl="--target=aarch64-unknown-linux-musl"
            export RUSTFLAGS="-Clink-self-contained=yes -Clink-arg=--target=aarch64-unknown-linux-musl -Clink-arg=-B${lld_dir} -Clink-arg=-fuse-ld=lld"
            ;;
    esac
}

write_default_configs() {
    local config_dir="$1"

    cat > "${config_dir}/service.yaml" <<'EOF'
server:
  host: "0.0.0.0"
  port: 9097

mihomo:
  api_url: "http://127.0.0.1:9090"
  secret: ""
  config_dir: "/etc/clash-web"

auth:
  token: ""
EOF

    cat > "${config_dir}/config.yaml" <<'EOF'
mixed-port: 7890
allow-lan: false
bind-address: "*"
mode: rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090
dns:
  enable: true
  listen: 0.0.0.0:1053
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
EOF
}

if [[ -z "$TARGET_TRIPLE" ]]; then
    TARGET_TRIPLE="$(resolve_target_triple "$ARCH")"
fi

echo "=== Building clash-web ${VERSION} for ${ARCH} (${TARGET_TRIPLE}) ==="

echo "[1/5] Building Rust backend (release)..."
cd "$PROJECT_DIR"
configure_target_toolchain "$TARGET_TRIPLE"
cargo build --release --target "$TARGET_TRIPLE"

echo "[2/5] Building frontend..."
pnpm --dir web build

echo "[3/5] Assembling package structure..."
rm -rf "${PROJECT_DIR}/target/deb"
mkdir -p "$BUILD_DIR"

mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/usr/share/clash-web/ui"
mkdir -p "$BUILD_DIR/etc/clash-web/profiles"
mkdir -p "$BUILD_DIR/etc/clash-web/bin"
mkdir -p "$BUILD_DIR/lib/systemd/system"
mkdir -p "$BUILD_DIR/etc/polkit-1/rules.d"
write_default_configs "$BUILD_DIR/etc/clash-web"

cp "${PROJECT_DIR}/target/${TARGET_TRIPLE}/release/clash-web-service" "$BUILD_DIR/usr/bin/"
chmod 755 "$BUILD_DIR/usr/bin/clash-web-service"

cp -r "${PROJECT_DIR}/web/dist/"* "$BUILD_DIR/usr/share/clash-web/ui/"

cp "${PROJECT_DIR}/packaging/systemd/mihomo.service" "$BUILD_DIR/lib/systemd/system/"
cp "${PROJECT_DIR}/packaging/systemd/clash-web.service" "$BUILD_DIR/lib/systemd/system/"
cp "${PROJECT_DIR}/packaging/polkit/10-clash-web-mihomo.rules" "$BUILD_DIR/etc/polkit-1/rules.d/"

mkdir -p "$BUILD_DIR/DEBIAN"
cp "${PROJECT_DIR}/packaging/DEBIAN/control" "$BUILD_DIR/DEBIAN/control"
cp "${PROJECT_DIR}/packaging/DEBIAN/conffiles" "$BUILD_DIR/DEBIAN/conffiles"
cp "${PROJECT_DIR}/packaging/DEBIAN/postinst" "$BUILD_DIR/DEBIAN/postinst"
cp "${PROJECT_DIR}/packaging/DEBIAN/prerm" "$BUILD_DIR/DEBIAN/prerm"
cp "${PROJECT_DIR}/packaging/DEBIAN/postrm" "$BUILD_DIR/DEBIAN/postrm"
chmod 755 "$BUILD_DIR/DEBIAN/postinst" "$BUILD_DIR/DEBIAN/prerm" "$BUILD_DIR/DEBIAN/postrm"

sed -i "s/Version: .*/Version: ${VERSION}/" "$BUILD_DIR/DEBIAN/control"
sed -i "s/Architecture: .*/Architecture: ${ARCH}/" "$BUILD_DIR/DEBIAN/control"

EST_SIZE=$(du -sk "$BUILD_DIR" | cut -f1)
echo "Installed-Size: ${EST_SIZE}" >> "$BUILD_DIR/DEBIAN/control"

echo "[4/5] Calculating checksums..."
cd "$BUILD_DIR"
find etc lib usr -type f -exec md5sum {} \; > "$BUILD_DIR/DEBIAN/md5sums"
cd "$PROJECT_DIR"

echo "[5/5] Building deb package..."
dpkg-deb --build "$BUILD_DIR" "${PROJECT_DIR}/target/deb/${PKG_NAME}.deb"

DEB_FILE="${PROJECT_DIR}/target/deb/${PKG_NAME}.deb"
DEB_SIZE=$(du -h "$DEB_FILE" | cut -f1)

echo ""
echo "=== Build complete! ==="
echo "  Package: ${DEB_FILE}"
echo "  Size:    ${DEB_SIZE}"
echo ""
echo "  Install: sudo dpkg -i ${DEB_FILE}"
echo ""
