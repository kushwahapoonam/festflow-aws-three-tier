#!/usr/bin/env bash
source scripts/common.sh
: "${ARTIFACT_BUCKET:?Set ARTIFACT_BUCKET to an existing private artifact bucket in the same region}"
mkdir -p .festflow
export PATH="$PWD/node_modules/.bin:$PATH"
sam validate --lint --region "$AWS_REGION"
sam build
aws_call cloudformation package --template-file .aws-sam/build/template.yaml --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-prefix "festflow/$STACK" --output-template-file .festflow/packaged.yaml
plan() {
  local type=CREATE existing='[]' status role_args=() changeset
  if aws_call cloudformation describe-stacks --stack-name "$STACK" >.festflow/stack.json 2>.festflow/describe.err; then
    status="$(jq -r '.Stacks[0].StackStatus' .festflow/stack.json)"
    if [[ "$status" != REVIEW_IN_PROGRESS ]]; then
      type=UPDATE
      existing="$(jq -c '.Stacks[0].Parameters' .festflow/stack.json)"
    fi
  elif ! rg -q 'does not exist' .festflow/describe.err 2>/dev/null && ! grep -q 'does not exist' .festflow/describe.err; then
    cat .festflow/describe.err >&2; return 1
  fi
  if [[ -n "${CFN_ROLE_ARN:-}" ]]; then role_args=(--role-arn "$CFN_ROLE_ARN"); fi
  if [[ "$type" == CREATE ]]; then : "${LOGIN_PREFIX:?Set a unique LOGIN_PREFIX for the first change set}"; fi
  local param
  param="$(jq -cn --argjson existing "$existing" \
    --arg login "${LOGIN_PREFIX:-}" --arg edge "${EDGE_HOST:-}" --arg vanity "${CUSTOM_DOMAIN:-}" \
    --arg cert "${VIEWER_CERT_ARN:-}" --arg zone "${HOSTED_ZONE_ID:-}" --arg hold "${HOLD_SECONDS:-}" \
    --arg fail "${FAIL_TICKET_ID:-}" --arg reconcile "${RECONCILE_ENABLED:-}" --arg alarms "${ENABLE_ALARMS:-}" '
      [{k:"LoginPrefix",v:$login},{k:"EdgeHostname",v:$edge},{k:"CustomDomain",v:$vanity},
       {k:"ViewerCertificateArn",v:$cert},{k:"PublicHostedZoneId",v:$zone},{k:"HoldSeconds",v:$hold},
       {k:"FailTicketId",v:$fail},{k:"ReconcileEnabled",v:$reconcile},{k:"EnableAlarms",v:$alarms}]
      | map(. as $setting | if .v == "__CLEAR__" then {ParameterKey:.k,ParameterValue:""}
           elif .v != "" then {ParameterKey:.k,ParameterValue:.v}
           elif any($existing[]; .ParameterKey == $setting.k) then {ParameterKey:.k,UsePreviousValue:true} else empty end)')"
  changeset="$(aws_call cloudformation create-change-set --stack-name "$STACK" --change-set-name "festflow-$(date -u +%Y%m%dT%H%M%S)-$$" \
    --change-set-type "$type" --template-body file://.festflow/packaged.yaml \
    --parameters "$param" --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
    --tags Key=Project,Value=FestFlow "${role_args[@]}" --query Id --output text)"
  if ! aws_call cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$changeset"; then
    aws_call cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$changeset" >.festflow/change-set.json
    jq -r '.StatusReason // empty' .festflow/change-set.json >&2
    if jq -e '.StatusReason | test("didn.t contain changes|No updates";"i")' .festflow/change-set.json >/dev/null; then
      echo 'No infrastructure changes.'
      : >.festflow/change-set.arn
      return
    fi
    return 1
  fi
  aws_call cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$changeset" >.festflow/change-set.json
  printf '%s\n' "$changeset" >.festflow/change-set.arn
  jq -r '.Changes[].ResourceChange | [.Action,.LogicalResourceId,.ResourceType,(.Replacement // "-")] | @tsv' .festflow/change-set.json
  printf 'Review .festflow/change-set.json. Apply explicitly with the recorded ARN.\n'
}
rm -f .festflow/change-set.arn
plan
