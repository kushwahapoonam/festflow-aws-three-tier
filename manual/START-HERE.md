# FestFlow · AWS Console walkthrough

Use the browser for every AWS setup action. Extract this archive once. It contains the website files, one ZIP per Lambda function, four DynamoDB items, JSON policies, and the API route list. Use a text editor to replace the account-specific values in JSON files before pasting or uploading them. Keep the Lambda ZIPs intact for upload.

Start in a demo AWS account. Check **Billing → Free Tier and Credits** and select **N. Virginia (us-east-1)** for regional services. Use on-demand or pay-as-you-go choices where applicable. CloudFront is global. This guide uses a small Last Call screening with one seat and one pickup window. The fixture date is December 31, 2026. If deploying later, set a future UTC time in both fixture files and put the food pickup before the show.

## 1. S3 and CloudFront

1. **S3 → Buckets → Create bucket.** Create two General purpose buckets in us-east-1, one for the website and one for tickets. Use globally unique names. Note the ticket bucket name. Keep Block all public access on, ACLs disabled with Bucket owner enforced, and SSE-S3. Leave static website hosting off.
2. **S3 → website bucket → Upload.** Add `website/index.html`. Use **Add folder** for `website/assets` so the object keys begin with `assets/`. The bucket root should contain `index.html` and `assets/`.
3. **CloudFront → Distributions → Create distribution.** Choose the website bucket’s S3 REST origin, use Origin Access Control (OAC) with signed requests and select **Redirect HTTP to HTTPS** for the web behavior. Set `index.html` as the default root object in distribution settings. For this lab select **CachingDisabled** while setting things up, so later configuration uploads can be seen without invalidations. Leave paid add-ons off.
4. In CloudFront copy the OAC bucket policy for your distribution. In **S3 → website bucket → Permissions → Bucket policy**, paste and save it. The policy permits this CloudFront distribution to read website objects.
5. Wait for deployment, then open `https://YOUR_DISTRIBUTION.cloudfront.net/`. Check for the festival homepage. Screenings and sign-in are connected later.

If CloudFront returns 403, verify the object key `index.html`, the chosen S3 origin, and the distribution ARN in the bucket policy. An unsigned direct S3 URL should be denied.

## 2. DynamoDB

1. **DynamoDB → Tables → Create table.** Name `festflow-demo`. Use String partition key `pk`, String sort key `sk`, and on-demand capacity.
2. In the table’s **Indexes** tab, create these Global Secondary Indexes. Use String for all keys, **All** projection, and wait for each to be **Active**.

   | Index | Partition key | Sort key |
   | --- | --- | --- |
   | Lookup | gpk | gsk |
   | Venue | vpk | vsk |
   | Kitchen | kpk | ksk |

3. **Explore table items → festflow-demo → Create item → JSON view.** Use **DynamoDB JSON** format. Replace the editor contents with one file from `dynamodb-items/` and create the item. Repeat once per file, for four items total. If the editor offers a DynamoDB JSON toggle, enable it before pasting. The top-level keys are visible in each file.
4. Refresh Explore items and check for `SHOW#last-call`, `SEAT#A1`, `KITCHEN#tiffin`, and `SLOT#window-3` in the relevant partition or sort key.

## 3. SQS

1. **SQS → Create queue.** Create Standard queue `festflow-tickets-dlq` with SQS-managed encryption and 14-day retention.
2. Create Standard queue `festflow-tickets` with SQS-managed encryption, 120-second visibility timeout and four-day retention. In its dead-letter queue settings, select `festflow-tickets-dlq` and set maximum receives to 3.
3. Open `festflow-tickets` and copy its **Queue URL** for the Reconcile Lambda. The URL goes into its environment variable. IAM policy files use the queue’s ARN.

## 4. IAM, CloudWatch, and Lambda

1. In **CloudWatch → Log groups**, create `/aws/lambda/festflow-api`, `/aws/lambda/festflow-reconcile`, and `/aws/lambda/festflow-ticket`. Choose three-day retention.
2. In **IAM → Roles → Create role**, choose AWS service and the **Lambda** use case. Create roles `festflow-api-role`, `festflow-reconcile-role`, and `festflow-ticket-role`.
3. Open each role and go to **Permissions → Add permissions → Create inline policy → JSON**. Paste the corresponding file from `iam/` after replacing `ACCOUNT_ID` with your 12-digit AWS account ID and `TICKET_BUCKET` with your exact ticket bucket name where present. The policies assume the table, main queue, functions and log groups use the names in this guide.
4. In **Lambda → Create function → Author from scratch**, make the three functions below. For each select **Node.js 22.x**, architecture **x86_64**, the corresponding existing execution role, and **256 MB** in General configuration. Under **Code → Upload from → .zip file**, upload the corresponding ZIP. Set the handler under **Runtime settings** and the variables under **Configuration → Environment variables**.

   | Function | ZIP | Handler | Timeout | Environment variables |
   | --- | --- | --- | --- | --- |
   | festflow-api | lambda/api.zip | api.handler | 15 seconds | TABLE_NAME=festflow-demo, TICKET_BUCKET=your ticket bucket, HOLD_SECONDS=120 |
   | festflow-reconcile | lambda/reconcile.zip | tickets.scheduled | 30 seconds | TABLE_NAME=festflow-demo, TICKET_QUEUE=your main queue URL |
   | festflow-ticket | lambda/ticket.zip | tickets.consume | 15 seconds | TABLE_NAME=festflow-demo, TICKET_BUCKET=your ticket bucket |

5. In **festflow-ticket → Add trigger**, select **SQS** and `festflow-tickets`. Enable the trigger. Set batch size 5, enable **Report batch item failures**, and set maximum concurrency 2 if offered in the trigger’s advanced settings. Check that the event source mapping is Enabled.

## 5. Cognito and HTTP API

1. **Cognito → User pools → Create user pool.** Choose the **Lite** feature plan and email sign-in. Create a public **Single-page application** app client with no client secret. Set the allowed callback and sign-out URL to `https://YOUR_DISTRIBUTION.cloudfront.net/` with the trailing slash. Use Cognito as the identity provider, enable **Authorization code grant**, and enable the **openid** scope. Under **Domain**, select an available Cognito prefix and record the domain, web app client ID, and pool ID. Disable self-registration for this demo and create a test customer under **Users**. The first sign-in may ask you to replace a temporary password.
2. **API Gateway → Create API → HTTP API → Build.** Use `festflow-api` as the Lambda integration with payload format **2.0**. Create a `$default` stage with auto-deploy. Let API Gateway add invoke permission when connecting the Lambda integration.
3. Add only **GET /api/events** first. Open the **Invoke URL** with `/api/events` appended. You should get a JSON array containing Last Call. If you get an integration error, inspect the API Lambda logs and confirm the role can query `festflow-demo`.
4. In the HTTP API, go to **Authorization → Manage authorizers → Create**. Choose **JWT**, identity source `$request.header.Authorization`, issuer `https://cognito-idp.us-east-1.amazonaws.com/YOUR_USER_POOL_ID`, and audience equal to your Cognito web app client ID.
5. Add the remaining routes from [API-Routes.md](API-Routes.md). Attach the Lambda integration to every route. For protected routes attach the JWT authorizer and add `openid` under authorization scopes. Leave the two routes marked None public. Check the Invoke URL plus `/api/me` while signed out. Expect HTTP 401.

## 6. Route the website’s API calls through CloudFront

1. **CloudFront → your distribution → Origins → Create origin.** Set the origin domain to the API Gateway invoke hostname, without `https://`. Select **HTTPS only** for the origin connection, and leave Origin path empty because the API uses `$default`.
2. **Behaviors → Create behavior.** Set path pattern `/api/*` and select the API origin. Use **HTTPS only**, the method group that includes GET, HEAD, OPTIONS, PUT, POST, PATCH and DELETE, cache policy **CachingDisabled**, and origin request policy **AllViewerExceptHostHeader**. Place this behavior before the default behavior.
3. Edit `settings/auth-config.json` using the actual Cognito domain and app client ID. For `loginUrl`, use `https://` plus the Cognito domain, with no path or trailing slash. Upload the saved file with the key `auth-config.json` at the root of the website bucket.
4. **CloudFront → Functions → Create function.** Use JavaScript runtime 2.0. Paste the code from `settings/spa-rewrite.js`. Save, publish and associate it as a **viewer request** function on the distribution’s **default website behavior**. Leave the API behavior’s viewer request function blank.
5. After CloudFront finishes deploying, verify that `/api/events` through CloudFront returns JSON, `/api/me` while signed out returns 401, and Cognito sign-in returns you to the homepage. A signed-in customer should be able to load Last Call and select A1.

## 7. Test a booking and optionally schedule Reconcile

1. For continuous dispatch and expiry, go to **Amazon EventBridge → Scheduler → Schedules → Create schedule**. Name it `festflow-reconcile`, use a recurring rate of **1 minute**, and set Flexible time window to **Off**. Choose **Lambda Invoke** and select `festflow-reconcile`. Use an empty JSON object if prompted for the payload. Let Scheduler create a dedicated role with permission to invoke this function, or select a Scheduler execution role scoped to the function.
2. Sign in as your test customer. Select **Last Call → A1 → one Pepper mushroom puff → Window 3**. Hold it and wait for expiry. With the two-minute hold and one-minute schedule, allow another scheduled run to release the inventory. If you skip the schedule, open **Lambda → festflow-reconcile → Test**, create a test event with `{}`, and run it after the hold expires.
3. Hold again and choose **Simulate approval**. If you skip the schedule, run the same Reconcile test again to dispatch the confirmed ticket. Check that the QR becomes Ready and that the ticket bucket contains a PNG under `tickets/`. If it stays Pending, check Reconcile logs, the main queue and the ticket trigger. Review the dead-letter queue if jobs repeatedly fail.
4. To try staff workflows, create Cognito groups `admin`, `kitchen`, and `venue`. Assign separate test users to the matching groups. Sign in as admin and add operator assignments by Cognito user **sub**. Assign `silk` to the venue user and `tiffin` to the kitchen user. Sign in again after the group changes. The kitchen dashboard should show Window 3. This booking can be checked in once from the venue dashboard with its ticket code.

## Cleanup

Delete demo resources in reverse dependency order when finished. Remove the Scheduler schedule and SQS trigger first. Remove the CloudFront function association, then disable and delete the distribution, then delete the CloudFront function. Empty and delete both S3 buckets, and remove the HTTP API, Cognito domain and pool, Lambdas, queues, DynamoDB table, demo IAM roles and CloudWatch log groups. Delete only resources dedicated to this demo.

The upload files were prepared from the locally tested FestFlow build. Live AWS behavior still needs verification in your account.

Official references [Private S3 origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html) · [JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html) · [CloudFront origin policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html) · [Lambda SQS trigger](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) · [EventBridge Scheduler and Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html).
