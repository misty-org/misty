use super::*;
#[tokio::test]
#[ignore = "Downloads current public store packages; run explicitly for compatibility intake"]
async fn store_package_intake() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    for key in [
        "darkreader",
        "bitwarden-password-manager",
        "single-file",
        "clearurls",
        // uBlock Origin Lite, Dark Reader and Bitwarden on the Chrome Web Store.
        "ddkjiahejlhfcafbddmgiahcphecmpfh",
        "eimadpbcbfnmbkopoojfekhnkhdbieeh",
        "nngceckbapebfimnlniiiahkandclblb",
    ] {
        let detail = latest(key).await.unwrap();
        let bytes = bytes(&detail.download_url, 64 * 1024 * 1024).await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let review =
            super::super::package::extract(&bytes, detail, root.path(), "intake".into()).unwrap();
        println!("{} {}: integrity/identity verified; {} required APIs, {} site patterns; blocked={}; runtime compatibility remains unverified",review.entry.name,review.entry.version,review.permissions.len(),review.hosts.len(),review.blocked);
    }
}

/// Which APIs WebView2 does not offer extensions (`native_windows::LIMITED`)
/// each Chrome Web Store extension asks for, from its live package.
#[cfg(windows)]
#[tokio::test]
#[ignore = "Downloads current public store packages; run explicitly for Windows compatibility intake"]
async fn windows_limited_apis_for_chrome_store_extensions() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    for key in [
        "ddkjiahejlhfcafbddmgiahcphecmpfh", // uBlock Origin Lite
        "nngceckbapebfimnlniiiahkandclblb", // Bitwarden
        "aeblfdkhhhdcdjpifhhbdiojplfjncoa", // 1Password
        "eimadpbcbfnmbkopoojfekhnkhdbieeh", // Dark Reader
    ] {
        let outcome = async {
            let detail = latest(key).await?;
            let bytes = bytes(&detail.download_url, 64 * 1024 * 1024).await?;
            let root = tempfile::tempdir().map_err(|e| e.to_string())?;
            super::super::package::extract(&bytes, detail, root.path(), "intake".into())
        }
        .await;
        match outcome {
            Ok(review) => {
                let limited: Vec<_> = review
                    .permissions
                    .iter()
                    .filter(|p| super::super::native_windows::LIMITED.contains(&p.as_str()))
                    .collect();
                println!(
                    "{} {}: permissions {:?}; limited on Windows: {:?}",
                    review.entry.name, review.entry.version, review.permissions, limited
                );
            }
            Err(error) => println!("{key}: could not fetch or verify: {error}"),
        }
    }
}
