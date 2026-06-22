import { onUnmounted } from "vue";

export interface ComponentEpoch {
  assertAlive: () => boolean;
  dispose: () => void;
}

export function createComponentEpoch(): ComponentEpoch {
  let alive = true;

  function dispose() {
    alive = false;
  }

  function assertAlive() {
    return alive;
  }

  return {
    assertAlive,
    dispose,
  };
}

export function useComponentEpoch() {
  const epoch = createComponentEpoch();
  onUnmounted(epoch.dispose);
  return epoch;
}
