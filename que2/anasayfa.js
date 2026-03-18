/* ==========================================================================
   1. GLOBAL DEĞİŞKENLER VE BAŞLATMA
   ========================================================================== */
let currentGalleryIndex = 0;
let currentGalleryImages = [];
const FEATURED_RETRY_DELAY_MS = 3500;
let featuredRetryTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log("📱 Que Jewelry Anasayfa Motoru Çalıştırıldı");
    loadFeaturedProducts();
    updateCartCount();
    initVideoScroll();
});

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

    if (featuredRetryTimer) {
        clearTimeout(featuredRetryTimer);
        featuredRetryTimer = null;
    }

    let allProducts = [];
    try {
        allProducts = await API.getProducts();
    } catch (error) {
        console.error('Öne çıkan ürünler yüklenemedi:', error);
        productGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #999;">Ürünler şu anda yüklenemiyor. Bağlantı yeniden deneniyor...</p>';
        featuredRetryTimer = setTimeout(() => loadFeaturedProducts(), FEATURED_RETRY_DELAY_MS);
        return;
    }
    
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
        
        return `
            <div class="product-card" 
                 onmousemove="handleProductHover(event, this)"
                  onmouseleave="resetProductHover(this)"
                 onclick="openDetailModal('${p._id}')">
                
                <div class="card-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); toggleWishlist('${p._id}')">
                        <i class="${isFav ? 'fas' : 'far'} fa-heart" style="${isFav ? 'color:#d4af37' : ''}"></i>
                    </button>
                    <button class="action-btn" onclick="event.stopPropagation(); addToCart('${p._id}')">
                        <i class="fas fa-shopping-bag"></i>
                    </button>
                </div>

                <div class="image-slider">
                    <img src="${images.card[0]}" class="p-img active">
                    <img src="${images.card[1]}" class="p-img">
                    <img src="${images.card[2]}" class="p-img">
                </div>

                <div class="product-info">
                    <h3>${productName}</h3>
                    <div class="price">${formatProductPrice(p.price)}</div>
                </div>
            </div>
        `;
    }).join('');
}

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
                    <img src="${currentGalleryImages[0]}" id="mainDetailImg" class="main-detail-img" alt="Urun Resmi">
                    
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
                        <i class="fas fa-heart"></i> ${isFav ? 'FAVORİLERDEN ÇIKAR' : 'FAVORİLERİME EKLE'}
                    </button>
                    <button onclick="addToCart('${p._id}')" class="action-btn-main btn-update">
                        <i class="fas fa-shopping-bag"></i> SEPETE EKLE
                    </button>
                </div>
            </div>
        </div>
    `;

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
    document.body.style.overflow = 'auto';
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