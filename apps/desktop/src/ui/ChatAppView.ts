import * as React from "react";
import { ObscurityTargetPicker } from "./ObscurityTargetPicker.js";
import { FeedbackReactionBar } from "./FeedbackReactionBar.js";

function getTheme(modeValue: string) {
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

function ModePill({ modeValue, modeOptions, onModeChange }: { modeValue: string; modeOptions: any[]; onModeChange: (v: string) => void }) {
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

function GenreChips({ genres, textTertiary, border }: { genres: string[] | null | undefined; textTertiary: string; border: string }) {
  if (!genres?.length) return null;
  return React.createElement(
    "div",
    { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" } },
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

function PlatformLinks({ links }: { links: any[] | null | undefined }) {
  if (!links?.length) return null;
  return React.createElement(
    "div",
    { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" } },
    links.map((link) =>
      React.createElement(
        "a",
        {
          key: link.platform,
          href: link.url,
          target: "_blank",
          rel: "noopener noreferrer",
          title: link.label,
          style: {
            fontSize: "11px",
            color: "#6b7a90",
            border: "1px solid #1e2a3a",
            borderRadius: "4px",
            padding: "2px 8px",
            textDecoration: "none",
            letterSpacing: "0.03em",
          },
        },
        link.label,
      ),
    ),
  );
}

function renderCardActions(card: any, theme: ReturnType<typeof getTheme>, handlers: any) {
  const btnStyle = {
    backgroundColor: theme.buttonBg,
    color: theme.buttonText,
    border: `1px solid ${theme.buttonBorder}`,
    borderRadius: "7px",
    padding: "6px 12px",
    fontSize: "13px",
  };
  const copyBtnStyle = {
    background: "transparent",
    border: "none",
    color: theme.textTertiary,
    fontSize: "13px",
    cursor: "pointer",
    padding: "4px 6px",
  };
  const actions: React.ReactNode[] = [];
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
  actions.push(
    React.createElement(
      "button",
      {
        key: "copy",
        type: "button",
        className: "copy-card-btn",
        style: copyBtnStyle,
        title: "Copy",
        onClick: () => handlers.onCopyCard?.(card.title, card.why),
      },
      "⎘",
    ),
  );
  return actions;
}

function RecommendationCard({ card, theme, isMobile, handlers }: { card: any; theme: ReturnType<typeof getTheme>; isMobile: boolean; handlers: any }) {
  const cardStyles = {
    article: {
      backgroundColor: theme.cardBg,
      border: `1px solid ${theme.border}`,
      borderLeft: `3px solid ${theme.accentStripe}`,
      borderRadius: "8px",
      padding: "10px",
    },
    titleRow: { display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px" },
    title: { fontSize: "15px", fontWeight: "600", color: theme.textPrimary, letterSpacing: "-0.01em" },
    savedBadge: {
      fontSize: "11px",
      color: theme.accent,
      border: `1px solid ${theme.accentDim}`,
      borderRadius: "4px",
      padding: "1px 6px",
      letterSpacing: "0.03em",
    },
    why: { fontSize: "13px", color: theme.textPrimary, fontStyle: "italic", lineHeight: "1.5", marginBottom: "6px" },
    meta: { fontSize: "13px", color: theme.textSecondary, marginBottom: "6px" },
    connection: {
      fontSize: "13px",
      color: theme.textSecondary,
      borderTop: `1px solid ${theme.border}`,
      paddingTop: "8px",
      marginBottom: "8px",
      fontStyle: "italic",
    },
    actions: { display: "flex", gap: "8px", flexWrap: (isMobile ? "wrap" : "nowrap") as any },
  };

  return React.createElement(
    "article",
    { className: "recommendation-card", style: cardStyles.article },
    card.imageUrl
      ? React.createElement("img", {
          src: card.imageUrl,
          alt: card.title,
          loading: "lazy",
          style: {
            width: "100%",
            maxHeight: "160px",
            objectFit: "cover",
            borderRadius: "6px",
            marginBottom: "10px",
          },
          onError: (e: any) => {
            e.currentTarget.style.display = "none";
          },
        })
      : null,
    React.createElement(
      "div",
      { style: cardStyles.titleRow },
      React.createElement("h2", { style: cardStyles.title }, card.title),
      card.saved
        ? React.createElement(
            "span",
            { style: cardStyles.savedBadge },
            card.rating ? `saved · ${card.rating}/5` : "saved",
          )
        : null,
    ),
    card.why ? React.createElement("p", { style: cardStyles.why }, card.why) : null,
    (card.country || card.genres?.length)
      ? React.createElement(
          "p",
          { style: cardStyles.meta },
          [card.country, card.genres?.join(", ")].filter(Boolean).join(" · "),
        )
      : null,
    React.createElement(GenreChips, {
      genres: card.genres,
      textTertiary: theme.textTertiary,
      border: theme.border,
    }),
    card.connection
      ? React.createElement("p", { style: cardStyles.connection }, card.connection)
      : React.createElement("div", { style: { marginBottom: "8px" } }),
    React.createElement(PlatformLinks, { links: card.platformLinks }),
    React.createElement("div", { style: cardStyles.actions }, renderCardActions(card, theme, handlers)),
  );
}

function SearchInProgress({ visible, theme }: { visible: boolean; theme: ReturnType<typeof getTheme> }) {
  if (!visible) return null;
  return React.createElement(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      "aria-busy": true,
      className: "search-in-progress",
      style: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "10px",
        padding: "11px 14px",
        backgroundColor: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: "8px",
        fontSize: "13px",
        color: theme.textSecondary,
        lineHeight: "1.4",
      },
    },
    React.createElement("span", {
      className: "bandsearch-spinner",
      style: { ["--spinner-accent"]: theme.accent },
      "aria-hidden": true,
    }),
    React.createElement("span", null, "Finding niche recommendations…"),
  );
}

function StatusBanner({ actionStatus }: { actionStatus: any }) {
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

function findLastAssistantWithCardsIndex(messages: any[] | null | undefined): number {
  if (!messages?.length) return -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && Array.isArray(m.cards) && m.cards.length > 0) return i;
  }
  return -1;
}

function getLatestAssistantCards(messages: any[] | null | undefined): any[] {
  const idx = findLastAssistantWithCardsIndex(messages);
  if (idx === -1) return [];
  const m = (messages as any[])[idx];
  return Array.isArray(m.cards) ? m.cards : [];
}

function DesktopResultsRail({ cards, theme, isMobile, handlers }: { cards: any[]; theme: ReturnType<typeof getTheme>; isMobile: boolean; handlers: any }) {
  if (!cards?.length) return null;
  return React.createElement(
    "aside",
    {
      className: "bandsearch-results-rail",
      style: {
        borderLeft: `1px solid ${theme.border}`,
        overflowY: "auto",
        minHeight: 0,
      },
    },
    React.createElement(
      "p",
      {
        className: "bandsearch-results-rail-title",
        style: { color: theme.textTertiary },
      },
      "Latest picks",
    ),
    React.createElement(
      "div",
      { style: { display: "grid", gap: "10px" } },
      cards.map((card) =>
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

function EmptyState({ modeValue, textSecondary, textTertiary }: { modeValue: string; textSecondary: string; textTertiary: string }) {
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

function MessageThread({ messages, theme, isMobile, handlers, assistantCardsMode = "thread" }: {
  messages: any[] | null | undefined;
  theme: ReturnType<typeof getTheme>;
  isMobile: boolean;
  handlers: any;
  assistantCardsMode?: string;
}) {
  if (!messages?.length) return null;
  const railLatest = assistantCardsMode === "rail-latest";
  const lastAssistantCardsIdx = railLatest ? findLastAssistantWithCardsIndex(messages) : -1;

  return React.createElement(
    "section",
    { className: "message-thread", style: { display: "grid", gap: "16px", marginBottom: "12px", paddingBottom: "4px" } },
    messages.map((msg, idx) => {
      if (msg.role === "user") {
        return React.createElement(
          "div",
          {
            key: msg.id || `user-${idx}`,
            className: "message-user",
            style: {
              backgroundColor: theme.accentDim,
              border: `1px solid ${theme.border}`,
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "14px",
              color: theme.textPrimary,
              alignSelf: "flex-end",
              maxWidth: "80%",
              marginLeft: "auto",
            },
          },
          msg.content,
        );
      }
      if (msg.role === "assistant") {
        const assistantText = typeof msg.content === "string" ? msg.content.trim() : "";
        const hasCards = msg.cards?.length > 0;
        const isLatestCardTurn = railLatest && hasCards && idx === lastAssistantCardsIdx;
        const isEarlierCardTurn = railLatest && hasCards && idx < lastAssistantCardsIdx;

        if (!assistantText && !hasCards) return null;

        const cardGrid = (cards: any[]) =>
          React.createElement(
            "div",
            { style: { display: "grid", gap: "10px" } },
            cards.map((card) =>
              React.createElement(RecommendationCard, {
                key: card.title,
                card,
                theme,
                isMobile,
                handlers,
              }),
            ),
          );

        const proseBlock = assistantText
          ? React.createElement(
              "div",
              {
                className: "assistant-reply",
                style: {
                  backgroundColor: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "14px",
                  color: theme.textPrimary,
                  lineHeight: "1.45",
                  maxWidth: "92%",
                },
              },
              assistantText,
            )
          : null;

        let cardsBlock: React.ReactNode = null;
        if (hasCards) {
          if (!railLatest) {
            cardsBlock = cardGrid(msg.cards);
          } else if (isLatestCardTurn) {
            cardsBlock = null;
          } else if (isEarlierCardTurn) {
            cardsBlock = React.createElement(
              "details",
              { className: "bandsearch-earlier-picks", style: { maxWidth: "100%" } },
              React.createElement(
                "summary",
                { style: { userSelect: "none" } },
                `Earlier picks (${msg.cards.length})`,
              ),
              cardGrid(msg.cards),
            );
          } else {
            cardsBlock = cardGrid(msg.cards);
          }
        }

        const railHint =
          railLatest && isLatestCardTurn && hasCards && !assistantText
            ? React.createElement(
                "p",
                {
                  style: {
                    fontSize: "13px",
                    color: theme.textSecondary,
                    margin: 0,
                    maxWidth: "92%",
                  },
                },
                "Recommendations are in the panel on the right.",
              )
            : null;

        const copyAllBlock =
          hasCards && handlers.onCopyAll
            ? React.createElement(
                "button",
                {
                  type: "button",
                  className: "copy-all-btn",
                  style: {
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: `1px solid ${theme.border}`,
                    borderRadius: "6px",
                    color: theme.textTertiary,
                    fontSize: "12px",
                    cursor: "pointer",
                    padding: "3px 10px",
                  },
                  onClick: () => {
                    const text = msg.cards
                      .map((c: any) => `${c.title}${c.why ? ` — ${c.why}` : ""}`)
                      .join("\n");
                    handlers.onCopyAll(text);
                  },
                },
                "Copy all",
              )
            : null;

        if (!proseBlock && !cardsBlock && !railHint && !copyAllBlock) return null;

        return React.createElement(
          "div",
          {
            key: msg.id || `assistant-${idx}`,
            className: "message-assistant",
            style: { display: "grid", gap: "12px" },
          },
          proseBlock,
          railHint,
          cardsBlock,
          copyAllBlock,
        );
      }
      return null;
    }),
  );
}

export function ChatAppView({ viewProps, handlers }: { viewProps: any; handlers: any }) {
  const theme = getTheme(viewProps.modeValue);
  const isMobile = viewProps.viewport === "mobile";
  const searchInFlight = viewProps.isLoading === true;

  const latestFromThread = getLatestAssistantCards(viewProps.messages);
  const legacyCards =
    !viewProps.messages && Array.isArray(viewProps.cards) && viewProps.cards.length > 0 ? viewProps.cards : [];
  const railCards = latestFromThread.length > 0 ? latestFromThread : legacyCards;
  const showRail = !isMobile && railCards.length > 0;

  return React.createElement(
    "main",
    {
      className: "bandsearch-chat-shell",
      style: {
        backgroundColor: theme.pageBg,
        color: theme.textPrimary,
        padding: isMobile ? "20px 16px 0" : "32px 24px 0",
        paddingBottom: isMobile ? "16px" : "20px",
        maxWidth: showRail ? "min(1120px, 100%)" : "760px",
        margin: "0 auto",
      },
    },
    React.createElement(
      "header",
      { style: { marginBottom: "24px", flexShrink: 0 } },
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
        React.createElement(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          React.createElement(
            "button",
            {
              type: "button",
              className: "action-btn",
              onClick: handlers.onNavigateSettings,
              style: {
                backgroundColor: theme.buttonBg,
                color: theme.buttonText,
                border: `1px solid ${theme.buttonBorder}`,
                borderRadius: "7px",
                padding: "5px 12px",
                fontSize: "12px",
              },
            },
            "Settings",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "action-btn",
              onClick: handlers.onNavigateSaved,
              style: {
                backgroundColor: theme.buttonBg,
                color: theme.buttonText,
                border: `1px solid ${theme.buttonBorder}`,
                borderRadius: "7px",
                padding: "5px 12px",
                fontSize: "12px",
              },
            },
            "Saved",
          ),
          React.createElement(ModePill, {
            modeValue: viewProps.modeValue,
            modeOptions: viewProps.modeOptions,
            onModeChange: handlers.onModeChange,
          }),
        ),
      ),
      React.createElement("hr", { style: { border: "none", borderTop: `1px solid ${theme.border}`, margin: "0" } }),
    ),
    React.createElement(
      "div",
      { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
      showRail
        ? React.createElement(
            "div",
            { className: "bandsearch-desktop-split" },
            React.createElement(
              "div",
              {
                className: "bandsearch-chat-scroll bandsearch-chat-scroll--main",
                style: { overflowY: "auto", paddingBottom: "8px" },
              },
              React.createElement(StatusBanner, { actionStatus: viewProps.actionStatus }),
              React.createElement(MessageThread, {
                messages: viewProps.messages,
                theme,
                isMobile,
                handlers,
                assistantCardsMode: "rail-latest",
              }),
              !viewProps.messages && viewProps.cards.length > 0
                ? React.createElement(
                    "p",
                    {
                      style: {
                        fontSize: "13px",
                        color: theme.textSecondary,
                        margin: "12px 0 0",
                      },
                    },
                    "Recommendations are in the panel on the right.",
                  )
                : null,
              !viewProps.messages && viewProps.cards.length === 0
                ? searchInFlight
                  ? null
                  : React.createElement(EmptyState, {
                      modeValue: viewProps.modeValue,
                      textSecondary: theme.textSecondary,
                      textTertiary: theme.textTertiary,
                    })
                : null,
            ),
            React.createElement(DesktopResultsRail, {
              cards: railCards,
              theme,
              isMobile,
              handlers,
            }),
          )
        : React.createElement(
            "div",
            {
              className: "bandsearch-chat-scroll",
              style: { flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: "8px" },
            },
            React.createElement(StatusBanner, { actionStatus: viewProps.actionStatus }),
            React.createElement(MessageThread, {
              messages: viewProps.messages,
              theme,
              isMobile,
              handlers,
              assistantCardsMode: "thread",
            }),
            viewProps.messages
              ? null
              : viewProps.cards.length === 0
              ? searchInFlight
                ? null
                : React.createElement(EmptyState, {
                    modeValue: viewProps.modeValue,
                    textSecondary: theme.textSecondary,
                    textTertiary: theme.textTertiary,
                  })
              : React.createElement(
                  "section",
                  { style: { display: "grid", gap: "8px" } },
                  viewProps.cards.map((card: any) =>
                    React.createElement(RecommendationCard, {
                      key: card.title,
                      card,
                      theme,
                      isMobile,
                      handlers,
                    }),
                  ),
                ),
          ),
    ),
    React.createElement(
      "div",
      {
        className: "bandsearch-chat-composer",
        style: {
          marginTop: "12px",
          paddingTop: "16px",
          borderTop: `1px solid ${theme.border}`,
          backgroundColor: theme.pageBg,
        },
      },
      React.createElement(SearchInProgress, { visible: searchInFlight, theme }),
      React.createElement(FeedbackReactionBar, {
        visible: viewProps.showFeedbackBar === true,
        onFeedback: (type: string) => handlers.onFeedback?.(type),
        onDismiss: () => handlers.onFeedbackDismiss?.(),
      }),
      React.createElement(ObscurityTargetPicker, {
        target: viewProps.obscurityTarget,
        onTargetChange: (target: string | undefined) => handlers.onObscurityTargetChange?.(target),
      }),
      React.createElement(
        "form",
        {
          "aria-busy": searchInFlight,
          onSubmit: (event: any) => {
            event.preventDefault();
            const form = event.currentTarget as any;
            const queryInput = form.querySelector('input[name="query"]') as any;
            const query = String(queryInput?.value || "").trim();
            if (!query || viewProps.queryDisabled) return;
            queryInput.value = "";
            handlers.onQuerySubmit(query);
          },
          style: {
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            gap: "8px",
            margin: 0,
          },
        },
        React.createElement("input", {
          name: "query",
          type: "text",
          placeholder: viewProps.queryPlaceholder,
          disabled: viewProps.queryDisabled,
          className: "query-input",
          autoComplete: "off",
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
          searchInFlight ? "Searching…" : "Recommend",
        ),
      ),
    ),
  );
}
