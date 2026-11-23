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
