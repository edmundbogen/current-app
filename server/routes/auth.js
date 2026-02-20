const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateToken, verifyToken } = require('../middleware/auth');

// POST /subscriber/register
router.post('/subscriber/register', async (req, res) => {
  try {
    const { name, email, password, phone, company, invite_code } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if email exists
    const existing = await query('SELECT subscriber_id FROM subscribers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    let mastermind_member = false;
    let invite_code_used = null;

    // Validate invite code if provided
    if (invite_code) {
      const codeResult = await query(
        `SELECT * FROM invite_codes
         WHERE code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_uses IS NULL OR current_uses < max_uses)`,
        [invite_code.toUpperCase()]
      );

      if (codeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired invite code' });
      }

      const code = codeResult.rows[0];
      await query('UPDATE invite_codes SET current_uses = current_uses + 1 WHERE code_id = $1', [code.code_id]);
      mastermind_member = true;
      invite_code_used = code.code;
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert subscriber
    const result = await query(
      `INSERT INTO subscribers (name, email, password_hash, phone, company, mastermind_member, invite_code_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING subscriber_id, name, email, subscription_tier, mastermind_member`,
      [name, email.toLowerCase(), password_hash, phone || null, company || null, mastermind_member, invite_code_used]
    );

    const subscriber = result.rows[0];

    // Generate token
    const token = generateToken({
      id: subscriber.subscriber_id,
      email: subscriber.email,
      name: subscriber.name,
      type: 'subscriber',
    });

    // Set cookie
    res.cookie('subscriber_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      token,
      subscriber: {
        id: subscriber.subscriber_id,
        name: subscriber.name,
        email: subscriber.email,
        subscription_tier: subscriber.subscription_tier,
        mastermind_member: subscriber.mastermind_member,
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /subscriber/login
router.post('/subscriber/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query(
      'SELECT subscriber_id, name, email, password_hash, subscription_tier, mastermind_member, status FROM subscribers WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const subscriber = result.rows[0];

    if (subscriber.status === 'suspended') {
      return res.status(403).json({ error: 'Account has been suspended' });
    }

    const validPassword = await bcrypt.compare(password, subscriber.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last_login
    await query('UPDATE subscribers SET last_login = NOW() WHERE subscriber_id = $1', [subscriber.subscriber_id]);

    const token = generateToken({
      id: subscriber.subscriber_id,
      email: subscriber.email,
      name: subscriber.name,
      type: 'subscriber',
    });

    res.cookie('subscriber_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token,
      subscriber: {
        id: subscriber.subscriber_id,
        name: subscriber.name,
        email: subscriber.email,
        subscription_tier: subscriber.subscription_tier,
        mastermind_member: subscriber.mastermind_member,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /admin/login
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query(
      'SELECT admin_id, name, email, password_hash FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = result.rows[0];

    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await query('UPDATE admin_users SET last_login = NOW() WHERE admin_id = $1', [admin.admin_id]);

    const token = generateToken({
      id: admin.admin_id,
      email: admin.email,
      name: admin.name,
      type: 'admin',
    });

    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token,
      admin: {
        id: admin.admin_id,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /subscriber/me
router.get('/subscriber/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : req.cookies?.subscriber_token;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.type !== 'subscriber') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await query(
      `SELECT subscriber_id, name, email, phone, company, tagline, bio, website,
              photo_url, logo_url, brand_color_primary, brand_color_secondary,
              vertical, subscription_tier, mastermind_member,
              stripe_customer_id, stripe_subscription_id, downloads_this_month,
              created_at, last_login, status
       FROM subscribers WHERE subscriber_id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    res.json({ subscriber: result.rows[0] });
  } catch (error) {
    console.error('Get subscriber error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// GET /admin/me
router.get('/admin/me', async (req, res) => {
  try {
    const token = req.cookies?.admin_token
      || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.substring(7)
        : null);

    if (!token) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.type !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    const result = await query(
      'SELECT admin_id, name, email, created_at FROM admin_users WHERE admin_id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    res.json({ admin: result.rows[0] });
  } catch (error) {
    console.error('Get admin error:', error);
    res.status(500).json({ error: 'Failed to get admin profile' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  res.clearCookie('subscriber_token');
  res.clearCookie('admin_token');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
