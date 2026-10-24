# Use available specialists

Read the current skill catalog and the target repository's instructions. Select a maintained specialist only when its actual scope and available tools fit the task. No separately installed organization-specific skill is required by Workbench.

| Need | Selection rule |
| --- | --- |
| Ticket facts and linked requirements | Use the connected issue tracker or a read-only ticket specialist. Editing needs the user's requested scope. |
| Exact designs and UI conventions | Use the specified design source and the repository's design system. |
| Component and user-journey checks | Reuse the repository's existing stories, tests, and browser tools. |
| Backend conventions | Follow the target application's maintained instructions. A migration still needs explicit scope. |
| Focused code review | Use a reviewer that inspects the current diff and can explain its evidence. |
| CI diagnosis | Inspect the actual failing job and command before choosing a CI specialist. |
| PR discussion handling | Check the specialist's side effects and fit them to the authorized push, reply, and resolution scope. |

Choose one implementation when duplicate skills are available. If a specialist is unavailable, use the supported direct tools and repository instructions; report missing access rather than inventing a dependency.

Do not nest competing delivery orchestrators automatically. If the user explicitly selects another workflow, let it own that work and use Workbench only for uncovered coordination. A verification skill that pushes cannot run under verification-only authorization. A specialist that merges or marks a PR ready cannot override Workbench's draft-only rule.

Do not edit, remove, or disable the user's other skills while delivering a feature. Workbench stages remain opt-in.
