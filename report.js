// bot-service/report.js
// Utility to generate a pre‑match summary in the "North London Labs" style.
// The function receives an object with the four data sections and returns a Thai string.

const teamFlags = {
  "Algeria": "🇩🇿", "Argentina": "🇦🇷", "Australia": "🇦🇺", "Austria": "🇦🇹",
  "Belgium": "🇧🇪", "Bosnia and Herzegovina": "🇧🇦", "Brazil": "🇧🇷", "Canada": "🇨🇦",
  "Cape Verde": "🇨🇻", "Colombia": "🇨🇴", "Croatia": "🇭🇷", "Curaçao": "🇨🇼",
  "Czech Republic": "🇨🇿", "DR Congo": "🇨🇩", "Ecuador": "🇪🇨", "Egypt": "🇪🇬",
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "France": "🇫🇷", "Germany": "🇩🇪", "Ghana": "🇬🇭",
  "Haiti": "🇭🇹", "Iran": "🇮🇷", "Iraq": "🇮🇶", "Ivory Coast": "🇨🇮",
  "Japan": "🇯🇵", "Jordan": "🇯🇴", "Mexico": "🇲🇽", "Morocco": "🇲🇦",
  "Netherlands": "🇳🇱", "New Zealand": "🇳🇿", "Norway": "🇳🇴", "Panama": "🇵🇦",
  "Paraguay": "🇵🇾", "Portugal": "🇵🇹", "Qatar": "🇶🇦", "Saudi Arabia": "🇸🇦",
  "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Senegal": "🇸🇳", "South Africa": "🇿🇦", "South Korea": "🇰🇷",
  "Spain": "🇪🇸", "Sweden": "🇸🇪", "Switzerland": "🇨🇭", "Tunisia": "🇹🇳",
  "Turkey": "🇹🇷", "United States": "🇺🇸", "Uruguay": "🇺🇾", "Uzbekistan": "🇺🇿",
  "Thailand": "🇹🇭"
};
const getFlag = (team) => teamFlags[team] || "🏳️";

/**
 * Generate a pre‑match report.
 * @param {Object} data
 * @param {string} data.homeTeam            – ชื่อทีมเจ้าบ้าน
 * @param {string} data.awayTeam            – ชื่อทีมเยือน
 * @param {string} data.matchDateTime       – เวลาแมตช์ (เช่น "2026-06-10 18:00 (UTC+7)")
 * @param {Array}  data.homeXI              – รายชื่อผู้เล่นตัวจริงทีมเจ้าบ้าน (array of strings)
 * @param {Array}  data.awayXI              – รายชื่อผู้เล่นตัวจริงทีมเยือน (array of strings)
 * @param {Array}  data.news                – ข่าว/สัมภาษณ์ (array of strings, สั้น 1‑2 บรรทัด)
 * @param {Object} data.odds                – ราคาน้ำ (decimal) {home, draw, away, handicapHome, handicapAway}
 * @param {Object} data.prediction           – คาดการณ์ FiveThirtyEight {homeProb, drawProb, awayProb}
 * @returns {string} Thai report string in the requested style.
 */
function generatePreMatchReport(data) {
  const {homeTeam, awayTeam, matchDateTime, homeXI, awayXI, news, odds, prediction} = data;

  const listXI = (team, players) => `- ${team}: ${players.join(', ')}`;
  const listNews = news.map((n, i) => `  ${i+1}. ${n}`).join('\n');

  const oddsLine = `- ราคา (Decimal) – ${homeTeam} ${odds.home} – เสมอ ${odds.draw} – ${awayTeam} ${odds.away}`;
  const handicapLine = odds.handicapHome && odds.handicapAway ? `- แฮนดิแคป – ${homeTeam} ${odds.handicapHome} – ${awayTeam} ${odds.handicapAway}` : '';

  const predLine = `- ความน่าจะเป็น (FiveThirtyEight) – ชนะ ${homeTeam} ${prediction.homeProb}% – เสมอ ${prediction.drawProb}% – ชนะ ${awayTeam} ${prediction.awayProb}%`;

  return `ยินดีต้อนรับสู่แล็บฟุตบอลที่แสบสันที่สุดในย่านลอนดอนเหนือ! ผม **North London Labs** รายงานตัวครับ พร้อมจะมาชำแหละวงการลูกหนังด้วยสายตาแบบอินดี้ และหัวใจที่ภักดีต่อกองทัพ **"ปืนโต"** เท่านั้น ---

## 🎙️ ข้อมูลส่วนตัว: North London Labs
**สไตล์การรายงาน:** เน้นเม้าท์มอยวงใน เปรียบเทียบฟุตบอลกับชีวิตรักและเรื่องกินให้เห็นภาพชัดๆ มีความเสียดสีเล็กน้อยเพื่อความบันเทิง และที่สำคัญคือต้อง "งานดี" ทั้งเนื้อหาและมุกตลก

### 🕵️♂️ ปรัชญาการทำข่าวของผม:
* **มองแรง:** ใส่พวกชอบเต้าข่าวปลอม
* **เคาะ:** ตัดสินทุกจังหวะดราม่าแบบไม่มีกั๊ก
* **ไม่ลำไย:** ข่าวสด กระชับ ไม่เล้าหลือ

## ⚽ รายงานพิเศษ (Special Edition)
**วันเวลาที่รายงาน:** ${matchDateTime}

### 📋 ผู้เล่นตัวจริง (Starting XI)
${listXI(homeTeam, homeXI)}
${listXI(awayTeam, awayXI)}

### 🗞️ ข่าว/สัมภาษณ์ (Pre‑match)
${listNews}

### 💰 ราคาน้ำ (Betting odds)
${oddsLine}
${handicapLine}

### 🔮 คาดการณ์ (FiveThirtyEight)
${predLine}

### 💡 ทิ้งท้ายจาก Labs
ใครที่กำลังจิ้นอยากให้ **${homeTeam}** หรือ **${awayTeam}** ควรพิจารณาในมุมนี้ก่อนลงเดิมพันนะครับ อย่ารีบเคาะจนฟีลเป็น “เจอลูกศรที่พุ่งเข้าตรงหัวใจ” แล้วจะผิดพลาดแบบฟ้าโลด!  
**Stay tuned, Gunners!** 🔴⚪`;
}

/**
 * Generate Flex Message Carousel for upcoming matches
 */
function generateMatchesCarousel(matches) {
  const bubbles = matches.slice(0, 12).map(m => {
    // Format to Date and Time in Asia/Bangkok
    const d = new Date(m.startTime);
    const timeStr = d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    
    return {
      type: "bubble",
      size: "micro",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#0f172a",
        contents: [{ type: "text", text: String(m.stage || "World Cup"), color: "#ffffff", weight: "bold", size: "sm", align: "center", wrap: true }]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: timeStr, weight: "bold", size: "xl", align: "center", color: "#334155" },
          { type: "text", text: `${getFlag(m.homeTeam)} ${m.homeTeam}`, size: "sm", weight: "bold", align: "center", wrap: true },
          { type: "text", text: "vs", size: "xs", align: "center", color: "#94a3b8" },
          { type: "text", text: `${getFlag(m.awayTeam)} ${m.awayTeam}`, size: "sm", weight: "bold", align: "center", wrap: true },
          { 
            type: "box", layout: "vertical", backgroundColor: "#f1f5f9", cornerRadius: "sm", margin: "md",
            contents: [
              { type: "text", text: `ID: ${m.matchId}`, size: "sm", align: "center", color: "#1e293b", weight: "bold" }
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "xs",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#0ea5e9",
            height: "sm",
            action: {
              type: "clipboard",
              label: "กดคัดลอกคำสั่งทายผล",
              clipboardText: `/guess ${m.matchId} `
            }
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: "ตารางแข่ง 24 ชม. นี้มาแล้วพวก! เตรียมพิมพ์ทายผลกันได้เลย",
    contents: {
      type: "carousel",
      contents: bubbles
    }
  };
}

module.exports = { generatePreMatchReport, generateMatchesCarousel, getFlag };
