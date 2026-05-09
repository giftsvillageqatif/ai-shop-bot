import express from "express";
import OpenAI from "openai";
import cors from "cors";
import xlsx from "xlsx";

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🛍 منتجات (بدّلها بـ Zid API لاحقًا)
let products = [
  {
    id: 1,
    title: "بوكس هدية فاخر",
    image: "https://media.zid.store/sample1.jpg",
    url: "https://gifts-village.sa/product1",
    tags: ["فاخر", "زوجة", "عيد", "رومانسي"],
    score: 0
  },
  {
    id: 2,
    title: "هدية بسيطة",
    image: "https://media.zid.store/sample2.jpg",
    url: "https://gifts-village.sa/product2",
    tags: ["بسيط", "رخيص", "عام"],
    score: 0
  }
];

// 🧠 AI + Ranking
app.post("/recommend", async (req, res) => {

  const msg = req.body.message;

  // 1. فهم الطلب بالـ AI
  const ai = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
أنت نظام توصية مثل أمازون.
استخرج:
- المناسبة
- الميزانية
- نوع المنتج
`
      },
      {
        role: "user",
        content: msg
      }
    ]
  });

  const analysis = ai.choices[0].message.content.toLowerCase();

  // 2. Ranking (ذكاء بسيط يشبه أمازون)
  let scored = products.map(p => {

    let score = 0;

    for (let i = 0; i < p.tags.length; i++) {
      if (analysis.indexOf(p.tags[i]) !== -1) {
        score += 10;
      }
    }

    return { ...p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 3. أفضل 3 منتجات فقط (مثل أمازون)
  const top = scored.slice(0, 3).map(p => ({
    title: p.title,
    image: p.image,
    url: p.url
  }));

  res.json({
    reply: "تم اختيار أفضل المنتجات لك 👇",
    products: top
  });

});

app.listen(3000);
