mod api;
mod middleware;
mod state;

use clap::Parser;
use clash_web_core::AppConfig;
use state::AppState;

#[derive(Parser, Debug)]
#[command(name = "clash-web-service", about = "Clash Web Management Service")]
struct Args {
    #[arg(short, long, default_value = "/etc/clash-web/service.yaml")]
    config: String,
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
    let config_path = std::path::Path::new(&args.config);
    let config = AppConfig::load(config_path)?;

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {}", addr);

    let state = AppState::new(config, Some(config_path)).await?;

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
