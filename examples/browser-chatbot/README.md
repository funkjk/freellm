# Browser Chatbot Example

A minimal streaming chatbot that runs entirely in a static HTML page and talks to a FreeLLM gateway using short-lived browser tokens. The page fetches a token from a tiny serverless function, then streams chat completions with the official OpenAI SDK.

## Prerequisites

- A running FreeLLM gateway (self-hosted or deployed) and its base URL
- A FreeLLM master API key
- A Vercel account, or any platform that runs Node serverless functions

## Environment variables

Set these on your host (Vercel project, local shell, etc):

```
FREELLM_BASE_URL=https://your-gateway.example.com
FREELLM_API_KEY=sk-your-master-key
FREELLM_ALLOWED_ORIGIN=https://yoursite.com
```

`FREELLM_ALLOWED_ORIGIN` is optional. If omitted, the function uses the request host to build the origin.

## Run locally

Point at a FreeLLM gateway running on port 5180:

```
export FREELLM_BASE_URL=http://localhost:5180
export FREELLM_API_KEY=sk-your-master-key
export FREELLM_ALLOWED_ORIGIN=http://localhost:3001
npx vercel dev --listen 3001
```

Open http://localhost:3001 and start chatting.

## Deploy to Vercel

```
vercel deploy
vercel env add FREELLM_BASE_URL
vercel env add FREELLM_API_KEY
vercel env add FREELLM_ALLOWED_ORIGIN
vercel deploy --prod
```

## Security notes

- Browser tokens are stateless HMAC tokens with a max lifetime of 15 minutes. This example uses the full 900 seconds.
- Each token is bound to the origin you passed to `/v1/tokens/issue`. The gateway rejects requests from other origins.
- Tokens are rate limited per identifier, so one abusive session cannot exhaust your budget.
- If a token leaks, it expires on its own within 15 minutes. Rotate your master key only if the master key itself is exposed, not on individual token leaks.
- Never ship the master key to the browser. It lives in the serverless function env only.

## Files

- `index.html` - the chat UI and streaming logic
- `api/freellm-token.js` - the token issuing serverless function
- See the full docs at `/browser-integration` on the FreeLLM website
