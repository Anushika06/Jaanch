# Parser test fixtures

Responses captured from official public pages on **2026-10-04**, used only to test parsers
offline:

| File | Captured from |
|---|---|
| `sebi/export-14.xls`, `export-30.xls`, `export-13.xls` | SEBI intermediary Excel exports (`IntmExportAction.do?intmId=…`), trimmed to the title row, the two header rows and the first 15–25 records |
| `sebi/export-23.xls` | SEBI Mutual Funds export, unmodified |
| `sebi/search-*.html`, `sebi/inactive-found.html` | SEBI AJAX search responses (`getintmfpiinfo.jsp`, `getintmfpiinfo2.jsp`) |
| `rbi/alert-list.html` | RBI Alert List page (`bs_viewcontent.aspx?Id=4235`) |
| `rdap/zerodha.com.json` | RDAP response via rdap.org |

These are public records reproduced unmodified (apart from trimming) for parser tests. The
production code always reads the live official sources.
