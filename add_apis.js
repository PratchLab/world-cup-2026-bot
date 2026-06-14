const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.js');
let code = fs.readFileSync(indexPath, 'utf8');

const apiCode = `
// --- Web Portal APIs ---
app.post('/api/login', async (req, res) => {
  const { groupId, password } = req.body;
  if (!groupId || !password) return res.status(400).json({ error: 'Missing parameters' });
  try {
    const sheets = await getSheetsClient();
    const resSheet = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Groups!A2:C'
    });
    const rows = resSheet.data.values || [];
    const group = rows.find(r => r[0] === groupId && r[2] === password);
    if (group) {
      res.json({ success: true, groupName: group[1] });
    } else {
      res.status(401).json({ error: 'Invalid group ID or password' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/group/:groupId/rank', async (req, res) => {
  const { groupId } = req.params;
  try {
    await getAllMatchesFromSheet();
    const allPredictions = await getLatestPredictions();
    const groupPreds = allPredictions.filter(p => p.groupId === groupId);
    
    const scores = {};
    const userPredictions = {};
    
    groupPreds.forEach(p => {
      const matchInfo = allFixturesCache.find(m => String(m.matchId) === String(p.matchId));
      if (!scores[p.userId]) {
        scores[p.userId] = { displayName: p.displayName, points: 0, w: 0, d: 0, l: 0 };
        userPredictions[p.userId] = [];
      }
      
      let pts = 0;
      if (matchInfo && matchInfo.status === 'FT') {
        pts = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore);
        scores[p.userId].points += pts;
        if (pts === 3) scores[p.userId].w++;
        else if (pts === 1) scores[p.userId].d++;
        else scores[p.userId].l++;
      }
      
      userPredictions[p.userId].push({
        matchId: p.matchId,
        homeTeam: matchInfo ? matchInfo.homeTeam : 'Unknown',
        awayTeam: matchInfo ? matchInfo.awayTeam : 'Unknown',
        prediction: p.prediction,
        outcome: p.outcome,
        points: pts,
        status: matchInfo ? matchInfo.status : 'NS',
        homeScore: matchInfo ? matchInfo.homeScore : null,
        awayScore: matchInfo ? matchInfo.awayScore : null
      });
    });
    
    const leaderboard = Object.values(scores).sort((a, b) => b.points - a.points || b.w - a.w || b.d - a.d);
    
    res.json({ leaderboard, userPredictions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/matches', async (req, res) => {
  try {
    const matches = await getAllMatchesFromSheet();
    res.json({ matches });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/match/:matchId/details', async (req, res) => {
  const { matchId } = req.params;
  try {
    const match = allFixturesCache.find(m => String(m.matchId) === String(matchId));
    if (!match || !match.apiFixtureId) return res.json({ lineups: null, odds: null });
    
    const lineups = await getLineups(match.apiFixtureId);
    const odds = await getRealOdds(match.apiFixtureId);
    
    res.json({ lineups, odds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/news', (req, res) => {
  res.json({ news: global.latestNewsSummary || null });
});

app.get('/api/standings', async (req, res) => {
  try {
    const standings = await getStandings();
    res.json({ standings });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

`;

const insertionPoint = 'const port = process.env.PORT || 3000;';
if (!code.includes('/api/login')) {
  code = code.replace(insertionPoint, apiCode + insertionPoint);
  fs.writeFileSync(indexPath, code);
  console.log('Added APIs to index.js');
} else {
  console.log('APIs already present.');
}
