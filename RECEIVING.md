# Receiving

Receiving is separate from Shipping. It uses the shared `inventory_items` catalog only for RAW and PACKAGING materials. It does not modify Shipping tables, screens, validation, catalogs or activity logic.

## Activation

The production migration is pending explicit approval after automatic approval review blocked its application. The implementation has been tested with a transaction that rolls back all Receiving objects and test records. Apply the reviewed `receiving_operations` migration before deploying the web or publishing a mobile update. Do not mark this module as operational before activation.

Web entry: `/departamento/receiving`. Quality members may use this route to review receipts and explicitly quarantine a received product. They cannot edit Receiving catalogs or execute its operational activities without Receiving access.

## Setup

1. A Receiving supervisor or leader creates suppliers/origins in Catalogs.
2. Create at least one active Receiving/Staging location and the storage locations.
3. Add or edit RAW and Packing materials, including units and permitted storage locations.
4. No location assignments means all active storage locations are available. An assignment to an inactive location does not trigger an unrestricted fallback.
5. Receiving supervisors manage department memberships and create department users in Users. Inactive users cannot start activities.

## Operator flow

Capture manifest, supplier, dock, trailer, staging location and expected quantities, then start unloading. Finish with actual quantities, damaged quantities and damage notes. Shortage/surplus comes from actual minus expected quantities. Received quantities are posted once to the inventory ledger on finish, available by default. Damaged quantities are reported without automatically quarantining stock.

Quality or a Receiving supervisor explicitly places a received product/lot in quarantine. Its quantity moves from the source category to HOLD in the existing inventory ledger. Quality release/rejection uses the existing Quality inventory RPC. Quality status is independent from physical storage.

Putaway reserves quantity atomically, permits partial loads and multiple destinations, and honors product/location assignments. A held or rejected product can still be physically put away. Putaway posts equal transfer debit/credit entries, never a second receipt. Cancelling a putaway task returns its reserved quantity to pending work.

Receipt colors: yellow pending, blue running/partially put away, orange paused, green fully put away, gray cancelled. Quarantine is a separate red badge. Productivity excludes paused seconds and does not combine mixed units into a units/hour metric. Date filters for productivity use the activity start date, while receipt filters use receipt creation date.

## Verification

- Web production build and focused ESLint passed.
- Expo exports passed for Android, iOS and web.
- Rollback SQL tests passed for idempotent receipts, damage/overage, pause/resume, partial putaway, quantity reservations, cancellation, explicit quarantine, Quality release, permitted destinations, role boundaries and denied anonymous/unauthorized access.
- Browser checks passed for web forms and menus plus mobile damage adjustment, supplier dropdown, touch targets of at least 48px, English/Korean language changes and absence of an operator stopwatch.

SQL operational functions live in the existing private `rls_internal` schema, explicitly authenticate active users and check departments/roles. Public functions are invoker wrappers, operational tables are read-only to clients, and the status view uses `security_invoker=true`.
