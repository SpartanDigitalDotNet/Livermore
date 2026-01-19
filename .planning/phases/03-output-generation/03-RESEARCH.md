# Phase 3: Output Generation - Research

**Researched:** 2026-01-18
**Domain:** Console formatting, Markdown generation, File I/O
**Confidence:** HIGH

## Summary

Phase 3 focuses on output generation for the Coinbase fee analysis spike. The current implementation already has robust console table output (OUT-01 is essentially complete). The remaining work is generating a markdown report file (OUT-02) and ensuring the report header includes fee tier info (OUT-03).

The spike uses pure TypeScript with Node.js built-in modules. For markdown table generation, the existing manual formatting approach is sufficient since the console display functions already produce well-aligned tables. Converting to markdown syntax (adding `|` delimiters and `---` separator rows) is straightforward without external dependencies.

**Primary recommendation:** Extend existing display functions to return markdown strings alongside console output, then write combined report to `spikes/fee-analysis/reports/fee-analysis-{date}.md` using Node.js `fs/promises.writeFile()`.

## Current State Analysis

### What Already Exists (OUT-01: Mostly Complete)

The `analyze-fees.ts` script already displays:
1. **Fee Tier Information** - Tier name, maker/taker rates, 30-day volume/fees
2. **Symbol Summary Table** - 6 columns: Symbol, Total Fees, Total Volume, Eff Rate, Avg Fee, Orders
3. **Buy vs Sell Table** - 6 columns: Symbol, Side, Total Fees, Total Volume, Eff Rate, Orders
4. **Monthly Breakdown Table** - 5 columns: Month, Total Fees, Total Volume, Eff Rate, Orders

All tables include:
- Header row with column names
- Separator line (`-`.repeat(width))
- Data rows with proper alignment
- Summary/totals row where appropriate

### What's Missing (OUT-02, OUT-03)

| Requirement | Gap | Solution |
|-------------|-----|----------|
| OUT-01 | Verify console tables meet spec | Tables exist, may need minor polish |
| OUT-02 | No markdown file generation | Add markdown generation and file write |
| OUT-03 | Fee tier in report header | Already displayed in console, include in markdown |

## Standard Stack

### Core (Use Existing)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs/promises` | Built-in | Async file writing | Part of Node.js, no dependencies |
| `node:path` | Built-in | Path handling | Cross-platform paths |

### No External Dependencies Needed

| Instead of | Why Not | What to Do |
|------------|---------|------------|
| `markdown-table` | Overkill for 3 tables | Hand-format markdown strings |
| `prettier` | Single output file | Consistent manual formatting |
| Template engines | Static content | String concatenation |

**Rationale:** The spike already has manual table formatting. Converting to markdown syntax requires only:
- Replace `.padStart()`/`.padEnd()` with `|` delimiters
- Add `|---|---|` separator after header
- Wrap in markdown heading sections

This is 20-30 lines of code vs. adding a dependency.

## Architecture Patterns

### Recommended Approach

```
analyze-fees.ts
├── displaySymbolFees()       <- Keep for console
├── displaySideFees()         <- Keep for console
├── displayMonthlyFees()      <- Keep for console
│
├── generateSymbolTable()     <- NEW: returns markdown string
├── generateSideTable()       <- NEW: returns markdown string
├── generateMonthlyTable()    <- NEW: returns markdown string
├── generateReport()          <- NEW: assembles full report
│
└── saveReport()              <- NEW: writes to file
```

### Pattern 1: Parallel Console + Markdown Generation

**What:** Keep separate functions for console display and markdown generation
**When to use:** When console formatting differs from markdown formatting
**Why:** Console uses `.padStart()` for alignment; markdown uses `|` delimiters

```typescript
// Console output (existing)
function displaySymbolFees(reports: SymbolFeeReport[]): void {
  // Uses console.log with padStart/padEnd
}

// Markdown output (new)
function generateSymbolTable(reports: SymbolFeeReport[]): string {
  const lines: string[] = [];
  lines.push('| Symbol | Total Fees | Total Volume | Eff Rate | Avg Fee | Orders |');
  lines.push('|--------|------------|--------------|----------|---------|--------|');
  for (const r of reports) {
    lines.push(`| ${r.symbol} | ${formatCurrency(r.totalFees)} | ... |`);
  }
  return lines.join('\n');
}
```

### Pattern 2: Report Assembly

**What:** Single function that assembles all sections into final report
**When to use:** Always for generating the full markdown file

```typescript
interface ReportData {
  feeTier: TransactionSummary;
  symbolFees: SymbolFeeReport[];
  sideFees: SideFeeReport[];
  monthlyFees: MonthlyFeeReport[];
  dateRange: { earliest: string; latest: string };
}

function generateReport(data: ReportData): string {
  return `# Coinbase Fee Analysis Report

**Generated:** ${new Date().toISOString().split('T')[0]}
**Data Range:** ${data.dateRange.earliest} to ${data.dateRange.latest}

## Fee Tier

| Property | Value |
|----------|-------|
| Tier | ${data.feeTier.fee_tier.pricing_tier} |
| Maker Rate | ${formatPercent(data.feeTier.fee_tier.maker_fee_rate)} |
| Taker Rate | ${formatPercent(data.feeTier.fee_tier.taker_fee_rate)} |
| 30-Day Volume | ${formatCurrency(data.feeTier.advanced_trade_only_volume)} |

## Fee Analysis by Symbol

${generateSymbolTable(data.symbolFees)}

## Buy vs Sell Comparison

${generateSideTable(data.sideFees)}

## Monthly Breakdown

${generateMonthlyTable(data.monthlyFees)}
`;
}
```

### File Output Pattern

**What:** Async file writing with directory creation
**Why:** Standard Node.js pattern, non-blocking

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

async function saveReport(content: string, filename: string): Promise<string> {
  const reportDir = join(process.cwd(), 'reports');
  await mkdir(reportDir, { recursive: true });

  const filepath = join(reportDir, filename);
  await writeFile(filepath, content, 'utf-8');

  return filepath;
}
```

### Anti-Patterns to Avoid

- **Mixing console.log in generators:** Keep display functions separate from generators
- **Hardcoded absolute paths:** Use `process.cwd()` or `import.meta.url` relative paths
- **Sync file operations:** Use `fs/promises` not `fs.writeFileSync` in async code

## Don't Hand-Roll

Problems that look simple but should use existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path joining | String concatenation | `path.join()` | Cross-platform compat |
| Directory creation | Manual existence check | `mkdir({ recursive: true })` | Handles nested paths |
| Date formatting | Custom parsing | `toISOString().split('T')[0]` | Already works in codebase |

**Key insight:** The existing `formatCurrency()` and `formatPercent()` helper functions should be reused for markdown generation.

## Common Pitfalls

### Pitfall 1: Markdown Table Alignment Characters

**What goes wrong:** Markdown tables with numeric data look misaligned in source
**Why it happens:** GitHub renders tables proportionally; raw markdown won't align perfectly
**How to avoid:** Don't try to pad markdown cells for visual alignment in source - GitHub handles it
**Warning signs:** Excessive padding in markdown output

### Pitfall 2: Large Table Readability

**What goes wrong:** Symbol table with 140 symbols is hard to read
**Why it happens:** Too much data for a single table view
**How to avoid:** Consider limiting tables (e.g., top 20 by fees) or add summary statistics
**Warning signs:** Tables exceeding reasonable length

### Pitfall 3: File Naming Collisions

**What goes wrong:** Overwriting previous reports
**Why it happens:** Static filename like `fee-analysis.md`
**How to avoid:** Include timestamp: `fee-analysis-2026-01-18.md`
**Warning signs:** User confusion about which report is current

### Pitfall 4: Missing Directory

**What goes wrong:** `ENOENT: no such file or directory`
**Why it happens:** Reports directory doesn't exist
**How to avoid:** Always `mkdir({ recursive: true })` before writing
**Warning signs:** First-run errors

## Code Examples

### Markdown Table Generation

```typescript
// Source: Standard markdown table syntax
function generateMarkdownTable(
  headers: string[],
  rows: string[][],
  alignments?: ('left' | 'center' | 'right')[]
): string {
  const lines: string[] = [];

  // Header row
  lines.push('| ' + headers.join(' | ') + ' |');

  // Separator row with alignment
  const separators = headers.map((_, i) => {
    const align = alignments?.[i] || 'left';
    if (align === 'center') return ':---:';
    if (align === 'right') return '---:';
    return '---';
  });
  lines.push('| ' + separators.join(' | ') + ' |');

  // Data rows
  for (const row of rows) {
    lines.push('| ' + row.join(' | ') + ' |');
  }

  return lines.join('\n');
}
```

### Async File Write

```typescript
// Source: Node.js fs/promises documentation
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function saveMarkdownReport(
  content: string,
  baseDir: string,
  filename: string
): Promise<string> {
  const dir = join(baseDir, 'reports');
  await mkdir(dir, { recursive: true });

  const filepath = join(dir, filename);
  await writeFile(filepath, content, 'utf-8');

  console.log(`Report saved: ${filepath}`);
  return filepath;
}
```

### Report Filename Generation

```typescript
// Pattern: timestamped filenames for uniqueness
function getReportFilename(): string {
  const date = new Date().toISOString().split('T')[0]; // 2026-01-18
  return `fee-analysis-${date}.md`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fs.writeFileSync` | `fs/promises.writeFile` | Node.js 14+ | Non-blocking I/O |
| `path.resolve(__dirname)` | `import.meta.dirname` | Node.js 20.11+ | ESM-compatible |
| `existsSync` + `mkdirSync` | `mkdir({ recursive: true })` | Node.js 10+ | Simpler, idempotent |

**Current in project:**
- ESM modules (type: "module" in package.json)
- Node.js 20+ required
- Async/await patterns preferred

## Report Output Location

### Recommendation: `spikes/fee-analysis/reports/`

**Rationale:**
1. Keeps output with the spike (not polluting project root)
2. `reports/` directory is standard convention
3. Easy to .gitignore if reports shouldn't be committed
4. Clear separation from source files

**Alternative considered:** `reports/fee-analysis/` at project root
- Rejected: This spike is standalone, output should stay within spike folder

### Filename Format

```
fee-analysis-{YYYY-MM-DD}.md
```

Example: `fee-analysis-2026-01-18.md`

### .gitignore Consideration

Add to `spikes/fee-analysis/.gitignore` (or spike-level):
```
reports/
```

Reports contain account-specific data and shouldn't be committed.

## Open Questions

1. **Table Row Limits**
   - What we know: Symbol table could have 140+ rows
   - What's unclear: Should we limit to "top N" in markdown (but show all in console)?
   - Recommendation: Show all in markdown since it's for reference; user can scroll

2. **Report Regeneration Behavior**
   - What we know: Timestamped filenames prevent overwrites
   - What's unclear: Should we also keep a `fee-analysis-latest.md` symlink/copy?
   - Recommendation: Just use dated files; simplest approach

## Sources

### Primary (HIGH confidence)
- GitHub wooorm/markdown-table - API pattern reference for markdown table syntax
- Node.js fs/promises documentation - writeFile and mkdir APIs

### Secondary (MEDIUM confidence)
- Existing codebase patterns (`packages/utils/src/logger/file-transport.ts`)
- Current `analyze-fees.ts` implementation

### Tertiary (LOW confidence)
- Web search results for best practices (verified against Node.js docs)

## Metadata

**Confidence breakdown:**
- What exists vs. what's needed: HIGH - Read actual source code
- Markdown generation: HIGH - Standard syntax, no libraries needed
- File I/O patterns: HIGH - Node.js built-in, codebase precedent
- Report location: MEDIUM - Reasonable convention, not mandated

**Research date:** 2026-01-18
**Valid until:** Indefinitely (stable Node.js APIs, simple requirements)
