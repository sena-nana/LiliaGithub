import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { defineComponent, ref } from "vue";
import { describe, expect, it } from "vitest";
import { Dropdown } from "@lilia/ui";
import { SB_MENU_POP_TRANSITION_MS } from "@lilia/ui/composables/menuMotion";

const options = [
  { value: "bottom", label: "向下展开", hint: "从按钮点击点展开菜单" },
  { value: "top", label: "向上展开", hint: "用于贴近页面底部的场景" },
] as const;

function renderDropdown() {
  return render(
    defineComponent({
      components: { Dropdown },
      setup() {
        const value = ref<"bottom" | "top">("bottom");
        return { options, value };
      },
      template: `
        <Dropdown
          v-model="value"
          :options="options"
          placement="bottom"
        />
      `,
    }),
    {
      global: {
        stubs: {
          transition: false,
        },
      },
    },
  );
}

describe("Dropdown", () => {
  it("可打开、选中选项并关闭", async () => {
    renderDropdown();

    await fireEvent.click(screen.getByRole("button", { name: /向下展开/i }));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /向上展开/i })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("option", { name: /向上展开/i }));

    await waitFor(
      () => {
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      },
      { timeout: SB_MENU_POP_TRANSITION_MS + 400 },
    );
    expect(screen.getByRole("button", { name: /向上展开/i })).toBeInTheDocument();
  });

  it("多选模式会保留菜单并切换多个选项", async () => {
    render(
      defineComponent({
        components: { Dropdown },
        setup() {
          const value = ref<Array<"bottom" | "top">>(["bottom"]);
          return { options, value };
        },
        template: `
          <Dropdown
            v-model="value"
            multiple
            :options="options"
            placement="bottom"
            menu-label="展开方向"
          />
        `,
      }),
      {
        global: {
          stubs: {
            transition: false,
          },
        },
      },
    );

    await fireEvent.click(screen.getByRole("button", { name: /向下展开/i }));
    const listbox = await screen.findByRole("listbox", { name: "展开方向" });
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("option", { name: /向下展开/i })).toHaveAttribute("aria-selected", "true");

    await fireEvent.click(screen.getByRole("option", { name: /向上展开/i }));

    expect(screen.getByRole("listbox", { name: "展开方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /向下展开, 向上展开/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /向上展开/i })).toHaveAttribute("aria-selected", "true");
  });

});
