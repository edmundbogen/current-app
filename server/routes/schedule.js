const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');

// GET / - List scheduled posts
router.get('/', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { status, platform, from_date, to_date } = req.query;

    let sql = `
      SELECT sp.*, ga.file_url
      FROM scheduled_posts sp
      LEFT JOIN generated_assets ga ON sp.generated_asset_id = ga.asset_id
      WHERE sp.subscriber_id = $1
    `;
    const params = [subscriberId];
    let paramIndex = 2;

    if (status) {
      sql += ` AND sp.status = $${paramIndex++}`;
      params.push(status);
    }
    if (platform) {
      sql += ` AND sp.platform = $${paramIndex++}`;
      params.push(platform);
    }
    if (from_date) {
      sql += ` AND sp.scheduled_at >= $${paramIndex++}`;
      params.push(from_date);
    }
    if (to_date) {
      sql += ` AND sp.scheduled_at <= $${paramIndex++}`;
      params.push(to_date);
    }

    sql += ' ORDER BY sp.scheduled_at ASC';

    const result = await query(sql, params);
    res.json({ posts: result.rows });
  } catch (err) {
    console.error('List scheduled posts error:', err);
    res.status(500).json({ error: 'Failed to fetch scheduled posts' });
  }
});

// POST / - Create scheduled post
router.post('/', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { generated_asset_id, platform, caption, scheduled_at } = req.body;

    if (!generated_asset_id || !platform || !scheduled_at) {
      return res.status(400).json({ error: 'generated_asset_id, platform, and scheduled_at are required' });
    }

    // Verify asset belongs to subscriber
    const assetResult = await query(
      `SELECT asset_id FROM generated_assets WHERE asset_id = $1 AND subscriber_id = $2`,
      [generated_asset_id, subscriberId]
    );
    if (assetResult.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Validate scheduled_at is in the future
    if (new Date(scheduled_at) <= new Date()) {
      return res.status(400).json({ error: 'scheduled_at must be in the future' });
    }

    const result = await query(
      `INSERT INTO scheduled_posts (subscriber_id, generated_asset_id, platform, caption, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled') RETURNING post_id`,
      [subscriberId, generated_asset_id, platform, caption || '', scheduled_at]
    );

    res.status(201).json({ post_id: result.rows[0].post_id });
  } catch (err) {
    console.error('Create scheduled post error:', err);
    res.status(500).json({ error: 'Failed to create scheduled post' });
  }
});

// PUT /:id - Update scheduled post
router.put('/:id', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { id } = req.params;
    const { caption, scheduled_at, platform } = req.body;

    // Verify post belongs to subscriber and is editable
    const postResult = await query(
      `SELECT * FROM scheduled_posts WHERE post_id = $1 AND subscriber_id = $2`,
      [id, subscriberId]
    );
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }
    const post = postResult.rows[0];

    if (post.status !== 'draft' && post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Can only edit draft or scheduled posts' });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (caption !== undefined) {
      updates.push(`caption = $${paramIndex++}`);
      params.push(caption);
    }
    if (scheduled_at !== undefined) {
      if (new Date(scheduled_at) <= new Date()) {
        return res.status(400).json({ error: 'scheduled_at must be in the future' });
      }
      updates.push(`scheduled_at = $${paramIndex++}`);
      params.push(scheduled_at);
    }
    if (platform !== undefined) {
      updates.push(`platform = $${paramIndex++}`);
      params.push(platform);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id, subscriberId);

    await query(
      `UPDATE scheduled_posts SET ${updates.join(', ')} WHERE post_id = $${paramIndex} AND subscriber_id = $${paramIndex + 1}`,
      params
    );

    res.json({ message: 'Scheduled post updated' });
  } catch (err) {
    console.error('Update scheduled post error:', err);
    res.status(500).json({ error: 'Failed to update scheduled post' });
  }
});

// DELETE /:id - Delete scheduled post
router.delete('/:id', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { id } = req.params;

    const postResult = await query(
      `SELECT * FROM scheduled_posts WHERE post_id = $1 AND subscriber_id = $2`,
      [id, subscriberId]
    );
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    if (postResult.rows[0].status !== 'draft' && postResult.rows[0].status !== 'scheduled') {
      return res.status(400).json({ error: 'Can only delete draft or scheduled posts' });
    }

    await query(
      `DELETE FROM scheduled_posts WHERE post_id = $1 AND subscriber_id = $2`,
      [id, subscriberId]
    );

    res.json({ message: 'Scheduled post deleted' });
  } catch (err) {
    console.error('Delete scheduled post error:', err);
    res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
});

module.exports = router;
