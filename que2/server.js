const express = require('express');
const mongoose = require('mongoose');
const compression = require('compression');
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
app.use(compression());
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

const MAX_PRODUCT_IMAGES = 5;
const MAX_ORDER_ITEMS = 50;

function normalizeText(value, options = {}) {
    const { maxLength = 500, allowEmpty = false } = options;
    const text = String(value || '').trim();

    if (!text) {
        return allowEmpty ? '' : null;
    }

    return text.slice(0, maxLength);
}

function normalizeOptionalText(value, options = {}) {
    return normalizeText(value, { ...options, allowEmpty: true });
}

function normalizePrice(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100) / 100;
}

function normalizePositiveInteger(value, options = {}) {
    const { min = 1, max = 999 } = options;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
    return parsed;
}

function sanitizeProductImages(rawImages) {
    if (!Array.isArray(rawImages)) return null;

    const images = rawImages
        .map(img => String(img || '').trim())
        .filter(Boolean)
        .slice(0, MAX_PRODUCT_IMAGES);

    return images.length ? images : null;
}

function sanitizeProductPayload(payload, options = {}) {
    const { partial = false } = options;
    const normalized = {};

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
        const name = normalizeText(payload?.name, { maxLength: 120 });
        if (!name) throw new Error('Ürün adı zorunludur');
        normalized.name = name;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'category')) {
        const category = normalizeText(payload?.category, { maxLength: 40 });
        if (!category) throw new Error('Kategori zorunludur');
        normalized.category = category;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'price')) {
        const price = normalizePrice(payload?.price);
        if (price === null) throw new Error('Geçerli bir fiyat girilmelidir');
        normalized.price = price;
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'description')) {
        normalized.description = normalizeOptionalText(payload?.description, { maxLength: 2000 });
    }

    if (!partial || Object.prototype.hasOwnProperty.call(payload, 'imgs')) {
        const imgs = sanitizeProductImages(payload?.imgs);
        if (!imgs) throw new Error('En az bir ürün görseli gereklidir');
        normalized.imgs = imgs;
    }

    return normalized;
}

function sanitizeShippingInfo(rawShippingInfo) {
    const shippingInfo = rawShippingInfo && typeof rawShippingInfo === 'object'
        ? rawShippingInfo
        : {};

    const name = normalizeText(shippingInfo.name, { maxLength: 120 });
    const phone = normalizeText(shippingInfo.phone, { maxLength: 30 });
    const address = normalizeText(shippingInfo.address, { maxLength: 400 });
    const city = normalizeText(shippingInfo.city, { maxLength: 80 });

    if (!name || !phone || !address || !city) {
        throw new Error('Teslimat bilgileri eksik');
    }

    return { name, phone, address, city };
}

async function buildValidatedOrderPayload(payload, orderUserEmail) {
    const orderNumber = normalizeText(payload?.id || payload?.orderNumber, { maxLength: 32 });
    if (!orderNumber) throw new Error('Geçerli sipariş numarası gereklidir');

    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    if (!rawItems.length) throw new Error('Sipariş sepeti boş olamaz');
    if (rawItems.length > MAX_ORDER_ITEMS) throw new Error('Siparişte çok fazla ürün var');

    const normalizedItems = rawItems.map((item) => {
        const productId = String(item?.productId || '').trim();
        const quantity = normalizePositiveInteger(item?.quantity, { min: 1, max: 20 });

        if (!mongoose.isValidObjectId(productId) || quantity === null) {
            throw new Error('Sipariş kalemlerinden biri geçersiz');
        }

        return { productId, quantity };
    });

    const productIds = [...new Set(normalizedItems.map(item => item.productId))];
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(products.map(product => [String(product._id), product]));

    if (productMap.size !== productIds.length) {
        throw new Error('Siparişte artık vitrinde olmayan ürün var');
    }

    let subtotal = 0;
    const orderItems = normalizedItems.map((item) => {
        const product = productMap.get(item.productId);
        const price = normalizePrice(product?.price);
        if (price === null) {
            throw new Error('Siparişte fiyatı geçersiz ürün bulundu');
        }

        subtotal += price * item.quantity;
        return {
            productId: String(product._id),
            name: normalizeText(product.name, { maxLength: 120 }) || 'Isimsiz Urun',
            quantity: item.quantity,
            price,
            img: Array.isArray(product.imgs) && product.imgs[0] ? String(product.imgs[0]).trim() : 'placeholder.jpg'
        };
    });

    subtotal = Math.round(subtotal * 100) / 100;
    const extraFee = normalizePrice(payload?.extraFee) || 0;
    const shippingFee = subtotal >= 3000 ? 0 : (subtotal > 0 ? 100 : 0);
    const total = Math.round((subtotal + shippingFee + extraFee) * 100) / 100;
    const status = normalizeText(payload?.status, { maxLength: 80 }) || 'Havale Bekleniyor';

    return {
        orderNumber,
        date: new Date().toLocaleDateString('tr-TR'),
        items: orderItems,
        subtotal,
        shippingFee,
        extraFee,
        total,
        status,
        userEmail: normalizeOptionalText(orderUserEmail, { maxLength: 160 }) || 'misafir',
        shippingInfo: sanitizeShippingInfo(payload?.shippingInfo)
    };
}

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
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, default: '', maxlength: 2000 },
    imgs: {
        type: [String],
        validate: {
            validator: (value) => Array.isArray(value) && value.length > 0 && value.length <= MAX_PRODUCT_IMAGES,
            message: 'Ürün görsel sayısı 1 ile 5 arasında olmalıdır'
        }
    }
}, { timestamps: true });

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

const OrderItemSchema = new mongoose.Schema({
    productId: { type: String, required: true },
    name: { type: String, required: true, maxlength: 120 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    price: { type: Number, required: true, min: 0 },
    img: { type: String, default: 'placeholder.jpg' }
}, { _id: false });

const ShippingInfoSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 120 },
    phone: { type: String, required: true, maxlength: 30 },
    address: { type: String, required: true, maxlength: 400 },
    city: { type: String, required: true, maxlength: 80 }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    orderNumber: { type: String, unique: true, required: true },
    date: { type: String, required: true },
    items: {
        type: [OrderItemSchema],
        validate: {
            validator: (value) => Array.isArray(value) && value.length > 0 && value.length <= MAX_ORDER_ITEMS,
            message: 'Sipariş kalemleri 1 ile 50 arasında olmalıdır'
        }
    },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    shippingFee: { type: Number, required: true, min: 0, default: 0 },
    extraFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, required: true, maxlength: 80 },
    userEmail: { type: String, maxlength: 160, default: 'misafir' },
    shippingInfo: { type: ShippingInfoSchema, required: true },
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
        const limit = normalizePositiveInteger(req.query?.limit, { min: 1, max: 200 });
        const skip = normalizePositiveInteger(req.query?.skip, { min: 0, max: 100000 });
        let query = Product.find().lean();

        if (skip !== null) query = query.skip(skip);
        if (limit !== null) query = query.limit(limit);

        const products = await query;
        res.json(products);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
    try {
        const newProduct = new Product(sanitizeProductPayload(req.body));
        await newProduct.save();
        res.json(newProduct);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id,
            sanitizeProductPayload(req.body),
            { new: true, runValidators: true }
        );
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

        const orderData = await buildValidatedOrderPayload(req.body, orderUserEmail);
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

        const safeEmail = String(email || '').trim().toLowerCase();
        const existingUser = await User.findOne({ email: safeEmail });
        if (existingUser) return res.status(400).json({ error: "Bu e-posta zaten kayıtlı." });
        
        const safeName = String(name || '').trim();
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
        const rawEmail = req.body?.email;
        const rawPass = req.body?.pass;
        const email = String(rawEmail || '').trim().toLowerCase();
        const pass = String(rawPass || '');
        if (!email || !pass) {
            return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
        }

        // Admin Kontrolü (.env dosyasından güvenli bir şekilde)
        if (email === String(ADMIN_EMAIL || '').trim().toLowerCase() && pass.trim() === String(ADMIN_PASS || '')) {
            const token = signAuthToken({ role: 'admin', name: 'Yönetici', email });
            return res.json({ role: 'admin', name: 'Yönetici', email: email, token });
        }

        if (DEVELOPER_EMAIL && DEVELOPER_PASS && email === String(DEVELOPER_EMAIL).trim().toLowerCase() && pass.trim() === String(DEVELOPER_PASS)) {
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
        const email = String(req.body?.email || '').trim().toLowerCase();
        const currentPass = String(req.body?.currentPass || '');
        const newPass = String(req.body?.newPass || '');
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