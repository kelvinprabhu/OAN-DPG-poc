// Downloads freely licensed photos from Wikimedia Commons into public/ as 640x400 PNGs
// and writes public/ATTRIBUTION.md. Offline alternative: `pnpm images` (labelled placeholders).
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const UA = "dss-openui-harness/0.1 (test harness; image fetch)";
const IMAGES = [
  ["samples/maize-leaf-damage.png", "File:Spodoptera frugiperda in stalk of Zea mays.jpg"],
  ["samples/tomato-leaf.png", "File:Alternaria solani on Solanum lycopersicum.jpg"],
  ["ref/faw.png", "File:Spodoptera frugiperda caterpillar01.jpg"],
  ["ref/stem-borer.png", "File:Stem Borer Damage on Maize.jpg"],
  ["ref/grasshopper.png", "File:Atractomorpha lata, Burdwan, West Bengal, India 27 10 2012.jpg"],
  ["ref/neem.png", "File:Neemöl als natürliches Pflanzenschutzmittel.jpg"],
  ["ref/emamectin.png", "File:Emamectin b1a v2.svg"],
  ["ref/spinetoram.png", "File:Spinetoram-j.svg"],
  ["ref/urea.png", "File:Sample of Urea.jpg"],
  ["ref/dap.png", "File:DAP (Diammonium Phosphate) Granules (1).jpg"],
  ["ref/mop.png", "File:Compacted potassium chloride, fertilizer grade.jpg"],
  ["ref/early-blight.png", "File:Early blight on tomato leaves (7871930010).jpg"],
  ["ref/late-blight.png", "File:Late blight on tomato leaf (7871756748).jpg"],
  ["ref/septoria.png", "File:Tomato septoria leaf spot 3007.jpg"],
];

const strip = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with backoff: Commons answers 429 (or a plain-text "too many requests") when hit fast. */
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res;
    if (attempt >= 5 || (res.status !== 429 && res.status < 500)) throw new Error(`${url}: HTTP ${res.status}`);
    await sleep(Number(res.headers.get("retry-after") ?? 0) * 1000 || 2000 * 2 ** attempt);
  }
}

// One metadata query for every title.
const api =
  "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
  "&iiprop=url|extmetadata&iiurlwidth=1280&iiextmetadatafilter=LicenseShortName|Artist&titles=" +
  encodeURIComponent(IMAGES.map(([, t]) => t).join("|"));
const info = await (await get(api)).json();
const byTitle = new Map(Object.values(info.query.pages).map((p) => [p.title, p.imageinfo?.[0]]));
const normalized = new Map((info.query.normalized ?? []).map((n) => [n.from, n.to]));

const rows = [];
for (const [path, title] of IMAGES) {
  const ii = byTitle.get(normalized.get(title) ?? title);
  if (!ii) throw new Error(`No imageinfo for ${title}`);
  const bytes = Buffer.from(await (await get(ii.thumburl ?? ii.url)).arrayBuffer());
  const isDiagram = title.endsWith(".svg");
  const out = new URL(`../public/${path}`, import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  await sharp(bytes)
    .flatten({ background: "#ffffff" })
    .resize(640, 400, isDiagram ? { fit: "contain", background: "#ffffff" } : { fit: "cover", position: "attention" })
    .png({ compressionLevel: 9 })
    .toFile(out.pathname);
  rows.push(
    `| \`public/${path}\` | [${title.slice(5)}](${ii.descriptionurl}) | ${strip(ii.extmetadata?.Artist?.value) || "unknown"} | ${ii.extmetadata?.LicenseShortName?.value ?? "?"} |`,
  );
  console.log("wrote public/" + path);
  await sleep(1500);
}

writeFileSync(
  new URL("../public/ATTRIBUTION.md", import.meta.url),
  [
    "# Image attribution",
    "",
    "Images from Wikimedia Commons, resized and cropped to 640x400 PNG by `scripts/fetch-images.mjs`.",
    "Used only to test UI rendering; captions in scenarios.json are sample text, not diagnoses.",
    "",
    "| File | Source | Author | License |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"),
);
