import express from "express";
import type { Application, Request, Response } from "express";
import "dotenv/config";
import cors from "cors";
const app: Application = express();
const PORT = process.env.PORT || 7000;


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/", (req: Request, res: Response) => {
  return res.send("It's working 🙌");
});

const quotes = [
  { id: 1, quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { id: 2, quote: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
  { id: 3, quote: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { id: 4, quote: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { id: 5, quote: "In the end, it's not the years in your life that count. It's the life in your years.", author: "Abraham Lincoln" },
  { id: 6, quote: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { id: 7, quote: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" }
];

app.get("/quote", (req: Request, res: Response) => {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  return res.json(quotes[randomIndex]);
});
app.listen(PORT, () => console.log(`Server is running on PORT ${PORT}`));


