import { describe, expect, it, vi } from "vitest";

describe("useTheme", () => {
  it("从 localStorage 恢复主题并写入 html data-theme", async () => {
    localStorage.setItem("lilia-github.theme", "light");
    vi.resetModules();

    const { setLiliaUiConfig } = await import("@lilia/ui/shell");
    const { useTheme } = await import("@lilia/ui/composables/useTheme");
    const { LILIA_UI_CONFIG } = await import("../src/config/appShell");
    setLiliaUiConfig(LILIA_UI_CONFIG);
    const { theme } = useTheme();

    expect(theme.value).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("setTheme 会同步更新 data-theme 和 localStorage", async () => {
    vi.resetModules();
    const { setLiliaUiConfig } = await import("@lilia/ui/shell");
    const { useTheme } = await import("@lilia/ui/composables/useTheme");
    const { LILIA_UI_CONFIG } = await import("../src/config/appShell");
    setLiliaUiConfig(LILIA_UI_CONFIG);
    const { theme, setTheme } = useTheme();

    setTheme("dark");

    expect(theme.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("lilia-github.theme")).toBe("dark");
  });
});
