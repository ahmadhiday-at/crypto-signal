# REFACTOR.md

## 1. Core Principles

- No behavior change under any condition
- Refactor = move, isolate, reorganize (not redesign)
- Every change must be reversible
- Prefer explicit structure over abstraction

---

## 2. Allowed Operations

- Move functions into dedicated modules
- Split large files into smaller logical units
- Rename files or variables (only if references are updated safely)
- Isolate pure functions from side-effect logic

---

## 3. Forbidden Operations

- No logic modification (including “small improvements”)
- No performance optimization unless explicitly requested
- No new architecture (no microservices, no event-driven systems)
- No hidden changes (all changes must be explicit and traceable)
- No cross-module shortcut (must respect module boundaries)

---

## 4. Dependency Rules (CRITICAL)

- A module must not access another module’s internal logic directly
- All dependencies must be explicit (via import)
- No hidden/global state usage
- Avoid circular dependencies

---

## 5. Refactor Strategy

- Work in small, isolated steps
- Refactor one responsibility at a time
- Validate dependency before moving code
- Never refactor multiple domains in one step

---

## 6. Large File Handling (e.g., server.js)

- Identify sections:
  - routing
  - business logic
  - websocket
  - scheduler
- Extract only one section per step
- Do not rewrite the entire file
- Preserve execution order

---

## 7. AI Execution Rules

- Do not execute refactor without approval
- Always propose before changing
- Show only affected code
- Explain:
  - what is moved
  - why it is safe
  - dependencies involved

---

## 8. Safety Checks (Before Any Change)

- Is the function pure or dependent?
- Are all dependencies identified?
- Will this change affect execution flow?
- Can this be reverted easily?

If any answer is unclear → stop and ask.

## State Handling Rules

- No module may rely on global variables
- All dependencies must be passed explicitly as parameters
- If a function depends on external state, list all dependencies before moving

## Initialization Rules

- Document full startup sequence before refactor
- Do not split initialization logic without mapping dependencies
- Preserve async execution order exactly

## Data Contract Rules

- Do not change input/output structure of any function
- Document expected data shape before moving logic
- Validate inputs after refactor

## Verification Protocol

After each step:

- Server starts without error
- Key API endpoints respond correctly
- WebSocket still emits data
- Scheduled jobs still run

If any check fails → stop immediately

## Checkpoint Rules

- After each step:
  - validate system
  - commit changes
- Never proceed without a stable checkpoint

## Dependency Transition Rule

- When moving a function that depends on external state:
  - Do not change its behavior
  - Explicitly pass required dependencies as parameters
- Update all call sites consistently
- Do not leave partial or mixed dependency access

## Call Chain Rules

- Before moving a function:
  - Identify all call sites
  - Trace full execution flow
- After moving:
  - Ensure all call paths remain valid
  - Do not break call order or dependencies

## Async Safety Rules

- Do not change async execution order
- Do not move async logic without verifying timing
- Preserve await chains exactly
- Avoid introducing parallel execution unless explicitly required

## Module Interface Rules

- Maintain consistent import/export style (CommonJS or ES Modules)
- Do not mix module systems
- Ensure all exports are explicitly defined
- Verify all imports are resolved after refactor

## Side Effect Rules

- Identify all side effects before moving any function
- Side effects include:
  - global state mutation
  - I/O operations
  - shared object mutation
- Do not move logic without understanding its side effects

## Allowed Structural Changes

- Changing function signatures is allowed ONLY for dependency injection
- This is not considered a logic change if behavior remains identical

## Dependency Direction Rule

- server.js must be the top-level entry only
- Modules must not import from server.js
- Shared state must be passed or isolated into a dedicated module

## Boot Sequence Rules

- Do not move initialization logic without mapping execution order
- All async initialization must remain explicitly awaited
- server.listen must be the final step

## Closure Safety Rules

- Do not extract functions that depend on outer scope without rewriting dependencies explicitly
- Identify all closure variables before moving any function

## Shared State Rules

- There must be a single source of truth for shared state
- Shared objects must not be duplicated across modules
- Always pass references, never recreate shared state
