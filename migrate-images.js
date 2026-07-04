const { MongoClient, ObjectId } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const https = require("https");

dotenv.config();

// Configuration
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r1yzage.mongodb.net/?retryWrites=true&w=majority`;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Improved download function with more headers
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://ibb.co/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
         // Follow redirect
         return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Status Code: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folder },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

async function migrate() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    const db = client.db("pawlume_server");

    const collections = [
      { name: "pets", field: "imageUrl" },
      { name: "donationCampaigns", field: "imageUrl" },
      { name: "users", field: "photoURL" },
      { name: "adoptions", field: "petImage" },
    ];

    for (const item of collections) {
      console.log(`\n📂 Processing collection: ${item.name}`);
      const collection = db.collection(item.name);
      const docs = await collection.find({ 
        [item.field]: { $regex: "ibb.co" } 
      }).toArray();

      console.log(`🔍 Found ${docs.length} images to migrate in ${item.name}`);

      for (const doc of docs) {
        const oldUrl = doc[item.field];
        try {
          console.log(`   ⬇️ Downloading ${oldUrl}...`);
          const buffer = await downloadImage(oldUrl);
          
          console.log(`   ⬆️ Uploading to Cloudinary...`);
          const result = await uploadToCloudinary(buffer, "pawlume_migration");

          const newUrl = result.secure_url;

          await collection.updateOne(
            { _id: doc._id },
            { $set: { [item.field]: newUrl } }
          );

          console.log(`   ✅ Success! New URL: ${newUrl}`);
        } catch (err) {
          console.error(`   ❌ Failed to migrate document ${doc._id}: ${err.message}`);
        }
      }
    }

    console.log("\n✨ All tasks finished!");
  } catch (error) {
    console.error("❌ Migration error:", error);
  } finally {
    await client.close();
  }
}

migrate();
