import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();

app.use(express.json());
app.use(cors());


// 🧠 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 📦 المنتجات
let products = [];


// 💬 الجلسات
let sessions = {};


// 🏪 معلومات المتجر
const storeKnowledge = fs.readFileSync(
  "./store_knowledge.txt",
  "utf8"
);


// 📦 تحميل المنتجات من Excel
function loadProducts() {

  const file = xlsx.readFile("./products.xlsx");

  const sheet = file.Sheets[file.SheetNames[0]];

  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map(function (p, i) {

    return {
      id: i,
      title: p.name || "",
      description: p.description || "",
      image: p.image || "",
      url: p.url || ""
    };

  });

  console.log("✅ Products Loaded:", products.length);

}

loadProducts();


// 🧠 CHAT
app.post("/chat", async function (req, res) {

  try {

    const sessionId = req.body.sessionId || "guest";

    const message = req.body.message || "";

    // 🧠 إنشاء جلسة
    if (!sessions[sessionId]) {

      sessions[sessionId] = {
        history: []
      };

    }

    const session = sessions[sessionId];

    // 💬 حفظ رسالة العميل
    session.history.push({
      role: "user",
      content: message
    });

    // 🛍 تجهيز كتالوج المنتجات
    const catalog = products.map(function (p) {

      return `
ID: ${p.id}

اسم المنتج:
${p.title}

وصف المنتج:
${p.description}
`;

    }).join("\n");


    // 🧠 ياسمين
    const ai = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [

        {
          role: "system",
          content: `
أنتِ ياسمين 🌸 موظفة متجر ذكية واحترافية.

مهمتك:
- مساعدة العملاء داخل المتجر فقط
- فهم احتياج العميل
- التفاعل بشكل طبيعي مثل موظفة حقيقية
- سؤال العميل إذا احتجت تفاصيل أكثر
- ترشيح منتجات مناسبة من المتجر فقط
- الإجابة عن سياسة المتجر والشحن والدفع والاستبدال

ممنوع:
- الخروج عن موضوع المتجر
- اختراع معلومات غير موجودة
- الكلام عن السياسة أو الدين أو البرمجة أو أي شيء خارج المتجر

إذا فهمتِ العميل وتريدين ترشيح منتجات:
أرجعي JSON فقط بهذا الشكل:

{
  "reply": "ردك الطبيعي",
  "recommend": true,
  "product_query": "وصف مختصر لما يريده العميل"
}

إذا لم تفهمي العميل بالكامل:
أرجعي JSON فقط بهذا الشكل:

{
  "reply": "سؤالك أو ردك الطبيعي",
  "recommend": false
}

معلومات المتجر:

${storeKnowledge}

كتالوج المنتجات:

${catalog}
`
        },

        ...session.history

      ]

    });


    let content = ai.choices[0].message.content;

    session.history.push({
      role: "assistant",
      content: content
    });


    let parsed;

    try {

      parsed = JSON.parse(content);

    } catch {

      parsed = {
        reply: content,
        recommend: false
      };

    }


    // 🛍 ترشيح المنتجات
    if (parsed.recommend) {

      const recommendAI = await openai.chat.completions.create({

        model: "gpt-4o-mini",

        messages: [

          {
            role: "system",
            content: `
أنت نظام توصيات متجر ذكي.

اختر أفضل 3 منتجات فقط من القائمة.

أرجع JSON فقط بهذا الشكل:

{
  "products": [1,5,2]
}

القائمة:

${catalog}
`
          },

          {
            role: "user",
            content: parsed.product_query
          }

        ]

      });


      let selected = [];

      try {

        const rec = JSON.parse(
          recommendAI.choices[0].message.content
        );

        selected = products.filter(function (p) {

          return rec.products.indexOf(p.id) !== -1;

        });

      } catch {

        selected = products.slice(0, 3);

      }


      return res.json({

        reply: parsed.reply,

        recommend: true,

        products: selected

      });

    }


    // 💬 فقط رد عادي
    res.json({

      reply: parsed.reply,

      recommend: false

    });

  } catch (err) {

    console.log(err);

    res.json({

      reply: "🌸 حصل خطأ بسيط، جرب مرة ثانية",

      recommend: false

    });

  }

});


// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, function () {

  console.log("🌸 Yasmin AI Store Running");

});
