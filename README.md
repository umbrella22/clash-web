# Clash Web

Clash Web 是一个基于浏览器的 mihomo（Clash Meta）管理面板，目标是在 Linux 主机或局域网环境中，通过 Web UI 管理代理核心、订阅配置、节点选择、实时流量、连接、日志和系统代理相关设置。

## 我们做了什么

- 搭建了 Rust + Axum 后端服务，提供 Web 静态文件托管、REST API、WebSocket/SSE 实时流和 mihomo API 代理能力。
- 搭建了 React + MUI + Vite 前端，包含概览、代理、配置、连接、日志、规则和设置等页面。
- 实现了 Profile 管理能力，包括新增、编辑、删除、激活、重排序、远程订阅更新、文件导入和配置文件在线编辑。
- 实现了 mihomo 管理能力，包括服务启动/停止/重启、运行模式切换、版本检测、一键安装/升级和下载进度展示。
- 实现了实时监控能力，包括流量、内存、日志、连接列表、规则和代理节点延迟测试。
- 实现了备份/恢复能力，用于保存和还原 service 配置、DNS 配置、profiles 元数据和 profile 文件目录。
- 加强了稳定性和安全性，包括订阅重试参数限幅、调度周期校验、安装下载超时、备份容量限制、错误响应脱敏、下载进度单例化和日志 WebSocket 自动重连。

## 技术栈

- 后端：Rust、Axum、Tokio、Reqwest、Tower HTTP
- 前端：React、TypeScript、MUI、Vite、TanStack Query、Axios、Chart.js
- 运行时：mihomo 作为代理核心，clash-web-service 作为 Web 管理服务
- 部署：支持 systemd 服务、Debian/Ubuntu deb 包和 Linux x86_64 AppImage

## 项目结构

```text
clash-web/
├── crates/
│   ├── clash-web-service/   # Axum HTTP 服务、API 路由、静态文件托管
│   ├── clash-web-core/      # mihomo 客户端、配置、Profile、订阅、备份、安装器
│   └── clash-web-utils/     # 共享错误类型和响应封装
├── web/                     # React + MUI + Vite 前端
├── packaging/               # deb 打包、systemd、polkit 配置
├── dev-service.yaml         # 开发环境服务配置示例
└── Cargo.toml               # Rust workspace
```

## 开发环境运行

### 1. 准备依赖

需要安装：

- Rust 1.98.1（由 `rust-toolchain.toml` 固定，本地与 CI 使用同一版本）
- Node.js
- pnpm
- 可选：本机 mihomo 或通过 Web UI 后续安装 mihomo

### 2. 配置服务

开发配置文件是 `dev-service.yaml`。如果服务监听 `0.0.0.0` 或其他非本地地址，必须设置访问令牌：

```yaml
server:
  host: 0.0.0.0
  port: 9097

mihomo:
  api_url: http://127.0.0.1:9090
  config_dir: /home/ikaros/clash-web/.runtime/clash-web
  secret: ""

auth:
  token: "请替换为你的访问令牌"
```

如果只想本机开发访问，也可以把 `server.host` 改成 `127.0.0.1`。

### 3. 启动后端

```bash
cargo run -- --config dev-service.yaml
```

后端默认监听配置中的端口，例如：

```text
http://127.0.0.1:9097
http://<LAN_IP>:9097
```

### 4. 启动前端开发服务器

```bash
pnpm --dir web dev
```

前端开发服务器默认运行在：

```text
http://127.0.0.1:5173
```

Vite 会将 `/api` 请求代理到后端服务。

## 构建

### 后端检查/构建

```bash
cargo check
cargo build
cargo build --release
```

### 前端构建

```bash
pnpm --dir web build
```

构建产物会输出到 `web/dist`。

## 打包 deb

项目提供了 deb 打包脚本：

```bash
./packaging/build-deb.sh
```

也可以指定版本和架构：

```bash
./packaging/build-deb.sh 0.1.0 amd64
./packaging/build-deb.sh 0.1.0 i386
./packaging/build-deb.sh 0.1.0 arm64
```

生成的安装包位于：

```text
target/deb/clash-web_<version>_<arch>.deb
```

安装：

```bash
sudo dpkg -i target/deb/clash-web_0.1.0_amd64.deb
```

安装后常用命令：

```bash
sudo systemctl start clash-web
sudo systemctl status clash-web
sudo systemctl restart clash-web
```

生产配置文件位于：

```text
/etc/clash-web/service.yaml
```

首次通过局域网访问前，请确保 `/etc/clash-web/service.yaml` 中设置了 `auth.token`。服务绑定非本地地址且 token 为空时会拒绝启动。

## 打包 AppImage

项目也提供面向 Linux 桌面环境的 x86_64 AppImage 打包脚本。它使用用户目录保存服务配置和 mihomo 数据，不会安装 systemd 服务：

```bash
# 需要 Rust、Node.js、pnpm、clang、lld、rsvg-convert 和 appimagetool
APPIMAGETOOL=/path/to/appimagetool \
  ./packaging/build-appimage.sh 0.1.0
```

生成的文件位于：

```text
target/appimage/clash-web_<version>_x86_64.AppImage
```

运行 AppImage 后，使用浏览器访问 `http://127.0.0.1:9097`。服务配置默认保存在 `${XDG_CONFIG_HOME:-$HOME/.config}/clash-web/service.yaml`，mihomo、profiles 和备份数据默认保存在 `${XDG_DATA_HOME:-$HOME/.local/share}/clash-web`。如果系统没有 FUSE 2，可以使用：

```bash
./target/appimage/clash-web_0.1.0_x86_64.AppImage --appimage-extract-and-run
```

AppImage 适合便携使用，不会创建或启用系统级 systemd unit。当前 Web UI 中 mihomo 的启动、停止和重启操作仍依赖 `systemctl`，TUN 模式仍需要系统授予相应网络权限；需要完整系统服务能力时请使用 deb 包。

## Clash Web 应用更新

在设置页的“Clash Web 应用更新”中，可以检查 [GitHub 稳定发布](https://github.com/umbrella22/clash-web/releases)、查看发布说明，或点击“立即更新并重启”。此入口更新管理服务和 Web 界面；mihomo 核心继续使用单独的版本管理入口。

检查周期默认为 24 小时，可设置为 1–720 小时的整数，或设置为 0 以关闭定时检查。开启“自动安装更新”后，后台会在定时检查发现新版本时自动安装；浏览器关闭后仍然执行。设置和上次检查结果保存在 `<mihomo.config_dir>/app-update.json`，服务重启后仍有效。

自动安装支持通过 deb 安装并使用 systemd 的 Linux 主机，按当前架构选择 amd64、i386 或 arm64 安装包。AppImage 和源码运行支持检查版本，可通过版本链接下载更新。首次启用此功能，需要先安装包含 `clash-web-update.service` 和对应 polkit 规则的新版 deb 包。

安装任务会从固定 GitHub 仓库重新获取发布信息，在独立 systemd 服务中下载并验证 SHA-256、包名、版本和架构，随后通过 dpkg 保留本机配置并升级。Web 服务会短暂重启，原先运行的 mihomo 会恢复运行；页面在新版本恢复响应后自动刷新。安装包尚未上传或缺少 SHA-256 摘要时不会开始安装。下载或校验失败不会修改当前安装；安装失败会显示错误，系统包管理器报告的失败可能需要人工修复。

查看更新任务日志：

```bash
journalctl -u clash-web-update.service
```

## 离线导入 mihomo 核心

当服务器无法访问 GitHub 时，可以在另一台设备下载 mihomo 官方 `mihomo-<os>-<arch>-vX.Y.Z.gz` 压缩包，放到服务约定的导入目录，然后在 Web UI 的 Settings 页面点击“本地安装包”中的安装按钮：

```text
deb 安装:    /etc/clash-web/incoming/
AppImage:    ${XDG_DATA_HOME:-$HOME/.local/share}/clash-web/incoming/
开发运行:     service.yaml 中 mihomo.config_dir 指向目录下的 incoming/
```

要求：

- 文件名必须是 `mihomo-*.gz` 单文件 gzip 压缩包（不支持 `.tar.gz`）；
- 架构需要与本机一致（安装前会校验 ELF 架构并执行 `mihomo -v`）；
- 压缩包不能超过 100 MB。

校验通过后核心会原子替换到 `<config_dir>/bin/mihomo`；任何失败都会保留现有核心，源压缩包不会被自动删除。deb 包中该目录由 `clash-web` 用户管理，放入文件后如遇权限问题可执行 `sudo chown clash-web:clash-web /etc/clash-web/incoming/<文件名>`。

## Web UI 使用流程

1. 打开浏览器访问 `http://<服务器 IP>:9097`。
2. 如果启用了访问令牌，输入 `service.yaml` 中配置的 `auth.token` 登录。
3. 进入 Settings 页面检查 mihomo 安装状态，未安装时可点击安装。
4. 进入 Profiles 页面添加远程订阅或本地配置。
5. 激活 Profile 后，服务会生成运行时配置并应用到 mihomo。
6. 在 Proxies 页面切换代理节点，或在 Overview 页面查看实时状态。
7. 在 Connections、Logs、Rules 页面查看连接、日志和规则命中情况。
8. 在 Settings 页面管理备份、DNS、TUN、系统代理和 mihomo 版本。

## API 和访问控制

- 管理 API 前缀：`/api/v1`
- mihomo 代理 API：通过后端白名单代理到 mihomo external-controller
- 实时数据：WebSocket/SSE 用于流量、内存、日志和下载进度
- 认证方式：`Authorization: Bearer <token>`
- 安全约束：当服务绑定非 loopback 地址时必须配置 `auth.token`

## 重要注意事项

- `auth.token` 不要留空后暴露到局域网或公网。
- mihomo 默认 external-controller 建议保持 `127.0.0.1:9090`，由 clash-web-service 统一代理访问。
- 备份功能已经有数量和容量限制，但仍建议定期清理无用备份。
- Web UI 可以执行启动/停止 mihomo、修改配置、安装/升级核心等高权限操作，请只部署在可信网络中。
- 前端构建可能提示 chunk 体积超过 500 kB，这是性能优化提示，不影响正常使用。

## 最近的质量修复

- 修复订阅调度周期异常导致后台任务 panic 的风险。
- 修复订阅重试参数无上限导致请求长期占用的问题。
- 修复 mihomo 安装/版本检查网络请求无超时的问题。
- 修复备份无限增长和递归同步 IO 阻塞异步 worker 的问题。
- 修复 500 错误直接暴露底层错误细节的问题。
- 修复下载进度 SSE 多组件重复订阅的问题。
- 修复日志 WebSocket 断开后不重连的问题。
- 修复 Profile 编辑器切换到空文件时保留旧内容的问题。
- 修复 Connections 请求失败被显示为空连接的问题。
- 修复 TUN Stack 修改时按钮动作可能误关闭 TUN 的问题。

## 验证命令

当前代码已通过以下验证：

```bash
cargo check
pnpm --dir web build
```
