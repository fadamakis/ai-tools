---
name: translations
description: >
  Explicit-only translation coordination for /workbench:translations with a PR,
  issue, or feature. Discover the repository's localization workflow, reuse an
  existing request, verify the requested languages, and track its actual result.
  Never invoke automatically because a PR changes copy.
---

# Request and track translations

Use `/workbench:translations <PR, issue, or feature>`. Read [the shared contract](../../references/workflow.md), the target repository's instructions, and any available localization specialist. This utility is outside autopilot and does not require a checkout or delivery stage.

## Scope and authority

Run only when the user selects this command or explicitly requests this translation workflow. A question about this skill does not execute it. Honor draft-only, check-only, and tracker-only requests. Translation work does not authorize source changes, pushes, PR readiness changes, merges, Slack messages, or schedules.

An explicit full-flow request for a concrete target authorizes the translation request and tracking actions supported by that repository's documented process. Before writes, show the resolved destination, language scope, request mechanism, and tracking content. Existing authorization for the same target remains valid; ask when a destination, language choice, or requested action is missing.

## Discover the repository's process

1. Read the target PR or issue, linked requirements, changed copy, comments, and existing localization requests. Confirm repository and target identity.
2. Inspect the repository's localization guide and workflow configuration. Determine how requests are submitted, which locales are supported, how completion is reported, and whether a tracker is required. Use live issue-field metadata where relevant.
3. Resolve the intended languages from the user and requirements. A feature flag does not establish an experiment, and a team or application name does not determine the language set. Preserve intentionally limited scope.
4. If no maintained request process is available, prepare a draft brief containing the target, changed copy/context, requested languages, and acceptance criteria. Ask for the missing destination or mechanism before submitting it. Do not invent a bot command, project, issue type, field ID, sprint, or status.

## Reuse, submit, and verify

Search comments, issue links, and the documented localization system before creating anything. Reuse the matching request and tracker. A pending or failed bot response is a request to diagnose or resume, not permission to post the command again.

Use the verified request mechanism only when no matching request exists. Provide concise translator-facing context and explicit language scope. For multiline comments, use a structured API argument or a body file; never interpolate content into shell code.

Read the workflow result and resulting request's actual language fields. A posted comment is not proof that a request exists. If observed scope differs from the authorized request, explain and correct it only within the allowed action scope. Preserve unrelated edits and intentional translator decisions.

Create a tracker only if the repository process or user requires it. Resolve the actual project, issue type, relationships, owner, and status. Reuse a linked tracker and verify real relationships rather than relying only on a URL in a description.

On timeout or uncertain delivery, read back the destination before retrying. Preserve existing request IDs and return a resume point. Request explicit retry authorization if the prior submission definitively failed. Do not create a second request as a workaround for missing access.

## Finish

Return the verified request/tracker links, languages, observed status, and any missing access or coverage. Distinguish submitted, accepted, in progress, and completed. Do not claim translation availability from a requested language preset alone.

Organization-specific conventions belong in the target repository's maintained instructions or a separately installed adapter. This public skill supplies no company-specific defaults.
