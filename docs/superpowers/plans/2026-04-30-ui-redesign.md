# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign ChatAppView.js to match the editorial/atmospheric design guidelines — fixing the broken Mode dropdown, improving typographic hierarchy, and polishing cards and interactions.

**Architecture:** Add a `public/styles.css` for global reset and pseudo-class states (hover, focus) that can't be done inline. Rewrite `ChatAppView.js` inline styles to match the spec. No new dependencies — esbuild already bundles JS and the CSS is loaded directly from `index.html`.

**Tech Stack:** React 19 (createElement), esbuild, plain CSS

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/desktop/public/styles.css` | CREATE | Global reset, hover/focus states, scrollbar |
| `apps/desktop/public/index.html` | MODIFY | Add `<link>` to styles.css |
| `apps/desktop/src/ui/ChatAppView.js` | MODIFY | Full component redesign |

---

### Task 1: Global CSS reset and interaction states

**Files:**
- Create: `apps/desktop/public/styles.css`
- Modify: `apps/desktop/public/index.html`

No JS test possible for CSS — verification is visual + build succeeds.

- [ ] **Step 1: Create `apps/desktop/public/styles.css`**

```css
*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: #0d0f14;
  color: #f0f4f8;
  font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, p {
  margin: 0;
}

button {
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}

input {
  font-family: inherit;
  font-size: 14px;
  outline: none;
}

/* Mode pill toggle */
.mode-pill {
  display: inline-flex;
  align-items: center;
  background: #111827;
  border: 1px solid #1e2a3a;
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}

.mode-pill button {
  border: none;
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  transition: background 0.15s, color 0.15s;
  background: transparent;
  color: #6b7a90;
}

.mode-pill button.active-fresh {
  background: #1c2d42;
  color: #7aa7d9;
}

.mode-pill button.active-warm {
  background: #2d2318;
  color: #d7a870;
}

.mode-pill button:not(.active-fresh):not(.active-warm):hover {
  color: #aeb8cc;
}

/* Query input focus */
.query-input:focus {
  border-color: #3a5070 !important;
  box-shadow: 0 0 0 2px rgba(90, 150, 210, 0.12);
}

/* Action buttons */
.action-btn {
  transition: background 0.12s, border-color 0.12s;
}

.action-btn:hover {
  background: #2d374f !important;
  border-color: #3a4a63 !important;
}

.action-btn:focus-visible {
  outline: 2px solid #7aa7d9;
  outline-offset: 2px;
}

/* Recommend button */
.recommend-btn:hover {
  filter: brightness(1.1);
}

.recommend-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #0d0f14; }
::-webkit-scrollbar-thumb { background: #2a3346; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3a4a63; }
```

- [ ] **Step 2: Update `apps/desktop/public/index.html` to link the stylesheet**

Replace the entire file with:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bandsearch</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./bundle.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build --workspace @bandsearch/desktop
```

Expected output: `build complete`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/public/styles.css apps/desktop/public/index.html
git commit -m "feat: add global CSS reset and interaction states for UI redesign"
```

---

### Task 2: Redesign ChatAppView.js

**Files:**
- Modify: `apps/desktop/src/ui/ChatAppView.js`

- [ ] **Step 1: Verify existing tests pass before touching anything**

```bash
npm run test --workspace @bandsearch/desktop
```

Expected: 23 tests pass.

- [ ] **Step 2: Replace ChatAppView.js with the redesigned version**

Replace the entire file `apps/desktop/src/ui/ChatAppView.js` with:

```js
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

function GenreChips({ genres, textTertiary, border }) {
  if (!genres?.length) return null;
  return React.createElement(
    "div",
    { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" } },
    genres.map((g) =>
      React.createElement(
        "span",
        {
          key: g,
          style: {
            fontSize: "11px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: textTertiary,
            border: `1px solid ${border}`,
            borderRadius: "4px",
            padding: "2px 7px",
          },
        },
        g,
      ),
    ),
  );
}

function RecommendationCard({ card, theme, isMobile, handlers }) {
  const statusColor = card.saved ? theme.accent : null;
  return React.createElement(
    "article",
    {
      style: {
        backgroundColor: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderLeft: `3px solid ${theme.accentStripe}`,
        borderRadius: "10px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "0",
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
    React.createElement(
      "p",
      {
        style: {
          fontSize: "13px",
          color: theme.textSecondary,
          marginBottom: card.genres?.length ? "8px" : "10px",
        },
      },
      [card.country, card.genres?.join(", ")].filter(Boolean).join(" · "),
    ),
    React.createElement(GenreChips, {
      genres: card.genres,
      textTertiary: theme.textTertiary,
      border: theme.border,
    }),
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

function renderCardActions(card, theme, handlers) {
  const actions = [];
  const btnStyle = {
    backgroundColor: theme.buttonBg,
    color: theme.buttonText,
    border: `1px solid ${theme.buttonBorder}`,
    borderRadius: "7px",
    padding: "6px 12px",
    fontSize: "13px",
  };
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
        "···",
      ),
    );
  }
  return actions;
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
    // Header
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
    // Query form
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
    // Status banner
    React.createElement(StatusBanner, { actionStatus: viewProps.actionStatus }),
    // Cards or empty state
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
```

- [ ] **Step 3: Run tests to verify nothing broke**

```bash
npm run test --workspace @bandsearch/desktop
```

Expected: 23 tests pass. The tests use JSDOM which doesn't care about className — they test logic and prop passing, not visual rendering.

- [ ] **Step 4: Rebuild the bundle**

```bash
npm run build --workspace @bandsearch/desktop
```

Expected: `build complete`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ui/ChatAppView.js
git commit -m "feat: redesign ChatAppView — pill toggle, card hierarchy, editorial typography"
```

---

### Task 3: Copy styles.css into dist on build

The build script currently only bundles JS and copies `index.html`. It must also copy `styles.css` so the built app finds it.

**Files:**
- Modify: `apps/desktop/scripts/build.js`

- [ ] **Step 1: Update build script to copy styles.css**

Replace `apps/desktop/scripts/build.js` with:

```js
const esbuild = require("esbuild");
const fs = require("node:fs");

const config = {
  entryPoints: ["src/browserEntry.js"],
  bundle: true,
  outfile: "dist/bundle.js",
  platform: "browser",
};

async function run() {
  const watch = process.argv.includes("--watch");
  fs.mkdirSync("dist", { recursive: true });
  fs.copyFileSync("public/index.html", "dist/index.html");
  fs.copyFileSync("public/styles.css", "dist/styles.css");

  if (watch) {
    const ctx = await esbuild.context({ ...config, sourcemap: true });
    await ctx.watch();
    console.log("watching for changes…");
  } else {
    await esbuild.build({ ...config, minify: true });
    console.log("build complete");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run build and verify dist/ has all three files**

```bash
npm run build --workspace @bandsearch/desktop && ls apps/desktop/dist/
```

Expected output includes: `bundle.js  index.html  styles.css`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/scripts/build.js
git commit -m "chore: copy styles.css to dist as part of frontend build"
```

---

## Verification

After all tasks:

```bash
# All tests still green
npm test

# dist/ has all three files
ls apps/desktop/dist/
# → bundle.js  index.html  styles.css

# Launch the app and verify visually:
# - Mode pill toggle (Fresh | Preference-aware) in header top-right
# - No white select box
# - Cards have left accent stripe
# - Readable typography hierarchy
# npm run desktop
```
