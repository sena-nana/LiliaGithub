export interface ConcurrencyLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(maxConcurrency = 4): ConcurrencyLimiter {
  const limit = Math.max(1, Math.trunc(maxConcurrency));
  const queue: Array<() => void> = [];
  let active = 0;

  function release() {
    active -= 1;
    queue.shift()?.();
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(release);
        };
        if (active < limit) start();
        else queue.push(start);
      });
    },
  };
}

export const discoveryRequestLimiter = createConcurrencyLimiter(4);
