// SAYFA YÜKLENDİĞİNDE ÇALIŞTIR
document.addEventListener('DOMContentLoaded', () => {
    if (typeof updateCartCount === "function") updateCartCount();
});


/* ==========================================================================
   GLOBAL TRAFİK POLİSİ (Hangi Sayfadan Olursa Olsun Çalışır)
   ========================================================================== */

function goProfile() {
    // Verileri alıyoruz (LocalStorage her zaman string tutar)
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const userRole = sessionStorage.getItem('userRole');

    // Senaryo 1: Giriş yapılmamışsa (null, undefined veya 'true' değilse)
    if (isLoggedIn !== 'true') {
        window.location.href = "profilim.html";
    } 
    // Senaryo 2: Admin girişi yapılmışsa
    else if (userRole === 'admin') {
        window.location.href = "adminekrani.html";
    } 
    // Senaryo 3: Standart kullanıcı girişi yapılmışsa
    else {
        window.location.href = "girissonrasıprofilim.html";
    }
}

/* ==========================================================================
   BEĞENDİKLERİM SAYFASI
   ========================================================================== */
async function renderWishlist() {
    const wishlistIds = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const wishlistList = document.getElementById('wishlist-list');
    const emptyMessage = document.getElementById('empty-message');

    if (!wishlistList) return;

    if (wishlistIds.length === 0) {
        wishlistList.style.display = 'none';
        if (emptyMessage) emptyMessage.style.display = 'block';
        return;
    }

    wishlistList.style.display = 'grid';
    if (emptyMessage) emptyMessage.style.display = 'none';

    wishlistList.innerHTML = wishlistIds.map(id => {
        const product = allProducts.find(p => p._id === id);
        if (!product) return '';

        return `
            <div class="product-card">
                <div class="img-box">
                    <img src="${product.imgs && product.imgs[0] ? product.imgs[0] : 'placeholder.jpg'}" alt="${product.name}">
                    <button class="remove-heart" onclick="removeFromWishlist('${product._id}')" title="Beğendiklerden Çıkar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="product-info">
                    <h4>${product.name}</h4>
                    <p style="color: #999; font-size: 12px; margin: 5px 0;">${product.category}</p>
                    <p class="price">${product.price.toLocaleString('tr-TR')} TL</p>
                    <p style="color: #666; font-size: 13px; margin-top: 8px;">${product.description}</p>
                    <button class="add-to-cart-small" onclick="addToCart('${product._id}')">
                        <i class="fas fa-shopping-bag"></i> SEPETE EKLE
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function removeFromWishlist(id) {
    let wishlist = JSON.parse(sessionStorage.getItem('que_wishlist')) || [];
    wishlist = wishlist.filter(wId => wId !== id);
    sessionStorage.setItem('que_wishlist', JSON.stringify(wishlist));
    renderWishlist();
    updateCartCount();
    showToast(`Beğendiklerinizden çıkarıldı`);
}

/* ==========================================================================
   SEPETİM SAYFASI
   ========================================================================== */
async function renderCart() {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const cartList = document.getElementById('cart-items-list');
    const emptyCart = document.getElementById('empty-cart');

    if (!cartList) return;

    if (cart.length === 0) {
        if (cartList) cartList.style.display = 'none';
        if (emptyCart) emptyCart.style.display = 'block';
        updateCartTotal();
        return;
    }

    if (cartList) cartList.style.display = 'block';
    if (emptyCart) emptyCart.style.display = 'none';

    cartList.innerHTML = cart.map((cartItem, idx) => {
        const product = allProducts.find(p => p._id === cartItem.id);
        if (!product) return '';

        return `
            <div class="cart-item">
    <img src="${product.imgs && product.imgs[0] ? product.imgs[0] : 'placeholder.jpg'}" class="item-img" alt="${product.name}">
    <div class="item-info">
        <h4>${product.name}</h4>
        <p>${product.category}</p>
        <p class="item-price">${product.price.toLocaleString('tr-TR')} TL</p>
        <div class="qty-control">
            <button class="qty-btn" onclick="decreaseQty(${idx})" title="Azalt">−</button>
            
            <span style="color: #000000; font-weight: 600; margin: 0 10px;">${cartItem.quantity || 1}</span>
            
            <button class="qty-btn" onclick="increaseQty(${idx})" title="Arttır">+</button>
            <span class="remove-item" onclick="removeFromCart(${idx})" title="Sil">
                <i class="fas fa-trash"></i> Sil
            </span>
        </div>
    </div>
</div>
        `;
    }).join('');

    updateCartTotal();
}

function increaseQty(index) {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    if (cart[index]) {
        cart[index].quantity = (cart[index].quantity || 1) + 1;
        sessionStorage.setItem('que_cart', JSON.stringify(cart));
        renderCart();
        updateCartCount();
    }
}

function decreaseQty(index) {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    if (cart[index]) {
        if (cart[index].quantity > 1) {
            cart[index].quantity--;
        } else {
            // Adet 1 ise ürünü sil
            const productName = cart[index].name;
            cart.splice(index, 1);
            showToast(`${productName} • Sepetten çıkarıldı`);
        }
        sessionStorage.setItem('que_cart', JSON.stringify(cart));
        renderCart();
        updateCartCount();
    }
}

function removeFromCart(index) {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    cart.splice(index, 1);
    sessionStorage.setItem('que_cart', JSON.stringify(cart));
    renderCart();
    updateCartCount();
}

async function updateCartTotal() {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    let allProducts = [];
    allProducts = await API.getProducts();
    
    let subtotal = 0;
    cart.forEach(cartItem => {
        const product = allProducts.find(p => p._id === cartItem.id);
        if (product) {
            subtotal += product.price * (cartItem.quantity || 1);
        }
    });

    const shipping = subtotal > 0 ? 0 : 0; // Ücretsiz kargo
    const total = subtotal + shipping;

    if (document.getElementById('subtotal')) 
        document.getElementById('subtotal').innerText = subtotal.toLocaleString('tr-TR') + ' TL';
    if (document.getElementById('shipping')) 
        document.getElementById('shipping').innerText = 'Ücretsiz';
    if (document.getElementById('grand-total')) 
        document.getElementById('grand-total').innerText = total.toLocaleString('tr-TR') + ' TL';
    if (document.getElementById('checkout-total'))
        document.getElementById('checkout-total').innerText = total.toLocaleString('tr-TR') + ' TL';
}

function proceedToPayment() {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    
    if (cart.length === 0) {
        alert('Sepetiniz boş. Lütfen ürün ekleyiniz.');
        return;
    }

    // Giriş kontrolü
    if (sessionStorage.getItem('isLoggedIn') !== 'true') {
        alert('Ödemeye devam etmek için lütfen giriş yapınız.');
        window.location.href = 'profilim.html';
        return;
    }

    // Ödeme sayfasına yönlendir
    window.location.href = 'odeme.html';
}

/* ==========================================================================
   ÖDEME İŞLEMLERİ
   ========================================================================== */
function saveShippingInfo() {
    const name = document.getElementById('ship-name')?.value || '';
    const surname = document.getElementById('ship-surname')?.value || '';
    const phone = document.getElementById('ship-phone')?.value || '';
    const address = document.getElementById('ship-address')?.value || '';
    const city = document.getElementById('ship-city')?.value || '';
    const zip = document.getElementById('ship-zip')?.value || '';

    if (!name || !surname || !phone || !address || !city) {
        alert('Lütfen zorunlu alanları doldurunuz!');
        return false;
    }

    const shippingInfo = { name, surname, phone, address, city, zip };
    sessionStorage.setItem('que_shipping_info', JSON.stringify(shippingInfo));
    return true;
}

function loadShippingInfo() {
    const info = JSON.parse(sessionStorage.getItem('que_shipping_info')) || {};
    if (document.getElementById('ship-name')) document.getElementById('ship-name').value = info.name || '';
    if (document.getElementById('ship-surname')) document.getElementById('ship-surname').value = info.surname || '';
    if (document.getElementById('ship-phone')) document.getElementById('ship-phone').value = info.phone || '';
    if (document.getElementById('ship-address')) document.getElementById('ship-address').value = info.address || '';
    if (document.getElementById('ship-city')) document.getElementById('ship-city').value = info.city || '';
    if (document.getElementById('ship-zip')) document.getElementById('ship-zip').value = info.zip || '';
}

function processPayment() {
    // 1. ADIM: Form ve Sepet Kontrolü (Her zaman geçerli)
    const name = document.getElementById('ship-name')?.value || '';
    const surname = document.getElementById('ship-surname')?.value || '';
    const phone = document.getElementById('ship-phone')?.value || '';
    const address = document.getElementById('ship-address')?.value || '';
    const city = document.getElementById('ship-city')?.value || '';
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];

    if (!name || !surname || !phone || !address || !city || cart.length === 0) {
        alert('Lütfen teslimat bilgilerini eksiksiz doldurunuz ve sepetinizin boş olmadığından emin olunuz.');
        return;
    }

    // 2. ADIM: Ödeme Yöntemini Belirle
    // Artık sadece havale var, direkt işlemi başlat.
    processOfflinePayment('Havale Bekleniyor');
}

// Havale ve Kapıda Ödeme için ortak fonksiyon
function processOfflinePayment(orderStatus, extraFee = 0) {
    createOrder(orderStatus, extraFee);
}

// Sipariş oluşturma işlemini merkezileştiren fonksiyon
async function createOrder(status, extraFee = 0) {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    let allProducts = [];
    allProducts = await API.getProducts();
    
    const shippingInfo = JSON.parse(sessionStorage.getItem('que_shipping_info')) || {};
    const userEmail = sessionStorage.getItem('currentUserEmail') || 'misafir'; // E-postayı al
    
    const orderId = '#QUE-' + Math.floor(100000 + Math.random() * 900000);
    const orderDate = new Date().toLocaleDateString('tr-TR');

    let subtotal = 0;
    let orderItems = [];

    cart.forEach(cartItem => {
        const p = allProducts.find(item => item._id === cartItem.id);
        if (p) {
            subtotal += p.price * (cartItem.quantity || 1);
            orderItems.push({
                name: p.name,
                quantity: cartItem.quantity || 1,
                price: p.price
            });
        }
    });

    const totalAmount = subtotal + extraFee;

    const newOrder = {
        id: orderId,
        date: orderDate,
        items: orderItems,
        total: totalAmount,
        status: status, // Dinamik durum
        userEmail: userEmail, // Siparişe kullanıcı e-postasını ekle
        shippingInfo: {
            name: `${shippingInfo.name} ${shippingInfo.surname}`,
            phone: shippingInfo.phone,
            address: shippingInfo.address,
            city: shippingInfo.city
        }
    };

    try {
        await API.createOrder(newOrder);
    } catch (e) {
        alert("Sipariş oluşturulamadı: " + e.message);
        return;
    }

    // Adres bilgilerini kaydet (zaten step 1'de kaydedildi ama garanti olsun)
    saveShippingInfo();

    // Sepeti temizle
    sessionStorage.removeItem('que_cart');

    // Yeni WhatsApp bilgilendirme modalını göster
    const whatsappNumberForLink = "905421031368";
    const whatsappNumberForDisplay = "+90 542 103 13 68";

    const whatsappModal = document.getElementById('whatsapp-modal');
    if (whatsappModal) {
        document.getElementById('whatsapp-link').href = `https://wa.me/${whatsappNumberForLink}?text=Merhaba, ${orderId} numaralı siparişim için ödeme dekontum ektedir.`;
        document.getElementById('whatsapp-number-text').innerText = whatsappNumberForDisplay;
        whatsappModal.style.display = 'flex';
    } else {
        // Modal yoksa eski usul devam et
        alert(`Siparişiniz Alındı! Lütfen dekontu ${whatsappNumberForDisplay} numarasına gönderin.`);
        window.location.href = 'girissonrasıprofilim.html?tab=orders';
    }
}

/* ==========================================================================
   SEPET SAYACI GÜNCELLEMESİ
   ========================================================================== */
function updateCartCount() {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    const count = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const badges = document.querySelectorAll('#cart-count, .cart-badge');
    badges.forEach(badge => {
        badge.textContent = count;
    });
}

/* ==========================================================================
   TOAST NOTIFICATION SİSTEMİ (PREMIUM)
   ========================================================================== */
function showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `position: fixed; top: 140px; right: 20px; z-index: 10000; display: flex; flex-direction: column-reverse; gap: 10px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;`;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'premium-toast';
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
            <div style="font-size: 18px; flex-shrink: 0;">✨</div>
            <div style="flex: 1; line-height: 1.4;">${message}</div>
        </div>
    `;
    container.appendChild(toast);

    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.innerHTML = `
            .premium-toast {
                background: rgba(255, 255, 255, 0.95);
                color: #1a1a1a;
                padding: 16px 22px;
                border-radius: 14px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.3px;
                animation: toastSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(197, 160, 89, 0.2);
                max-width: 340px;
                word-wrap: break-word;
            }
            
            @keyframes toastSlideIn {
                from {
                    opacity: 0;
                    transform: translateX(400px) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0) translateY(0);
                }
            }
            
            @keyframes toastSlideOut {
                from {
                    opacity: 1;
                    transform: translateX(0) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(400px) translateY(-20px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        setTimeout(() => { toast.remove(); }, 400);
    }, duration);
}

/* ==========================================================================
   GLOBAL SEPET FONKSİYONLARI
   ========================================================================== */
window.addToCart = async function(id) {
    let cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    let products = [];
    products = await API.getProducts();
    
    const product = products.find(p => p._id === id);
    
    if (!product) return;
    
    const existingItem = cart.find(item => item.id === id);
    let addedQty = 1;
    
    if (existingItem) {
        existingItem.quantity = (existingItem.quantity || 1) + 1;
        addedQty = existingItem.quantity;
    } else {
        cart.push({
            id: product._id,
            name: product.name,
            price: product.price,
            imgs: product.imgs,
            quantity: 1
        });
        addedQty = 1;
    }
    
    sessionStorage.setItem('que_cart', JSON.stringify(cart));
    updateCartCount();
    showToast(`${product.name} • Sepete eklendi (${addedQty} adet)`);
};
