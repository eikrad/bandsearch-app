import * as React from "react";
import { formatList, t } from "../i18n/i18n.js";

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
      t("settings.fromEnv"),
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
      t("settings.override"),
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
          t("settings.saveKey"),
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
      t("settings.turso.title"),
    ),
    showPresent ? EnvPresentState("Turso", () => setShowOverride(true)) : null,
    showPresent
      ? null
      : !hasTursoConfig
        ? React.createElement(
            "p",
            { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
            t("settings.turso.intro"),
          )
        : React.createElement(
            "p",
            { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
            t("settings.turso.connected"),
          ),
    showPresent
      ? null
      : React.createElement(
          "label",
          {
            htmlFor: "turso-database-url",
            style: { display: "block", fontSize: "12px", color: palette.textSecondary, marginBottom: "6px" },
          },
          t("settings.turso.url"),
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
          placeholder: hasTursoConfig ? t("settings.turso.urlReplace") : "libsql://your-db.turso.io",
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
          t("settings.turso.token"),
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
          placeholder: hasTursoConfig ? t("settings.turso.tokenReplace") : t("settings.turso.tokenPlaceholder"),
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
          t("settings.turso.save"),
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
          t("settings.turso.clear"),
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
  // cards consistent and avoids a stale value lingering after t("settings.endpoint.reset").
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
      t("settings.endpoint.title"),
    ),
    React.createElement(
      "p",
      { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
      isRemote
        ? t("settings.endpoint.remote", { url: apiEndpointUrl })
        : t("settings.endpoint.local"),
    ),
    React.createElement(
      "label",
      {
        htmlFor: "api-endpoint-url",
        style: { display: "block", fontSize: "12px", color: palette.textSecondary, marginBottom: "6px" },
      },
      t("settings.endpoint.url"),
    ),
    React.createElement("input", {
      id: "api-endpoint-url",
      name: "api-endpoint-url",
      type: "text",
      autoComplete: "off",
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
      placeholder: isRemote ? t("settings.endpoint.urlReplace") : "https://bandsearch-api.onrender.com",
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
      t("settings.endpoint.save"),
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
          t("settings.endpoint.reset"),
        )
      : null,
  );
}

interface PrivacyCardProps {
  onNavigatePrivacy?: () => void;
  onExportAccountData?: () => void;
  onDeleteAccount?: (password: string) => void;
  accountsEnabled?: boolean;
  statusMessage: StatusMessage;
}

/**
 * GDPR self-service: read what is collected (Art. 13/14), take a copy
 * (Art. 15/20). Deliberately a plain link and a plain button — the house style
 * for this app is disclosure, not consent gates.
 */
function PrivacyCard({
  onNavigatePrivacy,
  onExportAccountData,
  onDeleteAccount,
  accountsEnabled,
  statusMessage,
}: PrivacyCardProps) {
  // Two-step reveal rather than a native confirm(): Tauri webview support for
  // confirm() is inconsistent, and this matches ApiEndpointCard's draft-input
  // pattern. Nothing destructive can fire from a single click.
  const [confirming, setConfirming] = React.useState(false);
  const [password, setPassword] = React.useState("");

  const dangerZone = !accountsEnabled
    ? null
    : React.createElement(
        "div",
        {
          style: {
            marginTop: "14px",
            paddingTop: "14px",
            borderTop: `1px solid ${palette.border}`,
          },
        },
        React.createElement(
          "p",
          { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "10px" } },
          t("settings.privacy.deleteWarning"),
        ),
        confirming
          ? React.createElement(
              "div",
              {
                style: {
                  border: `1px solid ${palette.warnBorder}`,
                  backgroundColor: palette.warnBg,
                  borderRadius: "8px",
                  padding: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                },
              },
              React.createElement(
                "label",
                { style: { fontSize: "12px", color: palette.textSecondary }, htmlFor: "delete-account-password" },
                t("settings.privacy.deleteConfirm"),
              ),
              React.createElement("input", {
                id: "delete-account-password",
                name: "delete-account-password",
                type: "password",
                value: password,
                autoComplete: "current-password",
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
                style: {
                  backgroundColor: palette.inputBg,
                  color: palette.textPrimary,
                  border: `1px solid ${palette.buttonBorder}`,
                  borderRadius: "7px",
                  padding: "8px 12px",
                  fontSize: "13px",
                },
              }),
              React.createElement(
                "div",
                { style: { display: "flex", gap: "8px" } },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "confirm-delete-account-btn",
                    disabled: password.length === 0,
                    onClick: () => onDeleteAccount?.(password),
                    style: {
                      backgroundColor: palette.warnBorder,
                      color: palette.textPrimary,
                      border: "none",
                      borderRadius: "7px",
                      padding: "7px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                    },
                  },
                  t("settings.privacy.deletePermanently"),
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    onClick: () => { setConfirming(false); setPassword(""); },
                    style: {
                      backgroundColor: palette.buttonBg,
                      color: palette.buttonText,
                      border: `1px solid ${palette.buttonBorder}`,
                      borderRadius: "7px",
                      padding: "7px 14px",
                      fontSize: "12px",
                    },
                  },
                  t("common.cancel"),
                ),
              ),
            )
          : React.createElement(
              "button",
              {
                type: "button",
                className: "delete-account-btn",
                onClick: () => setConfirming(true),
                style: {
                  backgroundColor: "transparent",
                  color: "#e08a7a",
                  border: `1px solid ${palette.warnBorder}`,
                  borderRadius: "7px",
                  padding: "7px 14px",
                  fontSize: "12px",
                },
              },
              t("settings.privacy.delete"),
            ),
      );

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
      t("settings.privacy.title"),
    ),
    React.createElement(
      "p",
      { style: { fontSize: "12px", color: palette.textTertiary, marginBottom: "12px" } },
      t("settings.privacy.intro"),
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
        t("settings.privacy.policy"),
      ),
      // Omitted rather than rendered inert when nothing can serve it — the
      // locked rule in UI_GUIDELINES.md: "No control may render without an
      // action behind it." A dead t("settings.privacy.export") is worse than none, because
      // the privacy policy points users at it.
      !onExportAccountData ? null : React.createElement(
        "button",
        {
          type: "button",
          className: "export-account-btn",
          onClick: () => onExportAccountData(),
          style: {
            backgroundColor: palette.buttonBg,
            color: palette.buttonText,
            border: `1px solid ${palette.buttonBorder}`,
            borderRadius: "7px",
            minHeight: "44px",
            padding: "0 14px",
            fontSize: "12px",
          },
        },
        t("settings.privacy.export"),
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
    dangerZone,
  );
}

interface SettingsViewProps {
  viewProps: {
    headerTitle?: string;
    headerSubtitle?: string;
    hasStoredKey?: boolean;
    hasBraveKey?: boolean;
    hasTursoConfig?: boolean;
    llmKeyFromEnv?: boolean;
    braveKeyFromEnv?: boolean;
    tursoFromEnv?: boolean;
    apiEndpointUrl?: string;
    llmStatusMessage?: StatusMessage;
    braveStatusMessage?: StatusMessage;
    tursoStatusMessage?: StatusMessage;
    apiEndpointStatusMessage?: StatusMessage;
    privacyStatusMessage?: StatusMessage;
    accountsEnabled?: boolean;
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
    onDeleteAccount?: (password: string) => void;
  };
}

export function SettingsView({ viewProps, handlers }: SettingsViewProps) {
  const subtitle =
    viewProps.headerSubtitle ||
    t("settings.subtitle");

  const missingKeys: string[] = [];
  if (viewProps.hasStoredKey === false && !viewProps.llmKeyFromEnv) missingKeys.push("Scaleway");
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
          t("settings.missingKeys", { count: missingKeys.length, names: formatList(missingKeys) }),
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
        t("settings.endpoint.keysInactive"),
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
            viewProps.headerTitle || t("settings.title"),
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
          t("settings.back"),
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
      onDeleteAccount: handlers.onDeleteAccount,
      accountsEnabled: viewProps.accountsEnabled,
      statusMessage: viewProps.privacyStatusMessage ?? null,
    }),
    React.createElement(ApiKeyCard, {
      id: "llm-api-key",
      label: t("settings.scalewayKey"),
      placeholder: viewProps.hasStoredKey ? t("settings.keyReplace") : t("settings.scalewayKeyPlaceholder"),
      onSave: (key) => handlers.onSaveApiKey?.(key),
      statusMessage: viewProps.llmStatusMessage ?? null,
      fromEnv: viewProps.llmKeyFromEnv,
    }),
    React.createElement(ApiKeyCard, {
      id: "brave-api-key",
      label: t("settings.braveKey"),
      placeholder: viewProps.hasBraveKey ? t("settings.keyReplace") : t("settings.braveKeyPlaceholder"),
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
