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

async function pickAndSummarizeBestNews(newsList, upcomingMatchesText = "") {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    return null;
  }
  
  if (newsList.length === 0) {
    return "ยังไม่มีข่าวอัปเดตใหม่ในรอบ 12 ชั่วโมงนี้ครับ รอติดตามกันต่อนะครับ! ⚽️";
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const newsText = newsList.map((n, i) => `${i+1}. ${n.title}`).join('\n');

  // Step 1: Let AI pick the best 1 article
  try {
    const pickPrompt = `จากรายชื่อพาดหัวข่าวด้านล่างนี้ ให้เลือกมา 1 ข่าวที่น่าสนใจที่สุดสำหรับแฟนบอลไทย
กฎ:
- เลือกเฉพาะข่าวที่เกี่ยวกับฟุตบอลโลก 2026 (รายการแข่งขันที่จัดในปี 2026) เท่านั้น
- ห้ามเลือกข่าวที่พูดถึงผลการแข่งขันของฟุตบอลโลกปีอื่น (2018, 2022 ฯลฯ) มาเป็นข่าวหลัก
- ห้ามเลือกข่าวฟุตบอลหญิง หรือกีฬาอื่นที่ไม่ใช่ฟุตบอลโลกชาย 2026
- ห้ามเลือกข่าวที่เป็นแค่ราคาต่อรองหรือวิธีดูบอล ให้เลือกข่าวที่มีเนื้อหาสาระน่าสนใจ
- ตอบแค่ตัวเลขหมายเลขข่าวที่เลือก เช่น "3"

รายชื่อข่าว:
${newsText}`;

    const pickRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: pickPrompt }],
      max_tokens: 10,
    });
    
    const pickedNum = parseInt(pickRes.choices[0].message.content.trim());
    const pickedNews = newsList[pickedNum - 1] || newsList[0];
    
    console.log(`[News] AI picked #${pickedNum}: "${pickedNews.title}"`);

    // Step 2: Summarize the picked article in our own style
    const summarizePrompt = `# Role
คุณคือนักข่าวกีฬาและคอลัมนิสต์ฟุตบอลตัวยง เป็นผู้ชายวัย Gen Y ชื่อ "ว.ค.26" ที่มีสไตล์การเล่าเรื่องสนุกสนาน กวนนิดๆ เป็นกันเอง และรู้ลึกรู้จริงเรื่องฟุตบอลโลก 2026

# Task
จากพาดหัวข่าวนี้: "${pickedNews.title}"
ให้เขียนบทความสรุปข่าวนี้ใหม่ทั้งหมดในสำนวนของ "ว.ค.26" เพื่อส่งเข้ากลุ่ม LINE ของแฟนบอล

# Constraints
- เขียนใหม่ทั้งหมดด้วยคำพูดของคุณเอง ห้ามแปลตรงตัวจากพาดหัวข่าว
- ใช้สำนวนภาษาแบบ Gen Y (เช่น ตึงจัด, ตัวตึง, ยับๆ, เดือดมาก, เอาเรื่อง) เหมือนเพื่อนเมาท์มอยเรื่องฟุตบอลให้เพื่อนในกลุ่มฟัง
- ตกแต่งด้วย Emoji ให้ดูมีสีสัน แต่ไม่รกจนเกินไป
- ความยาวไม่เกิน 200 คำ
- ต้องเว้นบรรทัดระหว่างพารากราฟให้ชัดเจน เพื่อไม่ให้ข้อความติดกันเป็นพืดเวลาอ่านใน LINE
- ห้ามแนบ Link หรือ URL ใดๆ
- ห้ามสร้างสกอร์การแข่งขันขึ้นมาเองเด็ดขาด ถ้าพาดหัวข่าวไม่ได้ระบุสกอร์ ก็อย่าใส่สกอร์
- เน้นข้อมูลที่เกี่ยวข้องกับฟุตบอลโลก 2026 ที่กำลังจัดอยู่ตอนนี้เท่านั้น

# แมตช์ต่อไป
ต่อท้ายบทความด้วยหัวข้อ "แมตช์ต่อไป" โดยห้ามเดาเวลาเอง ให้ใช้ข้อมูลนี้เท่านั้น:
${upcomingMatchesText || 'ไม่มีข้อมูล (ให้ละเว้นหัวข้อนี้ไป)'}`;

    const sumRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: summarizePrompt }],
      max_tokens: 800,
    });
    
    return sumRes.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error from OpenAI API:", error.message);
    return null;
  }
}

async function getNewsSummaryMessage(upcomingMatchesText = "") {
  const news = await fetchRecentNews();
  const summary = await pickAndSummarizeBestNews(news.slice(0, 15), upcomingMatchesText);
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
  pickAndSummarizeBestNews,
  getNewsSummaryMessage
};
