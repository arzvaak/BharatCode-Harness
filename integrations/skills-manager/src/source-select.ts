import type * as React from "react";
import type { SourceSelectProps } from "./client-types.js";
import { Button, Dropdown, Select } from "./antd-ui.js";
import { handleSourceMenuEscape } from "./source-select-model.js";

/** Use Ant Design Select for filters and Dropdown for actions. Fit the options instead of filling the row. While open, capture Escape on window so it does not close the host settings page. */
export function createSourceSelect(react: typeof React) {
  const h = react.createElement;
  return function SourceSelect(props: SourceSelectProps) {
    const openState = react.useState(false);
    const open = openState[0];
    const setOpen = openState[1];
    react.useEffect(function () {
      if (!open || typeof window === "undefined") return undefined;
      function onKey(event: KeyboardEvent) {
        handleSourceMenuEscape(event, function () { setOpen(false); });
      }
      window.addEventListener("keydown", onKey, true);
      return function () { window.removeEventListener("keydown", onKey, true); };
    }, [open]);
    function onOpenChange(next: boolean) { setOpen(next); }
    if (props.action) {
      return h(Dropdown, {
        trigger: ["click"],
        open: open,
        onOpenChange: onOpenChange,
        menu: {
          items: props.options.map((option) => ({ key: option.value, label: option.label, disabled: option.disabled, danger: option.danger })),
          onClick: (info: { key: string }) => props.onChange(String(info.key)),
        },
      }, h(Button, { disabled: props.disabled, "aria-label": props.label }, props.label));
    }
    return h(Select, {
      className: "dssm-antd-select",
      "aria-label": props.label,
      disabled: props.disabled,
      open: open,
      onOpenChange: onOpenChange,
      value: props.value ?? "",
      popupMatchSelectWidth: false,
      options: props.options.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled })),
      onChange: (value: unknown) => props.onChange(String(value)),
    });
  };
}
