import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/recommend", async (req, res) => {

  const message = req.body.message;

  const ai = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "أنت مساعد متجر هدايا." },
      { role: "user", content: message }
    ]
  });

  res.json({
    reply: ai.choices[0].message.content,
    products: []
  });

});

app.listen(3000);
