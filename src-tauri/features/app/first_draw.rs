use std::sync::{Mutex, PoisonError};

type Job = Box<dyn FnOnce() + Send>;

enum Stage {
    Waiting(Vec<Job>),
    Drawn,
}

static STAGE: Mutex<Stage> = Mutex::new(Stage::Waiting(Vec::new()));

pub(crate) fn after_first_draw(job: impl FnOnce() + Send + 'static) {
    let mut stage = STAGE.lock().unwrap_or_else(PoisonError::into_inner);
    match &mut *stage {
        Stage::Waiting(jobs) => jobs.push(Box::new(job)),
        Stage::Drawn => {
            drop(stage);
            job();
        }
    }
}

pub(crate) fn drawn() {
    let jobs = {
        let mut stage = STAGE.lock().unwrap_or_else(PoisonError::into_inner);
        match std::mem::replace(&mut *stage, Stage::Drawn) {
            Stage::Waiting(jobs) => jobs,
            Stage::Drawn => return,
        }
    };
    for job in jobs {
        job();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn work_waits_for_the_first_draw_then_runs_at_once() {
        let ran = Arc::new(AtomicUsize::new(0));
        let early = ran.clone();
        after_first_draw(move || {
            early.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(ran.load(Ordering::SeqCst), 0);
        drawn();
        assert_eq!(ran.load(Ordering::SeqCst), 1);
        drawn();
        let late = ran.clone();
        after_first_draw(move || {
            late.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(ran.load(Ordering::SeqCst), 2);
    }
}
