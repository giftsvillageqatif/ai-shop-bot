import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());


// 🔑 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 📦 المنتجات
let products = [];


// 💬 الجلسات
let sessions = {};


// 🏪 معلومات المتجر
let storeKnowledge = "";

try {

  storeKnowledge = fs.readFileSync(
    "./store_knowledge.txt",
    "utf8"
  );

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
يحق للعميل استبدال المنتجات خلال (3) أيام من تاريخ الاستلام.

الاسترجاع:
يحق للعميل استرجاع المنتجات خلال (1) أيام من تاريخ الاستلام.
`;

}


// 📦 تحميل المنتجات
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

        return {

          id: i,

          title:
            p.name || "",

          description:
            p.description || "",

          price:
            p.price || "",

          image:
            p.image || "",

          url:
            p.url || ""

        };

      });

    console.log(
      "✅ Products Loaded:",
      products.length
    );

  } catch (err) {

    console.log(
      "❌ Excel Error:",
      err
    );

    products = [];

  }

}

loadProducts();


// 🧠 تنظيف JSON
function safeJson(text) {

  try {

    let clean =
      text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(clean);

  } catch {

    return null;

  }

}


// ❤️ الصفحة الرئيسية
app.get("/", function (req, res) {

  res.send(
    "🌸 Yasmin AI Store Running"
  );

});


// 💬 CHAT
app.post("/chat", async function (req, res) {

  try {

    const sessionId =
      req.body.sessionId ||
      "guest";

    const message =
      req.body.message || "";

    // 🧠 إنشاء جلسة
    if (!sessions[sessionId]) {

      sessions[sessionId] = {
        history: []
      };

    }

    const session =
      sessions[sessionId];

    // 💬 حفظ رسالة العميل
    session.history.push({

      role: "user",

      content: message

    });

    // 🛍 تجهيز المنتجات
    const catalog =
      products.map(function (p) {

        return `

ID: ${p.id}

اسم المنتج:
${p.title}

الوصف:
${p.description}

السعر:
${p.price}

`;

      }).join("\n");


    // 🧠 ياسمين
    const ai =
      await openai.chat.completions.create({

        model: "gpt-4.1-mini",

        temperature: 0.7,

        messages: [

          {

            role: "system",

            content: `

أنتِ ياسمين 🌸 موظفة متجر قرية الهدايا.

مهمتك:
- مساعدة العملاء داخل المتجر فقط
- الإجابة عن المنتجات
- الإجابة عن الشحن والدفع والاستبدال
- التفاعل الطبيعي مع العميل
- فهم احتياج العميل
- سؤال العميل عند الحاجة
- ترشيح منتجات مناسبة

ممنوع:
- الخروج عن موضوع المتجر
- الكلام عن السياسة أو البرمجة أو الدين
- اختراع معلومات غير موجودة

إذا فهمتِ العميل وتريدين ترشيح منتجات:

أرجعي JSON فقط:

{
  "reply": "ردك الطبيعي",
  "recommend": true,
  "product_query": "وصف ما يريده العميل"
}

إذا تحتاجين معلومات أكثر:

{
  "reply": "سؤالك الطبيعي",
  "recommend": false
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

    // 💬 حفظ رد ياسمين
    session.history.push({

      role: "assistant",

      content: content

    });

    const parsed =
      safeJson(content);

    // ❌ إذا فشل JSON
    if (!parsed) {

      return res.json({

        reply:
          "🌸 ممكن توضّح لي أكثر؟",

        recommend: false

      });

    }


    // 🛍 ترشيح المنتجات
    if (parsed.recommend) {

      const recAI =
        await openai.chat.completions.create({

          model: "gpt-4.1-mini",

          temperature: 0.3,

          messages: [

            {

              role: "system",

              content: `

أنت نظام ترشيح منتجات ذكي.

اختر أفضل 3 منتجات فقط من القائمة.

أرجع JSON فقط بهذا الشكل:

{
  "products": [1,2,3]
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

      const recContent =
        recAI.choices[0]
        .message.content || "";

      const recParsed =
        safeJson(recContent);

      let selected = [];

      if (
        recParsed &&
        recParsed.products
      ) {

        selected =
          products.filter(
            function (p) {

              return recParsed.products.indexOf(
                p.id
              ) !== -1;

            }
          );

      }

      // 🔥 fallback
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


    // 💬 فقط رد
    return res.json({

      reply:
        parsed.reply,

      recommend: false

    });

  } catch (err) {

    console.log(
      "❌ SERVER ERROR:",
      err
    );

    return res.json({

      reply:
        "🌸 عذراً، يوجد خلل تقني مؤقت",

      recommend: false

    });

  }

});


// ⭐ التقييمات
app.post("/review", function (req, res) {

  try {

    const review = {

      customer:
        req.body.customer ||
        "عميل",

      rating:
        req.body.rating || 0,

      sessionId:
        req.body.sessionId ||
        "unknown",

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

    res.json({
      success: true
    });

  } catch (err) {

    console.log(err);

    res.json({
      success: false
    });

  }

});


// 🚀 تشغيل السيرفر
const PORT =
  process.env.PORT || 3000;

app.listen(PORT, function () {

  console.log(
    "🌸 Yasmin AI Running On Port:",
    PORT
  );

});
