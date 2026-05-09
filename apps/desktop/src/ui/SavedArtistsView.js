const React = require("react");

const theme = {
  pageBg: "#0d0f14",
  cardBg: "#111827",
  border: "#1e2a3a",
  textPrimary: "#f0f4f8",
  textSecondary: "#8896a8",
  textTertiary: "#5a6880",
  accent: "#7aa7d9",
  accentDim: "#1c2d42",
  buttonBg: "#161e2e",
  buttonBorder: "#243044",
  buttonText: "#c8d4e8",
};

function SavedArtistItem({ artist, handlers }) {
  const itemStyles = {
    li: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      backgroundColor: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderLeft: `3px solid ${artist.isSelected ? theme.accent : theme.border}`,
      borderRadius: "8px",
    },
    name: { fontSize: "14px", fontWeight: "600", color: theme.textPrimary },
    meta: { fontSize: "12px", color: theme.textSecondary, marginTop: "2px" },
    actions: { display: "flex", gap: "6px", alignItems: "center" },
    tickBtn: {
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      border: `1px solid ${artist.isSelected ? theme.accent : theme.border}`,
      backgroundColor: artist.isSelected ? theme.accentDim : "transparent",
      color: artist.isSelected ? theme.accent : theme.textTertiary,
      fontSize: "14px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
    },
    deleteBtn: {
      background: "transparent",
      border: "none",
      color: theme.textTertiary,
      fontSize: "13px",
      cursor: "pointer",
      padding: "4px 8px",
    },
  };

  const ratingText = artist.rating ? `${artist.rating}/5` : null;
  const tagsText = artist.categoryTags?.length ? artist.categoryTags.join(", ") : null;
  const metaParts = [ratingText, tagsText].filter(Boolean).join(" · ");

  return React.createElement(
    "li",
    { style: itemStyles.li },
    React.createElement(
      "div",
      null,
      React.createElement("p", { style: itemStyles.name }, artist.name),
      metaParts
        ? React.createElement("p", { style: itemStyles.meta }, metaParts)
        : null,
    ),
    React.createElement(
      "div",
      { style: itemStyles.actions },
      React.createElement(
        "button",
        {
          type: "button",
          className: "tick-btn",
          style: itemStyles.tickBtn,
          onClick: () => handlers.onToggleSelection?.(artist.id),
          title: "Use as style reference",
        },
        artist.isSelected ? "✓" : "○",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          style: itemStyles.deleteBtn,
          onClick: () => handlers.onDelete(artist.id),
        },
        "×",
      ),
    ),
  );
}

function SavedArtistsView({ viewProps, handlers }) {
  const styles = {
    page: {
      backgroundColor: theme.pageBg,
      color: theme.textPrimary,
      minHeight: "100vh",
      padding: "32px 24px",
      maxWidth: "760px",
      margin: "0 auto",
    },
    header: { marginBottom: "24px" },
    headerRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "16px",
    },
    title: { fontSize: "20px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "3px" },
    subtitle: { fontSize: "13px", color: theme.textSecondary },
    backBtn: {
      backgroundColor: theme.buttonBg,
      color: theme.buttonText,
      border: `1px solid ${theme.buttonBorder}`,
      borderRadius: "7px",
      padding: "6px 14px",
      fontSize: "13px",
      cursor: "pointer",
    },
    divider: { border: "none", borderTop: `1px solid ${theme.border}`, margin: "0" },
    list: { display: "grid", gap: "8px", marginTop: "20px" },
    empty: {
      padding: "48px 0 24px",
      textAlign: "center",
      fontSize: "14px",
      color: theme.textSecondary,
    },
  };

  const { artists = [], header, isLoading } = viewProps;

  return React.createElement(
    "main",
    { style: styles.page },
    React.createElement(
      "header",
      { style: styles.header },
      React.createElement(
        "div",
        { style: styles.headerRow },
        React.createElement(
          "div",
          null,
          React.createElement("h1", { style: styles.title }, header.title),
          React.createElement("p", { style: styles.subtitle }, header.subtitle),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            style: styles.backBtn,
            onClick: () => handlers.onNavigate("chat"),
          },
          "← Recommendations",
        ),
      ),
      React.createElement("hr", { style: styles.divider }),
    ),
    isLoading
      ? React.createElement("p", { style: styles.empty }, "Loading…")
      : artists.length === 0
        ? React.createElement("p", { style: styles.empty }, "No saved artists yet. Save artists from recommendation cards.")
        : React.createElement(
            "ul",
            { style: { ...styles.list, listStyle: "none", padding: "0", margin: "0" } },
            artists.map((artist) =>
              React.createElement(SavedArtistItem, { key: artist.id, artist, handlers }),
            ),
          ),
  );
}

module.exports = { SavedArtistsView };
