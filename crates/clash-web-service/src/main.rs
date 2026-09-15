mod api;
mod middleware;
mod state;
mod updater;

use clap::Parser;
use clash_web_core::AppConfig;
use state::AppState;
use std::net::IpAddr;

fn requires_auth_token(config: &AppConfig) -> bool {
    if !config.auth.token.is_empty() {
        return false;
    }

    match config.server.host.parse::<IpAddr>() {
        Ok(IpAddr::V4(addr)) => !addr.is_loopback(),
        Ok(IpAddr::V6(addr)) => !addr.is_loopback(),
        Err(_) => config.server.host != "localhost",
    }
}

#[derive(Parser, Debug)]
#[command(name = "clash-web-service", about = "Clash Web Management Service", version = updater::CURRENT_VERSION)]
struct Args {
    #[arg(short, long, default_value = "/etc/clash-web/service.yaml")]
    config: String,
    #[arg(long, hide = true)]
    apply_update: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "clash_web_service=debug,tower_http=debug".into()),
        )
        .init();

    let args = Args::parse();
    if args.apply_update {
        return updater::install::apply().await;
    }
    let config_path = std::path::Path::new(&args.config);
    let config = AppConfig::load(config_path)?;
    if requires_auth_token(&config) {
        anyhow::bail!("auth.token must be set when binding to a non-loopback host");
    }

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {}", addr);

    let state = AppState::new(config, Some(config_path)).await?;
    state.updater.start_scheduler();

    if state.config.subscription_auto_update_interval > 0 {
        state.scheduler.start(
            state.profiles.clone(),
            state.config.subscription_auto_update_interval,
        );
    }

    let app = api::create_router(state);

    axum::serve(listener, app).await?;
    Ok(())
}
