import express from "express";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";

const app = express();

app.use(express.json());
app.use(cors());

// 🛍 المنتجات
let products = [];

// 📊 تحميل ملف Excel
function loadExcel() {

  try {

    const path = "./products.xlsx";

    if (!fs.existsSync(path)) {

      console.log("❌ products.xlsx not found");

      return;

    }

    const file = xlsx.readFile(path);

    const sheet = file.Sheets[file.SheetNames[0]];

    const data = xlsx.utils.sheet_to_json(sheet);

    products = data.map(function (p) {

      return {

        title: p.name || "",
        image: p.image || "",
        url: p.url || "",
        price: Number(p.price || 0),

        // نحول tags إلى array
        tags: (p.tags || "")
          .toString()
          .toLowerCase()
          .split(",")

      };

    });

    console.log("✅ Products loaded:", products.length);

  } catch (err) {

    console.log("❌ Excel error:", err);

  }

}

// تشغيل تحميل المنتجات
loadExcel();


// 🧠 API التوصيات
app.post("/recommend", async (req, res) => {

  try {

    const category = (req.body.category || "").toLowerCase();
    const occasion = (req.body.occasion || "").toLowerCase();
    const extra = (req.body.extra || "").toLowerCase();

    const text =
      (category + " " + occasion + " " + extra)
      .trim()
      .toLowerCase();

    console.log("📩 REQUEST:", text);

    // لو ما فيه بيانات
    if (!text) {

      return res.json({

        reply: "اكتب طلبك أول",
        products: []

      });

    }

    // 🧠 ترتيب المنتجات
    let scored = products.map(function (p) {

      let score = 0;

      // 👦 ولد
      if (
        category.includes("ولد") &&
        p.tags.includes("ولد")
      ) {
        score += 30;
      }

      // 👧 فتاة
      if (
        category.includes("فتاة") &&
        p.tags.includes("فتاة")
      ) {
        score += 30;
      }

      // 👶 مولود
      if (
        category.includes("مولود") &&
        p.tags.includes("مولود")
      ) {
        score += 30;
      }

      // 🎁 هدية
      if (
        occasion.includes("هدية") &&
        p.tags.includes("هدية")
      ) {
        score += 15;
      }

      // 🏀 رياضة / كرة
      if (
        text.includes("كرة") ||
        text.includes("رياضة") ||
        text.includes("سلة")
      ) {

        if (p.tags.includes("رياضة")) {
          score += 20;
        }

      }

      // 💖 وردي
      if (
        text.includes("وردي")
      ) {

        if (p.tags.includes("وردي")) {
          score += 10;
        }

      }

      // ✨ فاخر
      if (
        text.includes("فخم") ||
        text.includes("فاخر")
      ) {

        if (p.tags.includes("فاخر")) {
          score += 15;
        }

      }

      // 🎮 ألعاب
      if (
        text.includes("لعبة") ||
        text.includes("ألعاب")
      ) {

        if (p.tags.includes("ألعاب")) {
          score += 20;
        }

      }

      return {

        title: p.title,
        image: p.image,
        url: p.url,
        score: score

      };

    });

    // ترتيب حسب السكور
    scored.sort(function (a, b) {

      return b.score - a.score;

    });

    // أفضل 3 منتجات
    const top = scored.slice(0, 3);

    res.json({

      reply: "هذه أفضل المنتجات المناسبة لك 👇",

      products: top

    });

  } catch (err) {

    console.log("❌ SERVER ERROR:", err);

    res.status(500).json({

      reply: "حدث خطأ في السيرفر",

      products: []

    });

  }

});


// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {

  console.log("🚀 Server running on port " + PORT);

});
