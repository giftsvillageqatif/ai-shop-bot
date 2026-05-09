import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let products = [];


// 📦 تحميل Excel
function loadExcel() {

  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map((p, i) => ({
    id: i,
    title: p.name || "",
    image: p.image || "",
    url: p.url || "",
    price: Number(p.price || 0),
    embedding: null
  }));

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🧠 Embedding function
async function embed(text) {

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return res.data[0].embedding;
}


// 🧠 تجهيز embeddings لكل المنتجات
async function buildEmbeddings() {

  for (var i = 0; i < products.length; i++) {

    var p = products[i];

    var text = p.title;

    p.embedding = await embed(text);
  }

  console.log("✅ Embeddings ready");
}

buildEmbeddings();


// 📊 cosine similarity
function cosine(a, b) {

  var dot = 0;
  var magA = 0;
  var magB = 0;

  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  return dot / (magA * magB);
}


// 🌸 ياسمين (فهم النية فقط)
async function yasmin(text) {

  try {

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
حلل الطلب إلى JSON فقط:

{
  "intent": "هدية | شراء | غير محدد"
}
`
        },
        { role: "user", content: text }
      ]
    });

    return JSON.parse(ai.choices[0].message.content);

  } catch (e) {

    return { intent: "غير محدد" };

  }

}


// 🚀 MAIN RECOMMENDATION ENGINE
app.post("/recommend", async (req, res) => {

  try {

    var text = (req.body.message || "");

    if (!text) {
      return res.json({
        reply: "كيف اساعدك ؟ 🌸",
        products: []
      });
    }

    // 🧠 1. فهم النية
    var parsed = await yasmin(text);

    // 🧠 2. تحويل الطلب إلى vector
    var queryVector = await embed(text);

    // 🧠 3. Semantic ranking
    var scored = products.map(function (p) {

      var score = cosine(queryVector, p.embedding || []);

      // 🎯 boost بسيط للنية
      if (parsed.intent === "هدية") {
        score += 0.05;
      }

      return {
        id: p.id,
        title: p.title,
        image: p.image,
        url: p.url,
        score: score
      };

    });

    // 🔥 ترتيب
    scored.sort(function (a, b) {
      return b.score - a.score;
    });

    var top = scored.slice(0, 3);

    res.json({
      reply: "🌸 ياسمين فهمت طلبك واختارت لك الأفضل:",
      products: top
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      reply: "ياسمين لديها خلل تقني",
      products: []
    });

  }

});


// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {
  console.log("🌸 Yasmin AI Semantic Store running on port " + PORT);
});
