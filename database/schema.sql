-- Content Personalization Platform Schema
-- PostgreSQL

-- Admin users (platform admins like Edmund)
CREATE TABLE IF NOT EXISTS admin_users (
    admin_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscribers (users who personalize content)
CREATE TABLE IF NOT EXISTS subscribers (
    subscriber_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(255),
    photo_url TEXT,
    logo_url TEXT,
    brand_color_primary VARCHAR(7) DEFAULT '#1a1a2e',
    brand_color_secondary VARCHAR(7) DEFAULT '#e94560',
    tagline VARCHAR(255),
    bio TEXT,
    website VARCHAR(255),
    vertical VARCHAR(100) DEFAULT 'real_estate',
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    subscription_tier VARCHAR(50) DEFAULT 'free',
    mastermind_member BOOLEAN DEFAULT false,
    invite_code_used VARCHAR(50),
    downloads_this_month INTEGER DEFAULT 0,
    downloads_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'active',
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Graphic templates (design templates with personalization zones)
CREATE TABLE IF NOT EXISTS graphic_templates (
    template_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    template_file_url TEXT NOT NULL,
    layout_config JSONB NOT NULL,
    platform VARCHAR(50) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    tier_required VARCHAR(50) DEFAULT 'free',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Content items (content library Edmund publishes)
CREATE TABLE IF NOT EXISTS content_items (
    content_id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(500) UNIQUE NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    caption_facebook TEXT,
    caption_instagram TEXT,
    caption_twitter TEXT,
    caption_linkedin TEXT,
    article_body TEXT,
    template_id INTEGER REFERENCES graphic_templates(template_id),
    vertical VARCHAR(100) DEFAULT 'real_estate',
    category VARCHAR(100),
    tags TEXT[],
    status VARCHAR(50) DEFAULT 'draft',
    featured_image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Generated assets (personalized outputs per user)
CREATE TABLE IF NOT EXISTS generated_assets (
    asset_id SERIAL PRIMARY KEY,
    subscriber_id INTEGER REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content_items(content_id),
    template_id INTEGER REFERENCES graphic_templates(template_id),
    file_url TEXT NOT NULL,
    personalization_snapshot JSONB,
    downloaded BOOLEAN DEFAULT false,
    download_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscription plans (Stripe product mapping)
CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    stripe_price_id VARCHAR(255),
    price_cents INTEGER NOT NULL,
    interval VARCHAR(20) DEFAULT 'month',
    downloads_per_month INTEGER,
    ai_rewrite BOOLEAN DEFAULT false,
    custom_templates BOOLEAN DEFAULT false,
    description TEXT,
    is_active BOOLEAN DEFAULT true
);

-- Scheduled posts (social media scheduling CMS)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    post_id SERIAL PRIMARY KEY,
    subscriber_id INTEGER REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
    generated_asset_id INTEGER REFERENCES generated_assets(asset_id),
    platform VARCHAR(50) NOT NULL,
    caption TEXT,
    scheduled_at TIMESTAMP NOT NULL,
    published_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    platform_post_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- VA requests (VA service inquiries)
CREATE TABLE IF NOT EXISTS va_requests (
    request_id SERIAL PRIMARY KEY,
    subscriber_id INTEGER REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
    request_type VARCHAR(100) NOT NULL,
    message TEXT,
    status VARCHAR(50) DEFAULT 'new',
    assigned_va VARCHAR(255),
    package_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usage logs (metering for free tier)
CREATE TABLE IF NOT EXISTS usage_logs (
    log_id SERIAL PRIMARY KEY,
    subscriber_id INTEGER REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    period VARCHAR(7) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invite codes (for mastermind member access)
CREATE TABLE IF NOT EXISTS invite_codes (
    code_id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    tier_granted VARCHAR(50) DEFAULT 'free',
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_customer_id ON subscribers(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_content_items_slug ON content_items(slug);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_generated_assets_subscriber_id ON generated_assets(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_subscriber_status ON scheduled_posts(subscriber_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_status ON scheduled_posts(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_usage_logs_subscriber_period ON usage_logs(subscriber_id, period);

-- Default subscription plans
INSERT INTO subscription_plans (name, price_cents, downloads_per_month, ai_rewrite, custom_templates, description)
VALUES
    ('Free', 0, 5, false, false, 'Basic access with 5 downloads per month'),
    ('Pro', 2900, NULL, true, false, 'Unlimited downloads with AI rewrite'),
    ('Enterprise', 7900, NULL, true, true, 'Unlimited downloads, custom templates, and AI rewrite')
ON CONFLICT DO NOTHING;

-- Default invite code
INSERT INTO invite_codes (code, description, tier_granted, is_active)
VALUES ('MASTERMIND2026', 'Mastermind group member invite code', 'free', true)
ON CONFLICT (code) DO NOTHING;
