const axios = require('axios');
const cheerio = require('cheerio');
const { OpenAI } = require('openai');

async function fetchRecentNews() {
  const urlNews = 'https://news.google.com/rss/search?q=World+Cup+2026&hl=en-US&gl=US&ceid=US:en';
  const urlOdds = 'https://news.google.com/rss/search?q=World+Cup+2026+betting+odds&hl=en-US&gl=US&ceid=US:en';
  const urlPlayers = 'https://news.google.com/rss/search?q=World+Cup+2026+players+managers&hl=en-US&gl=US&ceid=US:en';
  
  try {
    const [resNews, resOdds, resPlayers] = await Promise.all([
      axios.get(urlNews),
      axios.get(urlOdds),
      axios.get(urlPlayers)
    ]);
    
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const recentNews = [];
    const seenTitles = new Set();
    
    const parseFeed = (xmlData) => {
      const $ = cheerio.load(xmlData, { xmlMode: true });
      $('item').each((i, el) => {
        const title = $(el).find('title').text();
        const pubDateStr = $(el).find('pubDate').text();
        const pubDate = new Date(pubDateStr);
        
        if (pubDate >= twelveHoursAgo && !seenTitles.has(title)) {
          seenTitles.add(title);
          recentNews.push({ title, pubDate: pubDate.toISOString() });
        }
      });
    };
    
    parseFeed(resNews.data);
    parseFeed(resOdds.data);
    parseFeed(resPlayers.data);
    
    // Sort by newest
    recentNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    return recentNews;
  } catch (err) {
    console.error('Error fetching news:', err.message);
    return [];
  }
}

async function summarizeNewsWithAI(newsList) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    return null;
  }
  
  if (newsList.length === 0) {
    return "ยังไม่มีข่าวอัปเดตใหม่ในรอบ 12 ชั่วโมงนี้ครับ รอติดตามกันต่อนะครับ! ⚽️";
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const newsText = newsList.map((n, i) => `${i+1}. ${n.title}`).join('\n');
  
  const prompt = `
# Role
คุณคือนักข่าวกีฬาและคอลัมนิสต์ฟุตบอลตัวยง เป็นผู้ชายวัย Gen Y ชื่อ "ว.ค.26" ที่มีสไตล์การเล่าเรื่องสนุกสนาน กวนนิดๆ เป็นกันเอง และรู้ลึกรู้จริงเรื่องฟุตบอลโลก 2026

# Context
คุณต้องสรุปข่าวสารฟุตบอลโลก 2026 จากข้อมูลดิบรูปแบบ RSS Feed เพื่อนำไปส่งอัปเดตใน "LINE Group" ของกลุ่มเพื่อนหรือแฟนบอลคอมมูนิตี้ทุกๆ 12 ชั่วโมง ข้อมูลดิบจะประกอบด้วยผลการแข่งขัน สถิติผู้เล่น เหตุการณ์สำคัญ บทสัมภาษณ์ และราคาต่อรอง ซึ่งคุณต้องนำมาย่อยให้อ่านง่ายและลื่นไหลที่สุดบนหน้าจอสมาร์ตโฟน

# Task
เขียนข้อความสรุปข่าวฟุตบอลโลก 2026 โดยดึงข้อมูลไฮไลต์ที่สำคัญมาเล่าใหม่ในสไตล์ของ "ว.ค.26" พร้อมตกแต่งข้อความด้วย Emoji ให้ดูมีสีสัน น่าอ่าน และเหมาะกับการส่งต่อในแอปพลิเคชัน LINE

# Goal
สร้างข่าวสารอัปเดตที่สดใหม่ รวดเร็ว กระชับ ทำให้สมาชิกในกลุ่ม LINE รู้สึกตื่นเต้น มีอารมณ์ร่วม และติดตามสถานการณ์ฟุตบอลโลก 2026 ได้อย่างครบถ้วนและสนุกสนานโดยไม่ต้องไปหาอ่านที่อื่นเพิ่ม

# Format
โครงสร้างข้อความแบบ Markdown ที่ปรับให้เข้ากับการอ่านใน LINE:
- **พาดหัวข่าว (Headline):** สั้น กระแทกใจ พร้อม Emoji ดึงดูดสายตา เช่น 🚨⚽🔥
- **สรุปผลสกอร์ (Match Results):** รายงานผลแมตช์ล่าสุดแบบกระชับ (เช่น 🇧🇷 บราซิล 2 - 0 ฝรั่งเศส 🇫🇷)
- **ไฮไลต์เด็ด (Key Highlights):** ใครยิงประตู ใครเจ็บ หรือใครโดนใบแดงไล่ออก ใช้ Bullet Points เพื่อให้อ่านง่าย
- **วาทะเด็ด (Manager Quotes):** หยิบคำสัมภาษณ์กวนๆ หรือดุดันของกุนซือมาขยี้ 🎤
- **ราคาต่อรอง / เกร็ดน่ารู้ (Betting Odds / Trivia):** แทรกราคาต่อรองหรือข้อมูลสถิติที่น่าสนใจ (ถ้ามีใน Feed) 📊
- **แมตช์ต่อไป (Upcoming Matches):** โปรแกรมแข่งขันรอบถัดไป พร้อมเวลาเตะ ⏰

# Constraints
- ความยาวของข้อความทั้งหมดต้องรวมแล้วอยู่ที่ไม่เกิน 500 คำ 
- ใช้สำนวนภาษาแบบ Gen Y (เช่น ตึงจัด, ตัวตึง, ยับๆ, เดือดมาก, เอาเรื่อง) เหมือนเพื่อนเมาท์มอยเรื่องฟุตบอลให้เพื่อนในกลุ่มฟัง
- ห้ามใช้ภาษาทางการ ภาษาข่าวที่แข็งทื่อ หรือคำศัพท์ที่อ่านแล้วน่าเบื่อเด็ดขาด
- ต้องใช้ Emoji แทรกในประโยคและหัวข้อต่างๆ อย่างพอดี ไม่รกหรือล้นจนเกินไป เพื่อดึงดูดสายตา
- ต้องเว้นบรรทัด (Line Break) ระหว่างหัวข้อและพารากราฟให้ชัดเจน เพื่อไม่ให้ข้อความติดกันเป็นพืดเวลาอ่านใน LINE
- คัดเลือกและสรุปเฉพาะข่าวเกี่ยวกับฟุตบอลโลก 2026 ชายเท่านั้น กีฬาอื่นตัดทิ้ง
- ห้ามแนบ Link หรือ URL ใดๆ ให้อ่านจากชื่อข่าวแล้วสรุปด้วยคำพูดของคุณเอง

หัวข้อข่าวที่มี:
${newsText}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Using gpt-4o-mini for speed and cost efficiency
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error from OpenAI API:", error.message);
    return null;
  }
}

async function getNewsSummaryMessage() {
  const news = await fetchRecentNews();
  const summary = await summarizeNewsWithAI(news.slice(0, 10)); // Limit to 10 articles to save tokens and focus on top news
  if (!summary) return null;
  
  const now = new Date();
  const thTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hour = thTime.getUTCHours();
  
  let period = "";
  if (hour >= 5 && hour <= 12) {
    period = "รอบเช้า ☀️";
  } else if (hour >= 15 && hour <= 20) {
    period = "รอบเย็น 🌆";
  } else {
    period = "อัปเดตด่วน ⚡";
  }
  
  // Create a nice Thai date string, e.g. "12 มิถุนายน 2569"
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const dateStr = `${thTime.getUTCDate()} ${months[thTime.getUTCMonth()]} ${thTime.getUTCFullYear() + 543}`;
  
  return `🗞️ **อัปเดตข่าวบอลโลก 2026 โดย ว.ค. 26**\n🗓️ ประจำวันที่ ${dateStr} (${period})\n\n${summary}`;
}

module.exports = {
  fetchRecentNews,
  summarizeNewsWithAI,
  getNewsSummaryMessage
};
