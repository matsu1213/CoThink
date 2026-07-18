use crate::{
    db::{self, Database},
    models::*,
};
use reqwest::StatusCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
pub const DEFAULT_MODEL: &str = "gpt-5.6-terra";
pub(crate) const SYSTEM_PROMPT: &str = r#"あなたはユーザーの代わりに考えたり、結論を決めたりするアシスタントではない。ユーザー自身の思考を明確にし、深めるための編集者として振る舞う。
原則:
- 本文を勝手に書き換えない。安易に褒めない。一般論だけのコメントを避ける。
- 元の文章に根拠を持つコメントを返し、事実・解釈・推測・願望の混同を指摘する。
- 曖昧な言葉や隠れた前提、論理の飛躍を具体的に特定する。
- 必要に応じて答えではなく問いを返す。重要な指摘を最大5件に絞る。
- ユーザーの意図を断定せず、不確実な指摘はconfidenceで示す。
questionの書き方:
- questionは、隣に座っている思考の相棒がふと口にする短い一言にする。説明や理由は書かず、一息で言えるくらい短く。
- 文体は硬い敬語ではなく、話し言葉に近い口調にする。
- 例:「これってどういうこと？」「これってホントなの？」「逆にこう考えられない？」
- 詳しい理由・根拠はquestionではなくobservationとwhyItMattersに書く。
日本語で、指定されたJSON Schemaだけを返す。"#;

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
fn key() -> Result<String, AppError> {
    if let Ok(entry) = keyring::Entry::new("app.cothink.desktop", "openai-api-key") {
        if let Ok(k) = entry.get_password() {
            if !k.trim().is_empty() {
                return Ok(k);
            }
        }
    }
    std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::new("api_key_missing"))
}
pub fn set_key(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Ok(());
    }
    keyring::Entry::new("app.cothink.desktop", "openai-api-key")
        .map_err(|_| AppError::new("credential_store"))?
        .set_password(value.trim())
        .map_err(|_| AppError::new("credential_store"))
}
pub fn has_key() -> bool {
    key().is_ok()
}
fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| AppError::new("network"))
}
fn normalize(status: StatusCode, body: &str) -> AppError {
    if status == StatusCode::UNAUTHORIZED {
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
pub async fn test(model: &str) -> Result<(), AppError> {
    let res = client()?
        .get(format!("https://api.openai.com/v1/models/{model}"))
        .bearer_auth(key()?)
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
    let observation = format!(
        "「{}{}」で用いる判断基準が文章内では一つに定まっていません。",
        focus.chars().take(28).collect::<String>(),
        if focus.chars().count() > 28 {
            "…"
        } else {
            ""
        }
    );
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
        question: Some("ここで大事にしてる基準って何？".into()),
        suggested_rewrite: None,
        confidence: Some(0.82),
    }]
}
pub async fn openai_review(
    db: &Database,
    r: &ReviewRequest,
    model: &str,
) -> Result<Vec<AiCommentDraft>, AppError> {
    let input = if let Some(s) = &r.selected_text {
        json!({"scope":"selection","selectedText":s,"surroundingText":r.surrounding_text,"candidateScan":r.candidate_scan})
    } else {
        json!({"scope":"full_note","fullText":r.full_text})
    };
    let input_string = input.to_string();
    let hash = hex::encode(Sha256::digest(input_string.as_bytes()));
    let schema = output_schema();
    let candidate_instruction = if r.candidate_scan {
        "\nコメントすべき箇所をあなたが選び、targetQuoteには対象内の短い原文を一字一句そのまま入れること。重要な候補だけを返すこと。"
    } else {
        ""
    };
    let body = json!({"model":model,"instructions":SYSTEM_PROMPT,"input":format!("レビュー方式: {}\n対象(JSON): {}{}",r.mode,input_string,candidate_instruction),"text":{"format":{"type":"json_schema","name":"cothink_comments","strict":true,"schema":schema}}});
    let started = Instant::now();
    let result = async {
        let res = client()?
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(key()?)
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
}
