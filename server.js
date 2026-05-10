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

المتجر متخصص في:
الهدايا - الأطفال - المواليد - المناسبات.

الشحن:
خلال يوم عمل واحد لمناطق القطيف وضواحيها.
داخل السعودية خلال 2-5 أيام.

الدفع:
مدى - فيزا - أبل باي.

الاستبدال:
خلال 3 أيام من الاستلام.

الاسترجاع:
خلال يوم واحد من الاستلام.
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


// 🔄 تحديث المنتجات
setInterval(loadProducts, 1000 * 60 * 5);


// 🧹 تنظيف الجلسات
setInterval(() => {

  const now = Date.now();

  Object.keys(sessions).forEach((id) => {

    const s = sessions[id];

    if (s.lastUsed && now - s.lastUsed > 1000 * 60 * 60) {
      delete sessions[id];
    }

  });

}, 1000 * 60 * 10);


// 🧠 JSON
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


// ❤️ Home
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});


// 🎉 ORDER COMPLETED
app.post("/order-completed", async (req, res) => {

  try {

    const sessionId = req.body.sessionId;
    const customer = req.body.customer || "عميل";
    const orderId = req.body.orderId || "غير معروف";

    if (!sessionId || !sessions[sessionId]) {
      return res.json({ success: true });
    }

    const session = sessions[sessionId];

    session.lastUsed = Date.now();

    // 📧 إشعار إيميل
    await transporter.sendMail({

      from: process.env.EMAIL_USER,
      to: "giftsvillageqatif@gmail.com",
      subject: "🛍 طلب مكتمل جديد",

      html: `
        <h2>طلب مكتمل 🌸</h2>
        <p>العميل: <b>${customer}</b></p>
        <p>رقم الطلب: <b>${orderId}</b></p>
        <p>Session: <b>${sessionId}</b></p>
      `

    });

    return res.json({
      success: true,
      trigger: "order_completed",
      message: `🌸 شكراً لك ${customer} 💖 سعدنا بخدمتك، كيف تقييمك؟ ⭐`
    });

  } catch (err) {

    console.log(err);

    return res.json({
      success: false
    });

  }

});


// 💬 CHAT
app.post("/chat", async (req, res) => {

  try {

    let sessionId = req.body.sessionId;

    if (!sessionId) {
      sessionId = "guest_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
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

    // 🧠 أمر الطلب المكتمل
    if (message === "ORDER_COMPLETED") {

      return res.json({
        reply: "🌸 شكراً لطلبك 💖 سعدنا بخدمتك، كيف تقييمك؟ ⭐",
        recommend: false,
        products: [],
        sessionId
      });

    }

    session.history.push({
      role: "user",
      content: message
    });

    if (session.history.length > 12) {
      session.history = session.history.slice(-12);
    }

    const catalog = products.slice(0, 50).map(p => `
ID: ${p.id}
اسم: ${p.title}
سعر: ${p.price}
`).join("\n");


    let ai;

    try {

      ai = await Promise.race([

        openai.chat.completions.create({

          model: "gpt-4.1-mini",
          temperature: 0.7,
          response_format: { type: "json_object" },

          messages: [

            {
              role: "system",
              content: `
أنتِ ياسمين 🌸 موظفة متجر قرية الهدايا.

مهمتك:
- مساعدة العملاء فقط
- ترشيح منتجات
- التفاعل بلطف

أرجعي JSON فقط:

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

        }),

        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 25000)
        )

      ]);

    } catch {

      return res.json({
        reply: "🌸 النظام مشغول الآن",
        recommend: false,
        products: [],
        sessionId
      });

    }

    const content = ai.choices[0].message.content || "";
    session.history.push({ role: "assistant", content });

    const parsed = safeJson(content);

    if (!parsed) {
      return res.json({
        reply: "🌸 ممكن توضيح أكثر؟",
        recommend: false,
        products: [],
        sessionId
      });
    }

    let selected = [];

    if (Array.isArray(parsed.products)) {

      selected = products.filter(p =>
        parsed.products.includes(p.id)
      );

    }

    return res.json({
      reply: parsed.reply || "",
      recommend: parsed.recommend || false,
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
        <p>العميل: <b>${review.customer}</b></p>
        <p>التقييم: <b>${review.rating}</b></p>
        <p>${review.review}</p>
      `

    });

    res.json({ success: true });

  } catch (err) {

    console.log(err);

    res.json({ success: false });

  }

});


// 🚀 تشغيل
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 Yasmin Running:", PORT);
});
