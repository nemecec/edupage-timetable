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

## fflate.js

fflate 0.8.2 by Arjun Barrett — MIT licensed, no dependencies. The UMD build,
taken unmodified from <https://unpkg.com/fflate@0.8.2/umd/index.js>
(sha256 `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf`),
with the licence text prepended: the minified bundle ships without it, and the
licence asks that it travel with the code.

Used for one thing — `gzipSync`/`gunzipSync` on the settings before they go into
the link. The browser has a gzip of its own in `CompressionStream`, which would
have cost nothing to ship, but it is async at both ends and this runs while the
page is booting and again on every change; a function call keeps all of that
straightforward. It costs about 13 KB over the wire, and earns it by keeping a
heavily customised link inside what a QR code can hold.

To update: fetch the same file at a newer version, prepend the licence again,
and check that a link written by the old page still opens in the new one.
