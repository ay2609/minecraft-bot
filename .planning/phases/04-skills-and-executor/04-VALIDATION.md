---
phase: 04
slug: skills-and-executor
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | custom tsx test scripts + Node assert |
| **Config file** | none — direct `npx tsx` execution |
| **Quick run command** | `npx tsx src/executor/ExecutorResult.contract.test.ts` |
| **Full suite command** | `npm run typecheck && npm run lint && npm run build && npx tsx src/executor/**/*.test.ts` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx src/executor/ExecutorResult.contract.test.ts`
- **After every plan wave:** Run `npm run typecheck && npm run lint && npm run build && npx tsx src/executor/**/*.test.ts`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | EXEC-01 | contract + unit | `npx tsx src/executor/SkillRegistry.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | EXEC-02 | contract | `npx tsx src/executor/ExecutorResult.contract.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | EXEC-03 | integration | `npx tsx src/executor/MovementCoordinator.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | EXEC-01, EXEC-02, EXEC-03 | e2e/integration | `npx tsx src/executor/ExecutorLive.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/executor/ExecutorResult.contract.test.ts` — result invariants (`never throw`, errorCode rules)
- [ ] `src/executor/SkillRegistry.test.ts` — 10 required skill names wired and callable
- [ ] `src/executor/MovementCoordinator.test.ts` — lock/queue/preemption/drop behavior
- [ ] `src/executor/ExecutorLive.integration.test.ts` — live-condition failure-code mapping checks

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| In-game production of all 10 executor error codes under real conditions | EXEC-02 | Some failure modes depend on live world geometry/inventory state that is difficult to deterministically mock | Run local server + bot, execute scripted scenarios for each code, confirm emitted `executor:result` payloads |
| Anti-oscillation under repeated conflicting move commands | EXEC-03 | Requires observing runtime pathfinder behavior under sustained conflicting inputs | Trigger rapid conflicting `move_to` requests during traversal; verify single coherent path progression with structured arbitration outcomes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
