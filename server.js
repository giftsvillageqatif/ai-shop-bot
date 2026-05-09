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
    title: p.name,
    image: p.image,
    url: p.url,
    tags: (p.tags || "").toLowerCase()
  }));

  console.log("Products:", products.length);
}

loadExcel();


// 🧠 AI فهم الطلب
async function understand(text) {

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
حلل النص إلى JSON فقط:

{
  "category": "ولد | بنت | مولود | غير",
  "intent": "هدية | استخدام | غير",
  "emotion": "فخم | بسيط | عادي"
}
`
      },
      { role: "user", content: text }
    ]
  });

  return JSON.parse(res.choices[0].message.content);
}


// 💬 CHAT (ياسمين التفاعلية)
app.post("/chat", async (req, res) => {

  let id = req.body.sessionId || "guest";
  let msg = (req.body.message || "");

  if (!sessions[id]) {
    sessions[id] = {
      step: 1,
      data: {}
    };
  }

  let s = sessions[id];

  let ai = await understand(msg);

  // حفظ البيانات تدريجيًا
  if (ai.category !== "غير") s.data.category = ai.category;
  if (ai.intent !== "غير") s.data.intent = ai.intent;
  if (ai.emotion !== "غير") s.data.emotion = ai.emotion;

  let reply = "";
  let ready = false;

  // 🧠 STEP 1
  if (s.step === 1) {

    if (!s.data.category) {
      reply = "🌸 لمين الهدية؟ (ولد / بنت / مولود)";
    } else {
      s.step = 2;

      if (s.data.category === "مولود") reply = "🌸 مبروك 👶 هدية ولا استخدام؟";
      if (s.data.category === "ولد") reply = "🌸 حلو 👍 مناسبة ولا عادي؟";
      if (s.data.category === "بنت") reply = "🌸 جميل ✨ مناسبة ولا عادي؟";
    }

  }

  // 🧠 STEP 2
  else if (s.step === 2) {

    s.step = 3;
    reply = "🌸 تمام 👍 تبغى شيء فخم ولا بسيط؟";

  }

  // 🧠 STEP 3
  else if (s.step === 3) {

    s.step = 4;
    ready = true;

    reply = "🌸 فهمت ذوقك بالكامل، بجيب لك أفضل الخيارات 👇";

  }

  res.json({
    reply,
    ready,
    session: s.data
  });

});


// 🛍 RECOMMEND
app.post("/recommend", (req, res) => {

  let s = req.body.session || {};

  let filtered = products.filter(p => {

    if (s.category === "مولود") return p.tags.includes("مولود");
    if (s.category === "ولد") return p.tags.includes("ولد");
    if (s.category === "بنت") return p.tags.includes("بنت");

    return true;

  });

  res.json({
    reply: "🌸 هذه أفضل الخيارات لك:",
    products: filtered.slice(0, 3)
  });

});


// 🚀 تشغيل
app.listen(process.env.PORT || 3000, () => {
  console.log("AI Store Running...");
});
