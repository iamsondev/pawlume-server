const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");

dotenv.config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r1yzage.mongodb.net/?retryWrites=true&w=majority`;

async function clearData() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("pawlume_server");

    // Clear Pets Collection
    const petsResult = await db.collection("pets").deleteMany({});
    console.log(`🗑️ Deleted ${petsResult.deletedCount} pets.`);

    // Clear Donation Campaigns
    const donationResult = await db.collection("donationCampaigns").deleteMany({});
    console.log(`🗑️ Deleted ${donationResult.deletedCount} donation campaigns.`);

    // Clear Adoptions
    const adoptionsResult = await db.collection("adoptions").deleteMany({});
    console.log(`🗑️ Deleted ${adoptionsResult.deletedCount} adoption requests.`);

    console.log("\n✨ Database cleared successfully! You can now start adding new pets with Cloudinary.");
  } catch (error) {
    console.error("❌ Error clearing database:", error);
  } finally {
    await client.close();
  }
}

clearData();
