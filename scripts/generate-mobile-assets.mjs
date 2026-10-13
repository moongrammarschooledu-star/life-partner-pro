// Generates the Android and iOS launcher icons and splash images from the one brand mark in src/app/icon.png (STEP 37).
// Run from the repository root, and again only if the logo changes:  node scripts/generate-mobile-assets.mjs
// The generated files are committed; nothing here runs during a build.
import sharp from "sharp";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "src/app/icon.png";
const BACKGROUND = "#fdf1f4"; // the website's light background
const ANDROID_RES = "mobile/android/app/src/main/res";
const IOS_ASSETS = "mobile/ios/App/App/Assets.xcassets";

const mark = (size) => sharp(SOURCE).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const on = async (width, height, markSize, { round = false } = {}) => {
  let img = sharp({ create: { width, height, channels: 4, background: BACKGROUND } }).composite([{ input: await mark(markSize), gravity: "centre" }]);
  if (round) {
    const mask = Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="#fff"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  return img.png({ compressionLevel: 9 }).toBuffer();
};

// Android launcher icons (legacy square + round) and the adaptive-icon foreground (the mark stays inside the central 66% safe zone).
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const foreground = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [d, size] of Object.entries(legacy)) {
  writeFileSync(join(ANDROID_RES, `mipmap-${d}`, "ic_launcher.png"), await on(size, size, Math.round(size * 0.7)));
  writeFileSync(join(ANDROID_RES, `mipmap-${d}`, "ic_launcher_round.png"), await on(size, size, Math.round(size * 0.62), { round: true }));
  const f = foreground[d];
  const fg = await sharp({ create: { width: f, height: f, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await mark(Math.round(f * 0.56)), gravity: "centre" }]).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(ANDROID_RES, `mipmap-${d}`, "ic_launcher_foreground.png"), fg);
}
writeFileSync(join(ANDROID_RES, "values", "ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`);

// Android splash images keep the size of the file the template shipped for each folder.
for (const dir of readdirSync(ANDROID_RES)) {
  const p = join(ANDROID_RES, dir, "splash.png");
  try {
    if (!statSync(p).isFile()) continue;
  } catch {
    continue;
  }
  const { width, height } = await sharp(p).metadata();
  writeFileSync(p, await on(width, height, Math.round(Math.min(width, height) * 0.32)));
}

// iOS: one 1024 icon (no transparency, as the App Store requires) and the three splash scales.
writeFileSync(join(IOS_ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"), await sharp(await on(1024, 1024, 700)).flatten({ background: BACKGROUND }).png().toBuffer());
for (const f of readdirSync(join(IOS_ASSETS, "Splash.imageset")).filter((n) => n.endsWith(".png"))) writeFileSync(join(IOS_ASSETS, "Splash.imageset", f), await on(2732, 2732, 760));
console.log("Mobile icons and splash images written.");
