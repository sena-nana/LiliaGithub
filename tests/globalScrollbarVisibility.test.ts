import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installGlobalScrollbarVisibility,
  uninstallGlobalScrollbarVisibility,
} from "@lilia/ui/composables/useGlobalScrollbarVisibility";

function createScroller(input: {
  overflow?: string;
  scrollHeight?: number;
  scrollWidth?: number;
  scrollTop?: number;
} = {}) {
  const scroller = document.createElement("div");
  scroller.style.overflowX = input.overflow ?? "auto";
  scroller.style.overflowY = input.overflow ?? "auto";
  let scrollTop = input.scrollTop ?? 0;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: input.scrollHeight ?? 400 },
    scrollWidth: { configurable: true, value: input.scrollWidth ?? 200 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    },
    scrollLeft: { configurable: true, value: 0 },
  });
  scroller.getBoundingClientRect = () => ({
    top: 10,
    right: 210,
    bottom: 110,
    left: 10,
    width: 200,
    height: 100,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
  document.body.appendChild(scroller);
  return {
    element: scroller,
    scrollTop: () => scrollTop,
  };
}

function verticalOverlay() {
  return document.querySelector(".global-scrollbar-overlay--vertical");
}

function horizontalOverlay() {
  return document.querySelector(".global-scrollbar-overlay--horizontal");
}

function flushOverlayFrame() {
  vi.advanceTimersByTime(16);
}

function discoverScroller(element: HTMLElement) {
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
}

function scrollScroller(element: HTMLElement) {
  element.dispatchEvent(new Event("scroll"));
}

describe("global scrollbar visibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    uninstallGlobalScrollbarVisibility();
  });

  afterEach(() => {
    uninstallGlobalScrollbarVisibility();
    vi.useRealTimers();
  });

  it("renders the visible scrollbar as an overlay and removes it after fade-out", () => {
    installGlobalScrollbarVisibility();
    const { element } = createScroller({ scrollTop: 50 });

    discoverScroller(element);
    scrollScroller(element);
    flushOverlayFrame();

    expect(verticalOverlay()).toBeInTheDocument();

    vi.advanceTimersByTime(960);
    expect(verticalOverlay()).toBeNull();

    element.remove();
  });

  it("shows the overlay when hovering over a scrollable edge", () => {
    installGlobalScrollbarVisibility();
    const { element } = createScroller();

    element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 204,
      clientY: 50,
    }));
    flushOverlayFrame();

    expect(verticalOverlay()).toBeInTheDocument();

    element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 40,
      clientY: 50,
    }));
    flushOverlayFrame();
    vi.advanceTimersByTime(960);

    expect(verticalOverlay()).toBeNull();

    element.remove();
  });

  it("does not render horizontal overlay for clipped non-scroll containers", () => {
    installGlobalScrollbarVisibility();
    const { element } = createScroller({
      overflow: "hidden",
      scrollHeight: 100,
      scrollWidth: 260,
    });

    element.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 50,
      clientY: 104,
    }));
    discoverScroller(element);
    scrollScroller(element);
    flushOverlayFrame();

    expect(horizontalOverlay()).toBeNull();
    expect(verticalOverlay()).toBeNull();

    element.remove();
  });

  it("drags the overlay thumb through a larger hit target", () => {
    installGlobalScrollbarVisibility();
    const { element, scrollTop } = createScroller({ scrollHeight: 500 });
    discoverScroller(element);
    scrollScroller(element);
    flushOverlayFrame();

    const overlay = verticalOverlay();
    expect(overlay).toBeInstanceOf(HTMLElement);

    (overlay as HTMLElement).dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 205,
      clientY: 12,
    }));
    window.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 205,
      clientY: 32,
    }));
    flushOverlayFrame();

    expect(scrollTop()).toBeGreaterThan(0);

    window.dispatchEvent(new MouseEvent("pointerup", {
      bubbles: true,
      clientX: 205,
      clientY: 32,
    }));

    element.remove();
  });

  it("cleans overlays and timers when uninstalled", () => {
    installGlobalScrollbarVisibility();
    const { element } = createScroller();

    discoverScroller(element);
    scrollScroller(element);
    flushOverlayFrame();
    expect(verticalOverlay()).toBeInTheDocument();

    uninstallGlobalScrollbarVisibility();
    expect(verticalOverlay()).toBeNull();

    scrollScroller(element);
    flushOverlayFrame();
    vi.advanceTimersByTime(480);
    expect(verticalOverlay()).toBeNull();

    element.remove();
  });

  it("ignores scroll events from undiscovered elements", () => {
    installGlobalScrollbarVisibility();
    const { element } = createScroller();

    scrollScroller(element);
    flushOverlayFrame();

    expect(verticalOverlay()).toBeNull();

    element.remove();
  });
});
