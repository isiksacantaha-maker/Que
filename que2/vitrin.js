/* ==========================================================================
   1. GLOBAL DEĞİŞKENLER VE BAŞLATMA
   ========================================================================== */
let isEditMode = false;
let draggedItemIndex = null;
let currentEditImages = [];
let currentAddImages = [];

const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_DIMENSION = 1400;
const JPEG_QUALITY = 0.75;
const MAX_PAYLOAD_BYTES = 23 * 1024 * 1024;
const MIN_IMAGE_COUNT = 3;
const PRODUCT_LIST_RETRY_DELAY_MS = 3500;
const PRODUCT_LIST_SKELETON_COUNT = 9;
const PRODUCT_EVENT_REFRESH_GAP_MS = 1200;
let productListRetryTimer = null;
let lastProductEventRefreshAt = 0;
let productRenderRequestId = 0;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupDropZone();
    setupAddDropZone();
    initMobileFilterPanel();
    updateCartCount();
    window.addEventListener('online', () => renderProducts());
    window.addEventListener('que:products-updated', handleProductsUpdatedEvent);
});

function isMobileViewport() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function initMobileFilterPanel() {
    const sidebar = document.querySelector('.filter-sidebar');
    const toggleBtn = document.getElementById('mobile-filter-toggle');
    if (!sidebar || !toggleBtn) return;

    const syncPanelState = () => {
        if (isMobileViewport()) {
            sidebar.classList.remove('mobile-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        } else {
            sidebar.classList.remove('mobile-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
    };

    syncPanelState();
    window.addEventListener('resize', syncPanelState);
}

function toggleMobileFilters() {
    const sidebar = document.querySelector('.filter-sidebar');
    const toggleBtn = document.getElementById('mobile-filter-toggle');
    if (!sidebar || !toggleBtn || !isMobileViewport()) return;

    const nextOpen = !sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open', nextOpen);
    toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
}

function renderProductListSkeleton() {
    const list = document.getElementById('product-list');
    if (!list) return;

    list.innerHTML = Array.from({ length: PRODUCT_LIST_SKELETON_COUNT }).map(() => `
        <div class="product-card product-skeleton" aria-hidden="true">
            <div class="image-slider skeleton-block"></div>
            <div class="product-info">
                <div class="skeleton-line skeleton-line-title"></div>
                <div class="skeleton-line skeleton-line-price"></div>
            </div>
        </div>
    `).join('');
}

function handleProductsUpdatedEvent() {
    const now = Date.now();
    if (now - lastProductEventRefreshAt < PRODUCT_EVENT_REFRESH_GAP_MS) return;
    lastProductEventRefreshAt = now;

    renderProducts();
}

function retryCollectionLoad() {
    renderProducts();
}

function initApp() {
    console.log("VİTRİN BAŞLATILDI");
    renderProducts();
    checkAdminAccess();
    console.log("VİTRİN HAZIR");
}

function checkAdminAccess() {
    const role = sessionStorage.getItem('userRole');
    const isAdmin = role === 'admin' || role === 'developer';
    const adminBar = document.getElementById('admin-edit-bar');
    const adminTools = document.getElementById('admin-only-tools');
    
    if (isAdmin) {
        if (adminBar) {
            adminBar.classList.remove('hidden');
            console.log("✅ ADMIN MODU AKTİF - Ürünler sürükleyerek sıralanabilir");
        }
        if (adminTools) adminTools.classList.remove('hidden');
    } else {
        if (adminBar) adminBar.classList.add('hidden');
        if (adminTools) adminTools.classList.add('hidden');
    }
}

/* ==========================================================================
   2. ÜRÜN LİSTELEME VE RENDER
   ========================================================================== */
async function renderProducts(filterData = null) {
    const list = document.getElementById('product-list');
    if (!list) return;
    const requestId = ++productRenderRequestId;
    const hasFilterData = Array.isArray(filterData);

    if (productListRetryTimer) {
        clearTimeout(productListRetryTimer);
        productListRetryTimer = null;
    }

    if (!list.children.length && !hasFilterData) {
        renderProductListSkeleton();
    }

    let displayData = filterData;
    if (!hasFilterData) {
        try {
            displayData = await API.getProducts();
        } catch (error) {
            if (requestId !== productRenderRequestId) return;
            console.error("Ürünler yüklenemedi:", error);
            list.innerHTML = `
                <div class="load-error-box">
                    <p>Sunucu bağlantısı kurulamadı. Yeniden deneniyor...</p>
                    <button class="retry-load-btn" onclick="retryCollectionLoad()">Tekrar Dene</button>
                </div>
            `;
            productListRetryTimer = setTimeout(() => renderProducts(), PRODUCT_LIST_RETRY_DELAY_MS);
            return;
        }
    }

    if (requestId !== productRenderRequestId) return;

    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const role = sessionStorage.getItem('userRole');
    const isAdmin = role === 'admin' || role === 'developer';
    
    if (!Array.isArray(displayData) || displayData.length === 0) {
        list.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #999;">Listelenecek ürün bulunamadı.</p>';
        return;
    }

    list.innerHTML = displayData.map((p, index) => {
        const isFav = wishlist.includes(p._id);
        const images = getProductImages(p);
        const productName = p.name || 'Isimsiz Urun';
        const shouldPrioritize = index < 6;
        const loadingMode = shouldPrioritize ? 'eager' : 'lazy';
        const fetchPriority = shouldPrioritize ? 'high' : 'low';
        
        // Admin Üç Nokta (Düzenle)
        const adminTrigger = (isAdmin && !isEditMode) ? 
            `<div class="admin-edit-trigger" onclick="event.stopPropagation(); openEditPanel('${p._id}')">
                <i class="fas fa-ellipsis-v"></i>
            </div>` : '';

        // Admin Silme İşareti (Düzenleme Modu'nda)
        const deleteTrigger = (isAdmin && isEditMode) ? 
            `<div class="admin-delete-trigger" onclick="event.stopPropagation(); deleteProductQuick('${p._id}')" title="Ürünü Sil">
                <i class="fas fa-times"></i>
            </div>` : '';

        return `
            <div class="product-card" 
                 draggable="${isEditMode}" 
                 ondragstart="handleDragStart(${index})" 
                 ondragover="event.preventDefault()" 
                 ondrop="handleDrop(${index})"
                 onmousemove="handleProductHover(event, this)"
                  onmouseleave="resetProductHover(this)"
                 onclick="handleProductAction(event, '${p._id}')">
                
                ${adminTrigger}
                ${deleteTrigger}

                <div class="card-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); toggleWishlist('${p._id}')">
                        <i class="${isFav ? 'fas' : 'far'} fa-heart" style="${isFav ? 'color:#d4af37' : ''}"></i>
                    </button>
                    <button class="action-btn" onclick="event.stopPropagation(); addToCart('${p._id}')">
                        <i class="fas fa-shopping-bag"></i>
                    </button>
                </div>

                <div class="image-slider">
                    <img src="${images.card[0]}" class="p-img active" alt="${productName} 1" loading="${loadingMode}" decoding="async" fetchpriority="${fetchPriority}">
                    <img src="${images.card[1]}" class="p-img" alt="${productName} 2" loading="lazy" decoding="async" fetchpriority="low">
                    <img src="${images.card[2]}" class="p-img" alt="${productName} 3" loading="lazy" decoding="async" fetchpriority="low">
                </div>

                <div class="product-info">
                    <h3>${productName}</h3>
                    <div class="price">${formatProductPrice(p.price)}</div>
                </div>
            </div>`;
    }).join('');
}

window.retryCollectionLoad = retryCollectionLoad;

/* ==========================================================================
   3. ADMİN MODU VE SIRALAMA (DRAG & DROP)
   ========================================================================== */
function toggleEditMode() {
    isEditMode = !isEditMode;
    const grid = document.getElementById('product-list');
    const btn = document.getElementById('toggle-edit-btn');

    if (isEditMode) {
        grid.classList.add('edit-active');
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-check"></i> DÜZENLE MODUNU KAPAT';
        btn.style.background = "#27ae60";
    } else {
        grid.classList.remove('edit-active');
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-edit"></i> DÜZENLE MODUNU AÇ';
        btn.style.background = "#333";
    }
    renderProducts();
}

function handleDragStart(index) { draggedItemIndex = index; }

async function handleDrop(targetIndex) {
    let allProducts = await API.getProducts();
    const movedItem = allProducts.splice(draggedItemIndex, 1)[0];
    allProducts.splice(targetIndex, 0, movedItem);
    
    // Not: Toplu sıralama güncellemesi için API'de özel bir endpoint gerekebilir, şimdilik tek tek update simülasyonu
    renderProducts();
}

// AKSİYON YÖNETİCİSİ (Hızlı İnceleme vs Düzenleme)
function handleProductAction(event, id) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (isEditMode) {
        openEditPanel(id);
    } else {
        openDetailModal(id);
    }
    return false;
}

/* ==========================================================================
   4. ÜRÜN DETAY PENCERESİ (QUICK VIEW)
   ========================================================================== */
let currentGalleryIndex = 0;
let currentGalleryImages = [];

function attachGallerySwipe() {
    const wrapper = document.querySelector('.main-img-wrapper');
    if (!wrapper || wrapper.dataset.swipeBound === '1') return;

    wrapper.dataset.swipeBound = '1';

    let startX = 0;
    let startY = 0;
    const SWIPE_THRESHOLD = 40;
    const MAX_VERTICAL_DRIFT = 60;

    wrapper.addEventListener('touchstart', (event) => {
        if (!currentGalleryImages || currentGalleryImages.length < 2) return;
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
    }, { passive: true });

    wrapper.addEventListener('touchend', (event) => {
        if (!currentGalleryImages || currentGalleryImages.length < 2) return;
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > MAX_VERTICAL_DRIFT) return;

        if (deltaX < 0) {
            nextGalleryImage();
        } else {
            prevGalleryImage();
        }
    }, { passive: true });
}

async function openDetailModal(id) {
    let products = [];
    products = await API.getProducts();
    
    const p = products.find(x => x._id === id);
    if (!p) return;

    const overlay = document.getElementById('detail-overlay');
    const content = document.getElementById('detail-content');
    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const isFav = wishlist.includes(p._id);
    const images = getProductImages(p);

    currentGalleryIndex = 0;
    currentGalleryImages = images.gallery;

    content.innerHTML = `
        <div class="gallery-container">
            <button class="gallery-close-btn" onclick="closeDetailModal()">
                <i class="fas fa-times"></i>
            </button>

            <div class="detail-gallery">
                <div class="main-img-wrapper">
                    <img src="${images.gallery[0]}" id="mainDetailImg" class="main-detail-img" alt="Urun Resmi">
                    
                    <button class="gallery-nav-btn gallery-prev" onclick="prevGalleryImage()">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="gallery-nav-btn gallery-next" onclick="nextGalleryImage()">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>

                <div class="thumb-strip">
                    ${images.gallery.map((img, idx) => `
                        <img src="${img}" class="thumb-img ${idx === 0 ? 'active' : ''}" 
                             onclick="selectGalleryImage(${idx})" alt="Resim ${idx + 1}">
                    `).join('')}
                </div>
            </div>

            <div class="detail-info">
                <span class="category">${p.category || 'ÖZEL TASARIM'}</span>
                <h2>${p.name || 'Isimsiz Urun'}</h2>
                <p class="desc">${p.description || 'Que Jewelry kalitesiyle özenle tasarlanmıştır.'}</p>
                <div class="price-display">${formatProductPrice(p.price)}</div>

                <div class="detail-buttons">
                    <button onclick="toggleWishlistDetail('${p._id}')" class="action-btn-main btn-fav ${isFav ? 'active' : ''}">
                        <i class="fas fa-heart"></i> ${isFav ? 'BEĞENMEKTEN VAZGEÇ' : 'BEĞENDİM'}
                    </button>
                    <button onclick="addToCart('${p._id}')" class="action-btn-main btn-update">
                        <i class="fas fa-shopping-bag"></i> SEPETE EKLE
                    </button>
                </div>
            </div>
        </div>
    `;

    attachGallerySwipe();

    overlay.style.display = 'flex';
    document.body.style.overflow = ''; 
}

function selectGalleryImage(idx) {
    currentGalleryIndex = idx;
    const mainImg = document.getElementById('mainDetailImg');
    mainImg.src = currentGalleryImages[idx];
    
    document.querySelectorAll('.thumb-img').forEach((t, i) => {
        t.classList.toggle('active', i === idx);
    });
}

function nextGalleryImage() {
    currentGalleryIndex = (currentGalleryIndex + 1) % currentGalleryImages.length;
    selectGalleryImage(currentGalleryIndex);
}

function prevGalleryImage() {
    currentGalleryIndex = (currentGalleryIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
    selectGalleryImage(currentGalleryIndex);
}

function toggleWishlistDetail(id) {
    const addedToFavorites = toggleWishlist(id);
    const isFav = addedToFavorites === true;
    const content = document.getElementById('detail-content');
    const btn = content.querySelector('.btn-fav');
    
    if (btn) {
        btn.classList.toggle('active', isFav);
        btn.innerHTML = isFav 
            ? '<i class="fas fa-heart"></i> FAVORİLERİNİZE EKLENDİ'
            : '<i class="fas fa-heart"></i> FAVORİLERİNİZDEN ÇIKARILDI';
    }

    if (typeof showToast === 'function') {
        showToast(isFav ? 'Ürün favorilerinize eklendi' : 'Ürün favorilerinizden çıkarıldı');
    }
}

function closeDetailModal() {
    document.getElementById('detail-overlay').style.display = 'none';
    document.body.style.overflow = '';
}

/* ==========================================================================
   5. EDİT PANELİ VE FOTOĞRAF YÜKLEME (MAX 5)
   ========================================================================== */
async function openEditPanel(id) {
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const p = allProducts.find(x => x._id === id);
    if (!p) return;

    document.getElementById('edit-id').value = p._id;
    document.getElementById('edit-name').value = p.name;
    document.getElementById('edit-price').value = p.price;
    document.getElementById('edit-category').value = p.category || "";
    document.getElementById('edit-desc').value = p.description || "";
    
    currentEditImages = p.imgs ? [...p.imgs] : [];
    updateImagePreviews();
    
    const overlay = document.getElementById('edit-overlay');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function setupDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const editInput = document.getElementById('edit-image-input');
    if (!dropZone) return;

    if (editInput) {
        editInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleFiles(files);
            editInput.value = '';
        });
    }

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        handleFiles(files);
    });
}

/* ÜRÜN EKLEME DROP ZONE */
function setupAddDropZone() {
    const dropZone = document.getElementById('drop-zone-add');
    const addInput = document.getElementById('add-image-input');
    if (!dropZone) return;

    if (addInput) {
        addInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleAddFiles(files);
            addInput.value = '';
        });
    }

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        handleAddFiles(files);
    });
}

async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Dosya okunamadı'));
        reader.readAsDataURL(file);
    });
}

async function compressImageFile(file) {
    const originalDataUrl = await fileToDataUrl(file);

    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSide = Math.max(img.width, img.height);
            const ratio = maxSide > MAX_IMAGE_DIMENSION ? (MAX_IMAGE_DIMENSION / maxSide) : 1;

            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Resim işleme başlatılamadı'));
                return;
            }

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedDataUrl = canvas.toDataURL('image/webp', JPEG_QUALITY);
            resolve(compressedDataUrl);
        };

        img.onerror = () => reject(new Error('Resim işlenemedi'));
        img.src = originalDataUrl;
    });
}

function isDataImage(value) {
    return typeof value === 'string' && value.startsWith('data:image');
}

async function recompressDataUrl(dataUrl, maxDimension, quality, format = 'image/webp') {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSide = Math.max(img.width, img.height);
            const ratio = maxSide > maxDimension ? (maxDimension / maxSide) : 1;

            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Resim işleme başlatılamadı'));
                return;
            }

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL(format, quality));
        };

        img.onerror = () => reject(new Error('Resim yeniden sıkıştırılamadı'));
        img.src = dataUrl;
    });
}

function getEstimatedPayloadBytes(product) {
    try {
        return new Blob([JSON.stringify(product)]).size;
    } catch (_) {
        return JSON.stringify(product).length;
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizePriceValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    let text = String(value ?? '').trim();
    if (!text) return 0;

    // Para simgeleri ve gereksiz karakterleri temizle.
    text = text.replace(/\s+/g, '').replace(/[^\d,.-]/g, '');

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma && hasDot) {
        const lastComma = text.lastIndexOf(',');
        const lastDot = text.lastIndexOf('.');

        if (lastComma > lastDot) {
            text = text.replace(/\./g, '').replace(',', '.');
        } else {
            text = text.replace(/,/g, '');
        }
    } else if (hasComma) {
        text = /,\d{1,2}$/.test(text)
            ? text.replace(',', '.')
            : text.replace(/,/g, '');
    } else if (hasDot) {
        text = /\.\d{1,2}$/.test(text)
            ? text
            : text.replace(/\./g, '');
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function optimizeProductForUpload(product) {
    let optimizedProduct = { ...product, imgs: [...(product.imgs || [])] };
    let payloadBytes = getEstimatedPayloadBytes(optimizedProduct);

    if (payloadBytes <= MAX_PAYLOAD_BYTES) {
        return { product: optimizedProduct, payloadBytes, optimized: false };
    }

    const compressionProfiles = [
        { maxDimension: 1100, quality: 0.64, format: 'image/webp' },
        { maxDimension: 900, quality: 0.56, format: 'image/webp' },
        { maxDimension: 760, quality: 0.48, format: 'image/webp' },
        { maxDimension: 640, quality: 0.42, format: 'image/webp' },
        { maxDimension: 520, quality: 0.36, format: 'image/webp' },
        { maxDimension: 420, quality: 0.30, format: 'image/webp' },
        { maxDimension: 360, quality: 0.26, format: 'image/webp' },
        { maxDimension: 300, quality: 0.22, format: 'image/webp' }
    ];

    for (const profile of compressionProfiles) {
        const recompressed = [];

        for (const img of optimizedProduct.imgs) {
            if (!isDataImage(img)) {
                recompressed.push(img);
                continue;
            }

            try {
                const compressed = await recompressDataUrl(
                    img,
                    profile.maxDimension,
                    profile.quality,
                    profile.format
                );
                recompressed.push(compressed);
            } catch (error) {
                console.error('Resim optimize hatası:', error);
                recompressed.push(img);
            }
        }

        optimizedProduct = { ...optimizedProduct, imgs: recompressed };
        payloadBytes = getEstimatedPayloadBytes(optimizedProduct);

        if (payloadBytes <= MAX_PAYLOAD_BYTES) {
            return { product: optimizedProduct, payloadBytes, optimized: true };
        }
    }

    return { product: optimizedProduct, payloadBytes, optimized: true };
}

async function handleAddFiles(files) {
    if (currentAddImages.length + files.length > MAX_IMAGE_COUNT) {
        showToast(`En fazla 5 fotoğraf ekleyebilirsiniz`);
        return;
    }

    let ignoredCount = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            ignoredCount++;
            continue;
        }

        try {
            const compressedImage = await compressImageFile(file);
            currentAddImages.push(compressedImage);
        } catch (error) {
            console.error('Resim sıkıştırma hatası:', error);
            showToast(`${file.name} işlenemedi`);
        }
    }

    updateAddImagePreviews();

    if (ignoredCount > 0) {
        showToast(`${ignoredCount} dosya resim olmadığı için atlandı`);
    }
}

function updateAddImagePreviews() {
    const container = document.getElementById('image-previews-add');
    if (!container) return;
    
    container.innerHTML = currentAddImages.map((img, idx) => `
        <div class="preview-wrapper">
            <img src="${img}" class="preview-img">
            <span class="img-index">${idx + 1}</span>
            <div class="delete-img-btn" onclick="removeAddImage(${idx})">
                <i class="fas fa-times"></i>
            </div>
        </div>`).join('');
}

function removeAddImage(index) {
    currentAddImages.splice(index, 1);
    updateAddImagePreviews();
}

async function handleFiles(files) {
    if (currentEditImages.length + files.length > MAX_IMAGE_COUNT) {
        showToast(`En fazla 5 fotoğraf ekleyebilirsiniz`);
        return;
    }

    let ignoredCount = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            ignoredCount++;
            continue;
        }

        try {
            const compressedImage = await compressImageFile(file);
            currentEditImages.push(compressedImage);
        } catch (error) {
            console.error('Resim sıkıştırma hatası:', error);
            showToast(`${file.name} işlenemedi`);
        }
    }

    updateImagePreviews();

    if (ignoredCount > 0) {
        showToast(`${ignoredCount} dosya resim olmadığı için atlandı`);
    }
}

function updateImagePreviews() {
    const container = document.getElementById('image-previews');
    if (!container) return;
    
    container.innerHTML = currentEditImages.map((img, idx) => `
        <div class="preview-wrapper">
            <img src="${img}" class="preview-img">
            <span class="img-index">${idx + 1}</span>
            <div class="delete-img-btn" onclick="removeImage(${idx})">
                <i class="fas fa-times"></i>
            </div>
        </div>`).join('');
}

function removeImage(index) {
    currentEditImages.splice(index, 1);
    updateImagePreviews();
}

function openEditFilePicker(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const input = document.getElementById('edit-image-input');
    if (input) input.click();
}

function openAddFilePicker(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const input = document.getElementById('add-image-input');
    if (input) input.click();
}

/* ==========================================================================
   6. VERİ İŞLEMLERİ (KAYDET & SİL)
   ========================================================================== */
async function saveProductUpdate() {
    const id = document.getElementById('edit-id').value;
    
    if (currentEditImages.length < MIN_IMAGE_COUNT) {
        showToast(`Her ürün için en az ${MIN_IMAGE_COUNT} fotoğraf gerekli`);
        return;
    }

    const normalizedEditPrice = normalizePriceValue(document.getElementById('edit-price').value);
    if (normalizedEditPrice <= 0) {
        showToast('Lütfen geçerli bir fiyat girin');
        return;
    }

    let updatedProduct = {
        _id: id,
        name: document.getElementById('edit-name').value,
        price: normalizedEditPrice,
        category: document.getElementById('edit-category').value,
        description: document.getElementById('edit-desc').value,
        imgs: currentEditImages
    };

    const updateOptimization = await optimizeProductForUpload(updatedProduct);
    updatedProduct = updateOptimization.product;
    currentEditImages = [...updatedProduct.imgs];
    updateImagePreviews();

    if (updateOptimization.optimized) {
        showToast(`Görseller optimize edildi (${formatBytes(updateOptimization.payloadBytes)})`);
    }

    const updatePayloadBytes = updateOptimization.payloadBytes;
    if (updatePayloadBytes > MAX_PAYLOAD_BYTES) {
        alert(`Güncelleme verisi hâlâ büyük (${formatBytes(updatePayloadBytes)}). En az 3 foto korunarak daha güçlü sıkıştırma için küçük çözünürlüklü görsel kullanın.`);
        return;
    }

    try {
        await API.saveProduct(updatedProduct);
    } catch (error) {
        if ((error.message || '').includes('413')) {
            alert(`Güncelleme reddedildi (413). Gönderilen veri: ${formatBytes(updatePayloadBytes)}. 3 fotoğrafı koruyarak daha düşük çözünürlüklü dosya seçin.`);
            return;
        }
        alert("Güncelleme başarısız: " + error.message);
        return;
    }
    
    renderProducts();
    closeEditPanel();
    showToast(`Ürün başarıyla güncellendi`);
}

async function deleteProduct() {
    const id = document.getElementById('edit-id').value;
    
    if (confirm("Bu ürünü tamamen silmek istediğine emin misin?")) {
        try {
            await API.deleteProduct(id);
        } catch (error) {
            alert("Silme işlemi başarısız: " + error.message);
            return;
        }
        renderProducts();
        closeEditPanel();
        showToast(`Ürün silindi`);
    }
}

function closeEditPanel() {
    document.getElementById('edit-overlay').style.display = 'none';
    currentEditImages = [];
    document.body.style.overflow = 'auto';
}

/* ==========================================================================
   6A. ÜRÜN EKLEME FONKSİYONLARI
   ========================================================================== */
function openAddProductModal() {
    const overlay = document.getElementById('add-product-overlay');
    currentAddImages = [];
    updateAddImagePreviews();
    
    document.getElementById('add-name').value = '';
    document.getElementById('add-category').value = '';
    document.getElementById('add-price').value = '';
    document.getElementById('add-desc').value = '';
    
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAddProductModal() {
    document.getElementById('add-product-overlay').style.display = 'none';
    currentAddImages = [];
    document.body.style.overflow = 'auto';
}

async function saveNewProduct() {
    const name = document.getElementById('add-name').value.trim();
    const category = document.getElementById('add-category').value;
    const price = normalizePriceValue(document.getElementById('add-price').value);
    const description = document.getElementById('add-desc').value.trim();
    
    if (!name || !category || price <= 0 || currentAddImages.length < MIN_IMAGE_COUNT) {
        showToast(`Lütfen tüm alanları doldurun ve en az ${MIN_IMAGE_COUNT} resim yükleyin`);
        return;
    }
    
    let newProduct = {
        name: name,
        category: category,
        price: price,
        description: description,
        imgs: currentAddImages
    };

    const addOptimization = await optimizeProductForUpload(newProduct);
    newProduct = addOptimization.product;
    currentAddImages = [...newProduct.imgs];
    updateAddImagePreviews();

    if (addOptimization.optimized) {
        showToast(`Görseller optimize edildi (${formatBytes(addOptimization.payloadBytes)})`);
    }

    const payloadBytes = addOptimization.payloadBytes;
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
        showToast(`Yükleme hâlâ büyük (${formatBytes(payloadBytes)}). 3 fotoğrafı koruyarak daha küçük çözünürlükte görsel seçin.`);
        return;
    }
    
    // Buton durumunu güncelle (Loading)
    const btn = document.querySelector('#add-product-overlay .btn-update');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> EKLENİYOR...';

    let createdProduct = null;
    try {
        createdProduct = await API.saveProduct(newProduct);
    } catch (error) {
        if ((error.message || '').includes('413')) {
            alert(`Ürün eklenemedi: Sunucu veri boyutunu reddetti (413). Gönderilen veri ${formatBytes(payloadBytes)}. En az 3 foto kuralı korunarak daha düşük çözünürlüklü görseller seçin.`);
            return;
        }
        alert("Ürün eklenemedi: " + error.message);
        return;
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
    
    closeAddProductModal();
    await renderProducts();
    showToast(`${createdProduct?.name || name} • Başarıyla eklendi`);
}

async function deleteProductQuick(id) {
    if (confirm("Bu ürünü silmek istediğinden emin misin?")) {
        try {
            await API.deleteProduct(id);
        } catch (error) {
            alert("Silme işlemi başarısız.");
        }
        renderProducts();
        showToast(`Ürün silindi`);
    }
}

/* ==========================================================================
   7. YARDIMCI FONKSİYONLAR (FİLTRE & HOVER & SEPETİ & BEĞENDİLER)
   ========================================================================== */
function toggleWishlist(id) {
    let wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const index = wishlist.indexOf(id);
    const isAdding = index === -1;

    if (index > -1) {
        wishlist.splice(index, 1);
    } else {
        wishlist.push(id);
    }

    sessionStorage.setItem('que_wishlist', JSON.stringify(wishlist));

    renderProducts();
    return isAdding;
}

async function filterProducts() {
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const selectedCats = Array.from(document.querySelectorAll('.cat-filter:checked')).map(cb => cb.value);
    const sortVal = document.getElementById('sortPrice').value;

    let filtered = allProducts;
    if (selectedCats.length > 0) filtered = filtered.filter(p => selectedCats.includes(p.category));

    if (sortVal === "low") {
        filtered.sort((a, b) => normalizePriceValue(a.price) - normalizePriceValue(b.price));
    } else if (sortVal === "high") {
        filtered.sort((a, b) => normalizePriceValue(b.price) - normalizePriceValue(a.price));
    }

    renderProducts(filtered);

    if (isMobileViewport()) {
        const sidebar = document.querySelector('.filter-sidebar');
        const toggleBtn = document.getElementById('mobile-filter-toggle');
        if (sidebar && toggleBtn) {
            sidebar.classList.remove('mobile-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
    }
}

function handleProductHover(e, card) {
    const slider = card.querySelector('.image-slider');
    if (!slider) return;

    const rect = slider.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const images = card.querySelectorAll('.p-img');

    if (!images.length) return;

    // Kenarlarda oluşan taşmaları engelleyip her zaman geçerli bir görsel seç.
    const rawIndex = Math.floor(x / (rect.width / images.length));
    const index = Math.max(0, Math.min(images.length - 1, rawIndex));

    images.forEach((img, i) => img.classList.toggle('active', i === index));
}

function resetProductHover(card) {
    const images = card.querySelectorAll('.p-img');
    if (!images.length) return;
    images.forEach((img, i) => img.classList.toggle('active', i === 0));
}

function formatProductPrice(price) {
    const value = normalizePriceValue(price);
    return Number.isFinite(value) ? `${value.toLocaleString('tr-TR')} TL` : 'Fiyat bilgisi yok';
}

function getProductImages(product) {
    const images = Array.isArray(product?.imgs)
        ? product.imgs.filter(src => typeof src === 'string' && src.trim())
        : [];
    const first = images[0] || 'placeholder.jpg';
    return {
        card: [first, images[1] || first, images[2] || first],
        gallery: images.length ? images : [first]
    };
}