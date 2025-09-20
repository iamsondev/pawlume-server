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

client
  .connect()
  .then(() => {
    const db = client.db("pawlume_server");
    const petsCollection = db.collection("pets");
    const adoptionsCollection = db.collection("adoptions");
    const donationCollection = db.collection("donationCampaigns");
    const usersCollection = db.collection("users");

    console.log("✅ MongoDB connected!");

    // Home route
    app.get("/", (req, res) => {
      res.send("Welcome to Pawlume API 🚀");
    });

    // Users
    // Add a user
    app.post("/users", async (req, res) => {
      try {
        const { name, email, role } = req.body;

        if (!email) return res.status(400).json({ error: "Email is required" });

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser)
          return res.status(200).json({ message: "User already exists" });

        const result = await usersCollection.insertOne({
          name: name || "Anonymous",
          email,
          role: role || "user",
          createdAt: new Date(),
        });

        res.status(201).json({
          message: "User added successfully",
          userId: result.insertedId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add user" });
      }
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

    // adaptation
    app.post("/adoptions", async (req, res) => {
      try {
        const {
          petId,
          petName,
          petImage,
          userName,
          userEmail,
          phone,
          address,
          status = "pending",
          createdAt = new Date(),
        } = req.body;

        if (!petId || !userName || !userEmail || !phone || !address) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        if (!ObjectId.isValid(petId)) {
          return res.status(400).json({ error: "Invalid pet ID" });
        }

        const pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
        if (!pet) return res.status(404).json({ error: "Pet not found" });
        if (pet.adopted)
          return res.status(400).json({ error: "Pet already adopted" });

        const adoption = {
          petId: new ObjectId(petId),
          petName,
          petImage,
          userName, // <-- use the userName from req.body
          userEmail,
          phone,
          address,
          status,
          createdAt: new Date(createdAt),
        };

        const result = await adoptionsCollection.insertOne(adoption);

        // Optionally mark pet as adopted immediately:
        // await petsCollection.updateOne({ _id: new ObjectId(petId) }, { $set: { adopted: true } });

        res.status(201).json({
          message: "Adoption request submitted successfully",
          adoptionId: result.insertedId,
        });
      } catch (err) {
        console.error("❌ Error submitting adoption:", err);
        res.status(500).json({ error: "Failed to submit adoption request" });
      }
    });

    // Donation

    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Pawlume Server is running on port ${PORT}`);
    });
  })
  .catch(console.dir);
