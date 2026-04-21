const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

// .env dosyasındaki ortam değişkenlerini yükler
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;
const DEVELOPER_EMAIL = process.env.DEVELOPER_EMAIL;
const DEVELOPER_PASS = process.env.DEVELOPER_PASS;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// MongoDB Bağlantısı
// Güvenlik için bağlantı adresi .env dosyasından alınır
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Başardık! MongoDB Atlas Bağlantısı Tamam."))
  .catch((err) => console.log("❌ Bağlantı Hatası:", err));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
const saltRounds = 10; // Şifre hash'leme için salt değeri

// --- VERİ MODELLERİ (ŞEMALAR) ---

const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    description: String,
    imgs: [String],
    // Açık Arttırma Alanları
    auctionStatus: { type: String, enum: ['inactive', 'active', 'ended'], default: 'inactive' },
    auctionEndTime: Date,
    startingPrice: Number,
    currentBid: Number,
    highestBidder: { email: String, name: String },
    bids: [{ email: String, name: String, amount: Number, time: Date }]
});

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    pass: String, 
    phone: String,
    address: String,
    role: { type: String, default: 'customer' }
});

// Kullanıcı kaydedilmeden ÖNCE şifreyi hash'le (güvenli hale getir)
UserSchema.pre('save', async function(next) {
    // Sadece şifre alanı değiştirildiyse veya yeni bir kullanıcıysa hash'le
    if (!this.isModified('pass')) return next();

    try {
        const salt = await bcrypt.genSalt(saltRounds);
        this.pass = await bcrypt.hash(this.pass, salt);
        next();
    } catch (error) { next(error); }
});

const OrderSchema = new mongoose.Schema({
    orderNumber: { type: String, unique: true }, // Frontend'den gelen #QUE-123456 gibi ID'ler için
    date: String,
    items: Array,
    total: Number,
    status: String,
    userEmail: String,
    shippingInfo: Object,
    cargo: Object,
    completionDate: Date
});

const Product = mongoose.model('Product', ProductSchema);
const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);

function buildAuthPayload({ email, name, phone, address, role }) {
    if (email === ADMIN_EMAIL) {
        return { role: 'admin', name: 'Yönetici', email };
    }

    if (DEVELOPER_EMAIL && email === DEVELOPER_EMAIL) {
        return { role: 'developer', name: 'Yazılımcı', email };
    }

    return {
        role: role || 'customer',
        name,
        email,
        phone,
        address
    };
}

// --- API ENDPOINTS ---

app.get('/api/public-config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID || null
    });
});

// 1. ÜRÜNLER
app.get('/api/products', async (req, res) => {
    try {
        // Süresi dolan aktif mezatları otomatik bitir
        await Product.updateMany(
            { auctionStatus: 'active', auctionEndTime: { $lt: new Date() } },
            { $set: { auctionStatus: 'ended' } }
        );
        const products = await Product.find().sort({ _id: -1 });
        res.json(products);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
    try {
        // ID yönetimi artık Mongoose'a ait (_id)
        const newProduct = new Product(req.body);
        await newProduct.save();
        res.json(newProduct);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedProduct);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 1B. MEZAT BAŞLAT
app.post('/api/products/:id/start-auction', async (req, res) => {
    try {
        const { durationHours, startingPrice } = req.body;
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

        const endTime = new Date();
        endTime.setHours(endTime.getHours() + Number(durationHours));

        product.auctionStatus = 'active';
        product.auctionEndTime = endTime;
        product.startingPrice = Number(startingPrice) || product.price;
        product.currentBid = product.startingPrice;
        product.highestBidder = undefined;
        product.bids = [];
        await product.save();
        res.json({ success: true, product });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 1C. TEKLIF VER
app.post('/api/products/:id/bid', async (req, res) => {
    try {
        const { amount, email, name } = req.body;
        if (!email) return res.status(401).json({ error: 'Teklif vermek için giriş yapmalısınız' });

        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
        if (product.auctionStatus !== 'active') return res.status(400).json({ error: 'Bu ürün aktif mezatta değil' });
        if (new Date() > product.auctionEndTime) {
            product.auctionStatus = 'ended';
            await product.save();
            return res.status(400).json({ error: 'Mezat süresi dolmuştur' });
        }

        const minBid = (product.currentBid || product.startingPrice || 0) + 1;
        if (Number(amount) < minBid) {
            return res.status(400).json({ error: `Teklifiniz mevcut tekliften yüksek olmalıdır (Min: ${minBid.toLocaleString('tr-TR')} TL)` });
        }

        product.bids.push({ email, name, amount: Number(amount), time: new Date() });
        product.currentBid = Number(amount);
        product.highestBidder = { email, name };
        await product.save();

        res.json({ success: true, currentBid: product.currentBid, highestBidder: product.highestBidder, bidsCount: product.bids.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. SİPARİŞLER
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find();
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        // Frontend'den gelen 'id' alanını 'orderNumber' olarak kaydet
        const orderData = { ...req.body, orderNumber: req.body.id };
        delete orderData.id; // Mongoose'un kendi _id'sini kullanmasına izin ver
        const newOrder = new Order(orderData);
        await newOrder.save();
        res.json(newOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/orders/:id', async (req, res) => {
    try {
        // Artık URL'deki id, Mongoose'un _id'si olmalı
        const updatedOrder = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. KULLANICILAR & AUTH
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, '-pass');
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "Bu e-posta zaten kayıtlı." });
        
        // Şifre 'pre' hook'u sayesinde otomatik olarak hash'lenecek
        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, pass } = req.body;

        // Admin Kontrolü (.env dosyasından güvenli bir şekilde)
        if (email === ADMIN_EMAIL && pass === ADMIN_PASS) {
            return res.json(buildAuthPayload({ email }));
        }

        if (DEVELOPER_EMAIL && DEVELOPER_PASS && email === DEVELOPER_EMAIL && pass === DEVELOPER_PASS) {
            return res.json(buildAuthPayload({ email }));
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }

        // Veritabanındaki hash'lenmiş şifre ile kullanıcının girdiği şifreyi karşılaştır
        const isMatch = await bcrypt.compare(pass, user.pass);
        if (isMatch) {
            res.json(buildAuthPayload(user));
        } else {
            res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        if (!googleClient || !GOOGLE_CLIENT_ID) {
            return res.status(503).json({ error: 'Google girişi henüz yapılandırılmadı.' });
        }

        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ error: 'Google kimlik doğrulama verisi eksik.' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const email = (payload?.email || '').trim().toLowerCase();
        const name = payload?.name || 'Google Kullanıcısı';

        if (!payload?.email_verified || !email) {
            return res.status(401).json({ error: 'Google hesabı doğrulanamadı.' });
        }

        if (email === ADMIN_EMAIL || (DEVELOPER_EMAIL && email === DEVELOPER_EMAIL)) {
            return res.json(buildAuthPayload({ email }));
        }

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({
                name,
                email,
                pass: crypto.randomBytes(24).toString('hex'),
                role: 'customer'
            });
            await user.save();
        } else if (!user.name && name) {
            user.name = name;
            await user.save();
        }

        return res.json(buildAuthPayload(user));
    } catch (err) {
        return res.status(401).json({ error: 'Google girişi doğrulanamadı.' });
    }
});

app.post('/api/users/change-password', async (req, res) => {
    try {
        const { email, currentPass, newPass } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        
        const isMatch = await bcrypt.compare(currentPass, user.pass);
        if (!isMatch) return res.status(400).json({ error: "Mevcut şifre hatalı." });

        // Yeni şifre 'pre' hook'u sayesinde otomatik olarak hash'lenecek
        user.pass = newPass;
        await user.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        // DİKKAT: Bu kısım hala güvensiz. Yeni şifre kullanıcıya e-posta ile gönderilmelidir.
        // Şimdilik sadece hash'leme mantığını ekliyoruz.
        const newPassword = Math.random().toString(36).slice(-8);
        user.pass = newPassword;
        await user.save();
        
        // ASLA yeni şifreyi response'da geri dönme!
        res.json({ success: true, message: "Yeni şifre oluşturuldu ve (normalde e-posta ile) gönderildi." }); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});