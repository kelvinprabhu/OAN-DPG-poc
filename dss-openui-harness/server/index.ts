import { readFileSync } from "node:fs";
import { createApp } from "./app";
import type { Dataset } from "../shared/dataset";

const dataset = JSON.parse(readFileSync(new URL("../scenarios.json", import.meta.url), "utf8")) as Dataset;
const port = Number(process.env.MOCK_PORT ?? 8787);
const allowedImageHosts = (process.env.IMAGE_HOST_ALLOWLIST ?? "localhost,127.0.0.1").split(",").map((h) => h.trim());

createApp({ dataset, allowedImageHosts }).listen(port, () => {
  console.log(`mock DSS listening on http://localhost:${port} (POST /v1/turns, GET /scenarios, GET /health)`);
});
