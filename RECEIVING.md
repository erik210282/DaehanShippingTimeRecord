# Receiving

Receiving uses the common catalog based on Shipping: products, suppliers, locations, material types, PO, Shipper and activities. FG products have one Shipping product ID linked to one inventory item ID; RAW and PACKAGING use the same inventory catalog. All departments render the same Catalogos component. Product queries explicitly request permitted columns and keep unit_cost protected.

## Activation

The receiving_operations migration was applied to production on 2026-09-30 with explicit owner authorization. Transactional operational and permission regression tests passed against the activated schema.

Web entry: `/departamento/receiving`. Quality members may use this route to review receipts and explicitly quarantine a received product. They cannot edit Receiving catalogs or execute its operational activities without Receiving access.

## Setup

1. An assigned department supervisor or leader creates suppliers with structured address and phone in the shared Catalogs.
2. Create active locations. Existing STORAGE locations are putaway destinations; the receiving dock is assigned automatically, and material types describe RAW, FG, PACKAGING or quarantine use.
3. Add or edit RAW, FG and Packing materials, including minimum inventory, units, responsible department and permitted storage locations. Part numbers are unique across departments, ignoring case and surrounding spaces. FG edits preserve Shipping's packaging and weight fields.
4. No location assignments means all active locations are available. An assignment to an inactive location does not trigger an unrestricted fallback.
5. Department memberships and users are managed in the main menu; Receiving has no duplicate Users menu. Inactive users cannot start activities.

## Operator flow

Capture manifest/invoice, optional PO number, supplier, dock, trailer and expected quantities, then start unloading. Finish with actual quantities, damaged quantities and damage notes. Shortage/surplus comes from actual minus expected quantities. Received quantities are posted once to the inventory ledger on finish, available by default. Damaged quantities are reported without automatically quarantining stock.

Quality or a Receiving supervisor explicitly places a received product/lot in quarantine. Its quantity moves from the source category to HOLD in the existing inventory ledger. Quality release/rejection uses the existing Quality inventory RPC. Quality status is independent from physical storage.

Putaway reserves quantity atomically, permits partial loads and multiple destinations, and honors product/location assignments. A held or rejected product can still be physically put away. Putaway posts equal transfer debit/credit entries, never a second receipt. There is no cancellation control; pause the activity to start other work. Historical canceled activities are hidden.

Receipt colors follow Shipping: yellow pending, blue running/partially put away, orange paused, green fully put away. Quarantine is a separate red badge and keeps fully stored receipts visible until explicitly resolved in Quality. Quality inventory displays held/released/rejected cases on web and mobile; only its supervisor or an administrator can release/reject a case. Productivity excludes paused seconds, credits all recorded participants and does not combine mixed units into a units/hour metric.

Start Activity records the authenticated operator and optional additional active operators assigned to Receiving. All participants can pause/resume/finish their activity. Paused activities remain recorded while another starts; one operator cannot participate in overlapping running Receiving tasks. Finish reviews unloaded quantities before completing the receipt. The mobile selectors use Shipping's dropdown list without a search box.

Receiving, Inventory and shared Catalogs subscribe to committed database changes. Changes refresh the visible snapshot without Refresh buttons or periodic polling. Inventory item changes emit a safe catalog version notification rather than publishing the protected cost column. The existing pull-to-refresh gesture remains available on mobile. Department menus contain no Users entry; users are managed in the global settings menu.

## Verification

- Web production build and focused ESLint passed.
- Expo exports passed for Android, iOS and web.
- Rollback SQL tests passed for idempotent receipts, damage/overage, pause/resume, partial putaway, quantity reservations, cancellation, explicit quarantine, Quality release, permitted destinations, role boundaries and denied anonymous/unauthorized access.
- Browser checks passed for web forms and menus plus mobile damage adjustment, supplier dropdown, touch targets of at least 48px, English/Korean language changes and absence of an operator stopwatch.

SQL operational functions live in the existing private `rls_internal` schema, explicitly authenticate active users and check departments/roles. Public functions are invoker wrappers, operational tables are read-only to clients, and the status view uses `security_invoker=true`.

## Catalog update (2026-09-30)

Material types can be created and mapped to an inventory category. Quarantine types are available only for locations. Product catalog changes preserve Shipping-linked items. LOT is hidden in new receipts; historical lots remain intact. Modal dropdown portals render above Receiving dialogs. SQL regression coverage: tests/receiving-catalog.sql (run inside BEGIN/ROLLBACK).

Unified catalog and operator/quarantine regression coverage: tests/unified-catalogs.sql, run inside BEGIN/ROLLBACK. Shipping activity workflow files remain unchanged.

## Automatic receiving area

New receipts are assigned by the server to the protected Receiving staging area. Operators do not enter or select an area when unloading. Storage is selected only during putaway. The system staging area is excluded from catalog editing, product assignments and putaway destinations. Unloading requires active suppliers and products, not preloaded destination locations. Historical receipts and their original inventory locations remain intact.

Department form controls now use Shipping’s DropDownPicker and button shape/palette. Android/web show inline dropdown lists; iOS uses the same modal list mode as Shipping. Receiving and Inventory share these controls.
