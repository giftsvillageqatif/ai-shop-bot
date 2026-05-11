import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";
import nodemailer from "nodemailer";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());

// =========================
// OPENAI
// =========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// EMAIL (FIXED + DEBUG)
// =========================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "giftsvillageqatif@gmail.com",
    pass: process.env.GMAIL_PASS
  }
});

// تأكد الاتصال عند تشغيل السيرفر
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ EMAIL SETUP ERROR:", error);
  } else {
    console.log("📧 EMAIL READY TO SEND");
  }
});

// =========================
// PRODUCTS
// =========================
let products = [];

// =========================
// SESSIONS
// =========================
let sessions = {};

// =========================
// STORE INFO
// =========================
let storeKnowledge = "";

try {
  storeKnowledge = fs.readFileSync("./store_knowledge.txt", "utf8");
} catch {
  storeKnowledge = "قرية الهدايا - متجر هدايا";
}

// =========================
// LOAD PRODUCTS
// =========================
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
      image: String(p.image || "").split(",")[0].trim(),
      url: p.url || ""
    }));

    console.log("✅ PRODUCTS LOADED:", products.length);
  } catch (err) {
    console.log("❌ EXCEL ERROR:", err);
  }
}

loadProducts();

// =========================
// CHAT
// =========================
app.post("/chat", async (req, res) => {
  try {
    const sessionId = req.body.sessionId || "guest";
    const message = req.body.message || "";

    if (!sessions[sessionId]) {
      sessions[sessionId] = { history: [] };
    }

    const session = sessions[sessionId];

    session.history.push({
      role: "user",
      content: message
    });

    const catalog = products.map(p =>
      `ID:${p.id}\nالاسم:${p.title}\nالسعر:${p.price}\n`
    ).join("\n");

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `
أنتِ ياسمين 🌸
متجر قرية الهدايا

إذا احتجت ترشيح منتجات أرجع JSON.
غير كذا رد طبيعي نص فقط.

المنتجات:
${catalog}
`
        },
        ...session.history
      ]
    });

    const content = ai.choices[0].message.content || "";

    session.history.push({
      role: "assistant",
      content
    });

    // ❌ لا نعتمد JSON بشكل صارم
    let parsed = null;

    try {
      parsed = JSON.parse(
        content.replace(/```json/g, "").replace(/```/g, "").trim()
      );
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return res.json({
        reply: content,
        recommend: false
      });
    }

    return res.json({
      reply: parsed.reply || content,
      recommend: parsed.recommend || false
    });

  } catch (err) {
    console.log("❌ CHAT ERROR:", err);

    return res.json({
      reply: "يوجد خطأ مؤقت",
      recommend: false
    });
  }
});

// =========================
// REVIEW + EMAIL FIXED
// =========================
app.post("/review", async (req, res) => {
  try {
    const review = {
      orderId: req.body.orderId || "غير معروف",
      customer: req.body.customer || "عميل",
      rating: req.body.rating || 0,
      date: new Date().toISOString()
    };

    let reviews = [];
    try {
      reviews = JSON.parse(fs.readFileSync("./reviews.json", "utf8"));
    } catch {}

    reviews.push(review);

    fs.writeFileSync("./reviews.json", JSON.stringify(reviews, null, 2));

    console.log("📩 Sending email...");

    if (!process.env.GMAIL_PASS) {
      console.log("❌ GMAIL_PASS NOT FOUND IN ENV");
    }

    const info = await transporter.sendMail({
      from: "giftsvillageqatif@gmail.com",
      to: "giftsvillageqatif@gmail.com",
      subject: "⭐ تقييم جديد",
      html: `
        <h2>تقييم جديد</h2>
        <p>الطلب: ${review.orderId}</p>
        <p>العميل: ${review.customer}</p>
        <p>التقييم: ${review.rating}/5</p>
        <p>التاريخ: ${review.date}</p>
      `
    });

    console.log("📧 EMAIL SENT:", info.messageId);

    res.json({ success: true });

  } catch (err) {
    console.log("❌ REVIEW ERROR:", err);

    res.json({
      success: false,
      error: err.message
    });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌸 SERVER RUNNING ON:", PORT);
});
