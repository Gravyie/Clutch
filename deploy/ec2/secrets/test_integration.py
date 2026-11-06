import fnmatch
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

integration = load("integration", "install-runtime-secrets.py")
policy = load("policy", "render-policy.py")
KEY_A = "0x" + "0" * 63 + "1"  # Public deterministic test fixtures, never uploaded or used on a network.
KEY_B = "0x" + "0" * 63 + "2"

class Client:
    def __init__(self, values=None):
        self.values = values or [KEY_A, KEY_B]
        self.calls = []
    def get_secret_value(self, **kwargs):
        self.calls.append(kwargs)
        return {"Name": kwargs["SecretId"], "SecretString": self.values[len(self.calls) - 1]}

class IntegrationTests(unittest.TestCase):
    def test_reads_only_planned_names_and_current_versions(self):
        client = Client([KEY_A, json.dumps({"privateKey": KEY_B})])
        self.assertEqual(integration.read_keys(client)["PASS_SIGNER_PRIVATE_KEY"], KEY_B)
        self.assertEqual(client.calls, [{"SecretId": name, "VersionStage": "AWSCURRENT"} for name in integration.SECRET_NAMES.values()])

    def test_missing_or_invalid_keys_never_fall_back(self):
        class Missing:
            def get_secret_value(self, **kwargs):
                raise RuntimeError("Do not echo SDK diagnostics or sensitive data")
        with self.assertRaisesRegex(integration.SafeError, "Unable to read"):
            integration.read_keys(Missing())
        for value in ["not-a-key", "0x" + "0" * 64, "0x" + "f" * 64, '{"privateKey":"bad","owner":"bad"}']:
            with self.assertRaises(integration.SafeError):
                integration.private_key({"SecretString": value})
        with self.assertRaisesRegex(integration.SafeError, "different"):
            integration.read_keys(Client([KEY_A, KEY_A]))

    def test_owner_or_aws_keys_rejected_before_secret_access(self):
        for name in ["OWNER_PRIVATE_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]:
            with self.assertRaises(integration.SafeError):
                integration.staged_environment(name + "=\n", {})

    def test_failed_authorization_preserves_runtime_and_cleans_staging(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base.env"
            base.write_text("RPC_URL=https://example.invalid\n")
            output = root / "engine.env"
            output.write_text("PREVIOUS=unchanged\n")
            def reject(path):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                raise integration.SafeError("On-chain authorization check failed")
            with self.assertRaises(integration.SafeError):
                integration.install(base, output, Client(), reject, lambda _: None)
            self.assertEqual(output.read_text(), "PREVIOUS=unchanged\n")
            self.assertEqual(list(root.glob(".clutch-secrets-*")), [])

    def test_success_is_atomic_and_replaces_keys_only_after_verification(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base.env"
            base.write_text("RPC_URL=https://example.invalid\nAGENT_PRIVATE_KEY=\nPASS_SIGNER_PRIVATE_KEY=\n")
            output = root / "engine.env"
            output.write_text("PREVIOUS=unchanged\n")
            def accept(path):
                self.assertEqual(output.read_text(), "PREVIOUS=unchanged\n")
                self.assertIn(KEY_A, path.read_text())
                return {"ok": True, "chainId": 84532}
            integration.install(base, output, Client(), accept, lambda _: None)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertIn("AGENT_PRIVATE_KEY=" + KEY_A, output.read_text())
            self.assertEqual(output.read_text().count("AGENT_PRIVATE_KEY="), 1)

    def test_unauthorized_addresses_do_not_even_retrieve_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base.env"
            base.write_text("RPC_URL=https://example.invalid\n")
            client = Client()
            def unauthorized(_):
                raise integration.SafeError("On-chain roles still use the old owner")
            with self.assertRaises(integration.SafeError):
                integration.install(base, root / "engine.env", client, lambda _: None, unauthorized)
            self.assertEqual(client.calls, [])
            self.assertFalse((root / "engine.env").exists())

    def test_policy_allows_only_two_planned_secrets(self):
        data = policy.render("123456789012")  # Fixture account ID; no AWS call.
        statement = data["Statement"][0]
        self.assertEqual(statement["Action"], "secretsmanager:GetSecretValue")
        allowed = statement["Resource"]
        for name in integration.SECRET_NAMES.values():
            arn = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:" + name + "-AbCdEf"
            self.assertTrue(any(fnmatch.fnmatchcase(arn, p) for p in allowed))
            self.assertFalse(any(fnmatch.fnmatchcase(arn.replace("-AbCdEf", "-extra-AbCdEf"), p) for p in allowed))
            self.assertFalse(any(fnmatch.fnmatchcase(arn.replace("ap-south-1", "us-east-1"), p) for p in allowed))
        self.assertNotIn("*", json.dumps(data))
        with self.assertRaises(ValueError):
            policy.render("invalid")

if __name__ == "__main__":
    unittest.main()
