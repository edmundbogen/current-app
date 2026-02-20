const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateAdmin, optionalSubscriberAuth } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

// GET /categories/list - must be before /:slug to avoid conflict
router.get('/categories/list', async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT category FROM content_items WHERE status = 'published' AND category IS NOT NULL ORDER BY category`
    );
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET / - Browse content library
router.get('/', optionalSubscriberAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 12));
    const offset = (page - 1) * limit;
    const { category, vertical, content_type, search } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Non-admin users only see published content
    if (!req.admin) {
      conditions.push(`ci.status = 'published'`);
    }

    if (category) {
      conditions.push(`ci.category = $${paramIndex++}`);
      params.push(category);
    }
    if (vertical) {
      conditions.push(`ci.vertical = $${paramIndex++}`);
      params.push(vertical);
    }
    if (content_type) {
      conditions.push(`ci.content_type = $${paramIndex++}`);
      params.push(content_type);
    }
    if (search) {
      conditions.push(`(ci.title ILIKE $${paramIndex} OR ci.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM content_items ci ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT ci.*, gt.name AS template_name, gt.platform AS template_platform,
              gt.template_file_url, gt.width AS template_width, gt.height AS template_height
       FROM content_items ci
       LEFT JOIN graphic_templates gt ON ci.template_id = gt.template_id
       ${whereClause}
       ORDER BY ci.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    res.json({
      items: result.rows,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error browsing content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// GET /:identifier - Get single content item by slug or ID
router.get('/:identifier', optionalSubscriberAuth, async (req, res) => {
  try {
    const { identifier } = req.params;

    // Try by ID first if it's numeric, then by slug
    const isNumeric = /^\d+$/.test(identifier);
    const result = await query(
      `SELECT ci.*, gt.name AS template_name, gt.platform AS template_platform,
              gt.template_file_url, gt.layout_config, gt.width AS template_width,
              gt.height AS template_height
       FROM content_items ci
       LEFT JOIN graphic_templates gt ON ci.template_id = gt.template_id
       WHERE ${isNumeric ? 'ci.content_id = $1' : 'ci.slug = $1'}`,
      [isNumeric ? parseInt(identifier) : identifier]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const item = result.rows[0];

    // Non-admin users can only see published content
    if (item.status !== 'published' && !req.admin) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json({ item });
  } catch (error) {
    console.error('Error fetching content item:', error);
    res.status(500).json({ error: 'Failed to fetch content item' });
  }
});

// POST / - Create content item
router.post('/',
  authenticateAdmin,
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('content_type').trim().notEmpty().withMessage('Content type is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        title, content_type, description, body: contentBody, category, vertical,
        template_id, status, thumbnail_url, meta
      } = req.body;

      const slug = title
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const result = await query(
        `INSERT INTO content_items (title, slug, content_type, description, body, category, vertical, template_id, status, thumbnail_url, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING content_id, slug`,
        [title, slug, content_type, description || null, contentBody || null, category || null,
         vertical || null, template_id || null, status || 'draft', thumbnail_url || null, meta || null]
      );

      res.status(201).json({
        content_id: result.rows[0].content_id,
        slug: result.rows[0].slug
      });
    } catch (error) {
      console.error('Error creating content:', error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Content with this slug already exists' });
      }
      res.status(500).json({ error: 'Failed to create content' });
    }
  }
);

// PUT /:id - Update content item
router.put('/:id',
  authenticateAdmin,
  [param('id').isInt().withMessage('Valid content ID required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        title, content_type, description, body: contentBody, category, vertical,
        template_id, status, thumbnail_url, meta
      } = req.body;

      const result = await query(
        `UPDATE content_items SET
          title = COALESCE($1, title),
          content_type = COALESCE($2, content_type),
          description = COALESCE($3, description),
          body = COALESCE($4, body),
          category = COALESCE($5, category),
          vertical = COALESCE($6, vertical),
          template_id = COALESCE($7, template_id),
          status = COALESCE($8, status),
          thumbnail_url = COALESCE($9, thumbnail_url),
          meta = COALESCE($10, meta),
          updated_at = NOW()
         WHERE content_id = $11
         RETURNING content_id, slug`,
        [title || null, content_type || null, description || null, contentBody || null,
         category || null, vertical || null, template_id || null, status || null,
         thumbnail_url || null, meta || null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Content not found' });
      }

      res.json({ message: 'Content updated', content_id: result.rows[0].content_id });
    } catch (error) {
      console.error('Error updating content:', error);
      res.status(500).json({ error: 'Failed to update content' });
    }
  }
);

// DELETE /:id - Archive content item
router.delete('/:id',
  authenticateAdmin,
  [param('id').isInt().withMessage('Valid content ID required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;

      const result = await query(
        `UPDATE content_items SET status = 'archived', updated_at = NOW() WHERE content_id = $1 RETURNING content_id`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Content not found' });
      }

      res.json({ message: 'Content archived' });
    } catch (error) {
      console.error('Error archiving content:', error);
      res.status(500).json({ error: 'Failed to archive content' });
    }
  }
);

module.exports = router;
