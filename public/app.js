/* Wheresmitz front end: shared map + feed, and the "report a mitz" upload flow. */
(() => {
  const $ = (id) => document.getElementById(id);
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const HEIC2ANY = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

  let sightings = [];
  const markers = new Map(); // id -> L.Marker

  // ---------- formatting ----------
  const fmtCoord = (lat, lng) =>
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tiltFor = (id) => ((parseInt(id.slice(0, 4), 16) % 15) - 7) + 'deg';
  const sourceBadge = (s) => s.source === 'photo'
    ? '<span class="badge badge-gps" title="Location read from the photo\'s GPS metadata">GPS from photo</span>'
    : '<span class="badge badge-pin" title="The uploader placed this pin by hand">Pinned by hand</span>';

  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- main map ----------
  const map = L.map('map', { worldCopyJump: true, zoomControl: true, minZoom: 2 }).setView([25, 0], 2);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    // Keep off-screen pins attached: when a tall popup auto-pans its pin out of view
    // (short map on phones), removing the pin would close the popup instantly.
    removeOutsideVisibleBounds: false,
    maxClusterRadius: 56,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 46 : n < 100 ? 54 : 62;
      return L.divIcon({ html: `<div class="stack">${n}</div>`, className: 'stack-marker', iconSize: [size, size] });
    },
  });
  map.addLayer(cluster);

  function popupHtml(s) {
    const when = fmtDate(s.takenAt) ? `Taken ${fmtDate(s.takenAt)}` : `Added ${fmtDate(s.uploadedAt)}`;
    return `
      <button class="pop-img" type="button" data-view="${s.id}" aria-label="View full photo">
        <img src="${s.photo}" alt="Mitz sticker${s.place ? ' at ' + esc(s.place) : ''}" loading="lazy">
      </button>
      ${s.place ? `<p class="pop-place">${esc(s.place)}</p>` : '<p class="pop-place">Somewhere out there</p>'}
      ${s.caption ? `<p class="pop-cap">${esc(s.caption)}</p>` : ''}
      <div class="pop-meta">
        ${sourceBadge(s)}
        <span>${when}</span>
        ${s.spotter ? `<span>by ${esc(s.spotter)}</span>` : ''}
        <span class="coord">${fmtCoord(s.lat, s.lng)}</span>
      </div>`;
  }

  function addMarker(s) {
    const icon = L.divIcon({
      className: 'sticker-marker',
      html: `<div class="sticker" style="background-image:url('${s.thumb}');--tilt:${tiltFor(s.id)}"></div>`,
      iconSize: [52, 52],
      iconAnchor: [26, 60],
      popupAnchor: [0, -58],
    });
    const m = L.marker([s.lat, s.lng], { icon, title: s.place || 'Mitz sighting', riseOnHover: true });
    m.bindPopup(() => popupHtml(s), { maxWidth: 264, minWidth: 200, autoPanPadding: [12, 12] });
    m.on('popupopen', () => setActive(s.id));
    m.on('popupclose', () => setActive(null));
    markers.set(s.id, m);
    return m;
  }

  function setActive(id) {
    document.querySelectorAll('.card.is-active').forEach((el) => el.classList.remove('is-active'));
    if (id) document.querySelector(`.card[data-id="${id}"]`)?.classList.add('is-active');
  }

  function focusSighting(id) {
    const m = markers.get(id);
    if (!m) return;
    cluster.zoomToShowLayer(m, () => {
      map.panTo(m.getLatLng());
      m.openPopup();
    });
  }

  // ---------- feed + stats ----------
  function renderFeed() {
    const list = $('feed-list');
    list.replaceChildren();
    if (!sightings.length) {
      const li = document.createElement('li');
      li.className = 'feed-empty';
      li.textContent = 'Sightings will show up here as people add them.';
      list.append(li);
    }
    for (const s of sightings) {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="card" type="button" data-id="${s.id}">
          <img class="card-thumb" src="${s.thumb}" alt="" loading="lazy">
          <span class="card-body">
            <span class="card-place">${esc(s.place || 'Unnamed spot')}</span>
            <span class="card-meta">
              <span>${esc(fmtDate(s.takenAt) || fmtDate(s.uploadedAt))}${s.spotter ? ' · ' + esc(s.spotter) : ''}</span>
              <span class="coord">${fmtCoord(s.lat, s.lng)}</span>
            </span>
          </span>
        </button>`;
      list.append(li);
    }
  }

  function renderStats() {
    $('stat-count').textContent = sightings.length.toLocaleString();
    const names = new Set(sightings.map((s) => s.spotter.trim().toLowerCase()).filter(Boolean));
    $('stat-spotters').textContent = names.size.toLocaleString();
    let spread = 0;
    const pts = sightings.slice(0, 1500);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) spread = Math.max(spread, km(pts[i], pts[j]));
    $('stat-spread').textContent = `${Math.round(spread).toLocaleString()} km`;
    $('stat-spread').title = 'Distance between the two sightings farthest apart';
    $('map-empty').hidden = sightings.length > 0;
  }

  async function load() {
    try {
      const res = await fetch('/api/sightings');
      sightings = await res.json();
    } catch {
      toast('Could not load sightings. Refresh to try again.');
      sightings = [];
    }
    cluster.clearLayers();
    markers.clear();
    cluster.addLayers(sightings.map(addMarker));
    renderFeed();
    renderStats();
    if (sightings.length) {
      map.fitBounds(L.latLngBounds(sightings.map((s) => [s.lat, s.lng])).pad(0.2), { maxZoom: 13 });
    }
  }

  $('feed-list').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    focusSighting(card.dataset.id);
    if (window.matchMedia('(max-width: 860px)').matches) $('map').scrollIntoView({ behavior: 'smooth' });
  });

  // ---------- full-size viewer ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    const s = sightings.find((x) => x.id === btn.dataset.view);
    if (!s) return;
    $('viewer-img').src = s.photo;
    $('viewer-img').alt = `Mitz sticker${s.place ? ' at ' + s.place : ''}`;
    $('viewer-cap').textContent = [s.place, s.caption].filter(Boolean).join(' · ');
    $('viewer').showModal();
  });
  $('close-viewer').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('click', (e) => { if (e.target === $('viewer')) $('viewer').close(); });

  // ---------- upload flow ----------
  const dialog = $('upload-dialog');
  const form = $('upload-form');
  const state = { file: null, lat: null, lng: null, source: null, takenAt: null };
  let pickMap = null, pickMarker = null;

  function resetUpload() {
    form.reset();
    Object.assign(state, { file: null, lat: null, lng: null, source: null, takenAt: null });
    const prev = $('photo-preview');
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.removeAttribute('src');
    prev.hidden = true;
    $('drop-copy').hidden = false;
    $('drop').classList.remove('has-photo');
    $('loc-block').hidden = true;
    $('fields').hidden = true;
    $('form-error').hidden = true;
    $('submit-upload').disabled = true;
    $('submit-upload').textContent = 'Pin it';
    if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  }

  function openUpload() {
    resetUpload();
    dialog.showModal();
  }
  $('open-upload').addEventListener('click', openUpload);
  document.querySelectorAll('[data-open-upload]').forEach((b) => b.addEventListener('click', openUpload));
  $('close-upload').addEventListener('click', () => dialog.close());
  $('cancel-upload').addEventListener('click', () => dialog.close());

  function showError(msg) {
    $('form-error').textContent = msg;
    $('form-error').hidden = !msg;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script'));
      document.head.append(s);
    });
  }

  const isHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

  async function handleFile(file) {
    if (!file) return;
    showError('');
    if (file.size > 25 * 1024 * 1024) return showError('Photos must be under 25 MB.');
    if (!/^image\//.test(file.type) && !isHeic(file)) return showError('That file is not a photo. Choose a JPEG, PNG, WebP or HEIC image.');

    $('drop-copy').hidden = false;
    $('drop-copy').querySelector('strong').textContent = 'Reading photo…';

    // 1. Read GPS + capture time from the original file, before any conversion.
    let gps = null, taken = null;
    try {
      gps = await exifr.gps(file);
      const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
      taken = tags?.DateTimeOriginal || tags?.CreateDate || null;
    } catch { /* no metadata */ }

    // 2. HEIC (iPhone) photos don't display in most browsers: convert to JPEG.
    let upload = file;
    if (isHeic(file)) {
      try {
        if (!window.heic2any) await loadScript(HEIC2ANY);
        const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
        upload = new File([Array.isArray(out) ? out[0] : out], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' });
      } catch {
        $('drop-copy').querySelector('strong').textContent = 'Choose a photo of the mitz';
        return showError('This HEIC photo could not be converted. Export it as a JPEG and try again.');
      }
    }

    state.file = upload;
    state.takenAt = taken instanceof Date && !isNaN(taken) ? taken.toISOString() : null;

    const prev = $('photo-preview');
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.src = URL.createObjectURL(upload);
    prev.hidden = false;
    $('drop-copy').hidden = true;
    $('drop').classList.add('has-photo');
    $('fields').hidden = false;
    $('loc-block').hidden = false;

    const hasGps = gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && !(gps.latitude === 0 && gps.longitude === 0);
    setupPickMap(hasGps ? [gps.latitude, gps.longitude] : null);
  }

  function setLocation(lat, lng, source) {
    state.lat = lat; state.lng = lng; state.source = source;
    const status = $('loc-status');
    status.innerHTML = source === 'photo'
      ? `<span class="badge badge-gps">GPS from photo</span><span class="coord">${fmtCoord(lat, lng)}</span>`
      : `<span class="badge badge-pin">Pinned by hand</span><span class="coord">${fmtCoord(lat, lng)}</span>`;
    $('loc-hint').textContent = 'Drag the pin if it\'s off.';
    $('pick-map').classList.remove('needs-pin');
    $('submit-upload').disabled = false;
    fillPlace(lat, lng);
  }

  function placePin(latlng, source) {
    if (!pickMarker) {
      pickMarker = L.marker(latlng, { draggable: true, autoPan: true }).addTo(pickMap);
      pickMarker.on('dragend', () => {
        const p = pickMarker.getLatLng().wrap();
        setLocation(p.lat, p.lng, 'pin');
      });
    } else {
      pickMarker.setLatLng(latlng);
    }
    const p = L.latLng(latlng).wrap();
    setLocation(p.lat, p.lng, source);
  }

  function setupPickMap(center) {
    if (!pickMap) {
      pickMap = L.map('pick-map', { worldCopyJump: true }).setView([25, 0], 2);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(pickMap);
      pickMap.on('click', (e) => placePin(e.latlng, 'pin'));
    }
    // The map was hidden while it initialised; let it measure itself again.
    requestAnimationFrame(() => {
      pickMap.invalidateSize();
      if (center) {
        pickMap.setView(center, 16);
        placePin(center, 'photo');
      } else {
        pickMap.setView(map.getCenter(), Math.max(map.getZoom(), 3));
        $('loc-status').innerHTML = 'No location in this photo.';
        $('loc-hint').textContent = 'Tap the map where you found the mitz to drop a pin. Zoom in for accuracy.';
        $('pick-map').classList.add('needs-pin');
        $('submit-upload').disabled = true;
      }
    });
  }

  // Best-effort place name from OpenStreetMap; only fills an empty field.
  let geoReq = 0;
  async function fillPlace(lat, lng) {
    const input = $('place-input');
    if (input.value && !input.dataset.auto) return;
    const ticket = ++geoReq;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`,
        { headers: { 'Accept-Language': navigator.language || 'en' } });
      const j = await res.json();
      if (ticket !== geoReq) return;
      const a = j.address || {};
      const local = a.road || a.pedestrian || a.park || a.neighbourhood || a.suburb || j.name;
      const town = a.city || a.town || a.village || a.hamlet || a.county;
      const label = [local, town, a.country].filter(Boolean).join(', ');
      if (label && (!input.value || input.dataset.auto)) {
        input.value = label;
        input.dataset.auto = '1';
      }
    } catch { /* offline or rate-limited: leave it blank */ }
  }
  $('place-input').addEventListener('input', (e) => { delete e.target.dataset.auto; });

  $('photo-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });

  // Remember the spotter's name for next time.
  try { $('spotter-input').value = localStorage.getItem('wheresmitz.spotter') || ''; } catch {}

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.file) return showError('Choose a photo first.');
    if (state.lat == null) return showError('Drop a pin on the map to say where the mitz is.');

    const fd = new FormData();
    fd.append('lat', state.lat);
    fd.append('lng', state.lng);
    fd.append('source', state.source);
    if (state.takenAt) fd.append('takenAt', state.takenAt);
    fd.append('place', $('place-input').value);
    fd.append('spotter', $('spotter-input').value);
    fd.append('caption', $('caption-input').value);
    fd.append('photo', state.file, state.file.name || 'mitz.jpg'); // file last so fields parse first

    const btn = $('submit-upload');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    showError('');
    try {
      const res = await fetch('/api/sightings', { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed. Try again.');
      try { localStorage.setItem('wheresmitz.spotter', $('spotter-input').value.trim()); } catch {}
      sightings.unshift(body);
      cluster.addLayer(addMarker(body));
      renderFeed();
      renderStats();
      dialog.close();
      toast('Pinned. Thanks for spotting a mitz!');
      focusSighting(body.id);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Pin it';
    }
  });

  load();
})();
