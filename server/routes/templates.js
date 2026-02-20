const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateAdmin, authenticateSubscriber } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

// GET / - List all templates (admin)
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { platform, status } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (platform) {
      conditions.push(`platform = $${paramIndex++}`);
      params.push(platform);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM graphic_templates ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT * FROM graphic_templates ${whereClause}
       ORDER BY created_at DESC
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
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /:id - Get single template
router.get('/:id',
  [param('id').isInt().withMessage('Valid template ID required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const result = await query(
        `SELECT * FROM graphic_templates WHERE template_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({ template: result.rows[0] });
    } catch (error) {
      console.error('Error fetching template:', error);
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  }
);

// POST / - Create template
router.post('/',
  authenticateAdmin,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('template_file_url').trim().notEmpty().withMessage('Template file URL is required'),
    body('layout_config').custom((value) => {
      if (typeof value === 'string') {
        try { JSON.parse(value); } catch { throw new Error('layout_config must be valid JSON'); }
      } else if (typeof value !== 'object' || value === null) {
        throw new Error('layout_config must be valid JSON');
      }
      return true;
    }),
    body('platform').trim().notEmpty().withMessage('Platform is required'),
    body('width').isInt({ min: 1 }).withMessage('Width must be a positive integer'),
    body('height').isInt({ min: 1 }).withMessage('Height must be a positive integer')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, template_file_url, layout_config, platform, width, height, tier_required, status } = req.body;

      const layoutJson = typeof layout_config === 'string' ? layout_config : JSON.stringify(layout_config);

      const result = await query(
        `INSERT INTO graphic_templates (name, template_file_url, layout_config, platform, width, height, tier_required, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING template_id`,
        [name, template_file_url, layoutJson, platform, width, height, tier_required || 'free', status || 'active']
      );

      res.status(201).json({ template_id: result.rows[0].template_id });
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(500).json({ error: 'Failed to create template' });
    }
  }
);

// PUT /:id - Update template
router.put('/:id',
  authenticateAdmin,
  [param('id').isInt().withMessage('Valid template ID required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { name, template_file_url, layout_config, platform, width, height, tier_required, status } = req.body;

      let layoutJson = null;
      if (layout_config !== undefined) {
        layoutJson = typeof layout_config === 'string' ? layout_config : JSON.stringify(layout_config);
      }

      const result = await query(
        `UPDATE graphic_templates SET
          name = COALESCE($1, name),
          template_file_url = COALESCE($2, template_file_url),
          layout_config = COALESCE($3, layout_config),
          platform = COALESCE($4, platform),
          width = COALESCE($5, width),
          height = COALESCE($6, height),
          tier_required = COALESCE($7, tier_required),
          status = COALESCE($8, status),
          updated_at = NOW()
         WHERE template_id = $9
         RETURNING template_id`,
        [name || null, template_file_url || null, layoutJson, platform || null,
         width || null, height || null, tier_required || null, status || null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({ message: 'Template updated', template_id: result.rows[0].template_id });
    } catch (error) {
      console.error('Error updating template:', error);
      res.status(500).json({ error: 'Failed to update template' });
    }
  }
);

// DELETE /:id - Deactivate template
router.delete('/:id',
  authenticateAdmin,
  [param('id').isInt().withMessage('Valid template ID required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;

      const result = await query(
        `UPDATE graphic_templates SET status = 'inactive', updated_at = NOW() WHERE template_id = $1 RETURNING template_id`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json({ message: 'Template deactivated' });
    } catch (error) {
      console.error('Error deactivating template:', error);
      res.status(500).json({ error: 'Failed to deactivate template' });
    }
  }
);

module.exports = router;
