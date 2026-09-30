//! A throwaway HTTP server for provider tests: it answers every request with a
//! canned body, written in separate chunks so stream parsing sees realistic
//! network boundaries.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub struct MockResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub chunks: Vec<Vec<u8>>,
}

impl MockResponse {
    pub fn ok(content_type: &'static str, chunks: Vec<&str>) -> Self {
        Self { status: 200, content_type, chunks: chunks.into_iter().map(|c| c.as_bytes().to_vec()).collect() }
    }

    pub fn json(body: &str) -> Self {
        Self::ok("application/json", vec![body])
    }

    pub fn status(status: u16, body: &str) -> Self {
        Self { status, content_type: "application/json", chunks: vec![body.as_bytes().to_vec()] }
    }
}

pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub headers: String,
    pub body: String,
}

pub struct MockServer {
    pub addr: SocketAddr,
    pub requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

impl MockServer {
    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn recorded(&self) -> Vec<(String, String, String)> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .map(|r| (r.method.clone(), r.path.clone(), r.body.clone()))
            .collect()
    }

    pub fn header_of(&self, index: usize, name: &str) -> Option<String> {
        let requests = self.requests.lock().unwrap();
        requests.get(index)?.headers.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim().eq_ignore_ascii_case(name).then(|| value.trim().to_string())
        })
    }

    pub async fn start(handler: impl Fn(&str, &str, &str) -> MockResponse + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let recorded = requests.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { break };
                let handler = handler.clone();
                let recorded = recorded.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut buf = [0u8; 4096];
                    let header_end = loop {
                        let n = socket.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        data.extend_from_slice(&buf[..n]);
                        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                            break pos + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&data[..header_end]).to_string();
                    let content_length = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    while data.len() < header_end + content_length {
                        let n = socket.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&buf[..n]);
                    }
                    let body = String::from_utf8_lossy(&data[header_end..]).to_string();
                    let mut first = head.lines().next().unwrap_or("").split_whitespace();
                    let method = first.next().unwrap_or("").to_string();
                    let path = first.next().unwrap_or("").to_string();

                    let response = handler(&method, &path, &body);
                    recorded.lock().unwrap().push(RecordedRequest { method, path, headers: head, body });

                    let header = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                        response.status, response.content_type
                    );
                    let _ = socket.write_all(header.as_bytes()).await;
                    for chunk in response.chunks {
                        let _ = socket.write_all(format!("{:x}\r\n", chunk.len()).as_bytes()).await;
                        let _ = socket.write_all(&chunk).await;
                        let _ = socket.write_all(b"\r\n").await;
                        let _ = socket.flush().await;
                        tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    }
                    let _ = socket.write_all(b"0\r\n\r\n").await;
                    let _ = socket.shutdown().await;
                });
            }
        });

        Self { addr, requests }
    }
}
