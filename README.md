# Selkie Sample Sale Invoice Generator

A browser-based tool for organizing sample-sale purchases and creating buyer invoices. The app is a self-contained static site; its interface, sample purchase data, and application logic live in `index.html`.

## Features

- Search buyers and view invoice totals, purchase details, tax, and finder’s fees.
- Add purchase items or import a custom CSV.
- Set Venmo and PayPal details for invoices.
- Copy or preview a Messenger-ready invoice message.
- Export Messenger invoice details to CSV, or download all buyer Messenger receipts as individual text files in a ZIP archive.
- Print or save the selected invoice as a PDF, or download all buyer invoices as a ZIP of PDFs.

## Run locally

No build or package installation is required. Open `index.html` in a modern browser, or serve the repository directory with any static web server. The app loads its styling, icons, and PDF-generation libraries from external CDNs, so an internet connection is needed for those resources.

## Import purchase data

Select **Load Custom CSV** and upload a `.csv` file or paste CSV text. Include a header row and purchase rows with these fields:

| Field | Description |
| --- | --- |
| `Buyer` | Buyer’s name |
| `Item Name` | Name of the purchased item |
| `Receipt Name` | Receipt or item label |
| `Cost` | Item cost |
| `Tax` | Sales tax |
| `Finders Fee` | Finder’s fee |

The app also recognizes common header variations such as `Customer`, `Product`, `Receipt`, `Price`, and `Commission`, including reordered columns. Buyer, item name, and cost are required; omitted tax and finder’s fee columns default to zero. Amounts must be non-negative with at most two decimal places; dollar signs and properly grouped thousands separators are accepted. Standard CSV double quoting supports commas, escaped quotes, and multiline fields.

Importing valid data replaces the current purchase list and clears the buyer search. Invalid records leave the existing purchases unchanged and display an error. Invoice and Messenger totals share the same cent-rounded protection fee, and invoice numbers include a buyer sequence to distinguish buyers with the same initials. Bulk PDF exports include all pages of long invoices and use distinct filenames for buyers whose names sanitize to the same filename.

## Data and privacy

Purchases are held in browser memory and are not saved by the app; adding or importing items is temporary and the initial sample data returns when the page is reloaded. Venmo and PayPal details are saved in the browser’s local storage on that device. Avoid entering sensitive information on a shared device.

## Deploy

The included GitHub Actions workflow deploys the static site to GitHub Pages when changes are pushed to `main`. It can also be started manually from the repository’s Actions tab. Configure GitHub Pages to use GitHub Actions if it is not already enabled.

## Tests

Run `node --test tests/app.test.cjs` with a modern Node.js version. The regression tests use only Node’s built-in modules; no package installation is required.
