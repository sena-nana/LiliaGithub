import { fireEvent, render, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TitleBar from "../src/components/TitleBar.vue";

const tauriWindow = vi.hoisted(() => {
  const appWindow = {
    isMaximized: vi.fn(async () => false),
    onResized: vi.fn(async () => vi.fn()),
    startDragging: vi.fn(async () => undefined),
    minimize: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  return {
    appWindow,
    reset() {
      appWindow.isMaximized.mockResolvedValue(false);
      appWindow.onResized.mockResolvedValue(vi.fn());
    },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => tauriWindow.appWindow,
}));

async function renderTitleBar() {
  const view = render(TitleBar, {
    props: {
      title: "LiliaGithub",
      leftSidebarCollapsed: false,
    },
  });
  await waitFor(() => expect(tauriWindow.appWindow.onResized).toHaveBeenCalled());
  return view;
}

async function pointerDown(target: Element, position = { x: 0, y: 0 }) {
  await fireEvent.pointerDown(target, {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: position.x,
    clientY: position.y,
  });
}

async function pointerMove(target: Element, position: { x: number; y: number }) {
  await fireEvent.pointerMove(target, {
    pointerId: 1,
    pointerType: "mouse",
    clientX: position.x,
    clientY: position.y,
  });
}

async function pointerUp(target: Element) {
  await fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: "mouse",
  });
}

describe("TitleBar dragging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriWindow.reset();
  });

  it("does not start dragging from a title click without movement", async () => {
    const view = await renderTitleBar();

    const title = view.getByText("LiliaGithub");

    await pointerDown(title);
    await pointerUp(title);

    expect(tauriWindow.appWindow.startDragging).not.toHaveBeenCalled();
  });

  it("starts dragging after the title pointer moves past the threshold", async () => {
    const view = await renderTitleBar();
    const title = view.getByText("LiliaGithub");

    await pointerDown(title, { x: 10, y: 10 });
    await pointerMove(title, { x: 15, y: 10 });

    expect(tauriWindow.appWindow.startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not start dragging while the title pointer stays below the movement threshold", async () => {
    const view = await renderTitleBar();
    const title = view.getByText("LiliaGithub");

    await pointerDown(title, { x: 10, y: 10 });
    await pointerMove(title, { x: 12, y: 11 });
    await pointerUp(title);

    expect(tauriWindow.appWindow.startDragging).not.toHaveBeenCalled();
  });

  it("uses the same movement gesture after a blur-focus activation", async () => {
    const view = await renderTitleBar();
    const title = view.getByText("LiliaGithub");

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    await pointerDown(title, { x: 10, y: 10 });
    await pointerMove(title, { x: 18, y: 10 });

    expect(tauriWindow.appWindow.startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not start dragging from titlebar controls", async () => {
    const view = await renderTitleBar();

    await pointerDown(view.getByLabelText("折叠左侧栏"));
    await pointerDown(view.getByLabelText("最小化"));
    await pointerDown(view.getByLabelText("最大化"));
    await pointerDown(view.getByLabelText("关闭"));

    expect(tauriWindow.appWindow.startDragging).not.toHaveBeenCalled();
  });
});
