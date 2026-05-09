import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

// 🤖 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 📦 المنتجات
let products = [];
let sessions = {};

function loadExcel() {
  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map((p, i) => {
    return {
      id: i,
      title: p.name || "",
      image: p.image || "",
      url: p.url || "",
      price: Number(p.price || 0),
      tags: (p.tags || "").toLowerCase().split(",").map(t => t.trim())
    };
  });

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🧠 AI فهم المحادثة
async function understandUser(message, session) {

  const prompt = `
أنت مساعد مبيعات ذكي لمتجر هدايا.

حلل رسالة العميل وارجع JSON فقط بدون شرح.

المطلوب:
- category: (مولود / ولد / بنت / غير معروف)
- intent: ماذا يريد (هدية / استخدام / غير واضح)
- mood: (فخم / بسيط / كيوت / غير معروف)
- readyToRecommend: true أو false
- reply: رد عربي قصير لطيف يكمل المحادثة

بيانات سابقة:
${JSON.stringify(session)}

رسالة العميل:
${message}

ارجع JSON فقط بهذا الشكل:
{
  "category": "",
  "intent": "",
  "mood": "",
  "readyToRecommend": false,
  "reply": ""
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a strict JSON generator." },
      { role: "user", content: prompt }
    ],
    temperature: 0.3
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (e) {
    return {
      category: "غير معروف",
      intent: "غير واضح",
      mood: "غير معروف",
      readyToRecommend: false,
      reply: "ممكن توضّح أكثر؟ 🌸"
    };
  }
}


// 💬 Chat endpoint
app.post("/chat", async (req, res) => {

  const id = req.body.sessionId || "guest";
  const msg = req.body.message || "";

  if (!sessions[id]) {
    sessions[id] = {};
  }

  const session = sessions[id];

  const ai = await understandUser(msg, session);

  // تحديث الجلسة
  session.category = ai.category;
  session.intent = ai.intent;
  session.mood = ai.mood;

  res.json({
    reply: ai.reply,
    ready: ai.readyToRecommend,
    session
  });

});


// 🛍 توصية المنتجات (بعد الفهم فقط)
app.post("/recommend", (req, res) => {

  const session = req.body.session || {};

  let filtered = products.filter(p => {

    if (session.category === "مولود") return p.tags.includes("مولود");
    if (session.category === "ولد") return p.tags.includes("ولد");
    if (session.category === "بنت") return p.tags.includes("بنت");

    return true;
  });

  let scored = filtered.map(p => {
    let score = 0;

    if (session.intent === "هدية" && p.tags.includes("هدية")) score += 30;
    if (session.intent === "استخدام" && p.tags.includes("استخدام")) score += 20;

    if (session.mood === "فخم" && p.tags.includes("فاخر")) score += 25;
    if (session.mood === "بسيط" && p.tags.includes("بسيط")) score += 25;
    if (session.mood === "كيوت" && p.tags.includes("وردي")) score += 25;

    return { ...p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  res.json({
    reply: "🌸 اخترت لك أفضل المنتجات بناءً على ذوقك:",
    products: scored.slice(0, 3)
  });

});


// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, () => {
  console.log("🌸 AI Store Running...");
});
