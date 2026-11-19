# Direct Codex capture acceptance

Only new, explicitly selected chat captures use these rules. Listing chats creates nothing.
Follow-up proposals and organisation-review tracking retain their existing naming behaviour.
All conversations below are synthetic. Evaluate the tracking skill against these inputs; exact wording may vary, but scope and save/clarify decisions must match.

## Acceptance test

“If I read this next week, would I know what I’m being asked to do?”

A passing title explains completion, preserves the latest agreed responsibility, distinguishes similar tasks and puts essential meaning early.
It invents no cause, solution, deadline or commitment. Titles stay within 160 characters.

## Conversation fixtures

| Case | Selected conversation and current request | Expected behaviour | Requirements |
|---|---|---|---|
| Clear diagnostic outcome | Chat title: “Datadog SCIM · 400 diagnosis”. User: “Find out why Datadog SCIM provisioning returns HTTP 400.” Assistant: “I will investigate.” Current request: “Track this in Sauron.” | Save immediately: “Establish why Datadog SCIM provisioning returns HTTP 400”. Do not promise a working integration. | C-01, C-02 |
| Implementation uncertain | User: “Establish whether Datadog SCIM fails because of our request format.” Assistant: “I have not identified the cause yet.” Current request: “Track this.” | Save: “Establish whether the request format causes Datadog SCIM failures”. Do not require the diagnosis before capture or assert a known cause. | C-02, C-03 |
| Assistant suggestion only | User: “Explain SCIM.” Assistant: “We could also build a Datadog test environment.” Current request: “Track this.” | Ask what outcome should be tracked. Do not interpret the assistant suggestion as accepted work. | C-02, C-03 |
| Superseded scope | User: “Fix Datadog provisioning.” Later user: “Actually, just send Richard the SCIM findings. His team owns the fix.” Current request: “Track this.” | Save: “Get the Datadog SCIM findings to Richard”. Do not retain responsibility for the fix. | C-02 |
| Delegated implementation | User: “Richard will implement Datadog SCIM. I need to confirm his team has the sandbox access.” Current request: “Track this.” | Save: “Confirm Richard’s team has sandbox access for Datadog SCIM”. Do not assign implementation to the user. | C-02 |
| Completed work | User: “Send Richard the SCIM findings.” Assistant: “Sent.” User: “Thanks, that is complete.” Current request: “Track this.” | Ask what remaining outcome should be tracked. Do not create or reopen an outstanding task automatically. | C-02, C-03 |
| Material ambiguity | User: “We need to understand the Datadog SCIM 400 and eventually get provisioning working.” Assistant: “Which part should we take on?” Current request: “Track this.” | Ask whether this tracks understanding the 400 or getting provisioning working end to end. Save neither interpretation until clarified. | C-03 |
| Several unrelated outcomes | User: “Prepare Datadog SCIM tests and write the PEX sprint brief.” Current request: “Track this chat.” | Clarify the intended task scope. Do not silently choose one or split into two tasks. | C-03 |
| Inaccessible content | A verified selected chat is titled “Datadog test setup”; its message read fails. Current request: “Track it.” | Explain that content is unavailable and ask what outcome to track. Do not copy the title as a fallback. | C-03 |
| Capture request supplies outcome | Earlier chat only discusses possibilities. Current request: “Track this as confirming Richard has Datadog sandbox access.” | Save: “Confirm Richard has Datadog sandbox access”. The current user request establishes agreement. | C-02 |
| Mixed batch | User selects the clear diagnostic chat and the materially ambiguous chat above. | Save the diagnostic task immediately, report its persisted title, and ask the focused question for the other. After an answer, save only the pending selection. | C-03, C-04 |
| Existing task and amendment | The chat already links to task T titled “Establish the Datadog SCIM failure cause”. User recaptures it, then says “Make that more specific about the sandbox.” | Recapture returns T unchanged. Amend T through planning to “Establish why Datadog SCIM fails in the sandbox”; retain its chat link, state and unrelated fields. | C-04 |

## Reporting and failures

After a confirmed creation, show “Added to Sauron: **[persisted title]**” and its source chat reference.
Report already tracked, needs clarification and failed selections separately; do not call them newly saved.
After a lost response, confirm saved state by task identity and exact chat link before retrying.
If confirmation is unavailable, report that saving is unconfirmed. Do not invent success.

## Verification boundaries

The conversation cases test instruction-following judgement; they are not a server-side naming classifier.
Store and MCP regressions in `tests/discussions.test.ts` cover the actual input field, persistence, legacy fallback, idempotency and amendment path.
Automated organisation-review and follow-up tests establish that their existing naming remains unchanged.
