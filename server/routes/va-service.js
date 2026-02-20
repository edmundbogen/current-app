const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');

const VALID_REQUEST_TYPES = ['setup_help', 'content_customization', 'posting_management'];

// POST /inquiry - Submit a VA service inquiry
router.post('/inquiry', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;
    const { request_type, message, package_type } = req.body;

    if (!request_type || !message) {
      return res.status(400).json({ error: 'request_type and message are required' });
    }

    if (!VALID_REQUEST_TYPES.includes(request_type)) {
      return res.status(400).json({
        error: `request_type must be one of: ${VALID_REQUEST_TYPES.join(', ')}`,
      });
    }

    const result = await query(
      `INSERT INTO va_requests (subscriber_id, request_type, message, package_type, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [subscriberId, request_type, message, package_type || null]
    );

    // TODO: Send email notification to Edmund's team

    res.status(201).json({
      request_id: result.rows[0].id,
      message: 'VA inquiry submitted',
    });
  } catch (err) {
    console.error('VA inquiry error:', err);
    res.status(500).json({ error: 'Failed to submit VA inquiry' });
  }
});

// GET /requests - List subscriber's VA requests
router.get('/requests', authenticateSubscriber, async (req, res) => {
  try {
    const subscriberId = req.subscriber.id;

    const result = await query(
      `SELECT * FROM va_requests WHERE subscriber_id = $1 ORDER BY created_at DESC`,
      [subscriberId]
    );

    res.json({ requests: result.rows });
  } catch (err) {
    console.error('List VA requests error:', err);
    res.status(500).json({ error: 'Failed to fetch VA requests' });
  }
});

module.exports = router;
