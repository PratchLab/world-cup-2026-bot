
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const mainContent = document.getElementById('main-content');
const groupNameDisplay = document.getElementById('groupNameDisplay');

let currentGroupId = localStorage.getItem('groupId');
let currentPassword = localStorage.getItem('password');
let userPredictionsData = {};

async function apiFetch(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(endpoint, options);
  return res.json();
}

async function login() {
  const pwd = document.getElementById('passwordInput').value.trim();
  const res = await apiFetch('/api/login', 'POST', { password: pwd });
  
  if (res.success) {
    localStorage.setItem('groupId', res.groupId);
    localStorage.setItem('password', pwd);
    currentGroupId = res.groupId;
    currentPassword = pwd;
    groupNameDisplay.innerText = res.groupName;
    loginContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    loadPage('ranking');
  } else {
    document.getElementById('loginError').classList.remove('hidden');
  }
}

document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

document.querySelectorAll('nav a').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('nav a').forEach(nav => nav.classList.remove('active'));
    e.target.classList.add('active');
    loadPage(e.target.dataset.page);
  });
});

async function loadPage(page) {
  mainContent.innerHTML = '<div class="card"><p>Loading...</p></div>';
  if (page === 'ranking') await renderRanking();
  else if (page === 'schedule') await renderSchedule();
  else if (page === 'standings') await renderStandings();
  else if (page === 'news') await renderNews();
}

async function renderRanking() {
  const res = await apiFetch(`/api/group/${currentGroupId}/rank`);
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading ranking</p>';
  
  userPredictionsData = res.userPredictions;
  
  let html = '<div class="card"><h2>🏆 Leaderboard</h2><div class="table-responsive"><table>';
  html += '<thead><tr><th>#</th><th>Name</th><th>Points</th><th title="ทายสกอร์ถูกเป๊ะ (+3)">S &#127919;</th><th title="ทายผลถูก แต่สกอร์ไม่ตรง (+1)">R &#9989;</th><th title="ทายผิดหมด (+0)">X &#10060;</th></tr></thead><tbody>';

  
  res.leaderboard.forEach((u, i) => {
    html += `<tr class="clickable" onclick="showUserPredictions('${u.displayName}')">
      <td>${i + 1}</td>
      <td><strong>${u.displayName}</strong></td>
      <td>${u.points}</td>
      <td style="color:#10b981;font-weight:600">${u.w}</td>
      <td>${u.d}</td>
      <td style="color:#64748b">${u.l}</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';
  html += '<div id="userPredContainer"></div>';
  mainContent.innerHTML = html;
}

window.showUserPredictions = function(displayName) {
  const container = document.getElementById('userPredContainer');
  const userId = Object.keys(userPredictionsData).find(id => userPredictionsData[id][0]?.displayName === displayName || true);
  // Actually we need userId mapping, let's just find by finding in the array.
  // Wait, userPredictions uses userId as key.
  let preds = null;
  for (const id in userPredictionsData) {
    // hack: just take the first one or we should pass userId.
    if (userPredictionsData[id].some(p => true)) {
       // Since I didn't save displayName in userPredictions array directly, I will pass userId in the next fix.
    }
  }
};

async function renderSchedule() {

  const res = await apiFetch('/api/matches');
  if (!res.matches) return mainContent.innerHTML = '<div class="card"><p class="error">ไม่สามารถโหลดตารางแข่งได้</p></div>';

  const matches = res.matches;
  const now = new Date();

  // Group by stage/round label
  const grouped = {};
  matches.forEach(m => {
    const label = m.stage || 'Group Stage';
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(m);
  });

  let html = '<div class="card"><h2>📅 Schedule & Results</h2>';

  Object.keys(grouped).forEach(stage => {
    html += `<h3 style="color:var(--text-muted);margin:20px 0 8px">${stage}</h3>`;
    grouped[stage].forEach(m => {
      const matchTime = m.startTime ? new Date(m.startTime) : null;
      const timeStr = matchTime ? matchTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
      const isPast = m.status === 'FT';
      const isLive = m.status === '1H' || m.status === '2H' || m.status === 'HT' || m.status === 'LIVE';
      const statusBadge = isPast
        ? `<span class="badge badge-neutral">FT</span>`
        : isLive
          ? `<span class="badge badge-success" style="animation:pulse 1s infinite">🔴 LIVE</span>`
          : `<span class="badge badge-neutral">⏰ ${timeStr}</span>`;
      const score = isPast || isLive
        ? `<strong style="font-size:18px">${m.homeScore ?? 0} - ${m.awayScore ?? 0}</strong>`
        : `<span style="color:var(--text-muted)">vs</span>`;

      html += `
        <div class="match-header" style="cursor:default">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span style="min-width:130px;font-weight:600">${m.homeTeam}</span>
              ${score}
              <span style="min-width:130px;font-weight:600">${m.awayTeam}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted)">${timeStr}</div>
          </div>
          <div>${statusBadge}</div>
        </div>`;
    });
  });

  html += '</div>';
  mainContent.innerHTML = html;
}

async function renderStandings() {
  const res = await apiFetch('/api/standings');
  if (!res.standings || res.standings.length === 0) {
    return mainContent.innerHTML = '<div class="card"><p style="color:var(--text-muted)">ยังไม่มีข้อมูลตารางคะแนน</p></div>';
  }

  let html = '<div class="card"><h2>🌍 WC Standings — Group Stage</h2>';

  res.standings.forEach(group => {
    if (!group || group.length === 0) return;
    const groupName = group[0]?.group || 'Group';
    html += `<h3 style="color:var(--primary);margin:20px 0 8px">${groupName}</h3>
      <div class="table-responsive"><table>
        <thead><tr>
          <th>#</th><th>ทีม</th>
          <th title="แข่ง">P</th>
          <th title="ชนะ" style="color:#10b981">W</th>
          <th title="เสมอ">D</th>
          <th title="แพ้" style="color:#ef4444">L</th>
          <th title="ประตูได้">GF</th>
          <th title="ประตูเสีย">GA</th>
          <th title="ผลต่างประตู">GD</th>
          <th title="คะแนน"><strong>Pts</strong></th>
        </tr></thead><tbody>`;

    group.forEach((team, idx) => {
      const s = team.all;
      const gd = s.goals.for - s.goals.against;
      const qualify = idx < 2 ? 'background:rgba(59,130,246,0.1)' : '';
      html += `<tr style="${qualify}">
        <td>${team.rank}</td>
        <td><strong>${team.team.name}</strong></td>
        <td>${s.played}</td>
        <td style="color:#10b981">${s.win}</td>
        <td>${s.draw}</td>
        <td style="color:#ef4444">${s.lose}</td>
        <td>${s.goals.for}</td>
        <td>${s.goals.against}</td>
        <td>${gd >= 0 ? '+' : ''}${gd}</td>
        <td><strong>${team.points}</strong></td>
      </tr>`;
    });

    html += '</tbody></table></div>';
  });

  html += '<p style="font-size:12px;color:var(--text-muted);margin-top:16px">🔵 = ผ่านเข้ารอบต่อไป (2 อันดับแรกต่อกลุ่ม)</p></div>';
  mainContent.innerHTML = html;
}

async function renderNews() {
  const res = await apiFetch('/api/news');
  if (!res.news) {
    return mainContent.innerHTML = '<div class="card"><h2>📰 ข่าวล่าสุด</h2><p style="color:var(--text-muted)">ยังไม่มีข่าวในขณะนี้ ระบบจะดึงข่าวใหม่โดยอัตโนมัติ</p></div>';
  }
  mainContent.innerHTML = `<div class="card"><h2>📰 ข่าวล่าสุด</h2><div class="news-content">${res.news}</div></div>`;
}
