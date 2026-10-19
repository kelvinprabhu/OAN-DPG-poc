# DSS × OpenUI harness

Renders DSS turn responses with OpenUI Lang. A mock DSS replays static responses from `scenarios.json` over the
[DSS Turn API v1](https://github.com/OpenAgriNet/decision-support-system/blob/main/docs/api-contracts/api-contract.md)
contract (JSON and SSE). No LLM and no API keys anywhere.

## Run

```bash
pnpm install
pnpm dev     # mock DSS on http://localhost:8787, UI on http://localhost:5173
pnpm test    # contract, negative-request, OpenUI render and chain checks
```

Node 20+. If pnpm is not installed, use `npx pnpm@10 install` and so on.

In the UI, pick a scenario on the left and press **Play next scripted turn**, or click the rendered buttons. The right
pane shows the exact request (headers and body) and the exact JSON or SSE frames received, with `sequenceNumber`.
The toggles set `Accept` (SSE or JSON) and gzip the request body.

## Point the UI at a real DSS

```bash
DSS_BASE_URL=https://dss.example.internal pnpm dev
```

The Vite dev server proxies `/v1` to `DSS_BASE_URL` (default `http://localhost:8787`). `/scenarios` always comes from
the mock (`MOCK_URL`, default `http://localhost:8787`), so keep the mock running: it supplies the scenario list and
each assistant turn's `historyText`, which the UI replays as history.

Other settings: `MOCK_PORT` (mock port, default 8787) and `IMAGE_HOST_ALLOWLIST` (comma-separated attachment hosts the
mock accepts, default `localhost,127.0.0.1`).

## Layout

| Path | What |
|---|---|
| `server/app.ts` | Mock DSS: `POST /v1/turns`, `GET /health`, `GET /scenarios` |
| `shared/contract.ts` | Closed zod schemas, hand-written from `openapi.yaml` |
| `src/library.tsx` | OpenUI component library (`agriLibrary`, root `Stack`) |
| `src/buildRequest.ts` | Builds the exact request envelope |
| `src/sendTurn.ts` | Sends JSON or SSE and parses frames |
| `src/App.tsx` | Three-pane UI |
| `scripts/fetch-images.mjs` | Downloads the images in `public/` from Wikimedia Commons (credits in `public/ATTRIBUTION.md`) |
| `scripts/gen-images.mjs` | Offline alternative: labelled placeholder PNGs |

## Behaviour notes

- **Matching.** The mock reads the last user message and uses its text up to the first newline as the key. No match
  returns `defaults.fallback` (HTTP 200, `no_match`).
- **Streaming.** Only `answered` turns emit `claim.delta`, in 8 to 20 character pieces 40 ms apart.
- **Buttons.** A button sends its `@ToAssistant("…")` message, not its label; the scenario chains depend on this
  (S05: "None of these" sends "None of these match"). Form values follow as `key: value` lines.
- **traceId.** The mock takes it from `traceparent`. Without one, it uses `transactionId` with the dashes removed,
  and only then random hex. The contract prose (§1.1) says `traceparent`, while `openapi.yaml` says it echoes
  `transactionId`; the order above satisfies both.
- **Unscripted buttons.** These have no next turn and get the fallback: S01 "पंजीकरण रद्द करें" and
  "ई-केवाईसी कैसे करें", S02 "Start PM-KISAN registration", S05 "It looks like stem borer" and "None of these match",
  S06 "It is late blight" and "It is septoria leaf spot". Every other button leads to a scripted turn.
- **Dataset.** `scenarios.json` here has 11 scenarios and 44 turns, each scenario with 4 turns. It extends your
  original (10 scenarios, 18 turns): S11 (weather) is new, and S01 to S10 gained turns, each reached by a button added
  to the previous response (the original turns and their buttons are unchanged). All user texts are unique, and form
  values match the form's field names. Your original file in the parent folder is untouched.
- **OpenUI syntax.** All OpenUI programs in the dataset parse and render against `agriLibrary` as written (including
  `{required: true, minLength: 2}` rules and `@ToAssistant`), so no syntax fixes were needed.

## Known gaps

- **No UI content type.** Contract v1 has no structured-UI content type. This harness carries OpenUI Lang inside
  `content[].text` (`{type:"text", text:"root = …", annotations: []}`), and the UI detects it by the `root =`
  statement.
- **Text-only real DSS.** The real DSS currently accepts only text input content items. Image turns (S05, S06) work
  against the mock only.
- **No hash check.** The mock checks the `sha256` format and the URL host, but does not fetch the image and verify
  the bytes, which the contract requires of DSS.
- **Sample data.** All agronomy and scheme numbers in the dataset are sample values for UI testing, not advice.
  Images are illustrative.
