# SnapEx

View, edit and remove photo metadata (EXIF, GPS, IPTC, XMP, ICC) entirely in the browser. Photos are never uploaded.

- **View** every tag, grouped by section, with an exposure summary and privacy flags (GPS, serial numbers, owner names).
- **Edit** JPEG fields: camera, lens, date taken, artist, copyright, description, software; remove GPS or serial numbers.
- **Remove** all metadata: lossless for JPEG and PNG (the rotation flag is kept), re-encoded for WebP.
- **Export** metadata as JSON.

It is a single static `index.html`. Libraries ([exifr](https://github.com/MikeKovarik/exifr) and [piexifjs](https://github.com/hMatoba/piexifjs)) load from jsDelivr.

## Deploy

```
vercel deploy --prod
```

Or open `index.html` directly in a browser.
