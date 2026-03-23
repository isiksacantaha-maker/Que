/* ==========================================================================
   1. GLOBAL DEĞİŞKENLER VE BAŞLATMA
   ========================================================================== */
let currentGalleryIndex = 0;
let currentGalleryImages = [];

function isMobileTouchViewport() {
    return window.matchMedia('(max-width: 900px)').matches;
}

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
const FEATURED_RETRY_DELAY_MS = 3500;
const FEATURED_SKELETON_COUNT = 6;
const FEATURED_EVENT_REFRESH_GAP_MS = 1200;
let featuredRetryTimer = null;
let lastFeaturedEventRefreshAt = 0;
let featuredRenderRequestId = 0;

document.addEventListener('DOMContentLoaded', () => {
    console.log("📱 Que Jewelry Anasayfa Motoru Çalıştırıldı");
    loadFeaturedProducts();
    updateCartCount();
    initVideoScroll();
    initDetailOverlayInteractions();
    window.addEventListener('online', loadFeaturedProducts);
    window.addEventListener('que:products-updated', handleProductsUpdatedEvent);
});

function initDetailOverlayInteractions() {
    const overlay = document.getElementById('detail-overlay');
    const content = document.getElementById('detail-content');
    if (!overlay || !content || overlay.dataset.bound === '1') return;

    overlay.dataset.bound = '1';

    // Modal dışına ilk tık: kapat. Sonraki tıkta kullanıcı başka ürünü açabilir.
    overlay.addEventListener('click', () => {
        const zoomOverlay = document.getElementById('detail-image-zoom-overlay');
        if (zoomOverlay && zoomOverlay.classList.contains('show')) return;
        closeDetailModal();
    });

    content.addEventListener('click', (event) => {
        event.stopPropagation();
    });
}

function renderFeaturedSkeleton() {
    const productGrid = document.getElementById('featured-products');
    if (!productGrid) return;

    productGrid.innerHTML = Array.from({ length: FEATURED_SKELETON_COUNT }).map(() => `
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
    if (now - lastFeaturedEventRefreshAt < FEATURED_EVENT_REFRESH_GAP_MS) return;
    lastFeaturedEventRefreshAt = now;

    loadFeaturedProducts();
}

function retryFeaturedProducts() {
    loadFeaturedProducts();
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

function formatProductPrice(price) {
    const value = Number(price);
    return Number.isFinite(value)
        ? `${value.toLocaleString('tr-TR')} TL`
        : 'Fiyat bilgisi yok';
}

/* ==========================================================================
   2. VIDEO SCROLL KONTROLÜ (GÜNCELLENDİ)
   ========================================================================== */
function initVideoScroll() {
    const video = document.getElementById('scrollVideo');
    const videoWrapper = document.querySelector('.video-section-wrapper');
    const heroText = document.getElementById('v-text');

    if (!video || !videoWrapper) return;

    let isVideoReady = false;

    const updateVideo = () => {
        if (!isVideoReady || !video.duration || Number.isNaN(video.duration)) return;

        const rect = videoWrapper.getBoundingClientRect();
        const wrapperTop = window.pageYOffset + rect.top;
        const wrapperHeight = videoWrapper.offsetHeight;
        const windowHeight = window.innerHeight;
        
        // Videonun ekrandaki konumuna göre ilerleme oranını hesapla
        // (Video alanı ekrana girdiğinde başlar, çıktığında biter)
        const scrollPos = window.pageYOffset;
        const start = wrapperTop;
        const end = wrapperTop + wrapperHeight - windowHeight;
        
        let progress = (scrollPos - start) / (end - start);
        progress = Math.max(0, Math.min(1, progress));
        video.currentTime = video.duration * progress;
    };

    const markReady = () => {
        isVideoReady = true;
        video.pause();
        updateVideo();
        console.log("🎥 Video hazır, süre:", video.duration);
    };

    video.addEventListener('loadedmetadata', markReady);
    video.addEventListener('canplay', markReady);

    video.addEventListener('error', () => {
        console.error('Ana sayfa videosu yüklenemedi. Dosya yolu: tanitim.mp4');
        if (heroText) {
            heroText.innerHTML = '<h1>Que Jewelry</h1><p style="margin-top:12px;font-size:14px;letter-spacing:2px;opacity:.8;">Tanıtım videosu yüklenemedi</p>';
        }
    });

    if (video.readyState >= 1) markReady();

    // Performans için requestAnimationFrame kullanıyoruz
    window.addEventListener('scroll', () => {
        window.requestAnimationFrame(updateVideo);
    });

    window.addEventListener('resize', () => {
        window.requestAnimationFrame(updateVideo);
    });
}

/* ==========================================================================
   3. ÖNE ÇIKAN ÜRÜNLER (6 ÜRÜN RENDER)
   ========================================================================== */
async function loadFeaturedProducts() {
    const productGrid = document.getElementById('featured-products');
    if (!productGrid) return;
    const requestId = ++featuredRenderRequestId;

    if (featuredRetryTimer) {
        clearTimeout(featuredRetryTimer);
        featuredRetryTimer = null;
    }

    if (!productGrid.children.length) {
        renderFeaturedSkeleton();
    }

    let allProducts = [];
    try {
        allProducts = await API.getProducts();
    } catch (error) {
        if (requestId !== featuredRenderRequestId) return;
        console.error('Öne çıkan ürünler yüklenemedi:', error);
        productGrid.innerHTML = `
            <div class="load-error-box">
                <p>Ürünler şu anda yüklenemiyor. Bağlantı yeniden deneniyor...</p>
                <button class="retry-load-btn" onclick="retryFeaturedProducts()">Tekrar Dene</button>
            </div>
        `;
        featuredRetryTimer = setTimeout(() => loadFeaturedProducts(), FEATURED_RETRY_DELAY_MS);
        return;
    }

    if (requestId !== featuredRenderRequestId) return;
    
    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    // Yeni eklenen ürünler önde olacak şekilde son 6 ürünü göster
    const featuredProducts = [...allProducts].reverse().slice(0, 6);

    if (featuredProducts.length === 0) {
        productGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #999;">Koleksiyon henüz yüklenmedi.</p>';
        return;
    }

    productGrid.innerHTML = featuredProducts.map((p, index) => {
        const isFav = wishlist.includes(p._id);
        const images = getProductImages(p);
        const productName = p.name || 'Isimsiz Urun';
        const shouldPrioritize = index < 2;
        const loadingMode = shouldPrioritize ? 'eager' : 'lazy';
        const fetchPriority = shouldPrioritize ? 'high' : 'low';
        
        return `
            <div class="product-card" 
                 onmousemove="handleProductHover(event, this)"
                  onmouseleave="resetProductHover(this)"
                 onclick="handleFeaturedCardTap(event, '${p._id}')">
                
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
            </div>
        `;
    }).join('');

    setupMobileFeaturedCardSwipe();
}

window.retryFeaturedProducts = retryFeaturedProducts;

/* ==========================================================================
   4. SEPET VE FAVORİ MANTIĞI
   ========================================================================== */
window.toggleWishlist = function(id) {
    let wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const index = wishlist.indexOf(id);
    const isAdding = index === -1;

    if (index > -1) {
        wishlist.splice(index, 1);
    } else {
        wishlist.push(id);
    }

    sessionStorage.setItem('que_wishlist', JSON.stringify(wishlist));

    if (isAdding) {
        window.location.href = 'begendiklerim.html';
        return;
    }

    loadFeaturedProducts(); // Ana sayfadaki kalpleri güncelle
    // Eğer modal açıksa oradaki butonu da güncelle
    const modalFavBtn = document.querySelector('.btn-fav');
    if (modalFavBtn) toggleWishlistDetail(id);
};

/* ==========================================================================
   5. MÜKEMMEL MODAL YAPISI (QUICK VIEW)
   ========================================================================== */
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
                    <img src="${currentGalleryImages[0]}" id="mainDetailImg" class="main-detail-img" alt="Urun Resmi" onclick="openImageZoom(currentGalleryIndex)">
                    
                    <button class="gallery-nav-btn gallery-prev" onclick="prevGalleryImage()">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="gallery-nav-btn gallery-next" onclick="nextGalleryImage()">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>

                <div class="thumb-strip">
                    ${currentGalleryImages.map((img, idx) => `
                        <img src="${img}" class="thumb-img ${idx === 0 ? 'active' : ''}" 
                             onclick="selectGalleryImage(${idx}); openImageZoom(${idx})" alt="Resim ${idx + 1}">
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
                        <i class="fas fa-heart"></i> ${isFav ? 'FAVORİLERDEN ÇIKAR' : 'FAVORİLERİME EKLE'}
                    </button>
                    <button onclick="addToCart('${p._id}')" class="action-btn-main btn-update">
                        <i class="fas fa-shopping-bag"></i> SEPETE EKLE
                    </button>
                </div>
            </div>
        </div>
    `;

    ensureImageZoomOverlay();
    attachGallerySwipe();

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden'; 
}

function selectGalleryImage(idx) {
    currentGalleryIndex = idx;
    const mainImg = document.getElementById('mainDetailImg');
    if (mainImg) mainImg.src = currentGalleryImages[idx];
    
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
    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const isFav = wishlist.includes(id);
    const btn = document.querySelector('.btn-fav');
    
    if (btn) {
        btn.classList.toggle('active', isFav);
        btn.innerHTML = isFav 
            ? '<i class="fas fa-heart"></i> FAVORİLERDEN ÇIKAR'
            : '<i class="fas fa-heart"></i> FAVORİLERİME EKLE';
    }
}

function closeDetailModal() {
    document.getElementById('detail-overlay').style.display = 'none';
    closeImageZoom();
    document.body.style.overflow = 'auto';
}

function ensureImageZoomOverlay() {
    if (document.getElementById('detail-image-zoom-overlay')) return;

    const zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'detail-image-zoom-overlay';
    zoomOverlay.className = 'detail-image-zoom-overlay';
    zoomOverlay.innerHTML = `
        <button class="zoom-close-btn" onclick="closeImageZoom()" aria-label="Kapat">
            <i class="fas fa-times"></i>
        </button>
        <img id="detail-image-zoom-img" class="detail-image-zoom-img" alt="Tam Boyut Urun Gorseli">
        <a id="detail-image-open-new" class="zoom-open-new" href="#" target="_blank" rel="noopener noreferrer">Yeni Sekmede Ac</a>
    `;

    zoomOverlay.addEventListener('click', (event) => {
        if (event.target === zoomOverlay) closeImageZoom();
    });

    document.body.appendChild(zoomOverlay);
}

function openImageZoom(imageIndex) {
    if (!Array.isArray(currentGalleryImages) || !currentGalleryImages.length) return;

    const index = Number.isInteger(imageIndex)
        ? Math.max(0, Math.min(currentGalleryImages.length - 1, imageIndex))
        : currentGalleryIndex;
    const src = currentGalleryImages[index] || currentGalleryImages[0];

    const zoomOverlay = document.getElementById('detail-image-zoom-overlay');
    const zoomImg = document.getElementById('detail-image-zoom-img');
    const openNewLink = document.getElementById('detail-image-open-new');
    if (!zoomOverlay || !zoomImg || !openNewLink) return;

    zoomImg.src = src;
    openNewLink.href = src;
    zoomOverlay.classList.add('show');
}

function closeImageZoom() {
    const zoomOverlay = document.getElementById('detail-image-zoom-overlay');
    if (!zoomOverlay) return;
    zoomOverlay.classList.remove('show');
}

function handleFeaturedCardTap(event, id) {
    const card = event.currentTarget;
    if (card && card.dataset.ignoreTap === '1') {
        event.preventDefault();
        event.stopPropagation();
        card.dataset.ignoreTap = '0';
        return false;
    }

    openDetailModal(id);
    return false;
}

function setCardImageByIndex(card, index, swipeDirection = null) {
    const images = card.querySelectorAll('.p-img');
    if (!images.length) return;

    let currentIndex = 0;
    images.forEach((img, i) => {
        if (img.classList.contains('active')) currentIndex = i;
        img.classList.remove('swipe-enter-from-left', 'swipe-enter-from-right');
    });

    const safeIndex = Math.max(0, Math.min(images.length - 1, index));
    if (safeIndex === currentIndex) return;

    images.forEach((img, i) => img.classList.toggle('active', i === safeIndex));

    if (swipeDirection) {
        const nextImg = images[safeIndex];
        const enterClass = swipeDirection === 'left'
            ? 'swipe-enter-from-right'
            : 'swipe-enter-from-left';
        nextImg.classList.add(enterClass);
        window.setTimeout(() => {
            nextImg.classList.remove(enterClass);
        }, 300);
    }
}

function setupMobileFeaturedCardSwipe() {
    if (!isMobileTouchViewport()) return;

    const sliders = document.querySelectorAll('#featured-products .product-card .image-slider');
    sliders.forEach((slider) => {
        if (slider.dataset.mobileSwipeBound === '1') return;
        slider.dataset.mobileSwipeBound = '1';

        const card = slider.closest('.product-card');
        if (!card) return;

        let startX = 0;
        let startY = 0;
        let moveX = 0;
        let moveY = 0;
        let trackSwipe = false;
        let hasHorizontalIntent = false;
        const SWIPE_THRESHOLD = 52;
        const HORIZONTAL_LOCK_THRESHOLD = 16;
        const VERTICAL_GUARD = 24;

        slider.addEventListener('touchstart', (event) => {
            if (!isMobileTouchViewport()) return;
            if (event.target.closest('.action-btn')) {
                trackSwipe = false;
                return;
            }

            const touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            moveX = 0;
            moveY = 0;
            hasHorizontalIntent = false;
            trackSwipe = true;
        }, { passive: true });

        slider.addEventListener('touchmove', (event) => {
            if (!trackSwipe || !isMobileTouchViewport()) return;
            const touch = event.touches[0];
            moveX = touch.clientX - startX;
            moveY = touch.clientY - startY;

            if (Math.abs(moveX) > Math.abs(moveY) && Math.abs(moveX) > HORIZONTAL_LOCK_THRESHOLD) {
                hasHorizontalIntent = true;
                event.preventDefault();
            }
        }, { passive: false });

        slider.addEventListener('touchend', (event) => {
            if (!trackSwipe || !isMobileTouchViewport()) return;
            trackSwipe = false;

            const touch = event.changedTouches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            if (!hasHorizontalIntent) return;
            if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
            if (Math.abs(deltaY) > VERTICAL_GUARD || Math.abs(deltaX) <= Math.abs(deltaY)) return;

            const images = card.querySelectorAll('.p-img');
            if (images.length < 2) return;

            let activeIndex = 0;
            images.forEach((img, i) => {
                if (img.classList.contains('active')) activeIndex = i;
            });

            const nextIndex = deltaX < 0
                ? (activeIndex + 1) % images.length
                : (activeIndex - 1 + images.length) % images.length;

            setCardImageByIndex(card, nextIndex, deltaX < 0 ? 'left' : 'right');

            // Swipe sonrası sentetik tıklama ile modal açılmasını engelle.
            card.dataset.ignoreTap = '1';
            window.setTimeout(() => {
                card.dataset.ignoreTap = '0';
            }, 350);

            event.preventDefault();
        }, { passive: false });

        slider.addEventListener('touchcancel', () => {
            trackSwipe = false;
            moveX = 0;
            moveY = 0;
            hasHorizontalIntent = false;
        }, { passive: true });
    });
}

/* ==========================================================================
   6. HOVER VE YARDIMCI ARAÇLAR
   ========================================================================== */
function handleProductHover(e, card) {
    const slider = card.querySelector('.image-slider');
    if (!slider) return;

    const rect = slider.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const images = card.querySelectorAll('.p-img');

    if (!images.length) return;

    // Fare pozisyonunu güvenli aralıkta tutarak boş kare oluşmasını engelle.
    const rawIndex = Math.floor(x / (rect.width / images.length));
    const index = Math.max(0, Math.min(images.length - 1, rawIndex));

    images.forEach((img, i) => img.classList.toggle('active', i === index));
}

function resetProductHover(card) {
    const images = card.querySelectorAll('.p-img');
    if (!images.length) return;
    images.forEach((img, i) => img.classList.toggle('active', i === 0));
}