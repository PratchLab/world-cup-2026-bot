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

  try {
    // Step 1: AI picks best 1 + top 10
    const pickPrompt = `จากรายชื่อพาดหัวข่าวด้านล่างนี้ ให้ทำ 2 อย่าง:
1. เลือก 1 ข่าวที่น่าสนใจที่สุดสำหรับแฟนบอลไทย (ข่าวเด่น)
2. เลือกอีก 10 ข่าวที่น่าสนใจรองลงมา (ข่าวน่าติดตาม)

กฎ:
- เลือกเฉพาะข่าวที่เกี่ยวกับฟุตบอลโลก 2026 (รายการแข่งขันที่จัดในปี 2026) เท่านั้น
- ห้ามเลือกข่าวที่พูดถึงผลการแข่งขันของฟุตบอลโลกปีอื่น (2018, 2022 ฯลฯ) มาเป็นข่าวหลัก
- ห้ามเลือกข่าวฟุตบอลหญิง หรือกีฬาอื่นที่ไม่ใช่ฟุตบอลโลกชาย 2026
- ห้ามเลือกข่าวที่เป็นแค่ราคาต่อรอง วิธีดูบอล หรือโปรโมชั่นเว็บพนัน
- ตอบในรูปแบบนี้เท่านั้น: best:5 top:1,3,7,8,9,11,12,13,14,15

รายชื่อข่าว:
${newsText}`;

    const pickRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: pickPrompt }],
      max_tokens: 60,
    });
    
    const pickOutput = pickRes.choices[0].message.content.trim();
    console.log(`[News] AI pick result: "${pickOutput}"`);
    
    // Parse: "best:5 top:1,3,7,8,9,11,12,13,14,15"
    const bestMatch = pickOutput.match(/best:\s*(\d+)/);
    const topMatch = pickOutput.match(/top:\s*([\d,\s]+)/);
    
    const bestIdx = bestMatch ? parseInt(bestMatch[1]) - 1 : 0;
    const topIdxs = topMatch 
      ? topMatch[1].split(',').map(s => parseInt(s.trim()) - 1).filter(i => !isNaN(i) && i >= 0 && i < newsList.length)
      : [];
    
    const bestNews = newsList[bestIdx] || newsList[0];
    const topNews = topIdxs.map(i => newsList[i]).filter(Boolean).slice(0, 10);
    
    console.log(`[News] Best: "${bestNews.title}"`);
    console.log(`[News] Top ${topNews.length} headlines selected`);

    // Step 2: Summarize the best article
    const summarizePrompt = `# Role
คุณคือนักข่าวกีฬาและคอลัมนิสต์ฟุตบอลตัวยง เป็นผู้ชายวัย Gen Y ชื่อ "ว.ค.26" ที่มีสไตล์การเล่าเรื่องสนุกสนาน กวนนิดๆ เป็นกันเอง และรู้ลึกรู้จริงเรื่องฟุตบอลโลก 2026

# Task
จากพาดหัวข่าวนี้: "${bestNews.title}"
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
    
    let mainArticle = sumRes.choices[0].message.content.trim();

    // Step 3: Translate top 10 headlines to Thai
    if (topNews.length > 0) {
      const topHeadlines = topNews.map((n, i) => `${i+1}. ${n.title}`).join('\n');
      
      const translatePrompt = `แปลพาดหัวข่าวฟุตบอลโลก 2026 ด้านล่างนี้เป็นภาษาไทยแบบกระชับสั้นๆ ให้ได้ใจความ
- แปลให้สั้นกระชับ ไม่เกิน 1 บรรทัดต่อข่าว
- ใส่ Emoji ธงชาติหรือ Emoji ที่เกี่ยวข้องนำหน้าแต่ละข่าว
- ตอบเป็นรายการ 1-10 โดยใส่แค่ข่าวที่แปลแล้ว ไม่ต้องใส่อย่างอื่น
- ห้ามเพิ่มสกอร์ที่ไม่ได้อยู่ในพาดหัวข่าวต้นฉบับ

พาดหัวข่าว:
${topHeadlines}`;

      const transRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: translatePrompt }],
        max_tokens: 500,
      });
      
      const translatedHeadlines = transRes.choices[0].message.content.trim();
      mainArticle += `\n\n📌 **ข่าวน่าติดตามอื่นๆ:**\n${translatedHeadlines}`;
    }

    return mainArticle;
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
