---
name: feature-workflow
description: >
  Structured workflow for implementing a new feature or the next roadmap step. Trigger this skill
  whenever the user says things like "implement the next feature", "what's next on the roadmap",
  "start a new feature", "next roadmap item", "let's build X", "create a feature branch", or
  pastes a description of something they want to build. Also trigger when the user mentions /tdd,
  TDD, feature branch, or asks Claude to make a plan before coding. Always use this skill when
  the user wants to go from idea or roadmap → working, committed, tested code.
---

# Feature Workflow Skill

A disciplined, phase-based workflow for implementing features: from idea or roadmap → branch →
codebase scan → thorough requirements gathering → phased plan → TDD implementation → refactor →
commit, repeat → PR description.

---

## Step 1: Identify What to Build

**If a roadmap file exists** (e.g. `ROADMAP.md`, `TODO.md`, `docs/roadmap.md`), read it and
identify the next uncompleted item. Show the user what you found and confirm before proceeding.

**If the user described what they want to build**, work from that description.

**If neither**, ask the user what they want to build before going further.

---

## Step 2: Scan the Codebase & Conventions

Before asking any questions or writing any plan, ground yourself in the actual project.

### 2a. Read conventions
Look for and read any of:
- `CLAUDE.md`, `.cursorrules`, `CONVENTIONS.md`, `CONTRIBUTING.md`, `.editorconfig`
- README sections on architecture, testing, or coding standards

If found, extract and note: naming conventions, folder structure, test framework and patterns,
import style, linting rules. These are non-negotiable — the plan must follow them.

### 2b. Scan project structure
```bash
find . -type f | grep -v node_modules | grep -v .git | grep -v dist | head -80
```
Get a feel for: folder layout, language/framework in use, where tests live, config files present.

### 2c. Identify affected modules
Based on what needs to be built, identify which existing files/modules this feature will likely
touch or extend. Read the most relevant ones. Note:
- Public interfaces that might change
- Shared utilities this feature will use
- Patterns already established that should be followed (e.g. how errors are handled, how data
  is fetched, how tests are structured)

### 2d. Check baseline test status
Run the existing test suite before touching anything:
```bash
# detect and run — e.g. npm test / pytest / go test ./... / cargo test
```
If tests are **already failing**, stop and tell the user. Do not proceed until the baseline is
green. Starting from a red baseline makes it impossible to know what you broke.

Summarise findings to the user: conventions found, affected modules, baseline status.

---

## Step 3: Extensive Requirements Gathering

Now that you know the codebase, ask targeted questions. Ask in one structured message — don't
drip-feed one question at a time. Skip questions already answered by the codebase scan.

### Scope & behaviour
- What exactly does this feature do? What does it *not* do?
- What are the acceptance criteria — how will we know it's done?
- Any explicit non-goals or out-of-scope items?

### Data & contracts
- What are the input data shapes / types? Example values?
- What are the output data shapes / types?
- Any API contracts (endpoints, function signatures, events) that must be respected?
- What existing data structures does this interact with?

### Edge cases & error handling
- What happens with invalid, missing, or malformed input?
- Race conditions, concurrent access, or ordering concerns?
- What are the failure modes, and how should each be handled?
- Retry, fallback, or graceful-degradation requirements?

### Integration & dependencies
- Does this change any public interfaces other code depends on?
- Any new external dependencies needed?

### Performance & constraints
- Latency, throughput, or memory requirements?
- Platform, browser, or runtime constraints?

### Security & auth
- Does this touch user data, authentication, or permissions?
- Input sanitisation or output encoding concerns?

Wait for the user's answers before proceeding.

---

## Step 4: Create the Feature Branch

```bash
git checkout -b feature/<short-kebab-case-description>
```

Propose the branch name to the user before creating it. Keep it short, lowercase, hyphenated.

---

## Step 5: Write the Implementation Plan

Break the feature into **distinct phases**. Use your codebase knowledge to make phases concrete —
reference actual files, functions, and patterns from the project.

For each phase, flag its risk level:
- 🟢 **Low risk** — new code, isolated change
- 🟡 **Medium risk** — touches existing logic or shared utilities
- 🔴 **High risk** — changes public interfaces, shared state, or complex existing logic

High-risk phases get extra scrutiny in the refactor step and a detailed commit body.

Also produce a **dependency map**: which existing modules does each phase touch, and in what order
must phases be executed to avoid blockers?

Present the plan in this format:

```
Phase 1: <title> 🟢/🟡/🔴
  - What gets built
  - Files affected (specific paths)
  - Depends on: (prior phases or existing modules)
  - Commit: "feat(<scope>): <description>"

Phase 2: <title>
  ...
```

Ask the user to confirm or adjust before starting.

---

## Step 6: Execute Each Phase (TDD Loop)

For **each phase**, follow this exact sequence — no skipping steps.

### 6a. Pre-phase baseline check
Run the full test suite. If anything is red, fix it before adding new tests. Never layer new
work on top of a broken baseline.

### 6b. Write failing tests first (Red)
- Write tests describing the behaviour this phase should produce
- Follow the project's existing test patterns and file structure (from Step 2)
- Run tests — confirm they **fail**
- Show the user the failing output before writing any implementation

### 6c. Implement to make tests pass (Green)
- Write the minimum implementation to make tests pass
- Follow project conventions strictly (naming, structure, error handling patterns)
- Run tests — confirm they **pass**
- Do not over-engineer; implement exactly what the tests require

### 6d. Refactor
- Review for clarity, duplication, naming, and structure
- For 🔴 high-risk phases: explicitly check interface compatibility, side effects, and whether
  any callers of changed code need updating
- Refactor without changing behaviour
- Run tests again — confirm still green

### 6e. Commit
Stage and commit with a conventional commit message. For 🟡/🔴 phases, include a body:

```bash
git add -A
git commit -m "feat(<scope>): <short description>

<Why this approach was chosen. What alternatives were considered.
Any known limitations or follow-up items.>"
```

Type prefixes: `feat:` / `fix:` / `refactor:` / `test:` / `chore:`

### 6f. Post-phase summary
After each commit, output a one-liner:
> ✅ Phase N complete — <what changed>. Remaining: Phase X, Y, Z.

Then move to the next phase.

---

## Step 7: Final Wrap-Up

### 7a. TODO/FIXME scan
Before declaring done, scan for anything introduced during this session:
```bash
git diff main --unified=0 | grep -E '^\+.*(TODO|FIXME|HACK|XXX)'
```
Surface any found to the user. They should either be resolved or tracked deliberately.

### 7b. Commit log
```bash
git log main..HEAD --oneline
```
Show the full list of commits made during this session.

### 7c. PR description
Draft a pull request description, ready to paste:

```
## What this PR does
<1-2 sentence summary>

## Motivation
<Why this feature was needed>

## Implementation approach
<Key decisions made, patterns used, anything a reviewer should know>

## Phases
<List of phases with their commit messages>

## Testing
<How this was tested, what edge cases are covered>

## Known limitations / follow-up
<Anything deliberately left out of scope or that should be a follow-up>
```

### 7d. Next roadmap item
If a roadmap file was read in Step 1, show the user what comes next after this item.

---

## Principles

- **Read before you plan.** Never plan in a vacuum — understand the existing code first.
- **Green baseline before starting.** Never build on a red test suite.
- **Never skip the questions.** Surface assumptions early, not mid-implementation.
- **Never write implementation before failing tests exist.** Red → Green → Refactor, always.
- **Never commit a failing test suite.**
- **One phase = one commit.** Keep history clean and bisectable.
- **Refactor is mandatory.** Not optional. Every phase, before every commit.
- **Follow project conventions.** The codebase has patterns — match them exactly.
- **Commit messages tell a story.** Future readers (including you) will thank you.
- **Confirm with the user** at: baseline status, requirements complete, branch name, plan, and
  any major architectural decision not covered in the interview.
