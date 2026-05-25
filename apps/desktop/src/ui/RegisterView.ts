import * as React from "react";

const palette = {
  pageBg: "#0d0f14",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  accent: "#7aa7d9",
  border: "#1e2a3a",
  errorText: "#f87171",
  successBg: "#0d2310",
  successBorder: "#1e4a2a",
  successText: "#6ee7a0",
  inputBg: "#0d1117",
  codeBg: "#0a0d14",
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

export interface RegisterViewHandlers {
  onRegister?: (email: string, displayName: string, password: string) => Promise<{ recoveryCode: string }>;
  onDone?: () => void;
  onNavigateLogin?: () => void;
}

export interface RegisterViewProps {
  error?: string | null;
}

export function RegisterView({ viewProps, handlers }: { viewProps: RegisterViewProps; handlers: RegisterViewHandlers }) {
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [recoveryCode, setRecoveryCode] = React.useState<string | null>(null);

  const error = viewProps.error ?? localError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLocalError(null);
    setLoading(true);
    try {
      const result = await handlers.onRegister?.(email.trim(), displayName.trim(), password);
      if (result?.recoveryCode) setRecoveryCode(result.recoveryCode);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCode) {
    return React.createElement(
      "main",
      { style: { backgroundColor: palette.pageBg, color: palette.textPrimary, minHeight: "100vh", padding: "32px 24px", maxWidth: "480px", margin: "0 auto" } },
      React.createElement("h1", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "12px" } }, "Account created"),
      React.createElement("p", { style: { fontSize: "14px", color: palette.textSecondary, marginBottom: "20px", lineHeight: 1.55 } }, "Save your recovery code somewhere safe. It's the only way to reset your password — it won't be shown again."),
      React.createElement(
        "div",
        { style: { backgroundColor: palette.successBg, border: `1px solid ${palette.successBorder}`, borderRadius: "8px", padding: "16px", marginBottom: "24px" } },
        React.createElement("p", { style: { fontSize: "11px", color: palette.textSecondary, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" } }, "Recovery code"),
        React.createElement(
          "code",
          { style: { display: "block", backgroundColor: palette.codeBg, color: palette.successText, padding: "10px 12px", borderRadius: "6px", fontSize: "13px", letterSpacing: "0.05em", wordBreak: "break-all" } },
          recoveryCode,
        ),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => handlers.onDone?.(),
          style: { backgroundColor: palette.accent, color: "#0a0d14", border: "none", borderRadius: "8px", padding: "11px 18px", fontWeight: "600", fontSize: "14px", cursor: "pointer" },
        },
        "I've saved it — continue",
      ),
    );
  }

  return React.createElement(
    "main",
    { style: { backgroundColor: palette.pageBg, color: palette.textPrimary, minHeight: "100vh", padding: "32px 24px", maxWidth: "480px", margin: "0 auto" } },
    React.createElement("h1", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "24px" } }, "Create account"),
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
        "Display name",
        React.createElement("input", {
          type: "text",
          value: displayName,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value),
          placeholder: "How you want to be addressed",
          style: { ...inputStyle, marginTop: "6px" },
        }),
      ),
      React.createElement(
        "label",
        { style: labelStyle },
        "Password",
        React.createElement("input", {
          type: "password",
          value: password,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
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
        loading ? "Creating account…" : "Create account",
      ),
    ),
    React.createElement(
      "button",
      { type: "button", onClick: () => handlers.onNavigateLogin?.(), style: { background: "none", border: "none", color: palette.textSecondary, fontSize: "13px", cursor: "pointer", padding: 0, marginTop: "16px" } },
      "Already have an account? Sign in",
    ),
  );
}
