// Fills a local database with a demo room and three weeks of shared cooking costs.
// Usage: npm run seed:demo   (log in as sachindu / chathura / bimsara / ashan, password "demo1234")
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/roompot";
await mongoose.connect(uri);
const db = mongoose.connection.db;

const names = ["Sachindu", "Chathura", "Bimsara", "Ashan"];
const usernames = names.map((n) => n.toLowerCase());
const old = await db.collection("users").find({ username: { $in: usernames } }).toArray();
const oldRooms = [...new Set(old.map((u) => u.room).filter(Boolean).map(String))].map((id) => new mongoose.Types.ObjectId(id));
for (const c of ["expenses", "settlements", "messages"]) await db.collection(c).deleteMany({ room: { $in: oldRooms } });
await db.collection("rooms").deleteMany({ _id: { $in: oldRooms } });
await db.collection("users").deleteMany({ username: { $in: usernames } });

const DAY = 86_400_000;
const now = Date.now();
const start = new Date(now - 21 * DAY);

const roomId = new mongoose.Types.ObjectId();
await db.collection("rooms").insertOne({
  _id: roomId,
  name: "Room 12B",
  inviteCode: "DEMO12",
  currency: "Rs",
  timezone: "Asia/Colombo",
  createdAt: start,
  updatedAt: start,
});

const hash = await bcrypt.hash("demo1234", 10);
const users = names.map((name) => ({
  _id: new mongoose.Types.ObjectId(),
  name,
  username: name.toLowerCase(),
  passwordHash: hash,
  room: roomId,
  createdAt: start,
  updatedAt: start,
}));
await db.collection("users").insertMany(users);
const everyone = users.map((u) => u._id);

const pool = [
  ["rice 5kg", 1150], ["dhal", 640], ["eggs x10", 550], ["coconut x3", 360], ["chicken 1kg", 1250],
  ["onions", 320], ["potatoes", 380], ["vegetables", 650], ["bread", 180], ["milk powder", 1080],
  ["sugar", 290], ["tea leaves", 450], ["fish", 980], ["noodles", 420], ["cooking oil", 890],
];
let seed = 7;
const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

const expenses = [];
for (let d = 20; d >= 0; d--) {
  const trips = rand() < 0.35 ? 2 : rand() < 0.85 ? 1 : 0;
  for (let t = 0; t < trips; t++) {
    const n = 1 + Math.floor(rand() * 3);
    const items = Array.from({ length: n }, () => {
      const [name, base] = pool[Math.floor(rand() * pool.length)];
      return { name, amount: Math.round((base * (0.9 + rand() * 0.25)) / 10) * 10 };
    });
    const at = new Date(now - d * DAY - (8 - t * 5) * 3_600_000);
    expenses.push({
      room: roomId,
      paidBy: users[Math.floor(rand() * users.length)]._id,
      items,
      total: items.reduce((s, i) => s + i.amount, 0),
      splitAmong: everyone,
      source: "chat",
      createdAt: at,
      updatedAt: at,
    });
  }
  if (d === 14 || d === 3) {
    const at = new Date(now - d * DAY - 2 * 3_600_000);
    expenses.push({
      room: roomId, paidBy: users[d === 14 ? 0 : 2]._id, items: [{ name: "gas cylinder", amount: 3940 }],
      total: 3940, splitAmong: everyone, source: "chat", createdAt: at, updatedAt: at,
    });
  }
}
await db.collection("expenses").insertMany(expenses);

const settleAt = new Date(now - 7 * DAY);
await db.collection("settlements").insertOne({
  room: roomId, from: users[3]._id, to: users[0]._id, amount: 2000, createdAt: settleAt, updatedAt: settleAt,
});

await db.collection("messages").insertOne({
  room: roomId,
  author: null,
  text: "Demo room loaded with three weeks of cooking costs. Try “rice 1200, eggs 450” or ask “what's our average daily spend?”",
  createdAt: new Date(),
  updatedAt: new Date(),
});

console.log(`Seeded Room 12B: ${expenses.length} expenses, invite code DEMO12. Log in as sachindu / demo1234.`);
await mongoose.disconnect();
