import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import nodemailer from "nodemailer";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());


// 🔑 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 📧 البريد
const transporter = nodemailer.createTransport({

  service: "gmail",

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }

});


// 📦 المنتجات
let products = [];


// 💬 الجلسات
const sessions = {};


// 🏪 معلومات المتجر
let storeKnowledge = "";

try {

  storeKnowledge = fs.readFileSync("./store_knowledge.txt", "utf8");

} catch {

  storeKnowledge = `
اسم المتجر: قرية الهدايا
متجر هدايا ومناسبات
الشحن 2-5 أيام داخل السعودية
الدفع مدى - فيزا - أبل باي
`;

}


// 📦 تحميل المنتجات
function loadProducts() {

  try {

    const file = xlsx.readFile("./products.xlsx");
    const sheet = file.Sheets[file.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    products = data.map((p, i) => ({
      id: i,
      title: p.name || "",
      description: p.description || "",
      price: p.price || "",
      image: p.image || "",
      url: p.url || ""
    }));

    console.log("✅ Products Loaded:", products.length);

  } catch (err) {

    console.log("❌ Excel Error:", err);
    products = [];

  }

}

loadProducts();


// 🧹 تنظيف الجلسات
setInterval(function () {

  const now = Date.now();

  Object.keys(sessions).forEach(function (id) {

    const s = sessions[id];

    if (s.lastUsed && now - s.lastUsed > 1000 * 60 * 60) {
      delete sessions[id];
    }

  });

}, 1000 * 60 * 10);


// 🧠 JSON safe
function safeJson(text) {

  try {

    let clean = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(clean);

  } catch {
    return null;
  }

}


// ❤️ home
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});


// 🎯 CHAT
app.post("/chat", async (req, res) => {

  try {

    let sessionId = req.body.sessionId;

    if (!sessionId) {
      sessionId = "guest_" + Date.now();
    }

    const message = req.body.message || "";

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        history: [],
        lastUsed: Date.now()
      };
    }

    const session = sessions[sessionId];

    session.lastUsed = Date.now();

    session.history.push({
      role: "user",
      content: message
    });

    if (session.history.length > 12) {
      session.history = session.history.slice(-12);
    }


    // 📦 كتالوج مبسط
    const catalog = products.map(function (p) {
      return `
ID:${p.id}
NAME:${p.title}
DESC:${p.description}
PRICE:${p.price}
`;
    }).join("\n");


    // 🤖 AI
    const ai = await openai.chat.completions.create({

      model: "gpt-4.1-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },

      messages: [

        {
          role: "system",
          content: `
أنتِ ياسمين 🌸

مهمتك:
تحليل نية العميل (intent) واختيار المنتجات المناسبة له.

الأنواع:
- هدايا نسائية
- أطفال
- مواليد
- مناسبات
- أفكار هدايا

ارجع JSON فقط:

{
  "reply": "رد طبيعي",
  "recommend": true,
  "intent": "wedding | baby | gift | kids | general"
}

معلومات المتجر:
${storeKnowledge}

المنتجات:
${catalog}
`
        },

        ...session.history

      ]

    });


    const content = ai.choices[0].message.content || "";
    const parsed = safeJson(content);

    if (!parsed) {
      return res.json({
        reply: "🌸 ممكن توضّح أكثر؟",
        recommend: false,
        products: [],
        sessionId
      });
    }


    // 🎯 ذكاء اختيار المنتجات حسب النية
    let selected = [];

    if (parsed.intent === "baby") {

      selected = products.filter(p =>
        p.title.includes("طفل") ||
        p.title.includes("مواليد")
      );

    }

    else if (parsed.intent === "gift") {

      selected = products.filter(p =>
        p.title.includes("هدية") ||
        p.description.includes("هدية")
      );

    }

    else if (parsed.intent === "wedding") {

      selected = products.filter(p =>
        p.title.includes("مناسبة") ||
        p.description.includes("زواج")
      );

    }

    else {

      selected = products.slice(0, 3);

    }


    return res.json({

      reply: parsed.reply || "",
      recommend: true,
      products: selected,
      sessionId

    });

  } catch (err) {

    console.log(err);

    return res.json({
      reply: "🌸 خطأ مؤقت",
      recommend: false,
      products: []
    });

  }

});


// ⭐ REVIEW
app.post("/review", async (req, res) => {

  try {

    const review = {
      customer: req.body.customer || "عميل",
      rating: req.body.rating || 0,
      review: req.body.review || "",
      sessionId: req.body.sessionId || "unknown",
      date: new Date().toISOString()
    };

    let reviews = [];

    try {
      reviews = JSON.parse(fs.readFileSync("./reviews.json", "utf8"));
    } catch {}

    reviews.push(review);

    fs.writeFileSync("./reviews.json", JSON.stringify(reviews, null, 2));


    await transporter.sendMail({

      from: process.env.EMAIL_USER,
      to: "giftsvillageqatif@gmail.com",
      subject: "⭐ تقييم جديد",

      html: `
        <h2>تقييم 🌸</h2>
        <p>${review.customer}</p>
        <p>${review.rating}/5</p>
        <p>${review.review}</p>
      `

    });

    res.json({ success: true });

  } catch (err) {

    console.log(err);
    res.json({ success: false });

  }

});


// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 Yasmin Running:", PORT);
});
