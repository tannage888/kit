# People.template

Example contact files showing the frontmatter schema Kit expects. Copy a file into your real `People/` directory and fill in the fields.

`People/` itself is gitignored (it contains personal data). This template directory is committed so new installs know the layout.

## Tier directories

| Folder | Tier | Typical frequency |
|---|---|---|
| `1 - Inner Circle/` | Tier 1 | Weekly–Monthly |
| `2 - Active/` | Tier 2 | Monthly–Quarterly |
| `3 - Business Contact/` | Tier 3 | Quarterly+ |

## Frontmatter fields

See [`1 - Inner Circle/Example Contact.md`](1%20-%20Inner%20Circle/Example%20Contact.md) for the full annotated example.

Mandatory on creation:
- `name`
- `relationship_tier`
- `frequency`
- `last_contact`
- `next_action`
- `social_battery_cost`
- `whatsapp_capture` (defaults to `disabled`)

The others are recommended — they make Kit's features significantly more useful.

`email` is one of them, and it is a real column on `kit.contacts` — put an address
there rather than in `notes`, or nothing else in Kit can find it. One address per
contact: their current best one. When a corporate address expires, overwrite it.
