use std::{
    io,
    sync::{Arc, Mutex},
};

use flate2::{write::GzEncoder, Compression};
use futures_util::future::BoxFuture;
use std::io::Write as _;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use super::*;

async fn code(result: Result<FetchedPage, WebFetchFailed>) -> &'static str {
    result.map_or_else(WebFetchFailed::code, |_| "fetched")
}

fn provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[test]
fn refuses_private_and_special_addresses() {
    for address in [
        "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255",
        "::1", "::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "not-an-address",
    ] {
        assert!(!is_public_address(address), "{address}");
    }
    for address in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:1.1.1.1"] {
        assert!(is_public_address(address), "{address}");
    }
}

#[test]
fn range_edges_and_other_ipv6_forms_land_on_the_right_side() {
    for address in [
        "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "::ffff:a00:1", "::7f00:1", "::1.2.3.4", "fd12:3456::1", "fdff::1", "febf::1", "ffff::1", "2001:db8:ffff::1", "2002::1", "64:ff9b::1:1",
        // Refused here though not by the TypeScript: local NAT64 and the old site-local range.
        "64:ff9b:1::1", "fec0::1", "feff::1",
        "100.127.255.255", "172.31.255.255", "198.19.255.255", "192.0.0.255", "223.255.255.255.1",
    ] {
        assert!(!is_public_address(address), "{address}");
    }
    for address in ["100.128.0.1", "100.63.255.255", "172.32.0.1", "172.15.255.255", "198.20.0.1", "198.17.255.255", "192.0.1.1", "223.255.255.255", "64:ff9b:2::1", "2001:db9::1", "2003::1", "64:ff9c::1", "::1:0:0:1"] {
        assert!(is_public_address(address), "{address}");
    }
    // A zone is valid in Node's check but not here: it isn't a form that reaches a public site.
    assert!(!is_public_address("fe80::1%en0"));
}

#[tokio::test]
async fn never_connects_to_other_schemes_credentials_or_local_hosts() {
    provider();
    for (address, expected) in [
        ("file:///etc/passwd", "invalid_url"),
        ("http://user:pw@example.com/", "invalid_url"),
        ("http://user@example.com/", "invalid_url"),
        ("http://:pw@example.com/", "invalid_url"),
        ("ftp://example.com/", "invalid_url"),
        ("not a url", "invalid_url"),
        ("http://127.0.0.1:8081/health", "private_address"),
        ("http://[::1]:8081/", "private_address"),
        ("http://2130706433/", "private_address"),
        ("http://0x7f.0.0.1/", "private_address"),
        ("http://017700000001/", "private_address"),
        ("http://127.1/", "private_address"),
        ("http://[::ffff:127.0.0.1]/", "private_address"),
        ("http://[::ffff:7f00:1]/", "private_address"),
        ("http://[fe80::1]/", "private_address"),
        ("http://[fc00::1]/", "private_address"),
        ("http://[64:ff9b::7f00:1]/", "private_address"),
        ("http://[2002:7f00:1::]/", "private_address"),
        ("http://169.254.169.254/latest/meta-data", "private_address"),
        ("http://localhost/", "private_address"),
    ] {
        assert_eq!(code(fetch_public_page(address).await).await, expected, "{address}");
    }
}

fn gzipped(text: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(text).unwrap();
    encoder.finish().unwrap()
}

/// Stands in for a public site.
async fn site() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let heads = Arc::new(Mutex::new(Vec::new()));
    let log = heads.clone();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let log = log.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = socket.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                let head = String::from_utf8_lossy(&buffer).to_string();
                log.lock().unwrap().push(head.clone());
                let path = head.split(' ').nth(1).unwrap_or("/").to_owned();
                let redirect = |location: &str| (format!("HTTP/1.1 302 Found\r\nlocation: {location}\r\n"), Vec::new());
                let (start, body): (String, Vec<u8>) = match path.as_str() {
                    "/page" => ("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\n".to_owned(), b"<title>Hi</title><p>Hello</p>".to_vec()),
                    "/hop" => redirect("/page"),
                    "/loop" => redirect("/loop"),
                    "/inside" => redirect("http://169.254.169.254/latest/meta-data"),
                    "/inside-v6" => redirect("http://[::1]/"),
                    "/inside-mapped" => redirect("http://[::ffff:10.0.0.1]/"),
                    "/inside-number" => redirect("http://2130706433/"),
                    "/inside-name" => redirect("http://inside.test/"),
                    "/other-scheme" => redirect("file:///etc/passwd"),
                    "/credentials" => redirect("http://user:pw@127.0.0.1/"),
                    "/no-location" => ("HTTP/1.1 302 Found\r\n".to_owned(), Vec::new()),
                    "/file" => ("HTTP/1.1 200 OK\r\ncontent-type: application/zip\r\n".to_owned(), b"PK".to_vec()),
                    "/huge" => ("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n".to_owned(), vec![b'a'; 3 * 1024 * 1024]),
                    "/exact" => ("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n".to_owned(), vec![b'a'; 2 * 1024 * 1024]),
                    "/gzip" => ("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-encoding: gzip\r\n".to_owned(), gzipped(b"unpacked")),
                    "/bomb" => ("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-encoding: gzip\r\n".to_owned(), gzipped(&vec![b'a'; 32 * 1024 * 1024])),
                    "/broken-gzip" => ("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-encoding: gzip\r\n".to_owned(), b"not gzip at all".to_vec()),
                    "/untyped" => ("HTTP/1.1 200 OK\r\n".to_owned(), b"no type".to_vec()),
                    "/latin" => ("HTTP/1.1 500 Oops\r\ncontent-type: TEXT/PLAIN; charset=utf-8\r\n".to_owned(), vec![b'a', 0xFF, b'b']),
                    _ => ("HTTP/1.1 404 Not Found\r\n".to_owned(), Vec::new()),
                };
                let head = format!("{start}content-length: {}\r\nconnection: close\r\n\r\n", body.len());
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&body).await;
            });
        }
    });
    (base, heads)
}

/// Only this test's own server counts as public.
fn allow_loopback(address: IpAddr) -> bool {
    address == IpAddr::V4(Ipv4Addr::LOCALHOST) || address == IpAddr::V6(Ipv6Addr::LOCALHOST)
}

/// Answers each lookup with the next list, and repeats the last.
struct Answers(Mutex<Vec<io::Result<Vec<IpAddr>>>>, Mutex<Vec<String>>);

fn answers(lists: Vec<&[&str]>) -> Answers {
    Answers(
        Mutex::new(lists.into_iter().rev().map(|list| Ok(list.iter().map(|text| text.parse().unwrap()).collect())).collect()),
        Mutex::new(Vec::new()),
    )
}

impl HostLookup for Answers {
    fn lookup<'a>(&'a self, host: &'a str) -> BoxFuture<'a, io::Result<Vec<IpAddr>>> {
        self.1.lock().unwrap().push(host.to_owned());
        let mut lists = self.0.lock().unwrap();
        let answer = match lists.len() {
            0 => Err(io::Error::from(io::ErrorKind::NotFound)),
            1 => lists[0].as_ref().map(Clone::clone).map_err(|_| io::Error::from(io::ErrorKind::NotFound)),
            _ => lists.pop().unwrap(),
        };
        Box::pin(async move { answer })
    }
}

async fn fetch(address: String) -> Result<FetchedPage, WebFetchFailed> {
    fetch_checked(&address, &allow_loopback, &SystemLookup).await
}

#[tokio::test]
async fn reads_a_page_and_follows_redirects() {
    provider();
    let (base, heads) = site().await;
    let page = fetch(format!("{base}/page")).await.unwrap();
    assert_eq!((page.status, page.body.as_str(), page.truncated), (200, "<title>Hi</title><p>Hello</p>", false));
    assert_eq!(page.content_type, "text/html");
    let hopped = fetch(format!("{base}/hop")).await.unwrap();
    assert_eq!((hopped.final_url, hopped.status), (format!("{base}/page"), 200));
    assert_eq!(fetch(format!("{base}/gzip")).await.unwrap().body, "unpacked");
    let head = heads.lock().unwrap()[0].to_lowercase();
    assert!(head.contains("mistyfetch/1"));
    assert!(head.contains("accept-encoding: gzip, deflate, br"));
    assert!(!head.contains("cookie"));
}

#[tokio::test]
async fn checks_every_hop_not_just_the_first() {
    provider();
    let (base, _) = site().await;
    // Only the test's own server gets through, by the path of the first hop.
    assert_eq!(code(fetch(format!("{base}/inside")).await).await, "private_address");
    assert_eq!(code(fetch(format!("{base}/inside-mapped")).await).await, "private_address");
    assert_eq!(code(fetch(format!("{base}/loop")).await).await, "too_many_redirects");
}

#[tokio::test]
async fn a_redirect_to_a_private_ipv6_address_is_refused() {
    provider();
    let (base, _) = site().await;
    // Only the test's IPv4 server is allowed, so the redirect to [::1] has to fail the check.
    let only_v4 = |address: IpAddr| address == IpAddr::V4(Ipv4Addr::LOCALHOST);
    assert_eq!(code(fetch_checked(&format!("{base}/inside-v6"), &only_v4, &SystemLookup).await).await, "private_address");
    // The number form is the test's own loopback, so the check lets the first hop through only.
    let seen = Mutex::new(0);
    let allowed_once = |address: IpAddr| {
        let mut seen = seen.lock().unwrap();
        *seen += 1;
        *seen == 1 && address == IpAddr::V4(Ipv4Addr::LOCALHOST)
    };
    assert_eq!(code(fetch_checked(&format!("{base}/inside-number"), &allowed_once, &SystemLookup).await).await, "private_address");
    assert_eq!(*seen.lock().unwrap(), 2);
}

#[tokio::test]
async fn a_redirect_to_a_name_with_a_private_answer_is_refused() {
    provider();
    let (base, _) = site().await;
    let private = answers(vec![&["10.0.0.1"]]);
    assert_eq!(code(fetch_checked(&format!("{base}/inside-name"), &allow_loopback_or_public, &private).await).await, "private_address");
    assert_eq!(private.1.lock().unwrap().as_slice(), ["inside.test"]);
}

fn allow_loopback_or_public(address: IpAddr) -> bool {
    allow_loopback(address) || is_public_ip(address)
}

#[tokio::test]
async fn a_redirect_can_only_go_somewhere_a_first_address_could() {
    provider();
    let (base, _) = site().await;
    assert_eq!(code(fetch(format!("{base}/other-scheme")).await).await, "invalid_url");
    assert_eq!(code(fetch(format!("{base}/credentials")).await).await, "invalid_url");
    assert_eq!(code(fetch(format!("{base}/no-location")).await).await, "fetch_failed");
}

#[tokio::test]
async fn refuses_files_and_caps_long_bodies() {
    provider();
    let (base, _) = site().await;
    assert_eq!(code(fetch(format!("{base}/file")).await).await, "unsupported_content");
    let huge = fetch(format!("{base}/huge")).await.unwrap();
    assert!(huge.truncated);
    assert_eq!(huge.body.len(), 2 * 1024 * 1024);
    // Exactly the limit counts as cut short, as it did in Node.
    assert!(fetch(format!("{base}/exact")).await.unwrap().truncated);
    let bomb = fetch(format!("{base}/bomb")).await.unwrap();
    assert!(bomb.truncated);
    assert_eq!(bomb.body.len(), 2 * 1024 * 1024);
    assert_eq!(code(fetch(format!("{base}/broken-gzip")).await).await, "fetch_failed");
}

#[tokio::test]
async fn a_body_with_no_type_is_read_and_bad_bytes_become_replacement_characters() {
    provider();
    let (base, _) = site().await;
    let untyped = fetch(format!("{base}/untyped")).await.unwrap();
    assert_eq!((untyped.content_type.as_str(), untyped.body.as_str()), ("", "no type"));
    let latin = fetch(format!("{base}/latin")).await.unwrap();
    assert_eq!((latin.status, latin.content_type.as_str(), latin.body.as_str()), (500, "text/plain; charset=utf-8", "a\u{FFFD}b"));
}

#[tokio::test]
async fn keeps_a_page_from_the_checks_out_of_the_default_path() {
    provider();
    let (base, _) = site().await;
    assert_eq!(code(fetch_public_page(&format!("{base}/page")).await).await, "private_address");
}

#[tokio::test]
async fn connects_to_the_address_that_passed_the_check_and_never_looks_the_name_up_again() {
    provider();
    let (base, heads) = site().await;
    let port = base.rsplit(':').next().unwrap();
    // A name real DNS doesn't have, so the connection can only have used the pinned answer.
    let pinned = answers(vec![&["127.0.0.1"], &["10.0.0.1"]]);
    let page = fetch_checked(&format!("http://rebinding.test:{port}/page"), &allow_loopback, &pinned).await.unwrap();
    assert_eq!(page.status, 200);
    assert_eq!(pinned.1.lock().unwrap().len(), 1);
    assert!(heads.lock().unwrap().last().unwrap().to_lowercase().contains(&format!("host: rebinding.test:{port}")));
    // The name changed its answer: the next hop's check sees it, and stops there.
    assert_eq!(code(fetch_checked(&format!("http://rebinding.test:{port}/hop"), &allow_loopback, &pinned).await).await, "private_address");
    let again = answers(vec![&["127.0.0.1"], &["10.0.0.1"]]);
    assert_eq!(code(fetch_checked(&format!("http://rebinding.test:{port}/hop"), &allow_loopback, &again).await).await, "private_address");
    assert_eq!(again.1.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn any_private_answer_refuses_the_name_and_ipv4_gets_the_connection() {
    provider();
    let (base, _) = site().await;
    let port = base.rsplit(':').next().unwrap();
    let address = format!("http://mixed.test:{port}/page");
    let public_then_private = answers(vec![&["1.1.1.1", "10.0.0.1"]]);
    assert_eq!(code(fetch_checked(&address, &is_public_ip, &public_then_private).await).await, "private_address");
    let mapped = answers(vec![&["1.1.1.1", "::ffff:127.0.0.1"]]);
    assert_eq!(code(fetch_checked(&address, &is_public_ip, &mapped).await).await, "private_address");
    let nothing = answers(vec![&[]]);
    assert_eq!(code(fetch_checked(&address, &is_public_ip, &nothing).await).await, "private_address");
    // The site listens on IPv4 only, so this reaches it only if IPv4 goes first.
    let both = answers(vec![&["::1", "127.0.0.1"]]);
    assert_eq!(fetch_checked(&address, &allow_loopback, &both).await.unwrap().status, 200);
    let unknown = answers(vec![]);
    assert_eq!(code(fetch_checked(&address, &is_public_ip, &unknown).await).await, "fetch_failed");
}

#[tokio::test]
async fn a_pinned_client_cant_look_a_name_up_at_all() {
    provider();
    let (base, _) = site().await;
    let port = base.rsplit(':').next().unwrap();
    let address: Url = format!("http://localhost:{port}/page").parse().unwrap();
    // The site answers on this name's real address, so only the missing override can stop it.
    let client = Client::builder().no_proxy().dns_resolver(Arc::new(NoLookups)).build().unwrap();
    assert!(client.get(address).send().await.is_err());
}
