/**
 * Generate the PNG app icons for the PWA from public/icon.svg.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Emits:
 *  - public/icon-192.png           — small install icon (Chrome/Android)
 *  - public/icon-512.png           — large install icon
 *  - public/icon-maskable-512.png  — maskable icon (launchers that crop to a
 *    circle); content scaled to ~62% so the "10/10" mark stays inside the
 *    safe zone
 *  - public/apple-touch-icon.png   — iOS "Add to Home Screen" icon (180px)
 */
import { readFileSync, statSync } from "node:fs";
import sharp from "sharp";

const SVG = readFileSync("public/icon.svg");

const BG = "#16130f"; // matches the tile in icon.svg
const MASKABLE_CONTENT = 320; // of a 512 canvas → 62.5%, inside the safe zone

await sharp(SVG).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(SVG).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(SVG).resize(180, 180).png().toFile("public/apple-touch-icon.png");

await sharp({
  create: { width: 512, height: 512, channels: 3, background: BG },
})
  .composite([
    {
      input: await sharp(SVG).resize(MASKABLE_CONTENT, MASKABLE_CONTENT).png().toBuffer(),
      left: Math.round((512 - MASKABLE_CONTENT) / 2),
      top: Math.round((512 - MASKABLE_CONTENT) / 2),
    },
  ])
  .png()
  .toFile("public/icon-maskable-512.png");

console.log("Generated PWA icons:");
for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
  console.log(`  public/${f}  ${statSync(`public/${f}`).size} bytes`);
}
