const express = require('express');
const router = express.Router();
const { pool, query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const { uploadFile } = require('../utils/storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG and PNG images are allowed'), false);
    }
  }
});

// GET /profile - Get subscriber profile
router.get('/profile', authenticateSubscriber, async (req, res) => {
  try {
    const result = await query(
      `SELECT subscriber_id, email, name, phone, company, tagline, bio,
              website, photo_url, logo_url, brand_color_primary, brand_color_secondary,
              vertical, subscription_tier, mastermind_member, stripe_customer_id,
              downloads_this_month, downloads_reset_at, status, created_at, updated_at
       FROM subscribers
       WHERE subscriber_id = $1`,
      [req.subscriber.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get plan details
    const planResult = await query(
      `SELECT * FROM subscription_plans WHERE LOWER(name) = $1 AND is_active = true LIMIT 1`,
      [result.rows[0].subscription_tier]
    );

    const profile = result.rows[0];
    if (planResult.rows.length > 0) {
      profile.plan = planResult.rows[0];
    }

    res.json({ profile });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /profile - Update subscriber profile
router.put('/profile',
  authenticateSubscriber,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('phone').optional().trim(),
    body('company').optional().trim(),
    body('tagline').optional().trim(),
    body('bio').optional().trim(),
    body('website').optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, phone, company, tagline, bio, website } = req.body;

      const result = await query(
        `UPDATE subscribers SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          company = COALESCE($3, company),
          tagline = COALESCE($4, tagline),
          bio = COALESCE($5, bio),
          website = COALESCE($6, website),
          updated_at = NOW()
         WHERE subscriber_id = $7
         RETURNING subscriber_id`,
        [name || null, phone || null, company || null, tagline || null,
         bio || null, website || null, req.subscriber.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      res.json({ message: 'Profile updated' });
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// PUT /branding - Update branding fields
router.put('/branding',
  authenticateSubscriber,
  [
    body('brand_color_primary').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Primary color must be a valid hex color'),
    body('brand_color_secondary').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Secondary color must be a valid hex color'),
    body('tagline').optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { brand_color_primary, brand_color_secondary, tagline } = req.body;

      const result = await query(
        `UPDATE subscribers SET
          brand_color_primary = COALESCE($1, brand_color_primary),
          brand_color_secondary = COALESCE($2, brand_color_secondary),
          tagline = COALESCE($3, tagline),
          updated_at = NOW()
         WHERE subscriber_id = $4
         RETURNING subscriber_id`,
        [brand_color_primary || null, brand_color_secondary || null,
         tagline || null, req.subscriber.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      res.json({ message: 'Branding updated' });
    } catch (error) {
      console.error('Error updating branding:', error);
      res.status(500).json({ error: 'Failed to update branding' });
    }
  }
);

// POST /upload-photo - Upload profile photo
router.post('/upload-photo', authenticateSubscriber, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size must be under 5MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const sharp = require('sharp');
    const metadata = await sharp(req.file.buffer).metadata();

    if (metadata.width < 400 || metadata.height < 400) {
      return res.status(400).json({ error: 'Image must be at least 400x400 pixels' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filePath = `${req.subscriber.id}/photo${ext}`;

    const publicUrl = await uploadFile(
      'subscriber-photos',
      filePath,
      req.file.buffer,
      req.file.mimetype
    );

    await query(
      `UPDATE subscribers SET photo_url = $1, updated_at = NOW() WHERE subscriber_id = $2`,
      [publicUrl, req.subscriber.id]
    );

    res.json({ photo_url: publicUrl });
  } catch (error) {
    console.error('Error uploading photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// POST /upload-logo - Upload brand logo
router.post('/upload-logo', authenticateSubscriber, (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size must be under 5MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const filePath = `${req.subscriber.id}/logo${ext}`;

    const publicUrl = await uploadFile(
      'subscriber-logos',
      filePath,
      req.file.buffer,
      req.file.mimetype
    );

    await query(
      `UPDATE subscribers SET logo_url = $1, updated_at = NOW() WHERE subscriber_id = $2`,
      [publicUrl, req.subscriber.id]
    );

    res.json({ logo_url: publicUrl });
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

module.exports = router;
