import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    room: { type: Schema.Types.ObjectId, ref: "Room", default: null },
  },
  { timestamps: true },
);

const roomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    inviteCode: { type: String, required: true, unique: true },
    currency: { type: String, default: "Rs" },
    timezone: { type: String, default: "Asia/Colombo" },
  },
  { timestamps: true },
);

const itemSchema = new Schema({ name: String, amount: Number }, { _id: false });

const expenseSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    paidBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: [itemSchema],
    total: { type: Number, required: true },
    splitAmong: [{ type: Schema.Types.ObjectId, ref: "User" }],
    source: { type: String, enum: ["chat", "receipt", "fallback"], default: "chat" },
    rawText: String,
  },
  { timestamps: true },
);

const settlementSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    from: { type: Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
  },
  { timestamps: true },
);

const messageSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: "User", default: null }, // null = RoomPot bot
    text: { type: String, required: true },
    hasImage: { type: Boolean, default: false },
    expense: { type: Schema.Types.ObjectId, ref: "Expense", default: null },
  },
  { timestamps: true },
);

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

export const User = model("User", userSchema);
export const Room = model("Room", roomSchema);
export const Expense = model("Expense", expenseSchema);
export const Settlement = model("Settlement", settlementSchema);
export const Message = model("Message", messageSchema);
