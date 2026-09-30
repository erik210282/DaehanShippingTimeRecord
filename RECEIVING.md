# Receiving

Receiving is separate from Shipping. It uses the shared `inventory_items` catalog for RAW, PACKAGING and Receiving-owned FG materials. It does not modify Shipping tables, validation, catalogs or activity logic. All departments share the application header and DepartmentNav; Announcements is reached through the main menu. Product queries explicitly request permitted columns and keep unit_cost protected.

## Activation

The receiving_operations migration was applied to production on 2026-09-30 with explicit owner authorization. Transactional operational and permission regression tests passed against the activated schema.

Web entry: `/departamento/receiving`. Quality members may use this route to review receipts and explicitly quarantine a received product. They cannot edit Receiving catalogs or execute its operational activities without Receiving access.

## Setup

1. A Receiving supervisor or leader creates suppliers with structured address and phone in Catalogs.
2. Create active locations. Existing STORAGE locations work as receiving areas and putaway destinations; material types describe RAW, FG, PACKAGING or quarantine use.
3. Add or edit RAW, FG and Packing materials, including units and permitted storage locations.
4. No location assignments means all active locations are available. An assignment to an inactive location does not trigger an unrestricted fallback.
5. Department memberships and users are managed in the main menu; Receiving has no duplicate Users menu. Inactive users cannot start activities.

## Operator flow

Capture manifest/invoice, optional PO number, supplier, dock, trailer, staging location and expected quantities, then start unloading. Finish with actual quantities, damaged quantities and damage notes. Shortage/surplus comes from actual minus expected quantities. Received quantities are posted once to the inventory ledger on finish, available by default. Damaged quantities are reported without automatically quarantining stock.

Quality or a Receiving supervisor explicitly places a received product/lot in quarantine. Its quantity moves from the source category to HOLD in the existing inventory ledger. Quality release/rejection uses the existing Quality inventory RPC. Quality status is independent from physical storage.

Putaway reserves quantity atomically, permits partial loads and multiple destinations, and honors product/location assignments. A held or rejected product can still be physically put away. Putaway posts equal transfer debit/credit entries, never a second receipt. Cancelling a putaway task returns its reserved quantity to pending work.

Receipt colors: yellow pending, blue running/partially put away, orange paused, green fully put away, gray cancelled. Quarantine is a separate red badge. Productivity excludes paused seconds and does not combine mixed units into a units/hour metric. Date filters for productivity use the activity start date, while receipt filters use receipt creation date.

## Verification

- Web production build and focused ESLint passed.
- Expo exports passed for Android, iOS and web.
- Rollback SQL tests passed for idempotent receipts, damage/overage, pause/resume, partial putaway, quantity reservations, cancellation, explicit quarantine, Quality release, permitted destinations, role boundaries and denied anonymous/unauthorized access.
- Browser checks passed for web forms and menus plus mobile damage adjustment, supplier dropdown, touch targets of at least 48px, English/Korean language changes and absence of an operator stopwatch.

SQL operational functions live in the existing private `rls_internal` schema, explicitly authenticate active users and check departments/roles. Public functions are invoker wrappers, operational tables are read-only to clients, and the status view uses `security_invoker=true`.

## Catalog update (2026-09-30)

Material types can be created and mapped to an inventory category. Quarantine types are available only for locations. Product catalog changes preserve Shipping-linked items. LOT is hidden in new receipts; historical lots remain intact. Modal dropdown portals render above Receiving dialogs. SQL regression coverage: tests/receiving-catalog.sql (run inside BEGIN/ROLLBACK).
