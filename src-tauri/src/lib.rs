mod ai;
mod cli_ai;
mod db;
mod models;
use ai::DEFAULT_MODEL;
use db::Database;
use models::*;
#[cfg(debug_assertions)]
use std::time::Instant;
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tokio::sync::Notify;
type DbState = Arc<Database>;
fn err(_: rusqlite::Error) -> AppError {
    AppError::new("sqlite")
}
#[derive(Default)]
struct ReviewCancels(Mutex<HashMap<String, Arc<Notify>>>);
#[tauri::command]
fn list_notes(db: State<DbState>) -> Result<Vec<Note>, AppError> {
    db::list(&db).map_err(err)
}
#[tauri::command]
fn create_note(db: State<DbState>) -> Result<Note, AppError> {
    db::create(&db).map_err(err)
}
#[tauri::command]
fn save_note(db: State<DbState>, note: SaveNote) -> Result<Note, AppError> {
    db::save(&db, &note).map_err(|_| AppError::new("save_failed"))
}
#[tauri::command]
fn delete_note(db: State<DbState>, id: String) -> Result<(), AppError> {
    db::delete(&db, &id).map_err(err)
}
#[tauri::command]
fn search_notes(db: State<DbState>, query: String) -> Result<Vec<SearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    db::search(&db, query.trim()).map_err(err)
}
#[tauri::command]
fn list_comments(db: State<DbState>, note_id: String) -> Result<Vec<Comment>, AppError> {
    db::comments(&db, &note_id).map_err(err)
}
#[tauri::command]
fn create_comment(db: State<DbState>, input: NewComment) -> Result<Comment, AppError> {
    db::add_comment(&db, &input).map_err(err)
}
#[tauri::command]
fn update_comment(db: State<DbState>, id: String, status: String) -> Result<Comment, AppError> {
    if !matches!(status.as_str(), "open" | "ignored" | "resolved") {
        return Err(AppError::new("invalid_status"));
    }
    db::update_comment(&db, &id, &status).map_err(err)
}
fn default_model(provider: &str) -> &'static str {
    match provider {
        "codex_cli" => cli_ai::DEFAULT_CODEX_MODEL,
        "claude_cli" => cli_ai::DEFAULT_CLAUDE_MODEL,
        "mock" => "mock-v1",
        _ => DEFAULT_MODEL,
    }
}
fn resolve_model(provider: &str, model: Option<String>) -> String {
    let candidate = model.unwrap_or_default();
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return default_model(provider).into();
    }
    if matches!(provider, "openai" | "codex_cli") && candidate == "gpt-5.6" {
        return "gpt-5.6-terra".into();
    }
    candidate.into()
}
fn current_settings(db: &Database) -> AiSettings {
    let provider = db::setting(db, "ai_provider").unwrap_or_else(|| "mock".into());
    let model = resolve_model(&provider, db::setting(db, "ai_model"));
    AiSettings {
        enabled: db::setting(db, "ai_enabled").as_deref() != Some("false"),
        provider,
        model,
        has_api_key: ai::has_key(),
        interruption_mode: db::setting(db, "ai_interruption_mode")
            .unwrap_or_else(|| "gentle".into()),
    }
}
#[tauri::command]
fn get_ai_settings(db: State<DbState>) -> AiSettings {
    current_settings(&db)
}
#[tauri::command]
fn save_ai_settings(db: State<DbState>, settings: SaveAiSettings) -> Result<AiSettings, AppError> {
    if !matches!(
        settings.provider.as_str(),
        "mock" | "openai" | "codex_cli" | "claude_cli"
    ) {
        return Err(AppError::new("invalid_provider"));
    }
    if !matches!(
        settings.interruption_mode.as_str(),
        "manual_only" | "gentle" | "proactive"
    ) {
        return Err(AppError::new("invalid_interruption_mode"));
    }
    db::set_setting(
        &db,
        "ai_enabled",
        if settings.enabled { "true" } else { "false" },
    )
    .map_err(err)?;
    db::set_setting(&db, "ai_provider", &settings.provider).map_err(err)?;
    let model = resolve_model(&settings.provider, Some(settings.model));
    db::set_setting(&db, "ai_model", &model).map_err(err)?;
    db::set_setting(&db, "ai_interruption_mode", &settings.interruption_mode).map_err(err)?;
    if let Some(k) = settings.api_key {
        ai::set_key(&k)?
    }
    Ok(current_settings(&db))
}
#[tauri::command]
async fn test_ai_connection(db: State<'_, DbState>) -> Result<(), AppError> {
    let s = current_settings(&db);
    match s.provider.as_str() {
        "mock" => Ok(()),
        "openai" => ai::test(&s.model).await,
        "codex_cli" => {
            cli_ai::test_provider(&s.provider).await?;
            let models = cli_ai::list_codex_models().await?;
            if models.iter().any(|model| model == &s.model) {
                Ok(())
            } else {
                Err(AppError::new("unsupported_model"))
            }
        }
        "claude_cli" => cli_ai::test_provider(&s.provider).await,
        _ => Err(AppError::new("invalid_provider")),
    }
}
#[tauri::command]
async fn list_ai_models(provider: String) -> Result<Vec<String>, AppError> {
    match provider.as_str() {
        "mock" => Ok(vec!["mock-v1".into()]),
        "openai" => ai::list_models().await,
        "codex_cli" => cli_ai::list_codex_models().await,
        "claude_cli" => Ok(vec!["sonnet".into(), "opus".into(), "haiku".into()]),
        _ => Err(AppError::new("invalid_provider")),
    }
}
#[tauri::command]
async fn review_note(
    db: State<'_, DbState>,
    cli: State<'_, cli_ai::CliRuntime>,
    cancels: State<'_, ReviewCancels>,
    request: ReviewRequest,
    request_id: String,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let s = current_settings(&db);
    if !s.enabled {
        return Err(AppError::new("ai_disabled"));
    }
    if request.selected_text.is_none() && request.full_text.is_none() {
        return Err(AppError::new("empty_input"));
    }
    #[cfg(debug_assertions)]
    let debug_started = Instant::now();
    #[cfg(debug_assertions)]
    {
        let input_chars = request
            .selected_text
            .as_deref()
            .or(request.full_text.as_deref())
            .map(|text| text.chars().count())
            .unwrap_or(0);
        let scope = if request.selected_text.is_some() {
            "selection"
        } else {
            "full_note"
        };
        println!(
            "[cothink::ai] event=review.start request_id={} provider={} model={} mode={} scope={} candidate_scan={} input_chars={}",
            request_id, s.provider, s.model, request.mode, scope, request.candidate_scan, input_chars
        );
    }
    let notify = Arc::new(Notify::new());
    cancels
        .0
        .lock()
        .unwrap()
        .insert(request_id.clone(), notify.clone());
    let work = async {
        match s.provider.as_str() {
            "mock" => Ok(ai::mock_review(&request)),
            "openai" => ai::openai_review(&db, &request, &s.model).await,
            "codex_cli" | "claude_cli" => {
                cli_ai::review(&db, &cli, &s.provider, &request, &s.model).await
            }
            _ => Err(AppError::new("invalid_provider")),
        }
    };
    let result = tokio::select! {r=work=>r,_=notify.notified()=>Err(AppError::new("cancelled"))};
    cancels.0.lock().unwrap().remove(&request_id);
    #[cfg(debug_assertions)]
    match &result {
        Ok(comments) => println!(
            "[cothink::ai] event=review.finish request_id={} status=completed comments={} latency_ms={}",
            request_id,
            comments.len(),
            debug_started.elapsed().as_millis()
        ),
        Err(error) => println!(
            "[cothink::ai] event=review.finish request_id={} status=failed error_code={} latency_ms={}",
            request_id,
            error.code,
            debug_started.elapsed().as_millis()
        ),
    }
    result
}
#[tauri::command]
fn cancel_ai_review(cancels: State<'_, ReviewCancels>, request_id: String) {
    if let Some(n) = cancels.0.lock().unwrap().get(&request_id) {
        n.notify_one()
    }
}
#[tauri::command]
fn export_markdown(
    app: tauri::AppHandle,
    note_id: String,
    markdown: String,
) -> Result<String, AppError> {
    if !note_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::new("export_failed"));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::new("export_failed"))?
        .join("exports");
    fs::create_dir_all(&dir).map_err(|_| AppError::new("export_failed"))?;
    let path = dir.join(format!("{note_id}.md"));
    fs::write(&path, markdown).map_err(|_| AppError::new("export_failed"))?;
    Ok(path.to_string_lossy().into_owned())
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let db = Database::open(&dir.join("cothink.sqlite3"))?;
            let cli = cli_ai::CliRuntime::new(dir.join("cli-runtime"))?;
            app.manage(Arc::new(db));
            app.manage(cli);
            app.manage(ReviewCancels::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note,
            search_notes,
            list_comments,
            create_comment,
            update_comment,
            get_ai_settings,
            save_ai_settings,
            test_ai_connection,
            list_ai_models,
            review_note,
            cancel_ai_review,
            export_markdown
        ])
        .run(tauri::generate_context!())
        .expect("failed to run cothink")
}

#[cfg(test)]
mod model_tests {
    use super::*;

    #[test]
    fn resolves_legacy_short_model_to_a_supported_variant() {
        assert_eq!(
            resolve_model("codex_cli", Some("gpt-5.6".into())),
            "gpt-5.6-terra"
        );
        assert_eq!(
            resolve_model("openai", Some(" gpt-5.6 ".into())),
            "gpt-5.6-terra"
        );
    }

    #[test]
    fn uses_provider_specific_defaults() {
        assert_eq!(resolve_model("codex_cli", None), "gpt-5.6-terra");
        assert_eq!(resolve_model("claude_cli", Some("".into())), "sonnet");
    }
}
