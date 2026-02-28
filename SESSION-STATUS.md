# Current App - Session Status

**Last Updated:** February 27, 2026
**Production URL:** https://current-app-chi.vercel.app/
**GitHub:** https://github.com/edmundbogen/current-app

---

## What's Working (End-to-End Verified)

1. **Admin login** at `/admin` (JWT + bcrypt auth)
2. **Admin content CRUD** - Create, edit, archive content items with per-platform captions
3. **Admin image upload** - Upload button in content form, stores to Supabase Storage (`content-images` bucket)
4. **Subscriber registration** at `/register.html`
5. **Subscriber login** at `/login.html`
6. **Subscriber content library** at `/app` - Browse published content with category/type filters, search, pagination
7. **Content cards display** with uploaded featured images (or gradient placeholders)
8. **Personalization modal** opens on content click (but no graphic templates exist yet, so actual personalization won't produce output)
9. **Payment-first Stripe Checkout** flow → `/create-account?session_id=xxx`
10. **Webhook + pending_checkouts** safety net for abandoned post-payment signups

## Key Fixes Applied This Session (Feb 27, 2026)

### Database / RPC
- **Fixed `exec_sql` RPC function** in Supabase - INSERT/UPDATE/DELETE with RETURNING clauses now work. The function wraps DML+RETURNING in a CTE: `WITH q AS (...) SELECT ... FROM q`. Previously failed with "syntax error at or near INTO".
- **Added `vertical` column** to `content_items` table (was in schema.sql but missing from live DB).
- **Reset admin password** via direct SQL UPDATE on `admin_users.password_hash`.

### Subscriber App (`public/app/js/app.js`)
- **Fixed field mapping**: API returns `content_id`, `asset_id`, `post_id` but frontend used generic `.id`. Fixed across all content library cards, personalization modal, schedule, and asset deletion.
- **Fixed auth response parsing**: API returns `{ subscriber: ... }` but `checkAuth()` expected `data.user`. Added `data.subscriber` fallback.
- **Fixed personalize modal data shape**: API returns `{ item: ... }` but code expected `{ content: ... }`. Added `currentContentItem.item` fallback.
- **Fixed content type filter options**: HTML had image/carousel/video/story/reel but admin creates graphic/article/video. Aligned to match.
- **Added dynamic category loading** from `GET /api/content/categories/list` on init.

### Admin Dashboard
- **Added image upload endpoint**: `POST /api/content/upload-image` using Supabase Storage (`content-images` bucket, 10MB limit, JPG/PNG/WebP).
- **Added Upload button** next to Featured Image URL field with image preview after upload.

## What's NOT Working / Not Built Yet

1. **Graphic template system** - No templates uploaded. The Sharp compositing engine exists in code but has nothing to composite onto. Subscribers can browse content but "Personalize" won't produce a branded graphic.
2. **Social publishing APIs** - Meta Graph API, LinkedIn API not integrated.
3. **Scheduled post execution** - Schedule UI works but no cron/worker to actually publish.
4. **Email notifications** - AWS SES utility exists but no triggers wired up.
5. **Usage metering** - Free tier 5-download limit not enforced.
6. **VA service** - Route exists but no admin dashboard for it.

## Test Data in Database

- 1 admin user (Edmund's email)
- 1+ subscriber (test registration)
- 1 published content item ("Spring Market is Here") with uploaded image
- Test rows from debugging: slugs `test-title`, `test4-slug`, email `testuser-delete-me@test.com` - **should be cleaned up**

## Admin Credentials

- Email: (Edmund's admin email in `admin_users` table)
- Password: `CurrentAdmin2026!` (set Feb 27 via direct SQL)
- **Change this password** before any public launch.

## Architecture Notes

- **Database access**: All queries go through Supabase `exec_sql` RPC function (not direct pg connection). The `query()` wrapper in `server/config/database.js` interpolates params client-side then sends resolved SQL to `exec_sql`.
- **Auth**: Dual transport - JWT in localStorage (frontend) + httpOnly cookie. Admin and subscriber are separate auth flows with separate token types.
- **Storage**: Supabase Storage with public buckets (`content-images` for content, `subscriber-photos` and `subscriber-logos` for subscriber uploads).
- **Deploy**: Push to `main` → Vercel auto-deploys.

## Suggested Next Steps (Priority Order)

1. **Clean up test data** - Delete test rows from `content_items` and `subscribers`.
2. **Create 5-10 content items** with images to populate the library.
3. **Build graphic template system** - Design templates in Canva, export as PNG, upload with zone coordinates so Sharp can composite subscriber branding.
4. **Test personalization flow** end-to-end with a real template.
5. **Add more subscriber-facing polish** - empty states, loading states, error handling.
6. **Social API integrations** (Meta, LinkedIn) for actual publishing.

## Files Changed This Session

```
server/routes/content.js          - Added upload-image endpoint
server/config/database.js         - No changes (exec_sql fix was in Supabase, not code)
public/app/js/app.js              - Fixed field mapping, auth parsing, dynamic categories
public/app/index.html             - Fixed content type filter options
public/admin/index.html           - Added upload button + preview to content form
public/admin/js/admin.js          - Added handleImageUpload() function
```
