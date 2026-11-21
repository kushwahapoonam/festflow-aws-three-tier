# Live demo and interview guide

## Preparation

Use an isolated stack and complete both change sets, seed, publish and sign in before the presentation. Open two separate browser profiles as two customers. Keep a staff browser profile or separate private sessions ready for the silk venue and tiffin kitchen credentials. Verify Last Call A1 and Window 3 are free. Prepare a separate failed ticket for **The Monsoon Cut** using the DLQ runbook, and fix its failure flag before the presentation so it can be redriven on cue. Stage CloudWatch Logs Insights and the two SQS monitoring tabs. Use a 60-second hold for the presentation by setting `HOLD_SECONDS=60` in a reviewed change set after staging the failed ticket. Keep the prepared failure on a separate screening so Last Call stays available.

If the cloud account is unavailable, the local app can demonstrate both users, atomic checkout, payment, expiry, tickets and staff dashboards. Explain the cloud trace and DLQ recovery from the corresponding runbook. The actual Edge, Cognito and AWS telemetry demonstrations require the AWS stack.

| Time | On-screen action | What to narrate |
| --- | --- | --- |
| 0:00–0:50 | Discovery, venue filter and both Last Call seat maps | Each food item consumes one unit from a kitchen window. The customer can reserve both scarce resources in one checkout. |
| 0:50–2:00 | Both users pick A1 plus one mushroom puff in Window 3. Submit together. | Two browsers can display the same snapshot. Conditional writes decide the outcome. Read the winning hold and the losing 409. |
| 2:00–3:45 | Let the hold expire, view history, then show inventory return in the second browser | The hold has a server deadline. A minute worker releases both locks in a transaction. Use the Logs Insights view while waiting if the next scheduled tick runs late. |
| 3:45–5:15 | Second customer rebooks, declines once, then approves | A decline leaves HELD. The confirmation writes a receipt and an outbox row in one transaction. Copy the response request ID from DevTools. |
| 5:15–6:30 | Kitchen view by pickup window, move the food order through Preparing, Ready and Collected | The assigned kitchen sees only its scope. Each transition checks the current state. |
| 6:30–8:15 | Load the customer QR. Scan with camera or paste copied code in venue dashboard. Validate twice | Signed S3 download is short-lived and owner-scoped. One conditional write admits the guest. The repeat returns 409. |
| 8:15–9:30 | Search the copied request ID in API Gateway and Lambda logs. Open the related DynamoDB booking state using the ID from the booking page | The gateway owns auth and routing. The app owns scope and booking rules. Logs carry correlation IDs without user secrets. |
| 9:30–11:10 | Redrive the prepared failed job at 1 msg/sec. Refresh booking until the ticket reads READY | The ticket failure left the seat reservation confirmed. The stable object key and conditional update allow safe replay. |
| 11:10–12:00 | Show the reviewed change set, S3 release index and cost guardrails | Point out three-day logs, optional DNS, edge hostname, bounded calls and teardown responsibilities. |

If the live SQS mapping does not pick up the redriven message before the timer ends, show the redrive task status and the confirmed booking. Queue processing is asynchronous. You can continue the demo by opening the worker logs after the last slide.

## 60-second interview answer

> FestFlow is a three-tier festival booking and food pickup platform. React runs behind CloudFront from a private S3 bucket. CloudFront routes API traffic separately to HTTP API and Lambda. Cognito handles PKCE sign-in, while the application checks booking ownership and operator locations. In DynamoDB, one transaction reserves seats and increments the chosen pickup counter. If either constraint fails, neither inventory changes. Retry keys stop repeated checkouts and payments from creating extra writes. A scheduled Lambda releases expired holds, and the payment transaction saves an outbox entry for SQS ticket generation. A ticket can fail and be redriven without affecting the confirmed booking. I can trace checkout through API Gateway and Lambda logs, review a SAM change set, and roll the frontend back by restoring its saved index.

## Production festival with a large release

| Area | Demo implementation | Production decision |
| --- | --- | --- |
| Admission and traffic | Bounded polling and gateway throttling | Add a waiting room and per-show admission limits. Use backpressure and pre-launch load tests sized to approved capacity. |
| Availability | Queries against seat and window partitions | Use cacheable public inventory summaries and change notifications or push. Refresh on reconnect and keep conditional writes authoritative. |
| Hot inventory | A show metadata row and per-window capacity counter | Remove unnecessary hot-row contention with a show version check or catalog design review. Consider partitioned capacity and availability models while preserving atomic reservation. |
| Payments | Synchronous fictional scenarios | Use a payment provider, verify webhooks, reconcile delayed events and refunds, and capture auditable settlement adjustments. |
| Identity and QR | Cognito hosted UI, random QR credential and one check-in per booking | Enterprise staff federation and MFA, per-ticket admission policy for multi-seat bookings, privacy and retention review, and revocation/duplicate-entry reporting. |
| Work queues | Minute polling of sparse GSIs and one SQS queue | Use ordered or sharded work partitions where needed, aged-work alerts, item-level retry isolation and tested recovery procedures. |
| Resilience | Single region, demo data and no backups | Define RPO/RTO, use PITR and tested restore. Choose the regional write authority before considering globally replicated ticket inventory. |
| Delivery controls | Protected GitHub environment, SAM changes and index restore | Use immutable release manifests, canaries, schema compatibility tests, automated rollback criteria, SLOs and trace sampling. |
| Cost and protection | PAYG edge and account budgets | Estimate launch peaks and abuse patterns, review WAF/bot controls and quotas, and budget for caches, telemetry and egress. |
