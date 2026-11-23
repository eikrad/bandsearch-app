import * as React from "react";
import { t } from "../i18n/i18n.js";

import type { ObscurityTarget } from "../../../../shared/schemas/src/contracts.js";

const BUTTONS = [
  { value: "cult", label: "obscurity.cult" },
  { value: "underground", label: "obscurity.underground" },
  { value: "obscure", label: "obscurity.obscure" },
] as const satisfies ReadonlyArray<{ value: ObscurityTarget; label: string }>;

export type ObscurityTargetPickerProps = {
  target: ObscurityTarget | undefined;
  onTargetChange: (target: ObscurityTarget | undefined) => void;
};

export function ObscurityTargetPicker({ target, onTargetChange }: ObscurityTargetPickerProps) {
  return React.createElement(
    "div",
    { className: "obscurity-target-picker" },
    BUTTONS.map(({ value, label }) =>
      React.createElement(
        "button",
        {
          key: value,
          type: "button",
          className: target === value ? "active" : undefined,
          onClick: () => onTargetChange(target === value ? undefined : value),
        },
        t(label),
      ),
    ),
  );
}
