#!/usr/bin/env python3
"""Offline renderer. Produces permission patterns, not ARNs of claimed existing records."""
import argparse
import json
import re
from pathlib import Path
from string import Template


def render(account_id):
    if not re.fullmatch(r"[0-9]{12}", account_id):
        raise ValueError("Supply the actual 12-digit AWS account ID")
    source = Path(__file__).with_name("read-policy.json.template").read_text()
    return json.loads(Template(source).substitute(AWS_ACCOUNT_ID=account_id))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    args = parser.parse_args()
    print(json.dumps(render(args.account_id), indent=2))
