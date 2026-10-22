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
| `src/library.tsx` | OpenUI component library (`agriLibrary`, root `Stack`): our components plus built-in OpenUI elements |
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
- **Dataset.** `scenarios.json` here has 16 scenarios and 69 turns. It extends your original (10 scenarios, 18 turns):
  S11 (weather forecast), S12 (weather map), S13 (scheme form tree), S14 (livestock nested questions), S15 (grievance)
  and S16 (crop advisory) are new, and S01 to S10 gained turns, each
  reached by a button added to the previous response (the original turns and their buttons are unchanged). Every
  scenario has 4 turns on its scripted path. All user texts are unique, and form values match the form's field names.
  Your original file in the parent folder is untouched.
- **Order.** The scenario list is grouped in this order, each scenario carrying a `group` field shown as a heading in
  the left pane: Nested question (S14), Mandi (S07, S10), Weather (S11, S12), Scheme (S01, S02, S03, S04, S09, S13),
  Grievance (S15), Agri advisory (S16, S05, S06), Fertilizer (S08). IDs did not change. A test checks the group order.
- **Branches (`from`).** A turn may carry `"from": "<user text of an earlier turn>"` when it is reached from that
  turn and not from the previous one. S13 uses it: the three scheme forms other than PM-KISAN are branches of the
  first turn. "Play next scripted turn" follows the scripted path only (turns without `from`); branches are reached
  by using the UI, and the tests replay each branch with the history of its parent chain.
- **Form tree (S13).** The first S13 response holds all four scheme forms and picks one in the browser:
  `$scheme` is a state variable, each scheme button runs `@Set($scheme, "...")`, and
  `tree = $scheme == "PMFBY" ? fPmfby : (...)` chooses which `Form` is drawn. Choosing a scheme sends no request.
  Submitting a form sends that scheme's `@ToAssistant` text with only that form's values.
- **Nested questions (S14, S16).** Each answer is bound to a `$variable`
  (`RadioGroup("animal", [...], null, null, $animal)`) and each follow-up is a sibling that shows only while its
  parents' answers match: `c3 = ($animal == "Cattle" && $cattle_herd != "") ? c3a : null`. S14 goes four levels deep
  (animal, herd size, collar yes/no, collar called yes/no, reason) with separate goat and poultry branches. A question
  clears its own answer when it hides, so a switched branch leaves no stale answers behind. The UI reads the
  `$variable` answers from the action's `formState` and sends them as `key: value` lines.
- **Built-in OpenUI elements.** `src/library.tsx` reuses these from `@openuidev/react-ui` unchanged: `RadioGroup`,
  `CheckBoxGroup`, `SwitchGroup`, `Chips`, `OptionCards`, `TextArea` and `Tag` (plus their item components), added
  to `FormControl` or `Stack` with `library.extend`. We import only the library and `components.css`, not the chat UI.
  Our own components keep their names and signatures.
- **Not used: Slider and Tabs.** In our jsdom tests both froze the renderer (the Slider was bound to an array value, the Tabs
  held our own components). The cause was not investigated, and neither was tried in a browser.
- **OpenUI syntax.** All OpenUI programs in the dataset parse and render against `agriLibrary` as written (including
  `{required: true, minLength: 2}` rules and `@ToAssistant`), so no syntax fixes were needed.

- **Map.** `Map(center, zoom, markers, caption?)` and `MapMarker(label, lon, lat, value?, tone?)` use Leaflet.
  Coordinates are `[longitude, latitude]`, like the contract's GeoJSON. The browser loads map tiles from
  `tile.openstreetmap.org` while a map is on screen, which is the one network call the UI makes besides `/v1` and
  `/scenarios`; offline, the markers still show in the list under the map.

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
