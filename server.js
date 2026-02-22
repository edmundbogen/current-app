const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./server/routes/auth');
const contentRoutes = require('./server/routes/content');
const templateRoutes = require('./server/routes/templates');
const personalizeRoutes = require('./server/routes/personalize');
const subscriptionRoutes = require('./server/routes/subscription');
const userRoutes = require('./server/routes/user');
const exportRoutes = require('./server/routes/export');
const scheduleRoutes = require('./server/routes/schedule');
const vaRoutes = require('./server/routes/va-service');
const adminRoutes = require('./server/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || process.env.JWT_SECRET;

// Stripe webhook needs raw body - must be before json parser
app.use('/api/subscription/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/personalize', personalizeRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/user', userRoutes);
app.use('/api/subscribers', userRoutes); // Alias for frontend compatibility
app.use('/api/export', exportRoutes);
app.use('/api/assets', exportRoutes); // Alias for frontend compatibility
app.use('/api/schedule', scheduleRoutes);
app.use('/api/va', vaRoutes);
app.use('/api/admin', adminRoutes);

// HTML page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});

app.get('/create-account', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'create-account.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});

app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`CURRENT CONTENT PLATFORM server running on port ${PORT}`);
});

module.exports = app;
