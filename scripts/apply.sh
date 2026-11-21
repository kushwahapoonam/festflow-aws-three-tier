#!/usr/bin/env bash
source scripts/common.sh
change_set="${1:?Pass the reviewed change set ARN}"
[[ "$change_set" == arn:*:cloudformation:*:*:changeSet/* ]] || { echo 'A change set ARN is required.' >&2; exit 2; }
details="$(aws_call cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$change_set")"
jq -e --arg stack "$STACK" '.StackName==$stack and .Status=="CREATE_COMPLETE" and .ExecutionStatus=="AVAILABLE"' <<<"$details" >/dev/null
stack_status="$(aws_call cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text)"
operation=stack-update-complete
if [[ "$stack_status" == REVIEW_IN_PROGRESS ]]; then operation=stack-create-complete; fi
aws_call cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$change_set"
if ! aws_call cloudformation wait "$operation" --stack-name "$STACK"; then
  aws_call cloudformation describe-stack-events --stack-name "$STACK" --query 'StackEvents[0:20].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table
  exit 1
fi
outputs
