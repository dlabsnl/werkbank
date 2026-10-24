# Build image: cross-compiles the Windows .exe from Linux (no Windows build machine needed).
FROM rust:1-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends clang lld llvm imagemagick \
 && rm -rf /var/lib/apt/lists/*

RUN rustup target add x86_64-pc-windows-msvc \
 && cargo install --locked cargo-xwin

# rustfmt applies the official Rust style guide; build.sh checks both before it builds
RUN rustup component add rustfmt clippy

# Node LTS from the official image (Debian's is too old for ESLint and TypeScript)
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /src
