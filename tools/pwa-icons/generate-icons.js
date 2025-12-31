const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const INPUT = path.resolve(__dirname, "../../assets/images/logo-brisa-heart.png");
const OUTPUT_DIR = path.resolve(__dirname, "../../assets/icons");
const SIZES = [72, 96, 128, 192, 256, 384, 512];
const MASKABLE_SIZE = 512;
const MASKABLE_SCALE = 0.8;
const MASKABLE_BG = { r: 122, g: 184, b: 0, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function generateStandardIcons() {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all(
    SIZES.map((size) => {
      const outPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
      return sharp(INPUT)
        .resize(size, size, {
          fit: "contain",
          background: TRANSPARENT
        })
        .png()
        .toFile(outPath);
    })
  );
}

async function generateMaskableIcon() {
  const innerSize = Math.round(MASKABLE_SIZE * MASKABLE_SCALE);
  const logo = await sharp(INPUT)
    .resize(innerSize, innerSize, {
      fit: "contain",
      background: TRANSPARENT
    })
    .png()
    .toBuffer();

  const outPath = path.join(OUTPUT_DIR, `icon-${MASKABLE_SIZE}-maskable.png`);
  await sharp({
    create: {
      width: MASKABLE_SIZE,
      height: MASKABLE_SIZE,
      channels: 4,
      background: MASKABLE_BG
    }
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(outPath);
}

async function main() {
  try {
    await generateStandardIcons();
    await generateMaskableIcon();
    console.log("PWA icons generated in assets/icons");
  } catch (err) {
    console.error("Error generating icons:", err);
    process.exit(1);
  }
}

main();
