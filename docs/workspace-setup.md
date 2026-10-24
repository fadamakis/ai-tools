# Optional workspace distribution

Independent users can install directly from the Git marketplace. A workspace admin can instead import `https://github.com/fadamakis/ai-tools`, leave the path empty, and select the `releases` branch under **Admin → Plugins → Add → Import marketplace**. Enable the intended roles and required apps separately. Each member connects their own account.

The public marketplace deliberately contains no workspace listing IDs. If the workspace already has these plugins, preserve their verified canonical identities before importing or switching management. Do not assume matching display names identify the same listing and do not create duplicates.

Maintain a separate **private** catalog/configuration mapping names to the workspace's verified plugin IDs. For explicit private packaging, `node scripts/release.mjs --workspace-ids /absolute/path/to/private/workspace-plugins.json --output /absolute/path/to/private/packages` retains the optional mapping behavior. Never commit that mapping or publish the bound catalog to the public `releases` branch. The normal GitHub publishing script always generates an unbound catalog.

Admin import supports daily sync and an explicit **Sync now** request. These workspace controls are separate from independent users' Git refresh procedure. Repository access and admin permission do not imply members have access to external services.

Confirm identity, sharing, installed version, and native activation on a pilot computer after import. See [OpenAI workspace documentation](https://learn.chatgpt.com/docs/enterprise/plugin-management) and [updates](updates.md).
