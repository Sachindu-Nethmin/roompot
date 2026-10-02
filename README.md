# 🍳 RoomPot

**A shared room budget for roommates who cook together.** Tell the group chat what you bought, like *"rice 1200, eggs 450, gas 3800"* or *"haal 2k, pol 3k 360"*, or send a photo of the bill. An open-weight model (Gemma, running locally through Ollama) reads it, logs the cost under whoever is logged in, splits it between the room, and keeps a running tally of who owes whom. No more "machan, did I give you money for the gas last week?"

<p align="center">
  <img src="docs/chat.jpg" width="360" alt="Chat where roommates log purchases and RoomPot splits them" />
  &nbsp;
  <img src="docs/money.jpg" width="360" alt="Money dashboard with average daily spend, 30-day chart and settle-up" />
</p>

## Why it exists

Four of us share a room and cook together. Whoever goes to the shop pays, and at the end of the month we add it all up and divide by four. Except someone always forgets to write a purchase down, and someone else forgets to collect. RoomPot puts the bookkeeping where we already talk, in a chat, so logging a purchase takes five seconds.

## Features

- **Chat to log costs** in English, Sinhala or Singlish. The model pulls out items and prices, and understands shorthand like `1.2k`, `450/=` and `pol 3k 360` (three coconuts for 360).
- **Automatic payer**: the person logged in is the payer. *"Kasun bought bread 200"* credits Kasun instead.
- **Partial splits**: *"shampoo for me and Nimal 800"* only splits between the two of you.
- **Receipt photos**: snap the shop bill; Gemma's vision reads each line and skips totals, cash and change.
- **Average daily spend**: a rolling 30-day average for the room and per person, plus today, this month (with a projection), last 7 days versus the week before, and a 30-day daily spend chart.
- **Settle up**: balances for every member and the fewest payments that clear all debts, with a *Mark paid* button. You can also just say *"gave Kasun 1500"* in the chat.
- **Ask questions**: *"how much did we spend on gas?"*, *"how much do I owe?"*, answered from the room's own data.
- **Keeps working offline**: if the model is unavailable, a rule-based parser still logs `item price` messages.
- Invite code to join a room, works on phones, light and dark mode.

## Why open models

- **Our money stays with us.** Who bought what and who owes whom is private. With Ollama, every message and receipt photo is processed on our own laptop. Nothing goes to a third-party AI API.
- **Free to run.** No per-message bill for a tool that gets used ten times a day.
- **Swap or tune the model.** One environment variable switches between Gemma sizes, any other Ollama model, or a hosted open model. The prompt is plain text in [`src/lib/parse.ts`](src/lib/parse.ts) and can be adjusted for your own language and slang.

## Run it locally

You need Node 20+, MongoDB and [Ollama](https://ollama.com).

```bash
ollama pull gemma4:E4B          # or gemma3:4b on smaller machines
git clone https://github.com/Sachindu-Nethmin/roompot.git
cd roompot
npm install
cp .env.example .env.local      # adjust if needed
npm run dev
```

Open http://localhost:3000, sign up, create a room, and share the invite code with your roommates. To let them use it from their phones on the same Wi-Fi, open `http://<your-laptop-ip>:3000`.

Want to see it with data? `npm run seed:demo` creates **Room 12B** with three weeks of cooking costs. Log in as `sachindu`, `kasun`, `nimal` or `dilan` with password `demo1234`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/roompot` | Local MongoDB or MongoDB Atlas |
| `SESSION_SECRET` | dev value | Set a long random string in production |
| `LLM_PROVIDER` | `ollama` | `ollama` or `openai` (any OpenAI-compatible server) |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` | Ollama URL, or e.g. `https://generativelanguage.googleapis.com/v1beta/openai` |
| `LLM_MODEL` | `gemma4:E4B` | e.g. `gemma3:4b`, `gemma-3-27b-it` |
| `LLM_API_KEY` | | Only for hosted providers |
| `MAX_ROOM_MEMBERS` | `8` | |

## Deploy

[`render.yaml`](render.yaml) deploys the web app to Render with Gemma served through an OpenAI-compatible endpoint and MongoDB Atlas as the database. Set `MONGODB_URI` and `LLM_API_KEY` in the Render dashboard. If you want everything to stay on your own hardware, run it on a laptop or home server with Ollama instead.

## How it works

```
message / receipt photo
        │
        ▼
 Gemma (Ollama) ── JSON ──► intent: expense | settlement | question | other
        │                    items, payer, who shares it
        ▼
 zod validation + member name matching (fallback parser if the model is down)
        │
        ▼
 MongoDB: expenses, settlements, chat messages
        │
        ▼
 ledger.ts: balances → fewest settle-up payments, daily averages, 30-day series
```

- [`src/lib/parse.ts`](src/lib/parse.ts): prompt, JSON parsing, member matching, fallback parser
- [`src/lib/ledger.ts`](src/lib/ledger.ts): balances, debt simplification, spend statistics in the room's timezone
- [`src/lib/llm.ts`](src/lib/llm.ts): small client for Ollama and OpenAI-compatible endpoints
- [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts): turns a chat message into an expense, a settlement or an answer

Built with Next.js, MongoDB (Mongoose), Tailwind CSS and Gemma.

## License

MIT
