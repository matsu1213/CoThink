use crate::{
    ai::{output_schema, review_input, validate, SYSTEM_PROMPT},
    db::{self, Database},
    models::{AiCommentDraft, AppError, ReviewRequest},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::timeout,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.6-terra";
pub const DEFAULT_CLAUDE_MODEL: &str = "sonnet";
const MAX_OUTPUT_BYTES: usize = 1_000_000;

pub struct CliRuntime {
    work_dir: PathBuf,
    schema_path: PathBuf,
}

impl CliRuntime {
    pub fn new(work_dir: PathBuf) -> Result<Self, std::io::Error> {
        std::fs::create_dir_all(&work_dir)?;
        let schema_path = work_dir.join("Cothink-review-schema.json");
        std::fs::write(&schema_path, output_schema().to_string())?;
        Ok(Self {
            work_dir,
            schema_path,
        })
    }
}

fn review_prompt(request: &ReviewRequest) -> String {
    let candidate_instruction = if request.candidate_scan {
        "\n文章の中から今声をかける価値がある箇所を一つだけ選ぶこと。特になければcommentsを空配列にすること。"
    } else {
        ""
    };
    format!(
        "{SYSTEM_PROMPT}\n\nこの依頼ではツールを一切使用せず、ファイルや環境を調べないこと。与えられた文章だけを見ること。\nレビュー方式: {}\n{}{}\ncomments配列を持つJSONオブジェクトだけを返すこと。",
        request.mode, review_input(request), candidate_instruction
    )
}

fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    command
}

fn process_error(output: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(output).to_ascii_lowercase();
    if text.contains("not logged in")
        || text.contains("login required")
        || text.contains("authentication")
        || text.contains("unauthorized")
    {
        AppError::new("cli_not_authenticated")
    } else if text.contains("rate limit")
        || text.contains("usage limit")
        || text.contains("credit")
        || text.contains("quota")
    {
        AppError::new("quota_exceeded")
    } else if text.contains("model") && (text.contains("not found") || text.contains("invalid")) {
        AppError::new("unsupported_model")
    } else {
        AppError::new("cli_failed")
    }
}

async fn run(
    mut command: Command,
    stdin: Option<&str>,
    limit: Duration,
) -> Result<Vec<u8>, AppError> {
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::new("cli_not_installed")
        } else {
            AppError::new("cli_failed")
        }
    })?;
    if let Some(input) = stdin {
        let mut pipe = child
            .stdin
            .take()
            .ok_or_else(|| AppError::new("cli_failed"))?;
        pipe.write_all(input.as_bytes())
            .await
            .map_err(|_| AppError::new("cli_failed"))?;
        drop(pipe);
    }
    let output = timeout(limit, child.wait_with_output())
        .await
        .map_err(|_| AppError::new("timeout"))?
        .map_err(|_| AppError::new("cli_failed"))?;
    if !output.status.success() {
        let mut diagnostic = output.stderr;
        diagnostic.extend_from_slice(&output.stdout);
        return Err(process_error(&diagnostic));
    }
    if output.stdout.len() > MAX_OUTPUT_BYTES {
        return Err(AppError::new("invalid_ai_output"));
    }
    Ok(output.stdout)
}

pub async fn test_provider(provider: &str) -> Result<(), AppError> {
    let mut process = match provider {
        "codex_cli" => {
            let mut command = command("codex");
            command.args(["login", "status"]);
            command
        }
        "claude_cli" => {
            let mut command = command("claude");
            command.args(["auth", "status"]);
            command
        }
        _ => return Err(AppError::new("invalid_provider")),
    };
    process.stdin(Stdio::null());
    run(process, None, Duration::from_secs(15))
        .await
        .map(|_| ())
}

pub async fn list_codex_models() -> Result<Vec<String>, AppError> {
    let mut process = command("codex");
    process.args(["app-server", "--stdio"]);
    let mut child = process.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::new("cli_not_installed")
        } else {
            AppError::new("cli_failed")
        }
    })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::new("cli_failed"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("cli_failed"))?;
    let messages = [
        json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"Cothink","title":"Cothink","version":env!("CARGO_PKG_VERSION")}}}),
        json!({"method":"initialized","params":{}}),
        json!({"method":"model/list","id":1,"params":{"includeHidden":false,"limit":100}}),
    ];
    for message in messages {
        stdin
            .write_all(message.to_string().as_bytes())
            .await
            .map_err(|_| AppError::new("cli_failed"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|_| AppError::new("cli_failed"))?;
    }
    stdin
        .flush()
        .await
        .map_err(|_| AppError::new("cli_failed"))?;

    let response = match timeout(Duration::from_secs(20), async {
        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|_| AppError::new("cli_failed"))?
        {
            let value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if value.get("id").and_then(Value::as_i64) != Some(1) {
                continue;
            }
            if value.get("error").is_some() {
                return Err(AppError::new("cli_failed"));
            }
            let mut models: Vec<String> = value
                .pointer("/result/data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|item| !item.get("hidden").and_then(Value::as_bool).unwrap_or(false))
                .filter_map(|item| item.get("model").and_then(Value::as_str))
                .map(str::to_owned)
                .collect();
            models.sort();
            models.dedup();
            return if models.is_empty() {
                Err(AppError::new("cli_failed"))
            } else {
                Ok(models)
            };
        }
        Err(AppError::new("cli_failed"))
    })
    .await
    {
        Ok(response) => response,
        Err(_) => Err(AppError::new("timeout")),
    };
    let _ = child.kill().await;
    response
}

async fn codex_review(
    runtime: &CliRuntime,
    request: &ReviewRequest,
    model: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let mut process = command("codex");
    process.current_dir(&runtime.work_dir).args([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--model",
        model,
        "--output-schema",
        runtime.schema_path.to_string_lossy().as_ref(),
        "-",
    ]);
    let output = run(
        process,
        Some(&review_prompt(request)),
        Duration::from_secs(120),
    )
    .await?;
    let parsed: Value =
        serde_json::from_slice(&output).map_err(|_| AppError::new("invalid_ai_output"))?;
    validate(parsed.get("comments").cloned().unwrap_or(Value::Null))
}

async fn claude_review(
    runtime: &CliRuntime,
    request: &ReviewRequest,
    model: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let schema = output_schema().to_string();
    let mut process = command("claude");
    process.current_dir(&runtime.work_dir).args([
        "--safe-mode",
        "-p",
        "--no-session-persistence",
        "--no-chrome",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "",
        "--strict-mcp-config",
        "--disallowedTools",
        "*",
        "--max-turns",
        "1",
        "--model",
        model,
        "--output-format",
        "json",
        "--json-schema",
        &schema,
    ]);
    let output = run(
        process,
        Some(&review_prompt(request)),
        Duration::from_secs(120),
    )
    .await?;
    let envelope: Value =
        serde_json::from_slice(&output).map_err(|_| AppError::new("invalid_ai_output"))?;
    validate(
        envelope
            .get("structured_output")
            .and_then(|value| value.get("comments"))
            .cloned()
            .unwrap_or(Value::Null),
    )
}

pub async fn review(
    db: &Database,
    runtime: &CliRuntime,
    provider: &str,
    request: &ReviewRequest,
    model: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let input = request
        .selected_text
        .as_deref()
        .or(request.full_text.as_deref())
        .unwrap_or("");
    let hash = hex::encode(Sha256::digest(input.as_bytes()));
    let started = Instant::now();
    let result = match provider {
        "codex_cli" => codex_review(runtime, request, model).await,
        "claude_cli" => claude_review(runtime, request, model).await,
        _ => Err(AppError::new("invalid_provider")),
    };
    db::log_run(
        db,
        &request.note_id,
        provider,
        model,
        &request.mode,
        &hash,
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
        started.elapsed().as_millis() as i64,
        result.as_ref().err().map(|error| error.code.as_str()),
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_prompt_contains_only_selected_scope() {
        let request = ReviewRequest {
            note_id: "note".into(),
            selected_text: Some("選択範囲".into()),
            surrounding_text: Some("前後".into()),
            full_text: Some("送信してはいけない全文".into()),
            mode: "logic".into(),
            candidate_scan: false,
        };
        let prompt = review_prompt(&request);
        assert!(prompt.contains("選択範囲"));
        assert!(!prompt.contains("送信してはいけない全文"));
    }

    #[test]
    fn schema_accepts_the_shared_comment_contract() {
        let comments = serde_json::json!([{
            "type":"logic_gap",
            "observation":"根拠が不足しています。",
            "whyItMatters":"結論を再現できません。"
        }]);
        assert!(validate(comments).is_ok());
    }

    #[test]
    fn candidate_scan_requires_an_exact_target_quote() {
        let request = ReviewRequest {
            note_id: "note".into(),
            selected_text: Some("候補を探す文章".into()),
            surrounding_text: None,
            full_text: None,
            mode: "logic".into(),
            candidate_scan: true,
        };
        let prompt = review_prompt(&request);
        assert!(prompt.contains("targetQuote"));
        assert!(prompt.contains("一字一句そのまま"));
    }
}
