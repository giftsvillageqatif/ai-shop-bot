import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(cors());

// 🛍 المنتجات
let products = [];

// 📊 تحميل Excel
function loadExcel() {

  try {

    const path = "./products.xlsx";

    if (!fs.existsSync(path)) {
      console.log("❌ products.xlsx not found");
      return;
    }

    const file = xlsx.readFile(path);
    const sheet = file.Sheets[file.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    products = data.map(p => ({
      title: p.name || "",
      image: p.image || "",
      url: p.url || "",
      price: Number(p.price || 0),
      tags: (p.tags || "").toString().toLowerCase()
    }));

    console.log("✅ Products loaded:", products.length);

  } catch (err) {
    console.log("❌ Excel error:", err.message);
  }
}

// تشغيل عند البداية
loadExcel();

// 🧠 API التوصيات (مع نظام الأسئلة الجديد)
app.post("/recommend", async (req, res) => {

  try {

    const answers = {
  q0: req.body.q0 || "",
  q1: req.body.q1 || "",
  q2: req.body.q2 || ""
};

const text = (answers.q0 + " " + answers.q1 + " " + answers.q2).toLowerCase().trim();

    // نجمع كل إجابات المستخدم في نص واحد
    const text = Object.values(answers).join(" ").toLowerCase();

    if (!text) {
      return res.json({
        reply: "ياسمين تحتاج بعض المعلومات",
        products: []
      });
    }

    // 🧠 Ranking بسيط مثل أمازون
    let scored = products.map(p => {

      let score = 0;

      if (text.includes("ولد") && p.tags.includes("اولاد")) score += 10;
      if (text.includes("بنت") && p.tags.includes("بنات")) score += 10;
      if (text.includes("مولود") && p.tags.includes("اطفال")) score += 5;

      if (text.includes("عيد") && p.tags.includes("عيد")) score += 10;
      if (text.includes("عيد ميلاد") && p.tags.includes("عيد")) score += 10;

      if (text.includes("100") && p.price < 100) score += 10;
      if (text.includes("200") && p.price >= 100 && p.price <= 300) score += 8;
      if (text.includes("300") && p.tags.includes("فاخر")) score += 10;

      return { ...p, score };
      
      

    });

    // ترتيب النتائج
    scored.sort((a, b) => b.score - a.score);

    const top = scored.slice(0, 3).map(p => ({
      title: p.title,
      image: p.image,
      url: p.url
    }));

    res.json({
      reply: "اخترت لك أفضل المنتجات بناءً على إجاباتك 👇",
      products: top
    });

  } catch (err) {

    console.log("❌ SERVER ERROR:", err);

    res.status(500).json({
      reply: "ياسمين لديها خلل تقني",
      products: []
    });

  }

});

// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});        title: p.name || "",
        image: p.image || "",
        url: p.url || "",
        price: Number(p.price || 0),
        tags: (p.tags || "").toString().toLowerCase()
      };
    });

    console.log("✅ Products loaded:", products.length);

  } catch (err) {
    console.log("❌ Excel error:", err.message);
  }
}

// تشغيل عند البداية
loadExcel();

// 🧠 API التوصيات
app.post("/recommend", async (req, res) => {

  try {

    const msg = (req.body.message || "").toLowerCase();

    if (!msg) {
      return res.json({
        reply: "اكتب طلبك أول",
        products: []
      });
    }

    // 🤖 فهم الطلب بالـ AI
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "أنت مساعد متجر ذكي. افهم طلب العميل (هدية، رياضة، أطفال، رخيص، فاخر)."
        },
        {
          role: "user",
          content: msg
        }
      ]
    });

    const analysis = ai.choices[0].message.content.toLowerCase();

    // 🧠 ranking مثل أمازون
    let scored = products.map(function(p) {

      let score = 0;

      if (analysis.includes("هدية") && p.tags.includes("هدية")) score += 10;
      if (analysis.includes("عيد") && p.tags.includes("عيد")) score += 10;
      if (analysis.includes("رخيص") && p.price < 100) score += 10;
      if (analysis.includes("فاخر") && p.tags.includes("فاخر")) score += 10;
      if (analysis.includes("رياضة") && p.tags.includes("رياضة")) score += 10;

      return Object.assign({}, p, { score: score });

    });

    scored.sort(function(a, b) {
      return b.score - a.score;
    });

    const top = scored.slice(0, 3).map(function(p) {
      return {
        title: p.title,
        image: p.image,
        url: p.url
      };
    });

    res.json({
      reply: "تم اختيار أفضل المنتجات لك 👇",
      products: top
    });

  } catch (err) {

    console.log("❌ SERVER ERROR:", err);

    res.status(500).json({
      reply: "ياسمين لديها خلل تقني",
      products: []
    });

  }

});

// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("🚀 Server running on port " + PORT);
});
