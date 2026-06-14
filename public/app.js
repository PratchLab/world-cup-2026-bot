const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const mainContent = document.getElementById('main-content');
const groupNameDisplay = document.getElementById('groupNameDisplay');

let currentGroupId = localStorage.getItem('groupId');
let currentPassword = localStorage.getItem('password');
let userPredictionsData = {};
let allMatchesData = [];

async function apiFetch(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(endpoint, options);
  return res.json();
}

async function checkLogin() {
  if (currentGroupId && currentPassword) {
    const res = await apiFetch('/api/login', 'POST', { password: currentPassword });
    if (res.success) {
      currentGroupId = res.groupId;
      localStorage.setItem('groupId', currentGroupId);
      groupNameDisplay.innerText = res.groupName;
      loginContainer.classList.add('hidden');
      appContainer.classList.remove('hidden');
      loadPage('ranking');
    } else {
      localStorage.clear();
      loginContainer.classList.remove('hidden');
    }
  } else {
    loginContainer.classList.remove('hidden');
  }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
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
});

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

// 1. Ranking Page
async function renderRanking() {
  const res = await apiFetch(`/api/group/${currentGroupId}/rank`);
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading ranking</p>';
  
  userPredictionsData = res.userPredictions;
  
  let html = '<div class="card"><h2>🏆 Leaderboard</h2><div class="table-responsive"><table>';
  html += '<thead><tr><th>#</th><th>Name</th><th>Points</th><th>W</th><th>D</th><th>L</th></tr></thead><tbody>';
  
  res.leaderboard.forEach((u, i) => {
    const userId = Object.keys(userPredictionsData).find(id => userPredictionsData[id][0]?.displayName === u.displayName || (u.displayName === 'Unknown' && true));
    html += `<tr class="clickable" onclick="showUserPredictions('${userId}', '${u.displayName}')">
      <td>${i + 1}</td>
      <td><strong>${u.displayName}</strong></td>
      <td>${u.points}</td>
      <td>${u.w}</td>
      <td>${u.d}</td>
      <td>${u.l}</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';
  html += '<div id="userPredContainer"></div>';
  mainContent.innerHTML = html;
}

window.showUserPredictions = function(userId, displayName) {
  const container = document.getElementById('userPredContainer');
  const preds = userPredictionsData[userId] || [];
  
  let html = `<div class="card"><h3>📜 ประวัติทายผล: ${displayName}</h3><div class="table-responsive"><table>`;
  html += '<thead><tr><th>Match</th><th>Prediction</th><th>Points</th></tr></thead><tbody>';
  
  preds.forEach(p => {
    html += `<tr>
      <td>${p.homeTeam} vs ${p.awayTeam} <br><small>[${p.status === 'FT' ? p.homeScore + '-' + p.awayScore : p.status}]</small></td>
      <td>${p.prediction} (${p.outcome})</td>
      <td>${p.status === 'FT' ? '+' + p.points : '-'}</td>
    </tr>`;
  });
  html += '</tbody></table></div></div>';
  container.innerHTML = html;
  container.scrollIntoView({ behavior: 'smooth' });
};

// 2. Schedule & Results
async function renderSchedule() {
  const res = await apiFetch('/api/matches');
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading matches</p>';
  
  const rankRes = await apiFetch(`/api/group/${currentGroupId}/rank`);
  const allGroupPreds = Object.values(rankRes.userPredictions).flat();
  
  allMatchesData = res.matches.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  
  let html = '<div class="card"><h2>📅 Schedule & Results</h2>';
  
  allMatchesData.forEach(m => {
    const date = new Date(m.startTime).toLocaleString('th-TH');
    html += `
      <div class="match-header" onclick="toggleMatchDetails('${m.matchId}')">
        <div>
          <strong>${m.homeTeam} vs ${m.awayTeam}</strong><br>
          <small>${date}</small>
        </div>
        <div class="badge ${m.status === 'FT' ? 'badge-neutral' : 'badge-success'}">
          ${m.status === 'FT' ? m.homeScore + ' - ' + m.awayScore : m.status}
        </div>
      </div>
      <div id="details-${m.matchId}" class="match-details">
        <div style="text-align:center;">Loading details...</div>
      </div>
    `;
  });
  html += '</div>';
  mainContent.innerHTML = html;
  
  // Store preds globally for access in toggleMatchDetails
  window._allGroupPreds = allGroupPreds;
}

window.toggleMatchDetails = async function(matchId) {
  const detailsDiv = document.getElementById(`details-${matchId}`);
  if (detailsDiv.classList.contains('open')) {
    detailsDiv.classList.remove('open');
    return;
  }
  
  detailsDiv.classList.add('open');
  detailsDiv.innerHTML = '<p>Loading live data...</p>';
  
  const match = allMatchesData.find(m => String(m.matchId) === String(matchId));
  const res = await apiFetch(`/api/match/${matchId}/details`);
  const preds = window._allGroupPreds.filter(p => String(p.matchId) === String(matchId));
  
  let html = '<h4>👥 การทายผลของกลุ่มเรา:</h4>';
  if (preds.length === 0) {
    html += '<p><small>ยังไม่มีใครทายผลคู่นี้</small></p>';
  } else {
    html += '<ul style="font-size:14px; margin-bottom: 16px;">';
    preds.forEach(p => {
      // Find displayName from userPredictionsData
      let dName = 'Unknown';
      for (const id in userPredictionsData) {
        const found = userPredictionsData[id].find(up => String(up.matchId) === String(matchId) && up.prediction === p.prediction);
        if (found) {
           dName = userPredictionsData[id][0]?.displayName || 'Unknown';
           break;
        }
      }
      html += `<li>${dName}: ${p.prediction} (${p.outcome})</li>`;
    });
    html += '</ul>';
  }
  
  html += '<h4>⚽ 11 ผู้เล่นตัวจริง:</h4>';
  if (res.lineups && res.lineups.length === 2) {
    html += '<div style="display:flex; gap:20px; font-size:14px;">';
    res.lineups.forEach(l => {
      html += `<div><strong>${l.team.name} (${l.formation})</strong><br>`;
      if (l.startXI) {
        html += l.startXI.map(p => p.player.name).join(', ');
      }
      html += '</div>';
    });
    html += '</div>';
  } else {
    html += '<p><small>รายชื่อยังไม่ออก</small></p>';
  }
  
  html += '<h4 style="margin-top:16px;">📈 ค่าน้ำ (Betting Odds):</h4>';
  if (res.odds && res.odds.length > 0) {
    html += '<p><small>';
    res.odds.forEach(o => { html += `${o.value}: ${o.odd} | `; });
    html += '</small></p>';
  } else {
    html += '<p><small>ยังไม่มีข้อมูล</small></p>';
  }
  
  detailsDiv.innerHTML = html;
};

// 3. World Cup Standings
async function renderStandings() {
  const res = await apiFetch('/api/standings');
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading standings</p>';
  
  let html = '<div class="card"><h2>🌍 World Cup 2026 Standings</h2>';
  
  if (!res.standings || res.standings.length === 0) {
    html += '<p>ยังไม่มีข้อมูลตารางคะแนน</p></div>';
    return (mainContent.innerHTML = html);
  }
  
  res.standings.forEach(group => {
    html += `<h3>${group[0].group}</h3><div class="table-responsive"><table>`;
    html += '<thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>';
    
    group.forEach(team => {
      html += `<tr>
        <td><img src="${team.team.logo}" width="20" style="vertical-align:middle; margin-right:8px;">${team.team.name}</td>
        <td>${team.all.played}</td>
        <td>${team.all.win}</td>
        <td>${team.all.draw}</td>
        <td>${team.all.lose}</td>
        <td>${team.all.goals.for}</td>
        <td>${team.all.goals.against}</td>
        <td>${team.goalsDiff}</td>
        <td><strong>${team.points}</strong></td>
      </tr>`;
    });
    html += '</tbody></table></div><br>';
  });
  
  html += '</div>';
  mainContent.innerHTML = html;
}

// 4. News
async function renderNews() {
  const res = await apiFetch('/api/news');
  let html = '<div class="card"><h2>🗞️ ข่าวล่าสุด</h2>';
  if (res.news) {
    html += `<div class="news-content">${res.news}</div>`;
  } else {
    html += '<p>ยังไม่มีข่าวอัปเดต</p>';
  }
  html += '</div>';
  mainContent.innerHTML = html;
}

checkLogin();
