//! Text extraction for uploaded documents: the Rust counterpart of
//! src/backend/services/documentExtractor.ts.
//!
//! DOCX and XLSX are ZIP containers of XML, so they are unpacked directly; PDFs
//! go through a parser. Text-like files are returned as UTF-8 and unknown binary
//! formats are rejected rather than handed to the model as mojibake.

use crate::error::{AppError, AppResult};
use regex::Regex;
use serde::Serialize;
use std::io::{Cursor, Read};
use std::sync::OnceLock;

/// Cap extracted text so one large file cannot blow out the context window.
const MAX_EXTRACTED_CHARS: usize = 200_000;
/// A single ZIP entry is never read beyond this, so a crafted archive cannot exhaust memory.
const MAX_ENTRY_BYTES: u64 = 100 * 1024 * 1024;
/// Same limit the web upload route enforces.
pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Docx,
    Xlsx,
    Pdf,
    Text,
}

#[derive(Debug, Clone, Serialize)]
pub struct Extracted {
    pub name: String,
    pub kind: Kind,
    pub characters: usize,
    pub text: String,
}

pub fn detect_kind(filename: &str, mime: Option<&str>) -> Kind {
    let lower = filename.to_lowercase();
    if lower.ends_with(".docx") {
        return Kind::Docx;
    }
    if lower.ends_with(".xlsx") || lower.ends_with(".xlsm") {
        return Kind::Xlsx;
    }
    if lower.ends_with(".pdf") {
        return Kind::Pdf;
    }
    match mime {
        Some(m) if m.contains("wordprocessingml") => Kind::Docx,
        Some(m) if m.contains("spreadsheetml") => Kind::Xlsx,
        Some("application/pdf") => Kind::Pdf,
        _ => Kind::Text,
    }
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn truncate(text: String) -> String {
    if text.chars().count() <= MAX_EXTRACTED_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_EXTRACTED_CHARS).collect();
    format!("{cut}\n\n[truncated — file exceeds {MAX_EXTRACTED_CHARS} characters]")
}

fn read_entry(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<String> {
    let entry = archive.by_name(name).ok()?;
    let mut bytes = Vec::new();
    entry.take(MAX_ENTRY_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn open_zip<'a>(data: &'a [u8], what: &str) -> AppResult<zip::ZipArchive<Cursor<&'a [u8]>>> {
    zip::ZipArchive::new(Cursor::new(data)).map_err(|_| AppError::InvalidRequest(format!("Not a valid {what}")))
}

/// word/document.xml holds the body. Paragraph and break tags become newlines
/// before the remaining markup is stripped, otherwise paragraphs run together.
pub fn extract_docx(data: &[u8]) -> AppResult<String> {
    static TAB: OnceLock<Regex> = OnceLock::new();
    static BREAK: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    static BLANKS: OnceLock<Regex> = OnceLock::new();

    let mut archive = open_zip(data, ".docx")?;
    let xml = read_entry(&mut archive, "word/document.xml")
        .ok_or_else(|| AppError::InvalidRequest("Not a valid .docx (missing word/document.xml)".into()))?;

    let text = re(&TAB, r"<w:tab\b[^>]*/?>").replace_all(&xml, "\t").replace("</w:p>", "\n");
    let text = re(&BREAK, r"<w:br\b[^>]*/?>").replace_all(&text, "\n");
    let text = re(&TAGS, r"<[^>]+>").replace_all(&text, "");
    let text = re(&BLANKS, r"\n{3,}").replace_all(&text, "\n\n");
    Ok(truncate(decode_entities(&text).trim().to_string()))
}

/// `xl/worksheets/sheet12.xml` → 12.
fn sheet_number(name: &str) -> Option<u32> {
    name.strip_prefix("xl/worksheets/sheet")?.strip_suffix(".xml")?.parse().ok()
}

/// Cell values live in sheetN.xml, but string cells (t="s") store an index into
/// the shared string table, so that table is resolved first. Output is TSV per sheet.
pub fn extract_xlsx(data: &[u8]) -> AppResult<String> {
    static SHARED: OnceLock<Regex> = OnceLock::new();
    static TEXT_RUN: OnceLock<Regex> = OnceLock::new();
    static ROW: OnceLock<Regex> = OnceLock::new();
    static CELL: OnceLock<Regex> = OnceLock::new();
    static VALUE: OnceLock<Regex> = OnceLock::new();

    let mut archive = open_zip(data, ".xlsx")?;
    let text_run = re(&TEXT_RUN, r"(?s)<t\b[^>]*>(.*?)</t>");

    let mut shared: Vec<String> = Vec::new();
    if let Some(xml) = read_entry(&mut archive, "xl/sharedStrings.xml") {
        for item in re(&SHARED, r"(?s)<si\b[^>]*>(.*?)</si>").captures_iter(&xml) {
            let runs: String = text_run.captures_iter(&item[1]).map(|m| m[1].to_string()).collect();
            shared.push(decode_entities(&runs));
        }
    }

    let mut sheets: Vec<(u32, String)> = archive.file_names().filter_map(|name| sheet_number(name).map(|n| (n, name.to_string()))).collect();
    if sheets.is_empty() {
        return Err(AppError::InvalidRequest("Not a valid .xlsx (no worksheets found)".into()));
    }
    // Numeric order, so sheet2 comes before sheet10.
    sheets.sort();

    let row_re = re(&ROW, r"(?s)<row\b[^>]*>(.*?)</row>");
    // Self-closing cells (`<c r="B2"/>`) are empty but still hold their column.
    let cell_re = re(&CELL, r"(?s)<c\b([^>]*?)(?:/>|>(.*?)</c>)");
    let value_re = re(&VALUE, r"(?s)<v>(.*?)</v>");

    let mut sections = Vec::new();
    for (_, sheet) in sheets {
        let Some(xml) = read_entry(&mut archive, &sheet) else { continue };
        let mut rows = Vec::new();
        for row in row_re.captures_iter(&xml) {
            let cells: Vec<String> = cell_re
                .captures_iter(&row[1])
                .map(|cell| {
                    let attributes = &cell[1];
                    let body = cell.get(2).map_or("", |m| m.as_str());
                    match value_re.captures(body) {
                        // Inline strings carry their text directly instead of via <v>.
                        None => decode_entities(&text_run.captures_iter(body).map(|m| m[1].to_string()).collect::<String>()),
                        Some(value) => {
                            let raw = decode_entities(&value[1]);
                            if attributes.contains("t=\"s\"") {
                                raw.trim().parse::<usize>().ok().and_then(|i| shared.get(i).cloned()).unwrap_or_default()
                            } else {
                                raw
                            }
                        }
                    }
                })
                .collect();
            if cells.iter().any(|cell| !cell.is_empty()) {
                rows.push(cells.join("\t"));
            }
        }
        if !rows.is_empty() {
            let label = sheet.trim_start_matches("xl/worksheets/").trim_end_matches(".xml");
            sections.push(format!("[Sheet: {label}]\n{}", rows.join("\n")));
        }
    }
    Ok(truncate(sections.join("\n\n")))
}

fn extract_pdf_blocking(data: Vec<u8>) -> AppResult<String> {
    let text = pdf_extract::extract_text_from_mem(&data).map_err(|e| AppError::InvalidRequest(format!("Could not read the PDF: {e}")))?;
    Ok(truncate(text.trim().to_string()))
}

pub async fn extract_pdf(data: Vec<u8>) -> AppResult<String> {
    // The parser is CPU-bound and can panic on malformed files; a blocking task
    // keeps both off the async runtime and turns a panic into an error.
    tokio::task::spawn_blocking(move || extract_pdf_blocking(data))
        .await
        .map_err(|_| AppError::InvalidRequest("Could not read the PDF".into()))?
}

/// Extracts readable text from an uploaded file.
pub async fn extract_document_text(filename: &str, data: Vec<u8>, mime: Option<&str>) -> AppResult<Extracted> {
    if data.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::InvalidRequest(format!("File too large ({}MB, limit 25MB)", data.len() / 1024 / 1024)));
    }
    let kind = detect_kind(filename, mime);
    let text = match kind {
        Kind::Docx => extract_docx(&data)?,
        Kind::Xlsx => extract_xlsx(&data)?,
        Kind::Pdf => extract_pdf(data).await?,
        Kind::Text => {
            let text = String::from_utf8_lossy(&data).into_owned();
            // A NUL byte in the first KB means this is binary, not text.
            if text.chars().take(1024).any(|c| c == '\0') {
                return Err(AppError::InvalidRequest(format!("Unsupported binary file type: {filename}")));
            }
            truncate(text)
        }
    };
    Ok(Extracted { name: filename.to_string(), kind, characters: text.chars().count(), text })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in files {
            writer.start_file(*name, SimpleFileOptions::default()).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn detects_kinds_by_extension_then_mime() {
        assert_eq!(detect_kind("Report.DOCX", None), Kind::Docx);
        assert_eq!(detect_kind("a.xlsm", None), Kind::Xlsx);
        assert_eq!(detect_kind("a.pdf", None), Kind::Pdf);
        assert_eq!(detect_kind("blob", Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")), Kind::Xlsx);
        assert_eq!(detect_kind("notes.md", None), Kind::Text);
    }

    #[test]
    fn docx_keeps_paragraphs_tabs_and_entities() {
        let xml = r#"<w:document><w:body><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p><w:p><w:r><w:t>A</w:t></w:r><w:tab/><w:r><w:t>B</w:t></w:r></w:p></w:body></w:document>"#;
        let text = extract_docx(&zip_of(&[("word/document.xml", xml)])).unwrap();
        assert_eq!(text, "Tom & Jerry\nA\tB");
    }

    #[test]
    fn docx_without_a_body_is_rejected() {
        let error = extract_docx(&zip_of(&[("other.xml", "x")])).unwrap_err().to_string();
        assert!(error.contains("missing word/document.xml"), "{error}");
        assert!(extract_docx(b"not a zip").unwrap_err().to_string().contains("Not a valid .docx"));
    }

    #[test]
    fn xlsx_resolves_shared_strings_inline_strings_and_empty_cells() {
        let shared = r#"<sst><si><t>Name</t></si><si><t>R</t><t>&amp;D</t></si></sst>"#;
        let sheet = r#"<worksheet><sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
            <row r="2"><c r="A2" t="inlineStr"><is><t>Ann</t></is></c><c r="B2"/><c r="C2"><v>42</v></c></row>
            <row r="3"><c r="A3"/></row>
        </sheetData></worksheet>"#;
        let text = extract_xlsx(&zip_of(&[("xl/sharedStrings.xml", shared), ("xl/worksheets/sheet1.xml", sheet)])).unwrap();
        assert_eq!(text, "[Sheet: sheet1]\nName\tR&D\nAnn\t\t42");
    }

    #[test]
    fn xlsx_sheets_are_ordered_numerically() {
        let cell = |v: &str| format!(r#"<row><c><v>{v}</v></c></row>"#);
        let (s2, s10) = (cell("two"), cell("ten"));
        let text = extract_xlsx(&zip_of(&[("xl/worksheets/sheet10.xml", &s10), ("xl/worksheets/sheet2.xml", &s2)])).unwrap();
        assert!(text.find("two").unwrap() < text.find("ten").unwrap(), "{text}");
        assert!(extract_xlsx(&zip_of(&[("x", "y")])).unwrap_err().to_string().contains("no worksheets"));
    }

    #[tokio::test]
    async fn text_files_pass_through_and_binary_is_rejected() {
        let ok = extract_document_text("a.txt", "héllo".as_bytes().to_vec(), None).await.unwrap();
        assert_eq!((ok.kind, ok.text.as_str(), ok.characters), (Kind::Text, "héllo", 5));

        let error = extract_document_text("a.bin", vec![1, 0, 2], None).await.unwrap_err().to_string();
        assert!(error.contains("Unsupported binary file type"), "{error}");
    }

    #[tokio::test]
    async fn long_text_is_truncated_and_a_broken_pdf_is_an_error_not_a_crash() {
        let long = "x".repeat(MAX_EXTRACTED_CHARS + 10);
        let out = extract_document_text("big.txt", long.into_bytes(), None).await.unwrap();
        assert!(out.text.ends_with("characters]") && out.text.contains("[truncated"));

        let error = extract_document_text("bad.pdf", b"%PDF-1.4 garbage".to_vec(), None).await.unwrap_err().to_string();
        assert!(error.contains("PDF"), "{error}");
    }
}
