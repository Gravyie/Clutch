#!/usr/bin/env python3
"""Host-side retrieval only. Never creates secrets, uploads keys, authorizes roles, or starts services."""
import argparse
import json
import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path

REGION = "ap-south-1"
SECRET_NAMES = {
    "AGENT_PRIVATE_KEY": "clutch/testnet/agent-private-key",
    "PASS_SIGNER_PRIVATE_KEY": "clutch/testnet/pass-signer-private-key",
}
SECP256K1_ORDER = int("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)


class SafeError(Exception):
    """Only fixed, non-sensitive messages may cross the CLI boundary."""


def private_key(response):
    value = response.get("SecretString")
    if not isinstance(value, str):
        raise SafeError("Expected a SecretString, not a binary secret")
    value = value.strip()
    if value.startswith("{"):
        try:
            obj = json.loads(value)
            value = obj["privateKey"] if isinstance(obj, dict) and set(obj) == {"privateKey"} else None
        except (ValueError, KeyError, TypeError):
            value = None
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        raise SafeError("Secret has an invalid private-key format")
    if not 0 < int(value[2:], 16) < SECP256K1_ORDER:
        raise SafeError("Secret is not a valid secp256k1 private key")
    return value


def read_keys(client):
    result = {}
    for variable, name in SECRET_NAMES.items():
        try:
            response = client.get_secret_value(SecretId=name, VersionStage="AWSCURRENT")
        except Exception:
            raise SafeError("Unable to read the planned secrets; check their existence and read permissions") from None
        if response.get("Name") != name:
            raise SafeError("Secrets Manager returned an unexpected secret name")
        result[variable] = private_key(response)
    if len(set(v.lower() for v in result.values())) != 2:
        raise SafeError("Agent and pass-signer keys must be different")
    return result


def staged_environment(base, keys):
    if re.search(r"(?im)^\s*#?\s*(?:export\s+)?OWNER_PRIVATE_KEY\s*=", base):
        raise SafeError("Owner-key assignments must not appear in the base environment, including comments")
    keep = []
    for line in base.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            keep.append(line)
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not match or "\x00" in line:
            raise SafeError("Base environment must use Docker-compatible KEY=value lines")
        name = match.group(1)
        if name == "OWNER_PRIVATE_KEY" or name in {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"}:
            raise SafeError("Owner keys and AWS credentials must not enter the engine environment")
        if name in SECRET_NAMES and match.group(2).strip() not in {"", "\"\"", "''"}:
            raise SafeError("Base environment must not contain wallet keys; use only the planned secrets")
        if name not in SECRET_NAMES:
            keep.append(line)
    return "\n".join(keep + [f"{name}={keys[name]}" for name in SECRET_NAMES]) + "\n"


def docker_verifier(image, expected_hook, expected_agent, expected_signer, public_only=False):
    def verify(path):
        try:
            command = [
                "docker", "run", "--rm", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:rw,size=64m",
                "--env-file", str(path),
            ]
            if public_only:
                command += ["-e", "CLUTCH_EXPECTED_HOOK=" + expected_hook,
                            "-e", "CLUTCH_EXPECTED_AGENT=" + expected_agent,
                            "-e", "CLUTCH_EXPECTED_PASS_SIGNER=" + expected_signer]
            command += ["--entrypoint", "node", image,
                        "dist/role-check.mjs" if public_only else "dist/production-check.mjs"]
            result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
            if result.returncode != 0:
                raise SafeError("On-chain authorization check failed; runtime file is unchanged")
            data = json.loads(result.stdout.strip().splitlines()[-1])
            expected = {"hook": expected_hook, "agent": expected_agent, "passSigner": expected_signer}
            if data.get("ok") is not True or data.get("chainId") != 84532 or any(str(data.get(k, "")).lower() != v.lower() for k, v in expected.items()):
                raise SafeError("Verified deployment does not match the explicitly approved addresses")
            return data
        except SafeError:
            raise
        except Exception:
            raise SafeError("Unable to complete the read-only production preflight; runtime file is unchanged") from None
    return verify


def install(base_path, target_path, client, verify, authorize):
    # Validate the base before retrieving any credentials. Never merge an owner key into staging.
    base = base_path.read_text()
    staged_environment(base, {name: "" for name in SECRET_NAMES})
    authorize(base_path)  # Public getters only: reject unauthorized addresses BEFORE reading any secret.
    keys = read_keys(client)
    fd, temporary = tempfile.mkstemp(prefix=".clutch-secrets-", dir=target_path.parent)
    path = Path(temporary)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write(staged_environment(base, keys))
            file.flush()
            os.fsync(file.fileno())
        verified = verify(path)  # Uses actual role getters; no transaction or role authorization is attempted.
        os.replace(path, target_path)
        directory = os.open(target_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return verified
    finally:
        path.unlink(missing_ok=True)


def secure_paths(base, target):
    if os.geteuid() != 0:
        raise SafeError("Run this host-side installation as root")
    for path in [base, target.parent]:
        if path.is_symlink():
            raise SafeError("Configuration paths must not be symbolic links")
        info = path.stat()
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
            raise SafeError("Configuration paths must be root-owned and not group/world writable")
    if stat.S_IMODE(base.stat().st_mode) & 0o077:
        raise SafeError("Base environment must have mode 0600")
    if target.is_symlink():
        raise SafeError("Runtime destination must not be a symbolic link")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-env", type=Path, required=True)
    parser.add_argument("--output-env", type=Path, required=True)
    parser.add_argument("--image", required=True, help="Explicit reviewed engine image tag or digest")
    parser.add_argument("--expected-hook", required=True, help="Explicitly approved canonical hook address")
    parser.add_argument("--expected-agent", required=True, help="Approved new public agent address")
    parser.add_argument("--expected-pass-signer", required=True, help="Approved new public pass-signer address")
    args = parser.parse_args()
    try:
        if not all(re.fullmatch(r"0x[0-9a-fA-F]{40}", a) for a in [args.expected_hook, args.expected_agent, args.expected_pass_signer]):
            raise SafeError("Supply the approved canonical hook address")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/:@-]*", args.image):
            raise SafeError("Invalid engine image reference")
        secure_paths(args.base_env, args.output_env)
        class PlannedSecrets:
            client = None
            def get_secret_value(self, **kwargs):
                if self.client is None:
                    import boto3  # Loaded only after public role authorization succeeds.
                    self.client = boto3.client("secretsmanager", region_name=REGION)
                return self.client.get_secret_value(**kwargs)
        arguments = (args.image, args.expected_hook, args.expected_agent, args.expected_pass_signer)
        data = install(args.base_env, args.output_env, PlannedSecrets(), docker_verifier(*arguments), docker_verifier(*arguments, public_only=True))
        print(json.dumps({"installed": True, "chainId": data["chainId"], "hook": data["hook"], "servicesStarted": False}))
    except SafeError as error:
        parser.exit(1, str(error) + "\n")
    except Exception:
        parser.exit(1, "Secret installation failed; no sensitive diagnostic output is emitted\n")


if __name__ == "__main__":
    main()
