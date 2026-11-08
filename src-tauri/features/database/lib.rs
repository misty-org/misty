#[cfg(all(any(target_os = "macos", windows, target_os = "linux"), debug_assertions))]
pub mod development_profile;
pub mod environment;
pub mod misty_home;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub mod retired_coding_data;
pub mod store;

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
