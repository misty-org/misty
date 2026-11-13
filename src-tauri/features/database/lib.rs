pub mod environment;
pub mod misty_home;
pub mod misty_profiles;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub mod retired_coding_data;
pub mod store;

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
