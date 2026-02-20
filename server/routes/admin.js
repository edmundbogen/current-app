const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateAdmin } = require('../middleware/auth');

// All routes require admin authentication
router.use(authenticateAdmin);

// GET /subscribers - List all subscribers with filtering
router.get('/subscribers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const tier = req.query.tier;
    const search = req.query.search;

    let whereClause = '';
    const params = [];

    if (tier) {
      params.push(tier);
      whereClause += ` WHERE subscription_tier = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += (whereClause ? ' AND' : ' WHERE') +
        ` (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM subscribers${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await query(
      `SELECT subscriber_id, name, email, company, subscription_tier, mastermind_member,
              downloads_this_month, status, created_at, last_login
       FROM subscribers${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      subscribers: result.rows,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

// GET /subscribers/:id - Get single subscriber detail
router.get('/subscribers/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT subscriber_id, name, email, phone, company, tagline, bio, website,
              photo_url, logo_url, brand_color_primary, brand_color_secondary,
              vertical, subscription_tier, mastermind_member, stripe_customer_id,
              downloads_this_month, status, created_at, updated_at, last_login
       FROM subscribers WHERE subscriber_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    res.json({ subscriber: result.rows[0] });
  } catch (error) {
    console.error('Error fetching subscriber:', error);
    res.status(500).json({ error: 'Failed to fetch subscriber' });
  }
});

// GET /stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const [totalSubs, proSubs, contentCount, downloadsCount] = await Promise.all([
      query('SELECT COUNT(*) FROM subscribers'),
      query("SELECT COUNT(*) FROM subscribers WHERE subscription_tier = 'pro'"),
      query("SELECT COUNT(*) FROM content_items WHERE status = 'published'"),
      query(`SELECT COALESCE(SUM(downloads_this_month), 0) as total FROM subscribers`)
    ]);

    res.json({
      total_subscribers: parseInt(totalSubs.rows[0].count),
      pro_subscribers: parseInt(proSubs.rows[0].count),
      published_content: parseInt(contentCount.rows[0].count),
      downloads_this_month: parseInt(downloadsCount.rows[0].total)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
