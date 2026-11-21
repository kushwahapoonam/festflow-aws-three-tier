#!/usr/bin/env bash
source scripts/common.sh
[[ -d web/dist/assets && -f web/dist/index.html ]] || { echo 'Run npm run build first.' >&2; exit 2; }
stack_outputs="$(outputs)"
bucket="$(out WebBucket)"
host="$(out EdgeHost)"
distribution="$(out EdgeId)"
version="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$version" =~ ^[a-zA-Z0-9_-]{1,80}$ ]] || { echo 'Invalid release ID.' >&2; exit 2; }
release_entry="releases/$version/index.html"
if aws_call s3api head-object --bucket "$bucket" --key "$release_entry" >/dev/null 2>&1; then
  echo 'Release ID already exists. Use rollback-web.sh to republish it.' >&2; exit 2
fi
mkdir -p .festflow
jq -n --arg login "$(out LoginUrl)" --arg id "$(out WebClientId)" '{loginUrl:$login,clientId:$id}' >.festflow/auth-config.json
aws_call s3 sync web/dist/assets/ "s3://$bucket/assets/" --cache-control 'public,max-age=31536000,immutable'
aws_call s3 cp web/dist/index.html "s3://$bucket/$release_entry" --cache-control 'no-cache' --content-type 'text/html; charset=utf-8'
aws_call s3 cp .festflow/auth-config.json "s3://$bucket/auth-config.json" --cache-control 'no-store' --content-type application/json
aws_call s3 cp "s3://$bucket/$release_entry" "s3://$bucket/index.html" --metadata-directive COPY
echo "Release $version published at https://$host/"
