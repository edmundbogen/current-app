const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');

// GET / - List subscriber's generated assets
router.get('/', authenticateSubscriber, async (req, res) => {
  try {
    const result = await query(
      `SELECT ga.asset_id, ga.content_id, ga.template_id, ga.file_url,
              ga.download_count, ga.created_at,
              ci.title as content_title, ci.content_type
       FROM generated_assets ga
       LEFT JOIN content_items ci ON ga.content_id = ci.content_id
       WHERE ga.subscriber_id = $1
       ORDER BY ga.created_at DESC`,
      [req.subscriber.id]
    );

    res.json({ assets: result.rows });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// GET /download/:asset_id - Download a generated asset
router.get('/download/:asset_id', authenticateSubscriber, async (req, res) => {
  try {
    const { asset_id } = req.params;

    const result = await query(
      `SELECT * FROM generated_assets WHERE asset_id = $1 AND subscriber_id = $2`,
      [asset_id, req.subscriber.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    const asset = result.rows[0];

    const response = await fetch(asset.file_url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch asset from storage' });
    }

    await query(
      `UPDATE generated_assets SET download_count = COALESCE(download_count, 0) + 1 WHERE asset_id = $1`,
      [asset_id]
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `personalized_${asset_id}_${Date.now()}.png`;

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download asset' });
  }
});

// DELETE /:asset_id - Delete a generated asset
router.delete('/:asset_id', authenticateSubscriber, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM generated_assets WHERE asset_id = $1 AND subscriber_id = $2 RETURNING asset_id`,
      [req.params.asset_id, req.subscriber.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({ message: 'Asset deleted' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

module.exports = router;
