# License evidence for buffers 0.1.1

Research date: 2026-09-22. Scope: the installed production dependency, with no dependency or license-file changes.

## Finding

The `Unknown` inventory result is a resolvable metadata omission. The published npm archive contains no license declaration, but the original author's subsequent license-only commit explicitly declares `MIT/X11` for version `0.1.1`. Its runtime source is byte-for-byte identical to the installed npm package. Record the exact upstream declaration and supporting evidence when manually resolving the inventory; Debian classifies that declaration as MIT.

This finding does not claim that a LICENSE file or full grant text exists in the npm archive. It does not create a project license or invent a copyright year.

## Local dependency path

The checked-in `bun.lock` resolves:

```text
backend -> exceljs@4.4.0 -> unzipper@0.10.14 -> binary@0.3.0 -> buffers@0.1.1
```

The dependency edges appear in `bun.lock` at lines 27, 443, 769, and 345; the pinned `buffers` entry is at line 361. The installed directory is `node_modules/.bun/buffers@0.1.1/node_modules/buffers`.

## Primary evidence

1. The [npm version metadata](https://registry.npmjs.org/buffers/0.1.1) omits `license`. The [package metadata](https://registry.npmjs.org/buffers) dates publication to 2011-10-12. The published [0.1.1 archive](https://registry.npmjs.org/buffers/-/buffers-0.1.1.tgz) contains six files, with no license file or license section. All six installed files match the downloaded archive exactly. Its SHA-512 matches `bun.lock`:

   ```text
   sha512-9q/rDEGSb/Qsvv2qvzIzdluL5k7AaJOTrw23z9reQthrbF7is4CtlT0DXyO1oei2DCp4uojjzQ7igaSHp1kAEQ==
   ```

2. Original-author commit `1b745ee35d33eb166e15ef1866073a07c6d7de87`, authored and committed by James Halliday on 2012-04-03, adds only a license section to the README and a license field to the manifest. The original `substack/node-buffers` URL now returns 404; the same immutable commit remains available through the `TooTallNate/node-buffers` repository network. The [GitHub commit API](https://api.github.com/repos/TooTallNate/node-buffers/commits/1b745ee35d33eb166e15ef1866073a07c6d7de87) exposes its author, parent, and two-file patch. The [pinned manifest](https://raw.githubusercontent.com/TooTallNate/node-buffers/1b745ee35d33eb166e15ef1866073a07c6d7de87/package.json) retains version `0.1.1` and declares `"license": "MIT/X11"`; the [pinned README](https://raw.githubusercontent.com/TooTallNate/node-buffers/1b745ee35d33eb166e15ef1866073a07c6d7de87/README.markdown) has the same declaration.

3. All six files in the installed package also match that commit's parent, `51ac8d0324008b0d0ed5759b1466402a77ff8dc8`, exactly. At the license commit, `index.js`, both examples, and the test remain identical; only the two declaration additions differ. This directly connects the declaration to the actual published source, rather than to a later implementation with the same name. The SHA-256 of `index.js` in all three locations is:

   ```text
   97801e296ba5f3c32242f647e1daac5917e300367fed7935ab1e62f40adb1b8a
   ```

## Corroborating distributor record

[Debian's node-buffers 0.1.1-2 copyright record](https://sources.debian.org/copyright/license/node-buffers/0.1.1-2/) independently identifies the package as MIT, supplies MIT grant text, and cites this exact upstream commit as the declaration's source. This is corroboration from a distributor, distinct from the original author's primary declaration above. Its copyright year should not be presented as though it came from the npm archive.

## Recommended inventory treatment

Keep the scanner's raw output intact. Add an explicit manual resolution for exactly `buffers@0.1.1`, recording upstream `MIT/X11`, the immutable declaration commit, and the source comparison. If producing third-party notices, preserve the attribution and source of any supplied license text. No dependency change is required solely to resolve this metadata finding.
