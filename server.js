import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import * as nodemailer from "nodemailer";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());


// 🔑 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 📧 Email
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
قرية الهدايا
هدايا - مواليد - مناسبات
شحن 2-5 أيام
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

    console.log("✅ Products:", products.length);

  } catch (err) {

    console.log("❌ Excel Error:", err);
    products = [];

  }

}

loadProducts();


// 🧹 جلسات
setInterval(() => {

  const now = Date.now();

  Object.keys(sessions).forEach(id => {

    const s = sessions[id];

    if (s.lastUsed && now - s.lastUsed > 1000 * 60 * 60) {
      delete sessions[id];
    }

  });

}, 600000);


// 🧠 JSON safe
function safeJson(text) {

  try {

    return JSON.parse(
      text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim()
    );

  } catch {
    return null;
  }

}


// ❤️ Home
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});


// 🎉 ORDER COMPLETED
app.post("/order-completed", async (req, res) => {

  try {

    const { sessionId, customer, orderId } = req.body;

    if (!sessionId || !sessions[sessionId]) {
      return res.json({ success: true });
    }

    sessions[sessionId].lastUsed = Date.now();

    // 📧 Email
    await transporter.sendMail({

      from: process.env.EMAIL_USER,
      to: "giftsvillageqatif@gmail.com",
      subject: "🛍 طلب مكتمل",

      html: `
        <h2>طلب جديد 🌸</h2>
        <p>العميل: ${customer}</p>
        <p>الطلب: ${orderId}</p>
        <p>Session: ${sessionId}</p>
      `

    });

    return res.json({
      success: true,
      message: `🌸 شكراً لك ${customer} 💖`
    });

  } catch (err) {

    console.log(err);

    return res.json({ success: false });

  }

});


// 💬 CHAT
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


    const catalog = products.map(p => `
ID:${p.id}
NAME:${p.title}
PRICE:${p.price}
`).join("\n");


    const ai = await openai.chat.completions.create({

      model: "gpt-4.1-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },

      messages: [

        {
          role: "system",
          content: `
أنتِ ياسمين 🌸

ارجع JSON:

{
  "reply": "...",
  "recommend": true,
  "products": [1,2]
}

المنتجات:
${catalog}
`
        },

        ...session.history

      ]

    });


    const content = ai.choices[0].message.content;
    const parsed = safeJson(content);

    if (!parsed) {
      return res.json({
        reply: "🌸 وضّح أكثر",
        recommend: false,
        products: [],
        sessionId
      });
    }


    const selected = products.filter(p =>
      parsed.products?.includes(p.id)
    );


    return res.json({
      reply: parsed.reply,
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

    await transporter.sendMail({

      from: process.env.EMAIL_USER,
      to: "giftsvillageqatif@gmail.com",
      subject: "⭐ تقييم جديد",

      html: `
        <p>العميل: ${req.body.customer}</p>
        <p>التقييم: ${req.body.rating}</p>
        <p>${req.body.review || ""}</p>
      `

    });

    res.json({ success: true });

  } catch (err) {

    console.log(err);
    res.json({ success: false });

  }

});


// 🚀 RUN
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 Running on", PORT);
});
