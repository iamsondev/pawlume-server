const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require('mongodb');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r1yzage.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// 🔹 Connect and define db & collection directly
client.connect().then(() => {
  const db = client.db("pawlume_server");          // Database name
  const petsCollection = db.collection("pets");    // Collection name


  console.log("MongoDB connected!");

  // Simple route
  app.get("/", (req, res) => {
    res.send("Welcome to Pawlume API 🚀");
  });

  // Pets route
  app.get("/pets", async (req, res) => {
  try {
    const { search, category } = req.query;
    const query = { adopted: false };

    if (search) {
      query.name = { $regex: search, $options: "i" }; // case-insensitive search
    }
    if (category) {
      query.category = category;
    }

    const pets = await petsCollection
      .find(query)
      .sort({ createdAt: -1 }) // newest first
      .toArray();

    res.json(pets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
 });

  // Start Server
  app.listen(PORT, () => {
    console.log(`✅ Pawlume Server is running on port ${PORT}`);
  });

}).catch(console.dir);
