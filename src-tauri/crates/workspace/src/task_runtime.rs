use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

use tokio::sync::mpsc::{self, Receiver, Sender};
use tokio::sync::Semaphore;

pub const TASK_QUEUE_CAPACITY: usize = 64;

pub type TaskId = String;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionClass {
    Orchestration,
    Io,
    Cpu,
    Blocking,
}

#[derive(Clone, Debug)]
pub struct TaskSpec {
    pub task_id: TaskId,
    pub priority: i64,
    pub execution_class: ExecutionClass,
}

impl TaskSpec {
    pub fn new(task_id: impl Into<TaskId>, priority: i64, execution_class: ExecutionClass) -> Self {
        Self {
            task_id: task_id.into(),
            priority,
            execution_class,
        }
    }

    fn physical_lane(&self) -> PhysicalLane {
        match self.execution_class {
            ExecutionClass::Orchestration => PhysicalLane::Interactive,
            ExecutionClass::Io => PhysicalLane::GithubIo,
            ExecutionClass::Cpu => PhysicalLane::WorkspaceCpu,
            ExecutionClass::Blocking => PhysicalLane::LocalBlocking,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskOutcome {
    Completed { task_id: TaskId },
    Failed { task_id: TaskId, error: String },
    Cancelled { task_id: TaskId, reason: String },
    Panicked { task_id: TaskId, error: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CancelResult {
    AcceptedQueued,
    RequestedRunning,
    AlreadyTerminal,
}

#[derive(Clone, Debug)]
pub struct TaskCancellation {
    requested: Arc<AtomicBool>,
}

impl TaskCancellation {
    pub fn is_cancelled(&self) -> bool {
        self.requested.load(AtomicOrdering::Acquire)
    }
}

pub type TaskJob = Box<dyn FnOnce(TaskCancellation) -> Result<(), String> + Send + 'static>;

struct TaskControl {
    started: AtomicBool,
    requested: Arc<AtomicBool>,
    outcome: Mutex<Option<TaskOutcome>>,
    wake: Condvar,
}

impl TaskControl {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            started: AtomicBool::new(false),
            requested: Arc::new(AtomicBool::new(false)),
            outcome: Mutex::new(None),
            wake: Condvar::new(),
        })
    }

    fn cancel(&self) -> CancelResult {
        let outcome = self
            .outcome
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if outcome.is_some() {
            return CancelResult::AlreadyTerminal;
        }
        drop(outcome);
        self.requested.store(true, AtomicOrdering::Release);
        if self.started.load(AtomicOrdering::Acquire) {
            CancelResult::RequestedRunning
        } else {
            CancelResult::AcceptedQueued
        }
    }

    fn finish(&self, outcome: TaskOutcome) {
        let mut current = self
            .outcome
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if current.is_none() {
            *current = Some(outcome);
            self.wake.notify_all();
        }
    }

    fn wait(&self) -> TaskOutcome {
        let mut outcome = self
            .outcome
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        loop {
            if let Some(value) = outcome.clone() {
                return value;
            }
            outcome = self
                .wake
                .wait(outcome)
                .unwrap_or_else(|error| error.into_inner());
        }
    }
}

#[derive(Clone)]
pub struct TaskHandle {
    task_id: TaskId,
    control: Arc<TaskControl>,
}

impl TaskHandle {
    pub fn task_id(&self) -> &str {
        &self.task_id
    }

    pub fn wait(&self) -> TaskOutcome {
        self.control.wait()
    }
}

struct TaskEnvelope {
    sequence: u64,
    spec: TaskSpec,
    control: Arc<TaskControl>,
    shutdown: Arc<AtomicBool>,
    job: TaskJob,
}

struct LaneSender {
    sender: Sender<TaskEnvelope>,
    queued: Arc<AtomicUsize>,
}

impl LaneSender {
    fn new(sender: Sender<TaskEnvelope>) -> Self {
        Self {
            sender,
            queued: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn try_send(
        &self,
        envelope: TaskEnvelope,
    ) -> Result<(), mpsc::error::TrySendError<TaskEnvelope>> {
        let mut queued = self.queued.load(AtomicOrdering::Acquire);
        loop {
            if queued >= TASK_QUEUE_CAPACITY {
                return Err(mpsc::error::TrySendError::Full(envelope));
            }
            match self.queued.compare_exchange_weak(
                queued,
                queued + 1,
                AtomicOrdering::AcqRel,
                AtomicOrdering::Acquire,
            ) {
                Ok(_) => break,
                Err(current) => queued = current,
            }
        }

        match self.sender.try_send(envelope) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.queued.fetch_sub(1, AtomicOrdering::AcqRel);
                Err(error)
            }
        }
    }
}

impl PartialEq for TaskEnvelope {
    fn eq(&self, other: &Self) -> bool {
        self.sequence == other.sequence
    }
}

impl Eq for TaskEnvelope {}

impl PartialOrd for TaskEnvelope {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TaskEnvelope {
    fn cmp(&self, other: &Self) -> Ordering {
        self.spec
            .priority
            .cmp(&other.spec.priority)
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

#[derive(Clone, Copy)]
enum PhysicalLane {
    Interactive,
    GithubIo,
    WorkspaceCpu,
    LocalBlocking,
}

impl PhysicalLane {
    fn concurrency(self) -> usize {
        match self {
            Self::Interactive => 1,
            Self::GithubIo => 2,
            Self::WorkspaceCpu => 1,
            Self::LocalBlocking => 2,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Interactive => "interactive-orchestration",
            Self::GithubIo => "github-io",
            Self::WorkspaceCpu => "workspace-cpu",
            Self::LocalBlocking => "local-blocking",
        }
    }
}

pub struct WorkspaceTaskRuntime {
    interactive: LaneSender,
    github_io: LaneSender,
    workspace_cpu: LaneSender,
    local_blocking: LaneSender,
    sequence: AtomicU64,
    shutdown: Arc<AtomicBool>,
}

impl WorkspaceTaskRuntime {
    pub fn new() -> Arc<Self> {
        let (interactive_sender, interactive_rx) = mpsc::channel(TASK_QUEUE_CAPACITY);
        let (github_io_sender, github_io_rx) = mpsc::channel(TASK_QUEUE_CAPACITY);
        let (workspace_cpu_sender, workspace_cpu_rx) = mpsc::channel(TASK_QUEUE_CAPACITY);
        let (local_blocking_sender, local_blocking_rx) = mpsc::channel(TASK_QUEUE_CAPACITY);
        let interactive = LaneSender::new(interactive_sender);
        let github_io = LaneSender::new(github_io_sender);
        let workspace_cpu = LaneSender::new(workspace_cpu_sender);
        let local_blocking = LaneSender::new(local_blocking_sender);
        let interactive_queued = Arc::clone(&interactive.queued);
        let github_io_queued = Arc::clone(&github_io.queued);
        let workspace_cpu_queued = Arc::clone(&workspace_cpu.queued);
        let local_blocking_queued = Arc::clone(&local_blocking.queued);
        let shutdown = Arc::new(AtomicBool::new(false));

        thread::Builder::new()
            .name("lilia-workspace-task-runtime".to_string())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("workspace task runtime must start");
                runtime.block_on(async move {
                    tokio::join!(
                        lane_loop(
                            PhysicalLane::Interactive,
                            interactive_rx,
                            interactive_queued
                        ),
                        lane_loop(PhysicalLane::GithubIo, github_io_rx, github_io_queued),
                        lane_loop(
                            PhysicalLane::WorkspaceCpu,
                            workspace_cpu_rx,
                            workspace_cpu_queued,
                        ),
                        lane_loop(
                            PhysicalLane::LocalBlocking,
                            local_blocking_rx,
                            local_blocking_queued,
                        ),
                    );
                });
            })
            .expect("workspace task runtime thread must start");

        Arc::new(Self {
            interactive,
            github_io,
            workspace_cpu,
            local_blocking,
            sequence: AtomicU64::new(0),
            shutdown,
        })
    }

    pub fn submit(&self, spec: TaskSpec, job: TaskJob) -> Result<TaskHandle, String> {
        if self.shutdown.load(AtomicOrdering::Acquire) {
            return Err("任务执行器已关闭".to_string());
        }
        let control = TaskControl::new();
        let handle = TaskHandle {
            task_id: spec.task_id.clone(),
            control: Arc::clone(&control),
        };
        let envelope = TaskEnvelope {
            sequence: self.sequence.fetch_add(1, AtomicOrdering::Relaxed),
            spec: spec.clone(),
            control,
            shutdown: Arc::clone(&self.shutdown),
            job,
        };
        self.sender(spec.physical_lane())
            .try_send(envelope)
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => {
                    format!("任务队列已满：{}", spec.physical_lane().name())
                }
                mpsc::error::TrySendError::Closed(_) => "任务执行器已关闭".to_string(),
            })?;
        Ok(handle)
    }

    pub fn cancel(&self, handle: &TaskHandle) -> CancelResult {
        handle.control.cancel()
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, AtomicOrdering::Release);
    }

    fn sender(&self, lane: PhysicalLane) -> &LaneSender {
        match lane {
            PhysicalLane::Interactive => &self.interactive,
            PhysicalLane::GithubIo => &self.github_io,
            PhysicalLane::WorkspaceCpu => &self.workspace_cpu,
            PhysicalLane::LocalBlocking => &self.local_blocking,
        }
    }
}

async fn lane_loop(
    lane: PhysicalLane,
    mut receiver: Receiver<TaskEnvelope>,
    queued: Arc<AtomicUsize>,
) {
    let semaphore = Arc::new(Semaphore::new(lane.concurrency()));
    let mut pending = BinaryHeap::new();
    let mut closed = false;

    loop {
        if pending.is_empty() && !closed {
            match receiver.recv().await {
                Some(envelope) => pending.push(envelope),
                None => closed = true,
            }
        }

        while !closed && pending.len() < TASK_QUEUE_CAPACITY {
            match receiver.try_recv() {
                Ok(envelope) => pending.push(envelope),
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    closed = true;
                    break;
                }
            }
        }

        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .expect("workspace lane semaphore must remain open");
        let Some(envelope) = pending.pop() else {
            if closed {
                break;
            }
            continue;
        };
        queued.fetch_sub(1, AtomicOrdering::AcqRel);
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            run_task(envelope);
        });
    }
}

fn run_task(envelope: TaskEnvelope) {
    let task_id = envelope.spec.task_id;
    if envelope.shutdown.load(AtomicOrdering::Acquire) {
        envelope.control.finish(TaskOutcome::Cancelled {
            task_id,
            reason: "任务执行器已关闭".to_string(),
        });
        return;
    }
    if envelope.control.requested.load(AtomicOrdering::Acquire) {
        envelope.control.finish(TaskOutcome::Cancelled {
            task_id,
            reason: "任务在开始前已取消".to_string(),
        });
        return;
    }

    envelope
        .control
        .started
        .store(true, AtomicOrdering::Release);
    let cancellation = TaskCancellation {
        requested: Arc::clone(&envelope.control.requested),
    };
    let result = catch_unwind(AssertUnwindSafe(|| (envelope.job)(cancellation)));
    let outcome = match result {
        Ok(Ok(())) => TaskOutcome::Completed { task_id },
        Ok(Err(error)) => TaskOutcome::Failed { task_id, error },
        Err(payload) => TaskOutcome::Panicked {
            task_id,
            error: panic_message(payload),
        },
    };
    envelope.control.finish(outcome);
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "后台任务异常".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn spec(id: &str, priority: i64, class: ExecutionClass) -> TaskSpec {
        TaskSpec::new(id, priority, class)
    }

    #[test]
    fn task_runtime_preserves_priority_order() {
        let runtime = WorkspaceTaskRuntime::new();
        let order = Arc::new(Mutex::new(Vec::new()));
        let gate = Arc::new(AtomicBool::new(false));

        let first_gate = Arc::clone(&gate);
        let first_order = Arc::clone(&order);
        let first = runtime
            .submit(
                spec("first", 0, ExecutionClass::Cpu),
                Box::new(move |_| {
                    while !first_gate.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    first_order.lock().unwrap().push("first");
                    Ok(())
                }),
            )
            .unwrap();

        let second_order = Arc::clone(&order);
        let second = runtime
            .submit(
                spec("second", 100, ExecutionClass::Cpu),
                Box::new(move |_| {
                    second_order.lock().unwrap().push("second");
                    Ok(())
                }),
            )
            .unwrap();

        gate.store(true, AtomicOrdering::Release);
        assert_eq!(
            first.wait(),
            TaskOutcome::Completed {
                task_id: "first".into()
            }
        );
        assert_eq!(
            second.wait(),
            TaskOutcome::Completed {
                task_id: "second".into()
            }
        );
        assert_eq!(*order.lock().unwrap(), vec!["second", "first"]);
    }

    #[test]
    fn task_runtime_preserves_fifo_for_equal_priority() {
        let runtime = WorkspaceTaskRuntime::new();
        let order = Arc::new(Mutex::new(Vec::new()));
        let gate = Arc::new(AtomicBool::new(false));

        let blocker_gate = Arc::clone(&gate);
        let blocker_order = Arc::clone(&order);
        let blocker_started = Arc::new(AtomicBool::new(false));
        let blocker_started_by_job = Arc::clone(&blocker_started);
        let blocker = runtime
            .submit(
                spec("blocker", 100, ExecutionClass::Cpu),
                Box::new(move |_| {
                    blocker_started_by_job.store(true, AtomicOrdering::Release);
                    while !blocker_gate.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    blocker_order.lock().unwrap().push("blocker");
                    Ok(())
                }),
            )
            .unwrap();
        while !blocker_started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }

        let first_order = Arc::clone(&order);
        let first = runtime
            .submit(
                spec("first", 0, ExecutionClass::Cpu),
                Box::new(move |_| {
                    first_order.lock().unwrap().push("first");
                    Ok(())
                }),
            )
            .unwrap();
        let second_order = Arc::clone(&order);
        let second = runtime
            .submit(
                spec("second", 0, ExecutionClass::Cpu),
                Box::new(move |_| {
                    second_order.lock().unwrap().push("second");
                    Ok(())
                }),
            )
            .unwrap();

        gate.store(true, AtomicOrdering::Release);
        assert!(matches!(blocker.wait(), TaskOutcome::Completed { .. }));
        assert!(matches!(first.wait(), TaskOutcome::Completed { .. }));
        assert!(matches!(second.wait(), TaskOutcome::Completed { .. }));
        assert_eq!(*order.lock().unwrap(), vec!["blocker", "first", "second"]);
    }

    #[test]
    fn task_runtime_rejects_tasks_beyond_the_bounded_queue() {
        let runtime = WorkspaceTaskRuntime::new();
        let gate = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let blocker_gate = Arc::clone(&gate);
        let blocker_started = Arc::clone(&started);
        let blocker = runtime
            .submit(
                spec("blocker", 100, ExecutionClass::Cpu),
                Box::new(move |_| {
                    blocker_started.store(true, AtomicOrdering::Release);
                    while !blocker_gate.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    Ok(())
                }),
            )
            .unwrap();
        while !started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }

        let mut queued = Vec::new();
        for index in 0..TASK_QUEUE_CAPACITY {
            queued.push(
                runtime
                    .submit(
                        spec(&format!("queued-{index}"), 0, ExecutionClass::Cpu),
                        Box::new(|_| Ok(())),
                    )
                    .unwrap(),
            );
        }
        let error = match runtime.submit(
            spec("over-capacity", 0, ExecutionClass::Cpu),
            Box::new(|_| Ok(())),
        ) {
            Ok(_) => panic!("the bounded queue must reject the 65th waiting task"),
            Err(error) => error,
        };
        assert!(error.contains("队列已满"));

        gate.store(true, AtomicOrdering::Release);
        assert!(matches!(blocker.wait(), TaskOutcome::Completed { .. }));
        for handle in queued {
            assert!(matches!(handle.wait(), TaskOutcome::Completed { .. }));
        }
    }

    #[test]
    fn task_runtime_isolates_execution_domains_and_caps_io_concurrency() {
        let runtime = WorkspaceTaskRuntime::new();
        let cpu_gate = Arc::new(AtomicBool::new(false));
        let cpu_started = Arc::new(AtomicBool::new(false));
        let cpu_gate_for_job = Arc::clone(&cpu_gate);
        let cpu_started_for_job = Arc::clone(&cpu_started);
        let cpu = runtime
            .submit(
                spec("cpu", 0, ExecutionClass::Cpu),
                Box::new(move |_| {
                    cpu_started_for_job.store(true, AtomicOrdering::Release);
                    while !cpu_gate_for_job.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    Ok(())
                }),
            )
            .unwrap();
        while !cpu_started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }

        let orchestration_started = Arc::new(AtomicBool::new(false));
        let orchestration_started_for_job = Arc::clone(&orchestration_started);
        let orchestration = runtime
            .submit(
                spec("orchestration", 0, ExecutionClass::Orchestration),
                Box::new(move |_| {
                    orchestration_started_for_job.store(true, AtomicOrdering::Release);
                    Ok(())
                }),
            )
            .unwrap();
        while !orchestration_started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }

        let active_io = Arc::new(AtomicUsize::new(0));
        let max_io = Arc::new(AtomicUsize::new(0));
        let io_gate = Arc::new(AtomicBool::new(false));
        let mut io_handles = Vec::new();
        for index in 0..4 {
            let active_io = Arc::clone(&active_io);
            let max_io = Arc::clone(&max_io);
            let io_gate = Arc::clone(&io_gate);
            io_handles.push(
                runtime
                    .submit(
                        spec(&format!("io-{index}"), 0, ExecutionClass::Io),
                        Box::new(move |_| {
                            let active = active_io.fetch_add(1, AtomicOrdering::AcqRel) + 1;
                            max_io.fetch_max(active, AtomicOrdering::AcqRel);
                            while !io_gate.load(AtomicOrdering::Acquire) {
                                thread::yield_now();
                            }
                            active_io.fetch_sub(1, AtomicOrdering::AcqRel);
                            Ok(())
                        }),
                    )
                    .unwrap(),
            );
        }
        while active_io.load(AtomicOrdering::Acquire) != 2 {
            thread::yield_now();
        }
        assert_eq!(max_io.load(AtomicOrdering::Acquire), 2);

        io_gate.store(true, AtomicOrdering::Release);
        cpu_gate.store(true, AtomicOrdering::Release);
        assert!(matches!(cpu.wait(), TaskOutcome::Completed { .. }));
        assert!(matches!(
            orchestration.wait(),
            TaskOutcome::Completed { .. }
        ));
        for handle in io_handles {
            assert!(matches!(handle.wait(), TaskOutcome::Completed { .. }));
        }
    }

    #[test]
    fn queued_task_can_be_cancelled_without_running() {
        let runtime = WorkspaceTaskRuntime::new();
        let started = Arc::new(AtomicBool::new(false));
        let started_by_job = Arc::clone(&started);
        let handle = runtime
            .submit(
                spec("cancelled", 0, ExecutionClass::Cpu),
                Box::new(move |_| {
                    started_by_job.store(true, AtomicOrdering::Release);
                    Ok(())
                }),
            )
            .unwrap();

        assert_eq!(runtime.cancel(&handle), CancelResult::AcceptedQueued);
        assert_eq!(
            handle.wait(),
            TaskOutcome::Cancelled {
                task_id: "cancelled".into(),
                reason: "任务在开始前已取消".into(),
            }
        );
        thread::sleep(Duration::from_millis(10));
        assert!(!started.load(AtomicOrdering::Acquire));
    }

    #[test]
    fn running_task_reports_requested_cancellation_but_keeps_real_result() {
        let runtime = WorkspaceTaskRuntime::new();
        let started = Arc::new(AtomicBool::new(false));
        let started_by_job = Arc::clone(&started);
        let handle = runtime
            .submit(
                spec("running", 0, ExecutionClass::Blocking),
                Box::new(move |_| {
                    started_by_job.store(true, AtomicOrdering::Release);
                    thread::sleep(Duration::from_millis(20));
                    Ok(())
                }),
            )
            .unwrap();

        while !started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }
        assert_eq!(runtime.cancel(&handle), CancelResult::RequestedRunning);
        assert_eq!(
            handle.wait(),
            TaskOutcome::Completed {
                task_id: "running".into()
            }
        );
    }

    #[test]
    fn shutdown_rejects_new_work_and_cancels_queued_work() {
        let runtime = WorkspaceTaskRuntime::new();
        let gate = Arc::new(AtomicBool::new(false));
        let started = Arc::new(AtomicBool::new(false));
        let running_gate = Arc::clone(&gate);
        let running_started = Arc::clone(&started);
        let running = runtime
            .submit(
                spec("running", 100, ExecutionClass::Cpu),
                Box::new(move |_| {
                    running_started.store(true, AtomicOrdering::Release);
                    while !running_gate.load(AtomicOrdering::Acquire) {
                        thread::yield_now();
                    }
                    Ok(())
                }),
            )
            .unwrap();
        while !started.load(AtomicOrdering::Acquire) {
            thread::yield_now();
        }
        let queued = runtime
            .submit(spec("queued", 0, ExecutionClass::Cpu), Box::new(|_| Ok(())))
            .unwrap();

        runtime.shutdown();
        let rejected = match runtime.submit(
            spec("rejected", 0, ExecutionClass::Cpu),
            Box::new(|_| Ok(())),
        ) {
            Ok(_) => panic!("shutdown runtime must reject new tasks"),
            Err(error) => error,
        };
        assert_eq!(rejected, "任务执行器已关闭");
        gate.store(true, AtomicOrdering::Release);
        assert!(matches!(running.wait(), TaskOutcome::Completed { .. }));
        assert_eq!(
            queued.wait(),
            TaskOutcome::Cancelled {
                task_id: "queued".into(),
                reason: "任务执行器已关闭".into(),
            }
        );
    }
}
