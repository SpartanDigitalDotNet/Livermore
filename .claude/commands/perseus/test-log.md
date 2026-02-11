---
name: perseus:test-log
description: Track test runs — log results, check what's been tested, avoid duplicate work
argument-hint: "[log|check|clear]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
---

<objective>
Maintain a test log at `.planning/TEST-LOG.md` that tracks what has been tested in the current
work session. Prevents duplicate test runs and provides a clear audit trail of test results.
Use this skill after running any test to record the result, or before testing to check what
still needs to be verified.
</objective>

<critical_rules>
- The test log lives at `.planning/TEST-LOG.md` in the project root.
- Each entry records: timestamp (UTC), test name, result (PASS/FAIL), and notes.
- The log is append-only during a session — never delete entries, only add new ones.
- Use `clear` mode to start a fresh log for a new session/milestone.
- If the file doesn't exist, create it with the header template.
</critical_rules>

<context>
## Test Categories

| Category | Tests | Skill |
|----------|-------|-------|
| Build | Full workspace build | `/perseus:build` |
| Redis | Key listing, instance status, activity streams, candles | `/perseus:redis` |
| Lifecycle | State machine transitions, lock claiming | `/perseus:lifecycle` |
| Exchange | Coinbase REST, Coinbase WS, Kraken sim, Pub/Sub | `/perseus:exchange` |
| Admin | Build check, type consistency, component inventory | `/perseus:admin` |

## Log File Template
```markdown
# Test Log

**Session started:** {UTC timestamp}
**Branch:** {git branch}
**Milestone:** {current milestone if known}

## Results

| Time (UTC) | Category | Test | Result | Notes |
|------------|----------|------|--------|-------|
```
</context>

<process>
Parse $ARGUMENTS to determine the mode.

## Mode: log (default)
Append a test result to the log. Expects to be called after a test has been run.

1. Read `.planning/TEST-LOG.md` (create with template if missing)
2. Ensure `.planning/` directory exists
3. Append a new row to the results table with:
   - Current UTC timestamp
   - Test category and name (from recent context)
   - PASS/FAIL result
   - Any relevant notes (error messages, key metrics)
4. Write updated file

## Mode: check
Show what has and hasn't been tested:

1. Read `.planning/TEST-LOG.md`
2. Compare against the full test categories table
3. Report:
   - Tests completed (with results)
   - Tests not yet run
   - Any failures that need re-testing

## Mode: clear
Start a fresh log:

1. Get current git branch name
2. Create new `.planning/TEST-LOG.md` with the header template
3. Confirm the new session has started

## Report
Display the current test log state — what's passed, what's failed, what's pending.
</process>

<success_criteria>
- [ ] Test log file exists at `.planning/TEST-LOG.md`
- [ ] Entries are properly formatted in the markdown table
- [ ] Check mode accurately reports tested vs untested
- [ ] No duplicate entries for the same test in the same session
</success_criteria>
