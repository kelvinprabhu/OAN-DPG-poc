// Deterministic 640x400 placeholder PNGs: big label on a coloured background.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const IMAGES = [
  ["samples/maize-leaf-damage.png", "Maize leaf damage", "SAMPLE", "#6d8b3a"],
  ["samples/tomato-leaf.png", "Tomato leaf", "SAMPLE", "#7a5c2e"],
  ["ref/faw.png", "Fall armyworm", "PEST", "#8d3b2f"],
  ["ref/stem-borer.png", "Stem borer", "PEST", "#9a5b1e"],
  ["ref/grasshopper.png", "Grasshopper", "PEST", "#5d7a1f"],
  ["ref/neem.png", "Neem oil", "PRODUCT", "#2f6b3a"],
  ["ref/emamectin.png", "Emamectin benzoate", "PRODUCT", "#2d5f8b"],
  ["ref/spinetoram.png", "Spinetoram", "PRODUCT", "#5b3f8c"],
  ["ref/urea.png", "Urea", "FERTILIZER", "#3d6f99"],
  ["ref/dap.png", "DAP", "FERTILIZER", "#7b4a8f"],
  ["ref/mop.png", "MOP", "FERTILIZER", "#a3412f"],
  ["ref/early-blight.png", "Early blight", "DISEASE", "#7a4b25"],
  ["ref/late-blight.png", "Late blight", "DISEASE", "#465a6b"],
  ["ref/septoria.png", "Septoria leaf spot", "DISEASE", "#6b5a2a"],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const [path, label, tag, bg] of IMAGES) {
  const size = label.length > 14 ? 52 : 68;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="640" height="400" fill="${bg}"/>
  <rect x="24" y="24" width="592" height="352" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="4"/>
  <text x="320" y="120" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff" fill-opacity="0.75" text-anchor="middle" letter-spacing="4">${esc(tag)}</text>
  <text x="320" y="225" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(label)}</text>
  <text x="320" y="330" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#ffffff" fill-opacity="0.7" text-anchor="middle">placeholder for UI testing</text>
</svg>`;
  const out = new URL(`../public/${path}`, import.meta.url);
  mkdirSync(new URL(".", out), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out.pathname);
  console.log("wrote public/" + path);
}
