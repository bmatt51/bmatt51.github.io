# Daily 7:00 AM SMS (Python + Twilio)

This sends a text message once when the script runs.  
Schedule it with `cron` to run every morning at 7:00 AM.

## 1) Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env` with your real Twilio credentials and phone numbers.

## 3) Test once

```bash
python send_sms.py
```

## 4) Schedule daily at 7:00 AM (local machine time)

Open crontab:

```bash
crontab -e
```

Add this line (replace paths with your own if different):

```cron
0 7 * * * cd "/Users/matthewbrown/Documents/New project" && /Users/matthewbrown/Documents/New\ project/.venv/bin/python send_sms.py >> sms.log 2>&1
```

## Notes

- Twilio typically sends from a Twilio number, not your personal carrier number.
- Keep your `.env` private.
- Only send messages to recipients who have consented.
