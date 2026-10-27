# Export behavior

CSV and Excel exports use all records matching the active filters, across every table page. Catalog hide-inactive and FG/SEMI filters apply to exports. They do not depend on the visible page size. Authorized queries retain RLS and use stable ordering with range pagination.

Keep human-readable report columns and every source field with completeRecord/recordTable or detailedTable. Nested packing, downtime, staffing, multiple output links, and extra-work data are serialized without dropping values. Long Excel cells are split into numbered columns so data is not truncated. CSV uses UTF-8 BOM and spreadsheet formula escaping. Blank count templates retain their import schema.

Workstation exports contain one row per output link and one per input. Never group away distinct source links. BOM exports separate FG and SEMI recipes, retain all ingredient and packaging rows, and include pieces per box, boxes per pallet, shipping dimensions, waste, version, and notes.

Progress Report omits the sessions/active-lines/low-production KPI strip. Those indicators belong to Dashboard, in web and native clients.

Run node tests/export-completeness.mjs after changing export shaping or pagination.
