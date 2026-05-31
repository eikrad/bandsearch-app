import * as React from "react";

import type { ObscurityTarget } from "../../../../shared/schemas/src/contracts.js";

const BUTTONS: Array<{ value: ObscurityTarget; label: string }> = [
  { value: "cult", label: "Cult Following" },
  { value: "underground", label: "Underground" },
  { value: "obscure", label: "Truly Obscure" },
];

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
        label,
      ),
    ),
  );
}
