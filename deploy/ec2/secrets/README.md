# Runtime secrets on EC2

The applied Mumbai environment is documented in [the environment runbook](../environments/rajat-testnet/README.md). Dedicated secrets now exist in ap-south-1:

- `clutch/testnet/agent-private-key`: `REDACTED_AWS_SECRET_ARN`, public address `0xD1885548a9dF36d11FD66b6361aF814b8961a846`.
- `clutch/testnet/pass-signer-private-key`: `REDACTED_AWS_SECRET_ARN`, public address `0xECA00909197A2487Fe807518ed1636E9A6659328`.

Their keys were generated in memory, stored with approval, retrieved and checked against derived public addresses. EC2's instance role also recovered and verified both. No owner key was uploaded. The existing owner remains in the local encrypted Foundry keystore.

`YOUR_RUNTIME_ROLE` has SSM management permission and inline policy `ClutchRuntimeSecretReadOnly`: only `secretsmanager:GetSecretValue` on the two exact ARNs above in ap-south-1. No secret create/update/delete/list or wildcard KMS permission. Secrets use AWS-managed Secrets Manager encryption. `read-policy.json.template` and `render-policy.py` are generic setup tools using six-character suffix patterns; do not overwrite the applied stricter exact-ARN policy unnecessarily.

## Guarded refresh

Run as root on EC2, with the engine stopped or during a reviewed maintenance window:

```sh
python3 /opt/clutch/repo/deploy/ec2/secrets/install-runtime-secrets.py \
  --base-env /etc/clutch/base.env \
  --output-env /etc/clutch/engine.env \
  --image clutch-engine:rajat-22e0d8d \
  --expected-hook 0x574d0c676a9beab18963468dA010Ba16BB2fE888 \
  --expected-agent 0xD1885548a9dF36d11FD66b6361aF814b8961a846 \
  --expected-pass-signer 0xECA00909197A2487Fe807518ed1636E9A6659328
```

The loader verifies public on-chain authorization BEFORE retrieving secrets; retrieves only AWSCURRENT; validates distinct secp256k1 keys; runs production preflight with disposable tmpfs data; atomically replaces the output only after success. Failure preserves the previous runtime file. It never changes roles, sends transactions, creates secrets or starts services.

Base/runtime files are root:root 0600 under root:root 0700 `/etc/clutch`. Base configuration excludes wallet keys, owner keys and static AWS credentials. Necessary existing World/0G/Twitch settings were selectively transferred from the Mac using an encrypted envelope; plaintext was not put in command arguments, source control, images or SSM logs. The temporary decryption key was removed after transfer. AUTH_SECRET was generated on EC2 with approval. Runtime file contains only the dedicated agent/pass keys added by this loader.

Do not copy whole .env files, print populated files, pass wallet keys in shell arguments, or put the owner key on EC2. For new credentials, funding or role changes, obtain explicit operator approval. Automatic HTTPS needs the real hostname but no invented ACME email. Test the actual healthcheck as the non-root image user; COPY ownership/mode is explicit in the Dockerfile.
