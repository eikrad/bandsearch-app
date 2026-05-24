import * as React from "react";

const palette = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  accent: "#7aa7d9",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
  errorText: "#f87171",
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

export interface LoginViewHandlers {
  onLogin?: (email: string, password: string) => Promise<void>;
  onNavigateRegister?: () => void;
  onNavigateReset?: () => void;
}

export interface LoginViewProps {
  error?: string | null;
  isLoading?: boolean;
}

export function LoginView({ viewProps, handlers }: { viewProps: LoginViewProps; handlers: LoginViewHandlers }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const error = viewProps.error ?? localError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLocalError(null);
    setLoading(true);
    try {
      await handlers.onLogin?.(email.trim(), password);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "login failed");
    } finally {
      setLoading(false);
    }
  }

  return React.createElement(
    "main",
    { style: { backgroundColor: palette.pageBg, color: palette.textPrimary, minHeight: "100vh", padding: "32px 24px", maxWidth: "480px", margin: "0 auto" } },
    React.createElement("h1", { style: { fontSize: "20px", fontWeight: "700", marginBottom: "24px" } }, "Sign in"),
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
        "Password",
        React.createElement("input", {
          type: "password",
          value: password,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
          required: true,
          autoComplete: "current-password",
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
        loading ? "Signing in…" : "Sign in",
      ),
    ),
    React.createElement(
      "div",
      { style: { marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" } },
      React.createElement(
        "button",
        { type: "button", onClick: () => handlers.onNavigateRegister?.(), style: { background: "none", border: "none", color: palette.accent, fontSize: "13px", cursor: "pointer", padding: 0, textAlign: "left" } },
        "Create an account →",
      ),
      React.createElement(
        "button",
        { type: "button", onClick: () => handlers.onNavigateReset?.(), style: { background: "none", border: "none", color: palette.textSecondary, fontSize: "13px", cursor: "pointer", padding: 0, textAlign: "left" } },
        "Forgot password? Use recovery code",
      ),
    ),
  );
}
