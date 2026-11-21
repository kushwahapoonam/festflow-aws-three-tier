# Verification record

| Check | Result |
| --- | --- |
| TypeScript and production frontend build | Passed `npm run check` and `npm run build` |
| DynamoDB Local suite with real transactions | Nine tests passed. The tests cover competing holds, full-slot atomic rollback, retries, payment/expiry arbitration, duplicate cancellation, ticket failure and recovery, repeat check-in, scope enforcement and kitchen transitions |
| Browser regression | Passed `npm run test:browser` with Chromium headless shell. It opened separate customer contexts, competed for the same inventory, simulated decline and approval, loaded the generated PNG, completed kitchen transitions, pasted the code into the venue desk, rejected a second check-in and inspected admin audit. The discovery page fit a 390px viewport |
| SAM template and Lambda builds | `sam validate --lint --region us-east-1` and `sam build` passed for all three Lambda entry points |
| Local SAM transform | Confirmed the public catalog and the protected `/api/me` JWT and OpenID scope. [Resource inventory](07-resource-preview.md) lists 49 default and 2 optional native resources |
| Shell scripts | All scripts passed `bash -n` |

Local sign-in substitutes fixture claims for Cognito. The browser check used manual code entry at the venue. Camera permissions and visual scanning depend on a browser and device with an available camera.

No AWS credentials were used, and no live resources or change set were created. The initial resource preview is generated offline. Run the plan script in your demo account to create the actual AWS change set. Account-specific checks still include Cognito callback and JWTs, HTTPS and private S3 OAC, signed ticket downloads, scheduling, DLQ redrive, CloudWatch log delivery, live contention, GitHub OIDC and eligible AWS charges. The optional PostgreSQL section is an architecture lab with an SQL transaction outline.

## Reproduce the local checks

From the repository root, start `bash scripts/ddb-local.sh` in a separate terminal. Run `npm ci`, `npm run check`, `npm test` and `npm run build`. For browser smoke, install Chromium with `npx playwright install chromium`, start `npm run dev` against a freshly seeded DynamoDB Local process, and run `npm run test:browser`. The two-customer browser test consumes the Last Call fixture. Restart DynamoDB Local before rerunning it.
