const React = require("react");

function getTheme(modeValue) {
  const isPreferenceAware = modeValue === "preference-aware";
  return {
    pageBg: "#0d0f14",
    panelBg: "#141925",
    cardBg: "#191f2c",
    border: "#2a3346",
    textPrimary: "#f3f5f8",
    textSecondary: "#aeb8cc",
    accent: isPreferenceAware ? "#d7a870" : "#7aa7d9",
    accentSoft: isPreferenceAware ? "#2d241a" : "#1c2738",
    buttonBg: "#232b3d",
    buttonText: "#e8edf7",
    inputBg: "#111625",
  };
}

function renderCardActions(card, handlers) {
  const actions = [];
  if (card.actions?.save?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "save", type: "button", onClick: () => handlers.onSave(card.title) },
        "Save",
      ),
    );
  }
  if (card.actions?.rate?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "rate", type: "button", onClick: () => handlers.onRate(card.title) },
        "Rate",
      ),
    );
  }
  if (card.actions?.more?.visible) {
    actions.push(
      React.createElement(
        "button",
        { key: "more", type: "button", onClick: () => handlers.onMore(card.title) },
        "More",
      ),
    );
  }
  return actions;
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
        padding: "20px",
        fontFamily: "Inter, Segoe UI, Roboto, Arial, sans-serif",
      },
    },
    React.createElement(
      "header",
      {
        style: {
          marginBottom: "16px",
          borderBottom: `1px solid ${theme.border}`,
          paddingBottom: "12px",
        },
      },
      React.createElement("h1", { style: { margin: "0 0 6px 0", letterSpacing: "0.2px" } }, viewProps.headerTitle),
      React.createElement(
        "p",
        { style: { margin: "0 0 8px 0", color: theme.textSecondary } },
        viewProps.headerSubtitle,
      ),
      React.createElement(
        "span",
        {
          style: {
            display: "inline-block",
            backgroundColor: theme.accentSoft,
            color: theme.accent,
            border: `1px solid ${theme.accent}`,
            borderRadius: "999px",
            padding: "4px 10px",
            fontSize: "12px",
          },
        },
        viewProps.modeValue,
      ),
    ),
    React.createElement(
      "label",
      { style: { display: "block", marginBottom: "12px", color: theme.textSecondary } },
      "Mode",
      React.createElement(
        "select",
        {
          value: viewProps.modeValue,
          onChange: (event) => handlers.onModeChange(event.target.value),
          style: {
            marginLeft: "8px",
            backgroundColor: theme.panelBg,
            color: theme.textPrimary,
            border: `1px solid ${theme.border}`,
            borderRadius: "8px",
            padding: "6px 10px",
          },
        },
        viewProps.modeOptions.map((option) =>
          React.createElement("option", { key: option.value, value: option.value }, option.label),
        ),
      ),
    ),
    React.createElement(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          /** @type {any} */ const form = event.currentTarget;
          /** @type {any} */ const queryInput = form.querySelector('input[name="query"]');
          handlers.onQuerySubmit(String(queryInput?.value || ""));
        },
        style: {
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: "10px",
          marginBottom: "16px",
        },
      },
      React.createElement("input", {
        name: "query",
        type: "text",
        placeholder: viewProps.queryPlaceholder,
        disabled: viewProps.queryDisabled,
        style: {
          flex: isMobile ? "initial" : "1",
          backgroundColor: theme.inputBg,
          color: theme.textPrimary,
          border: `1px solid ${theme.border}`,
          borderRadius: "10px",
          padding: "10px 12px",
        },
      }),
      React.createElement(
        "button",
        {
          type: "submit",
          disabled: viewProps.queryDisabled,
          style: {
            backgroundColor: theme.accent,
            color: "#10131a",
            border: "none",
            borderRadius: "10px",
            padding: "10px 14px",
            fontWeight: "600",
          },
        },
        "Recommend",
      ),
    ),
    viewProps.cards.length === 0
      ? React.createElement("p", { style: { color: theme.textSecondary } }, viewProps.emptyText)
      : React.createElement(
          "section",
          { style: { display: "grid", gap: "12px" } },
          viewProps.cards.map((card) =>
            React.createElement(
              "article",
              {
                key: card.title,
                style: {
                  backgroundColor: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: "12px",
                  padding: "12px",
                },
              },
              React.createElement("h2", { style: { margin: "0 0 8px 0" } }, card.title),
              React.createElement("p", { style: { margin: "0 0 8px 0" } }, card.why),
              card.country
                ? React.createElement(
                    "p",
                    { style: { margin: "0 0 6px 0", color: theme.textSecondary } },
                    `Country: ${card.country}`,
                  )
                : null,
              card.genres?.length
                ? React.createElement(
                    "p",
                    { style: { margin: "0 0 6px 0", color: theme.textSecondary } },
                    `Genres: ${card.genres.join(", ")}`,
                  )
                : null,
              card.connection
                ? React.createElement(
                    "p",
                    { style: { margin: "0 0 10px 0", color: theme.textSecondary } },
                    `Connection: ${card.connection}`,
                  )
                : null,
              React.createElement(
                "div",
                { style: { display: "flex", gap: "8px", flexWrap: isMobile ? "wrap" : "nowrap" } },
                renderCardActions(card, handlers).map((actionNode) =>
                  React.cloneElement(actionNode, {
                    style: {
                      backgroundColor: theme.buttonBg,
                      color: theme.buttonText,
                      border: `1px solid ${theme.border}`,
                      borderRadius: "8px",
                      padding: "6px 10px",
                    },
                  }),
                ),
              ),
            ),
          ),
        ),
  );
}

module.exports = {
  ChatAppView,
};
