---
status: testing
phase: 22-admin-ui-control-symbols
source: [22-01-SUMMARY.md, 22-02-SUMMARY.md, 22-03-SUMMARY.md, 22-04-SUMMARY.md, 22-05-SUMMARY.md, 22-06-SUMMARY.md]
started: 2026-02-01T19:05:00Z
updated: 2026-02-01T19:05:00Z
---

## Current Test

number: 8
name: Active Symbols Display
expected: |
  Active Symbols card shows count badge and list of symbols currently being monitored (from your settings).
awaiting: user response

## Tests

### 1. Navigate to Control Panel
expected: Click "Control" in the navigation bar. Control Panel page loads showing Runtime Status card, Control Buttons, Command History panel, and Active Symbols card.
result: pass

### 2. Runtime Status Display
expected: Runtime Status card shows: running/paused state with colored badge, current mode (e.g., position-monitor), uptime, and exchange connection status (wifi icon).
result: pass

### 3. Pause API
expected: Click Pause button. Command executes, success toast appears, status changes to "Paused". Command appears in history with timestamp.
result: pass
notes: "Fixed auth token expiry (ClerkTokenProvider), Redis channel mismatch (CLERK_USER_ID env var), watchdog reconnect (isIntentionalClose check), and mock status (runtime-state module)."

### 4. Resume API
expected: While paused, click Resume button. Command executes, success toast appears, status changes to "Running". Command appears in history.
result: pass

### 5. Mode Switcher
expected: Click mode dropdown. Options appear (position-monitor, scalper-macdv, scalper-orderbook). Selecting a mode executes command and shows toast.
result: pass
notes: "Dropdown updates after fix to update runtime state. Strategy implementation still stub per spec."

### 6. Clear Cache with Confirmation
expected: Click "Clear Cache" button. Confirmation dialog appears asking to confirm. Clicking confirm executes command and shows success toast.
result: pass

### 7. Command History
expected: After executing commands, Command History panel shows list of recent commands with timestamp, command type, and status icon (spinner while pending, checkmark on success, X on error).
result: pass
notes: "Shows relative time ('just now', '11m ago') but user requested actual locale timestamp (e.g., '10:45 PM') in addition to relative time. Minor UX improvement for later."

### 8. Active Symbols Display
expected: Active Symbols card shows count badge and list of symbols currently being monitored (from your settings).
result: [pending]

### 9. Navigate to Symbols Page
expected: Click "Symbols" in the navigation bar. Symbols page loads showing Symbol Watchlist, Scanner Status, and Add Symbol form.
result: [pending]

### 10. Symbol Watchlist Display
expected: Watchlist shows your configured symbols. Each row has symbol name, enable/disable toggle, expand button, and remove button.
result: [pending]

### 11. Expand Symbol for Metrics
expected: Click expand on a symbol row. Row expands to show metrics: current price, 24h change (green/red), and 24h volume.
result: [pending]

### 12. Scanner Status Display
expected: Scanner Status card shows enabled/disabled badge, exchange name, and last run time (or "not configured" if no scanner).
result: [pending]

### 13. Search for Symbol
expected: Type in the symbol search input (e.g., "SOL"). After brief delay, dropdown appears with matching Coinbase symbols (e.g., SOL-USD).
result: [pending]

### 14. Add Symbol with Validation Preview
expected: Select a symbol from search dropdown. Validation preview appears showing symbol name with checkmark, price, 24h change, and volume. Click Add to add the symbol.
result: [pending]

### 15. Remove Symbol with Confirmation
expected: Click remove button on a symbol row. Confirmation dialog appears. Confirming removes the symbol from watchlist with success toast.
result: [pending]

### 16. Bulk Import - Open Modal
expected: Click "Import from JSON" button. Modal opens with textarea for pasting JSON array of symbol names.
result: [pending]

### 17. Bulk Import - Validate Symbols
expected: Paste JSON array like ["BTC-USD", "ETH-USD", "INVALID"]. Click Validate. Results show valid (green), invalid (red), duplicate (yellow) badges with details.
result: [pending]

### 18. Bulk Import - Import Valid Symbols
expected: After validation, click "Import N Symbols" button. Valid symbols are added, success toast shows count added/skipped.
result: [pending]

## Summary

total: 18
passed: 7
issues: 0
pending: 11
skipped: 0

## Gaps

[none - all issues resolved]
