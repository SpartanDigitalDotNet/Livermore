---
name: perseus:query
description: Answer operational questions by running pre-built action scripts. Check ROUTING.md for question-to-command mapping.
allowed-tools:
  - Bash
  - Read
---

<objective>
Answer the user's question by looking up the closest match in the routing table
and running the corresponding action script. Minimal overhead — no inline scripts,
no research, just route and run.
</objective>

<process>

## Step 1: Read the routing table

```
Read .claude/actions/queries/ROUTING.md
```

## Step 2: Find the closest match to $ARGUMENTS

Match the user's question to a row in the routing table.
If an exact script exists, run it. If the question needs flag adjustments
(different exchange, symbol, etc.), adapt the flags.

## Step 3: Run the command

```bash
NODE_ENV=development npx tsx .claude/actions/queries/<script>.ts [flags]
```

## Step 4: Report the output

Show the results to the user. No commentary unless they ask.

</process>

<critical_rules>
- ALWAYS check ROUTING.md first — do not write new scripts if one already exists.
- If no match exists, tell the user and offer to build one.
- NEVER fabricate output. Run the script and report what it returns.
</critical_rules>
