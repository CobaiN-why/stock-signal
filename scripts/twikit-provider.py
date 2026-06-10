#!/usr/bin/env python3
"""Fetch tweets from a user timeline using twikit (cookie-based, free)."""

import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path

COOKIE_FILE = Path(__file__).parent / "twikit-cookies.json"


def get_client():
    from twikit import Client

    client = Client("en-US")

    if COOKIE_FILE.exists():
        try:
            client.load_cookies(str(COOKIE_FILE))
            # Test if cookies are still valid
            client.user_id()
            return client
        except Exception:
            pass

    # Need to login
    username = os.environ.get("X_USERNAME")
    email = os.environ.get("X_EMAIL")
    password = os.environ.get("X_PASSWORD")

    if not username or not password:
        raise RuntimeError(
            "X_USERNAME and X_PASSWORD env vars required for first login"
        )

    client.login(
        auth_info_1=username,
        auth_info_2=email or username,
        password=password,
    )
    client.save_cookies(str(COOKIE_FILE))
    return client


def fetch_tweets(username: str, since: str | None = None):
    client = get_client()

    try:
        user = client.get_user_by_screen_name(username)
    except Exception as e:
        raise RuntimeError(f"Failed to get user @{username}: {e}")

    try:
        tweets = user.get_tweets("Tweets", count=40)
    except Exception as e:
        raise RuntimeError(f"Failed to get tweets for @{username}: {e}")

    results = []
    cutoff = None
    if since:
        cutoff = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)

    for tweet in tweets:
        created = tweet.created_at
        if isinstance(created, str):
            created = datetime.fromisoformat(
                created.replace("Z", "+00:00")
            )
        # twikit returns epoch milliseconds sometimes
        if isinstance(created, (int, float)):
            created = datetime.fromtimestamp(created / 1000, tz=timezone.utc)

        if cutoff and created < cutoff:
            continue

        results.append(
            {
                "id": str(tweet.id),
                "text": tweet.text or tweet.full_text or "",
                "createdAt": created.isoformat(),
                "url": f"https://x.com/{username}/status/{tweet.id}",
            }
        )

    return results


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: twikit-provider.py <username> [since]"}))
        sys.exit(1)

    username = sys.argv[1]
    since = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        results = fetch_tweets(username, since)
        json.dump(results, sys.stdout, ensure_ascii=False)
    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
