import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());


// =========================
// 🔑 OPENAI
// =========================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// =========================
// 📦 PRODUCTS
// =========================
let products = [];


// =========================
// 💬 SESSIONS
// =========================
let sessions = {};


// =========================
// 🏪 STORE INFO
// =========================
let storeKnowledge = "";

try {

  storeKnowledge =
    fs.readFileSync(
      "./store_knowledge.txt",
      "utf8"
    );

} catch {

  storeKnowledge = `
اسم المتجر:
قرية الهدايا

الشحن:
2-5 أيام داخل السعودية.

الدفع:
مدى - فيزا - أبل باي.

الاستبدال:
خلال 3 أيام.

الاسترجاع:
خلال يوم واحد.

رقم جوال المتجر:
0558000539

رابط المتجر:
https://gifts-village.sa
`;

}


// =========================
// 📦 LOAD PRODUCTS
// =========================
function loadProducts() {

  try {

    const file =
      xlsx.readFile(
        "./products.xlsx"
      );

    const sheet =
      file.Sheets[
        file.SheetNames[0]
      ];

    const data =
      xlsx.utils.sheet_to_json(
        sheet
      );

    products =
      data.map(function (p, i) {

        let image =
          String(
            p.image || ""
          ).split(",")[0].trim();

        return {

          id: i,

          title:
            p.name || "",

          description:
            p.description || "",

          price:
            p.price || "",

          image:
            image,

          url:
            p.url || ""

        };

      });

    console.log(
      "✅ PRODUCTS:",
      products.length
    );

  } catch (err) {

    console.log(
      "❌ EXCEL ERROR:",
      err
    );

  }

}

loadProducts();


// =========================
// 🧠 SAFE JSON
// =========================
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


// =========================
// ❤️ ROOT
// =========================
app.get("/", function (req, res) {

  res.send(
    "🌸 Yasmin AI Running"
  );

});


// =========================
// 💬 CHAT
// =========================
app.post("/chat", async function (req, res) {

  try {

    const sessionId =
      req.body.sessionId ||
      "guest";

    const message =
      req.body.message || "";

    if (!sessions[sessionId]) {

      sessions[sessionId] = {

        history: []

      };

    }

    const session =
      sessions[sessionId];

    session.history.push({

      role: "user",

      content: message

    });

    const catalog =
      products.map(function (p) {

        return `

ID:${p.id}

الاسم:
${p.title}

الوصف:
${p.description}

السعر:
${p.price}

`;

      }).join("\n");

    const ai =
      await openai.chat.completions.create({

        model:
          "gpt-4.1-mini",

        temperature: 0.7,

        messages: [

          {

            role: "system",

            content: `

أنتِ ياسمين 🌸

موظفة ذكية داخل متجر قرية الهدايا.

مهمتك:
- فهم العميل
- التفاعل الطبيعي
- اقتراح منتجات مناسبة
- الإجابة عن أسئلة المتجر فقط
- ممنوع تمامًا تسجيل الطلبات أو تأكيد تنفيذها أو قول:
(تمام بسوي طلبك / تم / أبشر / جاري تنفيذ الطلب / سجلت طلبك / أي صيغة مشابهة)

إذا طلب العميل تنفيذ طلب أو تسجيله:
اطلبي منه إتمام الطلب عبر المتجر أو التواصل على رقم المتجر فقط.

الرد يكون بصيغة مشابهة:
"🌸 لا أستطيع تسجيل الطلبات مباشرة، يمكنك إتمام الطلب عبر المتجر أو التواصل مع رقم خدمة العملاء."

إذا احتجتِ ترشيح منتجات:

أرجعي JSON فقط:

{
 "reply":"ردك",
 "recommend":true,
 "product_query":"وصف العميل"
}

إذا تحتاجين سؤال العميل:

{
 "reply":"سؤالك",
 "recommend":false
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

    const content =
      ai.choices[0]
      .message.content || "";

    session.history.push({

      role: "assistant",

      content: content

    });

    const parsed =
      safeJson(content);

    if (!parsed) {

      return res.json({

        reply:
          "🌸 ممكن توضّح لي أكثر؟",

        recommend: false

      });

    }

    // =========================
    // 🛍 RECOMMEND
    // =========================
    if (parsed.recommend) {

      const recAI =
        await openai.chat.completions.create({

          model:
            "gpt-4.1-mini",

          temperature: 0.2,

          messages: [

            {

              role: "system",

              content: `

اختر أفضل 3 منتجات مناسبة فقط.

أرجع JSON فقط:

{
 "products":[1,2,3]
}

القائمة:

${catalog}

`

            },

            {

              role: "user",

              content:
                parsed.product_query

            }

          ]

        });

      const recParsed =
        safeJson(
          recAI.choices[0]
          .message.content || ""
        );

      let selected = [];

      if (
        recParsed &&
        recParsed.products
      ) {

        selected =
          products.filter(
            p =>
              recParsed.products.includes(
                p.id
              )
          );

      }

      if (
        selected.length === 0
      ) {

        selected =
          products.slice(0, 3);

      }

      return res.json({

        reply:
          parsed.reply,

        recommend: true,

        products:
          selected

      });

    }

    return res.json({

      reply:
        parsed.reply,

      recommend: false

    });

  } catch (err) {

    console.log(
      "❌ CHAT ERROR:",
      err
    );

    return res.json({

      reply:
        "🌸 ياسمين لديها خلل تقني مؤقت",

      recommend: false

    });

  }

});


// =========================
// 📡 TELEGRAM (ADDED ONLY - NO CHANGES ELSEWHERE)
// =========================
async function sendTelegramMessage(text) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text
      })
    });
  } catch (err) {
    console.log("❌ TELEGRAM ERROR:", err.message);
  }
}


// =========================
// ⭐ REVIEW (ONLY ADD TELEGRAM CALL)
// =========================
app.post("/review", async function (req, res) {

  try {

    const review = {

      orderId:
        req.body.orderId ||
        "غير معروف",

      customer:
        req.body.customer ||
        "عميل",

      rating:
        req.body.rating || 0,

      date:
        new Date().toISOString()

    };

    let reviews = [];

    try {

      reviews =
        JSON.parse(
          fs.readFileSync(
            "./reviews.json",
            "utf8"
          )
        );

    } catch {}

    reviews.push(review);

    fs.writeFileSync(

      "./reviews.json",

      JSON.stringify(
        reviews,
        null,
        2
      )

    );

    // =========================
    // NEW: GET CHAT HISTORY
    // =========================
    const sessionId = req.body.sessionId || "guest";
    const history = sessions[sessionId]?.history || [];

    const chatText = history.map(h => `${h.role}: ${h.content}`).join("\n");

    // =========================
    // NEW: TELEGRAM SEND
    // =========================
    await sendTelegramMessage(
      `⭐ تقييم جديد
📦 الطلب: ${review.orderId}
👤 العميل: ${review.customer}
⭐ التقييم: ${review.rating}/5
📅 التاريخ: ${review.date}

💬 المحادثة:
${chatText}`
    );

    res.json({
      success: true
    });

  } catch (err) {

    console.log(
      "❌ REVIEW ERROR:",
      err
    );

    res.json({
      success: false
    });

  }

});


// =========================
// 🚀 START
// =========================
const PORT =
  process.env.PORT || 3000;

app.listen(PORT, function () {

  console.log(
    "🌸 SERVER RUNNING:",
    PORT
  );

});
