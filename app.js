// Launch Compass — KSC Launch Tracker & Compass
// Uses Launch Library 2 API (ll.thespacedevs.com)

const CACHE_KEY = 'launch-compass-data';
const CACHE_TS_KEY = 'launch-compass-ts';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// KSC location IDs and pad coordinates
const KSC_LOCATION_IDS = [12, 27]; // 12 = KSC, 27 = CCAFS
const API_BASE = 'https://ll.thespacedevs.com/2.2.0';

// Fallback pad coordinates for known KSC/Cape Canaveral pads
const PAD_COORDS = {
  'LC-39A':  { lat: 28.6083, lon: -80.6041 },
  'LC-39B':  { lat: 28.6272, lon: -80.6209 },
  'SLC-40':  { lat: 28.5622, lon: -80.5771 },
  'SLC-41':  { lat: 28.5832, lon: -80.5826 },
  'LC-36':   { lat: 28.4714, lon: -80.5378 },
  'SLC-37B': { lat: 28.5317, lon: -80.5656 },
  'LC-46':   { lat: 28.4583, lon: -80.5283 },
  // Generic KSC center point as last resort
  'KSC':     { lat: 28.5729, lon: -80.6490 },
};

// ---- State ----
let launches = [];
let selectedLaunch = null;
let userLat = null;
let userLon = null;
let compassHeading = null;
let watchId = null;
let countdownInterval = null;
let listCountdownInterval = null;
let orientationListenerAttached = false;

// ---- DOM refs ----
const listView = document.getElementById('list-view');
const compassView = document.getElementById('compass-view');
const launchList = document.getElementById('launch-list');
const listSpinner = document.getElementById('list-spinner');
const refreshBtn = document.getElementById('refresh-btn');
const backBtn = document.getElementById('back-btn');
const cacheStatus = document.getElementById('cache-status');

const compassMissionName = document.getElementById('compass-mission-name');
const compassProvider = document.getElementById('compass-provider');
const countdownTimer = document.getElementById('countdown-timer');
const countdownLabel = document.getElementById('countdown-label');
const bearingDisplay = document.getElementById('bearing-display');
const distanceDisplay = document.getElementById('distance-display');
const detailDate = document.getElementById('detail-date');
const detailVehicle = document.getElementById('detail-vehicle');
const detailPad = document.getElementById('detail-pad');
const detailMission = document.getElementById('detail-mission');
const compassSvg = document.getElementById('compass-svg');
const targetArrow = document.getElementById('target-arrow');
const compassError = document.getElementById('compass-error');
const compassErrorMsg = document.getElementById('compass-error-msg');
const requestPermissionBtn = document.getElementById('request-permission-btn');

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  buildCompassSvg();
  loadLaunches();
  refreshBtn.addEventListener('click', () => loadLaunches(true));
  backBtn.addEventListener('click', showList);
  requestPermissionBtn.addEventListener('click', requestOrientationPermission);
});

// ---- API & Data ----
async function loadLaunches(forceRefresh = false) {
  // Try cache first
  if (!forceRefresh) {
    const cached = loadFromCache();
    if (cached) {
      launches = cached;
      renderList();
      updateCacheStatus(false);
      // Background refresh if cache is old
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
      if (Date.now() - ts > CACHE_TTL) {
        fetchFromApi().catch(() => {});
      }
      return;
    }
  }

  listSpinner.classList.remove('hidden');
  launchList.querySelectorAll('.launch-card, .error-card').forEach(el => el.remove());

  try {
    await fetchFromApi();
  } catch (err) {
    console.error('Failed to fetch launches:', err);
    // If we have stale cache, use it
    const cached = loadFromCache();
    if (cached) {
      launches = cached;
      renderList();
      updateCacheStatus(true);
    } else {
      showListError(err.message);
    }
  }
}

async function fetchFromApi() {
  // Fetch upcoming launches from KSC and Cape Canaveral
  const url = `${API_BASE}/launch/upcoming/?location__ids=${KSC_LOCATION_IDS.join(',')}&limit=20&ordering=net`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();

  launches = data.results.map(parseLaunch);
  saveToCache(launches);
  listSpinner.classList.add('hidden');
  renderList();
  updateCacheStatus(false);
}

function parseLaunch(raw) {
  const pad = raw.pad || {};
  let padCoords = null;

  // Try to get coords from API data
  if (pad.latitude && pad.longitude) {
    padCoords = { lat: parseFloat(pad.latitude), lon: parseFloat(pad.longitude) };
  } else {
    // Fallback to known pad coordinates
    const padName = pad.name || '';
    for (const [key, coords] of Object.entries(PAD_COORDS)) {
      if (padName.includes(key)) {
        padCoords = coords;
        break;
      }
    }
    if (!padCoords) padCoords = PAD_COORDS['KSC'];
  }

  const status = raw.status || {};
  let statusClass = 'status-tbd';
  const abbrev = (status.abbrev || '').toUpperCase();
  if (abbrev === 'GO') statusClass = 'status-go';
  else if (abbrev === 'TBC') statusClass = 'status-tbc';
  else if (abbrev === 'HOLD' || abbrev === 'FAIL') statusClass = 'status-hold';

  return {
    id: raw.id,
    name: raw.name || 'Unknown Mission',
    net: raw.net, // ISO date string
    provider: raw.launch_service_provider?.name || 'Unknown Provider',
    vehicle: raw.rocket?.configuration?.full_name || raw.rocket?.configuration?.name || 'Unknown Vehicle',
    padName: pad.name || 'Unknown Pad',
    padCoords,
    statusText: status.abbrev || 'TBD',
    statusClass,
    missionDescription: raw.mission?.description || 'No mission description available.',
    missionType: raw.mission?.type || '',
  };
}

function saveToCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch (e) { /* quota exceeded — ignore */ }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function updateCacheStatus(stale) {
  const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
  if (!ts) { cacheStatus.textContent = ''; return; }
  const ago = timeSince(ts);
  cacheStatus.textContent = stale
    ? `Offline — showing cached data from ${ago} ago`
    : `Updated ${ago} ago`;
}

function timeSince(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ---- Render List ----
function renderList() {
  listSpinner.classList.add('hidden');
  launchList.querySelectorAll('.launch-card, .error-card').forEach(el => el.remove());

  if (!launches.length) {
    showListError('No upcoming launches found from KSC.');
    return;
  }

  launches.forEach(launch => {
    const card = document.createElement('div');
    card.className = 'launch-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const netDate = new Date(launch.net);
    const dateStr = netDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    const timeStr = netDate.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });

    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="mission-name">${esc(launch.name)}</div>
          <div class="provider">${esc(launch.provider)}</div>
        </div>
        <span class="status-badge ${launch.statusClass}">${esc(launch.statusText)}</span>
      </div>
      <div class="vehicle-info">${esc(launch.vehicle)}</div>
      <div class="pad-name">${esc(launch.padName)}</div>
      <div class="card-bottom">
        <div class="launch-date">${dateStr}<br>${timeStr}</div>
        <div class="countdown" data-net="${launch.net}"></div>
      </div>
    `;

    card.addEventListener('click', () => showCompass(launch));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') showCompass(launch);
    });

    launchList.appendChild(card);
  });

  updateListCountdowns();
  clearInterval(listCountdownInterval);
  listCountdownInterval = setInterval(updateListCountdowns, 1000);
}

function updateListCountdowns() {
  document.querySelectorAll('.countdown[data-net]').forEach(el => {
    const net = new Date(el.dataset.net);
    const diff = net - Date.now();
    if (diff <= 0) {
      el.textContent = 'LAUNCHED';
      el.classList.add('imminent');
    } else {
      el.textContent = formatCountdown(diff);
      if (diff < 3600000) el.classList.add('imminent');
      else el.classList.remove('imminent');
    }
  });
}

function showListError(msg) {
  listSpinner.classList.add('hidden');
  const div = document.createElement('div');
  div.className = 'error-card';
  div.innerHTML = `
    <h3>Unable to Load</h3>
    <p>${esc(msg)}</p>
    <button onclick="loadLaunches(true)">Retry</button>
  `;
  launchList.appendChild(div);
}

// ---- Compass View ----
function showCompass(launch) {
  selectedLaunch = launch;

  // Populate header & details
  compassMissionName.textContent = launch.name;
  compassProvider.textContent = launch.provider;
  detailDate.textContent = new Date(launch.net).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
  });
  detailVehicle.textContent = launch.vehicle;
  detailPad.textContent = launch.padName;
  detailMission.textContent = launch.missionDescription;

  // Start countdown
  updateCompassCountdown();
  clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCompassCountdown, 1000);

  // Start geolocation
  startGeolocation();

  // Start compass
  startCompass();

  // Switch views
  listView.classList.remove('active');
  listView.classList.add('leaving');
  compassView.classList.add('active');
  setTimeout(() => listView.classList.remove('leaving'), 350);
}

function showList() {
  selectedLaunch = null;
  clearInterval(countdownInterval);
  stopGeolocation();

  compassView.classList.remove('active');
  listView.classList.remove('leaving');
  listView.classList.add('active');
}

function updateCompassCountdown() {
  if (!selectedLaunch) return;
  const diff = new Date(selectedLaunch.net) - Date.now();
  if (diff <= 0) {
    countdownLabel.textContent = 'T+';
    countdownTimer.textContent = formatCountdown(Math.abs(diff));
  } else {
    countdownLabel.textContent = 'T-';
    countdownTimer.textContent = formatCountdown(diff);
  }
}

function formatCountdown(ms) {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ---- Geolocation ----
function startGeolocation() {
  if (!navigator.geolocation) {
    distanceDisplay.textContent = 'Geolocation not available';
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      updateBearing();
    },
    (err) => {
      console.warn('Geo error:', err);
      distanceDisplay.textContent = 'Location unavailable — showing bearing from KSC Visitor Center';
      // Default to KSC Visitor Complex
      userLat = 28.5244;
      userLon = -80.6818;
      updateBearing();
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function stopGeolocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// ---- Compass / Device Orientation ----
function startCompass() {
  compassError.classList.add('hidden');
  requestPermissionBtn.classList.add('hidden');

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ needs explicit permission
    requestPermissionBtn.classList.remove('hidden');
    compassErrorMsg.textContent = 'Tap the button to enable compass access.';
    compassError.classList.remove('hidden');
  } else if ('DeviceOrientationEvent' in window) {
    attachOrientationListener();
  } else {
    compassErrorMsg.textContent = 'Compass not supported on this device. Bearing shown is from your position to the pad.';
    compassError.classList.remove('hidden');
  }
}

function requestOrientationPermission() {
  DeviceOrientationEvent.requestPermission()
    .then(state => {
      if (state === 'granted') {
        attachOrientationListener();
        compassError.classList.add('hidden');
      } else {
        compassErrorMsg.textContent = 'Compass permission denied. The bearing angle is shown but the compass won\'t rotate.';
      }
    })
    .catch(err => {
      compassErrorMsg.textContent = 'Could not request compass permission.';
      console.error(err);
    });
}

function attachOrientationListener() {
  if (orientationListenerAttached) return;
  orientationListenerAttached = true;

  window.addEventListener('deviceorientation', (e) => {
    // webkitCompassHeading is iOS, alpha is Android (but inverted)
    if (e.webkitCompassHeading !== undefined) {
      compassHeading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
      // On Android, alpha=0 means North when using absolute orientation
      if (e.absolute) {
        compassHeading = (360 - e.alpha) % 360;
      } else {
        compassHeading = (360 - e.alpha) % 360;
      }
    }
    updateCompassRotation();
  }, true);
}

// ---- Bearing Calculation ----
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateBearing() {
  if (!selectedLaunch || userLat === null) return;

  const { lat, lon } = selectedLaunch.padCoords;
  const bearing = calculateBearing(userLat, userLon, lat, lon);
  const distance = calculateDistance(userLat, userLon, lat, lon);

  bearingDisplay.textContent = Math.round(bearing);

  if (distance < 1) {
    distanceDisplay.textContent = `${Math.round(distance * 1000)} m to pad`;
  } else {
    distanceDisplay.textContent = `${distance.toFixed(1)} km to pad (${(distance * 0.621371).toFixed(1)} mi)`;
  }

  updateCompassRotation();
}

function updateCompassRotation() {
  if (!selectedLaunch || userLat === null) return;

  const { lat, lon } = selectedLaunch.padCoords;
  const bearing = calculateBearing(userLat, userLon, lat, lon);

  if (compassHeading !== null) {
    // Rotate compass rose so N faces the actual north
    // Rotate target arrow to point at the pad
    const rotation = -compassHeading;
    compassSvg.style.transform = `rotate(${rotation}deg)`;

    // Target arrow points in the bearing direction relative to compass
    targetArrow.setAttribute('transform', `rotate(${bearing}, 150, 150)`);
  } else {
    // No compass: fix rose to north-up, rotate arrow to bearing
    compassSvg.style.transform = 'rotate(0deg)';
    targetArrow.setAttribute('transform', `rotate(${bearing}, 150, 150)`);
  }
}

// ---- Build Compass SVG ----
function buildCompassSvg() {
  const cardinals = document.getElementById('compass-cardinals');
  const ticks = document.getElementById('compass-ticks');
  const cx = 150, cy = 150, r = 130;

  // Cardinal & intercardinal directions
  const dirs = [
    { label: 'N', angle: 0, cls: 'north' },
    { label: 'NE', angle: 45 },
    { label: 'E', angle: 90 },
    { label: 'SE', angle: 135 },
    { label: 'S', angle: 180 },
    { label: 'SW', angle: 225 },
    { label: 'W', angle: 270 },
    { label: 'NW', angle: 315 },
  ];

  dirs.forEach(({ label, angle, cls }) => {
    const rad = (angle - 90) * Math.PI / 180;
    const labelR = r - 16;
    const x = cx + labelR * Math.cos(rad);
    const y = cy + labelR * Math.sin(rad);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    if (cls) text.setAttribute('class', cls);
    text.textContent = label;
    // Smaller font for intercardinals
    if (label.length === 2) {
      text.style.fontSize = '11px';
      text.style.fill = '#8892a8';
      text.style.fontWeight = '400';
    }
    cardinals.appendChild(text);
  });

  // Degree ticks
  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg - 90) * Math.PI / 180;
    const isMajor = deg % 30 === 0;
    const innerR = isMajor ? r - 30 : r - 26;
    const outerR = r - 22;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx + innerR * Math.cos(rad));
    line.setAttribute('y1', cy + innerR * Math.sin(rad));
    line.setAttribute('x2', cx + outerR * Math.cos(rad));
    line.setAttribute('y2', cy + outerR * Math.sin(rad));
    if (isMajor) line.setAttribute('class', 'major');
    ticks.appendChild(line);
  }
}

// ---- Utils ----
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Service Worker Registration ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
