use std::path::PathBuf;

use rusqlite::Connection;

use crate::infra::migrations::run_migrations;

pub fn database_path(custom_path: &str) -> PathBuf {
    if !custom_path.is_empty() {
        return PathBuf::from(custom_path);
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let mut path = PathBuf::from(home);
    path.push(".local");
    path.push("share");
    path.push("ommapin");
    let _ = std::fs::create_dir_all(&path);
    path.push("ommapin.db");
    path
}

pub fn open_db(path: &PathBuf) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    run_migrations(&conn)?;
    Ok(conn)
}
