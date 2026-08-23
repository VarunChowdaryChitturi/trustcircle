// public/app.js — plain JS, no build step. Talks to our own /api routes,
// which in turn run parameterised Cypher against CognoDB.

const $ = (sel) => document.querySelector(sel);

async function checkHealth() {
  const el = $('#dbStatus');
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.ok) {
      el.textContent = '● connected to CognoDB';
      el.className = 'db-status ok';
    } else {
      throw new Error(data.error || 'unreachable');
    }
  } catch (err) {
    el.textContent = '● database unreachable';
    el.className = 'db-status error';
  }
}

async function loadPeopleAndServices() {
  const [people, services] = await Promise.all([
    fetch('/api/people').then(r => r.json()),
    fetch('/api/services').then(r => r.json()),
  ]);

  const fill = (sel, items, labelFn) => {
    const el = $(sel);
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id ?? item;
      opt.textContent = labelFn(item);
      el.appendChild(opt);
    });
  };

  fill('#personSelect', people, p => p.name);
  fill('#fromPerson', people, p => p.name);
  fill('#toPerson', people, p => p.name);
  if (people.length > 1) $('#toPerson').selectedIndex = 1;

  services.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    $('#serviceSelect').appendChild(opt);
  });
}

function renderLoading(container) {
  container.innerHTML = '<div class="loading-state">Searching the trust network…</div>';
}

function renderError(container, message) {
  container.innerHTML = `<div class="error-state">Couldn't load results: ${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderRecommendations(container, items) {
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No one in reach has recommended anyone for this yet. Try widening your search or picking a different service.</div>';
    return;
  }
  container.innerHTML = items.map(p => `
    <div class="card">
      <div class="card-top">
        <h3>${escapeHtml(p.name)}</h3>
        <span class="score">trust ${p.trustScore}</span>
      </div>
      <div class="tags">${p.services.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>
      ${p.neighborhood ? `<div class="hint">${escapeHtml(p.neighborhood)}</div>` : ''}
      <div class="recommended-by">Recommended by <b>${p.recommenderCount}</b> ${p.recommenderCount === 1 ? 'person' : 'people'} in your network: ${escapeHtml(p.recommendedBy.slice(0, 3).join(', '))}${p.recommendedBy.length > 3 ? '…' : ''}</div>
    </div>
  `).join('');
}

function renderGems(container, items) {
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No hidden gems surfaced for this network yet.</div>';
    return;
  }
  container.innerHTML = items.map(p => `
    <div class="card">
      <div class="card-top">
        <h3>${escapeHtml(p.name)}</h3>
        <span class="score">★ ${p.avgRating}</span>
      </div>
      <div class="tags">${p.services.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>
    </div>
  `).join('');
}

async function runSearch() {
  const personId = $('#personSelect').value;
  const service = $('#serviceSelect').value;
  const hops = $('#hopsRange').value;
  const resultsEl = $('#results');
  const gemsEl = $('#gems');

  renderLoading(resultsEl);
  renderLoading(gemsEl);

  try {
    const params = new URLSearchParams({ personId, maxHops: hops });
    if (service) params.set('service', service);
    const res = await fetch('/api/recommendations?' + params.toString());
    if (!res.ok) throw new Error((await res.json()).error);
    renderRecommendations(resultsEl, await res.json());
  } catch (err) {
    renderError(resultsEl, err.message);
  }

  try {
    const res = await fetch('/api/hidden-gems?personId=' + encodeURIComponent(personId));
    if (!res.ok) throw new Error((await res.json()).error);
    renderGems(gemsEl, await res.json());
  } catch (err) {
    renderError(gemsEl, err.message);
  }
}

async function tracePath() {
  const fromId = $('#fromPerson').value;
  const toId = $('#toPerson').value;
  const el = $('#pathResult');
  el.innerHTML = '<div class="loading-state">Tracing…</div>';

  try {
    const res = await fetch(`/api/trust-path?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`);
    if (!res.ok) throw new Error((await res.json()).error);
    const data = await res.json();
    if (!data.connected) {
      el.innerHTML = '<div class="empty-state">No trust path found between these two people.</div>';
      return;
    }
    el.innerHTML = `
      <span class="hops-badge">${data.hops} hop${data.hops === 1 ? '' : 's'}</span>
      <div class="path-chain">
        ${data.names.map((n, i) => `${i > 0 ? '<span class="path-link">trusts →</span>' : ''}<span class="path-node">${escapeHtml(n)}</span>`).join('')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-state">Couldn't trace a path: ${escapeHtml(err.message)}</div>`;
  }
}

$('#hopsRange').addEventListener('input', (e) => $('#hopsValue').textContent = e.target.value);
$('#searchBtn').addEventListener('click', runSearch);
$('#pathBtn').addEventListener('click', tracePath);

(async function init() {
  await checkHealth();
  await loadPeopleAndServices();
})();
