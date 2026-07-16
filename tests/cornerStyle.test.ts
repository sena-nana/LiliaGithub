import { describe, expect, it, vi } from "vitest";

describe("useCornerStyle", () => {
  it("从 localStorage 恢复圆角设置并写入 html", async () => {
    localStorage.setItem("lilia-github.corners", "round");
    localStorage.setItem("lilia-github.cornerRadius", "14");
    vi.resetModules();

    const { setLiliaUiConfig } = await import("@lilia/ui/shell");
    const { useCornerStyle } = await import("@lilia/ui/composables/useCornerStyle");
    const { LILIA_UI_CONFIG } = await import("../src/config/appShell");
    setLiliaUiConfig(LILIA_UI_CONFIG);
    const { cornerStyle, cornerRadius } = useCornerStyle();

    expect(cornerStyle.value).toBe("round");
    expect(cornerRadius.value).toBe(14);
    expect(document.documentElement.dataset.corners).toBe("round");
    expect(document.documentElement.style.getPropertyValue("--app-corner-radius")).toBe("14px");
  });

  it("setCornerRadius 会限制范围并同步存储", async () => {
    vi.resetModules();
    const { setLiliaUiConfig } = await import("@lilia/ui/shell");
    const { useCornerStyle } = await import("@lilia/ui/composables/useCornerStyle");
    const { LILIA_UI_CONFIG } = await import("../src/config/appShell");
    setLiliaUiConfig(LILIA_UI_CONFIG);
    const { cornerRadius, setCornerRadius, setCornerStyle } = useCornerStyle();

    setCornerStyle("smooth");
    setCornerRadius(999);

    expect(cornerRadius.value).toBe(20);
    expect(document.documentElement.dataset.corners).toBe("smooth");
    expect(localStorage.getItem("lilia-github.cornerRadius")).toBe("20");
  });
});
