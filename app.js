/**
 * IPTV Player — Samsung Tizen TV
 * Vanilla JS, no frameworks.
 * Supports: Xtream Codes API, direct M3U/M3U8 playlist
 * Features:  Favourites list, EPG (short guide), Audio/Subtitle track switching
 */

'use strict';

/* ============================================================
   CONSTANTS & STATE
   ============================================================ */
const PAGE_SIZE  = 50;
const OSD_DELAY  = 3000;

const KEY = {
  ENTER:  13,
  BACK:   10009,
  UP:     38,
  DOWN:   40,
  LEFT:   37,
  RIGHT:  39,
  PLAY:   415,
  PAUSE:  19,
  STOP:   413,
  RETURN: 10009,
  // Samsung colour buttons
  RED:    403,
  GREEN:  404,
  YELLOW: 405,   // Toggle favourite (info) / cycle audio (player)
  BLUE:   406    // Cycle subtitle track (player)
};

const state = {
  mode:             'xtream',    // 'xtream' | 'm3u'
  xtream:           { server: '', username: '', password: '' },
  m3u:              { url: '' },
  contentType:      'live',      // 'live' | 'vod' | 'series'
  categories:       [],
  channels:         [],          // all channels for active category
  filteredChannels: [],          // after search filter
  pageIndex:        0,
  activeCatIndex:   -1,          // -1 = Favourites pseudo-cat, 0+ = real cat
  activeChannel:    null,
  focus:            'sidebar',   // 'sidebar' | 'channels' | 'info' | 'setup' | 'settings'
  hls:              null,
  osdTimer:         null,
  currentScreen:    'loading',
  favourites:       [],          // persisted to localStorage
  epgTimer:         null
};

/* ============================================================
   DOM REFS
   ============================================================ */
const $ = id => document.getElementById(id);
const dom = {
  // Screens
  screenLoading:  $('screen-loading'),
  screenSetup:    $('screen-setup'),
  screenMain:     $('screen-main'),
  screenPlayer:   $('screen-player'),
  screenSettings: $('screen-settings'),
  loadingText:    $('loading-text'),

  // Setup
  modeTabXtream:  $('mode-tab-xtream'),
  modeTabM3u:     $('mode-tab-m3u'),
  panelXtream:    $('panel-xtream'),
  panelM3u:       $('panel-m3u'),
  inputServer:    $('input-server'),
  inputUsername:  $('input-username'),
  inputPassword:  $('input-password'),
  inputM3uUrl:    $('input-m3u-url'),
  btnConnect:     $('btn-connect'),
  btnM3uLoad:     $('btn-m3u-load'),

  // Sidebar
  catTabLive:     $('cat-tab-live'),
  catTabVod:      $('cat-tab-vod'),
  catTabSeries:   $('cat-tab-series'),
  categoryList:   $('category-list'),
  settingsBtn:    $('sidebar-settings-btn'),

  // Channel panel
  channelPanelTitle: $('channel-panel-title'),
  channelCount:   $('channel-count'),
  channelSearch:  $('channel-search'),
  channelList:    $('channel-list'),
  pageInfo:       $('page-info'),
  btnPrevPage:    $('btn-prev-page'),
  btnNextPage:    $('btn-next-page'),

  // Info panel
  previewVideo:       $('preview-video'),
  previewPlaceholder: $('preview-placeholder'),
  previewLoading:     $('preview-loading'),
  metaChannelName:    $('meta-channel-name'),
  metaGroupBadge:     $('meta-group-badge'),
  metaPlayBtn:        $('meta-play-btn'),
  favBtn:             $('btn-fav'),
  epgSection:         $('epg-section'),
  epgNowTitle:        $('epg-now-title'),
  epgNowTime:         $('epg-now-time'),
  epgNextTitle:       $('epg-next-title'),
  epgNextTime:        $('epg-next-time'),

  // Player
  playerVideo:    $('player-video'),
  osd:            $('osd'),
  osdChannelName: $('osd-channel-name'),
  osdTime:        $('osd-time'),
  osdTrackHint:   $('osd-track-hint'),
  playerError:    $('player-error'),
  errorMsg:       $('error-msg'),
  errorRetryBtn:  $('error-retry-btn'),

  // Settings
  settingsClose:       $('settings-close-btn'),
  settingsModeLabel:   $('settings-mode-label'),
  settingsServerLabel: $('settings-server-label'),
  btnSwitchSource:     $('btn-switch-source'),

  // Toast
  toast: $('toast')
};

/* ============================================================
   SCREEN MANAGER
   ============================================================ */
function showScreen(name) {
  ['loading','setup','main','player','settings'].forEach(s => {
    const el = $('screen-' + s);
    if (el) el.classList.toggle('active', s === name);
  });
  state.currentScreen = name;
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(msg, duration = 2800) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), duration);
}

/* ============================================================
   LOCAL STORAGE — credentials
   ============================================================ */
function saveCredentials() {
  localStorage.setItem('iptv_mode',   state.mode);
  localStorage.setItem('iptv_xtream', JSON.stringify(state.xtream));
  localStorage.setItem('iptv_m3u',    JSON.stringify(state.m3u));
}

function loadCredentials() {
  state.mode = localStorage.getItem('iptv_mode') || 'xtream';
  const xt   = localStorage.getItem('iptv_xtream');
  const m3   = localStorage.getItem('iptv_m3u');
  if (xt) state.xtream = JSON.parse(xt);
  if (m3) state.m3u    = JSON.parse(m3);
}

/* ============================================================
   FAVOURITES
   ============================================================ */
function loadFavourites() {
  try {
    const raw = localStorage.getItem('iptv_favourites');
    state.favourites = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.favourites = [];
  }
}

function saveFavourites() {
  localStorage.setItem('iptv_favourites', JSON.stringify(state.favourites));
}

function isFavourite(ch) {
  if (!ch) return false;
  return state.favourites.some(f =>
    f.stream_id === ch.stream_id && f.name === ch.name
  );
}

function toggleFavourite(ch) {
  if (!ch) return;
  if (isFavourite(ch)) {
    state.favourites = state.favourites.filter(f =>
      !(f.stream_id === ch.stream_id && f.name === ch.name)
    );
    showToast('Removed from Favourites');
  } else {
    // Store a clean copy so the favourite survives mode/category changes
    state.favourites.push({
      name:       ch.name,
      group:      ch.group,
      logo:       ch.logo,
      stream_id:  ch.stream_id,
      stream_url: ch.stream_url,
      _raw:       ch._raw || null
    });
    showToast('Added to Favourites');
  }
  saveFavourites();
  updateFavBtn(ch);
  // Re-render sidebar so the ⭐ Favourites item appears/disappears
  renderSidebar();
}

function updateFavBtn(ch) {
  if (!dom.favBtn) return;
  const fav = isFavourite(ch);
  dom.favBtn.textContent = fav ? '♥ Favourited' : '♡ Favourite';
  dom.favBtn.classList.toggle('active', fav);
}

/* ============================================================
   EPG (Electronic Programme Guide)
   ============================================================ */
async function fetchEpg(streamId) {
  // EPG only available for Xtream live streams
  if (!streamId || state.mode !== 'xtream' || state.contentType !== 'live') {
    clearEpg();
    return;
  }

  if (dom.epgSection) dom.epgSection.style.display = 'block';
  if (dom.epgNowTitle) dom.epgNowTitle.textContent  = 'Loading…';
  if (dom.epgNowTime)  dom.epgNowTime.textContent   = '';
  if (dom.epgNextTitle) dom.epgNextTitle.textContent = '';
  if (dom.epgNextTime)  dom.epgNextTime.textContent  = '';

  try {
    const url = `${XC.base()}&action=get_short_epg&stream_id=${streamId}&limit=2`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderEpg(data);
  } catch (e) {
    if (dom.epgNowTitle) dom.epgNowTitle.textContent = 'EPG unavailable';
    if (dom.epgNowTime)  dom.epgNowTime.textContent  = '';
    if (dom.epgNextTitle) dom.epgNextTitle.textContent = '';
    if (dom.epgNextTime)  dom.epgNextTime.textContent  = '';
  }
}

function renderEpg(data) {
  // Xtream returns { epg_listings: [ { title, start, stop, ... } ] }
  // Titles are base64-encoded
  const listings = (data && Array.isArray(data.epg_listings))
    ? data.epg_listings : [];

  if (!listings.length) { clearEpg(); return; }

  const now  = listings[0] || null;
  const next = listings[1] || null;

  if (dom.epgSection) dom.epgSection.style.display = 'block';

  if (dom.epgNowTitle) {
    dom.epgNowTitle.textContent = now ? safeBase64(now.title) : '—';
  }
  if (dom.epgNowTime && now) {
    dom.epgNowTime.textContent =
      formatEpgRange(now.start, now.stop);
  }

  const nextRow = $('epg-next');
  if (next) {
    if (dom.epgNextTitle) dom.epgNextTitle.textContent = safeBase64(next.title);
    if (dom.epgNextTime)  dom.epgNextTime.textContent  = formatEpgRange(next.start, next.stop);
    if (nextRow) nextRow.style.display = 'flex';
  } else {
    if (nextRow) nextRow.style.display = 'none';
  }
}

function clearEpg() {
  if (dom.epgSection) dom.epgSection.style.display = 'none';
}

function safeBase64(str) {
  if (!str) return '—';
  try { return atob(str); } catch (e) { return str; }
}

function formatEpgRange(start, stop) {
  if (!start) return '';
  return `${epgTimeStr(start)} – ${epgTimeStr(stop)}`;
}

function epgTimeStr(ts) {
  if (!ts) return '';
  // Xtream may send "2024-01-15 20:00:00" or a Unix timestamp number
  const d = (typeof ts === 'number')
    ? new Date(ts * 1000)
    : new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ============================================================
   XTREAM CODES API
   ============================================================ */
const XC = {
  base() {
    const s = state.xtream;
    const server = s.server.replace(/\/$/, '');
    return `${server}/player_api.php?username=${encodeURIComponent(s.username)}&password=${encodeURIComponent(s.password)}`;
  },

  async getCategories(type) {
    const action = type === 'live' ? 'get_live_categories'
                 : type === 'vod'  ? 'get_vod_categories'
                 : 'get_series_categories';
    const res = await fetch(`${this.base()}&action=${action}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async getStreams(type, categoryId) {
    const action = type === 'live'   ? 'get_live_streams'
                 : type === 'vod'    ? 'get_vod_streams'
                 : 'get_series';
    const url = categoryId
      ? `${this.base()}&action=${action}&category_id=${categoryId}`
      : `${this.base()}&action=${action}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  streamUrl(channel) {
    const s  = state.xtream;
    const sv = s.server.replace(/\/$/, '');
    if (state.contentType === 'live') {
      return `${sv}/live/${s.username}/${s.password}/${channel.stream_id}.m3u8`;
    } else if (state.contentType === 'vod') {
      const ext = channel.container_extension || 'mp4';
      return `${sv}/movie/${s.username}/${s.password}/${channel.stream_id}.${ext}`;
    }
    return '';
  }
};

/* ============================================================
   M3U PARSER
   ============================================================ */
function parseM3U(text) {
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean);
  const channels = [];
  let current    = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      current = { name: '', group: 'All', logo: '', url: '' };
      const nameMatch  = line.match(/tvg-name="([^"]*)"/i);
      if (nameMatch) current.name = nameMatch[1];
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      if (groupMatch) current.group = groupMatch[1] || 'All';
      const logoMatch  = line.match(/tvg-logo="([^"]*)"/i);
      if (logoMatch) current.logo = logoMatch[1];
      if (!current.name) {
        const comma = line.lastIndexOf(',');
        if (comma !== -1) current.name = line.slice(comma + 1).trim();
      }
    } else if (current && !line.startsWith('#')) {
      current.url        = line;
      current.stream_id  = channels.length;
      current.stream_url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

function groupM3UChannels(channels) {
  const groups = {};
  channels.forEach(ch => {
    const g = ch.group || 'All';
    if (!groups[g]) groups[g] = [];
    groups[g].push(ch);
  });
  return Object.keys(groups).map(name => ({ category_name: name, channels: groups[name] }));
}

/* ============================================================
   SETUP SCREEN LOGIC
   ============================================================ */
function initSetupScreen() {
  dom.inputServer.value   = state.xtream.server   || '';
  dom.inputUsername.value = state.xtream.username  || '';
  dom.inputPassword.value = state.xtream.password  || '';
  dom.inputM3uUrl.value   = state.m3u.url          || '';
  setModeTab(state.mode);
  dom.modeTabXtream.addEventListener('click', () => setModeTab('xtream'));
  dom.modeTabM3u.addEventListener('click',    () => setModeTab('m3u'));
  dom.btnConnect.addEventListener('click',    handleXtreamConnect);
  dom.btnM3uLoad.addEventListener('click',    handleM3uLoad);
}

function setModeTab(mode) {
  state.mode = mode;
  dom.modeTabXtream.classList.toggle('active', mode === 'xtream');
  dom.modeTabM3u.classList.toggle('active',    mode === 'm3u');
  dom.panelXtream.classList.toggle('active',   mode === 'xtream');
  dom.panelM3u.classList.toggle('active',      mode === 'm3u');
}

async function handleXtreamConnect() {
  const server   = dom.inputServer.value.trim();
  const username = dom.inputUsername.value.trim();
  const password = dom.inputPassword.value.trim();
  if (!server || !username || !password) { showToast('Please fill in all fields'); return; }
  state.xtream = { server, username, password };
  saveCredentials();
  await loadXtreamContent();
}

async function handleM3uLoad() {
  const url = dom.inputM3uUrl.value.trim();
  if (!url) { showToast('Please enter a playlist URL'); return; }
  state.m3u = { url };
  saveCredentials();
  await loadM3UContent(url);
}

/* ============================================================
   CONTENT LOADING
   ============================================================ */
async function loadXtreamContent() {
  showScreen('loading');
  setLoadingText('Connecting to server…');
  try {
    const cats = await XC.getCategories(state.contentType);
    state.categories = cats;
    if (cats.length > 0) await loadCategory(cats[0], 0);
    showScreen('main');
    renderSidebar();
    updateSettingsDisplay();
  } catch (e) {
    showScreen('setup');
    showToast('Connection failed: ' + e.message);
  }
}

async function loadM3UContent(url) {
  showScreen('loading');
  setLoadingText('Fetching playlist…');
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    setLoadingText('Parsing playlist…');
    const allChannels = parseM3U(text);
    if (allChannels.length === 0) throw new Error('No channels found in playlist');
    const grouped = groupM3UChannels(allChannels);
    state.categories = grouped;
    await loadCategoryM3U(grouped[0], 0);
    showScreen('main');
    renderSidebar();
    updateSettingsDisplay();
  } catch (e) {
    showScreen('setup');
    showToast('Failed to load playlist: ' + e.message);
  }
}

function setLoadingText(msg, sub = '') {
  if (dom.loadingText) dom.loadingText.textContent = msg;
  const subEl = $('loading-sub');
  if (subEl) subEl.textContent = sub;
}

async function loadCategory(cat, index) {
  state.activeCatIndex = index;
  try {
    const streams = await XC.getStreams(state.contentType, cat.category_id);
    state.channels         = normaliseXtreamStreams(streams);
    state.filteredChannels = state.channels;
    state.pageIndex        = 0;
    dom.channelPanelTitle.textContent = cat.category_name;
    dom.channelCount.textContent      = `${streams.length} channels`;
    renderChannelPage();
    clearEpg();
  } catch (e) {
    showToast('Failed to load category');
  }
}

function loadCategoryM3U(cat, index) {
  state.activeCatIndex   = index;
  state.channels         = cat.channels || [];
  state.filteredChannels = state.channels;
  state.pageIndex        = 0;
  dom.channelPanelTitle.textContent = cat.category_name;
  dom.channelCount.textContent      = `${state.channels.length} channels`;
  renderChannelPage();
  clearEpg();
}

function normaliseXtreamStreams(streams) {
  return streams.map(s => ({
    name:       s.name || s.title || 'Unknown',
    group:      s.category_name || '',
    logo:       s.stream_icon || s.cover || '',
    stream_id:  s.stream_id || s.series_id,
    stream_url: state.mode === 'm3u' ? s.stream_url : XC.streamUrl(s),
    _raw:       s
  }));
}

/* ============================================================
   SIDEBAR RENDER
   ============================================================ */
function renderSidebar() {
  dom.categoryList.innerHTML = '';

  // ⭐ Favourites pseudo-category — appears only when list is non-empty
  if (state.favourites.length > 0) {
    const el = document.createElement('div');
    el.className = 'category-item' + (state.activeCatIndex === -1 ? ' active' : '');
    el.textContent = '⭐  Favourites';
    el.tabIndex    = -1;
    el.dataset.idx = '-1';
    el.addEventListener('click', () => onCategorySelect(-1));
    dom.categoryList.appendChild(el);
  }

  state.categories.forEach((cat, idx) => {
    const el = document.createElement('div');
    el.className = 'category-item' + (idx === state.activeCatIndex ? ' active' : '');
    el.textContent = cat.category_name || 'All';
    el.tabIndex    = -1;
    el.dataset.idx = idx;
    el.addEventListener('click', () => onCategorySelect(idx));
    dom.categoryList.appendChild(el);
  });

  updateCategoryFocus();
}

function updateCategoryFocus() {
  dom.categoryList.querySelectorAll('.category-item').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    el.classList.toggle('active', idx === state.activeCatIndex);
  });
}

/* ============================================================
   CHANNEL LIST RENDER (virtualised / paginated)
   ============================================================ */
function renderChannelPage() {
  const start = state.pageIndex * PAGE_SIZE;
  const end   = Math.min(start + PAGE_SIZE, state.filteredChannels.length);
  const page  = state.filteredChannels.slice(start, end);
  const total = state.filteredChannels.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  dom.channelList.innerHTML = '';
  dom.channelCount.textContent = `${total} channels`;

  page.forEach((ch, relIdx) => {
    const absIdx = start + relIdx;
    dom.channelList.appendChild(buildChannelItem(ch, absIdx));
  });

  dom.pageInfo.textContent     = `${state.pageIndex + 1} / ${pages}`;
  dom.btnPrevPage.disabled     = state.pageIndex === 0;
  dom.btnNextPage.disabled     = state.pageIndex >= pages - 1;

  setupLogoObserver();
}

function buildChannelItem(ch, absIdx) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  item.tabIndex  = -1;
  item.dataset.absIdx = absIdx;
  if (isFavourite(ch)) item.classList.add('favourited');

  // Logo
  const logoWrap = document.createElement('div');
  logoWrap.className = 'channel-logo-wrap';
  if (ch.logo) {
    const img = document.createElement('img');
    img.className   = 'channel-logo';
    img.dataset.src = ch.logo;
    img.alt         = '';
    img.addEventListener('load',  () => img.classList.add('loaded'));
    img.addEventListener('error', () => { img.style.display = 'none'; });
    logoWrap.appendChild(img);
  }
  const placeholder = document.createElement('div');
  placeholder.className   = 'channel-logo-placeholder';
  placeholder.textContent = (ch.name || '?').charAt(0).toUpperCase();
  logoWrap.appendChild(placeholder);

  // Info
  const info    = document.createElement('div');
  info.className = 'channel-info';
  const nameEl  = document.createElement('div');
  nameEl.className   = 'channel-name';
  nameEl.textContent = ch.name || 'Unknown';
  const groupEl = document.createElement('div');
  groupEl.className   = 'channel-group';
  groupEl.textContent = ch.group || '';
  info.appendChild(nameEl);
  info.appendChild(groupEl);

  // Number
  const num = document.createElement('div');
  num.className   = 'channel-num';
  num.textContent = absIdx + 1;

  // Fav indicator
  if (isFavourite(ch)) {
    const favMark = document.createElement('div');
    favMark.className   = 'channel-fav-mark';
    favMark.textContent = '♥';
    item.appendChild(logoWrap);
    item.appendChild(info);
    item.appendChild(favMark);
    item.appendChild(num);
  } else {
    item.appendChild(logoWrap);
    item.appendChild(info);
    item.appendChild(num);
  }

  item.addEventListener('click', () => onChannelSelect(ch));
  return item;
}

/* ============================================================
   LOGO LAZY-LOAD (IntersectionObserver)
   ============================================================ */
let logoObserver = null;
function setupLogoObserver() {
  if (logoObserver) logoObserver.disconnect();
  logoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
          logoObserver.unobserve(img);
        }
      }
    });
  }, { root: dom.channelList, rootMargin: '100px', threshold: 0 });

  dom.channelList.querySelectorAll('img[data-src]').forEach(img => {
    logoObserver.observe(img);
  });
}

/* ============================================================
   CHANNEL SELECTION (info panel)
   ============================================================ */
function onChannelSelect(ch) {
  state.activeChannel = ch;
  dom.metaChannelName.textContent = ch.name  || 'Unknown';
  dom.metaGroupBadge.textContent  = ch.group || 'Uncategorised';

  dom.channelList.querySelectorAll('.channel-item').forEach(el => {
    el.classList.remove('active');
  });

  // Update favourite button
  updateFavBtn(ch);

  // Fetch EPG asynchronously (Xtream live only)
  clearTimeout(state.epgTimer);
  state.epgTimer = setTimeout(() => fetchEpg(ch.stream_id), 300);

  showInfoPlaceholder();
}

function showInfoPlaceholder() {
  dom.previewPlaceholder.style.display = 'flex';
  dom.previewVideo.style.display       = 'none';
}

/* ============================================================
   CATEGORY SELECTION
   ============================================================ */
async function onCategorySelect(idx) {
  if (idx === state.activeCatIndex) return;
  state.activeCatIndex = idx;

  dom.channelList.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center">Loading…</div>';
  updateCategoryFocus();
  clearEpg();

  if (idx === -1) {
    // Favourites pseudo-category
    state.channels         = state.favourites.slice();
    state.filteredChannels = state.channels;
    state.pageIndex        = 0;
    dom.channelPanelTitle.textContent = '⭐  Favourites';
    dom.channelCount.textContent      = `${state.channels.length} channels`;
    renderChannelPage();
  } else if (state.mode === 'xtream') {
    await loadCategory(state.categories[idx], idx);
  } else {
    loadCategoryM3U(state.categories[idx], idx);
  }
}

/* ============================================================
   CONTENT TYPE TABS (Live / VOD / Series)
   ============================================================ */
async function onContentTypeChange(type) {
  if (state.mode !== 'xtream') return;
  state.contentType = type;
  ['live','vod','series'].forEach(t => {
    $('cat-tab-' + t).classList.toggle('active', t === type);
  });
  dom.categoryList.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center">Loading…</div>';
  dom.channelList.innerHTML  = '';
  clearEpg();
  try {
    const cats = await XC.getCategories(type);
    state.categories = cats;
    if (cats.length > 0) await loadCategory(cats[0], 0);
    renderSidebar();
  } catch (e) {
    showToast('Failed to load categories');
  }
}

/* ============================================================
   SEARCH / FILTER
   ============================================================ */
let searchTimer = null;
function onSearchInput(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const term = q.toLowerCase();
    state.filteredChannels = term
      ? state.channels.filter(ch => (ch.name || '').toLowerCase().includes(term))
      : state.channels;
    state.pageIndex = 0;
    renderChannelPage();
  }, 200);
}

/* ============================================================
   FULLSCREEN PLAYER
   ============================================================ */
function playChannel(ch) {
  if (!ch) return;
  const url = ch.stream_url || (state.mode === 'xtream' ? XC.streamUrl(ch._raw || ch) : '');
  if (!url) { showToast('No stream URL available'); return; }

  showScreen('player');
  dom.playerError.classList.remove('visible');
  dom.osdChannelName.textContent = ch.name || '';
  updateOsdClock();

  setupPlayer(url, ch);
  showOsd();
}

function setupPlayer(url, ch) {
  if (state.hls) { state.hls.destroy(); state.hls = null; }

  const video = dom.playerVideo;
  const isHLS = url.includes('.m3u8') || url.includes('/live/');

  // Hide track hint until we know what's available
  if (dom.osdTrackHint) dom.osdTrackHint.style.display = 'none';

  if (isHLS && window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      maxBufferLength:    30,
      maxMaxBufferLength: 60,
      enableWorker:       true,
      lowLatencyMode:     false
    });
    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      updateOsdTrackHint(hls);
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) handlePlayerError(data.type + ': ' + (data.details || ''));
    });

    state.hls = hls;
  } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.play().catch(() => {});
  } else {
    video.src = url;
    video.play().catch(() => {});
  }

  video.onerror = () => handlePlayerError('Stream unavailable');
}

function handlePlayerError(msg) {
  dom.playerError.classList.add('visible');
  dom.errorMsg.textContent = msg || 'Stream error';
}

function showOsd() {
  dom.osd.classList.remove('hidden');
  clearTimeout(state.osdTimer);
  state.osdTimer = setTimeout(() => dom.osd.classList.add('hidden'), OSD_DELAY);
}

function updateOsdClock() {
  const now = new Date();
  dom.osdTime.textContent =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
setInterval(updateOsdClock, 10000);

function stopPlayer() {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  dom.playerVideo.pause();
  dom.playerVideo.src = '';
  clearTimeout(state.osdTimer);
  if (dom.osdTrackHint) dom.osdTrackHint.style.display = 'none';
}

/* ============================================================
   AUDIO / SUBTITLE TRACK SWITCHING
   ============================================================ */
function cycleAudioTrack() {
  if (!state.hls) { showToast('Audio switching requires HLS stream'); return; }
  const tracks = state.hls.audioTracks;
  if (!tracks || tracks.length <= 1) { showToast('No alternate audio tracks'); return; }
  const next = (state.hls.audioTrack + 1) % tracks.length;
  state.hls.audioTrack = next;
  const t    = tracks[next];
  const name = t.name || t.lang || `Track ${next + 1}`;
  showToast(`Audio: ${name}`);
  showOsd();
}

function cycleSubtitleTrack() {
  if (!state.hls) { showToast('Subtitles require HLS stream'); return; }
  const tracks = state.hls.subtitleTracks;
  if (!tracks || tracks.length === 0) { showToast('No subtitle tracks available'); return; }
  // Cycle: 0 → 1 → … → n-1 → -1 (off) → 0
  const current = state.hls.subtitleTrack;
  const next    = (current >= tracks.length - 1) ? -1 : current + 1;
  state.hls.subtitleTrack = next;
  if (next === -1) {
    showToast('Subtitles: Off');
  } else {
    const t    = tracks[next];
    const name = t.name || t.lang || `Sub ${next + 1}`;
    showToast(`Subtitles: ${name}`);
  }
  showOsd();
}

function updateOsdTrackHint(hls) {
  if (!dom.osdTrackHint) return;
  const hasAudio    = hls && hls.audioTracks    && hls.audioTracks.length > 1;
  const hasSubtitle = hls && hls.subtitleTracks && hls.subtitleTracks.length > 0;
  dom.osdTrackHint.style.display = (hasAudio || hasSubtitle) ? 'inline' : 'none';
}

/* ============================================================
   SETTINGS SCREEN
   ============================================================ */
function updateSettingsDisplay() {
  if (!dom.settingsModeLabel) return;
  dom.settingsModeLabel.textContent = state.mode === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';
  if (dom.settingsServerLabel) {
    dom.settingsServerLabel.textContent = state.mode === 'xtream'
      ? (state.xtream.server || '—')
      : (state.m3u.url       || '—');
  }
}

function showSettings() {
  updateSettingsDisplay();
  showScreen('settings');
  state.focus = 'settings';
  dom.settingsClose.focus();
}

function closeSettings() {
  showScreen('main');
  state.focus = 'sidebar';
  focusSidebar();
}

/* ============================================================
   TIZEN REMOTE KEY REGISTRATION
   ============================================================ */
function registerTizenKeys() {
  if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
  const keys = ['Back','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
                'MediaPlay','MediaPause','MediaStop','ColorF0Red','ColorF1Green',
                'ColorF2Yellow','ColorF3Blue'];
  keys.forEach(k => {
    try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ }
  });
}

/* ============================================================
   TIZEN LIFECYCLE (visibility / suspend)
   ============================================================ */
function initTizenLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      dom.playerVideo.pause();
    } else if (state.currentScreen === 'player') {
      dom.playerVideo.play().catch(() => {});
    }
  });
  if (typeof tizen !== 'undefined') {
    document.addEventListener('tizenhwkey', handleTizenHwKey);
  }
}

function handleTizenHwKey(e) {
  if (e.keyName === 'back') handleBack();
}

/* ============================================================
   D-PAD NAVIGATION ENGINE
   ============================================================ */
function focusSidebar() {
  state.focus = 'sidebar';
  // Use data-idx to find the correct element even with the Favourites offset
  const target = dom.categoryList.querySelector(
    '[data-idx="' + state.activeCatIndex + '"]'
  );
  if (target) {
    target.focus();
  } else {
    const first = dom.categoryList.querySelector('.category-item');
    if (first) first.focus();
  }
}

function focusChannels() {
  state.focus = 'channels';
  const first = dom.channelList.querySelector('.channel-item');
  if (first) first.focus();
}

function focusInfo() {
  state.focus = 'info';
  dom.metaPlayBtn.focus();
}

function getCurrentFocusedSidebarIndex() {
  const el = document.activeElement;
  if (!el) return state.activeCatIndex;
  return parseInt(el.dataset.idx || state.activeCatIndex, 10);
}

function getCurrentFocusedChannelEl() {
  return document.activeElement &&
    document.activeElement.classList.contains('channel-item')
    ? document.activeElement : null;
}

function handleKeyDown(e) {
  const code = e.keyCode;

  if (code === KEY.BACK || code === 8) {
    e.preventDefault();
    handleBack();
    return;
  }

  switch (state.currentScreen) {
    case 'setup':    handleSetupKey(e, code);    break;
    case 'main':     handleMainKey(e, code);     break;
    case 'player':   handlePlayerKey(e, code);   break;
    case 'settings': handleSettingsKey(e, code); break;
  }
}

/* ---- Setup screen keys ---- */
function handleSetupKey(e, code) {
  if (code === KEY.ENTER) {
    const active = document.activeElement;
    if (active === dom.btnConnect || active === dom.btnM3uLoad) active.click();
  }
}

/* ---- Main screen keys ---- */
function handleMainKey(e, code) {
  if (code === KEY.LEFT) {
    e.preventDefault();
    if (state.focus === 'channels') { focusSidebar();  return; }
    if (state.focus === 'info')     { focusChannels(); return; }
  }
  if (code === KEY.RIGHT) {
    e.preventDefault();
    if (state.focus === 'sidebar')  { focusChannels(); return; }
    if (state.focus === 'channels') { focusInfo();     return; }
  }

  if (state.focus === 'sidebar')  handleSidebarKey(e, code);
  else if (state.focus === 'channels') handleChannelListKey(e, code);
  else if (state.focus === 'info')     handleInfoKey(e, code);
}

function handleSidebarKey(e, code) {
  const items  = Array.from(dom.categoryList.querySelectorAll('.category-item'));
  if (!items.length) return;
  const focused = document.activeElement;
  const idx     = items.indexOf(focused);

  if (code === KEY.DOWN) {
    e.preventDefault();
    const next = items[Math.min(idx + 1, items.length - 1)];
    if (next) { next.focus(); scrollIntoViewIfNeeded(next, dom.categoryList); }
  } else if (code === KEY.UP) {
    e.preventDefault();
    if (idx <= 0) return;
    const prev = items[idx - 1];
    if (prev) { prev.focus(); scrollIntoViewIfNeeded(prev, dom.categoryList); }
  } else if (code === KEY.ENTER) {
    e.preventDefault();
    if (focused && focused.dataset.idx !== undefined) {
      onCategorySelect(parseInt(focused.dataset.idx, 10));
    }
  }
}

function handleChannelListKey(e, code) {
  const items   = Array.from(dom.channelList.querySelectorAll('.channel-item'));
  const focused = document.activeElement;
  const idx     = items.indexOf(focused);

  if (code === KEY.DOWN) {
    e.preventDefault();
    if (idx < items.length - 1) {
      items[idx + 1].focus();
      scrollIntoViewIfNeeded(items[idx + 1], dom.channelList);
    } else {
      goNextPage();
    }
  } else if (code === KEY.UP) {
    e.preventDefault();
    if (idx > 0) {
      items[idx - 1].focus();
      scrollIntoViewIfNeeded(items[idx - 1], dom.channelList);
    } else {
      goPrevPage();
    }
  } else if (code === KEY.ENTER) {
    e.preventDefault();
    const ch = getChannelFromItem(focused);
    if (ch) { onChannelSelect(ch); focusInfo(); }
  } else if (code === KEY.YELLOW) {
    e.preventDefault();
    const ch = getChannelFromItem(focused);
    if (ch) toggleFavourite(ch);
  }
}

function getChannelFromItem(el) {
  if (!el) return null;
  const absIdx = parseInt(el.dataset.absIdx, 10);
  return isNaN(absIdx) ? null : state.filteredChannels[absIdx];
}

function handleInfoKey(e, code) {
  if (code === KEY.ENTER) {
    e.preventDefault();
    const active = document.activeElement;
    if (active && active.id === 'btn-fav') {
      if (state.activeChannel) toggleFavourite(state.activeChannel);
      return;
    }
    playChannel(state.activeChannel);
  }

  // Navigate between Play and Favourite buttons
  if (code === KEY.DOWN || code === KEY.UP) {
    e.preventDefault();
    const btns = [dom.metaPlayBtn, dom.favBtn].filter(Boolean);
    const idx  = btns.indexOf(document.activeElement);
    if (code === KEY.DOWN && idx < btns.length - 1) btns[idx + 1].focus();
    else if (code === KEY.UP && idx > 0)            btns[idx - 1].focus();
  }

  // YELLOW shortcut to toggle favourite from info panel
  if (code === KEY.YELLOW) {
    e.preventDefault();
    if (state.activeChannel) toggleFavourite(state.activeChannel);
  }
}

/* ---- Player screen keys ---- */
function handlePlayerKey(e, code) {
  if (code === KEY.ENTER || code === KEY.PLAY) {
    e.preventDefault();
    showOsd();
    const video = dom.playerVideo;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  } else if (code === KEY.PAUSE) {
    e.preventDefault();
    dom.playerVideo.pause();
    showOsd();
  } else if (code === KEY.YELLOW) {
    e.preventDefault();
    cycleAudioTrack();
  } else if (code === KEY.BLUE) {
    e.preventDefault();
    cycleSubtitleTrack();
  } else if (code === KEY.UP || code === KEY.DOWN || code === KEY.LEFT || code === KEY.RIGHT) {
    showOsd();
  }
}

/* ---- Settings screen keys ---- */
function handleSettingsKey(e, code) {
  if (code === KEY.ENTER) {
    e.preventDefault();
    const active = document.activeElement;
    if (active === dom.settingsClose) closeSettings();
    if (active && active.id === 'btn-switch-source') {
      closeSettings();
      showScreen('setup');
      state.focus = 'setup';
    }
  }
  if (code === KEY.UP || code === KEY.DOWN) {
    const focusable = Array.from(dom.screenSettings.querySelectorAll('button'));
    const idx = focusable.indexOf(document.activeElement);
    if (code === KEY.DOWN) focusable[Math.min(idx + 1, focusable.length - 1)].focus();
    else                   focusable[Math.max(idx - 1, 0)].focus();
    e.preventDefault();
  }
}

/* ---- Back key ---- */
function handleBack() {
  if (state.currentScreen === 'player') {
    stopPlayer();
    showScreen('main');
    state.focus = 'info';
    dom.metaPlayBtn.focus();
  } else if (state.currentScreen === 'settings') {
    closeSettings();
  } else if (state.currentScreen === 'main') {
    if (state.focus === 'info')     { focusChannels(); return; }
    if (state.focus === 'channels') { focusSidebar();  return; }
  } else if (state.currentScreen === 'setup') {
    if (typeof tizen !== 'undefined') tizen.application.getCurrentApplication().exit();
  }
}

/* ============================================================
   PAGINATION
   ============================================================ */
function goNextPage() {
  const pages = Math.ceil(state.filteredChannels.length / PAGE_SIZE);
  if (state.pageIndex < pages - 1) {
    state.pageIndex++;
    renderChannelPage();
    const first = dom.channelList.querySelector('.channel-item');
    if (first) first.focus();
  }
}

function goPrevPage() {
  if (state.pageIndex > 0) {
    state.pageIndex--;
    renderChannelPage();
    const items = dom.channelList.querySelectorAll('.channel-item');
    const last  = items[items.length - 1];
    if (last) last.focus();
  }
}

/* ============================================================
   UTILITIES
   ============================================================ */
function scrollIntoViewIfNeeded(el, container) {
  const elRect   = el.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();
  if (elRect.top < contRect.top) {
    container.scrollTop -= (contRect.top - elRect.top) + 8;
  } else if (elRect.bottom > contRect.bottom) {
    container.scrollTop += (elRect.bottom - contRect.bottom) + 8;
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wireEvents() {
  document.addEventListener('keydown', handleKeyDown);

  // Setup
  dom.modeTabXtream.addEventListener('click', () => setModeTab('xtream'));
  dom.modeTabM3u.addEventListener('click',    () => setModeTab('m3u'));
  dom.btnConnect.addEventListener('click',    handleXtreamConnect);
  dom.btnM3uLoad.addEventListener('click',    handleM3uLoad);

  // Content type tabs
  dom.catTabLive.addEventListener('click',   () => onContentTypeChange('live'));
  dom.catTabVod.addEventListener('click',    () => onContentTypeChange('vod'));
  dom.catTabSeries.addEventListener('click', () => onContentTypeChange('series'));

  // Settings button
  dom.settingsBtn.addEventListener('click', showSettings);

  // Search
  dom.channelSearch.addEventListener('input', e => onSearchInput(e.target.value));
  dom.channelSearch.addEventListener('keydown', e => {
    if (e.keyCode === KEY.DOWN) { e.preventDefault(); focusChannels(); }
    if (e.keyCode === KEY.UP)   { e.preventDefault(); focusSidebar();  }
  });

  // Pagination
  dom.btnPrevPage.addEventListener('click', goPrevPage);
  dom.btnNextPage.addEventListener('click', goNextPage);

  // Info panel play button
  dom.metaPlayBtn.addEventListener('click', () => playChannel(state.activeChannel));

  // Favourite button
  if (dom.favBtn) {
    dom.favBtn.addEventListener('click', () => {
      if (state.activeChannel) toggleFavourite(state.activeChannel);
    });
  }

  // Player error retry
  dom.errorRetryBtn.addEventListener('click', () => {
    dom.playerError.classList.remove('visible');
    if (state.activeChannel) playChannel(state.activeChannel);
  });

  // Settings close
  dom.settingsClose.addEventListener('click', closeSettings);

  const switchBtn = $('btn-switch-source');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      closeSettings();
      showScreen('setup');
      state.focus = 'setup';
    });
  }

  dom.screenPlayer.addEventListener('click', showOsd);
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot() {
  showScreen('loading');
  setLoadingText('Starting…');

  registerTizenKeys();
  initTizenLifecycle();
  wireEvents();
  loadCredentials();
  loadFavourites();

  if (state.mode === 'xtream' && state.xtream.server && state.xtream.username) {
    await loadXtreamContent();
  } else if (state.mode === 'm3u' && state.m3u.url) {
    await loadM3UContent(state.m3u.url);
  } else {
    initSetupScreen();
    showScreen('setup');
    state.focus = 'setup';
    setTimeout(() => dom.inputServer.focus(), 100);
  }
}

document.addEventListener('DOMContentLoaded', boot);
