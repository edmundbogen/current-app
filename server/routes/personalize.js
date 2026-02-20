const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');
const { generatePersonalizedImage } = require('../utils/sharp-engine');
const { rewriteCaption } = require('../utils/claude');
const { uploadFile } = require('../utils/storage');

// POST /generate - Generate a personalized image
router.post('/generate', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { content_id, template_id: bodyTemplateId } = req.body;

    if (!content_id) {
      return res.status(400).json({ error: 'content_id is required' });
    }

    // Get subscriber info including branding and tier
    const subResult = await query(
      `SELECT subscriber_id, name, company, subscription_tier, downloads_this_month, downloads_reset_at,
              photo_url, logo_url, brand_color_primary, brand_color_secondary, tagline
       FROM subscribers WHERE subscriber_id = $1`,
      [subscriberId]
    );
    if (subResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }
    const subscriber = subResult.rows[0];

    // Check usage limits for free tier
    if (subscriber.subscription_tier === 'free') {
      const now = new Date();
      const resetAt = subscriber.downloads_reset_at ? new Date(subscriber.downloads_reset_at) : null;
      if (!resetAt || resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
        await query(
          `UPDATE subscribers SET downloads_this_month = 0, downloads_reset_at = NOW() WHERE subscriber_id = $1`,
          [subscriberId]
        );
        subscriber.downloads_this_month = 0;
      }
      if (subscriber.downloads_this_month >= 5) {
        return res.status(403).json({ error: 'Free tier monthly download limit reached (5). Upgrade to Pro for unlimited.' });
      }
    }

    // Get content item
    const contentResult = await query(
      `SELECT * FROM content_items WHERE content_id = $1`,
      [content_id]
    );
    if (contentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }
    const content = contentResult.rows[0];

    // Determine template
    const templateId = bodyTemplateId || content.template_id;
    if (!templateId) {
      return res.status(400).json({ error: 'No template associated with this content' });
    }

    const templateResult = await query(
      `SELECT * FROM graphic_templates WHERE template_id = $1`,
      [templateId]
    );
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const template = templateResult.rows[0];

    // Generate personalized image
    const imageBuffer = await generatePersonalizedImage({
      templateUrl: template.template_file_url,
      layoutConfig: template.layout_config,
      subscriberBranding: {
        photo_url: subscriber.photo_url,
        logo_url: subscriber.logo_url,
        brand_color_primary: subscriber.brand_color_primary,
        brand_color_secondary: subscriber.brand_color_secondary,
        name: subscriber.name,
        tagline: subscriber.tagline,
      },
      outputFormat: 'png',
    });

    // Upload to storage
    const timestamp = Date.now();
    const filePath = `${subscriberId}/${content_id}_${timestamp}.png`;
    const fileUrl = await uploadFile('generated-assets', filePath, imageBuffer, 'image/png');

    // Insert into generated_assets
    const assetResult = await query(
      `INSERT INTO generated_assets (subscriber_id, content_id, template_id, file_url, personalization_snapshot)
       VALUES ($1, $2, $3, $4, $5) RETURNING asset_id`,
      [
        subscriberId,
        content_id,
        templateId,
        fileUrl,
        JSON.stringify({
          photo_url: subscriber.photo_url,
          logo_url: subscriber.logo_url,
          brand_color_primary: subscriber.brand_color_primary,
          brand_color_secondary: subscriber.brand_color_secondary,
          name: subscriber.name,
          tagline: subscriber.tagline,
        }),
      ]
    );
    const assetId = assetResult.rows[0].asset_id;

    // Increment download count
    await query(
      `UPDATE subscribers SET downloads_this_month = downloads_this_month + 1 WHERE subscriber_id = $1`,
      [subscriberId]
    );

    // Log usage
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    await query(
      `INSERT INTO usage_logs (subscriber_id, action, period, metadata) VALUES ($1, $2, $3, $4)`,
      [subscriberId, 'personalize', period, JSON.stringify({ content_id, template_id: templateId, asset_id: assetId })]
    );

    res.json({
      asset_id: assetId,
      file_url: fileUrl,
      preview_url: fileUrl,
    });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: 'Failed to generate personalized image' });
  }
});

// POST /rewrite-caption - AI caption rewriting
router.post('/rewrite-caption', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { caption, platform } = req.body;

    if (!caption || !platform) {
      return res.status(400).json({ error: 'caption and platform are required' });
    }

    // Check tier
    const subResult = await query(
      `SELECT subscription_tier, name, company, tagline FROM subscribers WHERE subscriber_id = $1`,
      [subscriberId]
    );
    if (subResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }
    const subscriber = subResult.rows[0];

    if (subscriber.subscription_tier !== 'pro' && subscriber.subscription_tier !== 'enterprise') {
      return res.status(403).json({ error: 'Caption rewriting is available for Pro and Enterprise tiers' });
    }

    const rewritten = await rewriteCaption(caption, {
      name: subscriber.name,
      company: subscriber.company,
      tagline: subscriber.tagline,
    }, platform);

    res.json({ rewritten_caption: rewritten });
  } catch (err) {
    console.error('Caption rewrite error:', err);
    res.status(500).json({ error: 'Failed to rewrite caption' });
  }
});

module.exports = router;
