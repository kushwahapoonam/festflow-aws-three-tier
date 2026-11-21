#!/usr/bin/env bash
set -euo pipefail
root="${DYNAMODB_LOCAL_DIR:-.festflow/ddb}"
port="${DYNAMODB_LOCAL_PORT:-8000}"
mkdir -p "$root"
if [[ ! -f "$root/DynamoDBLocal.jar" ]]; then
  download="$(mktemp)"
  trap 'rm -f "$download"' EXIT
  curl -fsSL https://s3.us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_latest.tar.gz -o "$download"
  tar -xzf "$download" -C "$root"
  rm -f "$download"
  trap - EXIT
fi
exec java -Djava.library.path="$root/DynamoDBLocal_lib" -jar "$root/DynamoDBLocal.jar" -inMemory -sharedDb -disableTelemetry -port "$port"
