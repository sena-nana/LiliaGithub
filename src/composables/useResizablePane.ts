import { onBeforeUnmount, ref, type Ref } from "vue";
import { clampNumber, usePersistentNumber } from "./usePersistentState";

type ResizeEdge = "left" | "right";

export interface ResizablePaneOptions {
  storageKey: string;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  edge: ResizeEdge;
  disabled?: Ref<boolean>;
}

export function useResizablePane(options: ResizablePaneOptions) {
  const width = usePersistentNumber({
    key: options.storageKey,
    defaultValue: options.defaultWidth,
    min: options.minWidth,
    max: options.maxWidth,
  });
  const isResizing = ref(false);

  let startX = 0;
  let startWidth = 0;
  let captureTarget: Element | null = null;
  let activePointerId: number | null = null;

  function setWidth(nextWidth: number) {
    width.value = clampNumber(nextWidth, options.minWidth, options.maxWidth);
  }

  function resetWidth() {
    width.value = options.defaultWidth;
  }

  function onPointerMove(event: PointerEvent) {
    const delta = options.edge === "left"
      ? startX - event.clientX
      : event.clientX - startX;
    setWidth(startWidth + delta);
  }

  function finishResize(event?: PointerEvent) {
    isResizing.value = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onWindowBlur);
    captureTarget?.removeEventListener("lostpointercapture", onLostPointerCapture);
    if (event && captureTarget?.hasPointerCapture?.(event.pointerId)) {
      captureTarget.releasePointerCapture(event.pointerId);
    }
    captureTarget = null;
    activePointerId = null;
  }

  function onPointerUp(event: PointerEvent) {
    finishResize(event);
  }

  function onPointerCancel(event: PointerEvent) {
    finishResize(event);
  }

  function onWindowBlur() {
    finishResize();
  }

  function onLostPointerCapture(event: Event) {
    if (activePointerId == null || !(event instanceof PointerEvent) || event.pointerId === activePointerId) {
      finishResize();
    }
  }

  function startResize(event: PointerEvent) {
    if (options.disabled?.value || event.button !== 0) return;
    event.preventDefault();
    finishResize();
    isResizing.value = true;
    startX = event.clientX;
    startWidth = width.value;
    captureTarget = event.currentTarget as Element;
    activePointerId = event.pointerId;
    captureTarget.setPointerCapture?.(event.pointerId);
    captureTarget.addEventListener("lostpointercapture", onLostPointerCapture);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);
  }

  onBeforeUnmount(() => {
    finishResize();
  });

  return {
    width,
    isResizing,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth,
    setWidth,
    resetWidth,
    startResize,
  };
}
