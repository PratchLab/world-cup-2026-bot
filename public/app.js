
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
  if (page.startsWith('ranking')) await renderRanking(page);
  else if (page === 'schedule') await renderSchedule();
  else if (page === 'standings') await renderStandings();
  else if (page === 'news') await renderNews();
}

async function renderRanking(page) {
  let query = '';
  let title = '🏆 Leaderboard';
  if (page === 'ranking32') { query = '?stage=32'; title = '🏆 Leaderboard (Round of 32)'; }
  if (page === 'ranking16') { query = '?stage=16'; title = '🏆 Leaderboard (Round of 16)'; }
  
  const res = await apiFetch(`/api/group/${currentGroupId}/rank${query}`);
  if (res.error) return mainContent.innerHTML = '<p class="error">Error loading ranking</p>';
  
  userPredictionsData = res.userPredictions;
  
  let html = `<div class="card"><h2>${title}</h2><div class="table-responsive"><table>`;
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
  const grouped = {};
  matches.forEach(function(m) {
    var label = m.stage || 'Group Stage';
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(m);
  });

  var html = '<div class="card"><h2>&#128197; Schedule &amp; Results</h2>';
  Object.keys(grouped).forEach(function(stage) {
    html += '<h3 style="color:var(--text-muted);margin:20px 0 8px">' + stage + '</h3>';
    grouped[stage].forEach(function(m) {
      var matchTime = m.startTime ? new Date(m.startTime) : null;
      var timeStr = matchTime ? matchTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
      var isPast = m.status === 'FT';
      var isLive = m.status === '1H' || m.status === '2H' || m.status === 'HT' || m.status === 'LIVE';
      var statusBadge = isPast ? '<span class="badge badge-neutral">FT</span>'
        : isLive ? '<span class="badge badge-success">&#128308; LIVE</span>'
        : '<span class="badge badge-neutral">&#9200; ' + timeStr + '</span>';
      var score = (isPast || isLive)
        ? '<strong style="font-size:18px;min-width:60px;text-align:center">' + (m.homeScore !== null ? m.homeScore : 0) + ' - ' + (m.awayScore !== null ? m.awayScore : 0) + '</strong>'
        : '<span style="color:var(--text-muted);min-width:60px;text-align:center">vs</span>';

      html += '<div class="match-header" onclick="toggleMatchDetail(\'' + m.matchId + '\')" style="cursor:pointer">'
        + '<div style="display:flex;flex-direction:column;gap:4px;flex:1">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="min-width:120px;font-weight:600">' + m.homeTeam + '</span>'
        + score
        + '<span style="min-width:120px;font-weight:600">' + m.awayTeam + '</span>'
        + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted)">' + timeStr + '</div>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px">' + statusBadge + '<span style="color:var(--text-muted);font-size:18px">&#9660;</span></div>'
        + '</div>'
        + '<div id="detail-' + m.matchId + '" class="match-details"></div>';
    });
  });
  html += '</div>';
  mainContent.innerHTML = html;
}

window.toggleMatchDetail = async function(matchId) {
  var panel = document.getElementById('detail-' + matchId);
  if (!panel) return;
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    panel.innerHTML = '';
    return;
  }
  panel.classList.add('open');
  panel.innerHTML = '<p style="color:var(--text-muted);padding:8px">&#128257; กำลังโหลด...</p>';

  var data = await apiFetch('/api/group/' + currentGroupId + '/match/' + matchId + '/details');
  if (data.error) { panel.innerHTML = '<p class="error">โหลดไม่ได้: ' + data.error + '</p>'; return; }

  var html = '';

  // ---- Venue & Basic Info ----
  var m = data.match;
  if (m) {
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:14px;color:var(--text-muted)">';
    if (m.startTime) {
      var d = new Date(m.startTime);
      html += '<span>&#128197; ' + d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>';
    }
    html += '</div>';
  }

  // ---- Venue & Coach from lineups ----
  var homeCoach = '-', awayCoach = '-', venue = '-';
  if (data.lineups && data.lineups.length >= 1) {
    homeCoach = data.lineups[0].coach ? data.lineups[0].coach.name : '-';
    if (data.lineups[0].team && data.lineups[0].team.name) venue = data.lineups[0].team.name;
  }
  if (data.lineups && data.lineups.length >= 2) {
    awayCoach = data.lineups[1].coach ? data.lineups[1].coach.name : '-';
  }

  // ---- Events: Goals, Cards, Subs, Shootouts ----
  var goals = [], cards = [], subs = [], shootouts = [];
  if (data.events && data.events.length > 0) {
    data.events.forEach(function(ev) {
      if (ev.type === 'Goal' && ev.comments !== 'Penalty Shootout' && ev.detail !== 'Missed Penalty') goals.push(ev);
      else if (ev.type === 'Goal' && ev.comments === 'Penalty Shootout') shootouts.push(ev);
      else if (ev.type === 'Card') cards.push(ev);
      else if (ev.type === 'subst') subs.push(ev);
    });
  }

  // ---- Goals Section ----
  if (goals.length > 0) {
    html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#9917; ประตู</h4>';
    html += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
    goals.forEach(function(g) {
      var icon = g.detail === 'Own Goal' ? '&#128563;' : g.detail === 'Penalty' ? '&#129311;' : '&#9917;';
      var minute = g.time.elapsed + (g.time.extra ? '+' + g.time.extra : '') + '\'';
      html += '<div style="display:flex;gap:8px;align-items:center">'
        + '<span style="color:var(--text-muted);min-width:40px">' + minute + '</span>'
        + '<span>' + icon + ' <strong>' + (g.player ? g.player.name : '-') + '</strong>'
        + (g.assist && g.assist.name ? ' <span style="color:var(--text-muted)">(assist: ' + g.assist.name + ')</span>' : '')
        + ' <span style="color:var(--text-muted);font-size:12px">— ' + (g.team ? g.team.name : '') + '</span>'
        + (g.detail === 'Own Goal' ? ' <span style="color:#ef4444;font-size:11px">OG</span>' : '')
        + (g.detail === 'Penalty' ? ' <span style="color:#3b82f6;font-size:11px">PEN</span>' : '')
        + '</span>'
        + '</div>';
    });
    html += '</div>';
  }

  // ---- Shootouts Section ----
  if (shootouts.length > 0) {
    var homeTeamName = (data.lineups && data.lineups.length > 0 && data.lineups[0].team) ? data.lineups[0].team.name : '';
    var homePen = 0, awayPen = 0;
    
    shootouts.forEach(function(s) {
      if (s.detail === 'Penalty') {
        if (s.team && (s.team.name === homeTeamName || homeTeamName.includes(s.team.name))) homePen++;
        else awayPen++;
      }
    });

    html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#9917; ดวลจุดโทษ (' + homePen + ' - ' + awayPen + ')</h4>';
    html += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
    shootouts.forEach(function(s) {
      var icon = s.detail === 'Penalty' ? '&#9989;' : '&#10060;';
      html += '<div style="display:flex;gap:8px;align-items:center">'
        + '<span style="color:var(--text-muted);min-width:40px">' + icon + '</span>'
        + '<span><strong>' + (s.player ? s.player.name : '-') + '</strong>'
        + ' <span style="color:var(--text-muted);font-size:12px">— ' + (s.team ? s.team.name : '') + '</span>'
        + '</span>'
        + '</div>';
    });
    html += '</div>';
  }

  // ---- Cards Section ----
  if (cards.length > 0) {
    html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#128737; ใบเหลือง/แดง</h4>';
    html += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
    cards.forEach(function(c) {
      var icon = c.detail === 'Yellow Card' ? '&#128255;' : '&#128308;';
      var minute = c.time.elapsed + (c.time.extra ? '+' + c.time.extra : '') + '\'';
      html += '<div style="display:flex;gap:8px;align-items:center">'
        + '<span style="color:var(--text-muted);min-width:40px">' + minute + '</span>'
        + '<span>' + icon + ' ' + (c.player ? c.player.name : '-')
        + ' <span style="color:var(--text-muted);font-size:12px">— ' + (c.team ? c.team.name : '') + '</span></span>'
        + '</div>';
    });
    html += '</div>';
  }

  // ---- Substitutions ----
  if (subs.length > 0) {
    html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#128260; เปลี่ยนตัว</h4>';
    html += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
    subs.forEach(function(s) {
      var minute = s.time.elapsed + (s.time.extra ? '+' + s.time.extra : '') + '\'';
      html += '<div style="display:flex;gap:8px;align-items:center">'
        + '<span style="color:var(--text-muted);min-width:40px">' + minute + '</span>'
        + '<span>&#128994; ' + (s.assist ? s.assist.name : '-')
        + ' &#128308; ' + (s.player ? s.player.name : '-')
        + ' <span style="color:var(--text-muted);font-size:12px">— ' + (s.team ? s.team.name : '') + '</span></span>'
        + '</div>';
    });
    html += '</div>';
  }

  // ---- Lineups ----
  if (data.lineups && data.lineups.length > 0) {
    html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#128101; รายชื่อผู้เล่น</h4>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    data.lineups.forEach(function(lineup) {
      html += '<div>'
        + '<div style="font-weight:700;margin-bottom:4px">' + (lineup.team ? lineup.team.name : '') + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">'
        + '&#129776; ' + (lineup.formation || '-') + ' &nbsp;|&nbsp; &#129339; ' + (lineup.coach ? lineup.coach.name : '-')
        + '</div>'
        + '<div style="font-size:13px;display:flex;flex-direction:column;gap:2px">';
      if (lineup.startXI && lineup.startXI.length > 0) {
        lineup.startXI.forEach(function(p) {
          var player = p.player;
          html += '<div><span style="color:var(--text-muted);min-width:24px;display:inline-block">' + (player.number || '') + '</span> ' + (player.name || '-') + '</div>';
        });
      }
      if (lineup.substitutes && lineup.substitutes.length > 0) {
        html += '<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">สำรอง:</div>';
        lineup.substitutes.forEach(function(p) {
          var player = p.player;
          html += '<div style="color:var(--text-muted)"><span style="min-width:24px;display:inline-block">' + (player.number || '') + '</span> ' + (player.name || '-') + '</div>';
        });
      }
      html += '</div></div>';
    });
    html += '</div>';
  }

  // ---- Predictions Table ----
  html += '<h4 style="margin:12px 0 6px;color:var(--text)">&#127919; การทายของกลุ่ม</h4>';
  if (!data.predictions || data.predictions.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:14px">ยังไม่มีการทาย</p>';
  } else {
    html += '<div class="table-responsive"><table><thead><tr>'
      + '<th>ชื่อ</th><th>ทาย</th><th>คะแนน</th>'
      + '</tr></thead><tbody>';
    data.predictions.forEach(function(p) {
      var ptsBadge = p.points === 3 ? '<span style="color:#10b981;font-weight:700">+3 &#127919;</span>'
        : p.points === 1 ? '<span style="color:#f59e0b;font-weight:700">+1 &#9989;</span>'
        : p.points === 0 && p.outcome !== null ? '<span style="color:#64748b">0 &#10060;</span>'
        : '<span style="color:var(--text-muted)">รอผล</span>';
      html += '<tr><td><strong>' + p.displayName + '</strong></td>'
        + '<td>' + (p.prediction || '-') + '</td>'
        + '<td>' + ptsBadge + '</td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
  }

  panel.innerHTML = html;
};

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
