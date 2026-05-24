#!/usr/bin/env sh
# Ensure the default Temporal namespace exists. Idempotent.
set -eu

NS="${DEFAULT_NAMESPACE:-default}"
ADDR="${TEMPORAL_ADDRESS:-temporal:7233}"

echo "→ Ensuring namespace '$NS' on $ADDR..."
tctl --address "$ADDR" --namespace "$NS" namespace describe >/dev/null 2>&1 && {
  echo "✓ Namespace '$NS' already exists"
  exit 0
}
tctl --address "$ADDR" --namespace "$NS" namespace register --retention 1
echo "✓ Namespace '$NS' registered"
