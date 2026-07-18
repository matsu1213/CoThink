use crate::{
    db::{self, Database},
    models::*,
};
use reqwest::StatusCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
pub const DEFAULT_MODEL: &str = "gpt-5.6-terra";
pub const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

fn review_capable_model(model: &str) -> bool {
    (model.starts_with("gpt-") || model.starts_with("o3") || model.starts_with("o4"))
        && ![
            "audio",
            "realtime",
            "transcribe",
            "tts",
            "image",
            "search",
            "embedding",
            "moderation",
        ]
        .iter()
        .any(|excluded| model.contains(excluded))
}
pub(crate) const SYSTEM_PROMPT: &str = r#"あなたは、ユーザーが書いている隣にいる静かな友人。先生や編集者のように説明せず、考えを奪わず、気になった一か所に短く声をかける。
原則:
- 本文を勝手に書き換えない。評価や講評をしない。一般論を言わない。
- 元の文章に根拠を持つコメントを返し、事実・解釈・推測・願望の混同を指摘する。
- 曖昧な言葉や隠れた前提、論理の飛躍を具体的に特定する。
- 返答は会話の一言くらい短くする。説明的である必要はない。
- 質問ばかりにしない。questionは本当に聞きたいときだけ使い、通常はnullにする。
- まれに、原文の具体的な気持ちや迷いに沿って自然に共感してよい。ただし空疎に褒めない。
- コメント候補の探索では最も大切な一件だけ返す。指示された原文の全部または抜粋を必ず読んで判断する。
- ユーザーの意図を断定せず、不確実な指摘はconfidenceで示す。
- 柔らかい言葉遣いを意識する。
- 重要度を考えたうえで、文章の趣旨にあったコメントを返す。重要度が低い場合は、コメントを返さない。
- 文章そのものについての指摘ではなく、文章で書かれている事柄についてのコメントをする。文章の書き方や表現の指摘はしない。
出力:
- observationは吹き出しに出す短い一言。硬い敬語や解説調を避ける。
- whyItMattersには内部的な根拠を簡潔に入れるが、observationで繰り返さない。
- questionも使うなら一息で言える長さにする。
- targetQuoteには判断の根拠にした原文の短い引用を一字一句そのまま入れる。
日本語で、指定されたJSON Schemaだけを返す。"#;

pub(crate) fn review_input(request: &ReviewRequest) -> String {
    let (scope, text) = if let Some(selected) = &request.selected_text {
        ("文章の一部", selected.as_str())
    } else {
        ("文章の全部", request.full_text.as_deref().unwrap_or(""))
    };
    let context = request
        .surrounding_text
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\n最小限の前後文脈:\n<context>\n{value}\n</context>"))
        .unwrap_or_default();
    format!(
        "範囲: {scope}\n文章（全文または抜粋）:\n<text>\n{text}\n</text>{context}\ncandidateScan: {}",
        request.candidate_scan
    )
}

pub(crate) fn output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "comments": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "properties": {
                        "targetQuote": {"type": ["string", "null"]},
                        "type": {"type": "string", "enum": ["ambiguity", "assumption", "logic_gap", "concretization", "counterpoint", "essence", "wording"]},
                        "observation": {"type": "string"},
                        "whyItMatters": {"type": "string"},
                        "question": {"type": ["string", "null"]},
                        "suggestedRewrite": {"type": ["string", "null"]},
                        "confidence": {"anyOf": [{"type": "number", "minimum": 0, "maximum": 1}, {"type": "null"}]}
                    },
                    "required": ["targetQuote", "type", "observation", "whyItMatters", "question", "suggestedRewrite", "confidence"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["comments"],
        "additionalProperties": false
    })
}
fn credential_account(compatible: bool, base_url: Option<&str>) -> Result<String, AppError> {
    if compatible {
        let normalized = normalize_api_base_url(base_url.unwrap_or_default())?;
        let digest = hex::encode(Sha256::digest(normalized.as_bytes()));
        Ok(format!("openai-compatible-api-key-{}", &digest[..16]))
    } else {
        Ok("openai-api-key".into())
    }
}

fn key(compatible: bool, base_url: Option<&str>) -> Result<String, AppError> {
    let account = credential_account(compatible, base_url)?;
    if let Ok(entry) = keyring::Entry::new("app.cothink.desktop", &account) {
        if let Ok(k) = entry.get_password() {
            if !k.trim().is_empty() {
                return Ok(k);
            }
        }
    }
    let environment = if compatible {
        "OPENAI_COMPATIBLE_API_KEY"
    } else {
        "OPENAI_API_KEY"
    };
    std::env::var(environment)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::new("api_key_missing"))
}
pub fn set_key(value: &str, compatible: bool, base_url: Option<&str>) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Ok(());
    }
    let account = credential_account(compatible, base_url)?;
    keyring::Entry::new("app.cothink.desktop", &account)
        .map_err(|_| AppError::new("credential_store"))?
        .set_password(value.trim())
        .map_err(|_| AppError::new("credential_store"))
}
pub fn has_key(compatible: bool, base_url: Option<&str>) -> bool {
    key(compatible, base_url).is_ok()
}

pub fn normalize_api_base_url(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| AppError::new("invalid_api_base_url"))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AppError::new("invalid_api_base_url"));
    }
    Ok(trimmed.to_owned())
}

fn endpoint(base_url: &str, path: &str) -> Result<String, AppError> {
    Ok(format!(
        "{}/{}",
        normalize_api_base_url(base_url)?,
        path.trim_start_matches('/')
    ))
}
fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| AppError::new("network"))
}
fn normalize(status: StatusCode, body: &str) -> AppError {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return AppError::new("invalid_api_key");
    }
    if status == StatusCode::TOO_MANY_REQUESTS || body.contains("insufficient_quota") {
        return AppError::new("quota_exceeded");
    }
    if status == StatusCode::NOT_FOUND || body.contains("model_not_found") {
        return AppError::new("unsupported_model");
    }
    AppError::new("network")
}

async fn compatible_models(base_url: &str) -> Result<Vec<String>, AppError> {
    let res = client()?
        .get(endpoint(base_url, "models")?)
        .bearer_auth(key(true, Some(base_url))?)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                AppError::new("timeout")
            } else {
                AppError::new("network")
            }
        })?;
    let status = res.status();
    let raw = res.text().await.map_err(|_| AppError::new("network"))?;
    if !status.is_success() {
        return Err(if status == StatusCode::NOT_FOUND {
            AppError::new("unsupported_endpoint")
        } else {
            normalize(status, &raw)
        });
    }
    let response: Value =
        serde_json::from_str(&raw).map_err(|_| AppError::new("invalid_ai_output"))?;
    let mut models: Vec<String> = response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn test_compatible(base_url: &str, model: &str) -> Result<(), AppError> {
    let models = compatible_models(base_url).await?;
    if models.is_empty() || models.iter().any(|available| available == model) {
        Ok(())
    } else {
        Err(AppError::new("unsupported_model"))
    }
}

pub async fn list_compatible_models(base_url: &str) -> Result<Vec<String>, AppError> {
    compatible_models(base_url).await
}
pub async fn test(model: &str) -> Result<(), AppError> {
    let res = client()?
        .get(format!("{OPENAI_BASE_URL}/models/{model}"))
        .bearer_auth(key(false, None)?)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AppError::new("timeout")
            } else {
                AppError::new("network")
            }
        })?;
    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        Err(normalize(status, &body))
    }
}
pub async fn list_models() -> Result<Vec<String>, AppError> {
    let res = client()?
        .get(format!("{OPENAI_BASE_URL}/models"))
        .bearer_auth(key(false, None)?)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                AppError::new("timeout")
            } else {
                AppError::new("network")
            }
        })?;
    let status = res.status();
    let raw = res.text().await.map_err(|_| AppError::new("network"))?;
    if !status.is_success() {
        return Err(normalize(status, &raw));
    }
    let response: Value =
        serde_json::from_str(&raw).map_err(|_| AppError::new("invalid_ai_output"))?;
    let mut models: Vec<String> = response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .filter(|model| review_capable_model(model))
        .map(str::to_owned)
        .collect();
    models.sort_by(|left, right| {
        let priority = |model: &str| {
            if model == DEFAULT_MODEL {
                0
            } else if model.starts_with("gpt-5.6") {
                1
            } else {
                2
            }
        };
        priority(left)
            .cmp(&priority(right))
            .then_with(|| left.cmp(right))
    });
    models.dedup();
    if models.is_empty() {
        models.push(DEFAULT_MODEL.into());
    }
    Ok(models)
}
pub(crate) fn validate(v: Value) -> Result<Vec<AiCommentDraft>, AppError> {
    let drafts: Vec<AiCommentDraft> =
        serde_json::from_value(v).map_err(|_| AppError::new("invalid_ai_output"))?;
    if drafts.len() > 5
        || drafts.iter().any(|d| {
            d.observation.trim().is_empty()
                || d.why_it_matters.trim().is_empty()
                || !matches!(
                    d.kind.as_str(),
                    "ambiguity"
                        | "assumption"
                        | "logic_gap"
                        | "concretization"
                        | "counterpoint"
                        | "essence"
                        | "wording"
                )
                || d.confidence.is_some_and(|c| !(0.0..=1.0).contains(&c))
        })
    {
        return Err(AppError::new("invalid_ai_output"));
    }
    Ok(drafts)
}

fn parse_compatible_json(text: &str) -> Result<Value, AppError> {
    let trimmed = text.trim();
    let json_text = if trimmed.starts_with("```") {
        let after_header = trimmed
            .find('\n')
            .map(|index| &trimmed[index + 1..])
            .unwrap_or("");
        after_header
            .strip_suffix("```")
            .unwrap_or(after_header)
            .trim()
    } else {
        trimmed
    };
    serde_json::from_str(json_text).map_err(|_| AppError::new("invalid_ai_output"))
}
pub fn mock_review(r: &ReviewRequest) -> Vec<AiCommentDraft> {
    let t = r
        .selected_text
        .as_deref()
        .or(r.full_text.as_deref())
        .unwrap_or("");
    let target_quote = if r.candidate_scan {
        t.lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().chars().take(40).collect())
    } else {
        Some(t.chars().take(80).collect())
    };
    let focus = target_quote.as_deref().unwrap_or(t);
    let focus_length = focus.chars().count();
    let excerpt = format!(
        "{}{}",
        focus.chars().take(28).collect::<String>(),
        if focus_length > 28 { "…" } else { "" }
    );
    let observation = if focus_length % 11 == 1 {
        format!("「{excerpt}」って迷う感じ、わかる。")
    } else {
        format!("「{excerpt}」の基準、もう少し一緒に見たい。")
    };
    vec![AiCommentDraft {
        target_quote,
        kind: match r.mode.as_str() {
            "assumptions" => "assumption",
            "logic" => "logic_gap",
            "counterpoint" => "counterpoint",
            "essence" => "essence",
            "polish" => "wording",
            _ => "ambiguity",
        }
        .into(),
        observation,
        why_it_matters: "異なる基準で解釈すると、読み手が同じ結論に到達できない可能性があります。"
            .into(),
        question: (focus_length % 11 == 0).then(|| "ここで大事にしてる基準って何？".into()),
        suggested_rewrite: None,
        confidence: Some(0.82),
    }]
}
pub async fn openai_review(
    db: &Database,
    r: &ReviewRequest,
    model: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let input_string = review_input(r);
    let hash = hex::encode(Sha256::digest(input_string.as_bytes()));
    let schema = output_schema();
    let candidate_instruction = if r.candidate_scan {
        "\n文章の中から今声をかける価値がある箇所を一つだけ選ぶこと。特になければcommentsを空配列にすること。"
    } else {
        ""
    };
    let body = json!({"model":model,"instructions":SYSTEM_PROMPT,"input":format!("レビュー方式: {}\n{}{}",r.mode,input_string,candidate_instruction),"text":{"format":{"type":"json_schema","name":"cothink_comments","strict":true,"schema":schema}}});
    let started = Instant::now();
    let result = async {
        let res = client()?
            .post(format!("{OPENAI_BASE_URL}/responses"))
            .bearer_auth(key(false, None)?)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AppError::new("timeout")
                } else {
                    AppError::new("network")
                }
            })?;
        let status = res.status();
        let raw = res.text().await.map_err(|_| AppError::new("network"))?;
        if !status.is_success() {
            return Err(normalize(status, &raw));
        }
        let response: Value =
            serde_json::from_str(&raw).map_err(|_| AppError::new("invalid_ai_output"))?;
        let text = response
            .get("output")
            .and_then(Value::as_array)
            .and_then(|a| {
                a.iter()
                    .flat_map(|x| {
                        x.get("content")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                    })
                    .find_map(|c| c.get("text").and_then(Value::as_str))
            })
            .ok_or_else(|| AppError::new("invalid_ai_output"))?;
        let parsed: Value =
            serde_json::from_str(text).map_err(|_| AppError::new("invalid_ai_output"))?;
        validate(parsed.get("comments").cloned().unwrap_or(Value::Null))
    }
    .await;
    db::log_run(
        db,
        &r.note_id,
        "openai",
        model,
        &r.mode,
        &hash,
        if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
        started.elapsed().as_millis() as i64,
        result.as_ref().err().map(|e| e.code.as_str()),
    );
    result
}

pub async fn compatible_review(
    db: &Database,
    r: &ReviewRequest,
    model: &str,
    base_url: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let input_string = review_input(r);
    let hash = hex::encode(Sha256::digest(input_string.as_bytes()));
    let candidate_instruction = if r.candidate_scan {
        "\n文章の中から今声をかける価値がある箇所を一つだけ選ぶこと。特になければcommentsを空配列にすること。"
    } else {
        ""
    };
    let body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": format!("レビュー方式: {}\n{}{}\n出力は必ず {{\"comments\": [...]}} のJSONオブジェクトにする。", r.mode, input_string, candidate_instruction)}
        ]
    });
    let started = Instant::now();
    let result = async {
        let res = client()?
            .post(endpoint(base_url, "chat/completions")?)
            .bearer_auth(key(true, Some(base_url))?)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    AppError::new("timeout")
                } else {
                    AppError::new("network")
                }
            })?;
        let status = res.status();
        let raw = res.text().await.map_err(|_| AppError::new("network"))?;
        if !status.is_success() {
            return Err(if status == StatusCode::NOT_FOUND {
                AppError::new("unsupported_endpoint")
            } else {
                normalize(status, &raw)
            });
        }
        let response: Value =
            serde_json::from_str(&raw).map_err(|_| AppError::new("invalid_ai_output"))?;
        let text = response
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::new("invalid_ai_output"))?;
        let parsed = parse_compatible_json(text)?;
        validate(parsed.get("comments").cloned().unwrap_or(Value::Null))
    }
    .await;
    db::log_run(
        db,
        &r.note_id,
        "openai_compatible",
        model,
        &r.mode,
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
    fn rejects_too_many() {
        let item = json!({"type":"ambiguity","observation":"x","whyItMatters":"y"});
        let v = Value::Array(vec![item; 6]);
        assert_eq!(validate(v).unwrap_err().code, "invalid_ai_output")
    }
    #[test]
    fn mock_is_specific() {
        let r = ReviewRequest {
            note_id: "n".into(),
            selected_text: Some("使いやすい製品".into()),
            surrounding_text: None,
            full_text: None,
            mode: "concretize".into(),
            candidate_scan: false,
        };
        assert!(mock_review(&r)[0].observation.contains("使いやすい"));
    }
    #[test]
    fn validates_compatible_base_urls() {
        assert_eq!(
            normalize_api_base_url(" https://example.com/v1/ ").unwrap(),
            "https://example.com/v1"
        );
        assert!(normalize_api_base_url("http://example.com/v1").is_err());
        assert!(normalize_api_base_url("https://user:secret@example.com/v1").is_err());
        assert!(normalize_api_base_url("https://example.com/v1?key=secret").is_err());
    }
    #[test]
    fn accepts_plain_or_fenced_compatible_json() {
        assert!(parse_compatible_json(r#"{"comments":[]}"#).is_ok());
        assert!(parse_compatible_json("```json\n{\"comments\":[]}\n```").is_ok());
    }
}
