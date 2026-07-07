import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AboutSection from "../src/pages/settings/AboutSection.vue";

const clientMocks = vi.hoisted(() => ({
  openUrl: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("../src/services/workspace/client", () => ({
  openUrl: clientMocks.openUrl,
}));

const fetchMock = vi.fn<() => Promise<Pick<Response, "ok" | "json">>>();
const originalFetch = globalThis.fetch;

function mockLatestRelease(tagName: string) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => [{ tag_name: tagName, draft: false }],
  });
}

describe("AboutSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    clientMocks.openUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalFetch) {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
  });

  it("发现 GitHub 新版本后打开 Release 下载页", async () => {
    mockLatestRelease("1.0.1");
    render(AboutSection);

    await fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("发现新版本 v1.0.0-beta.2。")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "打开下载页" }));

    expect(clientMocks.openUrl).toHaveBeenCalledWith("https://github.com/sena-nana/LiliaGithub/releases/latest");
  });

  it("GitHub 最新版本不高于当前版本时显示已是最新", async () => {
    mockLatestRelease("1.0.0");
    render(AboutSection);

    await fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("当前已是最新版本。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开下载页" })).toBeNull();
  });

  it("GitHub 检查失败时显示失败状态", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => [],
    });
    render(AboutSection);

    await fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("检查失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开下载页" })).toBeNull();
  });

  it("预发布版本按 SemVer 顺序比较", async () => {
    mockLatestRelease("v1.0.0");
    render(AboutSection);

    await fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "打开下载页" })).toBeInTheDocument();
    });
  });
});
