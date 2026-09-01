# Telegram Earning Mini App — MVP

This is a starter project for a Telegram Bot + Telegram Mini App + Admin Panel.

## Features included

- Telegram bot `/start`
- Referral link: `https://t.me/BOT_USERNAME?start=ref_USER_ID`
- Telegram Mini App authentication validation on the server
- User balance and referral count
- Task list and reward
- Withdrawal request
- Basic admin panel
- Approve/reject withdrawals
- Add tasks from admin panel

## Important before real money

The `/api/claim-task` endpoint is intentionally an MVP. It does NOT yet prevent repeated claims.
Before using real money, add a `task_claims` table and server-side checks, plus anti-fraud/rate limits.

SQLite is suitable for testing. For production, move the database to PostgreSQL or another persistent database.

## Environment

Copy `.env.example` to `.env` and set:

- BOT_TOKEN
- BOT_USERNAME
- APP_URL
- ADMIN_PASSWORD

## Run

```bash
npm install
npm start
```

For local bot polling, leave APP_URL empty. For a deployed HTTPS service, set APP_URL and the bot will use `/telegram/webhook`.

## Telegram setup

1. Create a bot with @BotFather.
2. Set the bot username and token in the environment.
3. Deploy the app to an HTTPS URL.
4. In @BotFather configure the bot's Main Mini App / Web App URL to the deployed app URL.
5. Open the bot and press Start.

## Admin

Open:

`https://YOUR-DOMAIN/admin`

Enter `ADMIN_PASSWORD`.

## Next upgrades

- PostgreSQL
- Real ad network integration
- Task completion verification
- Anti-fraud system
- Daily task limits
- Leaderboard
- Movies/videos section
- Broadcast
- User block/unblock
- Payment gateway integration
- Better UI matching the reference video
