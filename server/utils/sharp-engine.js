const sharp = require('sharp');

function resolveColor(colorRef, branding) {
  if (colorRef === 'brand_primary') return branding.brand_color_primary || '#000000';
  if (colorRef === 'brand_secondary') return branding.brand_color_secondary || '#666666';
  return colorRef;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const arrayBuf = await response.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function createCircularImage(imageBuffer, width, height) {
  const size = Math.min(width, height);
  const resized = await sharp(imageBuffer)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();

  const circleMask = Buffer.from(
    `<svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
    </svg>`
  );

  return sharp(resized)
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function generatePersonalizedImage(options) {
  const {
    templateUrl,
    layoutConfig,
    subscriberBranding,
    outputFormat = 'png',
  } = options;

  const templateBuffer = await fetchImageBuffer(templateUrl);
  const composites = [];
  const zones = layoutConfig.zones || {};
  const templateWidth = layoutConfig.width || 1080;
  const templateHeight = layoutConfig.height || 1080;

  // Photo zone
  if (zones.photo && subscriberBranding.photo_url) {
    try {
      const photoBuffer = await fetchImageBuffer(subscriberBranding.photo_url);
      const zone = zones.photo;
      let processed;

      if (zone.shape === 'circle') {
        processed = await createCircularImage(photoBuffer, zone.width, zone.height);
      } else {
        processed = await sharp(photoBuffer)
          .resize(zone.width, zone.height, { fit: 'cover' })
          .png()
          .toBuffer();
      }

      composites.push({ input: processed, left: zone.x, top: zone.y });
    } catch (err) {
      console.warn('Failed to process photo zone:', err.message);
    }
  }

  // Logo zone
  if (zones.logo && subscriberBranding.logo_url) {
    try {
      const logoBuffer = await fetchImageBuffer(subscriberBranding.logo_url);
      const zone = zones.logo;
      const processed = await sharp(logoBuffer)
        .resize(zone.width, zone.height, { fit: 'inside' })
        .png()
        .toBuffer();

      composites.push({ input: processed, left: zone.x, top: zone.y });
    } catch (err) {
      console.warn('Failed to process logo zone:', err.message);
    }
  }

  // Name text zone
  if (zones.name && subscriberBranding.name) {
    const zone = zones.name;
    const color = resolveColor(zone.color, subscriberBranding);
    const fontSize = zone.font_size || 28;
    const svg = Buffer.from(
      `<svg width="${templateWidth}" height="${templateHeight}">
        <text x="${zone.x}" y="${zone.y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="${color}" font-weight="bold">${escapeXml(subscriberBranding.name)}</text>
      </svg>`
    );
    composites.push({ input: svg, left: 0, top: 0 });
  }

  // Tagline text zone
  if (zones.tagline && subscriberBranding.tagline) {
    const zone = zones.tagline;
    const color = resolveColor(zone.color, subscriberBranding);
    const fontSize = zone.font_size || 18;
    const svg = Buffer.from(
      `<svg width="${templateWidth}" height="${templateHeight}">
        <text x="${zone.x}" y="${zone.y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="${color}">${escapeXml(subscriberBranding.tagline)}</text>
      </svg>`
    );
    composites.push({ input: svg, left: 0, top: 0 });
  }

  // Brand bar zone
  if (zones.brand_bar) {
    const zone = zones.brand_bar;
    const color = resolveColor(zone.color, subscriberBranding);
    const svg = Buffer.from(
      `<svg width="${zone.width}" height="${zone.height}">
        <rect width="100%" height="100%" fill="${color}"/>
      </svg>`
    );
    composites.push({ input: svg, left: zone.x, top: zone.y });
  }

  const result = await sharp(templateBuffer)
    .composite(composites)
    .png()
    .toBuffer();

  return result;
}

module.exports = { generatePersonalizedImage };
