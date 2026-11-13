//! The jobs this computer will run for an agent. The list is defined natively, so a compromised page
//! script can't add to it, and it applies before any grant is looked at.
const AGENT_JOBS: &[&str] = include!("../../tauri-permissions/actions/agent_jobs.in");

pub(crate) fn is_agent_job(operation: &str) -> bool {
    AGENT_JOBS.binary_search(&operation).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_sorted_so_lookups_work() {
        let mut sorted = AGENT_JOBS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted, AGENT_JOBS);
    }

    #[test]
    fn only_listed_jobs_count() {
        for job in ["shell.run", "folder.read", "browser.run"] {
            assert!(is_agent_job(job), "{job}");
        }
        // Writing and deleting are never jobs: changes to a shared folder only happen in the shell,
        // under its OS profile.
        for job in [
            "folder.write",
            "folder.delete",
            "folder.move",
            "terminal.execute",
            "code.delegate",
            "",
            "shell.run ",
            "read_content",
        ] {
            assert!(!is_agent_job(job), "{job:?}");
        }
    }
}
