// Generates the install icons, the Apple touch icon and the default social-sharing image from the one brand mark in src/app/icon.png.
// Run once (and again only if the logo changes):  node scripts/generate-pwa-assets.mjs
// The generated files are committed; nothing here runs during the build.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SOURCE = "src/app/icon.png";
const BACKGROUND = "#fdf1f4"; // --background in globals.css (light theme)

mkdirSync("public/icons", { recursive: true });

const mark = (size) => sharp(SOURCE).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });

await mark(512).png({ compressionLevel: 9 }).toFile("public/icons/icon-512.png");
await mark(192).png({ compressionLevel: 9 }).toFile("public/icons/icon-192.png");

// Maskable icons are cropped to a circle or rounded square by the OS: keep the mark inside the central ~60% "safe zone".
const inner = await mark(320).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: BACKGROUND } })
  .composite([{ input: inner, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile("public/icons/icon-maskable-512.png");

// iOS ignores transparency (it paints black), so the touch icon sits on the brand background.
const touchInner = await mark(140).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: BACKGROUND } })
  .composite([{ input: touchInner, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile("src/app/apple-icon.png");

// Default Open Graph / social image (1200x630): the brand mark centred on the brand background. No text, no claims.
const ogInner = await mark(360).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: BACKGROUND } })
  .composite([{ input: ogInner, gravity: "centre" }])
  .png({ compressionLevel: 9 })
  .toFile("src/app/opengraph-image.png");

console.log("PWA icons, Apple touch icon and default social image written.");
