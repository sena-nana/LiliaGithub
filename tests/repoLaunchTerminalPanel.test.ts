import { fireEvent, render, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import RepoLaunchTerminalPanel from "../src/components/repo/RepoLaunchTerminalPanel.vue";
import type { ProjectLaunchLog } from "../src/services/workspace/types";

function launchLogs(firstIndex: number, count: number): ProjectLaunchLog[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = firstIndex + offset;
    return {
      index,
      repoId: "local-repo",
      stream: "stdout",
      line: `line ${index}`,
      timestamp: index,
    };
  });
}

function mockTerminalScroll(element: HTMLElement, initialScrollHeight: number) {
  const clientHeight = 100;
  let scrollHeight = initialScrollHeight;
  let scrollTop = 0;

  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollHeight: { configurable: true, get: () => scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
      },
    },
  });

  return {
    scrollTop: () => scrollTop,
    setScrollHeight: (value: number) => {
      scrollHeight = value;
    },
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}

describe("RepoLaunchTerminalPanel", () => {
  it("首次显示既有日志时默认滚动到底部", async () => {
    const view = render(RepoLaunchTerminalPanel, {
      props: { launchLogs: launchLogs(1, 20) },
    });
    const terminal = view.getByLabelText("启动终端");
    const scroll = mockTerminalScroll(terminal, 500);

    await waitFor(() => expect(scroll.scrollTop()).toBe(400));
  });

  it("日志窗口保持 500 条时继续跟随新输出", async () => {
    const view = render(RepoLaunchTerminalPanel, {
      props: { launchLogs: launchLogs(1, 500) },
    });
    const terminal = view.getByLabelText("启动终端");
    const scroll = mockTerminalScroll(terminal, 1_000);

    await waitFor(() => expect(scroll.scrollTop()).toBe(900));

    scroll.setScrollHeight(1_100);
    await view.rerender({ launchLogs: launchLogs(2, 500) });

    await waitFor(() => expect(scroll.scrollTop()).toBe(1_000));
  });

  it("启动错误更新时继续跟随到底部", async () => {
    const view = render(RepoLaunchTerminalPanel, {
      props: { launchLogs: launchLogs(1, 1), launchError: null },
    });
    const terminal = view.getByLabelText("启动终端");
    const scroll = mockTerminalScroll(terminal, 500);

    await waitFor(() => expect(scroll.scrollTop()).toBe(400));

    scroll.setScrollHeight(600);
    await view.rerender({ launchLogs: launchLogs(1, 1), launchError: "启动失败" });

    await waitFor(() => expect(scroll.scrollTop()).toBe(500));
  });

  it("用户上滚后暂停跟随并在回到底部后恢复", async () => {
    const view = render(RepoLaunchTerminalPanel, {
      props: { launchLogs: launchLogs(1, 1) },
    });
    const terminal = view.getByLabelText("启动终端");
    const scroll = mockTerminalScroll(terminal, 500);

    await waitFor(() => expect(scroll.scrollTop()).toBe(400));

    scroll.setScrollTop(200);
    await fireEvent.scroll(terminal);
    scroll.setScrollHeight(600);
    await view.rerender({ launchLogs: launchLogs(1, 2) });
    expect(scroll.scrollTop()).toBe(200);

    scroll.setScrollTop(497);
    await fireEvent.scroll(terminal);
    scroll.setScrollHeight(700);
    await view.rerender({ launchLogs: launchLogs(1, 3) });

    await waitFor(() => expect(scroll.scrollTop()).toBe(600));
  });
});
