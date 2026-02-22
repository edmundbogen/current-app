const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateSubscriber } = require('../middleware/auth');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY, {
    timeout: 30000,
    maxNetworkRetries: 2,
  });
}

// GET /stripe-test (temporary diagnostic - remove after debugging)
router.get('/stripe-test', async (req, res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return res.json({ error: 'STRIPE_SECRET_KEY is not set', envKeys: Object.keys(process.env).filter(k => k.includes('STRIPE')) });
    }
    const s = require('stripe')(key);
    const balance = await s.balance.retrieve();
    res.json({ ok: true, keyPrefix: key.substring(0, 12) + '...', balance: balance.available });
  } catch (error) {
    res.json({ ok: false, error: error.message, type: error.type, code: error.code });
  }
});

// POST /create-checkout-session (no auth - for payment-first flow)
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { plan } = req.body;

    const validPlans = ['pro', 'mastermind', 'enterprise', 'coaching', 'coaching 2x'];
    if (!plan || !validPlans.includes(plan.toLowerCase())) {
      return res.status(400).json({ error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` });
    }

    // Get price from subscription_plans table (use original casing like existing endpoint)
    let planResult;
    try {
      planResult = await query(
        'SELECT stripe_price_id FROM subscription_plans WHERE name = $1 AND is_active = true',
        [plan]
      );
    } catch (dbErr) {
      console.error('DB query failed:', dbErr.message);
      return res.status(500).json({ error: 'Database error: ' + dbErr.message });
    }

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: `Plan "${plan}" not found in database` });
    }

    const { stripe_price_id } = planResult.rows[0];

    if (!stripe_price_id) {
      return res.status(400).json({ error: 'No Stripe price ID configured for this plan' });
    }

    // Use VERCEL_URL in production if APP_URL is localhost
    const baseUrl = (APP_URL.includes('localhost') && process.env.VERCEL_URL)
      ? `https://${process.env.VERCEL_URL}`
      : APP_URL;

    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: stripe_price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/create-account?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      metadata: { plan: plan },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout session error:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to create checkout session' });
  }
});

// GET /checkout-session/:sessionId (no auth - retrieve session for account creation)
router.get('/checkout-session/:sessionId', async (req, res) => {
  try {
    const session = await getStripe().checkout.sessions.retrieve(req.params.sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Get subscription to determine tier
    const subscription = await getStripe().subscriptions.retrieve(session.subscription);
    const priceId = subscription.items.data[0].price.id;

    const planResult = await query(
      'SELECT name FROM subscription_plans WHERE stripe_price_id = $1',
      [priceId]
    );

    const tier = planResult.rows.length > 0 ? planResult.rows[0].name : 'pro';

    res.json({
      email: session.customer_details?.email || '',
      name: session.customer_details?.name || '',
      plan: tier,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
    });
  } catch (error) {
    console.error('Get checkout session error:', error);
    res.status(500).json({ error: 'Failed to retrieve checkout session' });
  }
});

// POST /create-checkout (existing - requires auth, for upgrades)
router.post('/create-checkout', authenticateSubscriber, async (req, res) => {
  try {
    const { plan } = req.body;

    const validPlans = ['pro', 'mastermind', 'enterprise', 'coaching', 'coaching 2x'];
    if (!plan || !validPlans.includes(plan.toLowerCase())) {
      return res.status(400).json({ error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` });
    }

    // Get price from subscription_plans table
    const planResult = await query(
      'SELECT stripe_price_id FROM subscription_plans WHERE name = $1 AND is_active = true',
      [plan]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const { stripe_price_id } = planResult.rows[0];

    // Get subscriber details
    const subResult = await query(
      'SELECT email, stripe_customer_id FROM subscribers WHERE subscriber_id = $1',
      [req.subscriber.id]
    );

    const subscriber = subResult.rows[0];

    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{ price: stripe_price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${APP_URL}/app?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/pricing`,
      metadata: { subscriber_id: String(req.subscriber.id) },
      client_reference_id: String(req.subscriber.id),
    };

    if (subscriber.stripe_customer_id) {
      sessionConfig.customer = subscriber.stripe_customer_id;
    } else {
      sessionConfig.customer_email = subscriber.email;
    }

    const session = await getStripe().checkout.sessions.create(sessionConfig);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /webhook
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscriberId = session.client_reference_id || session.metadata?.subscriber_id;

        if (subscriberId) {
          // Get subscription details to determine tier
          const subscription = await getStripe().subscriptions.retrieve(session.subscription);
          const priceId = subscription.items.data[0].price.id;

          // Look up which tier this price corresponds to
          const planResult = await query(
            'SELECT name FROM subscription_plans WHERE stripe_price_id = $1',
            [priceId]
          );

          const tier = planResult.rows.length > 0 ? planResult.rows[0].name : 'pro';

          await query(
            `UPDATE subscribers
             SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_tier = $3
             WHERE subscriber_id = $4`,
            [session.customer, session.subscription, tier, subscriberId]
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const priceId = subscription.items.data[0].price.id;

        const planResult = await query(
          'SELECT name FROM subscription_plans WHERE stripe_price_id = $1',
          [priceId]
        );

        const tier = planResult.rows.length > 0 ? planResult.rows[0].name : 'pro';

        await query(
          `UPDATE subscribers SET subscription_tier = $1 WHERE stripe_subscription_id = $2`,
          [tier, subscription.id]
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await query(
          `UPDATE subscribers SET subscription_tier = 'free' WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /plans
router.get('/plans', async (req, res) => {
  try {
    const result = await query(
      'SELECT plan_id, name, price_cents, downloads_per_month, ai_rewrite, custom_templates, description, is_active FROM subscription_plans WHERE is_active = true ORDER BY price_cents ASC'
    );
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

// GET /status
router.get('/status', authenticateSubscriber, async (req, res) => {
  try {
    const result = await query(
      `SELECT subscription_tier, stripe_subscription_id, downloads_this_month
       FROM subscribers WHERE subscriber_id = $1`,
      [req.subscriber.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    const subscriber = result.rows[0];

    // Get downloads limit for current tier
    const planResult = await query(
      'SELECT downloads_per_month FROM subscription_plans WHERE name = $1',
      [subscriber.subscription_tier]
    );

    const downloads_per_month = planResult.rows.length > 0 ? planResult.rows[0].downloads_per_month : 5;

    res.json({
      subscription_tier: subscriber.subscription_tier,
      stripe_subscription_id: subscriber.stripe_subscription_id,
      downloads_this_month: subscriber.downloads_this_month || 0,
      downloads_per_month,
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// POST /portal
router.post('/portal', authenticateSubscriber, async (req, res) => {
  try {
    const result = await query(
      'SELECT stripe_customer_id FROM subscribers WHERE subscriber_id = $1',
      [req.subscriber.id]
    );

    const subscriber = result.rows[0];

    if (!subscriber.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: subscriber.stripe_customer_id,
      return_url: `${APP_URL}/app`,
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    console.error('Create portal error:', error);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

module.exports = router;
