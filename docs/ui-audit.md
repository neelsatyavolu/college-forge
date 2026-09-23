# Populated UI audit — 2026-09-22

The audit used an in-memory student fixture, never a real student workspace or live sharing credentials. Screenshots were captured and inspected; DOM checks covered horizontal overflow and visible control labels at 320, 390, 768, and 1440 pixels. Screenshots are local artifacts under `/tmp/forge-ui-audit/`.

| Step | Screen | Result and evidence |
| --- | --- | --- |
| 1 | Overview | Clear next action and saved-work counts. [Desktop screenshot](/tmp/forge-ui-audit/01-overview-1440.png). |
| 2 | Profile | Mobile summary compacted; activities move into the first screen; disclosure has expanded-state semantics. Numeric entries now validate consistently with setup. [Mobile screenshot](/tmp/forge-ui-audit/02-profile-390.png). |
| 3 | Shortlist | Compact mobile counts, readable school controls, visible provisional-category guidance. [Mobile screenshot](/tmp/forge-ui-audit/03-shortlist-390.png). |
| 4 | Essays | Fixed sidebar hiding the mobile editor. Compact labeled picker, useful writing height, visible focus, preserved drafts when switching. [Mobile screenshot](/tmp/forge-ui-audit/04-essays-390.png). |
| 5 | Planner | Stable task identities prevent transferred checkmarks when supplements change. Legacy numeric checks require reconfirmation. [Mobile screenshot](/tmp/forge-ui-audit/05-planner-390.png). |
| 6 | Timeline | Milestones and school deadlines have readable dates and edit controls; inferred years are disclosed. [Mobile screenshot](/tmp/forge-ui-audit/06-timeline-390.png). |
| 7 | Letters and aid | Controls are labeled and failed saves are visible. [Mobile screenshot](/tmp/forge-ui-audit/07-track-390.png). |
| 8 | Compare | School selection remains usable on mobile; the table scrolls within its own region. [Mobile screenshot](/tmp/forge-ui-audit/08-compare-390.png). |
| 9 | Share and export | Confirmation, failures, pending-draft flush, selected downloads, and revocation covered by isolated fixture tests. Live sharing was not performed. [Mobile screenshot](/tmp/forge-ui-audit/09-share-390.png). |
| 10 | Settings | Student-facing connection guidance; retryable errors; explicit provider choice. [Mobile screenshot](/tmp/forge-ui-audit/10-settings-390.png). |
| 11 | Recommendations | Evidence, snapshot date, provisional categories, and source limits remain visible. [Mobile screenshot](/tmp/forge-ui-audit/11-recommendations-390.png). |

## Additional behavior checks

- Copilot no longer blocks page clicks with an invisible full-screen layer.
- Mobile copilot launch closes the navigation drawer; Escape restores focus to a visible launcher.
- Connection refresh outages do not erase stored sign-ins.
- Explicit provider selection never silently sends a prompt through another account; Auto retains fallback behavior.
- Interrupted replies restore the prompt; duplicate Enter submissions are prevented.
- Workspace switches reset conversation state and cannot be undone by stale responses.

## Limits

This is not a claim of complete WCAG compliance or a human screen-reader usability study. The automated checks cover the named screens, labels, keyboard behaviors, and widths; screenshot review covers their visible layout. Provider failures and sharing interactions use synthetic fixtures. A real connected AI reply remains unverified because no accessible account is connected. Live sharing actions were rejected by automatic approval review and were not retried.

## Reproduce

Run `node scripts/serve-audit-fixture.mjs`, then `node scripts/audit-populated-ui.mjs`, `node scripts/test-mobile-writing.mjs`, and `node scripts/test-copilot-navigation.mjs`. The fixture lives only in memory on port 3211 and cannot sign in, share data, or call AI. Stop the fixture process when finished. Component failure tests do not need a server.
