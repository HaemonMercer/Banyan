//! The `attachment:` URI scheme: the reader streams an attachment's file by its id
//! (`http://attachment.localhost/<id>` on Windows, `attachment://localhost/<id>` elsewhere).
//!
//! Only attachments in the open library can be read this way, the same ones `read_attachment`
//! already returns, so no other file on the disk becomes reachable from the page. Range requests
//! are answered piece by piece, so videos play while loading and pdf.js reads only the pages it
//! needs.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::Manager;

use crate::drawer::{attachment_file, DrawerState};

pub const SCHEME: &str = "attachment";
/// Largest piece sent for an open-ended range (`bytes=N-`).
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

/// Registers the scheme. Files are read on their own thread so the window never waits.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        std::thread::spawn(move || {
            let state = app.state::<DrawerState>();
            responder.respond(handle(&state, &request));
        });
    })
}

/// Answers one request for `/<attachment id>`.
pub fn handle(state: &DrawerState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == "OPTIONS" {
        return cors(Response::builder().status(StatusCode::NO_CONTENT)).body(Vec::new()).unwrap();
    }
    let id = request.uri().path().trim_matches('/').parse::<i64>();
    let Ok(id) = id else {
        return error(StatusCode::BAD_REQUEST, "壞掉的附件網址");
    };
    let path = match attachment_file(state, id) {
        Ok(p) => p,
        Err(e) => return error(StatusCode::NOT_FOUND, &e.0),
    };
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    match serve(&path, range) {
        Ok(r) => r,
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, &format!("無法讀取檔案：{e}")),
    }
}

/// The file, or the part of it the `Range` header asks for.
pub fn serve(path: &Path, range: Option<&str>) -> std::io::Result<Response<Vec<u8>>> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let base = cors(Response::builder())
        .header(header::CONTENT_TYPE, content_type(path))
        .header(header::ACCEPT_RANGES, "bytes");
    let Some(range) = range else {
        let mut body = Vec::with_capacity(size as usize);
        file.read_to_end(&mut body)?;
        return Ok(base.status(StatusCode::OK).header(header::CONTENT_LENGTH, body.len()).body(body).unwrap());
    };
    let Some((start, end)) = parse_range(range, size) else {
        return Ok(base
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Vec::new())
            .unwrap());
    };
    let len = end - start + 1;
    let mut body = vec![0; len as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut body)?;
    Ok(base
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
        .header(header::CONTENT_LENGTH, len)
        .body(body)
        .unwrap())
}

/// First and last byte of a single `bytes=` range (`a-b`, `a-`, `-n`) in a file of `size` bytes,
/// or None when it can't be satisfied. An open-ended range is cut to `MAX_CHUNK`.
pub fn parse_range(header: &str, size: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if size == 0 {
        return None;
    }
    let (start, end) = match (a.is_empty(), b.is_empty()) {
        (true, true) => return None,
        // The last n bytes.
        (true, false) => {
            let n: u64 = b.parse().ok()?;
            if n == 0 {
                return None;
            }
            (size.saturating_sub(n), size - 1)
        }
        (false, true) => {
            let start: u64 = a.parse().ok()?;
            (start, (start.saturating_add(MAX_CHUNK) - 1).min(size - 1))
        }
        (false, false) => {
            let start: u64 = a.parse().ok()?;
            let end: u64 = b.parse().ok()?;
            if end < start {
                return None;
            }
            (start, end.min(size - 1))
        }
    };
    (start < size).then_some((start, end))
}

/// The page is served from another origin, and pdf.js reads these headers with `fetch`.
fn cors(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Accept-Ranges, Content-Length, Content-Range")
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    cors(Response::builder())
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap()
}

/// MIME type from the extension, for the kinds the reader shows (the webview sniffs the rest).
fn content_type(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "txt" | "md" | "markdown" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-2000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=10-", 1000), Some((10, 999)));
        assert_eq!(parse_range("bytes=0-", 100 * 1024 * 1024), Some((0, MAX_CHUNK - 1)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-1", 1000), None);
        assert_eq!(parse_range("bytes=-0", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1", 0), None);
    }

    #[test]
    fn serves_whole_files_and_parts() {
        let dir = std::env::temp_dir().join(format!("banyan-protocol-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.mp4");
        std::fs::write(&path, b"0123456789").unwrap();

        let all = serve(&path, None).unwrap();
        assert_eq!(all.status(), StatusCode::OK);
        assert_eq!(all.body(), b"0123456789");
        assert_eq!(all.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(all.headers()[header::ACCEPT_RANGES], "bytes");

        let part = serve(&path, Some("bytes=2-4")).unwrap();
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.body(), b"234");
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-4/10");
        assert_eq!(part.headers()[header::CONTENT_LENGTH], "3");

        let past = serve(&path, Some("bytes=10-")).unwrap();
        assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(past.headers()[header::CONTENT_RANGE], "bytes */10");
        let _ = std::fs::remove_dir_all(dir);
    }
}
