const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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
  },
});

client.connect().then(() => {
  const db = client.db("pawlume_server");
  const petsCollection = db.collection("pets");

  console.log("✅ MongoDB connected!");

  // Home route
  app.get("/", (req, res) => {
    res.send("Welcome to Pawlume API 🚀");
  });

  // Pet listing route
  app.get("/pets", async (req, res) => {
    try {
      const { search = "", category = "", page = 1, limit = 6 } = req.query;

      const query = { adopted: false };
      if (search) query.name = { $regex: search, $options: "i" };
      if (category) query.category = { $regex: category, $options: "i" };

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const total = await petsCollection.countDocuments(query);
      const totalPages = Math.ceil(total / limit);

      const pets = await petsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      res.json({
        pets,
        totalPages,
        currentPage: parseInt(page),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch pets" });
    }
  });

  // Fetch pet details by ID
  app.get("/pets/:id", async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid pet ID" });
      }

      const pet = await petsCollection.findOne({ _id: new ObjectId(id) });
      if (!pet) return res.status(404).json({ error: "Pet not found" });

      res.json(pet);
    } catch (err) {
      console.error("❌ Error fetching pet by ID:", err);
      res.status(500).json({ error: "Failed to fetch pet" });
    }
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`✅ Pawlume Server is running on port ${PORT}`);
  });
}).catch(console.dir);
