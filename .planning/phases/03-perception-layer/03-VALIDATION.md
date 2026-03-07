---
phase: 03
slug: perception-layer
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-07
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript runtime tests via `tsx` + static checks (`tsc`, `eslint`) |
| **Config file** | `tsconfig.json`, `.eslintrc.json` |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck && npm run lint && npm run build && npx tsx src/perception/SnapshotBuilder.test.ts && npx tsx src/perception/PerceptionService.test.ts && npx tsx src/perception/ContextAssembler.test.ts && npx tsx src/perception/PerceptionContext.integration.test.ts` |
| **Estimated runtime** | ~110 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck` plus the task-specific perception test file
- **After every plan wave:** Run `npm run typecheck && npm run lint && npm run build && npx tsx src/perception/SnapshotBuilder.test.ts && npx tsx src/perception/PerceptionService.test.ts && npx tsx src/perception/ContextAssembler.test.ts && npx tsx src/perception/PerceptionContext.integration.test.ts`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PERC-01 | unit | `npm run typecheck && npx tsx src/perception/SnapshotBuilder.test.ts` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | PERC-02 | integration | `npm run typecheck && npx tsx src/perception/PerceptionService.test.ts` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 3 | PERC-03 | integration | `npm run typecheck && npx tsx src/perception/ContextAssembler.test.ts && npx tsx src/perception/PerceptionContext.integration.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/perception/SnapshotBuilder.test.ts` — PERC-01 field/ordering/cap coverage
- [ ] `src/perception/PerceptionService.test.ts` — PERC-02 cadence/debounce/burst coverage
- [ ] `src/perception/ContextAssembler.test.ts` — PERC-03 compact context coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live in-world snapshot realism at 1–2 Hz under actual server activity | PERC-01, PERC-02 | Requires live mineflayer runtime and real event noise profile | Start bot on local server, observe emitted snapshot cadence and field quality during idle + movement + combat-adjacent situations |
| Context compactness sanity for planner inputs | PERC-03 | Human review best for signal-to-noise and readability | Capture sample assembled contexts and verify they contain intent-relevant memory without raw-state dumps |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
