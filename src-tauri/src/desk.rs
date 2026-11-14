use crate::drawer::{DrawerState, Error, Result, now_ms};
use rusqlite::{Row, params};
use serde::Serialize;
use std::io::{Cursor, Write};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskDocument {
    id: String,
    kind: String,
    title: String,
    markdown: String,
    updated_at: i64,
}

fn read_document(row: &Row<'_>) -> rusqlite::Result<DeskDocument> {
    Ok(DeskDocument {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        markdown: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_desk_documents(state: State<'_, DrawerState>) -> Result<Vec<DeskDocument>> {
    let lib = state.lock();
    let mut stmt = lib.conn.prepare(
        "SELECT id, CASE WHEN kind = 'sheet' THEN 'document' ELSE kind END,
                title, markdown, updated_at FROM desk_documents ORDER BY updated_at DESC, id",
    )?;
    let documents = stmt
        .query_map([], read_document)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(documents)
}

fn document_title(title: &str) -> &str {
    let title = title.trim();
    if title.is_empty() { "未命名" } else { title }
}

#[tauri::command]
pub fn create_desk_document(
    state: State<'_, DrawerState>,
    id: String,
    kind: String,
    title: String,
    markdown: String,
) -> Result<DeskDocument> {
    if !matches!(kind.as_str(), "document" | "slides") {
        return Err(Error("不支援這種 Desk 檔案類型".into()));
    }
    let title = document_title(&title).to_string();
    let updated_at = now_ms();
    state.lock().conn.execute(
        "INSERT INTO desk_documents (id, kind, title, markdown, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, kind, title, markdown, updated_at],
    )?;
    Ok(DeskDocument {
        id,
        kind,
        title,
        markdown,
        updated_at,
    })
}

#[tauri::command]
pub fn update_desk_document(
    state: State<'_, DrawerState>,
    id: String,
    title: String,
    markdown: String,
) -> Result<i64> {
    let updated_at = now_ms();
    let changed = state.lock().conn.execute(
        "UPDATE desk_documents SET title = ?2, markdown = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, title, markdown, updated_at],
    )?;
    if changed == 0 {
        return Err(Error("找不到這份 Desk 檔案".into()));
    }
    Ok(updated_at)
}

#[tauri::command]
pub fn delete_desk_document(state: State<'_, DrawerState>, id: String) -> Result<()> {
    state
        .lock()
        .conn
        .execute("DELETE FROM desk_documents WHERE id = ?1", [id])?;
    Ok(())
}

#[derive(Serialize)]
pub struct ImportedMarkdown {
    title: String,
    markdown: String,
}

#[tauri::command]
pub async fn import_desk_markdown(app: AppHandle) -> Result<Option<ImportedMarkdown>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("匯入 Markdown")
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
    else {
        return Ok(None);
    };
    let markdown = String::from_utf8(std::fs::read(&path)?)
        .map_err(|_| Error("這個檔案不是 UTF-8 編碼的文字".into()))?;
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名");
    Ok(Some(ImportedMarkdown {
        title: title.into(),
        markdown: markdown
            .strip_prefix('\u{feff}')
            .unwrap_or(&markdown)
            .into(),
    }))
}

#[tauri::command]
pub async fn export_desk_markdown(app: AppHandle, title: String, markdown: String) -> Result<()> {
    export_desk_file(&app, &title, "Markdown", "md", markdown.as_bytes())
}

#[tauri::command]
pub async fn export_desk_word(
    app: AppHandle,
    title: String,
    document: String,
    header: String,
    footer: String,
) -> Result<()> {
    let bytes = word_package(&document, &header, &footer)?;
    export_desk_file(&app, &title, "Word", "docx", &bytes)
}

fn word_package(document: &str, header: &str, footer: &str) -> Result<Vec<u8>> {
    let mut package = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    let zip_error = |e: zip::result::ZipError| Error(format!("無法建立 Word 文件：{e}"));
    for (path, xml) in [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
        ),
        ("word/document.xml", document),
        ("word/header.xml", header),
        ("word/footer.xml", footer),
        (
            "word/settings.xml",
            r#"<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:displayBackgroundShape/></w:settings>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer.xml"/><Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>"#,
        ),
    ] {
        package.start_file(path, options).map_err(zip_error)?;
        package.write_all(xml.as_bytes())?;
    }
    Ok(package.finish().map_err(zip_error)?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn word_package_preserves_unicode_document_xml() {
        let xml = "<w:document><w:body>測試</w:body></w:document>";
        let bytes = word_package(xml, "<w:hdr/>", "<w:ftr/>").unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("_rels/.rels").is_ok());
        assert!(archive.by_name("word/_rels/document.xml.rels").is_ok());
        assert!(archive.by_name("word/header.xml").is_ok());
        assert!(archive.by_name("word/footer.xml").is_ok());
        let mut actual = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut actual)
            .unwrap();
        assert_eq!(actual, xml);
    }
}

fn export_desk_file(
    app: &AppHandle,
    title: &str,
    format: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<()> {
    let file_name = title.replace(|c: char| c.is_control() || "<>:\"/\\|?*".contains(c), "_");
    let file_name = format!(
        "{}.{extension}",
        document_title(file_name.trim_matches([' ', '.']))
    );
    let Some(path) = app
        .dialog()
        .file()
        .set_title(format!("匯出 {format}"))
        .set_file_name(&file_name)
        .add_filter(format, &[extension])
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
    else {
        return Ok(());
    };
    std::fs::write(path, bytes)?;
    Ok(())
}
