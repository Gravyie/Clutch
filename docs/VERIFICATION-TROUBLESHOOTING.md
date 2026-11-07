# World ID request and starter funds

The deployed `/pass/context` returned a 32-byte `0x` value as `rp_context.rp_id`.
IDKit rejects this before creating the request with `Invalid RP ID: must start with 'rp_'`.
Its UI shows “Verification unavailable”. This happens after choosing World ID, independently of whether
the viewer signed in with email or Google.

Use the actual RP identifier from the World developer dashboard. The project's recorded identifier is
`rp_309f1eb9e956b112`; confirm it belongs to the configured application and signing key before updating
the runtime secret. Do not use a signing key, address or 32-byte hash. The engine validates this setting
at startup and canonicalizes valid 64-bit hexadecimal identifiers for both SDK requests and server verification.

Validation against the public context reproduced the original SDK error. Substituting the recorded RP ID
allowed request creation using a disposable dummy wallet signal. No person's proof was submitted; this
does not establish that a real proof or its server-side verification succeeds.

The separate starter-funds error was confirmed in deployed logs as “Owner operations are disabled”.
The deployed image uses the legacy owner-funded faucet. Current main routes `/faucet` through the dedicated
`FAUCET_PRIVATE_KEY` implementation in `engine/src/faucet.ts`. Deploy that reviewed implementation with the
dedicated funded faucet key; never add the owner key to the server. Preserve existing contract manifests
and database, drain active markets before restarting, and check readiness after rollout.

These fixes require an engine rollout and correction of runtime World configuration. A frontend-only
deployment will not change the signed RP context or the deployed faucet implementation.
