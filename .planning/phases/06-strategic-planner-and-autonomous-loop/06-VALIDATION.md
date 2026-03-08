---
phase: 6
slug: strategic-planner-and-autonomous-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in runner (hand-rolled `assert()` + `async run()`) — established project pattern |
| **Config file** | None — tests run as standalone tsx scripts |
| **Quick run command** | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` |
| **Full suite command** | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsx src/planner/strategicSchema.test.ts && npx tsx src/planner/TacticalPlanner.test.ts && npx tsc --noEmit && npx eslint src --ext .ts` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit`
- **After every plan wave:** Run full suite command above
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | PLAN-03 | unit | `npx tsx src/planner/strategicSchema.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-01-02 | 01 | 1 | PLAN-03 | unit | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-02-01 | 02 | 1 | PLAN-03 | unit | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-02-02 | 02 | 1 | PLAN-03 | unit | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-03-01 | 03 | 2 | PLAN-04 | unit | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-03-02 | 03 | 2 | PLAN-03+04 | unit | `npx tsx src/planner/StrategicPlanner.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 6-04-01 | 04 | 3 | PLAN-03+04 | build | `npx tsc --noEmit && npx eslint src --ext .ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/planner/strategicSchema.ts` — Zod schema for Model A output (GoalPlan, Subgoal, StrategicOutput)
- [ ] `src/planner/strategicSchema.test.ts` — schema validation boundary tests
- [ ] `src/planner/StrategicPlanner.ts` — the module under test (created in plan execution)
- [ ] `src/planner/StrategicPlanner.test.ts` — trigger policy, handoff, dedup, debounce tests

*Note: `src/planner/systemPrompts.ts`, `src/config.ts`, `src/index.ts` exist and need modification only — not Wave 0 gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bot completes wood→stone critical path autonomously | PLAN-04 | Requires live server + real LLM calls | Start bot on fresh world, observe Model A goal selection, verify stone tool crafting without player commands |
| Graceful replace on new strategic plan arrival | PLAN-03 | Requires in-flight action timing | Manually trigger escalation mid-movement, verify current action completes safely before queue replacement |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
