# Loop and Filter Requirements

**Status:** Product requirements confirmed; v2 implementation pending.
**Confirmed:** 2026-09-27
**Owner:** AbuZar-Babar — product owner / integrator

This document records the agreed behavior for normal replay, repeated-item loops, filters, previews, and item limits. It is the product-level contract for Tasks 6, 12, and 13 in [the multi-agent work plan](MULTI-AGENT-WORK-PLAN.md). It describes intended behavior; it does not claim that the end-to-end feature is already implemented.

## 1. Normal Replay and Loop Marker

- A workflow without a loop marker replays once as a normal macro.
- A workflow may have one loop-start marker selected in the workflow editor.
- Steps before the marker run once.
- The marked step and every later step repeat for each selected discovered item.
- Version 1 has no separate loop-end marker. Actions that should run once after all items are processed are outside the initial loop feature.
- The loop operates on the discovered result set. Current-page discovery remains the scope until pagination is explicitly implemented and validated.

## 2. Filter Contract

Filters are evaluated against fields extracted from each discovered item. A configured filter must contain one or more conditions. `matchMode` defaults to `all` (AND); users may select `any` (OR). Any other match mode or an empty condition list is a configuration error.

```json
{
  "itemFilter": {
    "matchMode": "all",
    "conditions": [
      { "field": "Status", "operator": "equals", "value": "Open" },
      {
        "field": "Due Date",
        "operator": "dateBetween",
        "value": { "from": "2026-01-01", "to": "2026-01-31" }
      }
    ]
  },
  "loopLimit": 10
}
```

Supported condition operators:

- `contains`: case-insensitive substring match after trimming text values.
- `equals`: case-insensitive exact text match after trimming text values.
- `dateBetween`: both required filter endpoints use strict `YYYY-MM-DD` date-only values. Both endpoints are inclusive, and `from` must not be after `to`. Source item dates must be parsed deterministically as calendar dates; ambiguous or unparseable values do not match and must include a skip reason.

An omitted or `null` `itemFilter` accepts every discovered item. A configured field absent from the discovery field schema is a configuration error and blocks execution; the engine must never silently fall back to searching the whole row. If an individual item has a missing or unparseable value for a date condition, that condition does not match and the preview explains why the item was skipped.

Legacy `{ field, operator, value }` filters and `rowFilter` / `filterColumn` + `filterValue` payloads normalize to one condition. Legacy text filters default to `contains`. Legacy payloads do not express multiple conditions or date ranges.

## 3. Limit and Attempt Semantics

- `loopLimit` omitted or `null` means process all items that pass the filter.
- Otherwise `loopLimit` must be a positive integer.
- Filtering happens before the limit. The limit selects the first N matching items in discovery order.
- Each selected item consumes one limit slot when its item workflow begins, regardless of whether it later succeeds or fails.
- An item retry remains part of that item's attempt and does not consume another slot. A filtered item or an item beyond the limit does not count as attempted.
- Items beyond the limit are visibly skipped with status `SKIPPED_LIMIT`; filter mismatches use `SKIPPED_FILTER`.
- A failed selected item does not cause a later matching item beyond the limit to be substituted.

Example: if 18 items are discovered, 12 match, and the limit is 5, the run selects the first 5 matches, marks 6 nonmatches as `SKIPPED_FILTER`, marks the remaining 7 matches as `SKIPPED_LIMIT`, and begins at most 5 item workflows. Those 5 count as attempted even if some fail.

## 4. Preview and Execution Agreement

Discovery preview takes the selected `loopStepIndex` and optional `itemFilter` / `loopLimit`. Preview and execution use the same field extraction, normalization, filter, discovery order, and limit rules. Preview reports at least:

- `totalCount`: discovered items before filtering;
- `matchingCount`: items matching the filter before applying the limit;
- `selectedCount`: items selected after applying the limit;
- `skippedFilterCount` and `skippedLimitCount`;
- representative selected, filter-skipped, and limit-skipped items with reasons;
- `errors`: configuration-level validation errors.

Execution is blocked when configuration errors exist or when no items are selected. At runtime, attempted, succeeded, failed, retry, and skipped counters must agree with per-item terminal states and the persisted manifest/SSE updates.

## 5. Out of Scope for This Contract

Pagination across pages, infinite scroll, a second loop boundary, post-loop teardown actions, locale-dependent free-form date parsing, and filter expressions beyond `all`/`any` are not included. Add these only through separately reviewed requirements.

## 6. Recorded Loop Snapshot and Explicit Refresh

The loop collection discovered during recording is persisted as serializable `loopData` alongside the workflow. It contains the collection structure, available field schema, and a snapshot of item records with extracted fields such as invoice number, type, customer, status, due date, amount, and other portal-specific fields discovered from the collection.

- Opening loop/filter configuration reads the persisted snapshot and does **not** require a browser visit.
- Existing filter rules are configuration state and are not changed when loop data is refreshed.
- `Refresh` explicitly visits the target portal, performs live item discovery, extracts the latest item fields, replaces the persisted snapshot, and re-evaluates the existing filter against the refreshed data.
- The persisted snapshot must never contain Puppeteer `ElementHandle` objects or other live browser references.
- Older workflows without `loopData` may fall back to one live discovery so they can be upgraded to the snapshot model.
- The recorded snapshot is configuration/preview data; execution still resolves live item handles when it needs to interact with the current portal DOM.
