//! Outbound-request safety for tools that fetch URLs the model chose.
//!
//! A hostname is resolved first and every address checked, then the request is
//! pinned to the vetted address, so a name that resolves to an internal service
//! (or flips between lookups) cannot reach the local network.

use crate::error::{AppError, AppResult};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use url::{Host, Url};

fn is_blocked_v4(ip: &Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || (a == 198 && (b == 18 || b == 19))
        || a >= 224
}

pub fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_blocked_v4(&mapped);
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (first & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (first & 0xff00) == 0xff00 // multicast
        }
    }
}

fn blocked_name(host: &str) -> bool {
    let lowered = host.to_ascii_lowercase();
    lowered == "localhost"
        || lowered.ends_with(".localhost")
        || lowered == "metadata"
        || lowered == "metadata.google.internal"
        || lowered.ends_with(".internal")
}

/// The vetted target of a URL: the host to pin and the addresses it may use.
pub struct SafeTarget {
    pub url: Url,
    /// Set for hostnames, so the HTTP client can be pinned to `addrs`.
    pub pinned_host: Option<String>,
    pub addrs: Vec<SocketAddr>,
}

/// Validates scheme and destination; errors name the reason without leaking internals.
pub async fn check_outbound_url(raw: &str) -> AppResult<SafeTarget> {
    let url = Url::parse(raw).map_err(|e| AppError::InvalidRequest(format!("Invalid URL: {e}")))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::Security("Only HTTP/HTTPS URLs are allowed".into()));
    }
    let port = url.port_or_known_default().unwrap_or(80);

    match url.host() {
        None => Err(AppError::InvalidRequest("URL has no host".into())),
        Some(Host::Ipv4(ip)) => literal(url.clone(), IpAddr::V4(ip), port),
        Some(Host::Ipv6(ip)) => literal(url.clone(), IpAddr::V6(ip), port),
        Some(Host::Domain(domain)) => {
            if blocked_name(domain) {
                return Err(AppError::Security("Access to localhost/metadata hosts is blocked".into()));
            }
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((domain, port))
                .await
                .map_err(|_| AppError::InvalidRequest(format!("DNS resolution failed for {domain}")))?
                .collect();
            if addrs.is_empty() {
                return Err(AppError::InvalidRequest(format!("DNS resolution failed for {domain}")));
            }
            if let Some(bad) = addrs.iter().find(|a| is_blocked_ip(&a.ip())) {
                return Err(AppError::Security(format!("Host resolves to a blocked address: {}", bad.ip())));
            }
            Ok(SafeTarget { pinned_host: Some(domain.to_string()), url, addrs })
        }
    }
}

fn literal(url: Url, ip: IpAddr, port: u16) -> AppResult<SafeTarget> {
    if is_blocked_ip(&ip) {
        return Err(AppError::Security(format!("Access to private/local address {ip} is blocked")));
    }
    Ok(SafeTarget { url, pinned_host: None, addrs: vec![SocketAddr::new(ip, port)] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocked(ip: &str) -> bool {
        is_blocked_ip(&ip.parse().unwrap())
    }

    #[test]
    fn blocks_private_loopback_link_local_and_reserved_ipv4() {
        for ip in ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"] {
            assert!(blocked(ip), "{ip} should be blocked");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.63.0.1", "1.1.1.1", "192.169.0.1"] {
            assert!(!blocked(ip), "{ip} should be allowed");
        }
    }

    #[test]
    fn blocks_internal_ipv6_including_mapped_ipv4() {
        for ip in ["::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"] {
            assert!(blocked(ip), "{ip} should be blocked");
        }
        assert!(!blocked("2606:4700:4700::1111"));
        assert!(!blocked("::ffff:8.8.8.8"));
    }

    #[tokio::test]
    async fn rejects_bad_schemes_literals_and_internal_names() {
        for url in [
            "file:///etc/passwd",
            "ftp://example.com/x",
            "http://127.0.0.1:11434/api/tags",
            "http://[::1]/",
            "http://169.254.169.254/latest/meta-data",
            "http://localhost:3000",
            "http://app.localhost/",
            "http://metadata.google.internal/",
            "http://db.internal/",
        ] {
            assert!(check_outbound_url(url).await.is_err(), "{url} should be rejected");
        }
    }

    #[tokio::test]
    async fn accepts_a_public_literal_and_pins_nothing() {
        let target = check_outbound_url("https://8.8.8.8/x").await.unwrap();
        assert_eq!(target.addrs[0].port(), 443);
        assert!(target.pinned_host.is_none());
    }
}
