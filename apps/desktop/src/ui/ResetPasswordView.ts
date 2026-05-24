import * as React from "react";

const palette = {
  pageBg: "#0d0f14",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  accent: "#7aa7d9",
  border: "#1e2a3a",
  errorText: "#f87171",
  successText: "#6ee7a0",
  successBg: "#0d2310",
  successBorder: "#1e4a2a",
  successCodeBg: "#0a0d14",
  inputBg: "#0d1117",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: palette.inputBg,
  color: palette.textPrimary,
  border: `1px solid ${palette.border}`,
  borderRadius: "6px",
  padding: "9px 12px",
  fontSize: "14px",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  color: palette.textSecondary,
  marginBottom: "6px",
};

export interface ResetPasswordViewHandlers {
  onResetPassword?: (email: string, recoveryCode: string, newPassword: string) => Promise<{ newRecoveryCode: string }>;
  onDone?: () => void;
  onNavigateLogin?: () => void;
}

export interface ResetPasswordViewProps {
  error?: string | null;
}

export function ResetPasswordView({ viewProps, handlers }: { viewProps: ResetPasswordViewProps; handlers: ResetPasswordViewHandlers }) {
  const [email, setEmail] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = React.useState<string | null>(null);

  const error = viewProps.error ?? localError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !recoveryCode.trim() || !newPassword) return;
    setLocalError(null);
    setLoading(true);
    try {
      const result = await handlers.onResetPassword?.(email.trim(), recoveryCode.trim(), newPassword);
      if (result?.newRecoveryCode) setNewRecoveryCode(result.newRecoveryCode);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (newRecoveryCode) {
    return React.createElement(
      "main",
      { style: { backgroundColor: palette.pageBg, color: palette.textPrimary, minHeight: "100vh", padding: "32px 24px", maxWidth: "480px", margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "12px" } }, "Password reset"),
      React.createElement("p", { style: { fontSize: "14px", color: palette.textSecondary, marginBottom: "20px", lineHeight: 1.55 } }, "Your password was updated. Save your new recovery code — it replaces the old one."),
      React.createElement(
        "div",
        { style: { backgroundColor: palette.successBg, border: `1px solid ${palette.successBorder}`, borderRadius: "8px", padding: "16px", marginBottom: "24px" } },
        React.createElement("p", { style: { fontSize: "11px", color: palette.textSecondary, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" } }, "New recovery code"),
        React.createElement(
          "code",
          { style: { display: "block", backgroundColor: palette.successCodeBg, color: palette.successText, padding: "10px 12px", borderRadius: "6px", fontSize: "13px", letterSpacing: "0.05em", wordBreak: "break-all" } },
          newRecoveryCode,
        ),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => handlers.onDone?.(),
          style: { backgroundColor: palette.accent, color: "#0a0d14", border: "none", borderRadius: "8px", padding: "11px 18px", fontWeight: "600", fontSize: "14px", cursor: "pointer" },
        },
        "I've saved it — sign in",
      ),
    );
  }

  return React.createElement(
    "main",
    { style: { backgroundColor: palette.pageBg, color: palette.textPrimary, minHeight: "100vh", padding: "32px 24px", maxWidth: "480px", margin: "0 auto" } },
    React.createElement("h1", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "8px" } }, "Reset password"),
    React.createElement("p", { style: { fontSize: "14px", color: palette.textSecondary, marginBottom: "20px", lineHeight: 1.55 } }, "Enter your email, the recovery code you received when creating your account, and a new password."),
    error && React.createElement("p", { style: { color: palette.errorText, fontSize: "13px", marginBottom: "16px" } }, error),
    React.createElement(
      "form",
      { onSubmit: handleSubmit, style: { display: "flex", flexDirection: "column", gap: "16px" } },
      React.createElement(
        "label",
        { style: labelStyle },
        "Email",
        React.createElement("input", {
          type: "email",
          value: email,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
          required: true,
          autoComplete: "email",
          style: { ...inputStyle, marginTop: "6px" },
        }),
      ),
      React.createElement(
        "label",
        { style: labelStyle },
        "Recovery code",
        React.createElement("input", {
          type: "text",
          value: recoveryCode,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRecoveryCode(e.target.value),
          required: true,
          placeholder: "xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx",
          style: { ...inputStyle, marginTop: "6px", fontFamily: "monospace" },
        }),
      ),
      React.createElement(
        "label",
        { style: labelStyle },
        "New password",
        React.createElement("input", {
          type: "password",
          value: newPassword,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value),
          required: true,
          autoComplete: "new-password",
          style: { ...inputStyle, marginTop: "6px" },
        }),
      ),
      React.createElement(
        "button",
        {
          type: "submit",
          disabled: loading,
          style: { backgroundColor: palette.accent, color: "#0a0d14", border: "none", borderRadius: "8px", padding: "11px 18px", fontWeight: "600", fontSize: "14px", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 },
        },
        loading ? "Resetting…" : "Reset password",
      ),
    ),
    React.createElement(
      "button",
      { type: "button", onClick: () => handlers.onNavigateLogin?.(), style: { background: "none", border: "none", color: palette.textSecondary, fontSize: "13px", cursor: "pointer", padding: 0, marginTop: "16px" } },
      "Back to sign in",
    ),
  );
}
