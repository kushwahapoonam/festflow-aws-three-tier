#!/usr/bin/env bash
source scripts/common.sh
for command in aws jq npm sam; do command -v "$command" >/dev/null; done
aws_call sts get-caller-identity --output json
printf 'Region %s | Stack %s\n' "$AWS_REGION" "$STACK"
if [[ -n "${EXPECTED_ACCOUNT:-}" ]]; then
  actual="$(aws_call sts get-caller-identity --query Account --output text)"
  [[ "$EXPECTED_ACCOUNT" == "$actual" ]] || { echo 'AWS account differs from EXPECTED_ACCOUNT.' >&2; exit 2; }
fi
echo 'In Billing and Cost Management check account plan, credits and expiry. Check Service Quotas before continuing.'
if [[ -n "${ARTIFACT_BUCKET:-}" ]]; then
  aws_call s3api get-bucket-location --bucket "$ARTIFACT_BUCKET" --output json
fi
