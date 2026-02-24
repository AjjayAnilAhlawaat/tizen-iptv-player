# IPTV Player — Samsung Tizen TV Web App

A lightweight IPTV player for Samsung Smart TVs running Tizen OS 5.0+.
No frameworks — vanilla HTML5, CSS, and JavaScript.

---

## Features

| Feature | Details |
|---|---|
| **Xtream Codes API** | Live streams, VOD, Series via standard Xtream API endpoints |
| **M3U / M3U8** | Direct URL input, client-side parsing |
| **D-pad navigation** | Full remote-control navigation (arrow keys + Enter + Back) |
| **HLS playback** | hls.js from CDN; falls back to native `<video>` |
| **Virtual channel list** | Pages of 50 items — DOM stays lean |
| **Lazy logo loading** | IntersectionObserver — logos load only when visible |
| **OSD overlay** | Channel name + clock, fades after 3 s |
| **Saved credentials** | `localStorage` — no re-entry on relaunch |
| **Tizen lifecycle** | Pauses on visibilitychange / background suspend |

---

## Project Structure

```
tizen-iptv/
├── config.xml      ← Tizen manifest (app ID, privileges, features)
├── index.html      ← App shell & screen markup
├── style.css       ← 1920×1080 TV-optimised styles
├── app.js          ← All application logic (vanilla JS)
└── README.md       ← This file
```

> Total source size: **< 100 KB** (excluding hls.js CDN dependency).

---

## Prerequisites

- **Tizen Studio** 4.x or later — [https://developer.tizen.org/development/tizen-studio/download](https://developer.tizen.org/development/tizen-studio/download)
- Samsung developer account (for Seller Office submission)
- A Samsung Smart TV (2018+, Tizen 5.0+) or the Tizen TV Simulator

---

## Packaging into a .wgt with Tizen Studio

### 1. Import the project

1. Open Tizen Studio.
2. **File → Import → Tizen → Tizen Project**.
3. Select **"Import as General Project"** and point to the `tizen-iptv/` folder.
4. Tizen Studio will recognise the `config.xml` automatically.

### 2. Set your Certificate

1. **Tools → Certificate Manager → +** to create a new author certificate.
2. Follow the wizard (Samsung Account login required for distributor certificate).
3. Select the new profile as the active profile.

### 3. Build & sign the package

```bash
# From the Tizen Studio project root
tizen build-web -wp tizen-iptv

# Sign with your active profile
tizen package -t wgt -s <your-profile-name> -- tizen-iptv/.buildResult
```

Or use the GUI:

- Right-click the project → **Build Signed Package**.

The output `IPTVPlayer.wgt` appears in `.buildResult/`.

### 4. Install on a physical TV (Developer Mode)

1. On the TV: **Settings → General → Developer Mode** → enter your PC's IP.
2. In Tizen Studio: **Tools → Device Manager** → connect to the TV IP.
3. Right-click project → **Run As → Tizen Web Application**.

Or via CLI:

```bash
tizen install -n IPTVPlayer.wgt -t <device-serial>
```

### 5. Install on the TV Simulator

- Right-click project → **Run As → Tizen Web Simulator** → select "TV — 1920×1080".

---

## Submitting to Samsung Smart TV Seller Office

1. Sign in at [https://seller.samsungapps.com](https://seller.samsungapps.com).
2. **My Applications → Add New Application → Smart TV**.
3. Fill in app title, description, category (**Video**), screenshots (1920×1080).
4. Upload the signed `.wgt` file.
5. Complete **Content Rating** and **Country/Region** availability.
6. Submit for review (typically 3–7 business days).

### Required screenshots

| Type | Resolution |
|---|---|
| Main screenshot | 1920 × 1080 px |
| Additional (optional) | 1920 × 1080 px, up to 4 |
| App icon | 512 × 423 px |

---

## Configuration

### config.xml — key fields to customise

```xml
<!-- Unique package ID — must match Seller Office -->
<tizen:application id="AjayIPTV.iptv" package="AjayIPTV" required_version="5.0"/>

<!-- Display name -->
<name>IPTV Player</name>

<!-- Replace icon.png with a 512×423 px PNG -->
<icon src="icon.png"/>
```

**App ID format**: `PackageName.appname` — both parts alphanumeric, total ≤ 50 chars.

---

## Remote Control Key Map

| Remote key | Action |
|---|---|
| ← Left | Move focus left (Info → Channels → Sidebar) |
| → Right | Move focus right (Sidebar → Channels → Info) |
| ↑ Up | Navigate list up / previous page |
| ↓ Down | Navigate list down / next page |
| Enter / OK | Select category / channel / Play |
| Back / Return | Back one level / exit player |
| Play (▶) | Toggle play/pause in fullscreen player |
| Pause (⏸) | Pause in fullscreen player |

---

## Xtream Codes API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `player_api.php?action=get_live_categories` | Fetch live category list |
| `player_api.php?action=get_vod_categories` | Fetch VOD category list |
| `player_api.php?action=get_series_categories` | Fetch series category list |
| `player_api.php?action=get_live_streams&category_id=X` | Fetch streams for a live category |
| `player_api.php?action=get_vod_streams&category_id=X` | Fetch VOD streams |
| `player_api.php?action=get_series&category_id=X` | Fetch series |
| `/live/{user}/{pass}/{stream_id}.m3u8` | HLS live stream URL |
| `/movie/{user}/{pass}/{stream_id}.{ext}` | VOD stream URL |

---

## Browser / Simulator Testing

Open `index.html` directly in Chrome (without a Tizen device):

- Arrow key navigation works natively.
- HLS streams work via hls.js in Chrome.
- Tizen-specific APIs (`tizen.*`) are guarded with `typeof tizen !== 'undefined'` checks — they silently no-op in a browser.

---

## Extending the App

### Add EPG (Electronic Programme Guide)

Fetch EPG via `player_api.php?action=get_short_epg&stream_id=X&limit=2` and display in the info panel.

### Add subtitles / audio track switching

hls.js exposes `hls.audioTracks` and `hls.subtitleTracks` — wire to OSD menu buttons.

### Add a favourites list

Store a `JSON.stringify`-ed array under `localStorage.getItem('iptv_favourites')` and render a "Favourites" pseudo-category at the top of the sidebar.

---

## Known Limitations

- **Series playback**: The series tab lists series metadata; episode-level playback requires an additional `get_series_info` API call (not included by default — extend `onChannelSelect` for series type).
- **DRM streams**: Widevine / PlayReady require Tizen's `tizen.tvdrm` API and a DRM license server URL — not included.
- **Xtream API HTTPS**: Some providers use self-signed certs. Tizen's WebEngine may reject them. Use `http://` endpoints or add the cert to the TV's trust store via MDM.

---

## License

MIT — free to use, modify, and distribute.
