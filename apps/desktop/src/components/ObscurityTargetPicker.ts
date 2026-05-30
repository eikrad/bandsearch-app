import * as React from "react";

import type { ObscurityTarget } from "../../../../shared/schemas/src/contracts.js";

export type ObscurityTargetPickerProps = {
  target: ObscurityTarget | null;
  onTargetChange: (target: ObscurityTarget) => void;
};

const BUTTONS: { value: ObscurityTarget; label: string }[] = [
  { value: "cult", label: "Cult Following" },
  { value: "underground", label: "Underground" },
  { value: "obscure", label: "Truly Obscure" },
];

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
          className: value === target ? "active" : undefined,
          onClick: () => onTargetChange(value),
        },
        label,
      ),
    ),
  );
}
