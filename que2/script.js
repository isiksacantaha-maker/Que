// SAYFA YÜKLENDİĞİNDE ÇALIŞTIR
document.addEventListener('DOMContentLoaded', () => {
    if (typeof updateCartCount === "function") updateCartCount();
    initNetworkStatusBanner();

    // Ürün gösteren sayfalarda ilk render gecikmesini azaltmak için ön ısıtma.
    if (window.API && typeof API.getProducts === 'function') {
        setTimeout(() => {
            API.getProducts().catch(() => {});
        }, 0);
    }
});

function initNetworkStatusBanner() {
    if (document.getElementById('network-status-banner')) return;

    const style = document.createElement('style');
    style.id = 'network-status-banner-style';
    style.textContent = `
        #network-status-banner {
            position: fixed;
            top: 12px;
            left: 50%;
            transform: translateX(-50%) translateY(-120%);
            z-index: 12000;
            padding: 10px 18px;
            border-radius: 999px;
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: .2px;
            transition: transform .25s ease, opacity .25s ease;
            opacity: 0;
            pointer-events: none;
        }

        #network-status-banner.show {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }

        #network-status-banner.offline {
            background: rgba(176, 0, 32, 0.95);
        }

        #network-status-banner.online {
            background: rgba(22, 120, 64, 0.95);
        }
    `;

    const banner = document.createElement('div');
    banner.id = 'network-status-banner';

    const show = (message, type, autoHideMs = 0) => {
        banner.className = `${type} show`;
        banner.textContent = message;

        if (autoHideMs > 0) {
            window.setTimeout(() => {
                banner.classList.remove('show');
            }, autoHideMs);
        }
    };

    document.head.appendChild(style);
    document.body.appendChild(banner);

    window.addEventListener('offline', () => {
        show('İnternet bağlantısı kesildi. Ürünler yeniden denenecek.', 'offline');
    });

    window.addEventListener('online', () => {
        show('Bağlantı geri geldi. Ürünler güncelleniyor...', 'online', 2500);
    });
}


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
    else if (userRole === 'admin' || userRole === 'developer') {
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

    const shipping = subtotal >= 3000 ? 0 : (subtotal > 0 ? 100 : 0);
    const total = subtotal + shipping;

    if (document.getElementById('subtotal')) 
        document.getElementById('subtotal').innerText = subtotal.toLocaleString('tr-TR') + ' TL';
    if (document.getElementById('shipping')) 
        document.getElementById('shipping').innerText = shipping === 0 ? 'Ücretsiz' : shipping.toLocaleString('tr-TR') + ' TL';
    if (document.getElementById('grand-total')) 
        document.getElementById('grand-total').innerText = total.toLocaleString('tr-TR') + ' TL';
    if (document.getElementById('checkout-total'))
        document.getElementById('checkout-total').innerText = total.toLocaleString('tr-TR') + ' TL';
}

function ensureCheckoutModeModal() {
    if (document.getElementById('checkout-mode-modal')) return;

    const style = document.createElement('style');
    style.id = 'checkout-mode-style';
    style.textContent = `
        .checkout-mode-modal {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.48);
            backdrop-filter: blur(4px);
            z-index: 12000;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
        }

        .checkout-mode-modal.show {
            display: flex;
        }

        .checkout-mode-box {
            width: min(460px, 100%);
            background: #fff;
            border-radius: 18px;
            padding: 22px;
            box-sizing: border-box;
            box-shadow: 0 18px 44px rgba(0, 0, 0, 0.2);
            color: #111;
        }

        .checkout-mode-title {
            margin: 0 0 8px;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.2px;
        }

        .checkout-mode-desc {
            margin: 0 0 18px;
            color: #666;
            font-size: 13px;
            line-height: 1.55;
        }

        .checkout-mode-actions {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
        }

        .checkout-mode-btn {
            border: 1px solid #ddd;
            background: #fff;
            color: #111;
            border-radius: 12px;
            padding: 13px 14px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            text-align: left;
            transition: all 0.2s ease;
        }

        .checkout-mode-btn:hover {
            border-color: #111;
            transform: translateY(-1px);
        }

        .checkout-mode-btn.primary {
            background: #111;
            color: #fff;
            border-color: #111;
        }

        .checkout-mode-btn.primary:hover {
            background: #2a2a2a;
            border-color: #2a2a2a;
        }

        .checkout-mode-cancel {
            margin-top: 10px;
            background: none;
            border: none;
            color: #888;
            font-size: 12px;
            cursor: pointer;
            text-decoration: underline;
            padding: 0;
        }
    `;

    const modal = document.createElement('div');
    modal.id = 'checkout-mode-modal';
    modal.className = 'checkout-mode-modal';
    modal.innerHTML = `
        <div class="checkout-mode-box" id="checkout-mode-box">
            <h3 class="checkout-mode-title">Ödemeye Nasıl Devam Etmek İstersiniz?</h3>
            <p class="checkout-mode-desc">Üyelik girişi yaparak devam edebilir veya üye olmadan hızlıca siparişinizi tamamlayabilirsiniz.</p>
            <div class="checkout-mode-actions">
                <button type="button" class="checkout-mode-btn primary" data-checkout-choice="member">Üye Girişi Yap</button>
                <button type="button" class="checkout-mode-btn" data-checkout-choice="guest">Üye Girişi Olmadan Devam Et</button>
            </div>
            <button type="button" class="checkout-mode-cancel" data-checkout-choice="cancel">Şimdilik Vazgeç</button>
        </div>
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
}

function openCheckoutModeModal() {
    ensureCheckoutModeModal();

    const modal = document.getElementById('checkout-mode-modal');
    const box = document.getElementById('checkout-mode-box');
    if (!modal || !box) return Promise.resolve('cancel');

    return new Promise((resolve) => {
        const close = (choice) => {
            modal.classList.remove('show');
            modal.removeEventListener('click', handleOverlayClick);
            box.removeEventListener('click', stopPropagation);
            modal.querySelectorAll('[data-checkout-choice]').forEach(btn => {
                btn.removeEventListener('click', handleChoice);
            });
            resolve(choice);
        };

        const stopPropagation = (event) => event.stopPropagation();
        const handleOverlayClick = () => close('cancel');
        const handleChoice = (event) => {
            const choice = event.currentTarget.getAttribute('data-checkout-choice') || 'cancel';
            close(choice);
        };

        modal.querySelectorAll('[data-checkout-choice]').forEach(btn => {
            btn.addEventListener('click', handleChoice);
        });

        modal.addEventListener('click', handleOverlayClick);
        box.addEventListener('click', stopPropagation);
        modal.classList.add('show');
    });
}

async function proceedToPayment() {
    const cart = JSON.parse(sessionStorage.getItem('que_cart')) || [];
    
    if (cart.length === 0) {
        alert('Sepetiniz boş. Lütfen ürün ekleyiniz.');
        return;
    }

    // Giriş kontrolü (Misafir devam seçeneği ile)
    if (sessionStorage.getItem('isLoggedIn') !== 'true') {
        const checkoutChoice = await openCheckoutModeModal();

        if (checkoutChoice === 'member') {
            sessionStorage.setItem('checkout_mode', 'member');
            window.location.href = 'profilim.html';
            return;
        }

        if (checkoutChoice === 'guest') {
            sessionStorage.setItem('checkout_mode', 'guest');
            sessionStorage.removeItem('currentUserEmail');
            window.location.href = 'odeme.html';
            return;
        }

        return;
    }

    sessionStorage.setItem('checkout_mode', 'member');

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

    if (!name || !surname || !phone || !address || !city) {
        alert('Lütfen zorunlu alanları doldurunuz!');
        return false;
    }

    const shippingInfo = { name, surname, phone, address, city };
    sessionStorage.setItem('que_shipping_info', JSON.stringify(shippingInfo));
    sessionStorage.setItem('currentUser', `${name} ${surname}`.trim());
    sessionStorage.setItem('userPhone', phone);
    sessionStorage.setItem('userAddress', address);
    sessionStorage.setItem('userCity', city);
    return true;
}

function loadShippingInfo() {
    const info = JSON.parse(sessionStorage.getItem('que_shipping_info')) || {};
    const currentUser = (sessionStorage.getItem('currentUser') || '').trim();
    const userPhone = (sessionStorage.getItem('userPhone') || '').trim();
    const userAddress = (sessionStorage.getItem('userAddress') || '').trim();
    const userCity = (sessionStorage.getItem('userCity') || '').trim();

    const nameParts = currentUser ? currentUser.split(/\s+/) : [];
    const fallbackName = nameParts[0] || '';
    const fallbackSurname = nameParts.slice(1).join(' ');

    const mergedInfo = {
        name: info.name || fallbackName,
        surname: info.surname || fallbackSurname,
        phone: info.phone || userPhone,
        address: info.address || userAddress,
        city: info.city || userCity
    };

    if (mergedInfo.name || mergedInfo.surname || mergedInfo.phone || mergedInfo.address || mergedInfo.city) {
        sessionStorage.setItem('que_shipping_info', JSON.stringify(mergedInfo));
    }
    if (document.getElementById('ship-name')) document.getElementById('ship-name').value = mergedInfo.name || '';
    if (document.getElementById('ship-surname')) document.getElementById('ship-surname').value = mergedInfo.surname || '';
    if (document.getElementById('ship-phone')) document.getElementById('ship-phone').value = mergedInfo.phone || '';
    if (document.getElementById('ship-address')) document.getElementById('ship-address').value = mergedInfo.address || '';
    if (document.getElementById('ship-city')) document.getElementById('ship-city').value = mergedInfo.city || '';
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
                price: p.price,
                img: (Array.isArray(p.imgs) && p.imgs[0]) ? p.imgs[0] : 'placeholder.jpg'
            });
        }
    });

    const shippingFee = subtotal >= 3000 ? 0 : (subtotal > 0 ? 100 : 0);
    const totalAmount = subtotal + shippingFee + extraFee;

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
