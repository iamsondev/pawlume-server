const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_SK_KEY);

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Storage Configuration for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "pawlume", // Folder name in Cloudinary
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    upload_preset: process.env.VITE_CLOUDINARY_UPLOAD_PRESET,
  },
});

const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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

    // verify Firebase token
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).json({ message: "Unauthorized access" });
      }

      try {
        // ✅ Verify Firebase token
        const decoded = await admin.auth().verifyIdToken(token);

        // ✅ Fetch user role from DB
        const userInDB = await usersCollection.findOne({
          email: decoded.email,
        });
        decoded.role = userInDB?.role || "user"; // default fallback to user

        req.decoded = decoded;
        next();
      } catch (error) {
        console.error("❌ Token verification error:", error);
        return res.status(403).json({ message: "Forbidden access" });
      }
    };

    // verifyAdmin

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden access" });
      }
      next();
    };

    // Home route
    app.get("/", (req, res) => {
      res.send("Welcome to Pawlume API 🚀");
    });

    // Admin

    //All pets
    // GET /admin/pets - Admin only
    app.get("/admin/pets", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const pets = await petsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.json(pets); // Frontend এ table হিসেবে দেখানো যাবে
      } catch (err) {
        console.error("Fetch all pets error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // DELETE /admin/pets/:id - Admin only
    app.delete(
      "/admin/pets/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          if (!ObjectId.isValid(id))
            return res.status(400).json({ message: "Invalid pet ID" });

          const result = await petsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 0)
            return res.status(404).json({ message: "Pet not found" });

          res.json({ message: "Pet deleted successfully" });
        } catch (err) {
          console.error("Delete pet error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // PATCH /admin/pets/:id - Admin only (update pet or adopted status)
    app.patch(
      "/admin/pets/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const updatedData = { ...req.body };
          delete updatedData._id; // _id change হবে না

          if (!ObjectId.isValid(id))
            return res.status(400).json({ message: "Invalid pet ID" });

          const result = await petsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedData }
          );

          res.json({
            message: "Pet updated successfully",
            modifiedCount: result.modifiedCount,
          });
        } catch (err) {
          console.error("Update pet error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // Get all users (Admin only)
    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.json(users);
    });

    // Make a user admin
    app.patch(
      "/users/make-admin/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "admin" } }
        );
        res.json({ modifiedCount: result.modifiedCount });
      }
    );

    // Ban a user
    app.patch(
      "/users/ban/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { banned: true } }
        );
        res.json({ modifiedCount: result.modifiedCount });
      }
    );

    // Unban a user
    app.patch(
      "/users/unban/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid user ID" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { banned: false } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({
          modifiedCount: result.modifiedCount,
          message: "User unbanned",
        });
      }
    );

    //  Admin all donations api
    // GET /admin/donations - Admin only
    app.get(
      "/admin/donations",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const donations = await donationCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();
          res.json(donations);
        } catch (err) {
          console.error("Fetch all donations error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // DELETE /admin/donations/:id - Admin only
    app.delete(
      "/admin/donations/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          if (!ObjectId.isValid(id))
            return res.status(400).json({ message: "Invalid donation ID" });

          const result = await donationCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 0)
            return res.status(404).json({ message: "Donation not found" });

          res.json({ message: "Donation deleted successfully" });
        } catch (err) {
          console.error("Delete donation error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // PATCH /admin/donations/:id - Admin only
    app.patch(
      "/admin/donations/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const updatedData = { ...req.body };
          delete updatedData._id; // _id change হবে না

          if (!ObjectId.isValid(id))
            return res.status(400).json({ message: "Invalid donation ID" });

          const result = await donationCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updatedData }
          );

          res.json({
            message: "Donation updated successfully",
            modifiedCount: result.modifiedCount,
          });
        } catch (err) {
          console.error("Update donation error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // Users
    // server.js / index.js
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json({ role: user.role });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    // Add a user
    app.post("/users", async (req, res) => {
      try {
        const { name, email, role, photoURL } = req.body;

        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res
            .status(200)
            .json({ message: "User already exists", user: existingUser });
        }

        // Insert new user
        const newUser = {
          name: name || "Anonymous",
          email,
          photoURL: photoURL || "https://ui-avatars.com/api/?name=Anonymous&background=random", // ✅ Save photo
          role: role || "user",
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);

        res.status(201).json({
          message: "User added successfully",
          user: { ...newUser, _id: result.insertedId }, // ✅ Send full user data
        });
      } catch (err) {
        console.error("User Insert Error:", err);
        res.status(500).json({ error: "Failed to add user" });
      }
    });

    // Pet listing route
    // Example
    app.get("/pets", async (req, res) => {
      try {
        const { search = "", category = "", page = 1, limit = 6 } = req.query;

        const query = {};
        if (search) query.name = { $regex: search, $options: "i" };
        if (category) query.category = category;

        const total = await petsCollection.countDocuments(query);
        const pets = await petsCollection
          .find(query)
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .toArray();

        res.json({
          pets,
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
        });
      } catch (err) {
        console.error("Fetch pets error:", err);
        res.status(500).json({ message: "Server error" });
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

    // server.js
    app.post("/pets", verifyFBToken, async (req, res) => {
      try {
        const {
          name,
          age,
          category,
          location,
          shortDescription,
          longDescription,
          imageUrl,
        } = req.body;

        // 🔑 Change here: req.user → req.decoded
        const ownerEmail = req.decoded?.email;
        if (!ownerEmail) {
          return res
            .status(401)
            .json({ message: "Unauthorized: No email found" });
        }

        const newPet = {
          name,
          age,
          category,
          location,
          shortDescription,
          longDescription,
          imageUrl,
          adopted: false,
          createdAt: new Date(),
          ownerEmail, // attach owner email from decoded token
        };

        const result = await petsCollection.insertOne(newPet);

        res.status(201).json({
          message: "Pet added successfully",
          petId: result.insertedId,
          pet: newPet,
        });
      } catch (err) {
        console.error("Error adding pet:", err);
        res.status(500).json({ error: "Failed to add pet" });
      }
    });

    // Get pets added by logged-in user
    app.get("/my-added", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded.email;
        const myPets = await petsCollection
          .find({ ownerEmail: userEmail })
          .toArray();
        res.json(myPets);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.put("/pets/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      const updatedPet = { ...req.body };
      delete updatedPet._id; // ✅ remove _id to avoid immutable field error

      const userEmail = req.decoded.email;

      try {
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid pet ID" });
        }

        const existingPet = await petsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existingPet)
          return res.status(404).json({ message: "Pet not found" });
        if (existingPet.ownerEmail !== userEmail) {
          return res
            .status(403)
            .json({ message: "Not allowed to update this pet" });
        }

        const result = await petsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedPet }
        );

        res.json({
          message: "Pet updated successfully",
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.delete("/pets/:id", verifyFBToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid pet ID" });
        }

        const result = await petsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Pet not found" });
        }

        res.json({ message: "Pet deleted successfully" });
      } catch (err) {
        console.error("Delete pet error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // adaptation
    app.patch("/pets/adopt/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid pet ID" });
        }

        // Use existing petsCollection
        const existingPet = await petsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existingPet) {
          return res.status(404).json({ message: "Pet not found" });
        }

        if (existingPet.adopted) {
          return res.status(400).json({ message: "Pet is already adopted" });
        }

        const result = await petsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { adopted: true } }
        );

        if (result.modifiedCount === 1) {
          res.status(200).json({ message: "Pet marked as adopted" });
        } else {
          res.status(500).json({ message: "Failed to mark as adopted" });
        }
      } catch (err) {
        console.error("❌ Adopt pet error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post("/adoptions", verifyFBToken, async (req, res) => {
      try {
        const { petId, userName, phone, address } = req.body;
        const userEmail = req.decoded.email;

        if (!petId || !userName || !userEmail || !phone || !address) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const pet = await petsCollection.findOne({ _id: new ObjectId(petId) });
        if (!pet) return res.status(404).json({ error: "Pet not found" });
        if (pet.adopted)
          return res.status(400).json({ error: "Pet already adopted" });

        const adoption = {
          petId: new ObjectId(petId),
          petName: pet.name,
          petImage: pet.imageUrl,
          userName,
          userEmail,
          phone,
          address,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await adoptionsCollection.insertOne(adoption);

        res.status(201).json({
          message: "Adoption request submitted successfully",
          adoptionId: result.insertedId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    app.get("/adoptions/my-pets-requests", verifyFBToken, async (req, res) => {
      try {
        const ownerEmail = req.decoded.email;

        const myPets = await petsCollection.find({ ownerEmail }).toArray();
        const myPetIds = myPets.map((p) => p._id);

        const requests = await adoptionsCollection
          .find({ petId: { $in: myPetIds } })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(requests);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Accept adoption request
    app.patch("/adoptions/accept/:id", verifyFBToken, async (req, res) => {
      try {
        const requestId = req.params.id;

        const adoption = await adoptionsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!adoption)
          return res.status(404).json({ message: "Request not found" });

        // Check if logged-in user owns the pet
        const pet = await petsCollection.findOne({
          _id: new ObjectId(adoption.petId),
        });
        if (!pet || pet.ownerEmail !== req.decoded.email)
          return res.status(403).json({ message: "Not authorized" });

        // Update request status
        await adoptionsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "accepted" } }
        );

        // Mark pet as adopted
        await petsCollection.updateOne(
          { _id: new ObjectId(adoption.petId) },
          { $set: { adopted: true } }
        );

        res.json({ message: "Adoption request accepted" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Reject adoption request
    app.patch("/adoptions/reject/:id", verifyFBToken, async (req, res) => {
      try {
        const requestId = req.params.id;

        const adoption = await adoptionsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!adoption)
          return res.status(404).json({ message: "Request not found" });

        // Check if logged-in user owns the pet
        const pet = await petsCollection.findOne({
          _id: new ObjectId(adoption.petId),
        });
        if (!pet || pet.ownerEmail !== req.decoded.email)
          return res.status(403).json({ message: "Not authorized" });

        // Update request status
        await adoptionsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: "rejected" } }
        );

        res.json({ message: "Adoption request rejected" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Donation
    // Create Donation Campaign (protected)
    app.post("/donationCampaigns/create", verifyFBToken, async (req, res) => {
      try {
        const {
          petName,
          imageUrl,
          maxAmount,
          lastDate,
          shortDescription,
          longDescription,
        } = req.body;

        // Validate required fields
        if (
          !imageUrl ||
          !maxAmount ||
          !lastDate ||
          !shortDescription ||
          !longDescription
        ) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const newCampaign = {
          petName,
          imageUrl,
          maxAmount: parseFloat(maxAmount),
          lastDate: new Date(lastDate),
          shortDescription,
          longDescription,
          createdAt: new Date(),
          ownerEmail: req.decoded.email, // user email from Firebase token
        };

        const result = await donationCollection.insertOne(newCampaign);

        res.status(201).json({
          message: "Donation campaign created successfully",
          campaignId: result.insertedId,
          campaign: newCampaign,
        });
      } catch (err) {
        console.error("Create Donation Campaign Error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get My Donation Campaigns (protected)
    app.get(
      "/donationCampaigns/my-campaigns",
      verifyFBToken,
      async (req, res) => {
        try {
          const email = req.decoded.email; // user email from Firebase token
          const campaigns = await donationCollection
            .find({ ownerEmail: email })
            .sort({ createdAt: -1 })
            .toArray();

          res.status(200).json(campaigns);
        } catch (err) {
          console.error("Fetch My Campaigns Error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // Edit Donation Campaign (protected)
    app.patch("/donationCampaigns/:id", verifyFBToken, async (req, res) => {
      try {
        const campaignId = req.params.id;
        const {
          petName,
          imageUrl,
          maxAmount,
          lastDate,
          shortDescription,
          longDescription,
        } = req.body;

        // Validate required fields
        if (
          !petName ||
          !imageUrl ||
          !maxAmount ||
          !lastDate ||
          !shortDescription ||
          !longDescription
        ) {
          return res.status(400).json({ message: "All fields are required" });
        }

        // Find campaign and check ownership
        const campaign = await donationCollection.findOne({
          _id: new ObjectId(campaignId),
        });
        if (!campaign)
          return res.status(404).json({ message: "Campaign not found" });
        if (campaign.ownerEmail !== req.decoded.email) {
          return res.status(403).json({
            message: "You are not authorized to edit this campaign",
          });
        }

        // Update the campaign
        const updatedCampaign = {
          petName,
          imageUrl,
          maxAmount: parseFloat(maxAmount),
          lastDate: new Date(lastDate),
          shortDescription,
          longDescription,
          updatedAt: new Date(),
        };

        await donationCollection.updateOne(
          { _id: new ObjectId(campaignId) },
          { $set: updatedCampaign }
        );

        res.json({
          message: "Donation campaign updated successfully",
          campaign: updatedCampaign,
        });
      } catch (err) {
        console.error("Edit Donation Campaign Error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Optional: Get Donators for a campaign
    app.get(
      "/donationCampaigns/donators/:id",
      verifyFBToken,
      async (req, res) => {
        try {
          const campaignId = req.params.id;
          const campaign = await donationCollection.findOne({
            _id: new ObjectId(campaignId),
          });

          if (!campaign)
            return res.status(404).json({ message: "Campaign not found" });

          res.json(campaign.donators || []);
        } catch (err) {
          console.error("Fetch Donators Error:", err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // Get all donation campaigns (paginated)
    app.get("/donationCampaigns", async (req, res) => {
      try {
        const { page = 1, limit = 6 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const total = await donationCollection.countDocuments();
        const campaigns = await donationCollection
          .find()
          .sort({ createdAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .toArray();

        res.json({
          campaigns,
          total,
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.post("/donations/make/:campaignId", verifyFBToken, async (req, res) => {
      const { campaignId } = req.params;
      const { amount } = req.body;
      const email = req.decoded.email;
      const name = req.decoded.name;

      try {
        const campaign = await donationCollection.findOne({
          _id: new ObjectId(campaignId),
        });
        if (!campaign)
          return res.status(404).json({ message: "Campaign not found" });

        // add donator
        await donationCollection.updateOne(
          { _id: new ObjectId(campaignId) },
          {
            $push: {
              donators: { name, email, amount, createdAt: new Date() },
            },
          }
        );

        res.json({ message: "Donation successful" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Get logged-in user's donations
    app.get("/donations/my-donations", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded.email;
        // Find campaigns where user donated
        const campaigns = await donationCollection
          .find({ "donators.email": email })
          .toArray();

        // Map to only user's donations
        const myDonations = campaigns.flatMap((campaign) =>
          (campaign.donators || [])
            .filter((d) => d.email === email)
            .map((d) => ({
              campaignId: campaign._id,
              petName: campaign.petName,
              imageUrl: campaign.imageUrl,
              amount: d.amount,
              donatedAt: d.createdAt,
            }))
        );

        res.json(myDonations);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // DELETE / Refund donation
    // Refund a donation
    app.delete(
      "/donations/refund/:campaignId",
      verifyFBToken,
      async (req, res) => {
        try {
          const email = req.decoded.email;
          const { campaignId } = req.params;

          const campaign = await donationCollection.findOne({
            _id: new ObjectId(campaignId),
          });

          if (!campaign)
            return res.status(404).json({ message: "Campaign not found" });

          // Check if user has donated
          const userDonation = (campaign.donators || []).find(
            (d) => d.email === email
          );
          if (!userDonation)
            return res.status(400).json({ message: "You have not donated" });

          // Remove user's donation
          await donationCollection.updateOne(
            { _id: new ObjectId(campaignId) },
            { $pull: { donators: { email } } }
          );

          res.json({ message: "Donation refunded successfully" });
        } catch (err) {
          console.error(err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );
    // Pause Donation Campaign (protected)
    app.patch(
      "/donationCampaigns/pause/:id",
      verifyFBToken,
      async (req, res) => {
        try {
          const campaignId = req.params.id;

          if (!ObjectId.isValid(campaignId))
            return res.status(400).json({ message: "Invalid campaign ID" });

          const campaign = await donationCollection.findOne({
            _id: new ObjectId(campaignId),
          });

          if (!campaign)
            return res.status(404).json({ message: "Campaign not found" });

          // Check ownership
          if (campaign.ownerEmail !== req.decoded.email)
            return res.status(403).json({ message: "Not authorized" });

          // Toggle paused field
          const newPausedValue = !campaign.paused; // switch true/false

          const updated = await donationCollection.updateOne(
            { _id: new ObjectId(campaignId) },
            { $set: { paused: newPausedValue } }
          );

          res.json({
            message: newPausedValue
              ? "Donation campaign paused"
              : "Donation campaign unpaused",
            paused: newPausedValue,
            modifiedCount: updated.modifiedCount,
          });
        } catch (err) {
          console.error(err);
          res.status(500).json({ message: "Server error" });
        }
      }
    );

    // GET a single donation campaign by ID (public)
    app.get("/donationCampaigns/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid campaign ID" });
        }

        const campaign = await donationCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!campaign) {
          return res.status(404).json({ message: "Campaign not found" });
        }

        res.json(campaign);
      } catch (err) {
        console.error("Fetch campaign error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    //                     payment

    // 1️⃣ Create Payment Intent
    // Server-side route
    app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
      try {
        const { amount, campaignId } = req.body;

        if (!amount || !campaignId) {
          return res
            .status(400)
            .json({ message: "Amount and campaignId required" });
        }

        // ✅ এখানে use করতে হবে
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Stripe expects cents
          currency: "usd",
          metadata: {
            campaignId,
            email: req.decoded.email,
            name: req.decoded.name,
          },
        });

        res.status(200).json({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("Stripe PaymentIntent Error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 3️⃣ Save Donation after successful payment
    app.post("/save-donation", verifyFBToken, async (req, res) => {
      try {
        const { campaignId, amount, paymentId } = req.body;

        if (!campaignId || !amount || !paymentId) {
          return res.status(400).json({ message: "Missing fields" });
        }

        const campaign = await donationCollection.findOne({
          _id: new ObjectId(campaignId),
        });
        if (!campaign)
          return res.status(404).json({ message: "Campaign not found" });

        const donation = {
          name: req.decoded.name,
          email: req.decoded.email,
          amount: parseFloat(amount),
          paymentId,
          createdAt: new Date(),
        };

        await donationCollection.updateOne(
          { _id: new ObjectId(campaignId) },
          { $push: { donators: donation } }
        );

        res.status(200).json({ message: "Donation saved successfully" });
      } catch (err) {
        console.error("Save Donation Error:", err);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 🖼️ Image Upload Route (using Cloudinary)
    app.post(
      "/upload-image",
      verifyFBToken,
      upload.single("image"),
      async (req, res) => {
        try {
          if (!req.file) {
            return res.status(400).json({ message: "No image uploaded" });
          }
          // The image URL is available in req.file.path after successful upload to Cloudinary
          res.json({ imageUrl: req.file.path });
        } catch (error) {
          console.error("❌ Image upload error:", error);
          res.status(500).json({ message: "Image upload failed" });
        }
      }
    );

    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Pawlume Server is running on port ${PORT}`);
    });
  })
  .catch(console.dir);
