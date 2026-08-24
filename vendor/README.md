# vendor

Third-party code, copied in rather than fetched at run time. The timetable is
one self-contained file. A page that reaches out to a CDN hands the reader's
settings to somebody else's server.

## qrcode-generator.js

QR Code Generator for JavaScript, by Kazuhiko Arase. MIT licensed, with no
dependencies. Taken unmodified from
<https://unpkg.com/qrcode-generator@1.4.4/qrcode.js>. The copyright and license
notice at the top of the file is part of it.

This library was checked against an independent implementation before it was
adopted. For URL-shaped input the module grids are identical. Codes rendered
from it decode back to the exact input at 61×61 and 81×81 modules. The two
encoders differ only on all-digit or all-uppercase strings. There each one picks
a different encoding mode, and both modes are valid.

To update it, fetch the same file at a newer version. Keep the notice. Then run
the checks again.

## fflate.js

fflate 0.8.2 by Arjun Barrett. MIT licensed, with no dependencies. The UMD
build, taken unmodified from <https://unpkg.com/fflate@0.8.2/umd/index.js>
(sha256 `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf`). The
license text is prepended, because the minified bundle ships without it and the
license asks that it travels with the code.

This library does one thing: `gzipSync` and `gunzipSync` on the settings, before
they go into the link. The browser has a gzip of its own in
`CompressionStream`, which costs nothing to ship. But `CompressionStream` is
async at both ends, and this code runs while the page boots and again on every
change. A function call keeps all of that straightforward.

The library costs about 13 KB over the wire. It earns that by keeping a heavily
customized link inside what a QR code can hold.

To update it, fetch the same file at a newer version. Prepend the license again.
Then check that a link written by the old page still opens in the new one.
