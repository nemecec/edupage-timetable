# vendor

Third-party code, copied in rather than fetched at run time: the timetable is
one self-contained file, and a page that reaches out to a CDN would hand the
reader's settings to someone else's server.

## qrcode-generator.js

QR Code Generator for JavaScript, by Kazuhiko Arase — MIT licensed, no
dependencies. Taken unmodified from
<https://unpkg.com/qrcode-generator@1.4.4/qrcode.js>; the copyright and licence
notice at the top of the file is part of it.

Checked against an independent implementation before being adopted: for
URL-shaped input the module grids are identical, and codes rendered from it
decode back to the exact input at 61×61 and 81×81 modules. The two encoders
differ only on all-digit or all-uppercase strings, where each picks a different
(equally valid) encoding mode.

To update: fetch the same file at a newer version, keep the notice, and re-run
the checks.
