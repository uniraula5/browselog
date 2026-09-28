# Build plan

Build one working piece at a time, usually around 300 changed lines per commit.
Keep commits local unless publishing is requested. Update the README as features land.

| Phase | Planned commits |
| --- | --- |
| 1. Skeleton | added extension setup and popup; saved visited pages locally |
| 2. Timing | tracked time on the focused tab; stopped counting idle and inactive time; handled browser restarts and saved session checkpoints |
| 3. Content | recorded supported search queries; tracked youtube videos and shorts; separated video playback from browsing time |
| 4. Categories | added content categories and personal rules; added category corrections to the timeline |
| 5. Dashboard | added daily and weekly activity summaries; added timeline filters and browsing breakdowns |
| 6. Release | added exclusions history controls and export; documented setup limitations and first release |

## Next milestone

Visit history and pause are implemented. Next: track time on the focused tab.
Keep background visits separate from engaged time. Idle detection and restart
recovery follow in their own commits; do not label early timing as attention.

## Decisions for later phases

- Use IndexedDB for records and Chrome storage for settings.
- Count engagement only in the selected tab of the focused browser window.
- Start with a configurable 60-second inactivity threshold.
- Keep video playback separate; overlapping intervals must not inflate totals.
- Keep topic, format, and purpose as separate labels. Allow unknown labels.
- Test timing transitions, restart gaps, classification, and search parsing.
- Review useful Rep utilities and Shorts detection before adapting them.

AI classification, blocking, other social platforms, and sync are stretch goals.
