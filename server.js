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

// 🛍 المنتجات من Excel فقط
let products = [];

// 📊 تحميل Excel
function loadExcel() {

  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map(function(p) {
    return {
      title: p.name,
      image: p.image,
      url: p.url,
      price: p.price,
      tags: (p.tags || "").toString().toLowerCase()
    };
  });

  console.log("Products loaded:", products.length);
}

// تشغيل عند بدء السيرفر
loadExcel();

// 🧠 AI + Ranking
app.post("/recommend", async (req, res) => {

  const msg = req.body.message.toLowerCase();

  const ai = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "أنت نظام توصية مثل أمازون. استخرج نية المستخدم."
      },
      {
        role: "user",
        content: msg
      }
    ]
  });

  const analysis = ai.choices[0].message.content.toLowerCase();

  let scored = products.map(function(p) {

    let score = 0;

    if (analysis.indexOf("عيد") !== -1 && p.tags.indexOf("عيد") !== -1) score += 10;
    if (analysis.indexOf("رومانسي") !== -1 && p.tags.indexOf("رومانسي") !== -1) score += 10;
    if (analysis.indexOf("بسيط") !== -1 && p.tags.indexOf("بسيط") !== -1) score += 10;

    return Object.assign({}, p, { score: score });

  });

  scored.sort(function(a, b) {
    return b.score - a.score;
  });

  res.json({
    reply: "تم اختيار أفضل المنتجات لك 👇",
    products: scored.slice(0, 3)
  });

});

app.listen(3000, function() {
  console.log("Server running on port 3000");
});
