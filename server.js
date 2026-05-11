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
// EMAIL
// =========================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "giftsvillageqatif@gmail.com",
    pass: process.env.GMAIL_PASS
  }
});

// تحقق من الإيميل عند التشغيل
transporter.verify((err) => {
  if (err) {
    console.log("❌ EMAIL ERROR:", err.message);
  } else {
    console.log("📧 EMAIL READY");
  }
});

// =========================
// DATA
// =========================
let products = [];
let sessions = {};

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
    console.log("❌ PRODUCTS ERROR:", err);
  }
}

loadProducts();

// =========================
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("🌸 Yasmin AI Running");
});

// =========================
// CHAT FIXED (STABLE + NO BROKEN PRODUCTS)
// =========================
app.post("/chat", async (req, res) => {
  try {
    const sessionId = req.body.sessionId || "guest";
    const message = req.body.message || "";

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        history: [],
        shownProducts: []
      };
    }

    const session = sessions[sessionId];

    session.history.push({
      role: "user",
      content: message
    });

    // 📦 catalog (واضح للذكاء)
    const catalog = products.map(p =>
      `ID:${p.id}
NAME:${p.title}
PRICE:${p.price}
HAS_IMAGE:${!!p.image}
HAS_URL:${!!p.url}
`
    ).join("\n");

    const ai = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `
أنتِ ياسمين 🌸 متجر قرية الهدايا

إذا احتاج العميل منتجات → أرجع JSON:
{
 "reply":"...",
 "recommend":true,
 "product_query":"..."
}

غير كذا رد نص طبيعي.

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

    // =========================
    // SAFE PARSE
    // =========================
    let parsed = null;

    try {
      parsed = JSON.parse(
        content.replace(/```json/g, "").replace(/```/g, "").trim()
      );
    } catch {
      parsed = null;
    }

    // =========================
    // NORMAL TEXT RESPONSE
    // =========================
    if (!parsed) {
      return res.json({
        reply: content,
        recommend: false
      });
    }

    // =========================
    // PRODUCT SYSTEM (NO DUPLICATES + ONLY VALID PRODUCTS)
    // =========================
    if (parsed.recommend) {

      const used = session.shownProducts;
      session.shownProducts = used;

      const available = products.filter(p =>
        !used.includes(p.id) &&
        p.image &&
        p.url
      );

      const pool =
        available.length > 0
          ? available
          : products.filter(p => p.image && p.url);

      const selected = pool.slice(0, 3);

      selected.forEach(p => used.push(p.id));

      return res.json({
        reply: parsed.reply,
        recommend: true,
        products: selected.map(p => ({
          id: p.id,
          title: p.title,
          price: p.price,
          image: p.image,
          url: p.url
        }))
      });
    }

    return res.json({
      reply: parsed.reply || content,
      recommend: false
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
// REVIEW + EMAIL
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
      console.log("❌ GMAIL_PASS missing");
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
  console.log("🌸 SERVER RUNNING:", PORT);
});
