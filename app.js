/**
 * IPTV Player — Samsung Tizen TV
 * Vanilla JS, no frameworks.
 * Supports: Xtream Codes API, direct M3U/M3U8 playlist
 */

'use strict';

/* ============================================================
   CONSTANTS & STATE
   ============================================================ */
const PAGE_SIZE  = 50;   // virtual list page size
const OSD_DELAY  = 3000; // ms before OSD hides

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
  // Samsung-specific keycodes
  RED:    403,
  GREEN:  404,
  YELLOW: 405,
  BLUE:   406
};

const state = {
  mode:            'xtream',    // 'xtream' | 'm3u'
  xtream:          { server: '', username: '', password: '' },
  m3u:             { url: '' },
  contentType:     'live',      // 'live' | 'vod' | 'series'
  categories:      [],
  channels:        [],          // all channels for active category
  filteredChannels:[],          // after search filter
  pageIndex:       0,
  activeCatIndex:  -1,
  activeChannel:   null,
  focus:           'sidebar',   // 'sidebar' | 'channels' | 'info' | 'setup' | 'settings'
  hls:             null,
  osdTimer:        null,
  currentScreen:   'loading'
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

  // Player
  playerVideo:    $('player-video'),
  osd:            $('osd'),
  osdChannelName: $('osd-channel-name'),
  osdTime:        $('osd-time'),
  playerError:    $('player-error'),
  errorMsg:       $('error-msg'),
  errorRetryBtn:  $('error-retry-btn'),

  // Settings
  settingsClose:  $('settings-close-btn'),
  settingsModeLabel: $('settings-mode-label'),
  settingsServerLabel: $('settings-server-label'),
  btnSwitchSource: $('btn-switch-source'),

  // Toast
  toast:          $('toast')
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
   LOCAL STORAGE
   ============================================================ */
function saveCredentials() {
  localStorage.setItem('iptv_mode', state.mode);
  localStorage.setItem('iptv_xtream', JSON.stringify(state.xtream));
  localStorage.setItem('iptv_m3u', JSON.stringify(state.m3u));
}

function loadCredentials() {
  state.mode   = localStorage.getItem('iptv_mode') || 'xtream';
  const xt     = localStorage.getItem('iptv_xtream');
  const m3     = localStorage.getItem('iptv_m3u');
  if (xt) state.xtream = JSON.parse(xt);
  if (m3) state.m3u    = JSON.parse(m3);
}

/* ============================================================
   XTREAM CODES API
   ============================================================ */
const XC = {
  base() {
    const s = state.xtream;
    // Normalise: remove trailing slash
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
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
  const channels = [];
  let current   = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) {
      current = { name: '', group: 'All', logo: '', url: '' };
      // Extract tvg-name
      const nameMatch = line.match(/tvg-name="([^"]*)"/i);
      if (nameMatch) current.name = nameMatch[1];
      // Extract group-title
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      if (groupMatch) current.group = groupMatch[1] || 'All';
      // Extract tvg-logo
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      if (logoMatch) current.logo = logoMatch[1];
      // Fallback name: text after last comma
      if (!current.name) {
        const comma = line.lastIndexOf(',');
        if (comma !== -1) current.name = line.slice(comma + 1).trim();
      }
    } else if (current && !line.startsWith('#')) {
      current.url = line;
      // Normalise stream_id field so code paths are unified
      current.stream_id = channels.length;
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
  // Pre-fill from storage
  dom.inputServer.value   = state.xtream.server   || '';
  dom.inputUsername.value = state.xtream.username  || '';
  dom.inputPassword.value = state.xtream.password  || '';
  dom.inputM3uUrl.value   = state.m3u.url          || '';

  // Set active mode tab
  setModeTab(state.mode);

  dom.modeTabXtream.addEventListener('click', () => setModeTab('xtream'));
  dom.modeTabM3u.addEventListener('click',    () => setModeTab('m3u'));
  dom.btnConnect.addEventListener('click',   handleXtreamConnect);
  dom.btnM3uLoad.addEventListener('click',   handleM3uLoad);
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

  if (!server || !username || !password) {
    showToast('Please fill in all fields');
    return;
  }

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
    // Auto-load first category
    if (cats.length > 0) {
      await loadCategory(cats[0], 0);
    }
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
    // Attach channels to first category
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
    state.channels = normaliseXtreamStreams(streams);
    state.filteredChannels = state.channels;
    state.pageIndex = 0;
    dom.channelPanelTitle.textContent = cat.category_name;
    dom.channelCount.textContent      = `${streams.length} channels`;
    renderChannelPage();
  } catch (e) {
    showToast('Failed to load category');
  }
}

function loadCategoryM3U(cat, index) {
  state.activeCatIndex = index;
  state.channels = cat.channels || [];
  state.filteredChannels = state.channels;
  state.pageIndex = 0;
  dom.channelPanelTitle.textContent = cat.category_name;
  dom.channelCount.textContent      = `${state.channels.length} channels`;
  renderChannelPage();
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
  const items = dom.categoryList.querySelectorAll('.category-item');
  items.forEach((el, i) => el.classList.toggle('active', i === state.activeCatIndex));
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
    const el     = buildChannelItem(ch, absIdx);
    dom.channelList.appendChild(el);
  });

  // Pagination
  dom.pageInfo.textContent = `${state.pageIndex + 1} / ${pages}`;
  dom.btnPrevPage.disabled = state.pageIndex === 0;
  dom.btnNextPage.disabled = state.pageIndex >= pages - 1;

  // Lazy-load logos via IntersectionObserver
  setupLogoObserver();
}

function buildChannelItem(ch, absIdx) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  item.tabIndex  = -1;
  item.dataset.absIdx = absIdx;

  // Logo
  const logoWrap = document.createElement('div');
  logoWrap.className = 'channel-logo-wrap';
  if (ch.logo) {
    const img = document.createElement('img');
    img.className = 'channel-logo';
    img.dataset.src = ch.logo;     // lazy-loaded
    img.alt = '';
    img.addEventListener('load',  () => img.classList.add('loaded'));
    img.addEventListener('error', () => img.style.display = 'none');
    logoWrap.appendChild(img);
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'channel-logo-placeholder';
  placeholder.textContent = (ch.name || '?').charAt(0).toUpperCase();
  logoWrap.appendChild(placeholder);

  // Info
  const info = document.createElement('div');
  info.className = 'channel-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'channel-name';
  nameEl.textContent = ch.name || 'Unknown';
  const groupEl = document.createElement('div');
  groupEl.className = 'channel-group';
  groupEl.textContent = ch.group || '';
  info.appendChild(nameEl);
  info.appendChild(groupEl);

  // Number
  const num = document.createElement('div');
  num.className = 'channel-num';
  num.textContent = absIdx + 1;

  item.appendChild(logoWrap);
  item.appendChild(info);
  item.appendChild(num);

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
  dom.metaChannelName.textContent  = ch.name || 'Unknown';
  dom.metaGroupBadge.textContent   = ch.group || 'Uncategorised';

  // Highlight in list
  dom.channelList.querySelectorAll('.channel-item').forEach(el => {
    el.classList.remove('active');
  });

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
  const cat = state.categories[idx];

  // Clear channel list while loading
  dom.channelList.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center">Loading…</div>';
  updateCategoryFocus();

  if (state.mode === 'xtream') {
    await loadCategory(cat, idx);
  } else {
    loadCategoryM3U(cat, idx);
  }
}

/* ============================================================
   CONTENT TYPE TABS (Live / VOD / Series)
   ============================================================ */
async function onContentTypeChange(type) {
  if (state.mode !== 'xtream') return; // M3U doesn't have type tabs
  state.contentType = type;
  ['live','vod','series'].forEach(t => {
    $('cat-tab-' + t).classList.toggle('active', t === type);
  });
  dom.categoryList.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center">Loading…</div>';
  dom.channelList.innerHTML  = '';
  try {
    const cats = await XC.getCategories(type);
    state.categories = cats;
    if (cats.length > 0) {
      await loadCategory(cats[0], 0);
    }
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
  dom.osd.classList.remove('hidden');

  dom.osdChannelName.textContent = ch.name || '';
  updateOsdClock();

  setupPlayer(url, ch);
  showOsd();
}

function setupPlayer(url, ch) {
  // Destroy previous hls instance
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  const video = dom.playerVideo;
  const isHLS = url.includes('.m3u8') || url.includes('/live/');

  if (isHLS && window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      maxBufferLength:      30,
      maxMaxBufferLength:   60,
      enableWorker:         true,
      lowLatencyMode:       false
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) handlePlayerError(data.type + ': ' + (data.details || ''));
    });
    state.hls = hls;
  } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari / Tizen native)
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
  const now  = new Date();
  const h    = String(now.getHours()).padStart(2,'0');
  const m    = String(now.getMinutes()).padStart(2,'0');
  dom.osdTime.textContent = `${h}:${m}`;
}
setInterval(updateOsdClock, 10000);

function stopPlayer() {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  dom.playerVideo.pause();
  dom.playerVideo.src = '';
  clearTimeout(state.osdTimer);
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
      : (state.m3u.url || '—');
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

  // Tizen-specific suspend/resume
  if (typeof tizen !== 'undefined') {
    document.addEventListener('tizenhwkey', handleTizenHwKey);
  }
}

function handleTizenHwKey(e) {
  if (e.keyName === 'back') {
    handleBack();
  }
}

/* ============================================================
   D-PAD NAVIGATION ENGINE
   ============================================================ */
function focusSidebar() {
  state.focus = 'sidebar';
  const items = dom.categoryList.querySelectorAll('.category-item');
  if (items[state.activeCatIndex]) {
    items[state.activeCatIndex].focus();
  } else if (items[0]) {
    items[0].focus();
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

  // Global Back key
  if (code === KEY.BACK || code === 8) {
    e.preventDefault();
    handleBack();
    return;
  }

  // Per-screen routing
  switch (state.currentScreen) {
    case 'setup':    handleSetupKey(e, code); break;
    case 'main':     handleMainKey(e, code);  break;
    case 'player':   handlePlayerKey(e, code); break;
    case 'settings': handleSettingsKey(e, code); break;
  }
}

/* ---- Setup screen keys ---- */
function handleSetupKey(e, code) {
  if (code === KEY.ENTER) {
    const active = document.activeElement;
    if (active === dom.btnConnect || active === dom.btnM3uLoad) {
      active.click();
    }
  }
}

/* ---- Main screen keys ---- */
function handleMainKey(e, code) {
  if (code === KEY.LEFT) {
    e.preventDefault();
    if (state.focus === 'channels') { focusSidebar(); return; }
    if (state.focus === 'info')     { focusChannels(); return; }
  }
  if (code === KEY.RIGHT) {
    e.preventDefault();
    if (state.focus === 'sidebar')  { focusChannels(); return; }
    if (state.focus === 'channels') { focusInfo();    return; }
  }

  if (state.focus === 'sidebar') {
    handleSidebarKey(e, code);
  } else if (state.focus === 'channels') {
    handleChannelListKey(e, code);
  } else if (state.focus === 'info') {
    handleInfoKey(e, code);
  }
}

function handleSidebarKey(e, code) {
  const items = Array.from(dom.categoryList.querySelectorAll('.category-item'));
  if (!items.length) return;
  const focused = document.activeElement;
  const idx     = items.indexOf(focused);

  if (code === KEY.DOWN) {
    e.preventDefault();
    const next = items[Math.min(idx + 1, items.length - 1)];
    next && next.focus();
    next && scrollIntoViewIfNeeded(next, dom.categoryList);
  } else if (code === KEY.UP) {
    e.preventDefault();
    if (idx <= 0) return;
    const prev = items[idx - 1];
    prev && prev.focus();
    prev && scrollIntoViewIfNeeded(prev, dom.categoryList);
  } else if (code === KEY.ENTER) {
    e.preventDefault();
    if (focused && focused.dataset.idx !== undefined) {
      const i = parseInt(focused.dataset.idx, 10);
      onCategorySelect(i);
    }
  }
}

function handleChannelListKey(e, code) {
  const items  = Array.from(dom.channelList.querySelectorAll('.channel-item'));
  const focused = document.activeElement;
  const idx     = items.indexOf(focused);

  if (code === KEY.DOWN) {
    e.preventDefault();
    if (idx < items.length - 1) {
      items[idx + 1].focus();
      scrollIntoViewIfNeeded(items[idx + 1], dom.channelList);
    } else {
      // Next page
      goNextPage();
    }
  } else if (code === KEY.UP) {
    e.preventDefault();
    if (idx > 0) {
      items[idx - 1].focus();
      scrollIntoViewIfNeeded(items[idx - 1], dom.channelList);
    } else {
      // Prev page
      goPrevPage();
    }
  } else if (code === KEY.ENTER) {
    e.preventDefault();
    const ch = getChannelFromItem(focused);
    if (ch) {
      onChannelSelect(ch);
      focusInfo();
    }
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
    playChannel(state.activeChannel);
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
    // Simple focus cycling within settings
    const focusable = dom.screenSettings.querySelectorAll('button');
    const arr       = Array.from(focusable);
    const idx       = arr.indexOf(document.activeElement);
    if (code === KEY.DOWN) arr[Math.min(idx + 1, arr.length - 1)].focus();
    else                   arr[Math.max(idx - 1, 0)].focus();
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
    if (state.focus === 'info')      { focusChannels(); return; }
    if (state.focus === 'channels')  { focusSidebar();  return; }
    // On sidebar — confirm exit? (TVs handle this differently; just let it bubble)
  } else if (state.currentScreen === 'setup') {
    // Cannot go back from setup — exit app on Tizen
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
  // Global key handler
  document.addEventListener('keydown', handleKeyDown);

  // Setup interactions
  dom.modeTabXtream.addEventListener('click', () => setModeTab('xtream'));
  dom.modeTabM3u.addEventListener('click',    () => setModeTab('m3u'));
  dom.btnConnect.addEventListener('click',    handleXtreamConnect);
  dom.btnM3uLoad.addEventListener('click',    handleM3uLoad);

  // Category type tabs (Xtream only)
  dom.catTabLive.addEventListener('click',   () => onContentTypeChange('live'));
  dom.catTabVod.addEventListener('click',    () => onContentTypeChange('vod'));
  dom.catTabSeries.addEventListener('click', () => onContentTypeChange('series'));

  // Sidebar settings button
  dom.settingsBtn.addEventListener('click', showSettings);

  // Search
  dom.channelSearch.addEventListener('input', e => onSearchInput(e.target.value));
  dom.channelSearch.addEventListener('keydown', e => {
    if (e.keyCode === KEY.DOWN) { e.preventDefault(); focusChannels(); }
    if (e.keyCode === KEY.UP)   { e.preventDefault(); focusSidebar(); }
  });

  // Pagination buttons
  dom.btnPrevPage.addEventListener('click', goPrevPage);
  dom.btnNextPage.addEventListener('click', goNextPage);

  // Info panel play button
  dom.metaPlayBtn.addEventListener('click', () => playChannel(state.activeChannel));

  // Player error retry
  dom.errorRetryBtn.addEventListener('click', () => {
    dom.playerError.classList.remove('visible');
    if (state.activeChannel) playChannel(state.activeChannel);
  });

  // Settings close
  dom.settingsClose.addEventListener('click', closeSettings);

  // Switch source button in settings
  const switchBtn = $('btn-switch-source');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      closeSettings();
      showScreen('setup');
      state.focus = 'setup';
    });
  }

  // Player: click/tap shows OSD
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

  // Check if we have saved credentials to auto-connect
  if (state.mode === 'xtream' && state.xtream.server && state.xtream.username) {
    await loadXtreamContent();
  } else if (state.mode === 'm3u' && state.m3u.url) {
    await loadM3UContent(state.m3u.url);
  } else {
    initSetupScreen();
    showScreen('setup');
    state.focus = 'setup';
    // Auto-focus first input
    setTimeout(() => dom.inputServer.focus(), 100);
  }
}

document.addEventListener('DOMContentLoaded', boot);
