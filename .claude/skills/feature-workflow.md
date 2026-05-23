---
name: feature-workflow
description: >
  Structured workflow for implementing a new feature or the next roadmap step. Trigger when the
  user says "implement the next feature", "what's next on the roadmap", "start a new feature",
  "let's build X", "create a feature branch", mentions /tdd, TDD, or wants to go from idea or
  roadmap → working, committed, tested code.
---

# Feature Workflow Skill

idea/roadmap → scan → requirements → branch → phased plan → TDD loop → commit → PR

---

## Step 1: Identify What to Build

- Roadmap file exists (`ROADMAP.md`, `TODO.md`, `docs/roadmap.md`): read it, show next uncompleted item, confirm.
- User described what to build: use that.
- Neither: ask before proceeding.

---

## Step 2: Scan Codebase & Conventions

Do this before asking any questions or writing any plan.

**2a. Conventions** — read if present: `CLAUDE.md`, `.cursorrules`, `CONVENTIONS.md`, `CONTRIBUTING.md`, README arch sections. Extract: naming, folder structure, test framework, import style, linting. These are non-negotiable.

**2b. Structure**
```bash
find . -type f | grep -vE 'node_modules|\.git|dist' | head -80
```

**2c. Affected modules** — identify files this feature will touch. Read the most relevant ones. Note: public interfaces that may change, shared utilities, established patterns (error handling, data fetching, test structure).

**2d. Baseline test status** — run the test suite now.
```bash
# npm test / pytest / go test ./... / cargo test
```
If red: stop, tell the user, do not proceed until green.

Summarise to user: conventions found, affected modules, baseline status.

---

## Step 3: Requirements Gathering

Ask everything in one message — no drip-feeding. Skip what the codebase scan already answered.

- **Scope:** what it does / doesn't do; acceptance criteria; non-goals
- **Data & contracts:** input/output shapes + example values; API contracts; existing data structures touched
- **Edge cases & errors:** invalid input; failure modes; race conditions; retry/fallback needs
- **Integration:** public interface changes; new dependencies
- **Performance:** latency/throughput/memory constraints; platform constraints
- **Security:** user data, auth, permissions; sanitisation needs

Wait for answers before proceeding.

---

## Step 4: Create Feature Branch

Propose branch name, then create:
```bash
git checkout -b feature/<short-kebab-description>
```

---

## Step 5: Implementation Plan

Break into distinct phases. Reference actual file paths from the scan. Flag each phase:
- 🟢 new/isolated code
- 🟡 touches existing logic or shared utilities
- 🔴 changes public interfaces or shared state — gets extra refactor scrutiny + detailed commit body

```
Phase 1: <title> 🟢/🟡/🔴
  - What gets built
  - Files affected
  - Depends on: <phases or modules>
  - Commit: "feat(<scope>): <description>"
```

Confirm with user before starting.

---

## Step 6: TDD Loop (repeat per phase)

**6a. Baseline** — run full test suite. If red, fix before adding anything new.

**6b. Red** — write failing tests for this phase's behaviour. Follow project test patterns. Run and confirm failure. Show output before implementing.

**6c. Green** — minimum implementation to pass tests. Follow project conventions. Run and confirm passing. No over-engineering.

**6d. Refactor** — improve clarity, naming, duplication. For 🔴 phases: check interface compatibility and callers. Run tests — must stay green.

**6e. Commit**
```bash
git add -A
git commit -m "feat(<scope>): <description>
# For 🟡/🔴: add body — why this approach, alternatives considered, known gaps"
```
Prefixes: `feat` / `fix` / `refactor` / `test` / `chore`

**6f. Post-phase** — output: `✅ Phase N done — <what changed>. Remaining: X, Y, Z.`

---

## Step 7: Wrap-Up

**TODO scan**
```bash
git diff main --unified=0 | grep -E '^\+.*(TODO|FIXME|HACK|XXX)'
```
Surface any found — resolve or track deliberately.

**Commit log**
```bash
git log main..HEAD --oneline
```

**PR description** — draft covering: what & why, approach & key decisions, phases, testing, known gaps.

**Next item** — if roadmap was read, show what comes next.

---

## Principles

- **Read before planning.** Never plan without understanding the existing code.
- **Green baseline always.** Never build on a failing test suite.
- **Red → Green → Refactor.** Never implement before a failing test exists. Never commit without refactoring.
- **One phase = one commit.** Clean, bisectable history.
- **Conventions are law.** Match the codebase exactly — naming, structure, patterns.
