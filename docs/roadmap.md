# Build plan

Build one working piece at a time, usually a few hundred changed lines per commit.
Keep commits local unless publishing is requested. Update the README as features land.

| Phase | Planned commits |
| --- | --- |
| 1. Skeleton | added extension setup and popup; saved visited pages locally |
| 2. Timing | tracked time on the focused tab; stopped counting idle and inactive time; handled browser restarts and saved session checkpoints |
| 3. Content | recorded supported search queries; tracked youtube videos and shorts; separated video playback from browsing time |
| 4. Categories | added content categories and personal rules; added category corrections to the timeline |
| 5. Dashboard | added daily and weekly activity summaries; added timeline filters and browsing breakdowns |
| 6. Release | added exclusions history controls and export; documented setup limitations and first release |
| 7. Local learning | used manual corrections as local examples; labeled similar videos and repeated site patterns; added reset and export controls |

## Current milestone

Search queries, individual YouTube videos and Shorts, playback intervals, and
basic content labels are recorded. The activity dashboard has corrections and
summaries that subtract overlapping active and playback time. Site rules,
exclusions, deletion, and export were implemented in version 0.1. Version 0.2
learns cautious patterns from manually corrected visits. Future work can add
more search engines and broader same-page tracking.

## Decisions for later phases

- Use IndexedDB for records and Chrome storage for settings.
- Count engagement only in the selected tab of the focused browser window.
- Start with a configurable 60-second inactivity threshold.
- Keep video playback separate; overlapping intervals must not inflate totals.
- Keep topic, format, and purpose as separate labels. Allow unknown labels.
- Test timing transitions, restart gaps, classification, and search parsing.
- Review useful Rep utilities and Shorts detection before adapting them.

Remote AI classification, blocking, other social platforms, and sync remain
stretch goals.
