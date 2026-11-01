# Plugin compatibility

Before replacing a plugin build, compare current source and verify that existing saved state remains readable; document any required migration.

# Interface work

Read `PRODUCT.md` for the shared product context. Impeccable is installed for this repository at `.agents/skills/impeccable/SKILL.md`; use its relevant command guide for UI work. The confirmed workflow default is code-first. Audit findings do not authorize a redesign or changes to product behavior.

# Sauron local git stack

Keep Sauron work in this order:

1. Dev setup: `codex/sauron-dev-setup` (commit A).
2. Codex → Sauron chat integration: `codex/sauron-codex-integration` (commit B, based on A).
3. Productivity work: `codex/sauron-productivity` (commit C onward, based on B).

When separating the current mixed working tree, stage and review only the dev setup hunks before committing A. Commit the remaining integration changes as B. Keep the stack local until a push or PR is explicitly requested; propose the changes in dependency order.
