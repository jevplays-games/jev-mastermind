# Brand image renderer

Run `node assets/src/render.mjs` from the repository root using the installed
Playwright and Chromium. No server, package download or network access is needed.
The renderer opens local `file://` pages, loads self-hosted fonts and SVG artwork,
waits for `document.fonts.ready` and image decoding, and writes:

- `assets/banner.png`: 2560 × 840 (1280 × 420 CSS pixels, scale factor 2).
- `public/brand/og.png`: 1200 × 630, scale factor 1; shared OG/Twitter image.
- `assets/social-preview.png`: 1280 × 640, scale factor 1; GitHub Settings > Social preview only.

`social.html?w=1200&h=630` accepts integer canvas dimensions. Its hidden keycap
uses the shared SVG plus a local magenta crack overlay. The renderer rejects
remote resources, missing fonts/images, invalid rendered brand text and an OG
image of 120,000 bytes or larger. It also checks that `og-alt.txt` matches the
`og:image:alt` content in `public/index.html`.

Verify output dimensions with:

```sh
sips -g pixelWidth -g pixelHeight public/brand/og.png assets/social-preview.png
```
