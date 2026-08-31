/**
 * Vue DOM stand-ins for the Nana components used by shared LiliaGithub pages.
 * The Nana IIFE build aliases `@nanaui/nanavue-components` to NanaUI instead.
 */
import { defineComponent, h, type PropType, type VNode } from "vue";
import "./nanavue-dom-bridge.css";

type SegmentedOption = {
  value?: string | number;
  key?: string | number;
  label?: string;
  disabled?: boolean;
  agentId?: string;
};

function optionValue(option: SegmentedOption): string | number {
  return option.value ?? option.key ?? option.label ?? "";
}

export const NanaSegmented = defineComponent({
  name: "NanaSegmented",
  props: {
    modelValue: { type: [String, Number], default: "" },
    options: { type: Array as PropType<SegmentedOption[]>, default: () => [] },
  },
  emits: ["update:modelValue", "select"],
  setup(props, { emit, attrs }) {
    return () =>
      h(
        "div",
        {
          ...attrs,
          class: ["nana-segmented", attrs.class],
          role: "group",
        },
        props.options.map((option) => {
          const value = optionValue(option);
          return h(
            "button",
            {
              key: String(value),
              type: "button",
              class: { "is-active": String(props.modelValue) === String(value) },
              disabled: !!option.disabled,
              "data-agent-id": option.agentId,
              onClick: () => {
                emit("update:modelValue", value);
                emit("select", value);
              },
            },
            option.label ?? String(value),
          );
        }),
      );
  },
});

export const NanaSidebarFrame = defineComponent({
  name: "NanaSidebarFrame",
  props: {
    agentId: { type: String, default: "nana.sidebar-frame" },
    ariaLabel: { type: String, default: undefined },
  },
  setup(props, { slots, attrs }) {
    return () => {
      const children: VNode[] = [];
      if (slots.top) {
        children.push(h("div", { class: "nana-sidebar-frame__top", "data-slot": "sidebar-top" }, slots.top()));
      }
      children.push(
        h(
          "div",
          { class: "nana-sidebar-frame__body", "data-slot": "sidebar-body" },
          slots.body?.() || slots.default?.() || [],
        ),
      );
      if (slots.footer) {
        children.push(
          h("div", { class: "nana-sidebar-frame__footer", "data-slot": "sidebar-footer" }, slots.footer()),
        );
      }
      return h(
        "div",
        {
          ...attrs,
          class: ["nana-sidebar-frame", attrs.class],
          "aria-label": props.ariaLabel,
          "data-agent-id": props.agentId || attrs["data-agent-id"] || "nana.sidebar-frame",
        },
        children,
      );
    };
  },
});

export const NanaSidebarRow = defineComponent({
  name: "NanaSidebarRow",
  props: {
    label: { type: String, default: "" },
    active: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    agentId: { type: String, default: "" },
  },
  emits: ["select"],
  setup(props, { emit, slots, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          class: [
            "nana-sidebar-row",
            attrs.class,
            { "is-active": props.active, "is-muted": props.muted },
          ],
          disabled: props.disabled,
          "data-agent-id": props.agentId || attrs["data-agent-id"] || "nana.sidebar-row",
          onClick: (event: MouseEvent) => {
            if (props.disabled) {
              event.preventDefault();
              return;
            }
            emit("select", event);
          },
        },
        [h("span", { class: "nana-sidebar-row__label" }, props.label), slots.default?.()],
      );
  },
});
