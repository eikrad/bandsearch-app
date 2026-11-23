import * as React from "react";
import { t } from "../i18n/i18n.js";
import type { FeedbackType } from "../../../../shared/schemas/src/contracts.js";

export type { FeedbackType };

const BUTTONS = [
  { value: "good", label: "feedback.good" },
  { value: "too_mainstream", label: "feedback.tooMainstream" },
  { value: "wrong_direction", label: "feedback.wrongDirection" },
] as const satisfies ReadonlyArray<{ value: FeedbackType; label: string }>;

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
    React.createElement("span", { className: "feedback-label" }, t("feedback.question")),
    ...BUTTONS.map(({ value, label }) =>
      React.createElement(
        "button",
        { key: value, type: "button", onClick: () => onFeedback(value) },
        t(label),
      ),
    ),
  );
}
