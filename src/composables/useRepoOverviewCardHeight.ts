import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

export function useRepoOverviewCardHeight() {
  const containerRef = ref<HTMLElement | null>(null);
  const maxHeight = ref("calc(100dvh - 96px)");
  let frame = 0;
  let observer: ResizeObserver | null = null;

  function update() {
    const grid = containerRef.value;
    if (!grid || typeof window === "undefined") return;
    const bottomPadding = window.innerWidth <= 900 ? 12 : 20;
    const { top } = grid.getBoundingClientRect();
    const rowGap = window.innerWidth <= 900 ? 12 : 0;
    const availableHeight = Math.floor(window.innerHeight - top - bottomPadding - rowGap);
    maxHeight.value = `${Math.max(160, availableHeight)}px`;
  }

  function schedule() {
    if (typeof window === "undefined" || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }

  function disconnectObserver() {
    observer?.disconnect();
    observer = null;
  }

  function connectObserver() {
    disconnectObserver();
    if (typeof ResizeObserver !== "function" || typeof document === "undefined") return;
    observer = new ResizeObserver(() => schedule());
    if (containerRef.value) observer.observe(containerRef.value);
    observer.observe(document.documentElement);
  }

  watch(containerRef, () => {
    void nextTick(() => {
      connectObserver();
      schedule();
    });
  });

  onMounted(() => {
    schedule();
    window.addEventListener("resize", schedule);
    void nextTick(() => {
      connectObserver();
      schedule();
    });
  });

  onUnmounted(() => {
    window.removeEventListener("resize", schedule);
    disconnectObserver();
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  });

  return {
    containerRef,
    maxHeight,
    schedule,
  };
}
