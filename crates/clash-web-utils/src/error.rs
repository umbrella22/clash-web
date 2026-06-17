use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("HTTP request error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Bad request: Config precheck failed: {0}")]
    PrecheckFailed(String),

    #[error("{0}")]
    Internal(String),
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let internal_detail = self.to_string();
        let (status, message) = match &self {
            AppError::Unauthorized => (axum::http::StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::NotFound(_) => (axum::http::StatusCode::NOT_FOUND, self.to_string()),
            AppError::BadRequest(_) | AppError::PrecheckFailed(_) => {
                (axum::http::StatusCode::BAD_REQUEST, self.to_string())
            }
            _ => {
                eprintln!("Internal server error: {}", internal_detail);
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
        };
        let body = match &self {
            AppError::PrecheckFailed(detail) => serde_json::json!({
                "error": message,
                "precheck": {
                    "success": false,
                    "error": detail,
                },
            }),
            _ => serde_json::json!({ "error": message }),
        };
        (status, axum::Json(body)).into_response()
    }
}
