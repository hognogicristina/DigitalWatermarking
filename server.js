const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

const app = express();
const upload = multer();

app.use(express.static(path.join(__dirname, 'client')));
app.use(express.urlencoded({extended: true}));

/**
 * Invisible Watermark Function
 * Applies a simple modular shift on each RGB value.
 */
async function applyInvisibleWatermark(imageBuffer, K, N) {
  const inputSharp = sharp(imageBuffer).ensureAlpha();
  const {data: rawData, info} = await inputSharp.raw().toBuffer({resolveWithObject: true});

  const {width, height, channels} = info;
  // Reference pixel index (choose the first pixel for demonstration).
  const refIndex = 0;
  const originalM = rawData[refIndex];

  // Shift each RGB value by K (mod N).
  for (let i = 0; i < rawData.length; i += 4) {
    rawData[i] = (rawData[i] + K) % N; // R
    rawData[i + 1] = (rawData[i + 1] + K) % N; // G
    rawData[i + 2] = (rawData[i + 2] + K) % N; // B
    rawData[i + 3] = 255; // A
  }

  const newW = rawData[refIndex]; // The new reference pixel value

  // Convert raw data back to PNG
  const watermarkedBuffer = await sharp(rawData, {
    raw: {width, height, channels}
  }).png().toBuffer();

  // Optionally draw a small red circle to indicate watermark location (for demonstration)
  const circleX = newW % width;
  const circleY = (newW + K) % height;
  const circleRadius = 5;
  const circleSvg = `
    <svg width="${width}" height="${height}">
      <circle 
        cx="${circleX}" 
        cy="${circleY}" 
        r="${circleRadius}" 
        stroke="red" 
        stroke-width="2" 
        fill="none" />
    </svg>
  `;
  const finalBuffer = await sharp(watermarkedBuffer)
    .composite([{input: Buffer.from(circleSvg), top: 0, left: 0}])
    .png()
    .toBuffer();

  return {
    mValue: originalM,
    wValue: newW,
    watermarkedImageBase64: finalBuffer.toString('base64')
  };
}

/**
 * Invisible Watermark Route
 */
app.post('/watermark', upload.single('image'), async (req, res) => {
  try {
    const imageBuffer = req.file.buffer;
    const K = parseInt(req.body.key, 10) || 0;
    const N = parseInt(req.body.modulus, 10) || 256;

    const result = await applyInvisibleWatermark(imageBuffer, K, N);
    res.json({
      mValue: result.mValue,
      wValue: result.wValue,
      imageBase64: result.watermarkedImageBase64
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({error: 'Failed to apply invisible watermark.'});
  }
});

/**
 * Helper to escape XML for SVG-based text
 */
function escapeXml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Helper: apply visible watermark (image or text-as-SVG).
 */
async function applyVisibleWatermark(mainBuffer, watermarkBuffer, options = {}) {
  const {left = 0, top = 0, opacity = 0.3, width = 0, height = 0} = options;

  // Load the main image
  const main = sharp(mainBuffer).ensureAlpha();
  const mainMeta = await main.metadata();

  // Load the watermark
  let wm = sharp(watermarkBuffer).ensureAlpha();
  let wmMeta = await wm.metadata();

  // Resize the watermark if width/height provided
  let finalWmBuffer = watermarkBuffer;
  if (width > 0 || height > 0) {
    wm = wm.resize({
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
      fit: 'inside'
    });
    finalWmBuffer = await wm.png().toBuffer();
    wmMeta = await sharp(finalWmBuffer).metadata();
  }

  // Check if watermark goes out of main image boundary
  const willExceedWidth = left + wmMeta.width > mainMeta.width;
  const willExceedHeight = top + wmMeta.height > mainMeta.height;

  if (willExceedWidth || willExceedHeight) {
    const maxWidth = Math.max(1, mainMeta.width - left);
    const maxHeight = Math.max(1, mainMeta.height - top);
    finalWmBuffer = await sharp(finalWmBuffer)
      .resize({
        width: Math.min(wmMeta.width, maxWidth),
        height: Math.min(wmMeta.height, maxHeight),
        fit: 'inside'
      })
      .png()
      .toBuffer();
  }

  // Composite watermark onto the main
  return await main
    .composite([
      {
        input: finalWmBuffer,
        left,
        top,
        blend: 'over',
        opacity
      }
    ])
    .png()
    .toBuffer();
}

/**
 * Helper: create a text-based watermark as an SVG
 */
function createTextWatermarkSvg(text, w, h, color = '#000', fontSize = 24, fontFamily = 'Arial') {
  const escapedText = escapeXml(text);
  return Buffer.from(`
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="none" />
      <text 
        x="50%" 
        y="50%" 
        fill="${color}"
        font-size="${fontSize}"
        font-family="${fontFamily}"
        dominant-baseline="middle"
        text-anchor="middle">
        ${escapedText}
      </text>
    </svg>
  `);
}

/**
 * Visible Watermark (Encode) Route
 */
app.post('/encode-visible', upload.fields([
  {name: 'image', maxCount: 1},
  {name: 'watermark', maxCount: 1}
]), async (req, res) => {
  try {
    const text = req.body.text || '';

    const mainUpload = req.files['image'] && req.files['image'][0];
    const wmUpload = req.files['watermark'] && req.files['watermark'][0];
    if (!mainUpload) {
      return res.status(400).json({error: 'Please provide a main image.'});
    }

    const left = parseInt(req.body.left, 10) || 0;
    const top = parseInt(req.body.top, 10) || 0;
    const opacity = parseFloat(req.body.opacity) || 0.3;
    const wWidth = parseInt(req.body.wmWidth, 10) || 0;
    const wHeight = parseInt(req.body.wmHeight, 10) || 0;

    let watermarkBuffer;
    // If text is provided, generate an SVG watermark
    if (text) {
      const boxW = wWidth > 0 ? wWidth : 300;
      const boxH = wHeight > 0 ? wHeight : 100;
      watermarkBuffer = createTextWatermarkSvg(text, boxW, boxH, '#000', 24, 'Arial');
    } else if (wmUpload) {
      // Otherwise, use an uploaded image as the watermark
      watermarkBuffer = wmUpload.buffer;
    } else {
      return res.status(400).json({error: 'Provide either a watermark image or text.'});
    }

    const watermarkedBuffer = await applyVisibleWatermark(
      mainUpload.buffer,
      watermarkBuffer,
      {
        left,
        top,
        opacity,
        width: wWidth,
        height: wHeight
      }
    );

    const base64 = watermarkedBuffer.toString('base64');
    res.json({watermarked: base64});

  } catch (err) {
    console.error(err);
    res.status(500).json({error: 'Failed to apply visible watermark.'});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});