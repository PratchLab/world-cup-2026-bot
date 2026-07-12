require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const {google} = require('googleapis');
const { generateMatchesCarousel, getFlag, generateRankingsMessage } = require('./report');
const { getLineups, getPredictions, getRealOdds, getApiFixtureForMatch, getStandings, getEvents } = require('./api-football');
const path = require('path');
const app = express();

// Web Portal Static Files & JSON parser (skip for webhook)
app.use(express.static('public'));
app.use((req, res, next) => {
  if (req.path === '/webhook') return next();
  express.json()(req, res, next);
});

let matchesCache = []; // Upcoming matches for carousel
let allFixturesCache = []; // All 104 matches

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

// Google Sheets client
async function getSheetsClient() {
  if (process.env.NODE_ENV === 'test') {
    if (!global.__mockSheets) global.__mockSheets = { values: [] };
    return {
      spreadsheets: {
        values: {
          append: async ({range, requestBody}) => {
            global.__mockSheets.values.push({range, ...requestBody});
            return {status: 200};
          },
          get: async () => ({ data: { values: global.__mockSheets.values } }),
          clear: async () => {
            global.__mockSheets.values = [];
            return {status: 200};
          },
        },
      },
    };
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const googleClient = await auth.getClient();
  return google.sheets({version: 'v4', auth: googleClient});
}

// Helper: Fetch all matches from Google Sheets (Single Source of Truth)
async function getAllMatchesFromSheet() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Matches!A2:M' });
  const rows = res.data.values || [];
  
  const matches = rows.map(r => ({
    matchId: r[0],
    homeTeam: r[1],
    awayTeam: r[2],
    startTime: r[3],
    stage: r[4],
    status: r[5] || 'NS',
    homeScore: (r[6] && r[6] !== '') ? parseInt(r[6]) : null,
    awayScore: (r[7] && r[7] !== '') ? parseInt(r[7]) : null,
    apiFixtureId: (r[8] && r[8] !== '') ? parseInt(r[8]) : null,
    homeScoreAET: (r[9] && r[9] !== '') ? parseInt(r[9]) : null,
    awayScoreAET: (r[10] && r[10] !== '') ? parseInt(r[10]) : null,
    homeScorePEN: (r[11] && r[11] !== '') ? parseInt(r[11]) : null,
    awayScorePEN: (r[12] && r[12] !== '') ? parseInt(r[12]) : null
  }));
  
  allFixturesCache = matches;
  matchesCache = matches.filter(m => m.status === 'NS').slice(0, 6);
  return matches;
}

// Read predictions from sheet
async function getLatestPredictions() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  let rows = [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Predictions!A:I' });
    rows = res.data.values || [];
  } catch (e) {
    console.error('Error reading predictions sheet', e);
  }

  // Filter latest prediction per user per match
  const map = {};
  for (const row of rows) {
    if (row.length < 7) continue;
    const [ts, groupId, userId, displayName, matchId, prediction, outcome, predAET = '', predPEN = ''] = row;
    const key = `${groupId}_${userId}_${matchId}`;
    if (!map[key] || new Date(ts) > new Date(map[key].ts)) {
      map[key] = { ts, groupId, userId, displayName, matchId, prediction, outcome, predAET, predPEN };
    }
  }
  return Object.values(map);
}

// Calculate points
function calculatePoints(predScore, predOutcome, actualHome, actualAway, matchInfo = null, predAET = '', predPEN = '') {
  if (actualHome === null || actualAway === null || actualHome === undefined) {
      return { total: 0, pts90: 0, ptsAET: 0, ptsPEN: 0 };
  }
  const actualScoreStr = `${actualHome}-${actualAway}`;
  const actualOutcome = actualHome > actualAway ? 'W' : actualHome === actualAway ? 'D' : 'L';
  
  let multiplier = 1;
  if (matchInfo && matchInfo.matchId) {
      const mId = parseInt(matchInfo.matchId, 10);
      if (mId >= 101 && mId <= 104) {
          multiplier = 2;
      }
  }

  let pts90 = 0;
  if (predScore === actualScoreStr) {
      pts90 = 3 * multiplier;
  } else if (predOutcome === actualOutcome) {
      pts90 = 1 * multiplier;
  }
  
  let ptsAET = 0;
  if (matchInfo && matchInfo.homeScoreAET !== null && matchInfo.awayScoreAET !== null && predAET) {
      const actAETOutcome = matchInfo.homeScoreAET > matchInfo.awayScoreAET ? 'W' : matchInfo.homeScoreAET === matchInfo.awayScoreAET ? 'D' : 'L';
      if (predAET === actAETOutcome) ptsAET += 1 * multiplier;
  }
  
  let ptsPEN = 0;
  if (matchInfo && matchInfo.homeScorePEN !== null && matchInfo.awayScorePEN !== null && predPEN) {
      const actPENOutcome = matchInfo.homeScorePEN > matchInfo.awayScorePEN ? 'W' : matchInfo.homeScorePEN === matchInfo.awayScorePEN ? 'D' : 'L';
      if (predPEN === actPENOutcome) ptsPEN += 1 * multiplier;
  }
  
  return {
      total: pts90 + ptsAET + ptsPEN,
      pts90,
      ptsAET,
      ptsPEN
  };
}

// Helper: store matches to sheet
async function storeMatchesToSheet(matches) {
  if (!matches || matches.length === 0) return;
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const timestamp = new Date().toISOString();
  const values = matches.map(m => [ timestamp, m.matchId, m.homeTeam, m.awayTeam, m.startTime, m.stage, m.status ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: 'Matches!A:G', valueInputOption: 'RAW', requestBody: { values },
  });
}

// Helper: write prediction to sheet
async function storePrediction(groupId, userId, displayName, matchId, prediction, outcome, predAET = '', predPEN = '') {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: 'Predictions!A:I', valueInputOption: 'RAW',
    requestBody: { values: [[new Date().toISOString(), groupId, userId, displayName, matchId, prediction, outcome, predAET, predPEN]] },
  });
}

async function updateMatchResult(matchId, status, homeScore, awayScore, homeAET = null, awayAET = null, homePEN = null, awayPEN = null) {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Matches!A:I' });
  const rows = res.data.values || [];
  
  const rowIndex = rows.findIndex(r => r[0] === String(matchId));
  if (rowIndex === -1) return;
  
  const apiFixtureId = rows[rowIndex][8] || '';
  const rowNumber = rowIndex + 1; // +1 for 1-based index (header is row 1)
  const range = `Matches!F${rowNumber}:M${rowNumber}`;
  
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        status, 
        homeScore, 
        awayScore, 
        apiFixtureId, 
        homeAET !== null ? homeAET : '', 
        awayAET !== null ? awayAET : '', 
        homePEN !== null ? homePEN : '', 
        awayPEN !== null ? awayPEN : ''
      ]]
    }
  });
  
  // Refresh cache
  await getAllMatchesFromSheet();
}

function parsePrediction(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return null;
  const score = parts[0].split('-');
  if (score.length !== 2) return null;
  const home = parseInt(score[0], 10);
  const away = parseInt(score[1], 10);
  const outcome = parts[1].toUpperCase();
  if (isNaN(home) || isNaN(away) || !['W','D','L'].includes(outcome)) return null;
  
  let outcomeAET = '';
  let outcomePEN = '';
  if (parts.length >= 3) {
      outcomeAET = parts[2].toUpperCase();
      if (!['W','D','L'].includes(outcomeAET)) return null;
  }
  if (parts.length === 4) {
      outcomePEN = parts[3].toUpperCase();
      if (!['W','L'].includes(outcomePEN)) return null; // PEN cannot be Draw
  }
  
  return {home, away, outcome, outcomeAET, outcomePEN};
}

// HELP MESSAGE
const helpMsg = `⚽️ สวัสดี! เราคือ "ว.ค. 26" บอททายผลบอลโลกสุดกวน ป่วนทุกสกอร์ แม่นหรือมั่วเดี๋ยวรู้กัน! 🏆

คำสั่งทั้งหมดที่บอทเข้าใจมีดังนี้ครับ:

1️⃣ /next - เรียกดูตารางแข่งวันนี้และรับปุ่มลัดทายผล
2️⃣ /schedule - ดูโปรแกรมการแข่งขัน 5 แมตช์ถัดไป
3️⃣ /group [A-L] - ดูตารางคะแนนและแมตช์กลุ่ม เช่น /group A
4️⃣ /stage [รอบ] - ดูโปรแกรมรอบน็อคเอาท์ (32, 16, 8, 4, 3, final)
5️⃣ /matchid - ดูคู่การแข่งขันทั้งหมดและ ID แมตช์
6️⃣ /lineup [ID] - ดูรายชื่อ 11 ตัวจริงของแมตช์นั้น
7️⃣ /odds [ID] - ดูทรรศนะและเปอร์เซ็นต์ความน่าจะเป็น
8️⃣ /mypredict - ดูประวัติทายผลของคุณเองและคะแนน
9️⃣ /allpredict [ID] - ดูผลทายของทุกคนในแมตช์นั้น
🔟 /rank - ดูตารางคะแนนรวม แข่งความเป็นเซียน!
🆕 /rank32 - ตารางคะแนนเซียน (นับเฉพาะตั้งแต่รอบ 32 ทีม)
🆕 /rank16 - ตารางคะแนนเซียน (นับเฉพาะตั้งแต่รอบ 16 ทีม)
🆕 /history - ดูประวัติการทายและคะแนนสะสมตั้งแต่คู่แรก
🌐 /portal (หรือ /web) - ดู URL และรหัสผ่านเพื่อเข้าหน้า Web Portal ของกลุ่มเรา
*️⃣ /setup - ดึง Group ID ของกลุ่มนี้เพื่อรับแจ้งเตือนอัตโนมัติ

⚠️ กติกาสำคัญ:
- "ทายผลกี่ครั้งก็ได้ จนกว่าบอลจะเริ่มเตะ!" ระบบจะนับผลการทายครั้งสุดท้ายก่อนบอลเตะ
- พอเกมเริ่มแล้ว ระบบจะปิดรับทายผลคู่นั้นทันที
- ทายสกอร์ถูกเป๊ะ ได้ 3 คะแนน!
- ทายสกอร์ผิด แต่ผลถูก (ใครชนะ/เสมอ) ได้ 1 คะแนน!`;

// Event handler
app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;
    const userId = event.source.userId;
    const groupId = event.source.groupId || 'private';
    const text = event.message.text.trim();
    const textLower = text.toLowerCase();
    
    // Ignore normal conversation
    if (!text.startsWith('/') && textLower !== '?' && textLower !== 'help') continue;

    // --- 0. /portal ---
    if (text.startsWith('/portal') || text.startsWith('/web')) {
      if (event.source.type === 'group' || event.source.type === 'room') {
        const sheets = await getSheetsClient();
        const resSheet = await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: 'Groups!A2:C'
        });
        const rows = resSheet.data.values || [];
        const group = rows.find(r => r[0] === groupId);
        
        let replyText = '';
        if (group) {
          const webUrl = `https://wc26-bot.onrender.com`;
          replyText = `🌐 **Web Portal กลุ่ม: ${group[1]}**\n\n🔗 URL: ${webUrl}\n🔑 Password: ${group[2]}\n\n(รหัสผ่านนี้ใช้เข้าดูข้อมูลเฉพาะกลุ่มเราเท่านั้น ห้ามบอกกลุ่มอื่นนะ!)`;
        } else {
          replyText = `⚠️ ยังไม่ได้ตั้งรหัสผ่านสำหรับกลุ่มนี้ครับ รบกวนแอดมินเข้าไปเพิ่มข้อมูลใน Google Sheet แผ่น 'Groups' โดยใส่ GroupId, ชื่อกลุ่ม และ รหัสผ่าน ครับ\n(GroupId: ${groupId})`;
        }
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
      } else {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⚠️ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม (Group Chat) เท่านั้นครับ' }] });
      }
      continue;
    }

    // --- 0.1 /setup ---
    if (text.startsWith('/setup')) {
      if (event.source.type === 'group') {
        const replyText = `✅ บอทอยู่ในกลุ่มนี้เรียบร้อยแล้ว!\n\n📋 Group ID ของกลุ่มนี้คือ:\n${event.source.groupId}\n\n👉 โปรดนำค่านี้ไปใส่ใน Environment Variables ของ Render ในชื่อ LINE_GROUP_ID ครับ`;
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
      } else {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⚠️ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม (Group Chat) เท่านั้นครับ' }] });
      }
      continue;
    }

    // --- 0.1 /lineup [ID] ---
    if (text.startsWith('/lineup')) {
      const tokens = text.split(/\s+/);
      if (tokens.length < 2) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⚠️ โปรดระบุ ID แมตช์ (เช่น /lineup 1)' }] });
        continue;
      }
      const matchId = tokens[1];
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const match = allFixturesCache.find(m => String(m.matchId) === String(matchId));
      if (!match) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ไม่พบข้อมูลแมตช์ ID: ${matchId}` }] });
        continue;
      }
      if (!match.apiFixtureId) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ยังไม่มีข้อมูล 11 ตัวจริงสำหรับคู่นี้ครับ (รอการแข่งขันรอบนี้)` }] });
        continue;
      }
      const lineups = await getLineups(match.apiFixtureId);
      if (!lineups || lineups.length === 0) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ยังไม่มีข้อมูล 11 ตัวจริงจาก FIFA สำหรับคู่นี้ครับ` }] });
        continue;
      }
      let replyText = `📋 รายชื่อ 11 ตัวจริง\n${getFlag(match.homeTeam)} ${match.homeTeam} vs ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
      lineups.forEach(teamData => {
          const formation = teamData.formation || 'Unknown';
          const xi = teamData.startXI.map(p => p.player.name).join(', ');
          replyText += `🛡️ ${teamData.team.name} (${formation}):\n${xi}\n\n`;
      });
      await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText.trim() }] });
      continue;
    }

    // --- 0.2 /odds [ID] หรือ /predict [ID] ---
    if (text.startsWith('/odds') || text.startsWith('/predict ')) {
      const tokens = text.split(/\s+/);
      if (tokens.length < 2) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⚠️ โปรดระบุ ID แมตช์ (เช่น /odds 1)' }] });
        continue;
      }
      const matchId = tokens[1];
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const match = allFixturesCache.find(m => String(m.matchId) === String(matchId));
      if (!match) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ไม่พบข้อมูลแมตช์ ID: ${matchId}` }] });
        continue;
      }
      if (!match.apiFixtureId) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ยังไม่มีข้อมูลทรรศนะสำหรับคู่นี้ครับ (รอการแข่งขันรอบนี้)` }] });
        continue;
      }
      const odds = await getRealOdds(match.apiFixtureId);
      if (!odds) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ ยังไม่มีราคาค่าน้ำสำหรับคู่นี้ครับ` }] });
        continue;
      }
      
      const homeOddStr = odds.find(o => o.value === 'Home')?.odd;
      const drawOddStr = odds.find(o => o.value === 'Draw')?.odd;
      const awayOddStr = odds.find(o => o.value === 'Away')?.odd;

      if (!homeOddStr || !drawOddStr || !awayOddStr) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ รูปแบบค่าน้ำของคู่นี้ไม่สมบูรณ์ครับ` }] });
        continue;
      }

      const homeOdd = parseFloat(homeOddStr);
      const drawOdd = parseFloat(drawOddStr);
      const awayOdd = parseFloat(awayOddStr);

      const homeProbRaw = 1 / homeOdd;
      const drawProbRaw = 1 / drawOdd;
      const awayProbRaw = 1 / awayOdd;
      
      const totalProb = homeProbRaw + drawProbRaw + awayProbRaw;
      
      const homePct = Math.round((homeProbRaw / totalProb) * 100);
      const drawPct = Math.round((drawProbRaw / totalProb) * 100);
      const awayPct = Math.round((awayProbRaw / totalProb) * 100);

      let replyText = `🔮 โอกาสชนะอ้างอิงจากค่าน้ำจริง (Real Odds)\n${getFlag(match.homeTeam)} ${match.homeTeam} vs ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
      replyText += `📊 ความน่าจะเป็น:\n`;
      replyText += `- ${match.homeTeam}: ${homePct}%\n`;
      replyText += `- เสมอ: ${drawPct}%\n`;
      replyText += `- ${match.awayTeam}: ${awayPct}%\n\n`;
      replyText += `(ข้อมูลค่าน้ำ: Home ${homeOddStr}, Draw ${drawOddStr}, Away ${awayOddStr})\n`;
      
      await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
      continue;
    }

    // --- 1. /next ---
    if (text.startsWith('/next')) {
      try {
        const matches = await getAllMatchesFromSheet();
        const upcomingMatches = matches
            .filter(m => new Date(m.startTime) > new Date() && m.status !== 'FT')
            .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
            .slice(0, 6);

        if (upcomingMatches.length === 0) {
          await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'ชิลๆ ไปก่อนพวก ไม่มีแมตช์เตะใน 24 ชม. นี้เลยว่ะ ไปเตะบอลพลาสติกหน้าปากซอยพลางๆ ก่อนนะ' }] });
          continue;
        }
        const flexMessage = generateMatchesCarousel(upcomingMatches);
        const guideText = { type: 'text', text: '👆 กดปุ่ม "คัดลอกคำสั่งทายผล" ใต้คู่ที่อยากทาย แล้วเอามาวางในช่องแชท\nจากนั้นพิมพ์สกอร์กับผล (W/D/L) ต่อท้ายแล้วกดส่งได้เลยครับ!\n\nตัวอย่าง: /guess 9001 2-1 W' };
        await client.replyMessage({ replyToken: event.replyToken, messages: [flexMessage, guideText] });
      } catch (err) {
        console.error('Error fetching matches:', err);
      }
      continue;
    }

    // --- 2. /guess ---
    if (text.startsWith('/guess')) {
      const tokens = text.split(/\s+/);
      if (tokens.length < 4 || tokens.length > 6) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: `⚠️ รูปแบบผิดครับ\nตัวอย่าง: /guess 9001 2-1 W\nหรือถ้ามีต่อเวลา: /guess 9001 1-1 D D W`}] });
        continue;
      }
      const matchId = tokens[1];
      const pred = parsePrediction(tokens.slice(2).join(' '));
      if (!pred) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: `⚠️ รูปแบบสกอร์หรือผลผิดครับ (W=เจ้าบ้านชนะ, D=เสมอ, L=เยือนชนะ)\nจุดโทษห้ามทายเสมอ (D)\nตัวอย่าง: /guess 9001 1-1 D D W`}] });
        continue;
      }

      // Pre-fetch matches to check if match started
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const matchInfo = allFixturesCache.find(m => m.matchId === String(matchId));
      if (!matchInfo) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: `⚠️ ไม่พบข้อมูลแมตช์ ID: ${matchId}`}] });
        continue;
      }

      // Check if match has started or status is no longer Not Started
      if (matchInfo.status !== 'NS' || new Date() > new Date(matchInfo.startTime)) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: `❌ หมดเวลาทายผลแล้วครับ! แมตช์นี้เริ่มแข่งไปแล้ว`}] });
        continue;
      }

      try {
        let displayName = 'คุณลูกค้า';
        try {
          if (event.source.type === 'group') {
            const profile = await client.getGroupMemberProfile(event.source.groupId, userId);
            displayName = profile.displayName;
          } else if (event.source.type === 'room') {
            const profile = await client.getRoomMemberProfile(event.source.roomId, userId);
            displayName = profile.displayName;
          } else {
            const profile = await client.getProfile(userId);
            displayName = profile.displayName;
          }
        } catch (e) {
          console.error("Profile fetch error:", e.message);
        }
        await storePrediction(groupId, userId, displayName, matchId, `${pred.home}-${pred.away}`, pred.outcome, pred.outcomeAET, pred.outcomePEN);
        
        const hFlag = getFlag(matchInfo.homeTeam);
        const aFlag = getFlag(matchInfo.awayTeam);
        const teamOutcome = pred.outcome === 'W' ? `${matchInfo.homeTeam} ชนะ` : pred.outcome === 'D' ? 'เสมอ' : `${matchInfo.awayTeam} ชนะ`;
        
        let replyText = `✅ บันทึกทายผลสำเร็จ!\n\n${hFlag} ${matchInfo.homeTeam} vs ${matchInfo.awayTeam} ${aFlag}\nสกอร์ที่ทาย: ${pred.home} - ${pred.away}\nฟันธง: ${teamOutcome}`;
        if (pred.outcomeAET) replyText += `\nต่อเวลา AET: ${pred.outcomeAET === 'W' ? matchInfo.homeTeam + ' ชนะ' : pred.outcomeAET === 'L' ? matchInfo.awayTeam + ' ชนะ' : 'เสมอ'}`;
        if (pred.outcomePEN) replyText += `\nจุดโทษ PEN: ${pred.outcomePEN === 'W' ? matchInfo.homeTeam + ' ชนะ' : matchInfo.awayTeam + ' ชนะ'}`;
        replyText += `\n\n⚠️ คุณสามารถทายแก้ตัวได้เรื่อยๆ จนกว่าบอลจะเตะนะครับ! (เรานับเฉพาะครั้งล่าสุด)\nขอให้โชคดีนะ ${displayName}! 🔴⚪`;
        
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText}] });
      } catch (err) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: '❌ ระบบมีปัญหา บันทึกไม่ได้'}] });
      }
      continue;
    }

    // --- 3. /mypredict ---
    if (text.startsWith('/mypredict')) {
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const predictions = await getLatestPredictions();
      const myPreds = predictions.filter(p => p.userId === userId && p.groupId === groupId);
      
      if (myPreds.length === 0) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: 'คุณยังไม่เคยทายผลคู่ไหนเลยครับ ลองพิมพ์ /next เพื่อเริ่มทายผลสิ!'}] });
        continue;
      }

      let messages = [];
      let currentText = `📜 ประวัติทายผลล่าสุดของคุณ:\n\n`;
      let totalPts = 0;
      for (const p of myPreds) {
        const matchInfo = allFixturesCache.find(m => m.matchId === p.matchId);
        if (!matchInfo) continue;
        const hFlag = getFlag(matchInfo.homeTeam);
        const aFlag = getFlag(matchInfo.awayTeam);
        
        let chunk = `⚽️ ${hFlag} ${matchInfo.homeTeam} vs ${matchInfo.awayTeam} ${aFlag}\n`;
        let guessStr = `${p.prediction} (${p.outcome})`;
        if (p.predAET) guessStr += ` AET:${p.predAET}`;
        if (p.predPEN) guessStr += ` PEN:${p.predPEN}`;
        chunk += `ทายว่า: ${guessStr}\n`;
        
        if (matchInfo.status === 'FT') {
          const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
          const pts = ptsObj.total;
          totalPts += pts;
          
          let actStr = `${matchInfo.homeScore}-${matchInfo.awayScore}`;
          if (matchInfo.homeScoreAET !== null) actStr += ` (AET ${matchInfo.homeScoreAET}-${matchInfo.awayScoreAET})`;
          if (matchInfo.homeScorePEN !== null) actStr += ` (PEN ${matchInfo.homeScorePEN}-${matchInfo.awayScorePEN})`;
          
          chunk += `[จบเกม: ${actStr}] 👉 ได้ ${pts} แต้ม!`;
          if (matchInfo.homeScoreAET !== null || matchInfo.homeScorePEN !== null) {
              chunk += ` (90m: ${ptsObj.pts90}, AET: ${ptsObj.ptsAET}, PEN: ${ptsObj.ptsPEN})`;
          }
          chunk += `\n\n`;
        } else {
          chunk += `[ยังไม่แข่ง]\n\n`;
        }
        
        if (currentText.length + chunk.length > 4000) {
            messages.push({ type: 'text', text: currentText.trim() });
            currentText = '';
        }
        currentText += chunk;
      }
      currentText += `🏆 คะแนนรวมของคุณตอนนี้: ${totalPts} แต้ม!`;
      messages.push({ type: 'text', text: currentText.trim() });
      
      // LINE allows max 5 message objects per reply. Keep the last 5 if exceeding (to show newest matches & total points).
      if (messages.length > 5) {
          messages = messages.slice(-5);
      }
      
      await client.replyMessage({ replyToken: event.replyToken, messages });
      continue;
    }

    // --- 4. /allpredict ---
    if (text.startsWith('/allpredict')) {
      const matchId = text.split(/\s+/)[1];
      if (!matchId) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: 'กรุณาระบุ ID แมตช์ เช่น /allpredict 9001'}] });
        continue;
      }
      
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const matchInfo = allFixturesCache.find(m => m.matchId === String(matchId));
      if (!matchInfo) {
        await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: `ไม่พบข้อมูลแมตช์ ID: ${matchId}`}] });
        continue;
      }

      const groupId = event.source.groupId || event.source.roomId || event.source.userId;
      const predictions = await getLatestPredictions();
      const matchPreds = predictions.filter(p => p.matchId === matchId && p.groupId === groupId);
      
      let replyText = `📊 สรุปการทายผลทั้งหมดสำหรับคู่:\n`;
      if (matchInfo.status === 'FT' && matchInfo.homeScore !== null) {
          replyText += `${getFlag(matchInfo.homeTeam)} ${matchInfo.homeTeam} ${matchInfo.homeScore} - ${matchInfo.awayScore} ${matchInfo.awayTeam} ${getFlag(matchInfo.awayTeam)} (ในเวลา 90 นาที)\n`;
          if (matchInfo.homeScoreAET !== null && matchInfo.awayScoreAET !== null) {
              replyText += `(ต่อเวลาพิเศษ AET: ${matchInfo.homeScoreAET} - ${matchInfo.awayScoreAET})\n`;
          }
          if (matchInfo.homeScorePEN !== null && matchInfo.awayScorePEN !== null) {
              replyText += `(จุดโทษ PEN: ${matchInfo.homeScorePEN} - ${matchInfo.awayScorePEN})\n`;
          }
          replyText += `\n`;
      } else {
          replyText += `${getFlag(matchInfo.homeTeam)} ${matchInfo.homeTeam} vs ${matchInfo.awayTeam} ${getFlag(matchInfo.awayTeam)}\n\n`;
      }
      if (matchPreds.length === 0) {
        replyText += `ยังไม่มีใครกล้าฟันธงคู่นี้เลยครับ!`;
      } else {
        matchPreds.forEach(p => {
          let pointsText = '';
          let guessStr = `${p.prediction} (${p.outcome})`;
          if (p.predAET) guessStr += ` AET:${p.predAET}`;
          if (p.predPEN) guessStr += ` PEN:${p.predPEN}`;
          if (matchInfo.status === 'FT') {
             const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
             pointsText = ` 👉 ได้ ${ptsObj.total} แต้ม!`;
             if (matchInfo.homeScoreAET !== null || matchInfo.homeScorePEN !== null) {
                 pointsText += ` (90m:${ptsObj.pts90}, AET:${ptsObj.ptsAET}, PEN:${ptsObj.ptsPEN})`;
             }
          }
          replyText += `👤 ${p.displayName} ทายว่า: ${guessStr}${pointsText}\n`;
        });
      }
      await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText}] });
      continue;
    }

    // --- 5. /rank (Leaderboard) ---
    if (text.startsWith('/rank') || text.startsWith('/leaderboard')) {
      const isRank32 = text.startsWith('/rank32');
      const isRank16 = text.startsWith('/rank16');

      await getAllMatchesFromSheet();
      const groupId = event.source.groupId || event.source.roomId || event.source.userId;
      const allPredictions = await getLatestPredictions();
      const predictions = allPredictions.filter(p => p.groupId === groupId);
      
      // Calculate scores for everyone in this group
      const scores = {}; // userId -> { displayName, points }
      predictions.forEach(p => {
        const matchInfo = allFixturesCache.find(m => String(m.matchId) === String(p.matchId));
        if (matchInfo && matchInfo.status === 'FT') {
          const mId = parseInt(p.matchId);
          if (isRank32 && mId < 73) return; // Skip matches before Round of 32
          if (isRank16 && mId < 89) return; // Skip matches before Round of 16

          const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
          const pts = ptsObj.total;
          if (!scores[p.userId]) scores[p.userId] = { displayName: p.displayName, points: 0 };
          scores[p.userId].points += pts;
        }
      });

      const sorted = Object.values(scores).sort((a, b) => b.points - a.points);
      
      let replyText = `🏆 ตารางคะแนนเซียนบอลโลก 🏆\n\n`;
      if (isRank32) replyText = `🏆 ตารางคะแนนเซียนบอลโลก (ตั้งแต่รอบ 32 ทีม) 🏆\n\n`;
      if (isRank16) replyText = `🏆 ตารางคะแนนเซียนบอลโลก (ตั้งแต่รอบ 16 ทีม) 🏆\n\n`;
      if (sorted.length === 0) {
        replyText += `ยังไม่มีใครได้คะแนนเลยครับ!`;
      } else {
        let currentRank = 1;
        let previousPoints = -1;
        let actualRank = 1;
        
        sorted.forEach((u, idx) => {
          if (u.points !== previousPoints) {
            currentRank = actualRank;
            previousPoints = u.points;
          }
          const medal = currentRank === 1 ? '🥇' : currentRank === 2 ? '🥈' : currentRank === 3 ? '🥉' : '👏';
          replyText += `${medal} อันดับ ${currentRank}: ${u.displayName} 👉 ${u.points} แต้ม\n`;
          actualRank++;
        });
      }
      await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText}] });
      continue;
    }

    // --- 5.4 /history (Chronological Match History) ---
    if (text.startsWith('/history') || text.startsWith('/timeline')) {
      await getAllMatchesFromSheet();
      const groupId = event.source.groupId || event.source.roomId || event.source.userId;
      const allPredictions = await getLatestPredictions();
      const predictions = allPredictions.filter(p => p.groupId === groupId);

      // Filter matches that are finished and sort by start time ascending
      const finishedMatches = allFixturesCache.filter(m => m.status === 'FT').sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      
      if (finishedMatches.length === 0) {
          await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: 'ยังไม่มีคู่ไหนแข่งจบเลยครับ'}] });
          continue;
      }

      let cumulativeScores = {};
      let matchMessages = [];
      
      finishedMatches.forEach((matchInfo, index) => {
          let matchPreds = predictions.filter(p => String(p.matchId) === String(matchInfo.matchId));
          if (matchPreds.length === 0) return; // Skip matches with no predictions
          
          let actStr = `${matchInfo.homeScore}-${matchInfo.awayScore}`;
          if (matchInfo.homeScoreAET !== null) actStr += ` (AET ${matchInfo.homeScoreAET}-${matchInfo.awayScoreAET})`;
          if (matchInfo.homeScorePEN !== null) actStr += ` (PEN ${matchInfo.homeScorePEN}-${matchInfo.awayScorePEN})`;
          
          let chunk = `⚽️ คู่ที่ ${index + 1}: ${getFlag(matchInfo.homeTeam)} ${matchInfo.homeTeam} ${actStr} ${matchInfo.awayTeam} ${getFlag(matchInfo.awayTeam)}\n`;
          
          matchPreds.forEach(p => {
              if (!cumulativeScores[p.userId]) cumulativeScores[p.userId] = { displayName: p.displayName, points: 0 };
              
              const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
              const pts = ptsObj.total;
              cumulativeScores[p.userId].points += pts;
              
              let guessStr = `${p.prediction} (${p.outcome})`;
              if (p.predAET) guessStr += ` AET:${p.predAET}`;
              if (p.predPEN) guessStr += ` PEN:${p.predPEN}`;
              
              chunk += `- คุณ ${p.displayName} ทาย ${guessStr} 👉 ได้ ${pts} แต้ม (รวม: ${cumulativeScores[p.userId].points})\n`;
          });
          
          matchMessages.push(chunk.trim());
      });
      
      if (matchMessages.length === 0) {
          await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: 'ยังไม่มีใครทายผลในคู่ที่แข่งจบเลยครับ'}] });
          continue;
      }

      // Chunk messages for LINE limits (max 5 bubbles, max 5000 chars per bubble)
      let outMessages = [];
      let currentBubble = `📜 ประวัติการแข่งและคะแนนสะสม:\n\n`;
      
      matchMessages.forEach(msg => {
          if (currentBubble.length + msg.length + 5 > 4000) {
              outMessages.push({ type: 'text', text: currentBubble.trim() });
              currentBubble = msg + '\n\n';
          } else {
              currentBubble += msg + '\n\n';
          }
      });
      if (currentBubble.trim()) {
          outMessages.push({ type: 'text', text: currentBubble.trim() });
      }
      
      // If exceeds 5 bubbles, take only the last 5
      if (outMessages.length > 5) {
          outMessages = outMessages.slice(-5);
      }
      
      await client.replyMessage({ replyToken: event.replyToken, messages: outMessages });
      continue;
    }

    // --- 5.5 /stats (Prediction Stats) ---
    if (text.startsWith('/stats')) {
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const groupId = event.source.groupId || event.source.roomId || event.source.userId;
      const allPredictions = await getLatestPredictions();
      const predictions = allPredictions.filter(p => p.groupId === groupId);
      
      const matchStats = {};
      predictions.forEach(p => {
        const matchInfo = allFixturesCache.find(m => String(m.matchId) === String(p.matchId));
        if (matchInfo && matchInfo.status === 'FT') {
          const mId = parseInt(p.matchId);
          if (!matchStats[mId]) {
             matchStats[mId] = { matchInfo, total: 0, zero: 0, three: 0, predictors: [] };
          }
          const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
          const pts = ptsObj.total;
          matchStats[mId].total++;
          if (pts === 0) matchStats[mId].zero++;
          if (pts >= 3) matchStats[mId].three++;
          matchStats[mId].predictors.push({ name: p.displayName, pred: p.prediction, pts });
        }
      });
      
      const statsList = Object.values(matchStats).filter(s => s.total >= 2);
      
      if (statsList.length === 0) {
          await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: 'ยังไม่มีข้อมูลสถิติที่น่าสนใจครับ (ต้องมีคนทายคู่เดียวกันอย่างน้อย 2 คนและแข่งจบแล้ว)'}] });
          continue;
      }
      
      // 1. ผ้าป่าคว่ำ: Most zeros, ideally zero === total
      let worst = [...statsList].sort((a,b) => {
          const aRatio = a.zero / a.total;
          const bRatio = b.zero / b.total;
          if (bRatio !== aRatio) return bRatio - aRatio;
          return b.total - a.total;
      })[0];
      
      // 2. สามัคคีคือพลัง: Zero === 0, most total
      let best = [...statsList].filter(s => s.zero === 0 && s !== worst).sort((a,b) => b.total - a.total)[0];
      
      // 3. ตาทิพย์: Most threes
      let exact = [...statsList].filter(s => s !== worst && s !== best).sort((a,b) => b.three - a.three || b.total - a.total)[0];
      
      let messages = [];
      let currentText = `🏆 สรุปสถิติสุดพีคประจำกลุ่ม! 📊\n\n`;
      
      const addChunk = (chunk) => {
          if (currentText.length + chunk.length > 4000) {
              messages.push({ type: 'text', text: currentText.trim() });
              currentText = '';
          }
          currentText += chunk;
      };
      
      if (worst && worst.zero > 0) {
         const m = worst.matchInfo;
         let chunk = `☠️ รางวัล "ผ้าป่าคว่ำ" (เดาผิดกันเยอะสุด!):\n`;
         chunk += `${getFlag(m.homeTeam)} ${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam} ${getFlag(m.awayTeam)}\n`;
         chunk += `(มีคนทายผิด 0 แต้ม ถึง ${worst.zero} คน! 😭)\n`;
         worst.predictors.forEach(p => { chunk += `- ${p.name} ทาย: ${p.pred} (${p.pts} แต้ม)\n`; });
         chunk += `\n`;
         addChunk(chunk);
      }
      
      if (best && best.total > 0) {
         const m = best.matchInfo;
         let chunk = `🤝 รางวัล "สามัคคีคือพลัง" (รับแต้มถ้วนหน้า!):\n`;
         chunk += `${getFlag(m.homeTeam)} ${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam} ${getFlag(m.awayTeam)}\n`;
         chunk += `(เอกฉันท์สุดๆ กอดคอกันบวกแต้ม 🎉)\n`;
         best.predictors.forEach(p => { chunk += `- ${p.name} ทาย: ${p.pred} (${p.pts} แต้ม)\n`; });
         chunk += `\n`;
         addChunk(chunk);
      }
      
      if (exact && exact.three > 0) {
         const m = exact.matchInfo;
         let chunk = `🎯 รางวัล "ตาทิพย์" (เดาสกอร์เป๊ะ 3 แต้มเยอะสุด!):\n`;
         chunk += `${getFlag(m.homeTeam)} ${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam} ${getFlag(m.awayTeam)}\n`;
         chunk += `(แม่นเว่อร์! ได้ 3 แต้มเต็มกันเพียบ)\n`;
         exact.predictors.forEach(p => { chunk += `- ${p.name} ทาย: ${p.pred} (${p.pts} แต้ม)\n`; });
         chunk += `\n`;
         addChunk(chunk);
      }
      
      messages.push({ type: 'text', text: currentText.trim() });
      if (messages.length > 5) messages = messages.slice(0, 5); // Fallback limit
      
      await client.replyMessage({ replyToken: event.replyToken, messages });
      continue;
    }

    // --- 6. /schedule ---
    if (text.startsWith('/schedule')) {
      if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
      const matches = allFixturesCache;
      
      // Get next 5 upcoming matches chronologically
      const upcoming = matches
        .filter(m => new Date(m.startTime) > new Date() && m.status !== 'FT')
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
        .slice(0, 6);
      let replyText = `📅 โปรแกรมการแข่งขันที่กำลังจะมาถึง:\n\n`;
      if (upcoming.length === 0) {
        replyText += `ไม่มีแมตช์เตะแล้วครับ!`;
      } else {
        upcoming.forEach(m => {
          const d = new Date(m.startTime);
          const timeStr = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
          replyText += `[ID: ${m.matchId}] ${timeStr}\n${getFlag(m.homeTeam)} ${m.homeTeam} vs ${m.awayTeam} ${getFlag(m.awayTeam)}\n\n`;
        });
        replyText += `พิมพ์ /next เพื่อทายผลครับ!`;
      }
      await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText}] });
      continue;
    }

    // --- 7. /group ---
    if (text.startsWith('/group')) {
       const groupLetter = text.split(' ')[1]?.toUpperCase();
       if (!groupLetter || groupLetter < 'A' || groupLetter > 'L') {
           await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: '❌ กรุณาระบุกลุ่มให้ถูกต้อง เช่น /group A (รองรับ A-L)'}]});
           continue;
       }
       const groupName = `Group ${groupLetter}`;
       if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
       const matches = allFixturesCache;
       
       const groupMatches = matches.filter(m => m.stage === groupName);
       if (groupMatches.length === 0) {
           await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: `ไม่พบข้อมูลของ ${groupName}`}]});
           continue;
       }
       
       // Build Standings
       const table = {};
       groupMatches.forEach(m => {
           if (!table[m.homeTeam]) table[m.homeTeam] = { name: m.homeTeam, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
           if (!table[m.awayTeam]) table[m.awayTeam] = { name: m.awayTeam, pld: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
           
           if (m.status === 'FT' && m.homeScore !== null && m.awayScore !== null) {
               table[m.homeTeam].pld++; table[m.awayTeam].pld++;
               table[m.homeTeam].gf += m.homeScore; table[m.awayTeam].gf += m.awayScore;
               table[m.homeTeam].ga += m.awayScore; table[m.awayTeam].ga += m.homeScore;
               if (m.homeScore > m.awayScore) { table[m.homeTeam].w++; table[m.homeTeam].pts += 3; table[m.awayTeam].l++; }
               else if (m.homeScore < m.awayScore) { table[m.awayTeam].w++; table[m.awayTeam].pts += 3; table[m.homeTeam].l++; }
               else { table[m.homeTeam].d++; table[m.awayTeam].d++; table[m.homeTeam].pts += 1; table[m.awayTeam].pts += 1; }
           }
       });
       
       const standings = Object.values(table).sort((a, b) => {
           if (b.pts !== a.pts) return b.pts - a.pts;
           const gdA = a.gf - a.ga; const gdB = b.gf - b.ga;
           if (gdB !== gdA) return gdB - gdA;
           return b.gf - a.gf;
       });
       
       let replyText = `📊 ตารางคะแนน ${groupName}\n\n`;
       standings.forEach((t, idx) => {
           const gd = t.gf - t.ga;
           replyText += `${idx+1}. ${getFlag(t.name)} ${t.name}\n   แข่ง ${t.pld} | ได้ ${t.gf} เสีย ${t.ga} (GD: ${gd > 0 ? '+'+gd : gd}) | 👉 ${t.pts} แต้ม\n`;
       });
       
       replyText += `\n📅 แมตช์ในกลุ่ม:\n`;
       groupMatches.forEach(m => {
           const d = new Date(m.startTime);
           const timeStr = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
           const scoreStr = m.status === 'FT' ? `[จบ ${m.homeScore}-${m.awayScore}]` : `[รอเตะ]`;
           replyText += `[ID: ${m.matchId}] ${timeStr}\n${getFlag(m.homeTeam)} ${m.homeTeam} vs ${m.awayTeam} ${getFlag(m.awayTeam)} ${scoreStr}\n`;
       });
       
       await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText}] });
       continue;
    }

    // --- 7.5 /stage (Knockout Stages) ---
    if (text.startsWith('/stage') || text.startsWith('/knockout') || text.startsWith('/round')) {
       const stageInput = text.split(' ')[1]?.toLowerCase();
       if (!stageInput) {
           await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: '❌ กรุณาระบุรอบที่ต้องการดู เช่น:\n/stage 32 (รอบ 32 ทีม)\n/stage 16 (รอบ 16 ทีม)\n/stage 8 หรือ qf (รอบ 8 ทีม)\n/stage 4 หรือ sf (รอบรองฯ)\n/stage final (นัดชิง)'}]});
           continue;
       }
       
       let targetStage = '';
       if (stageInput === '32') targetStage = 'Round of 32';
       else if (stageInput === '16') targetStage = 'Round of 16';
       else if (stageInput === '8' || stageInput === 'qf' || stageInput === 'quarter') targetStage = 'Quarter-finals';
       else if (stageInput === '4' || stageInput === 'sf' || stageInput === 'semi') targetStage = 'Semi-finals';
       else if (stageInput === '3' || stageInput === 'third') targetStage = 'Third place play-off';
       else if (stageInput === 'final' || stageInput === 'ชิง') targetStage = 'Final';
       else {
           await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: '❌ ไม่รู้จักรอบนี้ครับ ลองใช้ 32, 16, 8, 4, 3 หรือ final'}]});
           continue;
       }
       
       if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
       const matches = allFixturesCache;
       
       const stageMatches = matches.filter(m => m.stage === targetStage);
       if (stageMatches.length === 0) {
           await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: `ไม่พบข้อมูลของ ${targetStage}`}]});
           continue;
       }
       
       let replyText = `⚔️ ตารางแข่งรอบ ${targetStage}\n\n`;
       stageMatches.forEach(m => {
           const d = new Date(m.startTime);
           const timeStr = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
           const scoreStr = m.status === 'FT' ? `[จบ ${m.homeScore}-${m.awayScore}]` : `[รอเตะ]`;
           replyText += `[ID: ${m.matchId}] ${timeStr}\n${getFlag(m.homeTeam)} ${m.homeTeam} vs ${m.awayTeam} ${getFlag(m.awayTeam)} ${scoreStr}\n\n`;
       });
       
       await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: replyText.trim()}] });
       continue;
    }

    // --- 7.6 /matchid (List all matches) ---
    if (text.startsWith('/matchid')) {
       if (allFixturesCache.length === 0) await getAllMatchesFromSheet();
       const matches = allFixturesCache;
       
       const msgArr = [];
       let currentText = `📋 รายการ Match ID ทั้งหมด:\n\n`;
       matches.forEach(m => {
           const d = new Date(m.startTime);
           const timeStr = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
           const scoreStr = m.status === 'FT' ? ` [จบ ${m.homeScore}-${m.awayScore}]` : ``;
           const stageStr = m.stage && m.stage.startsWith('Group') ? ` (${m.stage})` : '';
           const lineStr = `[ID: ${m.matchId}] ${timeStr} | ${getFlag(m.homeTeam)} ${m.homeTeam} vs ${m.awayTeam} ${getFlag(m.awayTeam)}${stageStr}${scoreStr}\n`;
           if (currentText.length + lineStr.length > 4500) {
               msgArr.push({type: 'text', text: currentText.trim()});
               currentText = '';
           }
           currentText += lineStr;
       });
       if (currentText) msgArr.push({type: 'text', text: currentText.trim()});
       
       await client.replyMessage({ replyToken: event.replyToken, messages: msgArr });
       continue;
    }

    // --- 8. /sync ---
    // Hidden from help menu, dev only
    if (text.startsWith('/sync')) {
       await client.replyMessage({replyToken: event.replyToken, messages: [{type: 'text', text: '🔄 กำลังดึงข้อมูลจาก API...\n\n❌ ทาง API-Football ยังไม่มีการอัปเดตข้อมูลตารางแข่งสำหรับ World Cup 2026 ตอนนี้บอทอ่านข้อมูลทั้งหมดจาก Google Sheet ที่เราสร้างไว้แทนนะครับ! คุณสามารถแก้ไขผลบอลใน Sheet ได้โดยตรงเลย'}]});
       continue;
    }
    
    // --- Fallback Help ---
    await client.replyMessage({ replyToken: event.replyToken, messages: [{type: 'text', text: helpMsg}] });
  }
  res.sendStatus(200);
});

// App configuration and server start
app.get('/api/upcoming-matches', async (req, res) => {
  try {
    const matches = await getAllMatchesFromSheet();
    if (matches.length > 0) {
      await storeMatchesToSheet(matches);
    }
    res.json({ ok: true, matchesCount: matches.length });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_fetch_matches' });
  }
});


// --- Web Portal APIs ---
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Missing password' });
  try {
    const sheets = await getSheetsClient();
    const resSheet = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Groups!A2:C'
    });
    const rows = resSheet.data.values || [];
    const group = rows.find(r => r[2] === password);
    if (group) {
      res.json({ success: true, groupId: group[0], groupName: group[1] });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/group/:groupId/rank', async (req, res) => {
  const { groupId } = req.params;
  const stage = req.query.stage;
  
  try {
    await getAllMatchesFromSheet();
    const allPredictions = await getLatestPredictions();
    const groupPreds = allPredictions.filter(p => p.groupId === groupId);
    
    const scores = {};
    const userPredictions = {};
    
    groupPreds.forEach(p => {
      const matchInfo = allFixturesCache.find(m => String(m.matchId) === String(p.matchId));
      const mId = parseInt(p.matchId);
      
      // Filter predictions based on stage query
      if (stage === '32' && mId < 73) return;
      if (stage === '16' && mId < 89) return;

      if (!scores[p.userId]) {
        scores[p.userId] = { displayName: p.displayName, points: 0, w: 0, d: 0, l: 0 };
        userPredictions[p.userId] = [];
      }
      
      let pts = 0;
      if (matchInfo && matchInfo.status === 'FT') {
        const ptsObj = calculatePoints(p.prediction, p.outcome, matchInfo.homeScore, matchInfo.awayScore, matchInfo, p.predAET, p.predPEN);
        pts = ptsObj.total;
        scores[p.userId].points += pts;
        if (pts >= 3) scores[p.userId].w++;
        else if (pts === 1) scores[p.userId].d++;
        else scores[p.userId].l++;
      }
      
      userPredictions[p.userId].push({
        userId: p.userId,
        displayName: p.displayName,
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

app.get('/api/group/:groupId/match/:matchId/details', async (req, res) => {
  const { groupId, matchId } = req.params;
  try {
    const match = allFixturesCache.find(m => String(m.matchId) === String(matchId));
    
    let lineups = null, events = null;
    if (match && match.apiFixtureId) {
      [lineups, events] = await Promise.all([
        getLineups(match.apiFixtureId),
        getEvents(match.apiFixtureId)
      ]);
    }
    
    const allPredictions = await getLatestPredictions();
    const matchPredictions = allPredictions
      .filter(p => p.groupId === groupId && String(p.matchId) === String(matchId))
      .map(p => {
        let pts = null;
        if (match && match.status === 'FT') {
          const ptsObj = calculatePoints(p.prediction, p.outcome, match.homeScore, match.awayScore, match, p.predAET, p.predPEN);
          pts = ptsObj.total;
        }
        return { displayName: p.displayName, prediction: p.prediction, outcome: p.outcome, predAET: p.predAET, predPEN: p.predPEN, points: pts };
      });
    
    res.json({ match, lineups, events, predictions: matchPredictions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`Bot service listening on port ${port}`);
  await getAllMatchesFromSheet(); // initial fetch

  // Start scheduler
  const { startScheduler } = require('./scheduler');
  startScheduler(client, {
    getAllMatchesFromSheet,
    getLatestPredictions,
    calculatePoints,
    updateMatchResult,
    getAllFixturesCache: () => allFixturesCache
  });
});
