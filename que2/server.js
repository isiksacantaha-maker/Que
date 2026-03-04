const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// .env dosyasındaki ortam değişkenlerini yükler
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_LIMIT = process.env.REQUEST_LIMIT || '25mb';
app.set('trust proxy', 1);
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASS || 'change-me-immediately';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'oya.gugu@gmail.com';
const ADMIN_PASS = process.env.ADMIN_PASS || 'oya13gugu';
const DEVELOPER_EMAIL = process.env.DEVELOPER_EMAIL;
const DEVELOPER_PASS = process.env.DEVELOPER_PASS;

const ALLOWED_ORIGINS = [
    'https://quejew.com',
    'https://www.quejew.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    process.env.APP_BASE_URL
].filter(Boolean);

// MongoDB Bağlantısı
// Güvenlik için bağlantı adresi .env dosyasından alınır
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Başardık! MongoDB Atlas Bağlantısı Tamam."))
  .catch((err) => console.log("❌ Bağlantı Hatası:", err));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('CORS engellendi'));
    }
}));
app.use(helmet());
app.use(bodyParser.json({ limit: REQUEST_LIMIT }));
app.use(bodyParser.urlencoded({ extended: true, limit: REQUEST_LIMIT }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.' }
});
app.use('/api', apiLimiter);

function signAuthToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function readBearerToken(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return auth.slice(7).trim();
}

function requireAuth(req, res, next) {
    try {
        const token = readBearerToken(req);
        if (!token) return res.status(401).json({ error: 'Yetkisiz erişim.' });
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (_) {
        return res.status(401).json({ error: 'Oturum doğrulanamadı.' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || !['admin', 'developer'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Bu işlem için yönetici/yazılımcı yetkisi gerekiyor.' });
    }
    next();
}
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
UserSchema.pre('save', async function() {
    if (!this.isModified('pass')) return;
    const salt = await bcrypt.genSalt(saltRounds);
    this.pass = await bcrypt.hash(this.pass, salt);
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
}, { timestamps: true });

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

app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
    try {
        // ID yönetimi artık Mongoose'a ait (_id)
        const newProduct = new Product(req.body);
        await newProduct.save();
        res.json(newProduct);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedProduct);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. SİPARİŞLER
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const filter = ['admin', 'developer'].includes(req.user.role) ? {} : { userEmail: req.user.email };
        const orders = await Order.find(filter);
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        let orderUserEmail = req.body.userEmail || 'misafir';
        const maybeToken = readBearerToken(req);
        if (maybeToken) {
            try {
                const decoded = jwt.verify(maybeToken, JWT_SECRET);
                if (decoded?.email && decoded?.role !== 'admin') {
                    orderUserEmail = decoded.email;
                }
            } catch (_) {
                // Geçersiz token varsa misafir akışını bozmamak için görmezden gel
            }
        }

        // Frontend'den gelen 'id' alanını 'orderNumber' olarak kaydet
        const orderData = { ...req.body, orderNumber: req.body.id, userEmail: orderUserEmail };
        delete orderData.id; // Mongoose'un kendi _id'sini kullanmasına izin ver
        const newOrder = new Order(orderData);
        await newOrder.save();
        res.json(newOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/orders/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        // Artık URL'deki id, Mongoose'un _id'si olmalı
        const updatedOrder = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. KULLANICILAR & AUTH
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await User.find({}, '-pass');
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, pass } = req.body;
        if (!name || !email || !pass) {
            return res.status(400).json({ error: "Ad, e-posta ve şifre zorunludur." });
        }
        if (String(pass).length < 6) {
            return res.status(400).json({ error: "Şifre en az 6 karakter olmalıdır." });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "Bu e-posta zaten kayıtlı." });
        
        const safeName = String(name || '').trim();
        const safeEmail = String(email || '').trim().toLowerCase();
        const safePass = String(pass || '');
        const safePhone = String(req.body.phone || '').trim();
        const safeAddress = String(req.body.address || '').trim();

        const newUser = new User({
            name: safeName,
            email: safeEmail,
            pass: safePass,
            phone: safePhone,
            address: safeAddress,
            role: 'customer'
        });
        await newUser.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, pass } = req.body;
        if (!email || !pass) {
            return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
        }

        // Admin Kontrolü (.env dosyasından güvenli bir şekilde)
        if (email === ADMIN_EMAIL && pass === ADMIN_PASS) {
            const token = signAuthToken({ role: 'admin', name: 'Yönetici', email });
            return res.json({ role: 'admin', name: 'Yönetici', email: email, token });
        }

        if (DEVELOPER_EMAIL && DEVELOPER_PASS && email === DEVELOPER_EMAIL && pass === DEVELOPER_PASS) {
            const token = signAuthToken({ role: 'developer', name: 'Yazılımcı', email });
            return res.json({ role: 'developer', name: 'Yazılımcı', email: email, token });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }

        // Veritabanındaki hash'lenmiş şifre ile kullanıcının girdiği şifreyi karşılaştır
        const isMatch = await bcrypt.compare(pass, user.pass);
        if (isMatch) {
            const token = signAuthToken({ role: user.role || 'customer', name: user.name, email: user.email });
            res.json({ role: 'customer', name: user.name, email: user.email, phone: user.phone, address: user.address, token });
        } else {
            res.status(401).json({ error: "Hatalı giriş bilgileri." });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/change-password', requireAuth, async (req, res) => {
    try {
        const { email, currentPass, newPass } = req.body;
        if (!email || !currentPass || !newPass) {
            return res.status(400).json({ error: "Tüm alanlar zorunludur." });
        }
        if (String(newPass).length < 6) {
            return res.status(400).json({ error: "Yeni şifre en az 6 karakter olmalıdır." });
        }
        if (!['admin', 'developer'].includes(req.user.role) && req.user.email !== email) {
            return res.status(403).json({ error: 'Sadece kendi şifrenizi değiştirebilirsiniz.' });
        }

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
    return res.status(410).json({
        error: "Bu endpoint güvenlik nedeniyle kapatıldı. Lütfen 'Şifremi unuttum' üzerinden bağlantı ile sıfırlayın."
    });
});

app.post('/api/auth/request-password-reset', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "E-posta zorunludur." });

        const user = await User.findOne({ email });
        if (!user) {
            return res.json({
                success: true,
                message: "Eğer hesap mevcutsa şifre yenileme bağlantısı oluşturulmuştur."
            });
        }

        const resetToken = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 dk

        user.resetToken = resetToken;
        user.resetTokenExpires = expiresAt;
        await user.save();

        const originHeader = req.get('origin');
        const configuredBaseUrl = process.env.APP_BASE_URL;
        const fallbackHost = req.get('host');
        const fallbackBaseUrl = fallbackHost ? `https://${fallbackHost}` : '';
        const safeOrigin = originHeader && /^https?:\/\//i.test(originHeader) ? originHeader : '';
        const baseUrl = configuredBaseUrl || safeOrigin || fallbackBaseUrl;
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
        if (String(newPass).length < 6) {
            return res.status(400).json({ error: "Yeni şifre en az 6 karakter olmalıdır." });
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