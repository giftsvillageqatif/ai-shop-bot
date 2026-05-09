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
let sessions = {};


// 📦 تحميل المنتجات من Excel
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


// 🧠 Embedding
async function embed(text) {

  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return res.data[0].embedding;
}


// 🧠 تجهيز embeddings
async function buildEmbeddings() {

  for (var i = 0; i < products.length; i++) {

    var p = products[i];
    p.embedding = await embed(p.title);

  }

  console.log("✅ Embeddings ready");
}

buildEmbeddings();


// 📊 similarity
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


// 🌸 ياسمين (Sales Funnel AI)
app.post("/chat", function (req, res) {

  var id = req.body.sessionId || "guest";
  var msg = (req.body.message || "").toLowerCase();

  if (!sessions[id]) {
    sessions[id] = {
      step: 1,
      category: null,
      intent: null,
      mood: null
    };
  }

  var s = sessions[id];
  var reply = "";
  var ready = false;

  if (s.step === 1) {

    if (msg.indexOf("ولد") !== -1) {
      s.category = "ولد";
      s.step = 2;
      reply = "🌸 تمام، ولد 👍 هل المناسبة هدية ولا استخدام؟";

    } else if (msg.indexOf("بنت") !== -1) {
      s.category = "بنت";
      s.step = 2;
      reply = "🌸 حلو ✨ مناسبة ولا عادية؟";

    } else if (msg.indexOf("مولود") !== -1) {
      s.category = "مولود";
      s.step = 2;
      reply = "🌸 مبروك 👶 هدية مولود ولا استخدام؟";

    } else {
      reply = "🌸 لمين الهدية؟ (ولد / بنت / مولود)";
    }

  }

  else if (s.step === 2) {

    s.intent = msg;
    s.step = 3;

    reply = "🌸 جميل! تبغى شيء بسيط ولا فخم؟";

  }

  else if (s.step === 3) {

    s.mood = msg;
    s.step = 4;
    ready = true;

    reply = "🌸 تمام فهمت ذوقك، بجيب لك أفضل الخيارات الآن 👇";

  }

  res.json({
    reply: reply,
    ready: ready,
    session: s
  });

});


// 🛍 التوصية النهائية (Semantic AI)
app.post("/recommend", async function (req, res) {

  var s = req.body.session || {};
  var text = (s.intent || "") + " " + (s.mood || "");

  var queryVec = await embed(text);

  var filtered = products.map(function (p) {

    var score = cosine(queryVec, p.embedding || []);

    return {
      id: p.id,
      title: p.title,
      image: p.image,
      url: p.url,
      score: score
    };

  });

  filtered.sort(function (a, b) {
    return b.score - a.score;
  });

  res.json({
    reply: "🌸 هذه أفضل الاختيارات لك:",
    products: filtered.slice(0, 3)
  });

});


// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, function () {
  console.log("🌸 AI Store Running...");
});
