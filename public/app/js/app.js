// ============================================
// Current - Subscriber Dashboard App
// ============================================

(function() {
  'use strict';

  const API_BASE = '/api';
  let currentUser = null;
  let currentTab = 'library';
  let contentPage = 1;
  let contentTotal = 0;
  const PER_PAGE = 12;

  // ---- Auth ----
  function getToken() {
    return localStorage.getItem('token');
  }

  async function apiFetch(path, options) {
    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      return null;
    }
    const headers = {
      'Authorization': 'Bearer ' + token,
      ...(options && options.headers ? options.headers : {})
    };
    if (options && options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(API_BASE + path, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
      return null;
    }
    return res;
  }

  async function checkAuth() {
    try {
      const res = await apiFetch('/auth/subscriber/me');
      if (!res || !res.ok) return false;
      const data = await res.json();
      currentUser = data.subscriber || data.user || data;
      return true;
    } catch (e) {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  }

  // ---- Tab Switching ----
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.topbar-tab').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function(el) {
      el.classList.toggle('active', el.id === 'panel-' + tab);
    });
    if (tab === 'library') loadContentLibrary();
    if (tab === 'assets') loadAssets();
    if (tab === 'schedule') loadSchedule();
    if (tab === 'profile') loadProfile();
  }

  // ---- Content Library ----
  async function loadContentLibrary() {
    var grid = document.getElementById('contentGrid');
    var pagination = document.getElementById('contentPagination');
    grid.innerHTML = '<div class="loading-center"><div class="spinner spinner-lg"></div><span>Loading content...</span></div>';
    pagination.innerHTML = '';

    var category = document.getElementById('filterCategory').value;
    var type = document.getElementById('filterType').value;
    var search = document.getElementById('filterSearch').value.trim();

    var params = new URLSearchParams();
    params.set('page', contentPage);
    params.set('limit', PER_PAGE);
    if (category) params.set('category', category);
    if (type) params.set('content_type', type);
    if (search) params.set('search', search);

    try {
      var res = await apiFetch('/content?' + params.toString());
      if (!res) return;
      var data = await res.json();
      var items = data.content || data.items || data.data || [];
      contentTotal = data.total || data.pagination?.total || items.length;

      if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128218;</div><h3>No content found</h3><p>Try adjusting your filters or check back later for new content.</p></div>';
        return;
      }

      grid.innerHTML = items.map(function(item) {
        var itemId = item.content_id || item.id;
        var imageStyle = '';
        var imageContent = '';
        if (item.featured_image_url || item.image_url || item.thumbnail_url) {
          imageContent = '<img src="' + escapeHtml(item.featured_image_url || item.image_url || item.thumbnail_url) + '" alt="' + escapeHtml(item.title) + '">';
        } else {
          var gradients = [
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)'
          ];
          imageStyle = 'style="background:' + gradients[itemId % gradients.length] + '"';
          imageContent = '<span style="font-size:2rem;opacity:0.8">&#9733;</span>';
        }
        return '<div class="content-card" onclick="window.app.openPersonalize(' + itemId + ')" data-id="' + itemId + '">' +
          '<div class="content-card-image" ' + imageStyle + '>' + imageContent +
          '<span class="content-card-badge">' + escapeHtml(item.content_type || item.type || 'post') + '</span></div>' +
          '<div class="content-card-body"><div class="content-card-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="content-card-meta">' + escapeHtml(item.category || '') + '</div></div></div>';
      }).join('');

      renderPagination(pagination, contentTotal, contentPage, function(page) {
        contentPage = page;
        loadContentLibrary();
      });

    } catch (e) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><h3>Error loading content</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  }

  function renderPagination(container, total, current, onClick) {
    var pages = Math.ceil(total / PER_PAGE);
    if (pages <= 1) return;
    var html = '';
    html += '<button ' + (current <= 1 ? 'disabled' : '') + ' data-page="' + (current - 1) + '">&laquo; Prev</button>';
    for (var i = 1; i <= pages; i++) {
      if (pages > 7 && i > 3 && i < pages - 2 && Math.abs(i - current) > 1) {
        if (i === 4 || i === pages - 3) html += '<button disabled>...</button>';
        continue;
      }
      html += '<button class="' + (i === current ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    html += '<button ' + (current >= pages ? 'disabled' : '') + ' data-page="' + (current + 1) + '">Next &raquo;</button>';
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var p = parseInt(this.dataset.page);
        if (p >= 1 && p <= pages) onClick(p);
      });
    });
  }

  // ---- Personalization Modal ----
  var personalizeModal = null;
  var currentContentItem = null;
  var generatedAssetUrl = null;
  var currentCaptions = {};
  var currentPlatform = 'facebook';

  async function openPersonalize(contentId) {
    personalizeModal = document.getElementById('personalizeModal');
    personalizeModal.classList.add('active');
    var body = personalizeModal.querySelector('.modal-body');
    body.innerHTML = '<div class="loading-center"><div class="spinner spinner-lg"></div><span>Loading content details...</span></div>';
    document.getElementById('personalizeFooter').innerHTML = '';

    try {
      var res = await apiFetch('/content/' + contentId);
      if (!res) return;
      currentContentItem = await res.json();
      var item = currentContentItem.item || currentContentItem.content || currentContentItem;

      currentCaptions = {
        facebook: item.caption_facebook || item.caption || '',
        instagram: item.caption_instagram || item.caption || '',
        linkedin: item.caption_linkedin || item.caption || '',
        twitter: item.caption_twitter || item.caption || ''
      };

      var imgHtml = '';
      if (item.featured_image_url || item.image_url) {
        imgHtml = '<img src="' + escapeHtml(item.featured_image_url || item.image_url) + '" alt="">';
      } else {
        imgHtml = '<div style="padding:40px;color:var(--color-mid-gray);text-align:center"><div style="font-size:2rem;margin-bottom:8px">&#128444;</div>Preview will appear after personalization</div>';
      }

      body.innerHTML =
        '<div class="personalize-preview" id="personalizePreview">' + imgHtml + '</div>' +
        '<h4 style="margin-bottom:12px">' + escapeHtml(item.title) + '</h4>' +
        '<div class="caption-tabs" id="captionTabs">' +
          '<button class="caption-tab facebook active" data-platform="facebook" onclick="window.app.switchCaption(\'facebook\')">Facebook</button>' +
          '<button class="caption-tab instagram" data-platform="instagram" onclick="window.app.switchCaption(\'instagram\')">Instagram</button>' +
          '<button class="caption-tab linkedin" data-platform="linkedin" onclick="window.app.switchCaption(\'linkedin\')">LinkedIn</button>' +
          '<button class="caption-tab twitter" data-platform="twitter" onclick="window.app.switchCaption(\'twitter\')">Twitter</button>' +
        '</div>' +
        '<div class="caption-box" id="captionBox">' + escapeHtml(currentCaptions.facebook || 'No caption available') + '</div>' +
        '<div class="alert alert-error" id="personalizeError"></div>' +
        '<div class="alert alert-success" id="personalizeSuccess"></div>' +
        '<div class="schedule-form" id="scheduleForm">' +
          '<div class="form-row">' +
            '<div><label>Platform</label><select id="schedulePlatform"><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option><option value="twitter">Twitter</option></select></div>' +
            '<div><label>Date & Time</label><input type="datetime-local" id="scheduleDateTime"></div>' +
          '</div>' +
          '<div><label>Caption</label><textarea id="scheduleCaption" rows="3"></textarea></div>' +
          '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">' +
            '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'scheduleForm\').classList.remove(\'active\')">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="window.app.submitSchedule()">Schedule Post</button>' +
          '</div>' +
        '</div>';

      document.getElementById('personalizeFooter').innerHTML =
        '<button class="btn btn-primary" id="personalizeBtn" onclick="window.app.generatePersonalized()">Personalize</button>' +
        '<button class="btn btn-outline btn-sm" id="downloadBtn" style="display:none" onclick="window.app.downloadAsset()">Download</button>' +
        '<button class="btn btn-ghost btn-sm" id="scheduleBtn" style="display:none" onclick="window.app.showScheduleForm()">Schedule Post</button>' +
        '<button class="btn btn-ghost btn-sm" id="rewriteBtn" style="display:none" onclick="window.app.rewriteCaption()">Rewrite Caption</button>';

    } catch (e) {
      body.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  }

  function switchCaption(platform) {
    currentPlatform = platform;
    document.querySelectorAll('#captionTabs .caption-tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.platform === platform);
    });
    var box = document.getElementById('captionBox');
    if (box) box.textContent = currentCaptions[platform] || 'No caption available';
  }

  async function generatePersonalized() {
    var btn = document.getElementById('personalizeBtn');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    var item = currentContentItem.item || currentContentItem.content || currentContentItem;

    try {
      var res = await apiFetch('/personalize/generate', {
        method: 'POST',
        body: JSON.stringify({ content_id: item.content_id || item.id })
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Generation failed');

      generatedAssetUrl = data.download_url || data.image_url || data.url;
      var preview = document.getElementById('personalizePreview');
      if (generatedAssetUrl) {
        preview.innerHTML = '<img src="' + escapeHtml(generatedAssetUrl) + '" alt="Personalized preview">';
      }

      if (data.captions) {
        currentCaptions = { ...currentCaptions, ...data.captions };
        switchCaption(currentPlatform);
      }

      btn.textContent = 'Regenerate';
      btn.disabled = false;
      document.getElementById('downloadBtn').style.display = '';
      document.getElementById('scheduleBtn').style.display = '';
      document.getElementById('rewriteBtn').style.display = '';

      showModalSuccess('Content personalized successfully!');
    } catch (e) {
      showModalError(e.message);
      btn.textContent = 'Personalize';
      btn.disabled = false;
    }
  }

  function downloadAsset() {
    if (generatedAssetUrl) {
      var a = document.createElement('a');
      a.href = generatedAssetUrl;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  function showScheduleForm() {
    var form = document.getElementById('scheduleForm');
    form.classList.add('active');
    document.getElementById('schedulePlatform').value = currentPlatform;
    document.getElementById('scheduleCaption').value = currentCaptions[currentPlatform] || '';
    // Default to tomorrow at 9am
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    document.getElementById('scheduleDateTime').value = tomorrow.toISOString().slice(0, 16);
  }

  async function submitSchedule() {
    var platform = document.getElementById('schedulePlatform').value;
    var datetime = document.getElementById('scheduleDateTime').value;
    var caption = document.getElementById('scheduleCaption').value;
    var item = currentContentItem.item || currentContentItem.content || currentContentItem;

    if (!datetime) {
      showModalError('Please select a date and time.');
      return;
    }

    try {
      var res = await apiFetch('/schedule', {
        method: 'POST',
        body: JSON.stringify({
          content_id: item.content_id || item.id,
          platform: platform,
          scheduled_time: new Date(datetime).toISOString(),
          caption: caption
        })
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Scheduling failed');

      showModalSuccess('Post scheduled for ' + new Date(datetime).toLocaleString());
      document.getElementById('scheduleForm').classList.remove('active');
    } catch (e) {
      showModalError(e.message);
    }
  }

  async function rewriteCaption() {
    var btn = document.getElementById('rewriteBtn');
    btn.disabled = true;
    btn.textContent = 'Rewriting...';
    var item = currentContentItem.item || currentContentItem.content || currentContentItem;

    try {
      var res = await apiFetch('/personalize/rewrite-caption', {
        method: 'POST',
        body: JSON.stringify({
          content_id: item.content_id || item.id,
          platform: currentPlatform,
          caption: currentCaptions[currentPlatform]
        })
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Rewrite failed');

      var rewritten = data.caption || data.rewritten_caption || '';
      if (rewritten) {
        currentCaptions[currentPlatform] = rewritten;
        switchCaption(currentPlatform);
        showModalSuccess('Caption rewritten!');
      }
    } catch (e) {
      showModalError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Rewrite Caption';
    }
  }

  function closeModal() {
    if (personalizeModal) personalizeModal.classList.remove('active');
    generatedAssetUrl = null;
    currentContentItem = null;
  }

  function showModalError(msg) {
    var el = document.getElementById('personalizeError');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    var s = document.getElementById('personalizeSuccess');
    if (s) s.classList.remove('show');
  }

  function showModalSuccess(msg) {
    var el = document.getElementById('personalizeSuccess');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    var e = document.getElementById('personalizeError');
    if (e) e.classList.remove('show');
  }

  // ---- My Assets ----
  async function loadAssets() {
    var grid = document.getElementById('assetsGrid');
    grid.innerHTML = '<div class="loading-center"><div class="spinner spinner-lg"></div><span>Loading assets...</span></div>';

    try {
      var res = await apiFetch('/assets');
      if (!res) return;
      var data = await res.json();
      var items = data.assets || data.items || data.data || [];

      if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128444;</div><h3>No assets yet</h3><p>Personalize content from the library to generate your branded assets.</p></div>';
        return;
      }

      grid.innerHTML = items.map(function(item) {
        var imgHtml = '';
        if (item.download_url || item.image_url || item.thumbnail_url) {
          imgHtml = '<img src="' + escapeHtml(item.thumbnail_url || item.image_url || item.download_url) + '" alt="">';
        } else {
          imgHtml = '<div style="font-size:2rem;color:var(--color-mid-gray)">&#128444;</div>';
        }
        var dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
        return '<div class="asset-card">' +
          '<div class="asset-card-image">' + imgHtml + '</div>' +
          '<div class="asset-card-body">' +
            '<div class="asset-card-title">' + escapeHtml(item.title || item.content_title || 'Untitled') + '</div>' +
            '<div class="asset-card-meta">' + dateStr + (item.download_count ? ' &middot; ' + item.download_count + ' downloads' : '') + '</div>' +
            '<div class="asset-card-actions">' +
              '<a href="' + escapeHtml(item.download_url || item.image_url || '#') + '" download class="btn btn-sm btn-primary">Download</a>' +
              '<button class="btn btn-sm btn-danger" onclick="window.app.deleteAsset(' + (item.asset_id || item.id) + ')">Delete</button>' +
            '</div>' +
          '</div></div>';
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="empty-state"><h3>Error loading assets</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  }

  async function deleteAsset(assetId) {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    try {
      var res = await apiFetch('/assets/' + assetId, { method: 'DELETE' });
      if (res && res.ok) {
        loadAssets();
      } else {
        var data = res ? await res.json() : {};
        alert(data.error || 'Failed to delete asset');
      }
    } catch (e) {
      alert(e.message);
    }
  }

  // ---- Schedule ----
  var scheduleWeekOffset = 0;

  async function loadSchedule() {
    var list = document.getElementById('scheduleList');
    list.innerHTML = '<div class="loading-center"><div class="spinner spinner-lg"></div><span>Loading schedule...</span></div>';
    updateWeekLabel();

    try {
      var startOfWeek = getWeekStart(scheduleWeekOffset);
      var endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);

      var params = new URLSearchParams();
      params.set('start_date', startOfWeek.toISOString());
      params.set('end_date', endOfWeek.toISOString());

      var res = await apiFetch('/schedule?' + params.toString());
      if (!res) return;
      var data = await res.json();
      var items = data.scheduled_posts || data.posts || data.items || data.data || [];

      if (items.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128197;</div><h3>No posts scheduled</h3><p>Schedule posts from the content library to see them here.</p></div>';
        return;
      }

      list.innerHTML = '<div class="schedule-list">' + items.map(function(item) {
        var platform = (item.platform || 'facebook').toLowerCase();
        var platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
        var platformInitial = platformLabel.charAt(0);
        var status = item.status || 'scheduled';
        var dateStr = item.scheduled_time ? new Date(item.scheduled_time).toLocaleString() : '';
        return '<div class="schedule-item">' +
          '<div class="schedule-platform ' + platform + '">' + platformInitial + '</div>' +
          '<div class="schedule-info">' +
            '<div class="schedule-caption">' + escapeHtml(item.caption || 'No caption') + '</div>' +
            '<div class="schedule-datetime">' + dateStr + '</div>' +
          '</div>' +
          '<span class="status-badge ' + status + '">' + status + '</span>' +
          '<div class="schedule-actions">' +
            '<button class="btn btn-sm btn-ghost" onclick="window.app.deleteScheduledPost(' + (item.post_id || item.id) + ')">Delete</button>' +
          '</div></div>';
      }).join('') + '</div>';
    } catch (e) {
      list.innerHTML = '<div class="empty-state"><h3>Error loading schedule</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  }

  function getWeekStart(offset) {
    var now = new Date();
    var day = now.getDay();
    var diff = now.getDate() - day + (day === 0 ? -6 : 1) + (offset * 7);
    var d = new Date(now);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function updateWeekLabel() {
    var start = getWeekStart(scheduleWeekOffset);
    var end = new Date(start);
    end.setDate(end.getDate() + 6);
    var label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                ' - ' + end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var el = document.getElementById('weekLabel');
    if (el) el.textContent = label;
  }

  function prevWeek() { scheduleWeekOffset--; loadSchedule(); }
  function nextWeek() { scheduleWeekOffset++; loadSchedule(); }

  async function deleteScheduledPost(postId) {
    if (!confirm('Delete this scheduled post?')) return;
    try {
      var res = await apiFetch('/schedule/' + postId, { method: 'DELETE' });
      if (res && res.ok) {
        loadSchedule();
      } else {
        var data = res ? await res.json() : {};
        alert(data.error || 'Failed to delete');
      }
    } catch (e) {
      alert(e.message);
    }
  }

  // ---- Profile ----
  async function loadProfile() {
    var container = document.getElementById('profileContent');
    container.innerHTML = '<div class="loading-center"><div class="spinner spinner-lg"></div><span>Loading profile...</span></div>';

    try {
      var res = await apiFetch('/auth/subscriber/me');
      if (!res) return;
      var data = await res.json();
      currentUser = data.user || data;

      var u = currentUser;
      var branding = u.branding || {};
      var tier = u.subscription_tier || u.tier || 'free';

      container.innerHTML =
        '<div class="profile-sections">' +
          '<div class="profile-section">' +
            '<h3>Personal Information</h3>' +
            '<div class="alert alert-error" id="profileError"></div>' +
            '<div class="alert alert-success" id="profileSuccess"></div>' +
            '<div class="form-group"><label>Name</label><input type="text" id="profileName" value="' + escapeAttr(u.name || '') + '"></div>' +
            '<div class="form-group"><label>Email</label><input type="email" id="profileEmail" value="' + escapeAttr(u.email || '') + '" readonly></div>' +
            '<div class="form-group"><label>Company</label><input type="text" id="profileCompany" value="' + escapeAttr(u.company || '') + '"></div>' +
            '<div class="form-group"><label>Phone</label><input type="tel" id="profilePhone" value="' + escapeAttr(u.phone || '') + '"></div>' +
            '<div class="form-group"><label>Website</label><input type="url" id="profileWebsite" value="' + escapeAttr(u.website || '') + '" placeholder="https://"></div>' +
            '<div class="form-group"><label>Bio</label><textarea id="profileBio" rows="3">' + escapeHtml(u.bio || '') + '</textarea></div>' +
            '<button class="btn btn-primary" onclick="window.app.savePersonalInfo()">Save Personal Info</button>' +
          '</div>' +
          '<div class="profile-section">' +
            '<h3>Branding</h3>' +
            '<div class="alert alert-error" id="brandError"></div>' +
            '<div class="alert alert-success" id="brandSuccess"></div>' +
            '<div class="upload-area">' +
              '<div class="upload-preview" id="photoPreview">' +
                (branding.photo_url ? '<img src="' + escapeAttr(branding.photo_url) + '" alt="Photo">' : 'Photo') +
              '</div>' +
              '<div><button class="upload-btn" onclick="document.getElementById(\'photoInput\').click()">Upload Photo</button>' +
              '<input type="file" id="photoInput" accept="image/*" style="display:none" onchange="window.app.uploadFile(\'photo\', this)"></div>' +
            '</div>' +
            '<div class="upload-area">' +
              '<div class="upload-preview logo" id="logoPreview">' +
                (branding.logo_url ? '<img src="' + escapeAttr(branding.logo_url) + '" alt="Logo">' : 'Logo') +
              '</div>' +
              '<div><button class="upload-btn" onclick="document.getElementById(\'logoInput\').click()">Upload Logo</button>' +
              '<input type="file" id="logoInput" accept="image/*" style="display:none" onchange="window.app.uploadFile(\'logo\', this)"></div>' +
            '</div>' +
            '<div class="color-picker-row">' +
              '<div class="color-picker-group"><label>Primary Color</label><input type="color" id="brandColorPrimary" value="' + escapeAttr(branding.color_primary || '#1a3e5c') + '" onchange="window.app.updateBrandPreview()"></div>' +
              '<div class="color-picker-group"><label>Secondary Color</label><input type="color" id="brandColorSecondary" value="' + escapeAttr(branding.color_secondary || '#00a8e1') + '" onchange="window.app.updateBrandPreview()"></div>' +
            '</div>' +
            '<div class="form-group"><label>Tagline</label><input type="text" id="brandTagline" value="' + escapeAttr(branding.tagline || '') + '" placeholder="Your professional tagline" oninput="window.app.updateBrandPreview()"></div>' +
            '<div class="brand-preview" id="brandPreviewArea">' +
              '<div class="brand-preview-card">' +
                '<div class="brand-preview-header" id="previewHeader" style="background:' + escapeAttr(branding.color_primary || '#1a3e5c') + '">' +
                  '<div class="brand-preview-photo" id="previewPhoto">' + (branding.photo_url ? '<img src="' + escapeAttr(branding.photo_url) + '">' : '') + '</div>' +
                  '<div class="brand-preview-name" style="color:#fff">' + escapeHtml(u.name || 'Your Name') + '</div>' +
                '</div>' +
                '<div class="brand-preview-image" style="background:' + escapeAttr(branding.color_secondary || '#00a8e1') + '">' +
                  '<div class="brand-preview-logo" id="previewLogo">' + (branding.logo_url ? '<img src="' + escapeAttr(branding.logo_url) + '">' : '') + '</div>' +
                '</div>' +
                '<div class="brand-preview-footer" id="previewTagline">' + escapeHtml(branding.tagline || 'Your tagline here') + '</div>' +
              '</div>' +
            '</div>' +
            '<button class="btn btn-primary" onclick="window.app.saveBranding()">Save Branding</button>' +
          '</div>' +
        '</div>' +
        '<div class="subscription-info">' +
          '<h3>Subscription</h3>' +
          '<div class="tier-badge ' + tier + '">' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' Plan</div>' +
          (tier === 'free' ? '<p style="color:var(--color-mid-gray);margin-bottom:16px">Upgrade to Pro for unlimited downloads, AI captions, and scheduling.</p><a href="/pricing.html" class="btn btn-primary">Upgrade Plan</a>' :
           tier === 'pro' ? '<p style="color:var(--color-mid-gray);margin-bottom:16px">You have access to all Pro features.</p><a href="/pricing.html" class="btn btn-outline">View Plans</a>' :
           '<p style="color:var(--color-mid-gray)">You have access to all Enterprise features.</p>') +
        '</div>';

    } catch (e) {
      container.innerHTML = '<div class="empty-state"><h3>Error loading profile</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
  }

  async function savePersonalInfo() {
    var body = {
      name: document.getElementById('profileName').value.trim(),
      company: document.getElementById('profileCompany').value.trim(),
      phone: document.getElementById('profilePhone').value.trim(),
      website: document.getElementById('profileWebsite').value.trim(),
      bio: document.getElementById('profileBio').value.trim()
    };

    try {
      var res = await apiFetch('/subscribers/profile', {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Save failed');

      var s = document.getElementById('profileSuccess');
      s.textContent = 'Personal info saved!';
      s.classList.add('show');
      document.getElementById('profileError').classList.remove('show');
      var userName = document.getElementById('userName');
      if (userName) userName.textContent = body.name;
    } catch (e) {
      var el = document.getElementById('profileError');
      el.textContent = e.message;
      el.classList.add('show');
      document.getElementById('profileSuccess').classList.remove('show');
    }
  }

  async function saveBranding() {
    var body = {
      color_primary: document.getElementById('brandColorPrimary').value,
      color_secondary: document.getElementById('brandColorSecondary').value,
      tagline: document.getElementById('brandTagline').value.trim()
    };

    try {
      var res = await apiFetch('/subscribers/branding', {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      if (!res) return;
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Save failed');

      var s = document.getElementById('brandSuccess');
      s.textContent = 'Branding saved!';
      s.classList.add('show');
      document.getElementById('brandError').classList.remove('show');
    } catch (e) {
      var el = document.getElementById('brandError');
      el.textContent = e.message;
      el.classList.add('show');
      document.getElementById('brandSuccess').classList.remove('show');
    }
  }

  async function uploadFile(type, input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var formData = new FormData();
    formData.append(type, file);

    try {
      var token = getToken();
      var res = await fetch(API_BASE + '/subscribers/upload/' + type, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Upload failed');

      var url = data.url || data[type + '_url'];
      var preview = document.getElementById(type === 'photo' ? 'photoPreview' : 'logoPreview');
      if (preview && url) {
        preview.innerHTML = '<img src="' + escapeHtml(url) + '" alt="">';
      }

      // Update brand preview
      if (type === 'photo') {
        var pp = document.getElementById('previewPhoto');
        if (pp && url) pp.innerHTML = '<img src="' + escapeHtml(url) + '">';
      }
      if (type === 'logo') {
        var pl = document.getElementById('previewLogo');
        if (pl && url) pl.innerHTML = '<img src="' + escapeHtml(url) + '">';
      }
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
  }

  function updateBrandPreview() {
    var primary = document.getElementById('brandColorPrimary').value;
    var secondary = document.getElementById('brandColorSecondary').value;
    var tagline = document.getElementById('brandTagline').value;

    var header = document.getElementById('previewHeader');
    if (header) header.style.background = primary;

    var image = document.querySelector('.brand-preview-image');
    if (image) image.style.background = secondary;

    var tag = document.getElementById('previewTagline');
    if (tag) tag.textContent = tagline || 'Your tagline here';
  }

  // ---- Utilities ----
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Initialize ----
  async function init() {
    var authed = await checkAuth();
    if (!authed) {
      window.location.href = '/login.html';
      return;
    }

    // Set user name in topbar
    var userName = document.getElementById('userName');
    if (userName && currentUser) {
      userName.textContent = currentUser.name || currentUser.email || '';
    }

    // Tab click handlers
    document.querySelectorAll('.topbar-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        switchTab(this.dataset.tab);
        // Close mobile menu
        document.getElementById('mobileMenu').classList.remove('open');
      });
    });

    // Filter handlers
    document.getElementById('filterCategory').addEventListener('change', function() { contentPage = 1; loadContentLibrary(); });
    document.getElementById('filterType').addEventListener('change', function() { contentPage = 1; loadContentLibrary(); });
    var searchTimeout;
    document.getElementById('filterSearch').addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function() { contentPage = 1; loadContentLibrary(); }, 400);
    });

    // Load categories from API
    try {
      var catRes = await apiFetch('/content/categories/list');
      if (catRes && catRes.ok) {
        var catData = await catRes.json();
        var catSelect = document.getElementById('filterCategory');
        var cats = catData.categories || [];
        if (cats.length > 0) {
          catSelect.innerHTML = '<option value="">All Categories</option>' +
            cats.map(function(c) {
              return '<option value="' + escapeAttr(c) + '">' + escapeHtml(c.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); })) + '</option>';
            }).join('');
        }
      }
    } catch (e) { /* keep static options as fallback */ }

    // Load default tab
    switchTab('library');
  }

  // Expose functions to global scope for onclick handlers
  window.app = {
    openPersonalize: openPersonalize,
    switchCaption: switchCaption,
    generatePersonalized: generatePersonalized,
    downloadAsset: downloadAsset,
    showScheduleForm: showScheduleForm,
    submitSchedule: submitSchedule,
    rewriteCaption: rewriteCaption,
    closeModal: closeModal,
    deleteAsset: deleteAsset,
    prevWeek: prevWeek,
    nextWeek: nextWeek,
    deleteScheduledPost: deleteScheduledPost,
    savePersonalInfo: savePersonalInfo,
    saveBranding: saveBranding,
    uploadFile: uploadFile,
    updateBrandPreview: updateBrandPreview,
    logout: logout
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
