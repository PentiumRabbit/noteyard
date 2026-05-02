#!/usr/bin/env bash
# build-sidecar.sh — 交叉编译 Go server 二进制至 src-tauri/binaries/
# 支持平台：macOS ARM64 / macOS x86_64 / Windows x64 / Linux x64
# 要求：CGO_ENABLED=0（使用 modernc.org/sqlite 纯 Go 实现）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"
OUT_DIR="${REPO_ROOT}/src-tauri/binaries"
BINARY_NAME="noteyard-server"

echo "Building Go sidecar binaries → ${OUT_DIR}"
echo "Server dir: ${SERVER_DIR}"
echo ""

build() {
  local goos="$1"
  local goarch="$2"
  local target_name="$3"
  local out_path="${OUT_DIR}/${target_name}"

  echo "  [${goos}/${goarch}] → ${target_name}"
  # 删除已存在的占位文件，避免 go build 因非 object 文件报错
  rm -f "${out_path}"
  (cd "${SERVER_DIR}" && GOOS="${goos}" GOARCH="${goarch}" CGO_ENABLED=0 \
    go build -o "${out_path}" ./cmd/main.go)
}

# macOS ARM64
build darwin arm64 "${BINARY_NAME}-aarch64-apple-darwin"

# macOS x86_64
build darwin amd64 "${BINARY_NAME}-x86_64-apple-darwin"

# Windows x64 (需要 .exe 后缀)
build windows amd64 "${BINARY_NAME}-x86_64-pc-windows-msvc.exe"

# Linux x64
build linux amd64 "${BINARY_NAME}-x86_64-unknown-linux-gnu"

echo ""
echo "Done. Binaries:"
ls -lh "${OUT_DIR}/${BINARY_NAME}-"*
