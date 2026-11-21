#!/usr/bin/env bash
source scripts/common.sh
account="$(aws_call sts get-caller-identity --query Account --output text)"
[[ "${1:-}" == "$account/$STACK" ]] || { echo "Usage: scripts/teardown.sh $account/$STACK" >&2; exit 2; }
stack_outputs="$(outputs)"
aws_call events disable-rule --name "$STACK-reconcile"
bucket_empty() {
  local bucket="$1" file="$(mktemp)" pending reply
  aws_call s3 rm "s3://$bucket/" --recursive --only-show-errors
  while true; do
    pending="$(aws_call s3api list-object-versions --bucket "$bucket" --no-paginate --max-keys 1000 | jq -c '
      {Objects:((.Versions // [])+(.DeleteMarkers // []) | map({Key,VersionId})),Quiet:true}')"
    [[ "$(jq '.Objects | length' <<< "$pending")" == 0 ]] && break
    printf '%s' "$pending" > "$file"
    reply="$(aws_call s3api delete-objects --bucket "$bucket" --delete "file://$file")"
    jq -e '(.Errors // []) | length == 0' <<<"$reply" >/dev/null || { rm -f "$file"; echo "$reply" >&2; return 1; }
  done
  rm -f "$file"
}
# Stop ticket delivery before emptying the ticket bucket.
queue_arn="$(out TicketQueueArn)"
for mapping in $(aws_call lambda list-event-source-mappings --event-source-arn "$queue_arn" --query 'EventSourceMappings[].UUID' --output text); do
  aws_call lambda update-event-source-mapping --uuid "$mapping" --no-enabled >/dev/null
  for attempt in $(seq 1 30); do
    state="$(aws_call lambda get-event-source-mapping --uuid "$mapping" --query State --output text)"
    [[ "$state" == Disabled ]] && break
    sleep 2
  done
  [[ "$state" == Disabled ]]
done
bucket_empty "$(out WebBucket)"
bucket_empty "$(out TicketBucket)"
aws_call cloudformation delete-stack --stack-name "$STACK"
aws_call cloudformation wait stack-delete-complete --stack-name "$STACK"
aws_call logs describe-log-groups --log-group-name-prefix "/aws/lambda/$STACK-" --query 'logGroups[].logGroupName'
aws_call logs describe-log-groups --log-group-name-prefix "/aws/apigateway/$STACK" --query 'logGroups[].logGroupName'
echo 'Stack deleted. Review external artifact, DNS, certificate, OIDC and budget resources separately.'
