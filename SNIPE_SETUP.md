# Snipe Executor Setup — eBay User Token

The `POST /api/auctions/{id}/execute-snipe` endpoint places real bids on eBay using the Trading API `PlaceOffer` call. It requires an eBay **user** token (not the OAuth client token used for Browse API).

## What you already have (app-level, already configured)

- `EBAY_APP_ID` — app ID (Client ID)
- `EBAY_CERT_ID` — cert (Client Secret)
- `EBAY_DEV_ID` — dev ID

## What you need to add: `EBAY_USER_TOKEN`

This is the "Auth'n'Auth" user token. It's a long string that represents YOU granting your app permission to act on your behalf.

### Steps

1. Go to https://developer.ebay.com/my/auth?env=production&index=0
2. Sign in with your eBay seller/buyer account.
3. Under "User Tokens" click **"Get a Token from eBay via Your Application"**.
4. Accept the consent prompt ("I agree").
5. eBay redirects you to a page with a token starting with `AgAAAA...` — copy the full token (it's long, ~1,500 chars).
6. Add it to Vercel:

```bash
vercel env add EBAY_USER_TOKEN production
# Paste the token, hit Enter
vercel --prod --yes
```

### Token lifetime

Production user tokens expire after **18 months**. Set a calendar reminder to refresh.

## Test without real bidding

With `EBAY_USER_TOKEN` unset, the endpoint returns:

```json
{ "status": "no_credentials", "message": "EBAY_USER_TOKEN not set ..." }
```

The "Place Snipe Bid" button on the UI shows a helpful popup pointing at this doc.

## Once set up

Click "Place Snipe Bid" on any `snipe_eligible` auction card. You'll be prompted for max bid, and the request POSTs to `/api/auctions/{id}/execute-snipe` which calls `PlaceOffer` against `api.ebay.com/ws/api.dll`.

## Safety

The endpoint short-circuits to a no-op if `EBAY_USER_TOKEN` is missing. Bids cannot be placed accidentally. Confirm max bid twice before committing real money — the frontend prompt is the only guard before the bid is live.
