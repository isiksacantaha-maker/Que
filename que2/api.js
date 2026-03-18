const API_URL = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? "http://localhost:3000/api"
    : "https://que-7pcg.onrender.com/api";

const API_URL_FALLBACKS = (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
)
    ? ["https://que-7pcg.onrender.com/api", "http://localhost:3000/api"]
    : ["/api", "https://que-7pcg.onrender.com/api"];

const API_BASE_STORAGE_KEY = 'que_api_base';
const PRODUCT_CACHE_STORAGE_KEY = 'que_products_cache_v1';
const PRODUCT_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 saat
const PRODUCT_REQUEST_TIMEOUT_MS = 15000;
const PRODUCT_RETRY_COUNT = 2;
const PRODUCT_RETRY_BACKOFF_MS = 500;
const PRODUCT_BACKGROUND_SYNC_DEBOUNCE_MS = 2000;
const PRODUCT_METRICS_STORAGE_KEY = 'que_products_metrics_v1';
const PRODUCT_METRICS_LIMIT = 20;

let productsInFlightPromise = null;
let lastBackgroundSyncAt = 0;

function recordProductFetchMetric({ baseUrl, status, durationMs, count, errorMessage }) {
    try {
        const raw = sessionStorage.getItem(PRODUCT_METRICS_STORAGE_KEY);
        const current = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(current) ? current : [];

        list.push({
            ts: Date.now(),
            baseUrl,
            status,
            durationMs: Math.round(durationMs),
            count: Number.isFinite(count) ? count : null,
            errorMessage: errorMessage || null
        });

        while (list.length > PRODUCT_METRICS_LIMIT) {
            list.shift();
        }

        sessionStorage.setItem(PRODUCT_METRICS_STORAGE_KEY, JSON.stringify(list));
    } catch (_) {
        // sessionStorage bazı tarayıcı modlarında kısıtlı olabilir.
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PRODUCT_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function readProductCache(options = {}) {
    const allowExpired = Boolean(options.allowExpired);

    try {
        const raw = localStorage.getItem(PRODUCT_CACHE_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const timestamp = Number(parsed?.timestamp || 0);
        const products = parsed?.products;

        if (!Array.isArray(products) || !timestamp) return null;
        if (products.length === 0) return null;
        if (!allowExpired && Date.now() - timestamp > PRODUCT_CACHE_TTL_MS) return null;

        return products;
    } catch (_) {
        return null;
    }
}

function writeProductCache(products) {
    try {
        if (!Array.isArray(products)) return;
        if (products.length === 0) {
            localStorage.removeItem(PRODUCT_CACHE_STORAGE_KEY);
            return;
        }
        localStorage.setItem(PRODUCT_CACHE_STORAGE_KEY, JSON.stringify({
            timestamp: Date.now(),
            products
        }));
    } catch (_) {
        // localStorage bazı tarayıcı modlarında kısıtlı olabilir.
    }
}

function clearProductCache() {
    try {
        localStorage.removeItem(PRODUCT_CACHE_STORAGE_KEY);
    } catch (_) {
        // localStorage bazı tarayıcı modlarında kısıtlı olabilir.
    }
}

function notifyProductsUpdated(products, source = 'live') {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;

    window.dispatchEvent(new CustomEvent('que:products-updated', {
        detail: {
            source,
            count: Array.isArray(products) ? products.length : 0,
            timestamp: Date.now()
        }
    }));
}

async function fetchProductsFromBase(baseUrl) {
    let lastError = null;

    for (let attempt = 0; attempt <= PRODUCT_RETRY_COUNT; attempt++) {
        const startedAt = performance.now();

        try {
            const response = await fetchWithTimeout(`${baseUrl}/products`, { cache: "no-store" });

            if (response.ok) {
                const products = await response.json();
                const safeProducts = Array.isArray(products) ? products : [];
                recordProductFetchMetric({
                    baseUrl,
                    status: 'ok',
                    durationMs: performance.now() - startedAt,
                    count: safeProducts.length
                });
                return safeProducts;
            }

            if ((response.status === 401 || response.status === 403) && sessionStorage.getItem('authToken')) {
                const retryWithAuth = await fetchWithTimeout(`${baseUrl}/products`, {
                    cache: "no-store",
                    headers: { ...API.getAuthHeaders() }
                });

                if (retryWithAuth.ok) {
                    const products = await retryWithAuth.json();
                    const safeProducts = Array.isArray(products) ? products : [];
                    recordProductFetchMetric({
                        baseUrl,
                        status: 'ok-auth',
                        durationMs: performance.now() - startedAt,
                        count: safeProducts.length
                    });
                    return safeProducts;
                }

                const retryMessage = await extractErrorMessage(retryWithAuth, "Ürünler yüklenemedi");
                lastError = new Error(retryMessage);

                if (isRetryableStatus(retryWithAuth.status) && attempt < PRODUCT_RETRY_COUNT) {
                    await delay(PRODUCT_RETRY_BACKOFF_MS * (attempt + 1));
                    continue;
                }

                throw lastError;
            }

            const message = await extractErrorMessage(response, "Ürünler yüklenemedi");
            lastError = new Error(message);

            if (isRetryableStatus(response.status) && attempt < PRODUCT_RETRY_COUNT) {
                await delay(PRODUCT_RETRY_BACKOFF_MS * (attempt + 1));
                continue;
            }

            throw lastError;
        } catch (error) {
            const isTimeout = error?.name === 'AbortError';
            lastError = isTimeout
                ? new Error('Ürün isteği zaman aşımına uğradı')
                : error;

            recordProductFetchMetric({
                baseUrl,
                status: isTimeout ? 'timeout' : 'error',
                durationMs: performance.now() - startedAt,
                errorMessage: lastError?.message || 'Bilinmeyen hata'
            });

            if (attempt < PRODUCT_RETRY_COUNT) {
                await delay(PRODUCT_RETRY_BACKOFF_MS * (attempt + 1));
                continue;
            }

            throw lastError;
        }
    }

    throw lastError || new Error("Ürünler yüklenemedi");
}

async function fetchAndMergeProductsFromSources() {
    let lastError = null;
    const mergedProducts = [];
    const seenKeys = new Set();

    const candidateBases = getApiBaseCandidates();
    const settled = await Promise.all(candidateBases.map(async (baseUrl) => {
        try {
            const products = await fetchProductsFromBase(baseUrl);
            return { baseUrl, products, error: null };
        } catch (error) {
            return { baseUrl, products: null, error };
        }
    }));

    const successfulResults = settled.filter(result => Array.isArray(result.products));
    const hasLiveSource = successfulResults.length > 0;

    successfulResults.forEach(result => {
        result.products.forEach(product => {
            const key = buildProductMergeKey(product);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                mergedProducts.push(product);
            }
        });
    });

    const preferredSource = successfulResults.find(result => result.products.length > 0) || successfulResults[0];
    if (preferredSource) {
        rememberApiBase(preferredSource.baseUrl);
    }

    const failedResults = settled.filter(result => result.error);
    if (failedResults.length > 0) {
        lastError = failedResults[failedResults.length - 1].error;
    }

    return { mergedProducts, hasLiveSource, lastError };
}

function shouldDebounceBackgroundSync() {
    return Date.now() - lastBackgroundSyncAt < PRODUCT_BACKGROUND_SYNC_DEBOUNCE_MS;
}

function scheduleBackgroundProductSync() {
    if (productsInFlightPromise || shouldDebounceBackgroundSync()) return;

    lastBackgroundSyncAt = Date.now();
    productsInFlightPromise = fetchAndMergeProductsFromSources()
        .then(result => {
            if (result.mergedProducts.length > 0) {
                writeProductCache(result.mergedProducts);
                notifyProductsUpdated(result.mergedProducts, 'background-sync');
                return;
            }

            if (result.hasLiveSource) {
                writeProductCache([]);
                notifyProductsUpdated([], 'background-sync');
            }
        })
        .catch(() => {})
        .finally(() => {
            productsInFlightPromise = null;
        });
}

async function fetchProductsWithFallback(staleProducts) {
    if (productsInFlightPromise) {
        return productsInFlightPromise;
    }

    productsInFlightPromise = (async () => {
        const liveResult = await fetchAndMergeProductsFromSources();

        if (liveResult.mergedProducts.length > 0) {
            writeProductCache(liveResult.mergedProducts);
            notifyProductsUpdated(liveResult.mergedProducts, 'live-fetch');
            return liveResult.mergedProducts;
        }

        if (staleProducts) {
            return staleProducts;
        }

        if (liveResult.hasLiveSource) {
            writeProductCache([]);
            notifyProductsUpdated([], 'live-fetch');
            return [];
        }

        throw liveResult.lastError || new Error("Ürünler yüklenemedi");
    })().finally(() => {
        productsInFlightPromise = null;
    });

    return productsInFlightPromise;
}

function uniqueApiBases(items) {
    const normalized = [];
    const seen = new Set();
    items.filter(Boolean).forEach(item => {
        const value = String(item).trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        normalized.push(value);
    });
    return normalized;
}

function getApiBaseCandidates() {
    const remembered = sessionStorage.getItem(API_BASE_STORAGE_KEY);
    return uniqueApiBases([remembered, API_URL, ...API_URL_FALLBACKS]);
}

function rememberApiBase(baseUrl) {
    if (!baseUrl) return;
    sessionStorage.setItem(API_BASE_STORAGE_KEY, baseUrl);
}

function buildProductMergeKey(product) {
    if (product?._id) return `id:${product._id}`;
    const name = String(product?.name || '').trim().toLowerCase();
    const price = Number(product?.price || 0);
    const firstImg = String((product?.imgs && product.imgs[0]) || '').trim();
    return `fp:${name}|${price}|${firstImg}`;
}

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
    getAuthHeaders() {
        const token = sessionStorage.getItem('authToken');
        return token ? { Authorization: `Bearer ${token}` } : {};
    },

    // --- ÜRÜN İŞLEMLERİ ---

    // Tüm ürünleri getir
    async getProducts() {
        const cachedProducts = readProductCache();
        const staleProducts = readProductCache({ allowExpired: true });

        if (cachedProducts) {
            scheduleBackgroundProductSync();
            return cachedProducts;
        }

        return fetchProductsWithFallback(staleProducts);
    },

    // Ürün Kaydet (Hem Yeni Ekleme Hem Güncelleme)
    async saveProduct(product) {
        const productId = product._id || product.id;
        const method = productId ? "PUT" : "POST";
        const path = productId
            ? `/products/${productId}`
            : `/products`;

        const payload = { ...product };
        if (productId) {
            delete payload._id;
            delete payload.id;
        }

        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}${path}`, {
                    method: method,
                    headers: { "Content-Type": "application/json", ...API.getAuthHeaders() },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    rememberApiBase(baseUrl);
                    clearProductCache();
                    scheduleBackgroundProductSync();
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Kayıt işlemi başarısız");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Kayıt işlemi başarısız");
    },

    // Ürün Sil
    async deleteProduct(id) {
        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/products/${id}`, {
                    method: "DELETE",
                    headers: { ...API.getAuthHeaders() }
                });

                if (response.ok) {
                    rememberApiBase(baseUrl);
                    clearProductCache();
                    scheduleBackgroundProductSync();
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Silme işlemi başarısız");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error("Silme işlemi başarısız");
    },

    // --- SİPARİŞ İŞLEMLERİ ---

    // Sipariş Oluştur
    async createOrder(order) {
        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/orders`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...API.getAuthHeaders() },
                    body: JSON.stringify(order)
                });

                if (response.ok) {
                    rememberApiBase(baseUrl);
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Sipariş oluşturulamadı");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error("Sipariş oluşturulamadı");
    },

    async getOrders() {
        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/orders`, { cache: "no-store", headers: { ...API.getAuthHeaders() } });
                if (response.ok) {
                    rememberApiBase(baseUrl);
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Siparişler yüklenemedi");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Siparişler yüklenemedi");
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

        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/orders/${orderId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", ...API.getAuthHeaders() },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    rememberApiBase(baseUrl);
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Sipariş güncellenemedi");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Sipariş güncellenemedi");
    },

    async getUsers() {
        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/users`, { cache: "no-store", headers: { ...API.getAuthHeaders() } });
                if (response.ok) {
                    rememberApiBase(baseUrl);
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Kullanıcılar yüklenemedi");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Kullanıcılar yüklenemedi");
    },

    // --- KULLANICI & GİRİŞ İŞLEMLERİ ---

    async login(emailOrData, passArg) {
        const email = typeof emailOrData === 'object' ? emailOrData?.email : emailOrData;
        const pass = typeof emailOrData === 'object' ? emailOrData?.pass : passArg;

        let lastError = null;
        for (const baseUrl of getApiBaseCandidates()) {
            try {
                const response = await fetch(`${baseUrl}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, pass })
                });

                if (response.ok) {
                    rememberApiBase(baseUrl);
                    return await response.json();
                }

                const message = await extractErrorMessage(response, "Giriş başarısız");
                lastError = new Error(message);
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error("Giriş başarısız");
    },

    async register(userData) {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData)
        });
        if (!response.ok) {
            const message = await extractErrorMessage(response, "Kayıt başarısız");
            throw new Error(message);
        }
        return await response.json();
    },

    async changePassword(data) {
        const response = await fetch(`${API_URL}/users/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...API.getAuthHeaders() },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const message = await extractErrorMessage(response, "Şifre değiştirilemedi");
            throw new Error(message);
        }
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
