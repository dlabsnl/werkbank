#!/bin/sh
# Runs inside the werkbank-build image (build/Dockerfile): test, then cross-compile werkbank.exe for Windows.
set -eu
npm ci
mkdir -p ui/vendor
cp node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/xterm/css/xterm.css \
   node_modules/@xterm/addon-fit/lib/addon-fit.js node_modules/@xterm/addon-canvas/lib/addon-canvas.js \
   node_modules/@xterm/addon-serialize/lib/addon-serialize.js \
   node_modules/@xterm/addon-search/lib/addon-search.js node_modules/@xterm/addon-web-links/lib/addon-web-links.js ui/vendor/
node build/about.js
# Bundled coding fonts (SIL OFL, via Fontsource): regular + bold, latin subset.
# shortcut: latin only, so box-drawing glyphs fall back to the next font; add more subsets if that looks off.
mkdir -p ui/vendor/fonts
: > ui/vendor/fonts.css
for spec in \
  "JetBrains Mono:jetbrains-mono" \
  "Fira Code:fira-code" \
  "Source Code Pro:source-code-pro"; do
  name=${spec%%:*}; pkg=${spec#*:}
  for w in 400 700; do
    f=$pkg-latin-$w-normal.woff2
    cp node_modules/@fontsource/$pkg/files/$f ui/vendor/fonts/
    printf '@font-face{font-family:"%s";font-weight:%s;font-display:block;src:url(fonts/%s)}\n' "$name" "$w" "$f" >> ui/vendor/fonts.css
  done
done
node ui/tree.test.js
node ui/groups.test.js
node ui/links.test.js
# strict types (tsconfig.json: JSDoc in the UI scripts, ui/types.d.ts) and ESLint (eslint.config.mjs)
npx tsc -p .
npx eslint .
# the official Rust style (rustfmt) and clippy's warnings, so they never drift
(cd src-tauri && cargo fmt --check && cargo xwin clippy --target x86_64-pc-windows-msvc --release --all-targets -- -D warnings)
# the Rust unit tests that need Windows (api.rs) build into werkbank-tests.exe, run next to the selftest on Windows
(cd src-tauri && cargo xwin test --target x86_64-pc-windows-msvc --release --no-run   && cp "$(ls -t target/x86_64-pc-windows-msvc/release/deps/werkbank-*.exe | head -1)" target/x86_64-pc-windows-msvc/release/werkbank-tests.exe)
# expand.rs has no dependencies, so it is tested natively without pulling in the Linux webview stack.
rustc --edition 2021 --test src-tauri/src/expand.rs -o /tmp/expand-test && /tmp/expand-test
rustc --edition 2021 --test src-tauri/src/editor.rs -o /tmp/editor-test && /tmp/editor-test
npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
ls -la src-tauri/target/x86_64-pc-windows-msvc/release/werkbank.exe
