const REFRESH_INTERVAL = 60;

let apiKey = '';
let factionId = '';
let warData = null;
let enemyMembers = [];
let activeTab = 'all';
let autoRefresh = false;
let countdownTimer = null;
let secondsLeft = REFRESH_INTERVAL;
let notificationsEnabled = false;
let previousStatuses = {};

// ── API ──────────────────────────────────────────────────────────────────────

async function tornFetch(endpoint) {
  const key = document.getElementById('api-key-input').value.trim();
  const res = await fetch(`https://api.torn.com/${endpoint}&key=${key}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.error || 'Torn API error');
  return data;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function loadData() {
  apiKey   = document.getElementById('api-key-input').value.trim();
  factionId = document.getElementById('faction-id-input').value.trim();

  if (!apiKey || !factionId) {
    setError('Please enter your API key and faction ID.');
    return;
  }

  setError('');
  setMainLoading('Fetching faction data…');

  try {
    const fData = await tornFetch(`faction/${factionId}?selections=basic,wars,members`);
    const myName = fData.name || 'Your Faction';

    let activeWar = null, enemyFactionId = null;
    if (fData.wars) {
      const wars = Object.values(fData.wars);
      const ongoing = wars.find(w => !w.end && w.factions);
      if (ongoing) {
        activeWar = ongoing;
        const fids = Object.keys(ongoing.factions || {});
        enemyFactionId = fids.find(id => id != factionId);
      }
    }

    if (!activeWar || !enemyFactionId) {
      setMainContent(renderNoWar(myName, fData));
      return;
    }

    setMainLoading('Loading enemy roster…');
    const enemyData = await tornFetch(`faction/${enemyFactionId}?selections=basic,members`);
    const enemyName = enemyData.name || 'Enemy Faction';
    const memberIds = Object.keys(enemyData.members || {}).slice(0, 50);

    setMainLoading(`Fetching ${memberIds.length} member statuses…`);
    const memberDetails = [];
    const chunks = chunkArray(memberIds, 5);

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async uid => {
        try {
          const u = await tornFetch(`user/${uid}?selections=profile,battlestats`);
          memberDetails.push({ id: uid, ...u });
        } catch {
          memberDetails.push({ id: uid, name: `Player ${uid}`, status: { state: 'Unknown' } });
        }
      }));
    }

    detectStatusChanges(memberDetails);
    enemyMembers = memberDetails;
    warData = { activeWar, myName, enemyName, enemyFactionId };

    document.getElementById('last-refresh-label').textContent = new Date().toLocaleTimeString();
    renderDashboard();

    if (autoRefresh) resetCountdown();

  } catch (e) {
    setError('Failed to load: ' + e.message + '. Check your API key and faction ID.');
    setMainContent('<div class="loading"><i class="ti ti-alert-circle"></i>No data loaded.</div>');
  }
}

// ── Status change detection ───────────────────────────────────────────────────

function detectStatusChanges(newMembers) {
  if (Object.keys(previousStatuses).length === 0) {
    newMembers.forEach(m => { previousStatuses[m.id] = m.status?.state || ''; });
    return;
  }
  const alerts = [];
  newMembers.forEach(m => {
    const prev = (previousStatuses[m.id] || '').toLowerCase();
    const curr = (m.status?.state || '').toLowerCase();
    const wasHosp = prev.includes('hospital');
    const isHosp  = curr.includes('hospital');
    const isOkay  = curr.includes('okay') || curr === 'ok';

    if (wasHosp && isOkay) {
      alerts.push(`<div class="alert-item"><i class="ti ti-target"></i> <strong>${m.name}</strong> left hospital — hittable now!</div>`);
      if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('War Alert', { body: `${m.name} left hospital — attack now!` });
      }
    }
    if (!wasHosp && isHosp) {
      alerts.push(`<div class="alert-item"><i class="ti ti-heart-broken"></i> <strong>${m.name}</strong> entered hospital</div>`);
    }
    previousStatuses[m.id] = m.status?.state || '';
  });

  const alertArea = document.getElementById('alert-area');
  if (alerts.length) {
    alertArea.innerHTML = `
      <div class="alert-panel">
        <div class="alert-title"><i class="ti ti-bell-ringing"></i> Status changes detected</div>
        ${alerts.join('')}
      </div>`;
    setTimeout(() => { alertArea.innerHTML = ''; }, 30000);
  }
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function toggleAutoRefresh() {
  autoRefresh = !autoRefresh;
  const btn = document.getElementById('autorefresh-btn');
  const bar = document.getElementById('refresh-bar');

  if (autoRefresh) {
    btn.classList.add('btn-active');
    btn.innerHTML = '<i class="ti ti-player-pause"></i> Auto-refresh on';
    bar.style.display = 'flex';
    resetCountdown();
  } else {
    btn.classList.remove('btn-active');
    btn.innerHTML = '<i class="ti ti-player-play"></i> Auto-refresh';
    bar.style.display = 'none';
    clearInterval(countdownTimer);
  }
}

function resetCountdown() {
  clearInterval(countdownTimer);
  secondsLeft = REFRESH_INTERVAL;
  updateCountdownUI();
  countdownTimer = setInterval(() => {
    secondsLeft--;
    updateCountdownUI();
    if (secondsLeft <= 0) { secondsLeft = REFRESH_INTERVAL; loadData(); }
  }, 1000);
}

function updateCountdownUI() {
  const label = document.getElementById('refresh-label');
  const fill  = document.getElementById('progress-fill');
  if (label) label.textContent = `Next refresh in ${secondsLeft}s`;
  if (fill)  fill.style.width  = Math.round((secondsLeft / REFRESH_INTERVAL) * 100) + '%';
}

// ── Notifications ─────────────────────────────────────────────────────────────

function toggleNotifications() {
  if (!('Notification' in window)) { alert('Notifications are not supported in this browser.'); return; }
  if (notificationsEnabled) {
    notificationsEnabled = false;
    document.getElementById('notify-btn').innerHTML = '<i class="ti ti-bell"></i> Alerts off';
    document.getElementById('notify-btn').classList.remove('btn-active');
  } else {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        notificationsEnabled = true;
        document.getElementById('notify-btn').innerHTML = '<i class="ti ti-bell-ringing"></i> Alerts on';
        document.getElementById('notify-btn').classList.add('btn-active');
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusClass(state) {
  if (!state) return 's-offline';
  const s = state.toLowerCase();
  if (s.includes('hospital')) return 's-hosp';
  if (s.includes('okay') || s === 'ok') return 's-okay';
  if (s.includes('travel')) return 's-travel';
  if (s.includes('jail')) return 's-jail';
  return 's-offline';
}

function getStatusLabel(m) {
  const state = (m.status?.state || 'Unknown').toLowerCase();
  if (state.includes('hospital')) return 'Hospital';
  if (state.includes('okay') || state === 'ok') return 'Hittable';
  if (state.includes('travel')) return 'Traveling';
  if (state.includes('jail')) return 'Jailed';
  return m.status?.state || 'Unknown';
}

function formatTimer(until) {
  if (!until) return '<span class="timer-grey">—</span>';
  const diff = until - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '<span class="timer-green">Out now!</span>';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const str = h > 0
    ? `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`
    : `${m}m ${String(s).padStart(2,'0')}s`;
  return `<span class="${diff <= 300 ? 'timer-green' : 'timer-red'}">${str}</span>`;
}

function formatBS(val) {
  if (!val) return '—';
  if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
  if (val >= 1000) return Math.round(val / 1000) + 'K';
  return Math.round(val).toString();
}

function formatLastAction(ts) {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderDashboard() {
  const { activeWar, myName, enemyName, enemyFactionId } = warData;
  const warFactions = activeWar.factions || {};
  const myScore    = warFactions[factionId]?.score || 0;
  const enemyScore = warFactions[enemyFactionId]?.score || 0;
  const total      = myScore + enemyScore || 1;
  const myPct      = Math.round((myScore / total) * 100);
  const enemyPct   = 100 - myPct;

  const hospMembers = enemyMembers.filter(m => m.status?.state?.toLowerCase().includes('hospital'));
  const hittable    = enemyMembers.filter(m => { const s = (m.status?.state||'').toLowerCase(); return s.includes('okay') || s === 'ok'; });
  const traveling   = enemyMembers.filter(m => m.status?.state?.toLowerCase().includes('travel'));
  const releasing   = enemyMembers.filter(m => { const u = m.status?.until; if (!u) return false; const d = u - Math.floor(Date.now()/1000); return d > 0 && d <= 300; });

  let filtered = { all: enemyMembers, hittable, releasing, hosp: hospMembers }[activeTab] || enemyMembers;
  filtered = [...filtered].sort((a, b) => {
    const aHit = getStatusLabel(a) === 'Hittable';
    const bHit = getStatusLabel(b) === 'Hittable';
    if (aHit && !bHit) return -1;
    if (!aHit && bHit) return 1;
    const au = a.status?.until || 0, bu = b.status?.until || 0;
    if (au && bu) return au - bu;
    return 0;
  });

  const rows = filtered.map(m => {
    const sc    = getStatusClass(m.status?.state);
    const label = getStatusLabel(m);
    const until = m.status?.until || null;
    const bs    = m.battlestats || {};
    const total = (bs.strength||0) + (bs.speed||0) + (bs.defense||0) + (bs.dexterity||0);
    const isHit = label === 'Hittable';
    const diff  = until ? until - Math.floor(Date.now()/1000) : Infinity;
    const isReleasing = diff > 0 && diff <= 300;
    const rowClass = isHit ? 'hittable-row' : isReleasing ? 'releasing-row' : '';
    return `<tr class="${rowClass}" id="row-${m.id}">
      <td><a href="https://www.torn.com/profiles.php?XID=${m.id}" target="_blank" rel="noopener">${m.name || m.id}</a></td>
      <td><span class="status-pill ${sc}">${label}</span></td>
      <td id="timer-${m.id}">${formatTimer(until)}</td>
      <td>${formatBS(total)}</td>
      <td>${formatLastAction(m.last_action?.timestamp)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:1.5rem">No members in this view</td></tr>`;

  setMainContent(`
    <div class="faction-header">
      <i class="ti ti-swords"></i>
      <div style="flex:1">
        <div class="faction-name">${myName} <span style="color:var(--text2);font-weight:400;font-size:12px">vs</span> ${enemyName}</div>
        <div class="faction-meta">Enemy faction ID: ${enemyFactionId}</div>
      </div>
      <span class="badge badge-war">War active</span>
    </div>

    <div class="score-bar-wrap">
      <span class="score-label mine">${myScore} pts</span>
      <div class="score-track">
        <div class="score-my" style="width:${myPct}%"></div>
        <div class="score-enemy" style="width:${enemyPct}%"></div>
      </div>
      <span class="score-label enemy">${enemyScore} pts</span>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total enemies</div>
        <div class="stat-value">${enemyMembers.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><i class="ti ti-target"></i> Hittable</div>
        <div class="stat-value" style="color:var(--green-text)">${hittable.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><i class="ti ti-heart-broken"></i> Hospital</div>
        <div class="stat-value" style="color:var(--red-text)">${hospMembers.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><i class="ti ti-clock-bolt"></i> Releasing &lt;5m</div>
        <div class="stat-value" style="color:var(--amber-text)">${releasing.length}</div>
        <div class="stat-sub">Attack ready soon</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><i class="ti ti-plane"></i> Traveling</div>
        <div class="stat-value" style="color:var(--blue-text)">${traveling.length}</div>
      </div>
    </div>

    <div class="tab-row">
      <div class="tab ${activeTab==='all'?'active':''}" onclick="setTab('all')">All (${enemyMembers.length})</div>
      <div class="tab ${activeTab==='hittable'?'active':''}" onclick="setTab('hittable')">Hittable (${hittable.length})</div>
      <div class="tab ${activeTab==='releasing'?'active':''}" onclick="setTab('releasing')">Releasing &lt;5m (${releasing.length})</div>
      <div class="tab ${activeTab==='hosp'?'active':''}" onclick="setTab('hosp')">Hospital (${hospMembers.length})</div>
    </div>

    <div class="controls">
      <input type="text" id="search-box" placeholder="Search player name…" oninput="filterTable()" />
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:24%">Player</th>
            <th style="width:14%">Status</th>
            <th style="width:22%">Hospital timer</th>
            <th style="width:16%">Total stats</th>
            <th style="width:16%">Last active</th>
          </tr>
        </thead>
        <tbody id="member-tbody">${rows}</tbody>
      </table>
    </div>
    <p class="table-note">Green rows = hittable now &middot; Orange rows = releasing within 5 min &middot; Stats visible only if member made them public</p>
  `);

  startLiveTimers();
}

function startLiveTimers() {
  if (window._timerLoop) clearInterval(window._timerLoop);
  window._timerLoop = setInterval(() => {
    enemyMembers.forEach(m => {
      const until = m.status?.until;
      if (!until) return;
      const el  = document.getElementById(`timer-${m.id}`);
      const row = document.getElementById(`row-${m.id}`);
      if (el) el.innerHTML = formatTimer(until);
      if (row) {
        const diff = until - Math.floor(Date.now()/1000);
        if (diff <= 0) {
          row.classList.remove('releasing-row');
          row.classList.add('hittable-row');
        } else if (diff <= 300) {
          row.classList.add('releasing-row');
        }
      }
    });
  }, 1000);
}

function renderNoWar(myName, fData) {
  const mCount = Object.keys(fData.members || {}).length;
  return `
    <div class="faction-header">
      <i class="ti ti-shield" style="color:var(--text2)"></i>
      <div style="flex:1">
        <div class="faction-name">${myName}</div>
        <div class="faction-meta">ID: ${factionId} &middot; ${mCount} members</div>
      </div>
      <span class="badge badge-ok">No active war</span>
    </div>
    <div class="no-war">
      <i class="ti ti-shield-off"></i>
      <h3>No active war detected</h3>
      <p>Your faction is not currently in a ranked war. Check back when a war begins.</p>
      <button class="btn" onclick="loadData()"><i class="ti ti-refresh"></i> Check again</button>
    </div>`;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setTab(tab)  { activeTab = tab; renderDashboard(); }
function setError(msg) {
  document.getElementById('error-area').innerHTML = msg
    ? `<div class="error-box"><i class="ti ti-alert-circle"></i>${msg}</div>`
    : '';
}
function setMainLoading(msg) {
  document.getElementById('main-content').innerHTML =
    `<div class="loading"><i class="ti ti-loader"></i>${msg}</div>`;
}
function setMainContent(html) { document.getElementById('main-content').innerHTML = html; }
function filterTable() {
  const q = (document.getElementById('search-box')?.value || '').toLowerCase();
  document.querySelectorAll('#member-tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
