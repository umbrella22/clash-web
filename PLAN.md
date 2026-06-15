# Clash-Web 开发计划

## 项目目标
构建一个 Linux deb 包，提供 Clash Verge Rev 的完整功能，通过局域网 Web 浏览器访问控制。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器 (局域网访问)                      │
│              http://<LAN_IP>:9097                        │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              clash-web-service (Rust/Axum)               │
│                                                         │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ 静态文件服务  │ │ 管理 REST API │ │ mihomo API 代理   │  │
│  │ (前端 SPA)   │ │ /api/*       │ │ /mihomo/*        │  │
│  └─────────────┘ └──────────────┘ └───────┬──────────┘  │
│                                           │             │
│  ┌──────────────────────────────────────┐ │             │
│  │ 核心模块:                             │ │             │
│  │ • mihomo 进程管理                     │ │             │
│  │ • 订阅/配置文件管理                    │ │             │
│  │ • 配置增强 (Merge/Script)             │ │             │
│  │ • 系统代理管理                        │ │             │
│  │ • TUN 模式管理                        │ │             │
│  │ • WebDAV 备份同步                     │ │             │
│  │ • 内核版本管理                        │ │             │
│  │ • 定时任务 (订阅更新)                  │ │             │
│  └──────────────────────────────────────┘ │             │
└───────────────────────────────────────────┼─────────────┘
                                            │
                    ┌───────────────────────▼──────┐
                    │     mihomo 内核进程            │
                    │  external-controller: 9090    │
                    │  (代理引擎、规则匹配、连接管理) │
                    └──────────────────────────────┘
```

### 技术栈选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 后端 | **Rust + Axum** | 与 Clash Verge Rev 后端同语言，可复用大量核心逻辑 |
| 前端 | **React + MUI + Vite** | 从零构建 Web 前端，仅复用 i18n 文本 |

---

## 技术决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 前端策略 | 从零构建 (React + MUI) | 不移植 CVR 前端，更干净可控，避免大量 Tauri 替换工作 |
| mihomo 管理 | 独立 systemd 服务 | clash-web-service 通过 HTTP API 与 mihomo 通信，systemd 管理生命周期 |
| 持久化 | JSON 文件 | 与 CVR 一致，简单透明，profiles.yaml + profiles/ 目录 |
| 工作空间 | 3 crate (service/core/utils) | service=二进制+路由, core=业务逻辑, utils=共享工具 |
| 代理内核 | **mihomo** | Clash Meta 内核，Go 编译的单二进制 |
| 包格式 | **deb** | systemd 集成，适合 Debian/Ubuntu 服务器 |

---

## 开发阶段

### 第一阶段：项目脚手架与基础服务 ✅ 已完成

**目标**: 搭建可运行的项目骨架

- [x] 1.1 初始化 Rust 工作空间 (Cargo workspace)
  ```
  clash-web/
  ├── Cargo.toml              (workspace)
  ├── crates/
  │   ├── clash-web-service/  (主服务二进制, Axum Web Server)
  │   ├── clash-web-core/     (核心逻辑库: mihomo客户端/配置/Profile模型)
  │   └── clash-web-utils/    (工具函数: 错误类型/IntoResponse)
  ├── web/                    (React 前端)
  │   ├── package.json
  │   ├── vite.config.ts
  │   └── src/
  └── packaging/              (deb 打包相关, 待填充)
  ```
  - workspace 依赖统一管理 (tokio/axum/serde/reqwest/tower-http 等)
  - edition = 2024

- [x] 1.2 Axum Web Server 基础框架
  - HTTP 服务 (默认 0.0.0.0:9097)
  - 静态文件服务 (serve 前端 SPA, fallback → index.html)
  - API 路由框架 (`/api/v1/*`)
  - mihomo REST API 反向代理 (`/api/v1/mihomo/*` → `127.0.0.1:9090`, 支持 GET/POST/PATCH/PUT/DELETE)
  - Token 认证中间件 (Bearer Token, 空Token时跳过认证)
  - CORS 配置 (AllowOrigin/Method/Header: Any)
  - Tower HTTP trace layer
  - MihomoClient HTTP 客户端 (clash-web-core crate, 支持版本查询/状态/流量/代理/通用代理请求)
  - AppConfig 配置管理 (clash-web-core crate, YAML 持久化, 自动创建默认配置)
  - AppError 错误类型 (clash-web-utils crate, 实现 IntoResponse)

- [x] 1.3 React 前端初始化
  - Vite 8 + React 19 + TypeScript 6
  - MUI 9 (Material UI) 组件库 + @emotion
  - React Router 7 (HashRouter) + 7 个页面路由 (Overview/Proxies/Profiles/Connections/Logs/Rules/Settings)
  - TanStack Query 5 (数据请求, 自动重试1次)
  - i18next (中/英双语, localStorage 持久化)
  - 基础布局: MainLayout 响应式侧边导航 + 内容区 (移动端 Drawer 适配)
  - 暗色/亮色主题切换 (ThemeContext + localStorage)
  - Axios API 服务层 (自动 Token 注入, 401 自动跳转)
  - mihomoApi 实例 (代理请求前缀 /api/v1/mihomo)
  - useApi hooks (useStatus/useRestartMihomo/useRuntimeConfig/usePatchRuntimeConfig)

- [x] 1.4 开发环境配置
  - Vite proxy: `/api` → `localhost:9097`
  - `cargo check` / `cargo run` 后端
  - `pnpm --dir web dev` 前端开发服务器
  - `pnpm --dir web build` 前端构建 (tsc + vite build) ✅ 验证通过
  - AGENTS.md 构建命令文档
  - .gitignore

---

### 第二阶段：mihomo 通信与基础 API ✅ 已完成

**目标**: 能通过 Web 查看 mihomo 状态、切换模式、查看实时流量

> **架构决策**: mihomo 作为独立 systemd 服务运行，clash-web-service 通过
> HTTP API 与 mihomo 通信 (非子进程模式)。生命周期通过 `systemctl` 管理。

- [x] 2.1 mihomo 服务生命周期管理 (systemd)
  - `get_service_status("mihomo")` 解析 systemd show 获取 ActiveState/MainPID/ActiveEnterTimestamp
  - `systemctl start/stop/restart` 封装
  - `MihomoClient::is_alive()` 通过 GET /version 健康检查
  - `parse_systemd_timestamp()` 计算运行时间

- [x] 2.2 配置文件基础管理
  - `AppConfig::profiles_dir()` / `ensure_dirs()` 目录管理
  - `DEFAULT_MIHOMO_CONFIG` 默认 mihomo 配置模板 (mixed-port:7890, dns, fake-ip)

- [x] 2.3 后端 REST API - 完整实现
  - `GET /api/v1/status` — 服务状态 + systemd 状态 + mihomo 版本 + 运行时间
  - `POST /api/v1/start` — systemctl start mihomo
  - `POST /api/v1/stop` — systemctl stop mihomo
  - `POST /api/v1/restart` — systemctl restart mihomo
  - `GET /api/v1/mode` — 获取当前模式 (rule/global/direct)
  - `PUT /api/v1/mode` — 切换模式 (含参数校验)
  - `GET /api/v1/runtime/config` — mihomo 运行时配置
  - `PATCH /api/v1/runtime/config` — 热更新配置
  - `GET /api/v1/traffic` — WebSocket 流量实时数据代理
  - `GET /api/v1/memory` — WebSocket 内存实时数据代理
  - `* /api/v1/mihomo/*` — 全方法 mihomo API 反向代理

- [x] 2.4 前端 - Overview 页面
  - mihomo 状态卡片 (运行/停止 + 版本 + PID + 运行时间 + Start/Stop/Restart 按钮)
  - 运行模式卡片 (Rule/Global/Direct Chip 切换, 颜色区分)
  - 实时流量卡片 (WebSocket 60s 滑动窗口柱状图, 上传/下载双色)
  - 内存使用卡片 (用量/总量 + LinearProgress 进度条)
  - `useTraffic` / `useMemory` WebSocket hooks
  - `useStartMihomo` / `useStopMihomo` / `useMode` mutation hooks

---

### 第三阶段：订阅与配置文件管理 ✅ 已完成（增强链待接入激活流程）

**目标**: 完整的订阅导入、管理、增强功能

- [x] 3.1 Profile 数据模型 + 持久化 (`clash-web-core/src/profile.rs`)
  - `Profile` 结构体 (uid/name/desc/type/url/file/selected/updated/extra/subscription_info)
  - `ProfileType` 枚举 (Remote/Local/Merge/Script)
  - `SubscriptionInfo` 结构体 (upload/download/total/expire)
  - `ProfileManager` 异步管理器 (RwLock + JSON 文件持久化)
  - 方法: list/get/create/update/delete/reorder/get_active/set_active/read_file/write_file/update_subscription_info

- [x] 3.2 订阅管理后端 API (`clash-web-service/src/api/profiles.rs`)
  - `GET /api/v1/profiles` — 列表 (含 active 标识)
  - `POST /api/v1/profiles` — 新增 (支持 remote/local/merge/script 四种类型)
  - `GET /api/v1/profiles/{uid}` — 获取单个详情
  - `PUT /api/v1/profiles/{uid}` — 更新元信息
  - `DELETE /api/v1/profiles/{uid}` — 删除 (同时删除文件)
  - `POST /api/v1/profiles/{uid}/activate` — 激活并应用到 mihomo
  - `POST /api/v1/profiles/{uid}/update` — 刷新远程订阅
  - `PUT /api/v1/profiles/reorder` — 重排序
  - `GET /api/v1/profiles/{uid}/file` — 读取文件内容
  - `PUT /api/v1/profiles/{uid}/file` — 保存文件内容
  - `POST /api/v1/profiles/import` — 文件上传导入 (multipart)

- [x] 3.3 订阅下载与解析 (`clash-web-core/src/subscription/`)
  - `download_subscription()` — HTTP(S) 下载, 自定义 User-Agent
  - `parse_subscription_info()` — 解析 subscription-userinfo 响应头 (upload/download/total/expire)
  - 自动更新 subscription_info 和 updated 时间戳

- [x] 3.4 配置增强系统 (`clash-web-core/src/enhance.rs`)
  - `apply_merge()` — YAML 深度合并, 支持 prepend-rules/append-rules/prepend-proxies 等
  - `build_runtime_config()` — 增强链: Profile → Merge profiles → 最终配置
  - 当前状态: merge 核心能力已实现，但激活流程尚未完整接入；Script 模式 (boa_engine) 待后续迭代

- [x] 3.5 前端 Profiles 页面
  - 配置文件卡片网格 (名称/类型图标/描述/更新时间/订阅流量信息)
  - 激活状态高亮 (蓝色边框 + Active Chip)
  - 新建配置对话框 (名称/类型选择/URL输入)
  - 文件编辑器对话框 (monospace TextField, 读取/保存)
  - 文件上传导入 (点击上传 .yaml/.yml/.txt)
  - 远程订阅刷新 (单个 + 全部更新)
  - 删除确认 (直接按钮)
  - React Query hooks: useProfiles/useCreateProfile/useDeleteProfile/useActivateProfile/useUpdateSubscription/useProfileFile/useSaveProfileFile/useImportProfile

---

### 第四阶段：代理管理页面 ✅ 已完成

**目标**: 节点切换、延迟测试等核心代理操作

- [x] 4.1 mihomo API 对接 (通过后端代理 `/api/v1/proxy/*`)
  - 代理组列表 (`GET /proxies`) — 通过 mihomoApi (baseURL: `/api/v1/proxy`)
  - 切换代理 (`PUT /proxies/:group`)
  - 延迟测试 (`GET /proxies/:name/delay?timeout=5000&url=...`)
  - mihomo proxy 路由从 `/mihomo/*` 改为 `/proxy/*` (避免与安装 API 冲突)

- [x] 4.2 前端 - Proxies 页面
  - 代理组列表 (Selector/URLTest/Fallback/LoadBalance，Tab 过滤)
  - 节点 Chip 点击切换 (当前选中高亮蓝色)
  - 延迟显示 (历史记录最新值)
  - 批量延迟测试 (顶部 Speed 按钮)
  - 搜索过滤 (按组名/节点名)
  - 自动刷新 (10s)
  - `ProxyGroup` 类型接口，`useQuery` + `useMutation`
  - 当前状态: `/api/v1/proxy` 根路径访问仍需通过实际运行验证

- [x] 4.3 前端 - Proxy Provider 管理
  - Providers Tab 页 (过滤 Compatible 类型)
  - 订阅流量信息显示 (Used/Total 进度条 + 过期时间)
  - 更新 Provider (PUT /providers/proxies/:name)
  - Health Check 按钮
  - 自动刷新 (30s)

---

### 第五阶段：连接、日志、规则页面 ✅ 已完成

**目标**: 监控与调试功能

- [x] 5.1 前端 - Connections 页面
  - 实时连接列表 (2s 轮询 REST `/connections`)
  - 表格视图 (Host/Network/Type/Chains/DL/UL/Time/操作)
  - 关闭单个连接 (`DELETE /connections/:id`)
  - 关闭所有连接 (`DELETE /connections`)
  - 连接搜索/过滤
  - 格式化显示 (字节数/运行时间)

- [x] 5.2 前端 - Logs 页面
  - 实时日志流 (WebSocket: `/api/v1/logs?level=debug`)
  - 后端 WebSocket 代理 (`traffic.rs::ws_logs`, 通用 `proxy_stream` + `MihomoClient::get_stream`)
  - 日志级别筛选 (All/Info/Warning/Error/Debug Chip 过滤)
  - 日志搜索
  - 自动滚动到底部, 2000 条缓冲
  - 彩色级别标签 (error=红, warning=橙, info=蓝, debug=灰)
  - 当前状态: 启用 Access Token 时仍需补齐 WebSocket token 传递方案

- [x] 5.3 前端 - Rules 页面
  - 规则列表表格 (Type Chip / Payload / Proxy)
  - 规则搜索 (按 type/payload/proxy)
  - 最多显示 500 条

---

### 第六阶段：系统设置页面 ✅ 已完成 (基础功能)

**目标**: 基本的配置管理能力

- [x] 6.1 Clash 设置
  - Mixed Port 修改
  - Allow LAN 开关
  - IPv6 开关
  - Log Level 选择 (Silent/Error/Warning/Info/Debug)
  - 保存按钮 → `PATCH /api/v1/runtime/config`

- [x] 6.2 Web 设置
  - 语言切换 (English/中文, i18next + localStorage 持久化)
  - 主题切换 (Dark/Light, ThemeContext + localStorage)
  - Access Token 编辑 (localStorage, 即时生效)

- [x] 6.3 系统代理管理
  - 后端 `system.rs` API (GET/POST /api/v1/system/proxy)
  - gsettings 读取/设置 GNOME 系统代理 (HTTP/HTTPS/SOCKS)
  - 前端 Settings 页 System Proxy 卡片 (启用/禁用 + 当前代理显示)

- [x] 6.4 TUN 模式管理
  - 后端 `system.rs` API (GET/POST /api/v1/system/tun)
  - mihomo tun 配置热更新 (enable + stack)
  - 前端 Settings 页 TUN Mode 卡片 (启用/禁用 + Stack 选择)

---

### mihomo 自动检测与安装 ✅ 已完成

**目标**: 用户无需手动安装 mihomo，首次使用时一键下载

- [x] 后端 `MihomoInstaller` (`clash-web-core/src/installer.rs`)
  - `detect()` — 检查 `{config_dir}/bin/mihomo` 或 `which mihomo`, 获取版本
  - `download_url()` — 自动拼接平台 URL (linux/darwin/windows × amd64/arm64/armv7/riscv64/loong64)
  - `get_latest_version()` — GitHub API `repos/MetaCubeX/mihomo/releases/latest`
  - `download_and_install()` — 下载 .gz → flate2 gunzip 解压 → chmod 755 → 写入默认 config.yaml
  - API: `GET /api/v1/mihomo/status` + `POST /api/v1/mihomo/install`

- [x] 前端 Overview 页面安装提示
  - 未安装: 黄色 Alert + "Install Now" 按钮 (一键下载安装, 120s 超时)
  - 已安装: 绿色 Alert 显示版本和路径
  - 安装中: Loading spinner
  - 安装完成: 自动刷新页面状态

---

### 第七阶段：高级功能

- [x] 7.1 内核版本管理
  - 后端 `check_version_async()` 异步版本检测 (regex 版本比较)
  - 后端 API: `GET /api/v1/mihomo/check` + `POST /api/v1/mihomo/upgrade`
  - 下载进度追踪 (tokio::watch channel + SSE endpoint `/api/v1/mihomo/progress`)
  - 流式下载 (futures_util::StreamExt, 逐 chunk 报告进度)
  - 前端 Settings 页 Mihomo Version 卡片:
    - 当前版本 / 最新版本 / 架构显示
    - 版本比较 (has_update 状态提示)
    - 升级按钮 + SSE 进度条 (下载/解压/完成)
    - 一键安装 (未安装时)

- [ ] 7.2 可视化编辑器 (可选, 后续迭代)
  - 可视化节点编辑 (添加/编辑代理节点)
  - 可视化规则编辑 (添加/编辑路由规则)

---

### 第八阶段：Deb 打包与部署 ✅ 已完成 (基础打包)

**目标**: 生成可直接安装的 deb 包

- [x] 8.1 构建脚本 (`packaging/build-deb.sh`)
  ```bash
  # 构建流程
  1. cargo build --release          # 编译 Rust 后端
  2. cd web && pnpm build           # 编译前端
  3. 组装 deb 包 (自动)
  ```

- [x] 8.2 Deb 包结构
  ```
  clash-web_0.1.0_amd64.deb
  ├── DEBIAN/
  │   ├── control           # 包元信息 (版本/架构/依赖)
  │   ├── conffiles          # 标记配置文件 (升级时保留)
  │   ├── postinst          # 安装后: 创建用户/创建目录/启用服务/设置权限
  │   ├── prerm             # 卸载前: 停止服务
  │   ├── postrm            # 卸载后: 清理 (purge 时删除用户/服务)
  │   └── md5sums            # 文件校验和 (自动生成)
  ├── usr/
  │   ├── bin/
  │   │   └── clash-web-service         # Web 管理服务
  │   └── share/clash-web/
  │       └── ui/                       # 前端静态文件
  ├── etc/
  │   └── clash-web/
  │       ├── profiles/                 # 配置文件存储目录 (空)
  │       └── bin/                      # mihomo 安装目录 (空)
  └── lib/systemd/system/
      ├── mihomo.service                # mihomo systemd 单元
      └── clash-web.service             # Web 服务 systemd 单元
  ```

- [x] 8.3 Systemd 服务配置
  - mihomo.service: CAP_NET_ADMIN/RAW/BIND_SERVICE, LimitNOFILE=65535
  - clash-web.service: --config /etc/clash-web/service.yaml

- [x] 8.4 静态文件服务多路径支持
  - 开发环境: `web/dist` (相对路径)
  - 生产环境: `/usr/share/clash-web/ui` (绝对路径)
  - 自动检测哪个路径存在

- [x] 8.5 安装后体验
  ```bash
  sudo dpkg -i clash-web_0.1.0_amd64.deb
  # 自动创建 clash-web 用户, 创建目录, 启用服务
  # 浏览器访问 http://<IP>:9097
  # 首次打开 → Settings 页面安装 mihomo 内核
  ```

---

## 从 Clash Verge Rev 复用的代码

| 模块 | 源位置 | 复用方式 |
|------|--------|---------|
| 配置增强 (Merge) | `src-tauri/src/enhance/` | 直接移植 Rust 代码 |
| 配置增强 (Script) | `src-tauri/src/enhance/` | 直接移植 (boa_engine JS 引擎) |
| 配置文件模型 | `src-tauri/src/config/` | 移植数据结构 |
| WebDAV 操作 | `src-tauri/src/cmd/webdav.rs` | 移植 (reqwest_dav) |
| 系统代理 | `sysproxy-rs` | 直接引用 crate (仅 Linux 部分) |
| 国际化文本 | `src/locales/` | 直接复制 JSON |
| 前端组件 | `src/components/` | 移植，替换 Tauri API 调用 |
| 前端页面 | `src/pages/` | 移植，替换 Tauri API 调用 |
| 前端服务层 | `src/services/cmds.ts` | 重写为 HTTP fetch 调用 |

### 前端改造要点 (Tauri → Web)

需要替换的 Tauri 特有 API：
```
@tauri-apps/api → 原生 Web API
├── invoke("cmd_name", args)     →  fetch("/api/v1/...", { method, body })
├── listen("event-name")         →  WebSocket / SSE
├── @tauri-apps/plugin-dialog    →  自定义弹窗组件
├── @tauri-apps/plugin-fs        →  后端 API + 文件上传
├── @tauri-apps/plugin-shell     →  后端 API
├── @tauri-apps/plugin-clipboard →  navigator.clipboard
├── @tauri-apps/plugin-updater   →  后端 API 检查更新
└── @tauri-apps/plugin-http      →  fetch / 后端代理
```

---

## 安全设计

1. **Access Token**: 首次访问设置 Token，后续请求 Header 携带 `Authorization: Bearer <token>`
2. **仅监听局域网**: 默认 `0.0.0.0:9097`，可配置绑定特定接口
3. **HTTPS 可选**: 支持配置 TLS 证书
4. **mihomo API 不直接暴露**: 通过后端代理访问，由后端验证权限

---

## 开发优先级排序

```
P0 (最小可用产品):
  第一阶段 → 第二阶段 → 第三阶段 → 第四阶段 → 第八阶段(基础打包)
  = 能用浏览器管理订阅、切换节点、查看流量

P1 (完整功能):
  第五阶段 → 第六阶段

P2 (增强功能):
  第七阶段 → 可视化编辑器
```

---

## 开发环境要求

```bash
# Linux (推荐 Ubuntu 22.04+)
# Rust 工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# Node.js (pnpm)
curl -fsSL https://get.pnpm.io/install.sh | sh
pnpm env use --global lts

# 构建工具
sudo apt install build-essential pkg-config libssl-dev

# 开发用 mihomo
# 从 https://github.com/MetaCubeX/mihomo/releases 下载对应架构版本
```
