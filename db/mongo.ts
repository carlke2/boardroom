import mongoose from "mongoose";

export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI missing in .env");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log(" Mongo connected");
}
