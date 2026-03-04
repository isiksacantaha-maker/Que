const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// .env dosyasındaki ortam değişkenlerini yükler
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_LIMIT = process.env.REQUEST_LIMIT || '25mb';

// MongoDB Bağlantısı
// Güvenlik için bağlantı adresi .env dosyasından alınır
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Başardık! MongoDB Atlas Bağlantısı Tamam."))
  .catch((err) => console.log("❌ Bağlantı Hatası:", err));

app.use(cors());
app.use(bodyParser.json({ limit: REQUEST_LIMIT }));
app.use(bodyParser.urlencoded({ extended: true, limit: REQUEST_LIMIT }));
const saltRounds = 10; // Şifre hash'leme için salt değeri

// --- VERİ MODELLERİ (ŞEMALAR) ---

const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    description: String,
    imgs: [String]
});

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    pass: String, 
    phone: String,
    address: String,
    role: { type: String, default: 'customer' },
    resetToken: String,
    resetTokenExpires: Date
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

// --- API ENDPOINTS ---

// 1. ÜRÜNLER
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
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
        if (email === process.env.ADMIN_EMAIL && pass === process.env.ADMIN_PASS) {
            return res.json({ role: 'admin', name: 'Yönetici', email: email });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }

        // Veritabanındaki hash'lenmiş şifre ile kullanıcının girdiği şifreyi karşılaştır
        const isMatch = await bcrypt.compare(pass, user.pass);
        if (isMatch) {
            res.json({ role: 'customer', name: user.name, email: user.email, phone: user.phone, address: user.address });
        } else {
            res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
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

app.post('/api/auth/request-password-reset', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "E-posta zorunludur." });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Bu e-posta ile kayıtlı kullanıcı bulunamadı." });

        const resetToken = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 dk

        user.resetToken = resetToken;
        user.resetTokenExpires = expiresAt;
        await user.save();

        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const resetLink = `${baseUrl}/sifre-sifirla.html?token=${resetToken}`;

        res.json({
            success: true,
            message: "Şifre yenileme bağlantısı oluşturuldu.",
            resetLink
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPass } = req.body;
        if (!token || !newPass) {
            return res.status(400).json({ error: "Token ve yeni şifre zorunludur." });
        }

        const user = await User.findOne({
            resetToken: token,
            resetTokenExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ error: "Geçersiz veya süresi dolmuş bağlantı." });
        }

        user.pass = newPass;
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;
        await user.save();

        res.json({ success: true, message: "Şifreniz başarıyla güncellendi." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});