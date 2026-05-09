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

        title: (p.name || "").toString(),

        image: (p.image || "").toString(),

        url: (p.url || "").toString(),

        price: Number(p.price || 0),

        tags: (p.tags || "")
          .toString()
          .toLowerCase()
          .split(",")
          .map(function (tag) {

            return tag.trim();

          })

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

    const category =
      (req.body.category || "")
      .toLowerCase()
      .trim();

    const occasion =
      (req.body.occasion || "")
      .toLowerCase()
      .trim();

    const extra =
      (req.body.extra || "")
      .toLowerCase()
      .trim();

    console.log("📩 REQUEST:", {
      category,
      occasion,
      extra
    });

    // 🧠 فلترة القسم الأساسي
    let filtered = products.filter(function (p) {

      const tags = p.tags || [];

      // 👦 ولد
      if (category.includes("ولد")) {

        return tags.includes("ولد");

      }

      // 👧 فتاة / بنت
      if (
        category.includes("فتاة") ||
        category.includes("بنت")
      ) {

        return (
          tags.includes("فتاة") ||
          tags.includes("بنت")
        );

      }

      // 👶 مولود
      if (category.includes("مولود")) {

        return tags.includes("مولود");

      }

      return false;

    });

    // ❌ إذا ما لقى منتجات
    if (filtered.length === 0) {

      return res.json({

        reply: "ما لقيت منتجات مناسبة",

        products: []

      });

    }

    // 🧠 حساب السكور
    let scored = filtered.map(function (p) {

      let score = 0;

      const tags = p.tags || [];

      // 🎁 مناسبة هدية
      if (
        occasion.includes("هدية") &&
        tags.includes("هدية")
      ) {

        score += 50;

      }

      // 🧠 الكلمات الإضافية
      extra.split(" ").forEach(function (word) {

        word = word.trim();

        if (!word) return;

        // تطابق مباشر مع tags
        if (tags.includes(word)) {

          score += 40;

        }

        // 🏀 رياضة
        if (
          word.includes("كرة") ||
          word.includes("رياضة") ||
          word.includes("سلة")
        ) {

          if (
            tags.includes("رياضة") ||
            tags.includes("كرة")
          ) {

            score += 30;

          }

        }

        // 🎮 ألعاب
        if (
          word.includes("لعبة") ||
          word.includes("ألعاب")
        ) {

          if (
            tags.includes("ألعاب") ||
            tags.includes("لعبة")
          ) {

            score += 30;

          }

        }

        // 💖 وردي
        if (
          word.includes("وردي")
        ) {

          if (tags.includes("وردي")) {

            score += 20;

          }

        }

        // ✨ فاخر
        if (
          word.includes("فاخر") ||
          word.includes("فخم")
        ) {

          if (
            tags.includes("فاخر") ||
            tags.includes("فخم")
          ) {

            score += 20;

          }

        }

      });

      return {

        title: p.title,
        image: p.image,
        url: p.url,
        score: score

      };

    });

    // ترتيب
    scored.sort(function (a, b) {

      return b.score - a.score;

    });

    // حذف المنتجات الضعيفة
    scored = scored.filter(function (p) {

      return p.score > 0;

    });

    // 🧠 fallback عشوائي من نفس القسم
    if (scored.length === 0) {

      filtered.sort(function () {

        return 0.5 - Math.random();

      });

      scored = filtered;

    }

    // أفضل 3
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
