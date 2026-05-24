#!/usr/bin/env sh
set -e

# Run the worker. tsx executes the TypeScript directly so a separate build
# step is not needed inside the image; for production this would be
# compiled with tsc/esbuild.
exec pnpm -F worker start
