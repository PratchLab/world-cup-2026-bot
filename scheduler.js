const cron = require('node-cron');
const { getLineups, getEvents, getStatistics, getFixture, fetchAllApiFixtures, getApiFixtureForMatch } = require('./api-football');
const { getFlag } = require('./report');

const lineupSentCache = new Set();
const lineupLastChecked = {};
const reminderSentCache = new Set();
function startScheduler(client, sheetsFunctions) {
  const { getAllMatchesFromSheet, getLatestPredictions, calculatePoints, updateMatchResult, getAllFixturesCache, getActiveGroupIds } = sheetsFunctions;

  // Initialize API cache
  fetchAllApiFixtures();

  // 1. Pre-Match Cron: Runs every minute
  cron.schedule('* * * * *', async () => {
    const groupIds = await getActiveGroupIds();
    if (groupIds.length === 0) return;

    const matches = getAllFixturesCache();
    const now = new Date();
    
    for (const match of matches) {
      if (match.status !== 'NS') continue;
      const startTime = new Date(match.startTime);
      const diffMs = startTime - now;
      const diffMins = Math.floor(diffMs / 60000);
      
      // A) Poll for Lineups between 60 to 0 mins before kickoff
      const lastChecked = lineupLastChecked[match.matchId] || 0;
      if (diffMins <= 60 && diffMins > 0 && !lineupSentCache.has(match.matchId) && (now.getTime() - lastChecked > 4.5 * 60000)) {
        lineupLastChecked[match.matchId] = now.getTime();
        
        if (match.apiFixtureId) {
          const lineups = await getLineups(match.apiFixtureId);
          if (lineups && lineups.length === 2) {
            console.log(`[Scheduler] Lineups found for ${match.matchId} at T-${diffMins} mins.`);
            
            let replyText = `📋 มาแล้ว! รายชื่อ 11 ตัวจริง 📋\n${getFlag(match.homeTeam)} ${match.homeTeam} vs ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
            
            lineups.forEach(teamData => {
                const formation = teamData.formation || 'Unknown';
                const xi = teamData.startXI && Array.isArray(teamData.startXI) 
                    ? teamData.startXI.map(p => p.player?.name).filter(Boolean).join(', ')
                    : 'ยังไม่ระบุผู้เล่น';
                replyText += `🛡️ ${teamData.team?.name || 'Unknown'} (${formation}):\n${xi}\n\n`;
            });
            
            try {
              for (const groupId of groupIds) {
                await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: replyText }] });
              }
              lineupSentCache.add(match.matchId);
            } catch (e) {
              console.error(`Push lineup error for match ${match.matchId}:`, e.response ? e.response.data : e.message);
            }
          }
        }
      }

      // B) 30-minute Reminder (Resilient math fix)
      if (diffMins <= 30 && diffMins > 0 && !reminderSentCache.has(match.matchId)) {
        console.log(`[Scheduler] Sending reminder for ${match.matchId} at T-${diffMins} mins.`);
        reminderSentCache.add(match.matchId);
        
        let replyText = `🚨 อีก ${diffMins} นาทีบอลจะเตะแล้ว! 🚨\nเตรียมตัวรับชม: ${getFlag(match.homeTeam)} ${match.homeTeam} vs ${match.awayTeam} ${getFlag(match.awayTeam)}\n\n`;
        
        if (!lineupSentCache.has(match.matchId)) {
            replyText += `(รายชื่อ 11 ตัวจริงกำลังรอการอัปเดตจากฟีฟ่า หรืออาจจะเพิ่งประกาศ)\n\n`;
        }
        
        replyText += `⏳ ใครยังไม่ทายผล รีบพิมพ์ /guess ตอนนี้เลย! หมดเวลาทายผลทันทีที่เสียงนกหวีดเป่าเริ่มเกม!`;
        
        try {
          for (const groupId of groupIds) {
            await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: replyText }] });
          }
        } catch (e) {
          console.error("Push reminder error:", e.response ? e.response.data : e.message);
        }
      }
    }
  });

  // 2. Post-Match Polling: Runs every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    const groupIds = await getActiveGroupIds();
    
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
            
            // Use fulltime (90 min) score if available, otherwise fallback to total goals
            const homeScore = (apiFixture.score && apiFixture.score.fulltime && apiFixture.score.fulltime.home !== null) ? apiFixture.score.fulltime.home : apiFixture.goals.home;
            const awayScore = (apiFixture.score && apiFixture.score.fulltime && apiFixture.score.fulltime.away !== null) ? apiFixture.score.fulltime.away : apiFixture.goals.away;
            
            const homeAET = (apiFixture.score && apiFixture.score.extratime && apiFixture.score.extratime.home !== null) ? apiFixture.score.extratime.home : null;
            const awayAET = (apiFixture.score && apiFixture.score.extratime && apiFixture.score.extratime.away !== null) ? apiFixture.score.extratime.away : null;
            
            const homePEN = (apiFixture.score && apiFixture.score.penalty && apiFixture.score.penalty.home !== null) ? apiFixture.score.penalty.home : null;
            const awayPEN = (apiFixture.score && apiFixture.score.penalty && apiFixture.score.penalty.away !== null) ? apiFixture.score.penalty.away : null;

            // 1. Update Sheet
            await updateMatchResult(match.matchId, 'FT', homeScore, awayScore, homeAET, awayAET, homePEN, awayPEN);
            await getAllMatchesFromSheet();
            
            if (groupIds.length === 0) continue;

            // 2. Fetch Events & Stats safely
            let events = [];
            let stats = [];
            try {
                events = await getEvents(apiFixture.fixture.id) || [];
                stats = await getStatistics(apiFixture.fixture.id) || [];
            } catch (err) {
                console.error(`Error fetching post-match data for ${match.matchId}:`, err);
            }
            
            let replyText = `🏁 จบการแข่งขัน! 🏁\n${getFlag(match.homeTeam)} ${match.homeTeam} ${homeScore} - ${awayScore} ${match.awayTeam} ${getFlag(match.awayTeam)} (ในเวลา 90 นาที)\n`;
            if (homeAET !== null && awayAET !== null) {
                replyText += `(ต่อเวลาพิเศษ AET: ${homeAET} - ${awayAET})\n`;
            }
            replyText += `\n`;
            
            // Goals and Shootouts
            if (Array.isArray(events)) {
                const goalEvents = events.filter(e => e.type === 'Goal' && e.comments !== 'Penalty Shootout' && e.detail !== 'Missed Penalty');
                const shootoutEvents = events.filter(e => e.type === 'Goal' && e.comments === 'Penalty Shootout');
                
                if (goalEvents.length > 0) {
                    replyText += `⚽️ ผู้ทำประตู:\n`;
                    goalEvents.forEach(e => {
                        const playerName = e.player?.name || 'Unknown';
                        const teamName = e.team?.name || 'Unknown';
                        const minute = e.time?.elapsed + (e.time?.extra ? '+' + e.time.extra : '') + "'";
                        replyText += `- ${minute} ${playerName} (${teamName})\n`;
                    });
                    replyText += `\n`;
                }

                if (shootoutEvents.length > 0) {
                    let hPen = homePEN, aPen = awayPEN;
                    if (hPen === null || aPen === null) {
                        hPen = 0; aPen = 0;
                        shootoutEvents.forEach(e => {
                            if (e.detail === 'Penalty') {
                                if (e.team?.name === match.homeTeam || match.homeTeam.includes(e.team?.name)) hPen++;
                                else aPen++;
                            }
                        });
                    }
                    replyText += `🥅 ดวลจุดโทษตัดสิน: ${match.homeTeam} ${hPen} - ${aPen} ${match.awayTeam}\n`;
                    shootoutEvents.forEach(e => {
                        const playerName = e.player?.name || 'Unknown';
                        const teamName = e.team?.name || 'Unknown';
                        const icon = e.detail === 'Penalty' ? '✅' : '❌';
                        replyText += `${icon} ${playerName} (${teamName})\n`;
                    });
                    replyText += `\n`;
                }
            }
            
            // Stats (Possession)
            if (Array.isArray(stats) && stats.length === 2) {
                const homePossession = stats[0]?.statistics?.find(s => s.type === 'Ball Possession')?.value || '-';
                const awayPossession = stats[1]?.statistics?.find(s => s.type === 'Ball Possession')?.value || '-';
                replyText += `📊 ครองบอล: ${homePossession} - ${awayPossession}\n\n`;
            }

            // 3. Calculate Predictions and Send per Group
            const allPreds = await getLatestPredictions();
            
            const updatedMatch = getAllFixturesCache().find(m => String(m.matchId) === String(match.matchId)) || match;

            for (const groupId of groupIds) {
                let groupReplyText = replyText + `--- 🏆 สรุปคะแนนการทายผลคู่นี้ ---\n`;
                const groupPreds = allPreds.filter(p => p.groupId === groupId && String(p.matchId) === String(match.matchId));
                
                let hasGuesser = false;
                for (const p of groupPreds) {
                    hasGuesser = true;
                    const ptsObj = calculatePoints(p.prediction, p.outcome, homeScore, awayScore, updatedMatch, p.predAET, p.predPEN);
                    const pts = ptsObj.total;
                    let resultStr = `ได้ ${pts} แต้ม`;
                    if (updatedMatch.homeScoreAET !== null || updatedMatch.homeScorePEN !== null) {
                        resultStr += ` (90m:${ptsObj.pts90}, AET:${ptsObj.ptsAET}, PEN:${ptsObj.ptsPEN})`;
                    }
                    
                    let guessStr = `${p.prediction} (${p.outcome})`;
                    if (p.predAET) guessStr += ` AET:${p.predAET}`;
                    if (p.predPEN) guessStr += ` PEN:${p.predPEN}`;
                    groupReplyText += `- คุณ ${p.displayName} ทายว่า ${guessStr} 👉 ${resultStr}\n`;
                }
                
                if (!hasGuesser) {
                    groupReplyText += `(ไม่มีใครทายผลคู่นี้เลย)\n`;
                }
                
                groupReplyText += `\nพิมพ์ /rank เพื่อดูตารางคะแนนรวมทั้งหมดครับ! 👑`;
                groupReplyText += `\nพิมพ์ /rank32 เพื่อดูตารางคะแนนเฉพาะตั้งแต่รอบ 32 ทีม`;
                groupReplyText += `\nพิมพ์ /rank16 เพื่อดูตารางคะแนนเฉพาะตั้งแต่รอบ 16 ทีม`;

                try {
                  await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: groupReplyText }] });
                } catch (e) {
                  console.error(`Push message error for group ${groupId}:`, e.response ? e.response.data : e.message);
                }
            }
        }
    }
  });
  // 3. Daily News Summary (08:00 and 18:00 Thailand time -> 01:00 and 11:00 UTC)
  cron.schedule('0 1,11 * * *', async () => {
    const groupIds = await getActiveGroupIds();
    if (groupIds.length === 0) return;

    try {
      const allMatches = getAllFixturesCache ? getAllFixturesCache() : [];
      const upcomingMatches = allMatches
        .filter(m => m.status === 'NS' || m.status === 'TBD')
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
        .slice(0, 3);
        
      let upcomingMatchesText = '';
      if (upcomingMatches.length > 0) {
        upcomingMatchesText = upcomingMatches.map(m => {
          const matchDate = new Date(m.startTime);
          const timeStr = matchDate.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
          const dateStr = matchDate.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit' });
          return `- ${m.homeTeam} vs ${m.awayTeam} (วันที่ ${dateStr} เวลา ${timeStr} น. เวลาไทย)`;
        }).join('\n');
      }

      const { getNewsSummaryMessage } = require('./news');
      const message = await getNewsSummaryMessage(upcomingMatchesText);
      if (message) {
        global.latestNewsSummary = message;
        for (const groupId of groupIds) {
          await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: message }] });
        }
      }
    } catch (e) {
      console.error("[Scheduler] Error pushing news summary:", e.message);
    }
  });

  console.log('[Scheduler] Cron jobs started.');
}

module.exports = { startScheduler };
