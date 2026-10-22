# mailwatch

Labels arriving Gmail that delivers a verification code or link with one Gmail label, `oak-verify-email`.

For every new inbox email it asks TypeSafe Jev, from the sender, the subject and the plain text (cut to 3000 characters), whether the email exists to deliver a one-time verification code, or a link the recipient must open to verify an account or an email address. When Jev's probability for that is at least `MAIL_VERIFY_MIN_CONFIDENCE` (default 0.8) the label is put on the message. Anything else is left alone. There is one label, for codes and links alike. The Oak extension's Emails tab lists the mail that has it (`GET /acorn/gmail/verify-mail`).

## Two ways to notice new mail

|             | Push                                                                        | Polling                                                          |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Used when   | `GMAIL_PUSH_TOPIC` is set                                                   | `GMAIL_PUSH_TOPIC` is empty                                      |
| Latency     | seconds                                                                     | up to `MAIL_VERIFY_POLL_INTERVAL` (30 s)                         |
| Gmail calls | `users.watch` per mailbox every few days; a `history.list` per notification | one `users.history.list` per mailbox per interval: 2 quota units |
| Needs       | a Google Cloud project **with billing** (Pub/Sub), a public HTTPS URL       | nothing beyond the existing Gmail connection                     |

Both feed the same sync, so everything below the table is true of both. Polling is the default and works as soon as a Gmail mailbox is connected. Push is the real-time option; setting the topic turns polling off.

## What it does

1. A mailbox whose grant can modify labels (`canModify`) is watched. A mailbox without it is skipped.
2. A sync lists the INBOX messages added since the mailbox's stored `historyId` (`users.history.list`, `messageAdded`, `labelId=INBOX`). A mailbox with no cursor starts from `users.getProfile`'s current `historyId`: mail that was already there is **not** labelled.
3. Ids already in `acorn_gmail_processed` are skipped (idempotency: Pub/Sub delivers at least once, and the same notification twice does the same work once).
4. Each remaining email is read in memory (`format=full`, never cached), judged by Jev, and dropped. Emails over the confidence bar are labelled together with one `messages.batchModify`.
5. The `historyId` moves forward only after every message was dealt with, so a failed sync is retried from the same place. An email that fails three times is given up on.
6. A `404` from `history.list` (Gmail no longer has the cursor) re-syncs the newest inbox mail of the last 24 hours, at most 25 messages, then resets the cursor.

Mailboxes sync one at a time each (a request while one runs makes it run once more), on at most 4 workers at once. A mailbox that keeps failing backs off, up to 15 minutes. Gmail calls retry on `429`/`5xx` with exponential backoff, jitter and `Retry-After`.

## Label handling

The label id is cached in memory and in `acorn_gmail_watch`. `labels.list` runs only on a cache miss, the label is created only when it does not exist, and a create that loses a race (`409`) re-reads the label the other worker made. Applying a label a message already has is a no-op. If the person deletes the label, the stale id is looked up again once.

## Scopes

Adding a label to a message needs **`https://www.googleapis.com/auth/gmail.modify`** (it also covers reading). The existing Gmail connection already asks for it together with `gmail.readonly`, `openid`, `email` and `profile`; no new scope. A mailbox connected before that scope was added has `canModify=false`, is skipped, and must be reconnected from acorn-frontend.

## Privacy

- Email text is held in memory for one judgement and dropped. It is never stored and never logged. Logs carry account ids, mailbox ids, message ids, counts and statuses only.
- Stored: per mailbox, `{mailboxId, accountId, email, historyId, watchExpiration, labelId}` in `acorn_gmail_watch`, and message ids in `acorn_gmail_processed` (7 days). No refresh token, no body, no code.
- Refresh tokens stay where they were (`acorn_gmail_mailboxes`); this package does not change how they are stored.
- The push endpoint is the one public URL. Every call must carry Google's signed OIDC token for the configured service account and audience, or it gets `401`.
- Cost: each judged email is one Jev call on the account's **own** OpenRouter key (no key: the mail is skipped). It is recorded in `acorn_ai_usage` as feature `mail_verify_label`, client `acorn-backend`.

## Environment

| Variable                     | Default | Meaning                                                                                             |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `MAIL_VERIFY_MIN_CONFIDENCE` | `0.8`   | Label only at or above this probability (above 0, at most 1).                                       |
| `MAIL_VERIFY_POLL_INTERVAL`  | `30s`   | Polling mode: how often each mailbox is read (a Go duration, at least `10s`). Ignored with a topic. |
| `GMAIL_PUSH_TOPIC`           | empty   | Full topic name, `projects/<project-id>/topics/<topic>`. Empty means polling.                       |
| `GMAIL_PUSH_AUDIENCE`        |         | Push: the `aud` claim of the subscription's token. Required with a topic.                           |
| `GMAIL_PUSH_SERVICE_ACCOUNT` |         | Push: the service account the subscription signs with. Required with a topic.                       |

The existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a Gmail redirect (`GOOGLE_GMAIL_REDIRECT_URL`) are still what lets a mailbox connect at all.

## Google Cloud setup for push

Only for push. Polling needs none of this.

1. Use the Google Cloud project that owns the OAuth client (Gmail watch requires the topic to be in the same project as the OAuth client), and make sure **billing is enabled** on it.
2. Enable the **Gmail API** and the **Cloud Pub/Sub API**.
3. Create a topic, for example `gmail-push`.
4. Give Gmail permission to publish to it: on the topic, grant **Pub/Sub Publisher** (`roles/pubsub.publisher`) to `gmail-api-push@system.gserviceaccount.com`.
5. Create a service account for the subscription to sign its calls with, for example `gmail-push-invoker`. It needs no roles of its own for this.
6. Create a **push** subscription on the topic:
   - Endpoint: `https://<your-api-host>/acorn/gmail/push` (public, HTTPS).
   - Enable authentication: pick the service account from step 5, and set the **audience** to a value you choose (the endpoint URL is a good one).
   - Acknowledgement deadline: 30 seconds. Leave the default retry policy.
7. Set the three variables: `GMAIL_PUSH_TOPIC`, `GMAIL_PUSH_AUDIENCE` (exactly the audience from step 6) and `GMAIL_PUSH_SERVICE_ACCOUNT` (the service account's email).
8. Restart acorn-backend. At startup it registers a watch for every mailbox that can modify labels, and renews them every 6 hours when they end within 24 hours.

To try push on a development machine, expose acorn-backend through an HTTPS tunnel (for example `cloudflared tunnel --url http://127.0.0.1:8083`), use the tunnel's URL as the subscription endpoint, and use the same URL as the audience.

## Gmail behaviour that could force a design change

- **One watch per user and project.** Calling `users.watch` again replaces the earlier one, which is how renewal works. Two servers using the same OAuth client for the same mailbox (for example production and a development machine) would take each other's watch: only one of them gets the notifications. Use separate OAuth clients or run polling on the second.
- **A watch lasts at most 7 days.** Google recommends calling it daily. This package renews when fewer than 24 hours are left, checked every 6 hours. If the server is down for longer than a watch has left, mail stops being noticed until it starts again (it registers every watch at startup).
- **Notifications carry only `emailAddress` and `historyId`, and can be merged or dropped.** Gmail may send fewer notifications than there are messages, and Pub/Sub can deliver one twice or out of order. That is why the sync always reads history from the stored cursor and never trusts the notification's `historyId`, and why the processed-id collection exists. If notifications ever stop arriving, a missed message is found by the next one, or by a re-sync.
- **History is kept for a limited time** (about a week, sometimes less). An older cursor answers `404`; the re-sync covers only the last 24 hours and 25 messages, so mail older than that which arrived while the server was down is not labelled.
- **Quota.** Units per call: `users.watch` 100, `messages.get` 5, `messages.modify` 5, `messages.batchModify` 50, `history.list` 2, `labels.list` 1, `labels.create` 5. The limit is 250 units per user per second, so a burst of new mail is read 4 at a time per mailbox. A very large burst (over 100 new emails in one sync) is cut to the newest 100.
- **Polling cost.** At 2 units per call and one call per mailbox every 30 seconds, a mailbox uses 5,760 units a day for nothing but looking. That is far under Gmail's limits for one user, but the default is the shortest interval worth using; the minimum is 10 seconds.
- **Model cost.** Every new inbox email, wanted or not, is one Jev call. There is no keyword pre-filter by design (no wording rules). A mailbox that gets a lot of mail costs more.
- **Newsletters and the like are judged too.** A rare false positive puts the label on an ordinary email; the threshold (`MAIL_VERIFY_MIN_CONFIDENCE`) is the control.
