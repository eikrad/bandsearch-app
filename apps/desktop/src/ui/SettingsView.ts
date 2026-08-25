import * as React from "react";

const palette = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  textTertiary: "#5a6880",
  accent: "#7aa7d9",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
  inputBg: "#0b0e18",
  warnBg: "#2a1810",
  warnBorder: "#5c3d28",
};

type StatusMessage = { type: "success" | "error"; text: string } | null;

interface ApiKeyCardProps {
  id: string;
  label: string;
  placeholder: string;
  onSave?: (key: string) => void;
  statusMessage: StatusMessage;
  fromEnv?: boolean;
}

function EnvPresentState(label: string, onOverride: () => void) {
  return [
    React.createElement(
      "p",
      {
        key: "env-status",
        role: "status",
        style: { fontSize: "13px", color: palette.accent, marginBottom: "12px" },
      },
      `✓ Present — loaded from .env`,
    ),
    React.createElement(
      "button",
      {
        key: "env-override",
        type: "button",
        onClick: onOverride,
        style: {
          backgroundColor: palette.buttonBg,
          color: palette.buttonText,
          border: `1px solid ${palette.buttonBorder}`,
          borderRadius: "8px",
          padding: "10px 18px",
          fontWeight: "600",
          fontSize: "13px",
          cursor: "pointer",
        },
      },
      `Override`,
    ),
  ];
}

function ApiKeyCard({ id, label, placeholder, onSave, statusMessage, fromEnv }: ApiKeyCardProps) {
  const [draft, setDraft] = React.useState("");
  const [showOverride, setShowOverride] = React.useState(false);
  const showPresent = Boolean(fromEnv) && !showOverride;
  return React.createElement(
    "section",
    {
      style: {
        marginTop: "12px",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.cardBg,
      },
    },
    React.createElement(
      "label",
      {
        htmlFor: id,
        style: { display: "block", fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "8px" },
      },
      label,
    ),
    showPresent
      ? EnvPresentState(label, () => setShowOverride(true))
      : React.createElement("input", {
      id,
      name: id,
      type: "password",
      autoComplete: "off",
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      placeholder,
      className: "settings-api-key-input",
      style: {
        width: "100%",
        boxSizing: "border-box",
        backgroundColor: palette.inputBg,
        color: palette.textPrimary,
        border: `1px solid ${palette.border}`,
        borderRadius: "8px",
        padding: "10px 12px",
        fontSize: "14px",
        marginBottom: "12px",
      },
    }),
    statusMessage
      ? React.createElement(
          "p",
          {
            role: "status",
            style: {
              fontSize: "13px",
              color: statusMessage.type === "error" ? "#e57373" : palette.accent,
              marginBottom: "12px",
            },
          },
          statusMessage.text,
        )
      : null,
    showPresent
      ? null
      : React.createElement(
          "button",
          {
            type: "button",
            className: "settings-save-key-btn",
            onClick: () => onSave?.(draft.trim()),
            style: {
              backgroundColor: palette.accent,
              color: "#0a0d14",
              border: "none",
              borderRadius: "8px",
              padding: "10px 18px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
            },
          },
          "Save key",
        ),
  );
}

interface TursoConfigCardProps {
  hasTursoConfig: boolean;
  statusMessage: StatusMessage;
  onSave?: (url: string, token: string) => void;
  onClear?: () => void;
  fromEnv?: boolean;
}

function TursoConfigCard({ hasTursoConfig, statusMessage, onSave, onClear, fromEnv }: TursoConfigCardProps) {
  const [draftUrl, setDraftUrl] = React.useState("");
  const [draftToken, setDraftToken] = React.useState("");
  const [showOverride, setShowOverride] = React.useState(false);
  const showPresent = Boolean(fromEnv) && !showOverride;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: palette.inputBg,
    color: palette.textPrimary,
    border: `1px solid ${palette.border}`,
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "14px",
    marginBottom: "12px",
  };

  return React.createElement(
    "section",
    {
      style: {
        marginTop: "12px",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.cardBg,
      },
    },
    React.createElement(
      "p",
      { style: { fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "4px" } },
      "Turso cross-device sync",
    ),
    showPresent ? EnvPresentState("Turso", () => setShowOverride(true)) : null,
    showPresent
      ? null
      : !hasTursoConfig
        ? React.createElement(
            "p",
            { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
            "Add a Turso database URL to sync your saved artists across devices. Your local data won’t transfer automatically — export it first, then import after switching.",
          )
        : React.createElement(
            "p",
            { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
            "Connected to Turso. Your local SQLite data is still on this device — switch back any time.",
          ),
    showPresent
      ? null
      : React.createElement(
          "label",
          {
            htmlFor: "turso-database-url",
            style: { display: "block", fontSize: "12px", color: palette.textSecondary, marginBottom: "6px" },
          },
          "Database URL",
        ),
    showPresent
      ? null
      : React.createElement("input", {
          id: "turso-database-url",
          name: "turso-database-url",
          type: "text",
          autoComplete: "off",
          value: draftUrl,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraftUrl(e.target.value),
          placeholder: hasTursoConfig ? "Enter a new URL to replace the saved URL" : "libsql://your-db.turso.io",
          style: inputStyle,
        }),
    showPresent
      ? null
      : React.createElement(
          "label",
          {
            htmlFor: "turso-auth-token",
            style: { display: "block", fontSize: "12px", color: palette.textSecondary, marginBottom: "6px" },
          },
          "Auth token",
        ),
    showPresent
      ? null
      : React.createElement("input", {
          id: "turso-auth-token",
          name: "turso-auth-token",
          type: "password",
          autoComplete: "off",
          value: draftToken,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraftToken(e.target.value),
          placeholder: hasTursoConfig ? "Enter a new token to replace the saved token" : "Paste your Turso auth token",
          style: inputStyle,
        }),
    statusMessage
      ? React.createElement(
          "p",
          {
            role: "status",
            style: {
              fontSize: "13px",
              color: statusMessage.type === "error" ? "#e57373" : palette.accent,
              marginBottom: "12px",
            },
          },
          statusMessage.text,
        )
      : null,
    showPresent
      ? null
      : React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onSave?.(draftUrl.trim(), draftToken.trim()),
            style: {
              backgroundColor: palette.accent,
              color: "#0a0d14",
              border: "none",
              borderRadius: "8px",
              padding: "10px 18px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
            },
          },
          "Save and connect",
        ),
    !showPresent && hasTursoConfig
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onClear?.(),
            style: {
              backgroundColor: "transparent",
              color: palette.textSecondary,
              border: `1px solid ${palette.border}`,
              borderRadius: "8px",
              padding: "10px 18px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              marginTop: "8px",
            },
          },
          "Switch back to local SQLite",
        )
      : null,
  );
}

interface ApiEndpointCardProps {
  apiEndpointUrl: string;
  statusMessage: StatusMessage;
  onSave?: (url: string) => void;
}

function ApiEndpointCard({ apiEndpointUrl, statusMessage, onSave }: ApiEndpointCardProps) {
  const isRemote = Boolean(apiEndpointUrl);
  // Like TursoConfigCard, the input starts empty: the current endpoint is shown in
  // the description, the field is only for entering a new value. This keeps the two
  // cards consistent and avoids a stale value lingering after "Reset to local".
  const [draft, setDraft] = React.useState("");

  return React.createElement(
    "section",
    {
      style: {
        marginTop: "12px",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.cardBg,
      },
    },
    React.createElement(
      "p",
      { style: { fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "4px" } },
      "API endpoint",
    ),
    React.createElement(
      "p",
      { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
      isRemote
        ? `Connected to a remote API at ${apiEndpointUrl}. The built-in local app is not started while a remote endpoint is set.`
        : "Using the built-in local app. Enter a remote URL to connect to a hosted Bandsearch API instead.",
    ),
    React.createElement(
      "label",
      {
        htmlFor: "api-endpoint-url",
        style: { display: "block", fontSize: "12px", color: palette.textSecondary, marginBottom: "6px" },
      },
      "Remote API URL",
    ),
    React.createElement("input", {
      id: "api-endpoint-url",
      name: "api-endpoint-url",
      type: "text",
      autoComplete: "off",
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      placeholder: isRemote ? "Enter a new URL to replace the saved endpoint" : "https://bandsearch.onrender.com",
      style: {
        width: "100%",
        boxSizing: "border-box",
        backgroundColor: palette.inputBg,
        color: palette.textPrimary,
        border: `1px solid ${palette.border}`,
        borderRadius: "8px",
        padding: "10px 12px",
        fontSize: "14px",
        marginBottom: "12px",
      },
    }),
    statusMessage
      ? React.createElement(
          "p",
          {
            role: "status",
            style: {
              fontSize: "13px",
              color: statusMessage.type === "error" ? "#e57373" : palette.accent,
              marginBottom: "12px",
            },
          },
          statusMessage.text,
        )
      : null,
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => onSave?.(draft.trim()),
        style: {
          backgroundColor: palette.accent,
          color: "#0a0d14",
          border: "none",
          borderRadius: "8px",
          padding: "10px 18px",
          fontWeight: "600",
          fontSize: "13px",
          cursor: "pointer",
        },
      },
      "Save endpoint",
    ),
    isRemote
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: () => onSave?.(""),
            style: {
              backgroundColor: "transparent",
              color: palette.textSecondary,
              border: `1px solid ${palette.border}`,
              borderRadius: "8px",
              padding: "10px 18px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              marginTop: "8px",
            },
          },
          "Reset to local",
        )
      : null,
  );
}

interface PrivacyCardProps {
  onNavigatePrivacy?: () => void;
  onExportAccountData?: () => void;
  statusMessage: StatusMessage;
}

/**
 * GDPR self-service: read what is collected (Art. 13/14), take a copy
 * (Art. 15/20). Deliberately a plain link and a plain button — the house style
 * for this app is disclosure, not consent gates.
 */
function PrivacyCard({ onNavigatePrivacy, onExportAccountData, statusMessage }: PrivacyCardProps) {
  return React.createElement(
    "section",
    {
      style: {
        marginTop: "12px",
        padding: "16px",
        borderRadius: "10px",
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.cardBg,
      },
    },
    React.createElement(
      "p",
      { style: { fontSize: "12px", fontWeight: "600", color: palette.textSecondary, marginBottom: "4px" } },
      "Privacy & data",
    ),
    React.createElement(
      "p",
      { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
      "Read what Bandsearch collects and why, or download a copy of everything it holds about you.",
    ),
    React.createElement(
      "div",
      { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      React.createElement(
        "button",
        {
          type: "button",
          className: "privacy-policy-btn",
          onClick: () => onNavigatePrivacy?.(),
          style: {
            backgroundColor: palette.buttonBg,
            color: palette.buttonText,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: "7px",
            padding: "7px 14px",
            fontSize: "12px",
          },
        },
        "Privacy policy",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "export-account-btn",
          onClick: () => onExportAccountData?.(),
          style: {
            backgroundColor: palette.buttonBg,
            color: palette.buttonText,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: "7px",
            padding: "7px 14px",
            fontSize: "12px",
          },
        },
        "Export my data",
      ),
    ),
    statusMessage
      ? React.createElement(
          "p",
          {
            style: {
              fontSize: "12px",
              marginTop: "10px",
              color: statusMessage.type === "error" ? "#e08a7a" : palette.accent,
            },
          },
          statusMessage.text,
        )
      : null,
  );
}

interface SettingsViewProps {
  viewProps: {
    headerTitle?: string;
    headerSubtitle?: string;
    hasStoredKey?: boolean;
    hasBraveKey?: boolean;
    hasTursoConfig?: boolean;
    geminiKeyFromEnv?: boolean;
    braveKeyFromEnv?: boolean;
    tursoFromEnv?: boolean;
    apiEndpointUrl?: string;
    geminiStatusMessage?: StatusMessage;
    braveStatusMessage?: StatusMessage;
    tursoStatusMessage?: StatusMessage;
    apiEndpointStatusMessage?: StatusMessage;
    privacyStatusMessage?: StatusMessage;
  };
  handlers: {
    onNavigateChat?: () => void;
    onSaveApiKey?: (key: string) => void;
    onSaveBraveApiKey?: (key: string) => void;
    onSaveTursoConfig?: (url: string, token: string) => void;
    onClearTursoConfig?: () => void;
    onSaveApiEndpointUrl?: (url: string) => void;
    onNavigatePrivacy?: () => void;
    onExportAccountData?: () => void;
  };
}

export function SettingsView({ viewProps, handlers }: SettingsViewProps) {
  const subtitle =
    viewProps.headerSubtitle ||
    "Your keys are stored locally on this device and passed to the Bandsearch API process.";

  const missingKeys: string[] = [];
  if (viewProps.hasStoredKey === false && !viewProps.geminiKeyFromEnv) missingKeys.push("Gemini");
  if (viewProps.hasBraveKey === false && !viewProps.braveKeyFromEnv) missingKeys.push("Brave Search");

  const banner =
    missingKeys.length > 0
      ? React.createElement(
          "div",
          {
            role: "status",
            style: {
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: `1px solid ${palette.warnBorder}`,
              backgroundColor: palette.warnBg,
              color: palette.textSecondary,
              fontSize: "13px",
              lineHeight: 1.45,
            },
          },
          `${missingKeys.join(" and ")} API ${missingKeys.length === 1 ? "key is" : "keys are"} not configured yet. Add ${missingKeys.length === 1 ? "it" : "them"} below so recommendations can run.`,
        )
      : null;

  const isRemote = Boolean(viewProps.apiEndpointUrl);
  const serverManagedNote = isRemote
    ? React.createElement(
        "p",
        {
          role: "note",
          style: {
            marginTop: "12px",
            fontSize: "12px",
            color: palette.textTertiary,
            lineHeight: 1.45,
          },
        },
        "A remote endpoint is active — the keys below configure the built-in local app and apply only if you reset to local.",
      )
    : null;

  return React.createElement(
    "main",
    {
      style: {
        backgroundColor: palette.pageBg,
        color: palette.textPrimary,
        minHeight: "100vh",
        padding: "32px 24px",
        maxWidth: "560px",
        margin: "0 auto",
      },
    },
    React.createElement(
      "header",
      { style: { marginBottom: "20px" } },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "12px",
          },
        },
        React.createElement(
          "div",
          null,
          React.createElement(
            "h1",
            { style: { fontSize: "20px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "4px" } },
            viewProps.headerTitle || "Settings",
          ),
          React.createElement("p", { style: { fontSize: "13px", color: palette.textSecondary } }, subtitle),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => handlers.onNavigateChat?.(),
            style: {
              backgroundColor: palette.buttonBg,
              color: palette.buttonText,
              border: `1px solid ${palette.buttonBorder}`,
              borderRadius: "7px",
              padding: "6px 12px",
              fontSize: "12px",
              cursor: "pointer",
              flexShrink: 0,
            },
          },
          "← Recommendations",
        ),
      ),
      React.createElement("hr", { style: { border: "none", borderTop: `1px solid ${palette.border}`, margin: "0" } }),
    ),
    banner,
    React.createElement(ApiEndpointCard, {
      apiEndpointUrl: viewProps.apiEndpointUrl ?? "",
      statusMessage: viewProps.apiEndpointStatusMessage ?? null,
      onSave: (url) => handlers.onSaveApiEndpointUrl?.(url),
    }),
    serverManagedNote,
    React.createElement(PrivacyCard, {
      onNavigatePrivacy: handlers.onNavigatePrivacy,
      onExportAccountData: handlers.onExportAccountData,
      statusMessage: viewProps.privacyStatusMessage ?? null,
    }),
    React.createElement(ApiKeyCard, {
      id: "gemini-api-key",
      label: "Gemini API key",
      placeholder: viewProps.hasStoredKey ? "Enter a new key to replace the saved key" : "Paste your Gemini API key",
      onSave: (key) => handlers.onSaveApiKey?.(key),
      statusMessage: viewProps.geminiStatusMessage ?? null,
      fromEnv: viewProps.geminiKeyFromEnv,
    }),
    React.createElement(ApiKeyCard, {
      id: "brave-api-key",
      label: "Brave Search API key",
      placeholder: viewProps.hasBraveKey ? "Enter a new key to replace the saved key" : "Paste your Brave Search API key",
      onSave: (key) => handlers.onSaveBraveApiKey?.(key),
      statusMessage: viewProps.braveStatusMessage ?? null,
      fromEnv: viewProps.braveKeyFromEnv,
    }),
    React.createElement(TursoConfigCard, {
      hasTursoConfig: Boolean(viewProps.hasTursoConfig),
      statusMessage: viewProps.tursoStatusMessage ?? null,
      onSave: (url, token) => handlers.onSaveTursoConfig?.(url, token),
      onClear: () => handlers.onClearTursoConfig?.(),
      fromEnv: viewProps.tursoFromEnv,
    }),
  );
}
