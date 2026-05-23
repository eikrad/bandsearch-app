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
          onClick: () => handlers.onDelete?.(artist.id),
        },
        "×",
      ),
    ),
  );
}

function SearchResultItem({ result, handlers }) {
  const styles = {
    li: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      backgroundColor: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
    },
    name: { fontSize: "13px", fontWeight: "600", color: theme.textPrimary },
    disambiguation: { fontSize: "12px", color: theme.textSecondary, marginTop: "2px" },
    addBtn: {
      backgroundColor: theme.accentDim,
      color: theme.accent,
      border: `1px solid ${theme.accent}`,
      borderRadius: "6px",
      padding: "4px 10px",
      fontSize: "12px",
      cursor: "pointer",
      flexShrink: 0,
    },
  };

  return React.createElement(
    "li",
    { style: styles.li },
    React.createElement(
      "div",
      null,
      React.createElement("p", { style: styles.name }, result.name),
      result.disambiguation
        ? React.createElement("p", { style: styles.disambiguation }, result.disambiguation)
        : null,
    ),
    React.createElement(
      "button",
      {
        type: "button",
        style: styles.addBtn,
        onClick: () => handlers.onAddArtist?.({ id: result.id, name: result.name }),
      },
      "Add",
    ),
  );
}

function SearchResultsList({ results, handlers }) {
  const listStyle = { display: "grid", gap: "6px", listStyle: "none", padding: "0", margin: "0" };
  return React.createElement(
    "ul",
    { style: listStyle },
    results.map((result) =>
      React.createElement(SearchResultItem, { key: result.id, result, handlers }),
    ),
  );
}

function SearchSection({ searchResults, isSearching, handlers }) {
  const styles = {
    section: { marginTop: "20px" },
    sectionTitle: { fontSize: "13px", fontWeight: "600", color: theme.textSecondary, marginBottom: "8px" },
    row: { display: "flex", gap: "8px", marginBottom: "12px" },
    input: {
      flex: 1,
      backgroundColor: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "7px",
      padding: "7px 12px",
      fontSize: "13px",
      color: theme.textPrimary,
      outline: "none",
    },
    searchBtn: {
      backgroundColor: theme.buttonBg,
      color: theme.buttonText,
      border: `1px solid ${theme.buttonBorder}`,
      borderRadius: "7px",
      padding: "7px 14px",
      fontSize: "13px",
      cursor: "pointer",
    },
    hint: { fontSize: "12px", color: theme.textTertiary },
  };

  return React.createElement(
    "section",
    { style: styles.section },
    React.createElement("p", { style: styles.sectionTitle }, "Add artist"),
    React.createElement(
      "form",
      {
        style: styles.row,
        onSubmit: (e) => {
          e.preventDefault();
          const q = e.target.elements["artist-search"].value.trim();
          if (q) handlers.onSearch?.(q);
        },
      },
      React.createElement("input", {
        type: "text",
        name: "artist-search",
        placeholder: "Search MusicBrainz…",
        style: styles.input,
        autoComplete: "off",
      }),
      React.createElement(
        "button",
        { type: "submit", style: styles.searchBtn },
        "Search",
      ),
    ),
    isSearching
      ? React.createElement("p", { style: styles.hint }, "Searching…")
      : searchResults.length > 0
        ? React.createElement(SearchResultsList, { results: searchResults, handlers })
        : null,
  );
}

function SelectionBar({ selectedCount, handlers }) {
  const styles = {
    bar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 14px",
      backgroundColor: theme.accentDim,
      border: `1px solid ${theme.accent}`,
      borderRadius: "8px",
      marginTop: "16px",
    },
    label: { fontSize: "13px", color: theme.accent },
    btn: {
      backgroundColor: theme.accent,
      color: "#0d0f14",
      border: "none",
      borderRadius: "6px",
      padding: "5px 12px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
    },
  };

  return React.createElement(
    "div",
    { style: styles.bar },
    React.createElement("span", { style: styles.label }, `${selectedCount} selected`),
    React.createElement(
      "button",
      {
        type: "button",
        style: styles.btn,
        onClick: () => handlers.onActivateStyleRef?.(),
      },
      "Use as style reference",
    ),
  );
}

function GroupSection({ group, artists, handlers }) {
  const memberArtists = artists.filter((a) => group.memberIds.includes(a.id));
  const styles = {
    section: { marginTop: "20px" },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px",
    },
    title: { fontSize: "13px", fontWeight: "600", color: theme.textSecondary },
    deleteBtn: {
      background: "transparent",
      border: "none",
      color: theme.textTertiary,
      fontSize: "12px",
      cursor: "pointer",
      padding: "2px 6px",
    },
    list: { display: "grid", gap: "6px", listStyle: "none", padding: "0", margin: "0" },
    empty: { fontSize: "12px", color: theme.textTertiary, padding: "6px 0" },
  };

  return React.createElement(
    "section",
    { style: styles.section },
    React.createElement(
      "div",
      { style: styles.header },
      React.createElement("p", { style: styles.title }, group.name),
      React.createElement(
        "button",
        { type: "button", style: styles.deleteBtn, onClick: () => handlers.onDeleteGroup?.(group.id) },
        "×",
      ),
    ),
    memberArtists.length === 0
      ? React.createElement("p", { style: styles.empty }, "No artists in this group")
      : React.createElement(
          "ul",
          { style: styles.list },
          memberArtists.map((artist) =>
            React.createElement(SavedArtistItem, { key: artist.id, artist, handlers }),
          ),
        ),
  );
}

function GroupsSection({ groups, artists, handlers }) {
  const styles = {
    section: { marginTop: "24px" },
    toolbar: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" },
    autoBtn: {
      backgroundColor: theme.buttonBg,
      color: theme.buttonText,
      border: `1px solid ${theme.buttonBorder}`,
      borderRadius: "7px",
      padding: "6px 12px",
      fontSize: "12px",
      cursor: "pointer",
    },
    createInput: {
      flex: 1,
      backgroundColor: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderRadius: "7px",
      padding: "6px 10px",
      fontSize: "12px",
      color: theme.textPrimary,
      outline: "none",
    },
    createBtn: {
      backgroundColor: theme.buttonBg,
      color: theme.buttonText,
      border: `1px solid ${theme.buttonBorder}`,
      borderRadius: "7px",
      padding: "6px 10px",
      fontSize: "12px",
      cursor: "pointer",
    },
    divider: { border: "none", borderTop: `1px solid ${theme.border}`, margin: "16px 0 0" },
  };

  return React.createElement(
    "section",
    { style: styles.section },
    React.createElement("hr", { style: styles.divider }),
    React.createElement(
      "div",
      { style: { ...styles.toolbar, marginTop: "16px" } },
      React.createElement(
        "button",
        { type: "button", style: styles.autoBtn, onClick: () => handlers.onAutoGroup?.() },
        "Group by genre",
      ),
      React.createElement(
        "form",
        {
          style: { display: "flex", gap: "6px", flex: 1 },
          onSubmit: (e) => {
            e.preventDefault();
            const input = e.target.elements["create-group"];
            const name = input.value.trim();
            if (name) {
              handlers.onCreateGroup?.(name);
              input.value = "";
            }
          },
        },
        React.createElement("input", {
          type: "text",
          name: "create-group",
          placeholder: "New group name…",
          style: styles.createInput,
          autoComplete: "off",
        }),
        React.createElement(
          "button",
          { type: "submit", style: styles.createBtn },
          "Create",
        ),
      ),
    ),
    groups.map((group) =>
      React.createElement(GroupSection, { key: group.id, group, artists, handlers }),
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

  const { artists = [], header, isLoading, searchResults = [], isSearching = false, selectedCount = 0, groups = [] } = viewProps;

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
          "div",
          { style: { display: "flex", gap: "8px", alignItems: "center" } },
          React.createElement(
            "button",
            {
              type: "button",
              style: styles.backBtn,
              onClick: () => handlers.onExport?.(),
            },
            "Export",
          ),
          React.createElement(
            "label",
            {
              style: { ...styles.backBtn, cursor: "pointer", display: "inline-block" },
            },
            "Import",
            React.createElement("input", {
              type: "file",
              accept: ".json,application/json",
              style: { display: "none" },
              onChange: (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                handlers.onImportFile?.(file);
                e.target.value = "";
              },
            }),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              style: styles.backBtn,
              onClick: () => handlers.onNavigate?.("chat"),
            },
            "← Recommendations",
          ),
        ),
      ),
      React.createElement("hr", { style: styles.divider }),
    ),
    React.createElement(SearchSection, { searchResults, isSearching, handlers }),
    selectedCount > 0
      ? React.createElement(SelectionBar, { selectedCount, handlers })
      : null,
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
    React.createElement(GroupsSection, { groups, artists, handlers }),
  );
}

module.exports = { SavedArtistsView };
