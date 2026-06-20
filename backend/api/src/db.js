import mongoose from "mongoose";
export async function connectDb(url) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(url);
  console.log("✅ Mongo conectado");
}
