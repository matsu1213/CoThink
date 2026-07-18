use crate::models::*;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use uuid::Uuid;
pub struct Database(pub Mutex<Connection>);
const MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
impl Database {
    pub fn open(path: &std::path::Path) -> Result<Self, rusqlite::Error> {
        let c = Connection::open(path)?;
        c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
        c.execute_batch(MIGRATION)?;
        Ok(Self(Mutex::new(c)))
    }
    #[cfg(test)]
    pub fn memory() -> Result<Self, rusqlite::Error> {
        let c = Connection::open_in_memory()?;
        c.execute_batch(MIGRATION)?;
        Ok(Self(Mutex::new(c)))
    }
}
fn row_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        body_json: r.get(2)?,
        body_text: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}
fn row_comment(r: &rusqlite::Row) -> rusqlite::Result<Comment> {
    Ok(Comment {
        id: r.get(0)?,
        note_id: r.get(1)?,
        source: r.get(2)?,
        comment_type: r.get(3)?,
        body: r.get(4)?,
        why_it_matters: r.get(5)?,
        question: r.get(6)?,
        suggested_rewrite: r.get(7)?,
        status: r.get(8)?,
        block_id: r.get(9)?,
        anchor_from: r.get(10)?,
        anchor_to: r.get(11)?,
        quote: r.get(12)?,
        prefix: r.get(13)?,
        suffix: r.get(14)?,
        confidence: r.get(15)?,
        orphaned: r.get::<_, i64>(16)? != 0,
        created_at: r.get(17)?,
        updated_at: r.get(18)?,
    })
}
pub fn list(db: &Database) -> Result<Vec<Note>, rusqlite::Error> {
    let c = db.0.lock().unwrap();
    let mut s=c.prepare("SELECT id,title,body_json,body_text,created_at,updated_at FROM notes ORDER BY updated_at DESC")?;
    let result = s.query_map([], row_note)?.collect();
    result
}
pub fn create(db: &Database) -> Result<Note, rusqlite::Error> {
    let t = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let block = Uuid::new_v4();
    let json = format!(
        r#"{{"type":"doc","content":[{{"type":"paragraph","attrs":{{"blockId":"{block}"}}}}]}}"#
    );
    {
        let c = db.0.lock().unwrap();
        c.execute(
            "INSERT INTO notes VALUES(?1,'無題のノート',?2,'',?3,?3)",
            params![id, json, t],
        )?;
    }
    get(db, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}
pub fn get(db: &Database, id: &str) -> Result<Option<Note>, rusqlite::Error> {
    db.0.lock()
        .unwrap()
        .query_row(
            "SELECT id,title,body_json,body_text,created_at,updated_at FROM notes WHERE id=?1",
            [id],
            row_note,
        )
        .optional()
}
pub fn save(db: &Database, n: &SaveNote) -> Result<Note, rusqlite::Error> {
    let mut c = db.0.lock().unwrap();
    let tx = c.transaction()?;
    let latest:Option<(String,String)>=tx.query_row("SELECT body_json,created_at FROM note_revisions WHERE note_id=?1 ORDER BY created_at DESC LIMIT 1",[&n.id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let needs = latest
        .as_ref()
        .map(|(body, time)| {
            body != &n.body_json
                && DateTime::parse_from_rfc3339(time)
                    .map(|x| {
                        Utc::now()
                            .signed_duration_since(x.with_timezone(&Utc))
                            .num_seconds()
                            > 300
                    })
                    .unwrap_or(true)
        })
        .unwrap_or(true);
    let t = Utc::now().to_rfc3339();
    if needs {
        tx.execute(
            "INSERT INTO note_revisions VALUES(?1,?2,?3,?4,?5)",
            params![
                Uuid::new_v4().to_string(),
                n.id,
                n.body_json,
                n.body_text,
                t
            ],
        )?;
    }
    tx.execute(
        "UPDATE notes SET title=?2,body_json=?3,body_text=?4,updated_at=?5 WHERE id=?1",
        params![n.id, n.title, n.body_json, n.body_text, t],
    )?;
    tx.commit()?;
    drop(c);
    get(db, &n.id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}
pub fn delete(db: &Database, id: &str) -> Result<(), rusqlite::Error> {
    db.0.lock()
        .unwrap()
        .execute("DELETE FROM notes WHERE id=?1", [id])?;
    Ok(())
}
pub fn search(db: &Database, q: &str) -> Result<Vec<SearchResult>, rusqlite::Error> {
    let c = db.0.lock().unwrap();
    let sql = if q.chars().count() >= 3 {
        "SELECT n.id,n.title,n.body_json,n.body_text,n.created_at,n.updated_at,snippet(notes_fts,1,'‹','›','…',18) FROM notes_fts JOIN notes n ON n.rowid=notes_fts.rowid WHERE notes_fts MATCH ?1 ORDER BY (CASE WHEN n.title LIKE '%'||?2||'%' THEN 0 ELSE 1 END),bm25(notes_fts,8.0,1.0),n.updated_at DESC LIMIT 50"
    } else {
        "SELECT id,title,body_json,body_text,created_at,updated_at,substr(body_text,max(1,instr(body_text,?1)-24),100) FROM notes WHERE (title LIKE '%'||?1||'%' OR body_text LIKE '%'||?1||'%') AND ?2=?2 ORDER BY CASE WHEN title LIKE '%'||?1||'%' THEN 0 ELSE 1 END,updated_at DESC LIMIT 50"
    };
    let mut s = c.prepare(sql)?;
    let rows = s.query_map(params![q, q], |r| {
        Ok(SearchResult {
            note: row_note(r)?,
            snippet: r.get(6)?,
        })
    })?;
    rows.collect()
}
pub fn comments(db: &Database, note: &str) -> Result<Vec<Comment>, rusqlite::Error> {
    let c = db.0.lock().unwrap();
    let mut s=c.prepare("SELECT id,note_id,source,comment_type,body,why_it_matters,question,suggested_rewrite,status,block_id,anchor_from,anchor_to,quote,prefix,suffix,confidence,orphaned,created_at,updated_at FROM comments WHERE note_id=?1 ORDER BY created_at DESC")?;
    let result = s.query_map([note], row_comment)?.collect();
    result
}
pub fn add_comment(db: &Database, n: &NewComment) -> Result<Comment, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    let t = Utc::now().to_rfc3339();
    db.0.lock().unwrap().execute("INSERT INTO comments(id,note_id,source,comment_type,body,why_it_matters,question,suggested_rewrite,status,block_id,anchor_from,anchor_to,quote,prefix,suffix,confidence,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'open',?9,?10,?11,?12,?13,?14,?15,?16,?16)",params![id,n.note_id,n.source,n.comment_type,n.body,n.why_it_matters,n.question,n.suggested_rewrite,n.block_id,n.anchor_from,n.anchor_to,n.quote,n.prefix,n.suffix,n.confidence,t])?;
    get_comment(db, &id)
}
fn get_comment(db: &Database, id: &str) -> Result<Comment, rusqlite::Error> {
    db.0.lock().unwrap().query_row("SELECT id,note_id,source,comment_type,body,why_it_matters,question,suggested_rewrite,status,block_id,anchor_from,anchor_to,quote,prefix,suffix,confidence,orphaned,created_at,updated_at FROM comments WHERE id=?1",[id],row_comment)
}
pub fn update_comment(db: &Database, id: &str, status: &str) -> Result<Comment, rusqlite::Error> {
    db.0.lock().unwrap().execute(
        "UPDATE comments SET status=?2,updated_at=?3 WHERE id=?1",
        params![id, status, Utc::now().to_rfc3339()],
    )?;
    get_comment(db, id)
}
pub fn setting(db: &Database, key: &str) -> Option<String> {
    db.0.lock()
        .ok()?
        .query_row("SELECT value FROM app_settings WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .ok()
        .flatten()
}
pub fn set_setting(db: &Database, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    db.0.lock().unwrap().execute("INSERT INTO app_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
    Ok(())
}
pub fn log_run(
    db: &Database,
    note: &str,
    provider: &str,
    model: &str,
    mode: &str,
    hash: &str,
    status: &str,
    latency: i64,
    error: Option<&str>,
) {
    let _ = db.0.lock().unwrap().execute(
        "INSERT INTO ai_runs VALUES(?1,?2,?3,?4,?5,'v2',?6,?7,?8,?9,?10)",
        params![
            Uuid::new_v4().to_string(),
            note,
            provider,
            model,
            mode,
            hash,
            status,
            latency,
            error,
            Utc::now().to_rfc3339()
        ],
    );
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crud_and_japanese_search() {
        let db = Database::memory().unwrap();
        let mut n = create(&db).unwrap();
        let s = SaveNote {
            id: n.id.clone(),
            title: "設計メモ".into(),
            body_json: n.body_json,
            body_text: "使いやすい体験を考える".into(),
        };
        n = save(&db, &s).unwrap();
        assert_eq!(n.title, "設計メモ");
        assert_eq!(search(&db, "使いや").unwrap().len(), 1);
        assert_eq!(search(&db, "設計").unwrap().len(), 1);
    }
}
