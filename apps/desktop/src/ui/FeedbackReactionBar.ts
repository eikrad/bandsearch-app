import * as React from "react";

export type FeedbackType = "good" | "too_mainstream" | "wrong_direction";

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
    if (!visible) return;
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
