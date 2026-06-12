const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function fetchRecentNews() {
  const url = 'https://news.google.com/rss/search?q=World+Cup+2026&hl=en-US&gl=US&ceid=US:en';
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data, { xmlMode: true });
    const items = $('item');
    
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    
    const recentNews = [];
    
    items.each((i, el) => {
      const title = $(el).find('title').text();
      const pubDateStr = $(el).find('pubDate').text();
      const pubDate = new Date(pubDateStr);
      
      if (pubDate >= twelveHoursAgo) {
        recentNews.push({ title, pubDate: pubDate.toISOString() });
      }
    });
    
    return recentNews;
  } catch (err) {
    console.error('Error fetching news:', err.message);
    return [];
  }
}

async function summarizeNewsWithAI(newsList) {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set');
    return null;
  }
  
  if (newsList.length === 0) {
    return "ยังไม่มีข่าวอัปเดตใหม่ในรอบ 12 ชั่วโมงนี้ครับ รอติดตามกันต่อนะครับ! ⚽️";
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  const newsText = newsList.map((n, i) => `${i+1}. ${n.title}`).join('\n');
  
  const prompt = `
คุณคือนักข่าวฟุตบอลสายอินดี้ นามปากกา "ว.ค. 26" มีนิสัยกวนๆ ชอบแซะแบบมีสไตล์ และมักจะเชียร์ทีมอาร์เซนอลเป็นชีวิตจิตใจ
จงสรุปข่าวฟุตบอลโลก 2026 ต่อไปนี้ให้เป็นภาษาไทยที่อ่านสนุก กระชับ ความยาวประมาณ 80-100 คำ 
โดยใช้ Bullet points หรือ Emoji ให้สวยงาม น่าอ่าน 

หัวข้อข่าว:
${newsText}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Error from Gemini API:", error.message);
    return null;
  }
}

async function getNewsSummaryMessage() {
  const news = await fetchRecentNews();
  const summary = await summarizeNewsWithAI(news.slice(0, 10)); // Limit to 10 articles to save tokens and focus on top news
  if (!summary) return null;
  
  return `🗞️ **อัปเดตข่าวบอลโลก 2026 โดย ว.ค. 26**\n\n${summary}`;
}

module.exports = {
  fetchRecentNews,
  summarizeNewsWithAI,
  getNewsSummaryMessage
};
