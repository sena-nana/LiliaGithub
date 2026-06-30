type LowPriorityDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type LowPriorityGlobal = typeof globalThis & {
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
  requestIdleCallback?: (
    callback: (deadline: LowPriorityDeadline) => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export type CancelLowPriorityTask = () => void;

const DEFAULT_INPUT_QUIET_MS = 180;
const DEFAULT_IDLE_TIMEOUT_MS = 250;
const INPUT_EVENTS = ["wheel", "scroll", "pointermove", "touchmove", "keydown"] as const;

let listenersInstalled = false;
let lastInputAt = 0;

function now() {
  return Date.now();
}

function markRecentInput() {
  lastInputAt = now();
}

function addInputListener(target: EventTarget | null | undefined, event: string) {
  target?.addEventListener?.(event, markRecentInput, { capture: true, passive: true });
}

function installInputListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  const scope = globalThis as LowPriorityGlobal;
  const doc = typeof document === "undefined" ? null : document;
  for (const event of INPUT_EVENTS) {
    addInputListener(scope, event);
    addInputListener(doc, event);
  }
}

export function hasRecentInput(inputQuietMs = DEFAULT_INPUT_QUIET_MS) {
  installInputListeners();
  const quietFor = now() - lastInputAt;
  return lastInputAt > 0 && quietFor >= 0 && quietFor < inputQuietMs;
}

export function resetLowPrioritySchedulerForTests() {
  lastInputAt = 0;
}

export function scheduleLowPriorityTask(
  callback: () => void,
  options: { timeout?: number; inputQuietMs?: number; idleTimeout?: number } = {},
): CancelLowPriorityTask {
  installInputListeners();
  const scope = globalThis as LowPriorityGlobal;
  const inputQuietMs = options.inputQuietMs ?? DEFAULT_INPUT_QUIET_MS;
  const expiresAt = options.timeout == null ? null : now() + options.timeout;
  let canceled = false;
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
  let idleHandle: number | null = null;

  const clearHandles = () => {
    if (timeoutHandle != null) {
      globalThis.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (idleHandle != null) {
      scope.cancelIdleCallback?.(idleHandle);
      idleHandle = null;
    }
  };

  const run = () => {
    if (canceled) return;
    clearHandles();
    callback();
  };

  const scheduleIdle = () => {
    if (canceled) return;
    clearHandles();
    const remainingTimeout = expiresAt == null ? null : Math.max(0, expiresAt - now());
    if (typeof scope.requestIdleCallback === "function") {
      idleHandle = scope.requestIdleCallback(() => {
        idleHandle = null;
        if (canceled) return;
        const quietFor = now() - lastInputAt;
        if (quietFor < inputQuietMs && (expiresAt == null || now() < expiresAt)) {
          scheduleAfterInput();
          return;
        }
        run();
      }, { timeout: Math.min(options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT_MS, remainingTimeout ?? DEFAULT_IDLE_TIMEOUT_MS) });
      return;
    }

    timeoutHandle = globalThis.setTimeout(run, 0);
  };

  const scheduleAfterInput = () => {
    if (canceled) return;
    clearHandles();
    const waitForQuiet = lastInputAt + inputQuietMs - now();
    const waitForTimeout = expiresAt == null ? Number.POSITIVE_INFINITY : expiresAt - now();
    if (waitForQuiet > 0 && waitForTimeout > 0) {
      timeoutHandle = globalThis.setTimeout(scheduleIdle, Math.min(waitForQuiet, waitForTimeout));
      return;
    }
    scheduleIdle();
  };

  scheduleAfterInput();

  return () => {
    canceled = true;
    clearHandles();
  };
}
