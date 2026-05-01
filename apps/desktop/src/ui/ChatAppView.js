const React = require("react");

function getTheme(modeValue) {
  const isWarm = modeValue === "preference-aware";
  return {
    pageBg: "#0d0f14",
    cardBg: "#111827",
    border: "#1e2a3a",
    textPrimary: "#f0f4f8",
    textSecondary: "#8896a8",
    textTertiary: "#5a6880",
    accent: isWarm ? "#d7a870" : "#7aa7d9",
    accentDim: isWarm ? "#2d2318" : "#1c2d42",
    accentStripe: isWarm ? "#c4944a" : "#5b9bd5",
    buttonBg: "#161e2e",
    buttonBorder: "#243044",
    buttonText: "#c8d4e8",
    inputBg: "#0b0e18",
    inputBorder: "#1e2a3a",
  };
}

function ModePill({ modeValue, modeOptions, onModeChange }) {
  return React.createElement(
    "div",
    { className: "mode-pill" },
    modeOptions.map((opt) => {
      const isActive = opt.value === modeValue;
      const activeClass = isActive
        ? modeValue === "preference-aware"
          ? "active-warm"
          : "active-fresh"
        : "";
      return React.createElement(
        "button",
        {
          key: opt.value,
          type: "button",
          className: activeClass,
          onClick: () => onModeChange(opt.value),
        },
        opt.label,
      );
    }),
  );
}

function renderCardActions(card, theme, handlers) {
  const btnStyle = {
    backgroundColor: theme.buttonBg,
    color: theme.buttonText,
    border: `1px solid ${theme.buttonBorder}`,
    borderRadius: "7px",
    padding: "6px 12px",
    fontSize: "13px",
  };
  const actions = [];
  if (card.actions?.save?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "save", type: "button", className: "action-btn", style: btnStyle, onClick: () => handlers.onSave(card.title) },
        "Save",
      ),
    );
  }
  if (card.actions?.rate?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "rate", type: "button", className: "action-btn", style: btnStyle, onClick: () => handlers.onRate(card.title) },
        "Rate",
      ),
    );
  }
  if (card.actions?.more?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "more", type: "button", className: "action-btn", style: btnStyle, onClick: () => handlers.onMore(card.title) },
        "More",
      ),
    );
  }
  return actions;
}

function RecommendationCard({ card, theme, isMobile, handlers }) {
  return React.createElement(
    "article",
    {
      style: {
        backgroundColor: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.accentStripe}`,
        borderRadius: "10px",
        padding: "16px",
      },
    },
    React.createElement(
      "div",
      { style: { display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "6px" } },
      React.createElement(
        "h2",
        { style: { fontSize: "15px", fontWeight: "600", color: theme.textPrimary, letterSpacing: "-0.01em" } },
        card.title,
      ),
      card.saved
        ? React.createElement(
            "span",
            {
              style: {
                fontSize: "11px",
                color: theme.accent,
                border: `1px solid ${theme.accentDim}`,
                borderRadius: "4px",
                padding: "1px 6px",
                letterSpacing: "0.03em",
              },
            },
            card.rating ? `saved · ${card.rating}/5` : "saved",
          )
        : null,
    ),
    card.why
      ? React.createElement(
          "p",
          {
            style: {
              fontSize: "14px",
              color: theme.textPrimary,
              fontStyle: "italic",
              lineHeight: "1.55",
              marginBottom: "10px",
            },
          },
          card.why,
        )
      : null,
    (card.country || card.genres?.length)
      ? React.createElement(
          "p",
          {
            style: {
              fontSize: "13px",
              color: theme.textSecondary,
              marginBottom: "8px",
            },
          },
          [card.country, card.genres?.join(", ")].filter(Boolean).join(" · "),
        )
      : null,
    card.connection
      ? React.createElement(
          "p",
          {
            style: {
              fontSize: "13px",
              color: theme.textSecondary,
              borderTop: `1px solid ${theme.border}`,
              paddingTop: "10px",
              marginBottom: "12px",
              fontStyle: "italic",
            },
          },
          card.connection,
        )
      : React.createElement("div", { style: { marginBottom: "12px" } }),
    React.createElement(
      "div",
      { style: { display: "flex", gap: "8px", flexWrap: isMobile ? "wrap" : "nowrap" } },
      renderCardActions(card, theme, handlers),
    ),
  );
}

function StatusBanner({ actionStatus }) {
  if (!actionStatus) return null;
  const isError = actionStatus.type === "error";
  return React.createElement(
    "p",
    {
      style: {
        margin: "0 0 16px 0",
        padding: "9px 12px",
        borderRadius: "8px",
        fontSize: "13px",
        backgroundColor: isError ? "#2a1218" : "#0f2318",
        color: isError ? "#f8a8b0" : "#7dd4a8",
        border: `1px solid ${isError ? "#7a2a35" : "#2a6048"}`,
      },
    },
    actionStatus.message,
  );
}

function EmptyState({ modeValue, textSecondary, textTertiary }) {
  const isWarm = modeValue === "preference-aware";
  return React.createElement(
    "div",
    { style: { padding: "48px 0 24px", textAlign: "center" } },
    React.createElement(
      "p",
      { style: { fontSize: "15px", color: textSecondary, marginBottom: "6px", fontWeight: "500" } },
      isWarm ? "No saved preferences yet" : "Start with 1–3 bands you already like",
    ),
    React.createElement(
      "p",
      { style: { fontSize: "13px", color: textTertiary, maxWidth: "340px", margin: "0 auto", lineHeight: "1.6" } },
      isWarm
        ? "Save or rate a few artists to improve preference-aware recommendations."
        : "Describe bands or a genre — we'll find niche recommendations with clear connection notes.",
    ),
  );
}

function ChatAppView({ viewProps, handlers }) {
  const theme = getTheme(viewProps.modeValue);
  const isMobile = viewProps.viewport === "mobile";

  return React.createElement(
    "main",
    {
      style: {
        backgroundColor: theme.pageBg,
        color: theme.textPrimary,
        minHeight: "100vh",
        padding: isMobile ? "20px 16px" : "32px 24px",
        maxWidth: "760px",
        margin: "0 auto",
      },
    },
    React.createElement(
      "header",
      { style: { marginBottom: "24px" } },
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" } },
        React.createElement(
          "div",
          null,
          React.createElement(
            "h1",
            { style: { fontSize: "20px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "3px" } },
            viewProps.headerTitle,
          ),
          React.createElement(
            "p",
            { style: { fontSize: "13px", color: theme.textSecondary } },
            viewProps.headerSubtitle,
          ),
        ),
        React.createElement(ModePill, {
          modeValue: viewProps.modeValue,
          modeOptions: viewProps.modeOptions,
          onModeChange: handlers.onModeChange,
        }),
      ),
      React.createElement("hr", { style: { border: "none", borderTop: `1px solid ${theme.border}`, margin: "0" } }),
    ),
    React.createElement(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          const form = /** @type {any} */ (event.currentTarget);
          const queryInput = form.querySelector('input[name="query"]');
          handlers.onQuerySubmit(String(queryInput?.value || ""));
        },
        style: {
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: "8px",
          marginBottom: "20px",
        },
      },
      React.createElement("input", {
        name: "query",
        type: "text",
        placeholder: viewProps.queryPlaceholder,
        disabled: viewProps.queryDisabled,
        className: "query-input",
        style: {
          flex: "1",
          backgroundColor: theme.inputBg,
          color: theme.textPrimary,
          border: `1px solid ${theme.inputBorder}`,
          borderRadius: "8px",
          padding: "10px 14px",
          fontSize: "14px",
        },
      }),
      React.createElement(
        "button",
        {
          type: "submit",
          disabled: viewProps.queryDisabled,
          className: "recommend-btn",
          style: {
            backgroundColor: theme.accent,
            color: "#0a0d14",
            border: "none",
            borderRadius: "8px",
            padding: "10px 18px",
            fontWeight: "600",
            fontSize: "13px",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
          },
        },
        "Recommend",
      ),
    ),
    React.createElement(StatusBanner, { actionStatus: viewProps.actionStatus }),
    viewProps.cards.length === 0
      ? React.createElement(EmptyState, {
          modeValue: viewProps.modeValue,
          textSecondary: theme.textSecondary,
          textTertiary: theme.textTertiary,
        })
      : React.createElement(
          "section",
          { style: { display: "grid", gap: "12px" } },
          viewProps.cards.map((card) =>
            React.createElement(RecommendationCard, {
              key: card.title,
              card,
              theme,
              isMobile,
              handlers,
            }),
          ),
        ),
  );
}

module.exports = { ChatAppView };
