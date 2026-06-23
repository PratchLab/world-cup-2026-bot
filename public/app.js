
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
  const gId = document.getElementById('groupIdInput').value.trim();
  const pwd = document.getElementById('passwordInput').value.trim();
  const res = await apiFetch('/api/login', 'POST', { groupId: gId, password: pwd });
  
  if (res.success) {
    localStorage.setItem('groupId', gId);
    localStorage.setItem('password', pwd);
    currentGroupId = gId;
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
  // Simplified for now, let's fix renderRanking to use userId
};

// ... To be completed ...
// I will rewrite app.js properly.
