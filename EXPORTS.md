# Export behavior

CSV and Excel exports use all records matching the active filters, across every table page. Catalog hide-inactive and FG/SEMI filters apply to exports. They do not depend on the visible page size. Authorized queries retain RLS and use stable ordering with range pagination.

CSV exports use explicit per-page user field projections and userCsvTable. Never append source rows, database IDs, audit timestamps/authors, Data columns, or serialized JSON. Resolve relation IDs to display names or business codes; unavailable references stay blank. User-entered dates, notes and BOM versions remain valid business fields. Format packaging, downtime and staffing as readable columns/text. CSV uses UTF-8 BOM and spreadsheet formula escaping. Blank count templates retain their import schema.

Workstation exports contain exactly six columns in this order: Code, Name, Machine Type, Output Products, Input Materials, Status. Use one row per workstation and include every configured output/input in its respective cell. Never append internal source fields or create extra rows for individual links. BOM exports separate FG and SEMI recipes, retain all ingredient and packaging rows, and include pieces per box, boxes per pallet, shipping dimensions, waste, version, and notes.

Progress Report omits the sessions/active-lines/low-production KPI strip. The machine cards and those indicators belong only to Dashboard, in web and native clients. Progress keeps its history and a session capture selector.

Run node tests/export-completeness.mjs after changing export shaping or pagination.

Catalog navigation exposes a single BOM entry with Finished Goods and SEMI as internal buttons. Machine Parameters places Out Of Range below the date inputs, before the other filters, in both clients.
