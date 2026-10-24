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
