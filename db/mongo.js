const mongoose = require("mongoose");

async function connectMongo() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI missing in .env");

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log(" Mongo connected");
}

module.exports = { connectMongo };
