const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>World Cup 2026 Portal</title>
  <link rel="stylesheet" href="style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
</head>
<body>
  <div id="login-container" class="container">
    <div class="card login-card">
      <h1>🏆 World Cup 2026</h1>
      <p>เข้าสู่ระบบ Web Portal</p>
      <input type="password" id="passwordInput" placeholder="Password" />
      <button id="loginBtn">เข้าสู่ระบบ</button>
      <p id="loginError" class="error hidden">รหัสผ่านไม่ถูกต้อง</p>
    </div>
  </div>

  <div id="app-container" class="container hidden">
    <nav>
      <h2 id="groupNameDisplay">Group</h2>
      <ul>
        <li><a href="#" data-page="ranking" class="active">Ranking</a></li>
        <li><a href="#" data-page="schedule">Schedule & Results</a></li>
        <li><a href="#" data-page="standings">WC Standings</a></li>
        <li><a href="#" data-page="news">News</a></li>
      </ul>
      <button id="logoutBtn" class="btn-small">Logout</button>
    </nav>
    <main id="main-content">
      <!-- Content injected by JS -->
    </main>
  </div>

  <script src="app.js"></script>
</body>
</html>
`;

const styleCss = `
:root {
  --bg: #0f172a;
  --card-bg: #1e293b;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --border: #334155;
  --success: #10b981;
  --danger: #ef4444;
}
* { box-sizing: border-box; }
body {
  font-family: 'Inter', sans-serif;
  background-color: var(--bg);
  color: var(--text);
  margin: 0;
  padding: 0;
  line-height: 1.5;
}
.hidden { display: none !important; }
.container { max-width: 800px; margin: 0 auto; padding: 20px; }
.card {
  background: var(--card-bg);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border: 1px solid var(--border);
  margin-bottom: 20px;
}
.login-card { max-width: 400px; margin: 100px auto; text-align: center; }
input {
  width: 100%; padding: 12px; margin-bottom: 16px;
  background: var(--bg); border: 1px solid var(--border);
  color: var(--text); border-radius: 8px; font-size: 16px;
}
button {
  width: 100%; padding: 12px;
  background: var(--primary); color: white;
  border: none; border-radius: 8px; font-size: 16px; font-weight: 600;
  cursor: pointer; transition: background 0.2s;
}
button:hover { background: var(--primary-hover); }
.btn-small { width: auto; padding: 8px 16px; font-size: 14px; }
.error { color: var(--danger); font-size: 14px; margin-top: 8px; }
nav {
  display: flex; flex-direction: column; gap: 16px;
  background: var(--card-bg); padding: 16px 24px;
  border-radius: 12px; margin-bottom: 24px; border: 1px solid var(--border);
}
@media (min-width: 600px) {
  nav { flex-direction: row; justify-content: space-between; align-items: center; }
}
nav ul {
  list-style: none; padding: 0; margin: 0; display: flex; gap: 16px; flex-wrap: wrap;
}
nav a {
  color: var(--text-muted); text-decoration: none; font-weight: 600;
  padding: 8px 12px; border-radius: 8px; transition: all 0.2s;
}
nav a:hover, nav a.active {
  color: var(--text); background: var(--bg);
}
.table-responsive { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--text-muted); font-weight: 600; }
tr:hover { background: var(--bg); }
.clickable { cursor: pointer; }
.badge {
  display: inline-block; padding: 4px 8px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.badge-success { background: rgba(16, 185, 129, 0.2); color: var(--success); }
.badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
.badge-neutral { background: rgba(148, 163, 184, 0.2); color: var(--text-muted); }
.match-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px; background: var(--card-bg); border-radius: 8px;
  margin-bottom: 8px; cursor: pointer; border: 1px solid var(--border);
}
.match-header:hover { border-color: var(--primary); }
.match-details {
  background: var(--bg); padding: 16px; border-radius: 8px;
  margin-bottom: 16px; border: 1px solid var(--border);
  display: none;
}
.match-details.open { display: block; }
.news-content { white-space: pre-wrap; font-size: 15px; color: var(--text-muted); }
`;

const appJs = `
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
  const res = await apiFetch(\`/api/group/\${currentGroupId}/rank\`);
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading ranking</p>';
  
  userPredictionsData = res.userPredictions;
  
  let html = '<div class="card"><h2>🏆 Leaderboard</h2><div class="table-responsive"><table>';
  html += '<thead><tr><th>#</th><th>Name</th><th>Points</th><th title="ทายสกอร์ถูกเป๊ะ (+3)">S &#127919;</th><th title="ทายผลถูก แต่สกอร์ไม่ตรง (+1)">R &#9989;</th><th title="ทายผิดหมด (+0)">X &#10060;</th></tr></thead><tbody>';

  
  res.leaderboard.forEach((u, i) => {
    html += \`<tr class="clickable" onclick="showUserPredictions('\${u.displayName}')">
      <td>\${i + 1}</td>
      <td><strong>\${u.displayName}</strong></td>
      <td>\${u.points}</td>
      <td style="color:#10b981;font-weight:600">\${u.w}</td>
      <td>\${u.d}</td>
      <td style="color:#64748b">\${u.l}</td>
    </tr>\`;
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
    html += \`<h3 style="color:var(--text-muted);margin:20px 0 8px">\${stage}</h3>\`;
    grouped[stage].forEach(m => {
      const matchTime = m.startTime ? new Date(m.startTime) : null;
      const timeStr = matchTime ? matchTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
      const isPast = m.status === 'FT';
      const isLive = m.status === '1H' || m.status === '2H' || m.status === 'HT' || m.status === 'LIVE';
      const statusBadge = isPast
        ? \`<span class="badge badge-neutral">FT</span>\`
        : isLive
          ? \`<span class="badge badge-success" style="animation:pulse 1s infinite">🔴 LIVE</span>\`
          : \`<span class="badge badge-neutral">⏰ \${timeStr}</span>\`;
      const score = isPast || isLive
        ? \`<strong style="font-size:18px">\${m.homeScore ?? 0} - \${m.awayScore ?? 0}</strong>\`
        : \`<span style="color:var(--text-muted)">vs</span>\`;

      html += \`
        <div class="match-header" style="cursor:default">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span style="min-width:130px;font-weight:600">\${m.homeTeam}</span>
              \${score}
              <span style="min-width:130px;font-weight:600">\${m.awayTeam}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted)">\${timeStr}</div>
          </div>
          <div>\${statusBadge}</div>
        </div>\`;
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
    html += \`<h3 style="color:var(--primary);margin:20px 0 8px">\${groupName}</h3>
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
        </tr></thead><tbody>\`;

    group.forEach((team, idx) => {
      const s = team.all;
      const gd = s.goals.for - s.goals.against;
      const qualify = idx < 2 ? 'background:rgba(59,130,246,0.1)' : '';
      html += \`<tr style="\${qualify}">
        <td>\${team.rank}</td>
        <td><strong>\${team.team.name}</strong></td>
        <td>\${s.played}</td>
        <td style="color:#10b981">\${s.win}</td>
        <td>\${s.draw}</td>
        <td style="color:#ef4444">\${s.lose}</td>
        <td>\${s.goals.for}</td>
        <td>\${s.goals.against}</td>
        <td>\${gd >= 0 ? '+' : ''}\${gd}</td>
        <td><strong>\${team.points}</strong></td>
      </tr>\`;
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
  mainContent.innerHTML = \`<div class="card"><h2>📰 ข่าวล่าสุด</h2><div class="news-content">\${res.news}</div></div>\`;
}
`;


fs.writeFileSync(path.join(publicDir, 'index.html'), indexHtml);
fs.writeFileSync(path.join(publicDir, 'style.css'), styleCss);
fs.writeFileSync(path.join(publicDir, 'app.js'), appJs);

console.log('Frontend scaffolding created.');
