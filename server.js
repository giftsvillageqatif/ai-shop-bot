import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🛍 المنتجات
let products = [];

// 📊 تحميل Excel
function loadExcel() {

  const path = "./products.xlsx";

  if (!fs.existsSync(path)) {
    console.log("❌ products.xlsx not found");
    return;
  }

  const file = xlsx.readFile(path);
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
      .map(t => t.trim()),

    clicks: 0,
    views: 0
  }));

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🧠 AI parsing (فهم النية)
async function analyzeUser(text) {

  try {

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت محرك توصية متجر عالمي مثل Amazon.

حول طلب العميل إلى JSON فقط:

{
  "category": "ولد | فتاة | مولود | غير محدد",
  "intent": "هدية | استخدام شخصي | غير محدد",
  "mood": "كيوت | فخم | رياضي | عادي",
  "keywords": ["..."]
}
`
        },
        {
          role: "user",
          content: text
        }
      ]
    });

    return JSON.parse(ai.choices[0].message.content);

  } catch (e) {

    return {
      category: "غير محدد",
      intent: "غير محدد",
      mood: "غير محدد",
      keywords: []
    };

  }

}


// 🧠 Recommendation Engine
app.post("/recommend", async (req, res) => {

  try {

    const text = (req.body.message || "").toLowerCase();

    if (!text) {
      return res.json({
        reply: "اكتب طلبك عشان أساعدك 👌",
        products: []
      });
    }

    // 🧠 1. تحليل AI
    const parsed = await analyzeUser(text);

    console.log("🧠 AI:", parsed);

    // 🧠 2. scoring engine (Hybrid AI)
    let scored = products.map(p => {

      let score = 0;
      let reasons = [];

      const tags = p.tags || [];

      // 🎯 Category filter (أقوى وزن)
      if (parsed.category === "ولد" && tags.includes("ولد")) {
        score += 60;
        reasons.push("مناسب للولد");
      }

      if (parsed.category === "فتاة" && tags.includes("فتاة")) {
        score += 60;
        reasons.push("مناسب للفتاة");
      }

      if (parsed.category === "مولود" && tags.includes("مولود")) {
        score += 60;
        reasons.push("مناسب للمولود");
      }

      // 🎁 intent
      if (parsed.intent === "هدية" && tags.includes("هدية")) {
        score += 25;
        reasons.push("مناسب كهدية");
      }

      // 🎨 mood
      if (parsed.mood === "كيوت" && tags.includes("وردي")) score += 20;
      if (parsed.mood === "فخم" && tags.includes("فاخر")) score += 20;
      if (parsed.mood === "رياضي" && tags.includes("رياضة")) score += 20;

      // 🔍 keywords
      (parsed.keywords || []).forEach(k => {
        if (tags.includes(k.toLowerCase())) {
          score += 30;
          reasons.push("يطابق: " + k);
        }
      });

      // 🔥 Popularity boost (Amazon style)
      score += (p.clicks || 0) * 3;
      score += (p.views || 0) * 0.5;

      // 💰 slight preference for cheaper products (optional)
      if (p.price < 100) score += 5;

      return {
        id: p.id,
        title: p.title,
        image: p.image,
        url: p.url,
        price: p.price,
        score,
        reasons
      };

    });

    // 🧠 3. sorting
    scored.sort((a, b) => b.score - a.score);

    // ❌ remove useless
    scored = scored.filter(p => p.score > 0);

    // 🧠 fallback smart (no AI needed)
    if (scored.length === 0) {

      scored = products
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(p => ({
          id: p.id,
          title: p.title,
          image: p.image,
          url: p.url,
          score: 1,
          reasons: ["اقتراح عام"]
        }));

    }

    const top = scored.slice(0, 3);

    res.json({
      reply: "هذه أفضل المنتجات لك بناءً على ذوقك 👇",
      products: top,
      ai: parsed
    });

  } catch (err) {

    console.log("❌ ERROR:", err);

    res.status(500).json({
      reply: "حدث خطأ في السيرفر",
      products: []
    });

  }

});


// 📊 click tracking (learning system)
app.post("/click", (req, res) => {

  const id = req.body.id;

  const product = products.find(p => p.id === id);

  if (product) {
    product.clicks = (product.clicks || 0) + 1;
  }

  res.json({ ok: true });

});


// 🚀 server start
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Amazon-Level AI Store running on port " + PORT);
});      return {

        title: (p.name || "").toString(),

        image: (p.image || "").toString(),

        url: (p.url || "").toString(),

        price: Number(p.price || 0),

        tags: (p.tags || "")
          .toString()
          .toLowerCase()
          .split(",")
          .map(function (tag) {

            return tag.trim();

          })

      };

    });

    console.log("✅ Products loaded:", products.length);

  } catch (err) {

    console.log("❌ Excel error:", err);

  }

}

// تشغيل تحميل المنتجات
loadExcel();


// 🧠 API التوصيات
app.post("/recommend", async (req, res) => {

  try {

    const category =
      (req.body.category || "")
      .toLowerCase()
      .trim();

    const occasion =
      (req.body.occasion || "")
      .toLowerCase()
      .trim();

    const extra =
      (req.body.extra || "")
      .toLowerCase()
      .trim();

    console.log("📩 REQUEST:", {
      category,
      occasion,
      extra
    });

    // 🧠 فلترة القسم الأساسي
    let filtered = products.filter(function (p) {

      const tags = p.tags || [];

      // 👦 ولد
      if (category.includes("ولد")) {

        return tags.includes("ولد");

      }

      // 👧 فتاة / بنت
      if (
        category.includes("فتاة") ||
        category.includes("بنت")
      ) {

        return (
          tags.includes("فتاة") ||
          tags.includes("بنت")
        );

      }

      // 👶 مولود
      if (category.includes("مولود")) {

        return tags.includes("مولود");

      }

      return false;

    });

    // ❌ إذا ما لقى منتجات
    if (filtered.length === 0) {

      return res.json({

        reply: "ما لقيت منتجات مناسبة",

        products: []

      });

    }

    // 🧠 حساب السكور
    let scored = filtered.map(function (p) {

      let score = 0;

      const tags = p.tags || [];

      // 🎁 مناسبة هدية
      if (
        occasion.includes("هدية") &&
        tags.includes("هدية")
      ) {

        score += 50;

      }

      // 🧠 الكلمات الإضافية
      extra.split(" ").forEach(function (word) {

        word = word.trim();

        if (!word) return;

        // تطابق مباشر مع tags
        if (tags.includes(word)) {

          score += 40;

        }

        // 🏀 رياضة
        if (
          word.includes("كرة") ||
          word.includes("رياضة") ||
          word.includes("سلة")
        ) {

          if (
            tags.includes("رياضة") ||
            tags.includes("كرة")
          ) {

            score += 30;

          }

        }

        // 🎮 ألعاب
        if (
          word.includes("لعبة") ||
          word.includes("ألعاب")
        ) {

          if (
            tags.includes("ألعاب") ||
            tags.includes("لعبة")
          ) {

            score += 30;

          }

        }

        // 💖 وردي
        if (
          word.includes("وردي")
        ) {

          if (tags.includes("وردي")) {

            score += 20;

          }

        }

        // ✨ فاخر
        if (
          word.includes("فاخر") ||
          word.includes("فخم")
        ) {

          if (
            tags.includes("فاخر") ||
            tags.includes("فخم")
          ) {

            score += 20;

          }

        }

      });

      return {

        title: p.title,
        image: p.image,
        url: p.url,
        score: score

      };

    });

    // ترتيب
    scored.sort(function (a, b) {

      return b.score - a.score;

    });

    // حذف المنتجات الضعيفة
    scored = scored.filter(function (p) {

      return p.score > 0;

    });

    // 🧠 fallback عشوائي من نفس القسم
    if (scored.length === 0) {

      filtered.sort(function () {

        return 0.5 - Math.random();

      });

      scored = filtered;

    }

    // أفضل 3
    const top = scored.slice(0, 3);

    res.json({

      reply: "هذه أفضل المنتجات المناسبة لك 👇",

      products: top

    });

  } catch (err) {

    console.log("❌ SERVER ERROR:", err);

    res.status(500).json({

      reply: "حدث خطأ في السيرفر",

      products: []

    });

  }

});


// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {

  console.log("🚀 Server running on port " + PORT);

});
