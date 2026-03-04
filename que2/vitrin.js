/* ==========================================================================
   1. GLOBAL DEĞİŞKENLER VE BAŞLATMA
   ========================================================================== */
let isEditMode = false;
let draggedItemIndex = null;
let currentEditImages = [];
let currentAddImages = [];

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupDropZone();
    setupAddDropZone();
    updateCartCount();
});

function initApp() {
    console.log("VİTRİN BAŞLATILDI");
    renderProducts();
    checkAdminAccess();
    console.log("VİTRİN HAZIR");
}

function checkAdminAccess() {
    const isAdmin = sessionStorage.getItem('userRole') === 'admin';
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

    let allProducts = [];
    try {
        allProducts = await API.getProducts();
    } catch (error) {
        console.error("Ürünler yüklenemedi:", error);
        list.innerHTML = '<p style="grid-column: span 3; text-align: center; color: red;">Sunucu bağlantı hatası. Lütfen daha sonra tekrar deneyiniz.</p>';
        return;
    }

    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const isAdmin = sessionStorage.getItem('userRole') === 'admin';
    
    const displayData = filterData || allProducts;
    
    if (!Array.isArray(displayData) || displayData.length === 0) {
        list.innerHTML = '<p style="grid-column: span 3; text-align: center; color: #999;">Listelenecek ürün bulunamadı.</p>';
        return;
    }

    list.innerHTML = displayData.map((p, index) => {
        const isFav = wishlist.includes(p._id);
        
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
                    <img src="${p.imgs && p.imgs[0] ? p.imgs[0] : 'placeholder.jpg'}" class="p-img active">
                    <img src="${p.imgs && p.imgs[1] ? p.imgs[1] : (p.imgs && p.imgs[0] ? p.imgs[0] : 'placeholder.jpg')}" class="p-img">
                    <img src="${p.imgs && p.imgs[2] ? p.imgs[2] : (p.imgs && p.imgs[0] ? p.imgs[0] : 'placeholder.jpg')}" class="p-img">
                </div>

                <div class="product-info">
                    <h3>${p.name}</h3>
                    <div class="price">${p.price.toLocaleString('tr-TR')} TL</div>
                </div>
            </div>`;
    }).join('');
}

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
                    <img src="${p.imgs[0]}" id="mainDetailImg" class="main-detail-img" alt="Ürün Resmi">
                    
                    <button class="gallery-nav-btn gallery-prev" onclick="prevGalleryImage()">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="gallery-nav-btn gallery-next" onclick="nextGalleryImage()">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>

                <div class="thumb-strip">
                    ${p.imgs.map((img, idx) => `
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
                        <i class="fas fa-heart"></i> ${isFav ? 'BEĞENMEKTEN VAZGEÇ' : 'BEĞENDİM'}
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
    toggleWishlist(id);
    const content = document.getElementById('detail-content');
    const btn = content.querySelector('.btn-fav');
    const wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const isFav = wishlist.includes(id);
    
    if (btn) {
        btn.classList.toggle('active', isFav);
        btn.innerHTML = isFav 
            ? '<i class="fas fa-heart"></i> BEĞENMEKTEN VAZGEÇ'
            : '<i class="fas fa-heart"></i> BEĞENDİM';
    }
}

function closeDetailModal() {
    document.getElementById('detail-overlay').style.display = 'none';
    document.body.style.overflow = 'auto';
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
    if (!dropZone) return;

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
    if (!dropZone) return;

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

function handleAddFiles(files) {
    if (currentAddImages.length + files.length > 5) {
        showToast(`En fazla 5 fotoğraf ekleyebilirsiniz`);
        return;
    }
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentAddImages.push(e.target.result);
                updateAddImagePreviews();
            };
            reader.readAsDataURL(file);
        }
    });
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

function handleFiles(files) {
    if (currentEditImages.length + files.length > 5) {
        showToast(`En fazla 5 fotoğraf ekleyebilirsiniz`);
        return;
    }
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentEditImages.push(e.target.result);
                updateImagePreviews();
            };
            reader.readAsDataURL(file);
        }
    });
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

/* ==========================================================================
   6. VERİ İŞLEMLERİ (KAYDET & SİL)
   ========================================================================== */
async function saveProductUpdate() {
    const id = document.getElementById('edit-id').value;
    
    const updatedProduct = {
        _id: id,
        name: document.getElementById('edit-name').value,
        price: Number(document.getElementById('edit-price').value),
        category: document.getElementById('edit-category').value,
        description: document.getElementById('edit-desc').value,
        imgs: currentEditImages
    };

    try {
        await API.saveProduct(updatedProduct);
    } catch (error) {
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
    const price = Number(document.getElementById('add-price').value);
    const description = document.getElementById('add-desc').value.trim();
    
    if (!name || !category || !price || currentAddImages.length === 0) {
        showToast(`Lütfen tüm alanları doldurun ve resim yükleyin`);
        return;
    }
    
    const newProduct = {
        name: name,
        category: category,
        price: price,
        description: description,
        imgs: currentAddImages
    };
    
    // Buton durumunu güncelle (Loading)
    const btn = document.querySelector('#add-product-overlay .btn-update');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> EKLENİYOR...';

    let createdProduct = null;
    try {
        createdProduct = await API.saveProduct(newProduct);
    } catch (error) {
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
    // Bu fonksiyon artık global `script.js` dosyasından gelecek.
    // Ancak `renderProducts()` çağrısı burada önemli.
    // Bu yüzden global bir fonksiyonu çağırıp, ardından render işlemini tetiklemek daha doğru olur.
    // Şimdilik bu fonksiyonu `script.js`'teki `removeFromWishlist` mantığına benzer şekilde düzenleyebiliriz.
    let wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    const index = wishlist.indexOf(id);

    if (index > -1) {
        wishlist.splice(index, 1);
    } else {
        wishlist.push(id);
    }
    sessionStorage.setItem('que_wishlist', JSON.stringify(wishlist));
    renderProducts(); // Sayfayı güncellemek için render'ı tekrar çağır.
}

async function filterProducts() {
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const selectedCats = Array.from(document.querySelectorAll('.cat-filter:checked')).map(cb => cb.value);
    const sortVal = document.getElementById('sortPrice').value;

    let filtered = allProducts;
    if (selectedCats.length > 0) filtered = filtered.filter(p => selectedCats.includes(p.category));

    if (sortVal === "low") filtered.sort((a, b) => a.price - b.price);
    else if (sortVal === "high") filtered.sort((a, b) => b.price - a.price);

    renderProducts(filtered);
}

function handleProductHover(e, card) {
    const slider = card.querySelector('.image-slider');
    const rect = slider.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const index = Math.floor(x / (rect.width / 3));
    const images = card.querySelectorAll('.p-img');
    images.forEach((img, i) => img.classList.toggle('active', i === index));
}