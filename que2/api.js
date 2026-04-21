const API_URL = "http://localhost:3000/api";

const API = {
    // --- ÜRÜN İŞLEMLERİ ---

    // Tüm ürünleri getir
    async getProducts() {
        const response = await fetch(`${API_URL}/products`);
        if (!response.ok) throw new Error("Ürünler yüklenemedi");
        return await response.json();
    },

    // Ürün Kaydet (Hem Yeni Ekleme Hem Güncelleme)
    async saveProduct(product) {
        // Eğer ürünün bir ID'si varsa GÜNCELLE (PUT), yoksa YENİ EKLE (POST)
        const method = product.id ? "PUT" : "POST";
        const url = product.id 
            ? `${API_URL}/products/${product.id}` 
            : `${API_URL}/products`;

        const response = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(product)
        });

        if (!response.ok) throw new Error("Kayıt işlemi başarısız");
        return await response.json();
    },

    // Ürün Sil
    async deleteProduct(id) {
        const response = await fetch(`${API_URL}/products/${id}`, {
            method: "DELETE"
        });
        if (!response.ok) throw new Error("Silme işlemi başarısız");
        return await response.json();
    },

    // --- SİPARİŞ İŞLEMLERİ ---

    // Sipariş Oluştur
    async createOrder(order) {
        const response = await fetch(`${API_URL}/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order)
        });
        if (!response.ok) throw new Error("Sipariş oluşturulamadı");
        return await response.json();
    },

    // --- KULLANICI & GİRİŞ İŞLEMLERİ ---

    async login(email, pass) {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, pass })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Giriş başarısız");
        }
        return await response.json();
    },

    async register(userData) {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Kayıt başarısız");
        }
        return await response.json();
    },

    async changePassword(data) {
        const response = await fetch(`${API_URL}/users/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error("Şifre değiştirilemedi");
        return await response.json();
    }
};
