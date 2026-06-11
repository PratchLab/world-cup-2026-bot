const cron = require('node-cron');
const { getLineups, getEvents, getStatistics, getFixture } = require('./api-football');
const { getFlag } = require('./report');
const axios = require('axios');

let apiFixturesCache = [];

async function fetchAllApiFixtures() {
  try {
    const res = await axios.get(`https://${process.env.API_FOOTBALL_HOST}/fixtures`, {
      params: { league: 1, season: 2026 },
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
    });
    apiFixturesCache = res.data.response || [];
    console.log(`[API] Fetched ${apiFixturesCache.length} fixtures from API-Football.`);
  } catch (err) {
    console.error("[API] Error fetching API fixtures:", err.message);
  }
}

// Map Google Sheet match to API-Football fixture
function getApiFixtureForMatch(sheetMatch) {
  return apiFixturesCache.find(apiMatch => {
    const apiDate = new Date(apiMatch.fixture.date);
    const sheetDate = new Date(sheetMatch.startTime);
    // Same day and roughly same time (within 12 hours) and one of the team names match (fuzzy)
    const timeDiff = Math.abs(apiDate - sheetDate);
    if (timeDiff > 12 * 60 * 60 * 1000) return false;
    
    const apiHome = apiMatch.teams.home.name.toLowerCase();
    const apiAway = apiMatch.teams.away.name.toLowerCase();
    const sheetHome = sheetMatch.homeTeam.toLowerCase();
    const sheetAway = sheetMatch.awayTeam.toLowerCase();
    
    // Simple substring match to handle "USA" vs "United States" or "South Korea" vs "Korea Republic"
    if ((apiHome.includes(sheetHome) || sheetHome.includes(apiHome) || sheetHome === 'usa' && apiHome.includes('united states')) &&
        (apiAway.includes(sheetAway) || sheetAway.includes(apiAway) || sheetAway === 'usa' && apiAway.includes('united states'))) {
      return true;
    }
    return false;
  });
}

function startScheduler(client, sheetsFunctions) {
  const { getAllMatchesFromSheet, getLatestPredictions, calculatePoints, updateMatchResult, getAllFixturesCache } = sheetsFunctions;

  // Initialize API cache
  fetchAllApiFixtures();

  // 1. Pre-Match Cron: Runs every minute
  cron.schedule('* * * * *', async () => {
    const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
    if (!LINE_GROUP_ID) return;

    const matches = getAllFixturesCache();
    const now = new Date();
    
    for (const match of matches) {
      if (match.status !== 'NS') continue;
      const startTime = new Date(match.startTime);
      const diffMs = startTime - now;
      const diffMins = Math.floor(diffMs / 60000);
      
      // Trigger exactly 30 minutes before kick-off
      if (diffMins === 30) {
        console.log(`[Scheduler] 30 mins to kick-off for ${match.matchId}. Fetching lineups...`);
        const apiFixture = getApiFixtureForMatch(match);
        if (!apiFixture) {
            console.log(`[Scheduler] API Fixture not found for ${match.homeTeam} vs ${match.awayTeam}`);
            continue;
        }

        const lineups = await getLineups(apiFixture.fixture.id);
        
        let replyText = `🚨 อีก 30 นาทีบอลจะเตะแล้ว! 🚨\nเตรียมตัวรับชม: ${getFlag(match.homeTeam)} ${match.homeTeam} vs ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
        
        if (lineups && lineups.length === 2) {
            lineups.forEach(teamData => {
                const formation = teamData.formation || 'Unknown';
                const xi = teamData.startXI.map(p => p.player.name).join(', ');
                replyText += `📋 11 ตัวจริง ${teamData.team.name} (${formation}):\n${xi}\n\n`;
            });
        } else {
            replyText += `(รายชื่อ 11 ตัวจริงกำลังรอการอัปเดตจากฟีฟ่า)\n\n`;
        }
        
        replyText += `⏳ ใครยังไม่ทายผล รีบพิมพ์ /guess ตอนนี้เลย! หมดเวลาทายผลทันทีที่เสียงนกหวีดเป่าเริ่มเกม!`;
        
        try {
          await client.pushMessage(LINE_GROUP_ID, { type: 'text', text: replyText });
        } catch (e) {
          console.error("Push message error:", e.response ? e.response.data : e.message);
        }
      }
    }
  });

  // 2. Post-Match Polling: Runs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
    
    const matches = getAllFixturesCache();
    const now = new Date();
    
    // Find active matches (started but not marked as FT/PEN in our sheet)
    const activeMatches = matches.filter(m => new Date(m.startTime) <= now && m.status !== 'FT' && m.status !== 'PEN');
    
    if (activeMatches.length === 0) return;

    // Refresh API fixtures to get latest status
    await fetchAllApiFixtures();

    for (const match of activeMatches) {
        const apiFixture = getApiFixtureForMatch(match);
        if (!apiFixture) continue;

        const apiStatus = apiFixture.fixture.status.short;
        
        // Match has ended
        if (apiStatus === 'FT' || apiStatus === 'PEN' || apiStatus === 'AET') {
            console.log(`[Scheduler] Match ${match.matchId} ended! Processing results...`);
            
            const homeScore = apiFixture.goals.home;
            const awayScore = apiFixture.goals.away;
            
            // 1. Update Sheet
            await updateMatchResult(match.matchId, 'FT', homeScore, awayScore);
            
            if (!LINE_GROUP_ID) continue;

            // 2. Fetch Events & Stats
            const events = await getEvents(apiFixture.fixture.id);
            const stats = await getStatistics(apiFixture.fixture.id);
            
            let replyText = `🏁 จบการแข่งขัน! 🏁\n${getFlag(match.homeTeam)} ${match.homeTeam} ${homeScore} - ${awayScore} ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
            
            // Goals
            const goalEvents = events.filter(e => e.type === 'Goal');
            if (goalEvents.length > 0) {
                replyText += `⚽️ ผู้ทำประตู:\n`;
                goalEvents.forEach(e => {
                    replyText += `- ${e.time.elapsed}' ${e.player.name} (${e.team.name})\n`;
                });
                replyText += `\n`;
            }
            
            // Stats (Possession)
            if (stats && stats.length === 2) {
                const homePossession = stats[0].statistics.find(s => s.type === 'Ball Possession')?.value || '-';
                const awayPossession = stats[1].statistics.find(s => s.type === 'Ball Possession')?.value || '-';
                replyText += `📊 ครองบอล: ${homePossession} - ${awayPossession}\n\n`;
            }

            // 3. Calculate Predictions
            replyText += `--- 🏆 สรุปคะแนนการทายผลคู่นี้ ---\n`;
            const allPreds = await getLatestPredictions();
            const matchPreds = allPreds.filter(p => String(p.matchId) === String(match.matchId));
            
            let hasGuesser = false;
            for (const p of matchPreds) {
                hasGuesser = true;
                const pts = calculatePoints(p.prediction, p.outcome, homeScore, awayScore);
                let resultStr = pts === 3 ? 'ทายถูกเป๊ะ! (3 แต้ม)' : pts === 1 ? 'ทายผลถูก (1 แต้ม)' : 'ทายผิด (0 แต้ม)';
                replyText += `- คุณ ${p.displayName} 👉 ${resultStr}\n`;
            }
            
            if (!hasGuesser) {
                replyText += `(ไม่มีใครทายผลคู่นี้เลย)\n`;
            }
            
            replyText += `\nพิมพ์ /rank เพื่อดูตารางคะแนนรวมทั้งหมดครับ! 👑`;

            try {
              await client.pushMessage(LINE_GROUP_ID, { type: 'text', text: replyText });
            } catch (e) {
              console.error("Push message error:", e.response ? e.response.data : e.message);
            }
        }
    }
  });
}

module.exports = { startScheduler };
