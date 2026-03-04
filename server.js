const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Senin gerçek bağlantı adresin
const dbURI = process.env.MONGODB_URI;

mongoose.connect(dbURI)
  .then(() => console.log("✅ İŞTE BU! MongoDB Atlas Bağlantısı Başarılı."))
  .catch((err) => console.log("❌ Bağlantı Hatası:", err));

app.get('/', (req, res) => {
  res.send("QueJew Sunucusu Çalışıyor! 🚀");
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});