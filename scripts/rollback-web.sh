#!/usr/bin/env bash
source scripts/common.sh
version="${1:?Pass a previously published release ID}"
[[ "$version" =~ ^[a-zA-Z0-9_-]{1,80}$ ]]
stack_outputs="$(outputs)"
bucket="$(out WebBucket)"
aws_call s3 cp "s3://$bucket/releases/$version/index.html" "s3://$bucket/index.html" --metadata-directive COPY
invalidation="$(aws_call cloudfront create-invalidation --distribution-id "$(out EdgeId)" --paths /index.html --query Invalidation.Id --output text)"
aws_call cloudfront wait invalidation-completed --distribution-id "$(out EdgeId)" --id "$invalidation"
