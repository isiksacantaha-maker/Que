const API_URL = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? "http://localhost:3000/api"
    : "https://que-7pcg.onrender.com/api";

async function extractErrorMessage(response, fallbackMessage) {
    let backendMessage = "";

    try {
        const data = await response.json();
        backendMessage = data?.error || data?.message || "";
    } catch (_) {
        try {
            backendMessage = await response.text();
        } catch (_) {
            backendMessage = "";
        }
    }

    const safeBackendMessage = (backendMessage || "").trim();
    const fallbackWithStatus = `${fallbackMessage} (HTTP ${response.status})`;

    if (!safeBackendMessage) return fallbackWithStatus;

    const htmlOrGeneric =
        safeBackendMessage.startsWith('<!DOCTYPE') ||
        safeBackendMessage.startsWith('<html') ||
        safeBackendMessage.toLowerCase() === fallbackMessage.toLowerCase();

    if (htmlOrGeneric) return fallbackWithStatus;

    return `${safeBackendMessage} (HTTP ${response.status})`;
}

const API = {
    // --- ÜRÜN İŞLEMLERİ ---

    // Tüm ürünleri getir
    async getProducts() {
        const response = await fetch(`${API_URL}/products`, { cache: "no-store" });
        if (!response.ok) throw new Error("Ürünler yüklenemedi");
        return await response.json();
    },

    // Ürün Kaydet (Hem Yeni Ekleme Hem Güncelleme)
    async saveProduct(product) {
        const productId = product._id || product.id;
        const method = productId ? "PUT" : "POST";
        const url = productId
            ? `${API_URL}/products/${productId}`
            : `${API_URL}/products`;

        const payload = { ...product };
        if (productId) {
            delete payload._id;
            delete payload.id;
        }

        const response = await fetch(url, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const message = await extractErrorMessage(response, "Kayıt işlemi başarısız");
            throw new Error(message);
        }
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

    async getOrders() {
        const response = await fetch(`${API_URL}/orders`, { cache: "no-store" });
        if (!response.ok) throw new Error("Siparişler yüklenemedi");
        return await response.json();
    },

    async updateOrder(order) {
        let orderId = order?._id || order?.id;

        if (!orderId && order?.orderNumber) {
            const allOrders = await API.getOrders();
            const matched = allOrders.find(o => o.orderNumber === order.orderNumber || o.id === order.orderNumber);
            orderId = matched?._id || matched?.id;
        }

        if (!orderId) throw new Error("Sipariş güncelleme için geçerli ID bulunamadı");

        const payload = { ...order };
        delete payload._id;

        const response = await fetch(`${API_URL}/orders/${orderId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const message = await extractErrorMessage(response, "Sipariş güncellenemedi");
            throw new Error(message);
        }
        return await response.json();
    },

    async getUsers() {
        const response = await fetch(`${API_URL}/users`, { cache: "no-store" });
        if (!response.ok) throw new Error("Kullanıcılar yüklenemedi");
        return await response.json();
    },

    // --- KULLANICI & GİRİŞ İŞLEMLERİ ---

    async login(emailOrData, passArg) {
        const email = typeof emailOrData === 'object' ? emailOrData?.email : emailOrData;
        const pass = typeof emailOrData === 'object' ? emailOrData?.pass : passArg;

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
    },

    async forgotPassword(data) {
        const response = await fetch(`${API_URL}/auth/forgot-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Şifre sıfırlama başarısız");
        }
        return await response.json();
    },

    async requestPasswordReset(data) {
        const response = await fetch(`${API_URL}/auth/request-password-reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Şifre yenileme bağlantısı oluşturulamadı");
        }
        return await response.json();
    },

    async resetPassword(data) {
        const response = await fetch(`${API_URL}/auth/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Şifre güncellenemedi");
        }
        return await response.json();
    }
};
