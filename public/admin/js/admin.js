/* ===== State ===== */
let token = localStorage.getItem('admin_token') || '';
let currentContentPage = 1;
let currentTemplatePage = 1;
let currentSubscriberPage = 1;
let editingContentId = null;
let editingTemplateId = null;
let templatesCache = [];

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    verifySession();
  }
  setupTabNavigation();
});

/* ===== Auth ===== */
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed';
      errEl.style.display = 'block';
      return;
    }
    token = data.token;
    localStorage.setItem('admin_token', token);
    document.cookie = 'admin_token=' + token + '; path=/; max-age=' + (7 * 24 * 60 * 60) + '; SameSite=Lax';
    showApp(data.admin);
  } catch (err) {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
}

async function verifySession() {
  try {
    const res = await apiFetch('/api/auth/admin/me');
    if (!res.ok) {
      handleLogout();
      return;
    }
    const data = await res.json();
    showApp(data.admin);
  } catch {
    handleLogout();
  }
}

function handleLogout() {
  token = '';
  localStorage.removeItem('admin_token');
  document.cookie = 'admin_token=; path=/; max-age=0';
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showApp(admin) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('admin-name').textContent = admin ? admin.name : '';
  loadDashboard();
}

/* ===== API Helper ===== */
function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers, credentials: 'include' });
}

/* ===== Tab Navigation ===== */
function setupTabNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  const tabContent = document.getElementById('tab-' + tab);
  if (navItem) navItem.classList.add('active');
  if (tabContent) tabContent.classList.add('active');

  if (tab === 'dashboard') loadDashboard();
  else if (tab === 'content') loadContent();
  else if (tab === 'templates') loadTemplates();
  else if (tab === 'subscribers') loadSubscribers();
}

/* ===== Dashboard ===== */
async function loadDashboard() {
  try {
    // Fetch stats from multiple endpoints in parallel
    const [subRes, contentRes, templateRes] = await Promise.allSettled([
      apiFetch('/api/auth/admin/me').then(r => r.json()),
      apiFetch('/api/content?limit=1').then(r => r.json()),
      apiFetch('/api/templates?limit=1').then(r => r.json()),
    ]);

    // Subscriber stats - we fetch all content to get published count
    const contentData = contentRes.status === 'fulfilled' ? contentRes.value : {};
    const templateData = templateRes.status === 'fulfilled' ? templateRes.value : {};

    // Set content published count
    document.getElementById('stat-content').textContent = contentData.total || 0;

    // For subscriber stats, we'll use the subscribers endpoint if it exists,
    // otherwise show what we can
    try {
      const subListRes = await apiFetch('/api/content?limit=100&status=published');
      const subListData = await subListRes.json();
      document.getElementById('stat-content').textContent = subListData.total || 0;
    } catch { /* keep previous value */ }

    // Placeholder values for stats that need dedicated admin endpoints
    document.getElementById('stat-subscribers').textContent = '--';
    document.getElementById('stat-pro').textContent = '--';
    document.getElementById('stat-downloads').textContent = '--';

    // Try to load subscriber stats from admin subscribers endpoint
    try {
      const allSubRes = await apiFetch('/api/admin/subscribers?limit=1');
      if (allSubRes.ok) {
        const allSubData = await allSubRes.json();
        document.getElementById('stat-subscribers').textContent = allSubData.total || 0;
      }
    } catch { /* endpoint may not exist yet */ }

    try {
      const proRes = await apiFetch('/api/admin/subscribers?tier=pro&limit=1');
      if (proRes.ok) {
        const proData = await proRes.json();
        document.getElementById('stat-pro').textContent = proData.total || 0;
      }
    } catch { /* endpoint may not exist yet */ }

  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

/* ===== Content Management ===== */
async function loadContent(page) {
  if (page) currentContentPage = page;
  const tbody = document.getElementById('content-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';

  try {
    const res = await apiFetch(`/api/content?page=${currentContentPage}&limit=20`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No content items yet.</p></td></tr>';
      document.getElementById('content-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.items.map(item => `
      <tr>
        <td title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.content_type || '')}</td>
        <td>${escapeHtml(item.category || '--')}</td>
        <td><span class="badge badge-${item.status}">${item.status}</span></td>
        <td>${formatDate(item.created_at)}</td>
        <td>
          <button class="btn btn-small btn-ghost" onclick="editContent(${item.content_id})">Edit</button>
          <button class="btn btn-small btn-danger" onclick="deleteContent(${item.content_id}, '${escapeHtml(item.title)}')">Delete</button>
        </td>
      </tr>
    `).join('');

    renderPagination('content-pagination', data.page, data.pages, loadContent);

    // Also load templates for the content form dropdown
    loadTemplateDropdown();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Failed to load content.</p></td></tr>';
    console.error('Content load error:', err);
  }
}

function showContentForm(item) {
  editingContentId = item ? (item.content_id || item.id) : null;
  document.getElementById('content-form-title').textContent = editingContentId ? 'Edit Content' : 'New Content';
  document.getElementById('cf-submit-btn').textContent = editingContentId ? 'Update Content' : 'Create Content';

  document.getElementById('cf-id').value = editingContentId || '';
  document.getElementById('cf-title').value = item ? item.title : '';
  document.getElementById('cf-type').value = item ? item.content_type : 'graphic';
  document.getElementById('cf-category').value = item ? (item.category || '') : '';
  document.getElementById('cf-tags').value = item && item.tags ? (Array.isArray(item.tags) ? item.tags.join(', ') : item.tags) : '';
  document.getElementById('cf-description').value = item ? (item.description || '') : '';
  document.getElementById('cf-caption-fb').value = item ? (item.caption_facebook || '') : '';
  document.getElementById('cf-caption-ig').value = item ? (item.caption_instagram || '') : '';
  document.getElementById('cf-caption-tw').value = item ? (item.caption_twitter || '') : '';
  document.getElementById('cf-caption-li').value = item ? (item.caption_linkedin || '') : '';
  document.getElementById('cf-article-body').value = item ? (item.article_body || item.body || '') : '';
  document.getElementById('cf-template').value = item ? (item.template_id || '') : '';
  document.getElementById('cf-image').value = item ? (item.featured_image_url || item.thumbnail_url || '') : '';
  document.getElementById('cf-status').value = item ? (item.status || 'draft') : 'draft';
  document.getElementById('cf-vertical').value = item ? (item.vertical || 'real_estate') : 'real_estate';

  toggleArticleBody();
  updateTwitterCount();
  document.getElementById('content-form-panel').style.display = 'block';
  document.getElementById('content-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function hideContentForm() {
  document.getElementById('content-form-panel').style.display = 'none';
  editingContentId = null;
  document.getElementById('content-form').reset();
}

function toggleArticleBody() {
  const type = document.getElementById('cf-type').value;
  document.getElementById('article-body-group').style.display = type === 'article' ? 'block' : 'none';
}

function updateTwitterCount() {
  const val = document.getElementById('cf-caption-tw').value;
  const countEl = document.getElementById('tw-count');
  countEl.textContent = val.length;
  countEl.parentElement.className = val.length > 280 ? 'char-counter over' : 'char-counter';
}

async function handleContentSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('cf-title').value.trim();
  const content_type = document.getElementById('cf-type').value;
  const category = document.getElementById('cf-category').value.trim();
  const tagsRaw = document.getElementById('cf-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const description = document.getElementById('cf-description').value.trim();
  const caption_facebook = document.getElementById('cf-caption-fb').value.trim();
  const caption_instagram = document.getElementById('cf-caption-ig').value.trim();
  const caption_twitter = document.getElementById('cf-caption-tw').value.trim();
  const caption_linkedin = document.getElementById('cf-caption-li').value.trim();
  const article_body = document.getElementById('cf-article-body').value.trim();
  const template_id = document.getElementById('cf-template').value || null;
  const thumbnail_url = document.getElementById('cf-image').value.trim();
  const status = document.getElementById('cf-status').value;
  const vertical = document.getElementById('cf-vertical').value;

  const payload = {
    title,
    content_type,
    category: category || null,
    vertical: vertical || null,
    template_id: template_id ? parseInt(template_id) : null,
    status,
    thumbnail_url: thumbnail_url || null,
    caption_facebook: caption_facebook || null,
    caption_instagram: caption_instagram || null,
    caption_twitter: caption_twitter || null,
    caption_linkedin: caption_linkedin || null,
    article_body: article_body || null,
    tags: tags.length > 0 ? tags : null,
  };

  try {
    let res;
    if (editingContentId) {
      res = await apiFetch(`/api/content/${editingContentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      res = await apiFetch('/api/content', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || data.errors?.map(e => e.msg).join(', ') || 'Failed to save';
      showToast(msg, 'error');
      return;
    }

    showToast(editingContentId ? 'Content updated' : 'Content created', 'success');
    hideContentForm();
    loadContent();
  } catch (err) {
    showToast('Network error', 'error');
    console.error(err);
  }
}

async function editContent(id) {
  try {
    // Fetch full content item - we need to get by slug or iterate.
    // The API returns items in the list, so let's fetch all to find it.
    const res = await apiFetch(`/api/content?limit=100`);
    const data = await res.json();
    const item = data.items?.find(i => i.content_id === id);
    if (item) {
      showContentForm(item);
    } else {
      showToast('Content item not found', 'error');
    }
  } catch (err) {
    showToast('Failed to load content item', 'error');
    console.error(err);
  }
}

async function deleteContent(id, title) {
  if (!confirm(`Are you sure you want to archive "${title}"?\nThis will set the status to archived.`)) return;

  try {
    const res = await apiFetch(`/api/content/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Failed to archive', 'error');
      return;
    }
    showToast('Content archived', 'success');
    loadContent();
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function loadTemplateDropdown() {
  try {
    const res = await apiFetch('/api/templates?limit=100');
    if (!res.ok) return;
    const data = await res.json();
    templatesCache = data.items || [];
    const select = document.getElementById('cf-template');
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- None --</option>';
    templatesCache.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.template_id;
      opt.textContent = `${t.name} (${t.platform})`;
      select.appendChild(opt);
    });
    if (currentVal) select.value = currentVal;
  } catch { /* non-critical */ }
}

/* ===== Templates Management ===== */
const PLATFORM_PRESETS = {
  instagram_square: { width: 1080, height: 1080 },
  facebook_post: { width: 1200, height: 630 },
  instagram_story: { width: 1080, height: 1920 },
  linkedin_post: { width: 1200, height: 627 },
};

async function loadTemplates(page) {
  if (page) currentTemplatePage = page;
  const tbody = document.getElementById('templates-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';

  try {
    const res = await apiFetch(`/api/templates?page=${currentTemplatePage}&limit=20`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No templates yet.</p></td></tr>';
      document.getElementById('templates-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.items.map(t => `
      <tr>
        <td title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.platform || '')}</td>
        <td>${t.width} x ${t.height}</td>
        <td><span class="badge badge-${t.tier_required}">${t.tier_required}</span></td>
        <td><span class="badge badge-${t.status}">${t.status}</span></td>
        <td>
          <button class="btn btn-small btn-ghost" onclick="editTemplate(${t.template_id})">Edit</button>
          <button class="btn btn-small btn-danger" onclick="deleteTemplate(${t.template_id}, '${escapeHtml(t.name)}')">Delete</button>
        </td>
      </tr>
    `).join('');

    renderPagination('templates-pagination', data.page, data.pages, loadTemplates);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Failed to load templates.</p></td></tr>';
    console.error('Templates load error:', err);
  }
}

function showTemplateForm(item) {
  editingTemplateId = item ? item.template_id : null;
  document.getElementById('template-form-title').textContent = editingTemplateId ? 'Edit Template' : 'New Template';
  document.getElementById('tf-submit-btn').textContent = editingTemplateId ? 'Update Template' : 'Create Template';

  document.getElementById('tf-id').value = editingTemplateId || '';
  document.getElementById('tf-name').value = item ? item.name : '';
  document.getElementById('tf-url').value = item ? (item.template_file_url || '') : '';
  document.getElementById('tf-platform').value = item ? (item.platform || '') : '';
  document.getElementById('tf-width').value = item ? item.width : '';
  document.getElementById('tf-height').value = item ? item.height : '';
  document.getElementById('tf-tier').value = item ? (item.tier_required || 'free') : 'free';
  document.getElementById('tf-status').value = item ? (item.status || 'active') : 'active';

  let layoutStr = '';
  if (item && item.layout_config) {
    layoutStr = typeof item.layout_config === 'string' ? item.layout_config : JSON.stringify(item.layout_config, null, 2);
  }
  document.getElementById('tf-layout').value = layoutStr;

  document.getElementById('zone-preview').innerHTML = '';
  document.getElementById('template-form-panel').style.display = 'block';
  document.getElementById('template-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function hideTemplateForm() {
  document.getElementById('template-form-panel').style.display = 'none';
  editingTemplateId = null;
  document.getElementById('template-form').reset();
  document.getElementById('zone-preview').innerHTML = '';
}

function applyPlatformPreset() {
  const platform = document.getElementById('tf-platform').value;
  const preset = PLATFORM_PRESETS[platform];
  if (preset) {
    document.getElementById('tf-width').value = preset.width;
    document.getElementById('tf-height').value = preset.height;
  }
}

function renderZonePreview() {
  const container = document.getElementById('zone-preview');
  const layoutRaw = document.getElementById('tf-layout').value.trim();
  const width = parseInt(document.getElementById('tf-width').value) || 1080;
  const height = parseInt(document.getElementById('tf-height').value) || 1080;

  if (!layoutRaw) {
    container.innerHTML = '<p style="padding:16px;color:#6b7280;font-size:13px;">Enter layout config JSON first.</p>';
    return;
  }

  let config;
  try {
    config = JSON.parse(layoutRaw);
  } catch {
    container.innerHTML = '<p style="padding:16px;color:#ef4444;font-size:13px;">Invalid JSON. Please fix the layout config.</p>';
    return;
  }

  const zones = config.zones || [];
  if (zones.length === 0) {
    container.innerHTML = '<p style="padding:16px;color:#6b7280;font-size:13px;">No zones defined in the config.</p>';
    return;
  }

  // Scale to fit preview (max 400px wide)
  const maxW = 400;
  const scale = maxW / width;
  const scaledH = Math.round(height * scale);

  container.style.width = maxW + 'px';
  container.style.height = scaledH + 'px';
  container.innerHTML = '';

  const ZONE_COLORS = {
    photo: '#3b82f6',
    name: '#10b981',
    logo: '#8b5cf6',
    tagline: '#f59e0b',
    color: '#ef4444',
  };

  zones.forEach(zone => {
    const div = document.createElement('div');
    div.className = 'zone-box';
    div.style.left = Math.round(zone.x * scale) + 'px';
    div.style.top = Math.round(zone.y * scale) + 'px';
    div.style.width = Math.round(zone.width * scale) + 'px';
    div.style.height = Math.round(zone.height * scale) + 'px';
    const color = ZONE_COLORS[zone.type] || '#00a8e1';
    div.style.borderColor = color;
    div.style.color = color;
    div.style.background = color + '14';
    div.textContent = zone.type;
    container.appendChild(div);
  });
}

async function handleTemplateSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('tf-name').value.trim();
  const template_file_url = document.getElementById('tf-url').value.trim();
  const platform = document.getElementById('tf-platform').value;
  const width = parseInt(document.getElementById('tf-width').value);
  const height = parseInt(document.getElementById('tf-height').value);
  const tier_required = document.getElementById('tf-tier').value;
  const status = document.getElementById('tf-status').value;
  const layoutRaw = document.getElementById('tf-layout').value.trim();

  let layout_config;
  try {
    layout_config = JSON.parse(layoutRaw);
  } catch {
    showToast('Layout config must be valid JSON', 'error');
    return;
  }

  const payload = { name, template_file_url, platform, width, height, tier_required, status, layout_config };

  try {
    let res;
    if (editingTemplateId) {
      res = await apiFetch(`/api/templates/${editingTemplateId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      res = await apiFetch('/api/templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || data.errors?.map(e => e.msg).join(', ') || 'Failed to save';
      showToast(msg, 'error');
      return;
    }

    showToast(editingTemplateId ? 'Template updated' : 'Template created', 'success');
    hideTemplateForm();
    loadTemplates();
  } catch (err) {
    showToast('Network error', 'error');
    console.error(err);
  }
}

async function editTemplate(id) {
  try {
    const res = await apiFetch(`/api/templates/${id}`);
    if (!res.ok) {
      showToast('Template not found', 'error');
      return;
    }
    const data = await res.json();
    showTemplateForm(data.template);
  } catch (err) {
    showToast('Failed to load template', 'error');
    console.error(err);
  }
}

async function deleteTemplate(id, name) {
  if (!confirm(`Are you sure you want to deactivate "${name}"?\nThis will set the status to inactive.`)) return;

  try {
    const res = await apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Failed to deactivate', 'error');
      return;
    }
    showToast('Template deactivated', 'success');
    loadTemplates();
  } catch (err) {
    showToast('Network error', 'error');
  }
}

/* ===== Subscribers ===== */
async function loadSubscribers(page) {
  if (page) currentSubscriberPage = page;
  const tbody = document.getElementById('subscribers-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';

  const tier = document.getElementById('sub-filter-tier').value;
  const params = new URLSearchParams({ page: currentSubscriberPage, limit: 20 });
  if (tier) params.set('tier', tier);

  try {
    const res = await apiFetch(`/api/admin/subscribers?${params}`);

    if (!res.ok) {
      // If admin subscribers endpoint doesn't exist, show a helpful message
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Subscribers API endpoint not available yet. Add GET /api/admin/subscribers route.</p></td></tr>';
      document.getElementById('subscribers-pagination').innerHTML = '';
      return;
    }

    const data = await res.json();
    const items = data.subscribers || data.items || [];

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No subscribers found.</p></td></tr>';
      document.getElementById('subscribers-pagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = items.map(s => `
      <tr class="clickable" onclick='showSubscriberDetail(${JSON.stringify(s).replace(/'/g, "&#39;")})'>
        <td>${escapeHtml(s.name || '')}</td>
        <td>${escapeHtml(s.email || '')}</td>
        <td><span class="badge badge-${s.subscription_tier || s.tier || 'free'}">${s.subscription_tier || s.tier || 'free'}</span></td>
        <td>${s.mastermind_member ? 'Yes' : 'No'}</td>
        <td>${s.downloads_this_month || 0}</td>
        <td>${formatDate(s.created_at)}</td>
      </tr>
    `).join('');

    const total = data.total || items.length;
    const pages = data.pages || Math.ceil(total / 20);
    renderPagination('subscribers-pagination', data.page || currentSubscriberPage, pages, loadSubscribers);

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Failed to load subscribers.</p></td></tr>';
    console.error('Subscribers load error:', err);
  }
}

function showSubscriberDetail(subscriber) {
  const panel = document.getElementById('subscriber-detail-panel');
  const body = document.getElementById('subscriber-detail-body');

  const fields = [
    { label: 'Name', value: subscriber.name },
    { label: 'Email', value: subscriber.email },
    { label: 'Phone', value: subscriber.phone },
    { label: 'Company', value: subscriber.company },
    { label: 'Tier', value: subscriber.subscription_tier || subscriber.tier },
    { label: 'Mastermind', value: subscriber.mastermind_member ? 'Yes' : 'No' },
    { label: 'Tagline', value: subscriber.tagline },
    { label: 'Website', value: subscriber.website },
    { label: 'Primary Color', value: subscriber.brand_color_primary },
    { label: 'Secondary Color', value: subscriber.brand_color_secondary },
    { label: 'Downloads This Month', value: subscriber.downloads_this_month },
    { label: 'Status', value: subscriber.status },
    { label: 'Joined', value: formatDate(subscriber.created_at) },
    { label: 'Last Login', value: formatDate(subscriber.last_login) },
  ];

  body.innerHTML = '<div class="detail-grid">' +
    fields.map(f => `
      <div class="detail-item">
        <div class="label">${f.label}</div>
        <div class="value">${escapeHtml(String(f.value || '--'))}</div>
      </div>
    `).join('') +
    '</div>';

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
}

function hideSubscriberDetail() {
  document.getElementById('subscriber-detail-panel').style.display = 'none';
}

/* ===== Pagination ===== */
function renderPagination(containerId, currentPage, totalPages, loadFn) {
  const container = document.getElementById(containerId);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  html += `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="${loadFn.name}(${currentPage - 1})">&laquo; Prev</button>`;

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  if (start > 1) {
    html += `<button onclick="${loadFn.name}(1)">1</button>`;
    if (start > 2) html += '<button disabled>...</button>';
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" onclick="${loadFn.name}(${i})">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += '<button disabled>...</button>';
    html += `<button onclick="${loadFn.name}(${totalPages})">${totalPages}</button>`;
  }

  html += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="${loadFn.name}(${currentPage + 1})">Next &raquo;</button>`;

  container.innerHTML = html;
}

/* ===== Utilities ===== */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + (type || 'info');
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}
