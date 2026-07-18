use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body_json: String,
    pub body_text: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note: Note,
    pub snippet: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub note_id: String,
    pub source: String,
    pub comment_type: String,
    pub body: String,
    pub why_it_matters: Option<String>,
    pub question: Option<String>,
    pub suggested_rewrite: Option<String>,
    pub status: String,
    pub block_id: Option<String>,
    pub anchor_from: Option<i64>,
    pub anchor_to: Option<i64>,
    pub quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub confidence: Option<f64>,
    pub orphaned: bool,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNote {
    pub id: String,
    pub title: String,
    pub body_json: String,
    pub body_text: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComment {
    pub note_id: String,
    pub source: String,
    pub comment_type: String,
    pub body: String,
    pub why_it_matters: Option<String>,
    pub question: Option<String>,
    pub suggested_rewrite: Option<String>,
    pub block_id: Option<String>,
    pub anchor_from: Option<i64>,
    pub anchor_to: Option<i64>,
    pub quote: Option<String>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
    pub confidence: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub enabled: bool,
    pub provider: String,
    pub model: String,
    pub api_base_url: String,
    pub has_api_key: bool,
    pub interruption_mode: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiSettings {
    pub enabled: bool,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_base_url: String,
    pub api_key: Option<String>,
    #[serde(default = "default_interruption_mode")]
    pub interruption_mode: String,
}
fn default_interruption_mode() -> String {
    "gentle".into()
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    pub note_id: String,
    pub selected_text: Option<String>,
    pub surrounding_text: Option<String>,
    pub full_text: Option<String>,
    pub mode: String,
    #[serde(default)]
    pub candidate_scan: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommentDraft {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_quote: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub observation: String,
    pub why_it_matters: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_rewrite: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
}
impl AppError {
    pub fn new(code: &str) -> Self {
        Self { code: code.into() }
    }
}
