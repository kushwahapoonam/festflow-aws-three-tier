#!/usr/bin/env bash
set -euo pipefail
export AWS_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=''
export STACK="${STACK:-festflow-demo}"
[[ "$STACK" =~ ^[a-zA-Z][a-zA-Z0-9-]{0,39}$ ]] || { echo 'Use a stack name of 1–40 letters, digits and hyphens.' >&2; exit 2; }
aws_call() { aws --region "$AWS_REGION" "$@"; }
outputs() { aws_call cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output json; }
out() { jq -er --arg name "$1" '.[] | select(.OutputKey == $name) | .OutputValue' <<< "$stack_outputs"; }
