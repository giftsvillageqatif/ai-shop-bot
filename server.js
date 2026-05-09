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


// 📦 تحميل المنتجات
function loadExcel() {

  const file = xlsx.readFile("./products.xlsx");
  const sheet = file.Sheets[file.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet);

  products = data.map(function (p, i) {

    var tags = (p.tags || "")
      .toString()
      .toLowerCase()
      .split(",")
      .map(function (t) {
        return t.trim();
      });

    return {
      id: i,
      title: p.name || "",
      image: p.image || "",
      url: p.url || "",
      price: Number(p.price || 0),
      tags: tags
    };

  });

  console.log("✅ Products loaded:", products.length);
}

loadExcel();


// 🧠 فهم بسيط ذكي (بدون تعقيد embeddings وقت التشغيل)
function detectCategory(text) {

  text = text.toLowerCase();

  if (text.includes("مولود") || text.includes("baby") || text.includes("newborn")) {
    return "مولود";
  }

  if (text.includes("بنت") || text.includes("girl")) {
    return "بنت";
  }

  if (text.includes("ولد") || text.includes("boy")) {
    return "ولد";
  }

  return null;
}


// 🌸 ياسمين (Sales Funnel Chat)
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

  var detected = detectCategory(msg);

  if (detected) {
    s.category = detected;
  }

  var reply = "";
  var ready = false;

  // 🧠 STEP 1
  if (s.step === 1) {

    if (!s.category) {
      reply = "🌸 لمين الهدية؟ (ولد / بنت / مولود)";
    } else {
      s.step = 2;

      if (s.category === "مولود") reply = "🌸 مبروك 👶 هدية ولا استخدام؟";
      if (s.category === "ولد") reply = "🌸 حلو 👍 مناسبة ولا عادي؟";
      if (s.category === "بنت") reply = "🌸 جميل ✨ مناسبة ولا عادي؟";
    }

  }

  // 🧠 STEP 2
  else if (s.step === 2) {

    s.intent = msg;
    s.step = 3;

    reply = "🌸 تمام 👍 تبغى شيء بسيط ولا فخم؟";

  }

  // 🧠 STEP 3
  else if (s.step === 3) {

    s.mood = msg;
    s.step = 4;
    ready = true;

    reply = "🌸 تمام فهمت ذوقك بالكامل، بختار لك أفضل المنتجات 👇";

  }

  res.json({
    reply: reply,
    ready: ready,
    session: s
  });

});


// 🛍 التوصية النهائية (فلترة ذكية قوية)
app.post("/recommend", function (req, res) {

  var s = req.body.session || {};

  var category = s.category;
  var intent = (s.intent || "").toLowerCase();
  var mood = (s.mood || "").toLowerCase();

  var filtered = products.filter(function (p) {

    var tags = p.tags || [];

    // 🔒 فلترة صارمة (أهم جزء)
    if (category === "مولود") {
      return tags.indexOf("مولود") !== -1;
    }

    if (category === "ولد") {
      return tags.indexOf("ولد") !== -1;
    }

    if (category === "بنت") {
      return tags.indexOf("بنت") !== -1;
    }

    return true;

  });

  var scored = filtered.map(function (p) {

    var score = 0;
    var tags = p.tags || [];

    // 🎯 intent
    if (intent.includes("هدية") && tags.indexOf("هدية") !== -1) {
      score += 30;
    }

    if (intent.includes("استخدام") && tags.indexOf("استخدام") !== -1) {
      score += 20;
    }

    // 🎨 mood
    if (mood.includes("فخم") && tags.indexOf("فاخر") !== -1) {
      score += 25;
    }

    if (mood.includes("بسيط") && tags.indexOf("بسيط") !== -1) {
      score += 25;
    }

    if (mood.includes("كيوت") && tags.indexOf("وردي") !== -1) {
      score += 25;
    }

    return {
      id: p.id,
      title: p.title,
      image: p.image,
      url: p.url,
      score: score
    };

  });

  scored.sort(function (a, b) {
    return b.score - a.score;
  });

  var top = scored.slice(0, 3);

  res.json({
    reply: "🌸 هذه أفضل الخيارات المناسبة لك:",
    products: top
  });

});


// 🚀 تشغيل السيرفر
app.listen(process.env.PORT || 3000, function () {
  console.log("🌸 Yasmin AI Store Running...");
});
