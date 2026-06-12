const cron = require('node-cron');
const { getLineups, getEvents, getStatistics, getFixture, fetchAllApiFixtures, getApiFixtureForMatch } = require('./api-football');
const { getFlag } = require('./report');

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
        if (!match.apiFixtureId) {
            console.log(`[Scheduler] No API Fixture ID for ${match.homeTeam} vs ${match.awayTeam}`);
            continue;
        }

        const lineups = await getLineups(match.apiFixtureId);
        
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
          await client.pushMessage({ to: LINE_GROUP_ID, messages: [{ type: 'text', text: replyText }] });
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

    for (const match of activeMatches) {
        if (!match.apiFixtureId) continue;

        // Fetch latest status for this specific match
        const apiFixture = await getFixture(match.apiFixtureId);
        if (!apiFixture) continue;

        const apiStatus = apiFixture.fixture.status.short;
        
        // Match has ended
        if (apiStatus === 'FT' || apiStatus === 'PEN' || apiStatus === 'AET') {
            console.log(`[Scheduler] Match ${match.matchId} ended! Processing results...`);
            
            const homeScore = apiFixture.goals.home;
            const awayScore = apiFixture.goals.away;
            
            // 1. Update Sheet
            await updateMatchResult(match.matchId, 'FT', homeScore, awayScore);
            await getAllMatchesFromSheet();
            
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
              await client.pushMessage({ to: LINE_GROUP_ID, messages: [{ type: 'text', text: replyText }] });
            } catch (e) {
              console.error("Push message error:", e.response ? e.response.data : e.message);
            }
        }
    }
  });
  // 3. Daily News Summary (08:00 and 18:00 Thailand time -> 01:00 and 11:00 UTC)
  cron.schedule('0 1,11 * * *', async () => {
    const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
    if (!LINE_GROUP_ID) return;

    try {
      const { getNewsSummaryMessage } = require('./news');
      const message = await getNewsSummaryMessage();
      if (message) {
        await client.pushMessage({ to: LINE_GROUP_ID, messages: [{ type: 'text', text: message }] });
      }
    } catch (e) {
      console.error("[Scheduler] Error pushing news summary:", e.message);
    }
  });

  console.log('[Scheduler] Cron jobs started.');
}

module.exports = { startScheduler };
