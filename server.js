import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let products = [];
let sessions = {};

// 📦 تحميل المنتجات
function loadExcel() {
  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map((p, i) => ({
    id: i,
    title: p.name || "",
    image: p.image || "",
    url: p.url || "",
    price: Number(p.price || 0),
    tags: (p.tags || "")
      .toString()
      .toLowerCase()
      .split(",")
      .map(t => t.trim())
  }));

  console.log("✅ Products loaded:", products.length);
}

loadExcel();

// 🧠 فهم العميل بالـ AI
async function understandUser(message, session) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `
ارجع JSON فقط بدون شرح:

{
  "category": "مولود | ولد | بنت | غير واضح",
  "intent": "هدية | استخدام | تصفح | غير واضح",
  "mood": "فخم | بسيط | كيوت | غير واضح",
  "readyToRecommend": false,
  "reply": "رد عربي قصير لطيف"
}

المحادثة السابقة:
${JSON.stringify(session)}

رسالة العميل:
${message}
`
      }
    ],
    temperature: 0.2
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return {
      category: "غير واضح",
      intent: "غير واضح",
      mood: "غير واضح",
      readyToRecommend: false,
      reply: "وضح أكثر 🌸"
    };
  }
}

// 💬 chat endpoint
app.post("/chat", async (req, res) => {
  const id = req.body.sessionId || "guest";
  const msg = req.body.message || "";

  if (!sessions[id]) {
    sessions[id] = {};
  }

  const session = sessions[id];

  const ai = await understandUser(msg, session);

  session.category = ai.category;
  session.intent = ai.intent;
  session.mood = ai.mood;

  res.json({
    reply: ai.reply,
    ready: ai.readyToRecommend,
    session
  });
});

// 🛍️ التوصيات
app.post("/recommend", (req, res) => {
  const s = req.body.session || {};

  let result = products.map(p => {
    let score = 0;

    if (s.category && p.tags.includes(s.category)) score += 40;
    if (s.intent === "هدية" && p.tags.includes("هدية")) score += 30;
    if (s.mood === "فخم" && p.tags.includes("فاخر")) score += 25;
    if (s.mood === "بسيط" && p.tags.includes("بسيط")) score += 25;
    if (s.mood === "كيوت" && p.tags.includes("وردي")) score += 25;

    return {
      id: p.id,
      title: p.title,
      image: p.image,
      url: p.url,
      score
    };
  });

  result.sort((a, b) => b.score - a.score);

  res.json({
    reply: "🌸 هذه أفضل الخيارات لك:",
    products: result.slice(0, 3)
  });
});

// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 AI Shop Running...");
});
