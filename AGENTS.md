# Build Commands

## Backend
- `cargo check` — Type-check Rust code
- `cargo build` — Build Rust backend
- `cargo build --release` — Release build

## Frontend
- `pnpm --dir web build` — Build frontend (runs tsc + vite build)
- `pnpm --dir web dev` — Start Vite dev server (port 5173)

## Development
- Start backend: `cargo run` (starts Axum on 0.0.0.0:9097)
- Start frontend dev: `pnpm --dir web dev` (proxies /api → localhost:9097)

# Project Structure
- `crates/clash-web-service/` — Main Axum binary (HTTP server, API routes)
- `crates/clash-web-core/` — Core logic (mihomo client, config, profiles)
- `crates/clash-web-utils/` — Shared utilities (error types)
- `web/` — React + MUI + Vite frontend
