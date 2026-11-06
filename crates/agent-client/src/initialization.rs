//! Charge startup work, not published human interactions, to the startup budget.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{Notify, oneshot},
    time::Instant,
};

#[derive(Default)]
struct HumanWait {
    count: usize,
    since: Option<Instant>,
    elapsed: Duration,
}

pub(super) struct InitializationBudget {
    started: Instant,
    limit: Duration,
    human: Mutex<HumanWait>,
    changed: Notify,
}

pub(super) struct HumanWaitGuard(Arc<InitializationBudget>);

impl InitializationBudget {
    pub(super) fn new(limit: Duration) -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            limit,
            human: Mutex::new(HumanWait::default()),
            changed: Notify::new(),
        })
    }

    pub(super) fn waiting_for_human(self: &Arc<Self>) -> HumanWaitGuard {
        let mut state = self.human.lock().expect("startup wait poisoned");
        if state.count == 0 {
            state.since = Some(Instant::now());
        }
        state.count += 1;
        drop(state);
        self.changed.notify_one();
        HumanWaitGuard(self.clone())
    }

    pub(super) async fn ready<T>(
        &self,
        mut receiver: oneshot::Receiver<Result<T, String>>,
    ) -> Result<T, String> {
        loop {
            // A published result wins over a concurrently elapsed deadline.
            match receiver.try_recv() {
                Ok(result) => return result,
                Err(oneshot::error::TryRecvError::Closed) => return Err(Self::timeout()),
                Err(oneshot::error::TryRecvError::Empty) => {}
            }
            let changed = self.changed.notified();
            let (waiting, deadline, exhausted) = {
                let state = self.human.lock().expect("startup wait poisoned");
                let deadline = self.started + self.limit + state.elapsed;
                // A new question cannot revive a budget already exhausted
                // before the question was published.
                (
                    state.count > 0,
                    deadline,
                    state.since.unwrap_or_else(Instant::now) >= deadline,
                )
            };
            if exhausted {
                return Err(Self::timeout());
            }
            if waiting {
                tokio::select! {
                    biased;
                    result = &mut receiver => return result.unwrap_or_else(|_| Err(Self::timeout())),
                    _ = changed => {}
                }
            } else {
                tokio::select! {
                    biased;
                    result = &mut receiver => return result.unwrap_or_else(|_| Err(Self::timeout())),
                    _ = changed => {},
                    _ = tokio::time::sleep_until(deadline) => return Err(Self::timeout()),
                }
            }
        }
    }

    fn timeout() -> String {
        "ACP v2 初始化失败或超时".into()
    }
}

impl Drop for HumanWaitGuard {
    fn drop(&mut self) {
        let mut state = self.0.human.lock().expect("startup wait poisoned");
        state.count -= 1;
        if state.count == 0 {
            let since = state.since.take().expect("active human wait");
            state.elapsed += since.elapsed();
        }
        drop(state);
        self.0.changed.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(start_paused = true)]
    async fn a_late_question_cannot_revive_exhausted_startup() {
        let budget = InitializationBudget::new(Duration::from_secs(30));
        let (_sender, receiver) = oneshot::channel::<Result<(), String>>();
        tokio::time::advance(Duration::from_secs(31)).await;
        let _question = budget.waiting_for_human();
        assert!(budget.ready(receiver).await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn a_published_ready_result_wins_a_concurrent_deadline() {
        let budget = InitializationBudget::new(Duration::from_secs(30));
        let (sender, receiver) = oneshot::channel::<Result<(), String>>();
        tokio::time::advance(Duration::from_secs(30)).await;
        sender.send(Ok(())).unwrap();
        assert!(budget.ready(receiver).await.is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn startup_without_human_interaction_keeps_its_original_deadline() {
        let budget = InitializationBudget::new(Duration::from_secs(30));
        let (_sender, receiver) = oneshot::channel::<Result<(), String>>();
        let task = tokio::spawn(async move { budget.ready(receiver).await });
        tokio::time::advance(Duration::from_secs(29)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        tokio::time::advance(Duration::from_secs(2)).await;
        assert!(task.await.unwrap().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn concurrent_questions_pause_once_and_do_not_reset_remaining_budget() {
        let budget = InitializationBudget::new(Duration::from_secs(30));
        let (_sender, receiver) = oneshot::channel::<Result<(), String>>();
        let cloned = budget.clone();
        let task = tokio::spawn(async move { cloned.ready(receiver).await });
        tokio::time::advance(Duration::from_secs(10)).await;
        let first = budget.waiting_for_human();
        tokio::time::advance(Duration::from_secs(10)).await;
        let second = budget.waiting_for_human();
        tokio::time::advance(Duration::from_secs(30)).await;
        drop(first);
        tokio::time::advance(Duration::from_secs(20)).await;
        drop(second);
        tokio::time::advance(Duration::from_secs(19)).await;
        tokio::task::yield_now().await;
        assert!(
            !task.is_finished(),
            "only 29 seconds of startup work elapsed"
        );
        tokio::time::advance(Duration::from_secs(2)).await;
        assert!(
            task.await.unwrap().is_err(),
            "human waits must not renew the work budget"
        );
    }
}
