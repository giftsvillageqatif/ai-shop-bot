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
// AUTO CATEGORY (NO EXCEL NEEDED)
// =========================
function autoCategory(title, desc) {
  const text = (title + " " + desc).toLowerCase();

  if (text.includes("باربي") || text.includes("دمية") || text.includes("makeup") || text.includes("مكياج")) {
    return "بنات";
  }

  if (text.includes("سيارة") || text.includes("طيارة") || text.includes("روبوت") || text.includes("مسدس")) {
    return "أولاد";
  }

  if (text.includes("lego") || text.includes("تعليمي") || text.includes("ألغاز") || text.includes("مكعبات")) {
    return "أطفال";
  }

  return "عام";
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
      url: p.url || "",

      category: autoCategory(p.name || "", p.description || "")
    }));

    console.log("✅ PRODUCTS LOADED:", products.length);

  } catch (err) {
    console.log("❌ PRODUCTS ERROR:", err);
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

    const catalog = products.map(p =>
      `ID:${p.id} | ${p.title} | ${p.category} | ${p.price}`
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
 "product_query":"بنات / أولاد / أطفال"
}

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
    // NORMAL RESPONSE
    // =========================
    if (!parsed) {
      return res.json({
        reply: content,
        recommend: false
      });
    }

    // =========================
    // SMART FILTER (FIXED CATEGORY)
    // =========================
    if (parsed.recommend) {

      const query = (parsed.product_query || "").toLowerCase();

      let filtered = products.filter(p => {

        const text = (p.title + " " + p.description + " " + p.category).toLowerCase();

        if (query.includes("بنات")) return text.includes("بنات");
        if (query.includes("اولاد") || query.includes("أولاد")) return text.includes("أولاد");
        if (query.includes("أطفال")) return text.includes("أطفال");

        return true;
      });

      // منع تكرار داخل المحادثة
      const used = session.shownProducts;
      session.shownProducts = used;

      filtered = filtered.filter(p =>
        !used.includes(p.id) && p.image && p.url
      );

      if (filtered.length === 0) {
        filtered = products.filter(p => p.image && p.url);
      }

      const selected = filtered.slice(0, 3);

      selected.forEach(p => used.push(p.id));

      return res.json({
        reply: parsed.reply,
        recommend: true,
        products: selected
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
// REVIEW (EMAIL FIXED)
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
