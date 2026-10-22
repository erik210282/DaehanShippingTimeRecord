# Daehan App UI Contract

This contract applies to web, the embedded Shipping web screens, Expo Web, Android and iOS, every department and every role. Roles control availability, never colors or dimensions.

| Intent | Color | Actions |
| --- | --- | --- |
| create | Blue #2563EB, white text and plain white + | Add, Create, New Session, open a new capture/report |
| confirm | Green #15803D, white text | Save, Start, Finish, Next, Apply, Confirm, Approve, Submit |
| neutral | Black #111111, white text | Edit, Search, Clear Filters, Export, Refresh, Back, Close, Pause/Resume, Reopen |
| danger | Red #DC2626, white text | Cancel, Delete, Force Finalization |

Pass intent explicitly at the call site. Do not infer colors from translated labels or a user's role. Do not override colors/padding/fonts in page CSS. Legacy tone primary maps to create, secondary/edit to neutral, danger to danger; migrate new actions to intent.

Controls: 44px minimum height; buttons 14px/600 and 20px line height, padding 11px 14px, radius 10px. Inputs/selects: #333 background, #FFF value text, #C4C4C4 placeholder, #555 border, 16px text, 22px line height. Textareas expand. Small priority arrows are the documented icon-control exception. Never apply full-width form styles to priority values or pagination.

Action groups align LEFT and wrap, with an 8px gap. Adding or removing an authorized button must not recenter existing actions. Table widths belong to columns, not to the number of actions. Keep narrow tables horizontally scrollable on phones; never shrink numbers to invisibility.

Titles, action captions, navigation labels and field labels use Title Case per word, preserving RAW/SEMI/FG/WIP/BOM/BOL/IDX/PO/PN/PDF/CSV/XLSX/UPH/KPI/ID/DOCK and part numbers. Explanatory text, captured data and catalog values keep their original text. Use a plain +, never the emoji ➕.

Before release, verify actual Shipping Pending/Summary/Records/Finish/BOL/Productivity, Production forms/reports/settings, Receiving, Inventory, Catalog and Users in ES/EN/KR. Cover Admin, Supervisor, Leader and Operator with appropriate permissions at phone/tablet/desktop widths. Test additional actions, long captions, nonempty priority/page-size values and dark fields.


Production reopening: require local date and 24-hour time, select every eligible product in the machine session by default, allow deselection. Future requests stay closed until due; failures remain visible and cancellable. Normal finishing also selects all products by default. Force Finish requires Production Leader/Supervisor/Admin access, an audited reason, and retains recorded totals. If there are no new pieces, it restores the previous closure. It must never invent quantities to satisfy a comparison. Posted inventory reports remain protected. Scheduled reopen jobs run every minute and record the chosen effective time.


Filters use bounded date/search/select widths and share a left-aligned wrapping row with actions when space permits. Do not stretch three filters across the entire viewport. At narrower widths wrap cleanly without shrinking controls below readable widths. Form field captions reserve a consistent row height so inputs/selects and action buttons align.
Daily machine reports default to all ready products in the same original machine session. Ask before including unfinished/missing parts. Preserve per-product times/downtime; group PDF sheets only when times, staff, downtime and extra work match. Packing captures one box count per distinct BOM variant and validates the sum against good pieces. Extra Time means work during Break/Lunch, with minutes and people; extra minutes cannot exceed breaks and labor includes only the extra people recorded. Clock help must explicitly show 1000 (10:00), 24-hour format in ES/EN/KR.
