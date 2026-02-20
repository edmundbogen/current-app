const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const authenticateSubscriber = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : req.cookies?.subscriber_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.type !== 'subscriber') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.subscriber = {
    id: decoded.id,
    email: decoded.email,
    name: decoded.name,
  };
  next();
};

const authenticateAdmin = (req, res, next) => {
  const token = req.cookies?.admin_token
    || (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : null);

  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.type !== 'admin') {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }

  req.admin = {
    id: decoded.id,
    email: decoded.email,
    name: decoded.name,
  };
  next();
};

const optionalSubscriberAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : req.cookies?.subscriber_token;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded && decoded.type === 'subscriber') {
      req.subscriber = {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
      };
    }
  }
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  authenticateSubscriber,
  authenticateAdmin,
  optionalSubscriberAuth,
};
