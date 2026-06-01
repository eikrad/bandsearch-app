import * as React from "react";
import type { FeedbackType } from "../../../../shared/schemas/src/contracts.js";

export type { FeedbackType };

const BUTTONS: Array<{ value: FeedbackType; label: string }> = [
  { value: "good", label: "Spot on" },
  { value: "too_mainstream", label: "Too mainstream" },
  { value: "wrong_direction", label: "Wrong direction" },
];

export type FeedbackReactionBarProps = {
  visible: boolean;
  onFeedback: (type: FeedbackType) => void;
  onDismiss: () => void;
};

export function FeedbackReactionBar({ visible, onFeedback, onDismiss }: FeedbackReactionBarProps) {
  React.useEffect(() => {
    const timer = setTimeout(onDismiss, 12000);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return React.createElement(
    "div",
    { className: "feedback-reaction-bar" },
    React.createElement("span", { className: "feedback-label" }, "How were these picks?"),
    ...BUTTONS.map(({ value, label }) =>
      React.createElement(
        "button",
        { key: value, type: "button", onClick: () => onFeedback(value) },
        label,
      ),
    ),
  );
}
