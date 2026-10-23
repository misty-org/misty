use super::*;

#[cfg(target_os = "macos")]
#[test]
fn parses_macos_df_rows() {
    let text = "\
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1s1 478724992 150000000 310000000 33% /
/dev/disk4s1 1000000 250000 750000 25% /Volumes/USB Drive
devfs 200 200 0 100% /dev
";
    let devices = parse_df_kp_output(text);
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].name, "Macintosh HD");
    assert_eq!(devices[0].mount_path, "/");
    assert_eq!(devices[1].name, "USB Drive");
    assert_eq!(devices[1].free_bytes, 750000 * 1024);
}

#[cfg(target_os = "linux")]
#[test]
fn parses_linux_df_rows() {
    let text = "\
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/nvme0n1p2 1000 250 750 25% /
/dev/sdb1 2000 500 1500 25% /media/me/USB
tmpfs 100 1 99 1% /run
";
    let devices = parse_df_kp_output(text);
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].mount_path, "/");
    assert_eq!(devices[1].name, "USB");
}
