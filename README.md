# SnapEx

View, edit and remove photo metadata (EXIF, GPS, IPTC, XMP, ICC) entirely in the browser. Photos are never uploaded.

## Pages

| Path       | File           | What it is                                                        |
|------------|----------------|-------------------------------------------------------------------|
| `/`        | `index.html`   | Upload / Load-from-URL landing, then the metadata workspace       |
| `/help`    | `help.html`    | User guide: getting started, features, troubleshooting, privacy   |
| `/faq`     | `faq.html`     | Frequently asked questions                                        |
| `/privacy` | `privacy.html` | Privacy policy                                                    |
| `/contact` | `contact.html` | How to reach us (GitHub issues)                                   |

Shared styles live in `styles.css`; all app logic is in `app.js`.

## Features

- **Viewer**: camera-style exposure summary and every tag grouped by section, with a filter.
- **Privacy check**: rates what the photo reveals as high, medium or low risk.
- **Location map**: plots GPS coordinates on OpenStreetMap (Leaflet).
- **Thumbnail tools**: view, download, rebuild or remove the embedded JPEG thumbnail.
- **Editor** (JPEG): camera, lens, date taken, artist, copyright, description, software; drop GPS or serial numbers.
- **Remover**: lossless for JPEG and PNG, with an option to keep the color profile; WebP is re-encoded.
- **Export**: copy or download all metadata as JSON.

Libraries load from CDNs: [exifr](https://github.com/MikeKovarik/exifr), [piexifjs](https://github.com/hMatoba/piexifjs) and [Leaflet](https://leafletjs.com).

## Deploy

Static site, no build step. Pushing to `main` redeploys on Vercel. `vercel.json` enables clean URLs (`/help` instead of `/help.html`).
