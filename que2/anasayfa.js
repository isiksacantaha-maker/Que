/* ==========================================================================
   1. GLOBAL DEĞİŞKENLER VE BAŞLATMA
   ========================================================================== */
let currentGalleryIndex = 0;
let currentGalleryImages = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log("📱 Que Jewelry Anasayfa Motoru Çalıştırıldı");
    loadFeaturedProducts();
    updateCartCount();
    initVideoScroll();
});

/* ==========================================================================
   2. VIDEO SCROLL KONTROLÜ (GÜNCELLENDİ)
   ========================================================================== */
function initVideoScroll() {
    const video = document.getElementById('scrollVideo');
    const videoWrapper = document.querySelector('.video-section-wrapper');

    if (!video || !videoWrapper) return;

    // Videonun metadata'sının yüklendiğinden emin oluyoruz
    video.addEventListener('loadedmetadata', () => {
        console.log("🎥 Video hazır, süre:", video.duration);
    });

    const updateVideo = () => {
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

        if (video.readyState > 0 && !isNaN(video.duration)) {
            video.currentTime = video.duration * progress;
        }
    };

    // Performans için requestAnimationFrame kullanıyoruz
    window.addEventListener('scroll', () => {
        window.requestAnimationFrame(updateVideo);
    });
}

/* ==========================================================================
   3. ÖNE ÇIKAN ÜRÜNLER (6 ÜRÜN RENDER)
   ========================================================================== */
async function loadFeaturedProducts() {
    const productGrid = document.getElementById('featured-products');
    if (!productGrid) return;

    let allProducts = [];
    allProducts = await API.getProducts();
    
    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    // Yeni eklenen ürünler önde olacak şekilde son 6 ürünü göster
    const featuredProducts = [...allProducts].reverse().slice(0, 6);

    if (featuredProducts.length === 0) {
        productGrid.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #999;">Koleksiyon henüz yüklenmedi.</p>';
        return;
    }

    productGrid.innerHTML = featuredProducts.map((p, index) => {
        const isFav = wishlist.includes(p._id);
        
        return `
            <div class="product-card" 
                 onmousemove="handleProductHover(event, this)"
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
                    <img src="${p.imgs[0]}" class="p-img active">
                    <img src="${p.imgs[1] || p.imgs[0]}" class="p-img">
                    <img src="${p.imgs[2] || p.imgs[0]}" class="p-img">
                </div>

                <div class="product-info">
                    <h3>${p.name}</h3>
                    <div class="price">${p.price.toLocaleString('tr-TR')} TL</div>
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
    if (index > -1) {
        wishlist.splice(index, 1);
    } else {
        wishlist.push(id);
    }
    sessionStorage.setItem('que_wishlist', JSON.stringify(wishlist));
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

    currentGalleryIndex = 0;
    currentGalleryImages = p.imgs;

    content.innerHTML = `
        <div class="gallery-container">
            <button class="gallery-close-btn" onclick="closeDetailModal()">
                <i class="fas fa-times"></i>
            </button>

            <div class="detail-gallery">
                <div class="main-img-wrapper">
                    <img src="${currentGalleryImages[0]}" id="mainDetailImg" class="main-detail-img" alt="Ürün Resmi">
                    
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
                <h2>${p.name}</h2>
                <p class="desc">${p.description || 'Que Jewelry kalitesiyle özenle tasarlanmıştır.'}</p>
                <div class="price-display">${p.price.toLocaleString('tr-TR')} TL</div>

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
    const rect = slider.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const index = Math.floor(x / (rect.width / 3));
    const images = card.querySelectorAll('.p-img');
    images.forEach((img, i) => img.classList.toggle('active', i === index));
}