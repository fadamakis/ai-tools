# Changelog

## Public preparation: interface fixes

- Improve active field hints, success and warning badge contrast, and repository-filter readability in light and dark themes.
- Give Shelob disclosures larger targets and visible focus; make code evidence regions keyboard focusable and horizontally scrollable.
- Remove the nested hidden control from Workbench's repository selector while preserving its accessible name and controlled selection.
- Initialize Sauron's standalone preview from the system theme while preserving embedded host themes.
- Add the confirmed product context, contributor audit tooling and scoped automated accessibility coverage. Native activation/chat delivery and narrow WebKit keyboard behavior remain unverified.

## Public distribution preparation — unreleased

- Add independent Git marketplace installation, update, privacy, support, and contribution documentation.
- Update seven dependency resolutions to patched versions and add redacted secret/public-content checks to CI.
- Add the MIT project license to source and release packages; retain bundled third-party notices.
- Publish an unbound public marketplace by default. Private workspace mappings remain an explicit packaging option.
- Keep Workbench's 13 explicit commands and discover localization and verification conventions from the target repository.
- Replace internal guide links and personal development examples with public guidance and synthetic fixtures.
- Use the computer's time zone for Sauron business-hour freshness, with `ATTENTION_TIME_ZONE` as an explicit override.

This preparation retains existing plugin identities, state schemas, data directories, tool names, and compatible resource aliases. Installation and native-host acceptance results belong to the release report; these notes do not assert public availability.
