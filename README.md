# DataCanvas

DataCanvas turns a spreadsheet into an interactive dashboard in your browser. Open a CSV, TSV, or Excel workbook, then filter, chart, inspect, and export your data. Reliable imports open directly. When the file needs a decision, DataCanvas shows the fields to check. The app includes five synthetic samples covering sales, expenses, traffic, inventory, and surveys.

## Run locally

Use Node.js 22.12+ or 24 LTS.

With GNU Make installed, run `make` for the command list.

```sh
make install
make dev
```

Use `make check` for lint, typecheck, and data tests. Run `make install-browser` once before `make test-e2e`. Use `make build` to produce `dist/` or `make preview` to build and serve it locally.

The equivalent npm commands work without Make.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. **Your work** reopens spreadsheets, drafts, filters, chart settings, and table position. DataCanvas saves them in IndexedDB on this browser and site. Browser Back and Forward restore those workspaces, including after a reload. Use the trash button on Import to remove a workspace. If browser storage is blocked or full, work remains available in the open tab and DataCanvas reports the save failure. Clearing site data removes saved work.

Uploading an identical file reopens its saved analysis, including filters and column choices. Files are matched locally by their bytes and parsing format, so renaming a copy does not duplicate it, while changed contents stay separate. Older duplicate listings are consolidated around the most recent completed analysis when available. Their existing history entries remain readable until the workspace is removed.

**Edit columns** opens an optional draft with column details collapsed. **Undo change** reverses settings within the current worksheet. **Apply changes** updates the dashboard and **Cancel** discards the draft. Leaving through browser Back keeps the draft available to resume. Overview and Data table are views within the dashboard. Imports run in a browser worker. Fonts, scripts, and samples ship with the app. DataCanvas has no account, server-side data store, or analytics service.

The shared header stays mounted across the landing page, Import, column settings, and Dashboard. It adapts to the workspace width and shows contextual navigation. The header’s **Dashboard** link leaves column settings as a resumable draft. Route changes use brief, interruptible browser animations that keep chart and table positions fixed. Keyboard navigation and reduced-motion preferences skip those animations, and browsers without the animation API navigate immediately. Hash URLs keep static hosting compatible, with workspace restoration attached to browser history. Page titles and focus identify the destination.

## Import and analysis

- Put headers in the first populated row and one record in each subsequent row. DataCanvas renames empty or duplicate headers, pads short delimited rows, and reports skipped rows with extra fields. Broken CSV quoting stops the import.
- Delimited files support UTF-8 and UTF-16 with a byte order mark. CSV can use commas, semicolons, tabs, or pipes and accepts an Excel `sep=` directive. Review shows the delimiter and lets you reparse. When multiple delimiters fit, choose one and check the interpreted values before opening the dashboard. Workbook imports use one visible worksheet at a time and read saved formula results. Blank or uncached results remain missing. Workbook dates respect the 1900 or 1904 date system, and Excel-formatted currencies and percentages keep their numeric values when the locale setting changes.
- The limits are 15 MB per file, 120 MB expanded workbook size, 100,000 data rows, 100 columns, 1,000,000 cells, and 32,767 characters per data cell. Larger schema updates run in a cancellable worker. Exporting a single sheet as CSV can help with large workbooks.
- Review shows a readiness summary and only the affected columns. Expand the full list and individual columns to compare source and interpreted values or edit reliable settings. Ambiguous delimiters, dates, numeric separators, percentage scales, and currency semantics require a decision before analytics can use them. Choose a format or type, or explicitly accept the displayed exclusions. An exclusion acknowledgment applies only to that interpretation and must be renewed if its settings change. An unspecified dollar symbol requires a currency code or a text type. Review and the dashboard’s **Data quality** disclosure explain excluded or missing values. Mixed currencies require selecting one unit and evaluating the explicit amounts in that unit. A conflicting source currency excludes unmarked amounts until you explicitly assign the selected unit. Source exports retain the original header and values.
- Numeric defaults depend on what the column represents. Revenue and stock counts usually start as totals, while rates and ratings start as averages. A percentage average is the mean of valid rows, with each row weighted equally. Use the aggregation control to choose what the chart calculates.
- Add, edit, or remove conditions and choose **Match all (AND)** or **Match any (OR)**. Operators depend on column type and numeric inputs use the column’s number format. Ranges include both bounds, and **Is missing** includes blank or invalid normalized values. Applied conditions drive dashboard totals, charts, the table, and exports. If a schema change removes a filter, confirm the revised scope before exporting. Table search stays local to the table and its export.
- Date charts exclude missing dates, use Monday-start weeks, and leave gaps when periods have no usable values. A partial period at either end shows its observed date range and distinct days. Charts also note sparse dated records within a period. The primary chart displays up to 36 observed periods or 12 ranked categories and its CSV includes all groups.
- **Filtered rows** exports source values for the rows selected by dashboard filters. **Chart values** exports the current grouping, metric, contributing record counts, and valid value counts. **Export table** follows its current search, sort, and source-value toggle, across all matching pages. CSV text with formula-like prefixes is escaped for spreadsheet applications.
- **Dashboard image** downloads a high-resolution PNG with the current KPIs, chart, available category breakdown, and every applied condition. **Dashboard report** adds the conditions on one or more pages of a landscape, image-based PDF. **Accessible report** is a standalone HTML document with the full conditions, KPIs, and chart values in semantic tables. Use CSV for the underlying values.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

The browser suite builds the static app and checks CSV, TSV, and XLSX imports, worksheet switching, column corrections, all five sample dashboards, multi-condition filtering, keyboard chart inspection, table navigation, CSV/PNG/PDF downloads, and narrow screens. To use an installed Chrome or Edge, set `PLAYWRIGHT_CHANNEL` to `chrome` or `msedge`.

## Deploy

```sh
npm run build
npm run preview
```

Publish `dist/` on a static host. The included `netlify.toml` sets the build command and publish directory. Relative asset paths and hash navigation support subdirectory hosting without server rewrites.

Spreadsheet parsing, type inference, analysis, and CSV output are in [src/data](src/data). The landing page, import review, dashboard, and visual components are in [src/ui](src/ui).
