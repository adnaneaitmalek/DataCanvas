# DataCanvas

DataCanvas turns a spreadsheet into an interactive dashboard in your browser. Open a CSV, TSV, or Excel workbook, review the detected column types, then filter, chart, inspect, and export your data. The app includes five synthetic samples with different structures for exploring retail sales, expenses, traffic, inventory, and surveys.

## Run locally

Use Node.js 22.12+ or 24 LTS.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. Files and dashboard settings live in the current tab’s memory. Imports run in a browser worker. Fonts, scripts, and samples ship with the app, and the app has no account, API, analytics service, or database.

## Import and analysis

- Put headers in the first populated row and one record in each subsequent row. DataCanvas renames empty or duplicate headers, pads short delimited rows, and reports skipped rows with extra fields. Broken CSV quoting stops the import.
- Delimited files support UTF-8 and UTF-16 with a byte order mark. CSV can use commas, semicolons, tabs, or pipes. Excel imports one visible worksheet at a time and reads saved formula results. Blank or uncached results remain missing.
- The limits are 15 MB per file, 120 MB expanded workbook size, 100,000 data rows, 100 columns, 1,000,000 cells, and 32,767 characters per data cell. Exporting a single sheet as CSV can help with large workbooks.
- Review lets you correct types, date order, decimal separators, currency, and percentage scale. Ambiguous dates and separators stay missing until there is enough evidence or you choose a format. Mixed currencies require selecting a single compatible unit and are never converted. An unspecified dollar symbol stays unspecified.
- Numeric defaults depend on what the column represents. Revenue and stock counts usually start as totals, while rates and ratings start as averages. A percentage average is the mean of valid rows, with each row weighted equally. Use the aggregation control to choose what the chart calculates.
- Filters combine with AND. Date charts exclude missing dates, use Monday-start weeks, and leave gaps when periods have no usable values. The primary chart displays up to 36 observed periods or 12 ranked categories and its CSV includes all groups.
- **Filtered rows** exports source values for the rows selected by dashboard filters. **Chart values** exports the current grouping, metric, contributing record counts, and valid value counts. **Export table** follows its current search, sort, and source-value toggle, across all matching pages. CSV text with formula-like prefixes is escaped for spreadsheet applications.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

The browser suite builds the static app and checks CSV, TSV, and XLSX imports, worksheet switching, column corrections, all five sample dashboards, filtering, keyboard chart inspection, table navigation, CSV downloads, and narrow screens. To use an installed Chrome or Edge, set `PLAYWRIGHT_CHANNEL` to `chrome` or `msedge`.

## Deploy

```sh
npm run build
npm run preview
```

Publish `dist/` on a static host. The included `netlify.toml` sets the build command and publish directory. Relative asset paths and hash navigation support subdirectory hosting without server rewrites.

Spreadsheet parsing, type inference, analysis, and CSV output are in [src/data](src/data). The landing page, import review, dashboard, and visual components are in [src/ui](src/ui).
