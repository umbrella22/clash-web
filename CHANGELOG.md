# Changelog

## [0.4.0](https://github.com/umbrella22/clash-web/compare/clash-web-v0.3.0...clash-web-v0.4.0) (2026-09-15)

### Features

* Add GitHub release checks, configurable check intervals, and automatic application updates for deb installations using systemd.
* Verify release package checksums, preserve local configuration, and report installation and service restart status.

### Bug Fixes

* Recover stalled traffic monitoring streams and wait for mihomo readiness before connecting.
* Sort proxy nodes by ascending latency after ping tests and preserve results across stale polling responses.
* Configure routing and DNS interception when enabling TUN, and detect failed device creation.

### Dependencies

* Pin Rust 1.98.1 across local and CI builds, upgrade Rust dependencies, and lock dependencies when packaging.
* Apply consistent Rust formatting across the workspace.

## [0.3.0](https://github.com/umbrella22/clash-web/compare/clash-web-v0.2.1...clash-web-v0.3.0) (2026-08-27)


### Features

* Refactor Logs, Overview, Profiles, Proxies, Rules, and Settings pages to include auxiliary titles; update theme colors and add local Mihomo package management functionality ([0e1ee29](https://github.com/umbrella22/clash-web/commit/0e1ee29d47d3dc589888c6c0e6050c1150e21b47))

## [0.2.1](https://github.com/umbrella22/clash-web/compare/clash-web-v0.2.0...clash-web-v0.2.1) (2026-08-25)


### Bug Fixes

* 优化构建脚本错误 ([faeaf8f](https://github.com/umbrella22/clash-web/commit/faeaf8f4ca7520da0d2acd4bb467d6ff4e031f78))

## [0.2.0](https://github.com/umbrella22/clash-web/compare/clash-web-v0.1.0...clash-web-v0.2.0) (2026-08-25)


### Features

* create utility for consistent API error formatting ([7dc3213](https://github.com/umbrella22/clash-web/commit/7dc321378938ceefc1174067f3b8a5242b447cab))
* enhance RulesPage with improved error handling, sorting, and indexing ([7dc3213](https://github.com/umbrella22/clash-web/commit/7dc321378938ceefc1174067f3b8a5242b447cab))
* enhance subscription handling and user agent support ([8336d95](https://github.com/umbrella22/clash-web/commit/8336d954b0e63e60924002f99450e846d3ba0e45))
* improve SettingsPage with token management and confirmation dialogs ([7dc3213](https://github.com/umbrella22/clash-web/commit/7dc321378938ceefc1174067f3b8a5242b447cab))
* 发布 ([9602ac0](https://github.com/umbrella22/clash-web/commit/9602ac0a70adaf8970999b49d2e89fe4104efe67))
* 新增项目文档、优化认证与运行时配置处理 ([6852f2c](https://github.com/umbrella22/clash-web/commit/6852f2c35d767a5d8dbf2c65e43f35bb22860f65))
* 重构前端状态管理与优化前后端功能 ([90b5eca](https://github.com/umbrella22/clash-web/commit/90b5eca23c3f0f7ad1ca74fe1986902d1bb85949))


### Bug Fixes

* update API service calls to handle timeouts and improve error handling ([7dc3213](https://github.com/umbrella22/clash-web/commit/7dc321378938ceefc1174067f3b8a5242b447cab))
