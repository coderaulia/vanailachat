//! Splitting a byte stream into lines.
//!
//! Network chunks do not respect line boundaries: one chunk can hold several
//! JSON lines, and a line can be split across two chunks (even mid UTF-8
//! character). Decoding each chunk on its own, as the desktop app used to,
//! drops everything after the first line and corrupts split lines.

#[derive(Default)]
pub struct LineSplitter {
    buffer: Vec<u8>,
}

impl LineSplitter {
    /// Feeds bytes and returns every complete, non-empty line.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(end) = self.buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                lines.push(trimmed.to_string());
            }
        }
        lines
    }

    /// The unterminated tail, once the stream has ended.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.buffer);
        let text = String::from_utf8_lossy(&rest);
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_every_line_in_a_chunk() {
        let mut splitter = LineSplitter::default();
        assert_eq!(splitter.push(b"{\"a\":1}\n{\"b\":2}\n"), vec!["{\"a\":1}", "{\"b\":2}"]);
    }

    #[test]
    fn joins_a_line_split_across_chunks() {
        let mut splitter = LineSplitter::default();
        assert!(splitter.push(b"{\"content\":\"hel").is_empty());
        assert_eq!(splitter.push(b"lo\"}\n{\"n\":"), vec!["{\"content\":\"hello\"}"]);
        assert_eq!(splitter.push(b"2}\n"), vec!["{\"n\":2}"]);
    }

    #[test]
    fn keeps_a_multibyte_character_split_between_chunks() {
        let mut splitter = LineSplitter::default();
        let bytes = "héllo\n".as_bytes();
        assert!(splitter.push(&bytes[..2]).is_empty());
        assert_eq!(splitter.push(&bytes[2..]), vec!["héllo"]);
    }

    #[test]
    fn flushes_an_unterminated_tail() {
        let mut splitter = LineSplitter::default();
        assert!(splitter.push(b"{\"done\":true}").is_empty());
        assert_eq!(splitter.finish().as_deref(), Some("{\"done\":true}"));
        assert_eq!(splitter.finish(), None);
    }
}
