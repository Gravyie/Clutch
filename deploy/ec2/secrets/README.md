# Secrets Manager integration — IAM read policy applied; secrets not created

Region: **ap-south-1**. Planned record names:

- `clutch/testnet/agent-private-key`
- `clutch/testnet/pass-signer-private-key`

These are planned names, not existing records or ARNs. No dedicated keys were generated, no record was created and no credentials were uploaded by this integration work. The hostname remains unset. Do not run provisioning, upload, IAM mutation or on-chain authorization commands without the operator's approval.

## Current role prerequisite

The operator reports that the intended contracts currently use `0x3750134287b3Fa078817ee2bAce1a69b372F3F8C` for owner, agent and pass signer. That configuration must **not** be used to run the production engine. The funded owner key stays offline and off EC2.

The checkout currently retains main's 84532 deployment manifest, whose recorded role addresses differ from that report. This could represent a different deployment. The operator must confirm the canonical hook/gate/manifest before any role change or deployment; this work does not silently choose a different contract or rewrite addresses.

After separate approval: generate the two dedicated keys securely off EC2, review their public addresses, authorize the agent as both engine and resolver through the existing hook's owner-only configuration, and authorize the separate pass signer through the existing gate's owner-only signer setter. Preserve the existing treasury/gate/vault values. No contract redeployment is needed or performed here. Only after those transactions confirm should approved operators create the two Secrets Manager records and make them readable to the instance role.

## Least-privilege read policy

`read-policy.json.template` grants only `secretsmanager:GetSecretValue`, for exactly the two planned names in ap-south-1 and a supplied real account ID. It grants no create/update/delete, listing, owner-key access or broad `*` resource permission. The `??????` characters match only Secrets Manager's six-character ARN suffix; these strings are **permission patterns for future records**, not fabricated existing ARNs.

Render locally (does not call AWS or attach anything):

```sh
python3 deploy/ec2/secrets/render-policy.py --account-id YOUR_ACTUAL_12_DIGIT_ACCOUNT_ID > /tmp/clutch-secret-read-policy.json
```

The account ID discovered by the earlier authorized CLI inspection was `136673894429`; verify the intended account before eventual application. The previously created management role/profile is `clutch-engine-ec2`. With subsequent operator approval, inline policy `ClutchRuntimeSecretReadOnly` was applied to `clutch-engine-ec2` in account `136673894429` and read back to verify an exact match with the rendered policy. This grants read permission for the two planned names; it does not create those records or authorize any wallet on-chain. This read policy assumes the default AWS-managed Secrets Manager encryption key; using a customer-managed KMS key requires separately approved, exact-key-scoped decrypt permission and a compatible key policy. No wildcard KMS permission is provided.

References: [AWS individual-secret permission and six-character suffix patterns](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html), [AWS Python GetSecretValue guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-python-sdk.html).

## Retrieval and installation design

`install-runtime-secrets.py` runs on the future EC2 **host**, using its IAM role through boto3. No AWS credentials or owner key enter the engine container. Future host packages include `python3-boto3`; they have not been installed on an EC2 instance because no instance exists.

The script requires an explicit reviewed image, canonical hook address, and approved agent/pass-signer public addresses. It does the following:

1. Rejects owner keys, AWS credentials, and populated wallet keys in the base environment file.
2. Runs the image's `role-check.mjs` using only public addresses and the configured HTTPS RPC. This verifies chain 84532, the image manifest, hook/gate, engine/resolver roles and gate signer, and rejects a shared owner/runtime address. **No wallet key is loaded and no secret is read until this passes.**
3. Retrieves only `AWSCURRENT` for the two planned names using GetSecretValue. Missing records fail closed; there is no fallback to owner or Anvil keys. Each SecretString must be either a raw `0x` + 64-hex-digit key or a JSON object containing only `privateKey`.
4. Writes a temporary mode-0600 environment file and runs the existing production preflight to confirm that the retrieved private keys derive the approved, already-authorized public addresses. It verifies contract code and component consistency without signing a transaction.
5. Atomically installs the runtime env file only after both checks pass. Failed checks leave the previous runtime file untouched and remove staging files. Secret contents and raw SDK/process error output are never printed.

The helper does not generate keys, create/update secrets, change IAM, change roles, start containers, choose a hostname, or send transactions.

Future invocation, only after all prerequisites and required approvals (paths below are proposed installation paths, not claimed existing files):

```sh
sudo python3 deploy/ec2/secrets/install-runtime-secrets.py \
  --base-env /etc/clutch/engine.base.env \
  --output-env /etc/clutch/engine.env \
  --image YOUR_REVIEWED_ENGINE_IMAGE \
  --expected-hook 0xAPPROVED_CANONICAL_HOOK_ADDRESS \
  --expected-agent 0xAPPROVED_NEW_AGENT_PUBLIC_ADDRESS \
  --expected-pass-signer 0xAPPROVED_NEW_PASS_SIGNER_PUBLIC_ADDRESS
```

The host configuration directory must be root-owned and not group/world writable. The non-wallet base file must be root-owned mode 0600, contain valid RPC/auth/World settings, and have empty agent/pass variables. Owner and static AWS credentials are forbidden. Keep a separate non-wallet base file for subsequent rotations; do not use the populated runtime env as the base.

`ENGINE_DOMAIN`, `ACME_EMAIL`, `ENGINE_PUBLIC_URL` and `APP_ORIGIN` are deliberately blank in the templates. Fill them only with actual assigned host/domain/frontend values. Compose refuses to start Caddy without its required hostname/email. Do not replace them with a made-up existing DNS name or bypass HTTPS checks.

## Local verification

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/ec2/secrets -p 'test_*.py' -v
pnpm --filter @clutch/engine test
pnpm --filter @clutch/engine typecheck
bash deploy/ec2/validate-local.sh
```

Python tests use deterministic fixture strings and a fake Secrets Manager client: zero AWS calls, no uploads. Tests verify that unauthorized public roles trigger **zero secret reads**, failures preserve existing configuration, permissions are mode 0600, and policy patterns cannot match extra secret names or another region. The Docker check uses a local TLS RPC fixture with networking disabled; it verifies public roles without wallet/World keys and rejects the reported shared owner configuration. This is not a claim that new keys exist or have been authorized on the real chain.

## Existing AWS changes before the clarification

Under the preceding explicit CLI-deployment authorization, an SSM management role/profile (`clutch-engine-ec2`) and a web-only security group (`sg-026849481c1180532`) were created. No EC2 instance, public IP/DNS hostname, Secrets Manager record or key upload was created. The operator subsequently approved applying the prepared IAM read policy; only that policy was attached and verified. Further instance/secret creation, credential uploads and on-chain role changes remain unperformed and require their prerequisites and approval. No existing resource was deleted.
