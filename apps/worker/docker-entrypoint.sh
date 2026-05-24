#!/usr/bin/env sh
set -e

# Run the worker. tsx executes the TypeScript directly so we don't need a
# separate build step inside the image; for production we'd compile this
# with tsc/esbuild.
exec pnpm -F worker start
