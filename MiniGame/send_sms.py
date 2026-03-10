#!/usr/bin/env python3
"""
Send one SMS message using Twilio.
Use cron (or your OS scheduler) to run this script every day at 7:00 AM.
"""

import os
import sys

from dotenv import load_dotenv
from twilio.rest import Client


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> None:
    load_dotenv()

    account_sid = required_env("TWILIO_ACCOUNT_SID")
    auth_token = required_env("TWILIO_AUTH_TOKEN")
    from_number = required_env("TWILIO_FROM_NUMBER")
    to_number = required_env("TO_NUMBER")
    message_body = required_env("MESSAGE_BODY")

    client = Client(account_sid, auth_token)
    message = client.messages.create(
        body=message_body,
        from_=from_number,
        to=to_number,
    )
    print(f"Message queued. SID: {message.sid}")


if __name__ == "__main__":
    main()
