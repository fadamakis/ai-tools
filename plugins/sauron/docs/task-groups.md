# Sauron task grouping requirements

Related tasks form branches that users can prioritise together, while shared topics expose work across branches.

**Status:** Implementation in progress. **Date:** 2026-11-14. **Product decision source:** Anthony Hughes, requirements interview in the accompanying Codex chat.

These are intended behaviours, not a statement of shipped capabilities. Requirement IDs identify agreed behaviour for later design and acceptance checks.

## 1. Problem and intended outcome

A flat list of chats obscures related work, its current state, and what needs the user's input.
The user needs to choose a subject for the morning, inspect its threads, and resume the right work.

Sprint planning includes preparation, planning, follow-up, and repairs to supporting skills.
Quarter reporting similarly includes status investigations, site updates, and improvements to the reporting routines.
Routine fixes can span both subjects, making them useful to find together without changing their parents.

Success means treating “Fix routine issues” as one current focus item, inspecting its children, and removing the branch from Top 3 when switching focus.
A standalone task such as “Check SSO for Corp X” remains useful without children.

Permanent areas and tasks with multiple parents are outside the agreed model. Topic views provide visibility across branches.

## 2. Product model

| Term | Meaning |
|---|---|
| Task | A unit of tracked work, with or without a linked chat or children. |
| Linked chat | A conversation associated with a task; retaining children does not remove the task's own conversation. |
| Parent | The single task directly containing another task. |
| Descendant | A child or any task nested further below it. |
| Top-level task | A task without a parent, including a standalone task. |
| Branch | A task and all its descendants. |
| Topic | A shared classification that exposes related work across branches without changing parentage. |

Multiple nesting levels are included in the first version.
The model does not require separate container objects: an existing task can gain children and retain its own chat.

The following is a product example, not a prescribed screen design. Status descriptions illustrate work state rather than new stored status values.

```text
YOUR WORK

Fix routine issues                         Top 3: one slot
  Topic: routines
  ├─ Fix weekly brief          Needs attention
  └─ Fix calendar lookup       Open

Prepare PEX sprint                         Top 3: one slot
  ├─ Review candidate work     Needs attention
  ├─ Fix planning skill        Open             Topic: routines
  └─ Publish sprint agreement  Closed

Check SSO for Corp X            Open
```

The first two children inherit “routines”. “Fix planning skill” receives it directly and retains “Prepare PEX sprint” as its only parent.

```text
TOPIC: ROUTINES - ACTIVE WORK

Task                    Parent                Status
Fix routine issues      None                  1 child needs attention
Fix weekly brief        Fix routine issues    Needs attention
Fix calendar lookup     Fix routine issues    Open
Fix planning skill      Prepare PEX sprint     Open
```

Removing “Fix routine issues” from Top 3 leaves both branches visible in this active topic view.

## 3. Behaviour requirements

### Hierarchy and closure

- **H-01:** Each task has at most one parent. Standalone tasks remain supported.
- **H-02:** A parent can retain its own chat and contain children. An existing task can become a parent.
- **H-03:** Dragging a task into another requests confirmation before moving the task and its descendants.
- **H-04:** Closing a parent requires an explicit user decision. All existing children closing does not automatically close their parent.
- **H-05:** Closing a parent with open descendants requires a choice: close the whole branch or keep the parent open.
- **H-06:** New activity in a closed branch produces a reopening suggestion, rather than automatically reopening work.
  The suggestion includes the affected task and any closed ancestors that need reopening.

### Focus and deprioritisation

- **F-01:** Top 3 represents focus now, not a weekly commitment. Only top-level tasks are eligible.
- **F-02:** A branch takes one Top 3 slot. Children appear within it and cannot consume separate slots.
  Standalone tasks and larger branches may occupy different slots despite different sizes.
- **F-03:** Nesting a Top 3 task removes its slot. The move confirmation states this consequence.
  The destination parent's existing priority remains unchanged.
- **F-04:** Deprioritising removes a branch from Top 3 or lowers its order. It preserves visibility, attention flags and individual states. No Park state or section is added.
  Focused tasks can reorder across Ready and In progress. Unfocused ordering retains its workflow-state boundaries; filtered views do not expose reorder actions.

### Attention and state

- **A-01:** Needs attention means the user has input or review outstanding.
  This includes unread responses, unfinished reading, and incomplete work the user needs to pick up.
- **A-02:** Opening a chat alone does not clear attention. Explicitly marking it handled can clear its own attention flag.
  Resuming work does not clear attention.
- **A-03:** Parents summarise descendant states, for example “2 need attention · 3 open · 4 closed”.
  A descendant needing input flags its ancestors. Deprioritisation does not suppress that signal.
- **A-04:** A parent's own attention state is distinct from its descendant summary.
  Handling its own chat does not clear children's flags or the remaining aggregate signal.
  Scheduled helper reports count each task's own attention once, including flagged Waiting tasks and excluding snoozed or closed work. New attention and changed displayed titles or next actions are reported as changes; unchanged polling and handled work are not.
- **A-05:** Child summaries do not replace explicit parent status decisions.
  Open, closed, and needs attention describe the product behaviour here; they do not define a replacement planning-state system.

### Topics

- **T-01:** Tasks can share topics across different parents. Topics change neither parentage nor priority nor status.
- **T-02:** Descendants inherit ancestor topics, including future children. A task elsewhere can receive the same topic directly.
- **T-03:** A topic view exposes matching work across branches and retains parent context.
  Deprioritised work stays visible in active topic views.

### Navigation

- **N-01:** The default view shows top-level tasks with children collapsed and compact descendant summaries.
- **N-02:** Expanding a parent surfaces children needing attention first. Closed children remain hidden until requested.

## 4. Organisation assistance

- **O-01:** Bootstrap reviews every chat active during the previous two weeks, including older chats resumed during that window.
  It distinguishes already tracked tasks from proposed additions.
- **O-02:** Bootstrap also reviews existing Sauron tasks, including those outside the chat window, and proposes closing irrelevant tasks.
  These closures need user approval; they are not automatic prioritisation decisions.
- **O-03:** One editable proposal shows proposed parents, task placements, topics, tracking additions, and closures.
  The user can exclude individual changes and accept the remainder together. Proposals do not change tasks before acceptance.
- **O-04:** After enablement, a daily review checks new or changed chats since the previous review.
  Suggestions wait quietly in Sauron and use the same review model in smaller batches.
- **O-05:** Explicit instructions from a chat can track it and place it under a named parent without an additional organisation proposal.
  Manual capture remains available alongside daily suggestions.
- **O-06:** Rejected suggestions remain dismissed unless circumstances materially change. Corrections inform subsequent organisation proposals.
- **O-07:** Organisation assistance does not independently select Top 3, reorder or Snooze work, or close tasks.
  Accepting selected closure proposals is an explicit user decision.

Organisation assistance is a Sauron capability. The user need not manage a separate agent or conversation to operate it.
The implementation uses a read-only local chat adapter, a tool-disabled proposal worker and an opt-in macOS schedule.

## 5. Acceptance scenarios

These are acceptance criteria for future implementation, not claims of completed verification.

| ID | Initial state and action | Expected outcome | Requirements |
|---|---|---|---|
| AC-01 | An existing task has a chat. The user confirms moving another task beneath it. | Both chats remain associated with their tasks; the moved task has one parent. | [H-01](#hierarchy-and-closure), [H-02](#hierarchy-and-closure), [H-03](#hierarchy-and-closure) |
| AC-02 | A standalone Top 3 task is dragged beneath another task. | Confirmation explains slot removal. Cancelling preserves placement and focus; confirming removes the child's slot and preserves the destination's priority. | [H-03](#hierarchy-and-closure), [F-01](#focus-and-parking), [F-02](#focus-and-parking), [F-03](#focus-and-parking) |
| AC-03 | A parent has two attention children. The user removes it from Top 3. | The branch remains visible in active lists and topic results, with attention flags preserved. | [F-04](#focus-and-parking), [A-03](#attention-and-state), [T-03](#topics) |
| AC-04 | A parent and child each need input. The user opens the parent chat, then explicitly marks it handled. | Opening clears nothing. Marking handled clears only the parent's own flag; its summary still shows the child needing attention. | [A-01](#attention-and-state), [A-02](#attention-and-state), [A-03](#attention-and-state), [A-04](#attention-and-state) |
| AC-05 | A parent's last open child closes. The user subsequently closes the parent. | Child completion alone leaves the parent open. The explicit close finishes the parent. | [H-04](#hierarchy-and-closure), [A-05](#attention-and-state) |
| AC-06 | A parent has an open child. The user requests closure. | The user must close the branch or keep the parent open. Open work cannot silently disappear beneath a closed parent. | [H-05](#hierarchy-and-closure) |
| AC-07 | New activity arrives in a closed child under a closed parent. | Sauron suggests reopening the affected task and ancestors. Neither reopens automatically. | [H-06](#hierarchy-and-closure) |
| AC-08 | “Fix routine issues” has topic “routines”; “Fix planning skill” has it directly under another parent. A new child is added beneath the former. | The active topic view includes both branches' matching work, including the new child, with parent context and unchanged priorities. | [T-01](#topics), [T-02](#topics), [T-03](#topics) |
| AC-09 | A parent has attention, open, and closed children. The user opens Sauron and expands it. | The parent starts collapsed with counts. Expansion shows attention children first and hides closed children until requested. | [A-03](#attention-and-state), [N-01](#navigation), [N-02](#navigation) |
| AC-10 | Bootstrap finds a resumed older chat, an already tracked chat, and an irrelevant existing task. The user excludes the proposed closure and accepts the rest. | The review covers both recent chats without duplicating tracked work. Accepted grouping changes apply; the excluded task remains open. | [O-01](#4-organisation-assistance), [O-02](#4-organisation-assistance), [O-03](#4-organisation-assistance) |
| AC-11 | Daily review is enabled. New chats become active and one dismissed proposal remains unchanged. | New suggestions wait for review. The dismissed proposal does not return; focus, Snooze and closure remain unchanged. | [O-04](#4-organisation-assistance), [O-06](#4-organisation-assistance), [O-07](#4-organisation-assistance) |
| AC-12 | From a chat, the user explicitly asks to track it under “Fix routines”. | Sauron tracks and places the chat without waiting for the daily batch. | [H-01](#hierarchy-and-closure), [O-05](#4-organisation-assistance) |

## 6. Delivery boundaries and unresolved questions

### Confirmed requirements and optional depth

Sections 3 and 4 record confirmed product requirements. They do not establish implementation availability or a delivery sequence.
The first version includes multiple nesting levels.
Permanent areas, multiple parents, and automatic focus or closure decisions are excluded.

This document adds no runtime behaviour, schema, migration, or schedule.
Detailed UI design, scheduling mechanisms, database design, and tool signatures belong to implementation planning.

### Agreed implementation decisions

- **P-01:** Only explicit handling or closure clears own attention. Reading or resuming clears nothing.
- **P-02:** Inherited topics follow the current ancestors; direct topics survive moves.
- **P-03:** Rejected suggestions return only after relevant new evidence or a user correction changes the recommendation.
- **P-04:** Multiple nesting levels are included.
- **P-05:** Bootstrap uses the preceding 14×24 hours. Daily review is opt-in at 07:00 Europe/Berlin, with persisted recovery and catch-up.
- **P-06:** Attention is included within open counts. Snoozed work has a separate count; existing state controls inspect topic history.

### Delivery status

Release 1 implements manual hierarchy, topics, attention, branch decisions and root-only focus.
Release 2 implements bootstrap and daily organisation proposals for local Codex history. Remote hosts and ChatGPT history remain outside discovery coverage. Native activation remains a separate acceptance gate.
No release adds parking: deprioritising means removing Top 3 or changing task order while retaining visibility and attention.

### Technical decisions and remaining verification

- **I-01:** The local app-server adapter lists active and archived Codex history by update time, with pagination and stable chat IDs. Turn evidence identifies resumed work.
- **I-02:** Capability checks verify background listing and content reads. Local MCP servers are disabled for both the reader and the proposal worker. Missing access and partial coverage remain explicit.
- **I-03:** Attention uses saved source evidence, explicit decisions and new assistant responses. It does not claim reliable unread or partial-read detection.
- **I-04:** Hierarchy and attention remain separate from Inbox, Ready, In progress, Waiting, completion, dismissal and timed Snooze. Deprioritisation uses Top 3 and ordering.
- **I-05:** Schema 4 adds organisation metadata and preserves task identities and saved decisions. Disposable saved-data copies pass repeated reopening. Native activation and loaded build ID remain a separate verification gate.

- **I-06:** Each immutable Dev build advertises its own UI resource address. Stable compatibility aliases remain readable, and existing clients keep their original runtime. The UI rejects responses from a different build.

Current capability and compatibility references:

- [AI Tools](../../../PRODUCT.md)
- [Sauron](../README.md)
- [Architecture](architecture.md)
- [Sauron compatibility](compatibility.md)

Implementation covers local Codex history only. Remote hosts and ChatGPT history are outside current discovery coverage.
Installation and opening Sauron do not enable reviews or schedules.
