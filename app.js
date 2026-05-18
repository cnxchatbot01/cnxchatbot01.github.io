// --- CONFIGURATION ---
const LIFF_ID = "2010118994-BlcBJ0G2";
const SUPABASE_URL = "https://hbyojbdhyzxfxarobjbg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieW9qYmRoeXp4Znhhcm9iamJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNzYzMTQsImV4cCI6MjA5NDY1MjMxNH0.5Z8cUp9uZtw12yJkPWsvbOcSOgdwN6jRJJI6la5sqgQ";

const { createClient } = supabase;

// Phase 6: Inject Context into REST Headers dynamically via custom fetch
const customHeaders = {};
const customFetch = (url, options) => {
    const headers = new Headers(options?.headers || {});
    for (const [key, value] of Object.entries(customHeaders)) {
        if (value) headers.set(key, value);
    }
    return fetch(url, { ...options, headers });
};

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: customFetch },
    auth: { persistSession: false } // ปิด warning GoTrueClient
});

// ==================== STATE ====================
let state = {
    user: null,
    tenantId: null,
    tenantConfig: null,
    cart: JSON.parse(localStorage.getItem('culinary_cart')) || [],
    view: 'home',
    categories: [],
    products: [],
    currentCategory: 0,
    orders: [],
    isAdmin: false,        // role === 'admin' ใน user_profiles
    isSuperAdmin: false,   // อยู่ใน super_admins table
    searchQuery: '',
    settings: {},
    adminStats: { totalOrders: 0, page: 1, pageSize: 5 },
    userAdminStats: { totalUsers: 0, page: 1, pageSize: 50 },
    userAdminSearch: ''
};

let searchDebounceTimer = null;
let isLoading = false;

// ==================== UTILS ====================
const TH_TZ = 'Asia/Bangkok';

/** Returns a Date interpreted in Thai timezone */
function toThaiDate(dateStr) {
    if (!dateStr) return null;
    // Parse the UTC timestamp and shift to Asia/Bangkok via Intl
    const d = new Date(dateStr);
    // Use Intl.DateTimeFormat to extract TH local parts
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TH_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const get = type => parseInt(parts.find(p => p.type === type)?.value || '0');
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function formatDate(dateStr) {
    if (!dateStr) return '–';
    const t = toThaiDate(dateStr);
    if (!t) return '–';
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return `${t.day} ${months[t.month - 1]} ${t.year + 543}`;
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const t = toThaiDate(dateStr);
    if (!t) return '';
    const hh = String(t.hour).padStart(2, '0');
    const mm = String(t.minute).padStart(2, '0');
    return `${hh}:${mm}`;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '–';
    return `${formatDate(dateStr)} ${formatTime(dateStr)} น.`;
}

function toast(msg, type = 'default') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { default: 'notifications', success: 'check_circle', error: 'error_circle', info: 'info' };
    const icon = icons[type] || icons.default;
    const t = document.createElement('div');
    t.className = `toast-item toast-${type}`;
    t.innerHTML = `
        <div class="toast-accent"></div>
        <div class="toast-body">
            <div class="toast-icon-wrap">
                <span class="material-symbols-outlined text-[20px] filled">${icon}</span>
            </div>
            <span class="toast-msg">${msg}</span>
        </div>
        <button class="toast-close" onclick="this.closest('.toast-item').remove()">
            <span class="material-symbols-outlined text-[16px]">close</span>
        </button>
        <div class="toast-progress"></div>
    `;
    container.appendChild(t);
    const DURATION = 3500;
    const dismiss = () => {
        if (!t.isConnected) return;
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 380);
    };
    const timer = setTimeout(dismiss, DURATION);
    t.addEventListener('mouseenter', () => {
        clearTimeout(timer);
        t.querySelector('.toast-progress').style.animationPlayState = 'paused';
    });
    t.addEventListener('mouseleave', () => setTimeout(dismiss, 1200));
}

// ==================== LOADING ====================
// Separate page-level spinner from init loader
function showSpinner(show) {
    let spinner = document.getElementById('page-spinner');
    if (show) {
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.id = 'page-spinner';
            spinner.style.cssText = 'position:fixed;top:1.5rem;right:1.5rem;z-index:8000;pointer-events:none;';
            spinner.innerHTML = '<div class="spinner"></div>';
            document.body.appendChild(spinner);
        }
    } else {
        spinner?.remove();
    }
}

// ==================== INIT ====================
async function initApp() {
    const progressBar = document.getElementById('progress-bar');
    const progressLabel = document.getElementById('progress-percentage');
    const loader = document.getElementById('global-loader');

    const setProgress = (pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressLabel) progressLabel.textContent = `${Math.round(pct)}%`;
    };

    try {
        setProgress(15);
        await liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true });
        await liff.ready;
        setProgress(35);

        if (!liff.isLoggedIn()) { liff.login(); return; }

        try {
            const friendship = await liff.getFriendship();
            if (!friendship.friendFlag && typeof liff.requestFriendship === 'function') {
                await liff.requestFriendship();
            }
        } catch (e) { /* ignore friendship errors */ }

        setProgress(55);
        const profile = await liff.getProfile();

        console.log('%c🔑 LINE User ID:', 'font-size:16px;color:#c9a470;font-weight:bold;', profile.userId);
        console.log('%c👤 Display Name:', 'color:#78586f;', profile.displayName);

        // ── Phase 5: Tenant Detection & Invite Flow ──
        const urlParams = new URLSearchParams(window.location.search);
        
        // Handle Invite Link
        const inviteToken = urlParams.get('invite');
        if (inviteToken) {
            try {
                const { data: newTenant, error: inviteErr } = await supabaseClient.rpc('consume_invite', {
                    p_token: inviteToken,
                    p_user_id: profile.userId,
                    p_display_name: profile.displayName,
                    p_picture_url: profile.pictureUrl || null
                });
                if (inviteErr) throw inviteErr;
                
                // Redirect to the new store with setup flag
                window.location.href = window.location.pathname + `?tenant=${newTenant.slug}&setup=true`;
                return;
            } catch (err) {
                console.error(err);
                toast('Invite Link ไม่ถูกต้อง หรือถูกใช้งานไปแล้ว', 'error');
                // Remove invalid invite from URL to prevent loop
                window.history.replaceState({}, '', window.location.pathname);
            }
        }

        const tenantSlug = urlParams.get('tenant'); // ไม่ใช้ localStorage fallback สำหรับ naked link
        if (tenantSlug) {
            const { data: tenant } = await supabaseClient.from('tenants')
                .select('*').eq('slug', tenantSlug).is('deleted_at', null).maybeSingle();
            if (tenant) {
                state.tenantId = tenant.id;
                state.tenantConfig = tenant;
                localStorage.setItem('culinary_tenant_slug', tenantSlug);
                if (loader) { loader.style.opacity='0'; setTimeout(()=>loader.style.display='none',400); }
                // แพ็คเกจหมดอายุ (expires_at ผ่านแล้ว แต่ status ยังเป็น active)
                if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
                    showStoreExpired(tenant.name || 'ร้านค้า', tenant.expires_at);
                    return;
                }
                // ระงับการใช้งาน (SA ปิดด้วยตนเอง)
                if (tenant.status !== 'active') {
                    showStoreClosed(tenant.name || 'ร้านค้า');
                    return;
                }
            }
        }

        if (!state.tenantId) {
            // ถ้าเข้าลิงก์เปล่า (ไม่มี ?tenant=) เช็คว่าเป็น Super Admin หรือไม่
            const { data: isSA } = await supabaseClient.from('super_admins').select('user_id').eq('user_id', profile.userId).maybeSingle();
            if (isSA) {
                state.isSuperAdmin = true;
                state.view = 'super_admin_portal';
                // ปล่อยให้ state.tenantId ว่างไว้สำหรับหน้า Super Admin
            } else {
                if (loader) { loader.style.opacity='0'; setTimeout(()=>loader.style.display='none',400); }
                showStoreClosed('กรุณาเข้าใช้งานผ่านลิงก์ของร้านค้าโดยตรงเท่านั้น');
                return;
            }
        }

        // Set Tenant Context for RLS (Call before other queries)
        await supabaseClient.rpc('set_tenant_context', { 
            p_tenant_id: state.tenantId || null, 
            p_user_id: profile.userId 
        });

        // ── Phase 6: Inject Context into REST Headers ──
        customHeaders['x-culinary-tenant-id'] = state.tenantId || '';
        customHeaders['x-culinary-user-id'] = profile.userId;

        // Register User into the specific tenant
        if (state.tenantId) {
            try {
                await supabaseClient.rpc('register_user', {
                    p_tenant_id:    state.tenantId,
                    p_user_id:      profile.userId,
                    p_display_name: profile.displayName,
                    p_picture_url:  profile.pictureUrl   || null,
                    p_status_msg:   profile.statusMessage || null
                });
            } catch (err) {
                console.warn('Register user skipped:', err.message);
            }
        }

        await syncUserProfile(profile);

        setProgress(75);
        await Promise.all([fetchCategories(), fetchProducts(), fetchSettings()]);

        setProgress(100);
        updateBranding();
        renderUI();

        // Deep Link
        const productId = new URL(window.location.href).searchParams.get('productId');
        if (productId) {
            setTimeout(() => {
                const el = document.getElementById(`note-${productId}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-primary');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 3000);
                }
            }, 600);
        }

        initRealtime();
        initScrollHeader();

        // Auto-open setup modal for new stores
        if (urlParams.get('setup') === 'true') {
            setTimeout(() => {
                state.view = 'admin_store_settings';
                renderUI();
                showStoreSetupModal();
                // Clean URL
                window.history.replaceState({}, '', window.location.pathname + `?tenant=${tenantSlug}`);
            }, 800);
        }

        setTimeout(() => {
            if (loader) {
                loader.style.opacity = '0';
                loader.style.pointerEvents = 'none';
                setTimeout(() => { if (loader) loader.style.display = 'none'; }, 500);
            }
        }, 400);

    } catch (error) {
        console.error('App init error:', error);
        if (loader) loader.style.display = 'none';
        toast('เริ่มต้นแอปไม่สำเร็จ', 'error');
    }
}

function initScrollHeader() {
    const header = document.getElementById('main-header');
    if (!header) return;
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });
}

// ==================== USER SYNC ====================
async function syncUserProfile(liffProfile) {
    try {
        // ─ Role check: super_admin > admin > user ─
        // อยู่ใน super_admins table? (โกลบล — ไม่ผูกกับ tenant)
        const { data: superRec } = await supabaseClient
            .from('super_admins')
            .select('user_id')
            .eq('user_id', liffProfile.userId)
            .maybeSingle();
        state.isSuperAdmin = !!superRec;

        if (!state.tenantId) {
            // Naked LIFF link for Super Admin - no tenant context
            state.user = {
                userId: liffProfile.userId,
                displayName: liffProfile.displayName,
                pictureUrl: liffProfile.pictureUrl || '',
                role: 'super_admin',
                points: 0,
                phone: '',
                birthday: '',
                pdpa_consent: true // skip consent in SA portal
            };
            state.isAdmin = false;
        } else {
            // ─ register_user RPC: set_config + upsert ใน DB call เดียว (SECURITY DEFINER) ─
            // แก้ 401 Unauthorized และ รองรับ role column
            const { data: registered, error: regErr } = await supabaseClient.rpc('register_user', {
                p_tenant_id:    state.tenantId,
                p_user_id:      liffProfile.userId,
                p_display_name: liffProfile.displayName,
                p_picture_url:  liffProfile.pictureUrl   || null,
                p_status_msg:   liffProfile.statusMessage || null
            });
            if (regErr) throw regErr;
            state.user = registered;
            
            // เป็น admin ถ้า role = 'admin' ใน user_profiles หรือเป็น super_admin
            state.isAdmin = state.isSuperAdmin || (registered?.role === 'admin');
        }

        if (!state.user) throw new Error('User profile unavailable after sync');

        // Update header UI
        const pfp = document.getElementById('user-pfp');
        const pts = document.getElementById('user-points');
        if (pfp) pfp.src = state.user.pictureUrl || state.user['pictureUrl'] || '';
        if (pts) pts.textContent = state.user.points ?? 0;

        const adminBtn = document.getElementById('admin-switch');
        if (state.isAdmin && adminBtn) {
            adminBtn.style.display = 'flex';
            adminBtn.classList.remove('hidden');
        }

        const saBtn = document.getElementById('super-admin-switch');
        if (state.isSuperAdmin && saBtn) {
            saBtn.style.display = 'flex';
            saBtn.classList.remove('hidden');
        }

        if (!state.user.pdpa_consent) {
            showPDPA(true);
        } else if ((!state.user.phone || !state.user.birthday) && state.view !== 'super_admin_portal') {
            showRegisterModal(true);
        }

    } catch (e) {
        console.error('Sync failed:', e);
        toast('ไม่สามารถโหลดข้อมูลผู้ใช้ได้', 'error');
    }
}

function updateBranding() {
    if (!state.tenantConfig) return;
    const name = state.tenantConfig.name || 'Culinary';
    const logoUrl = state.tenantConfig.logo_url;

    // Header Branding
    const title = document.querySelector('title');
    if (title) title.textContent = `${name} | พรีเมียม`;
    
    // Favicons & SEO Image
    const faviconUrl = logoUrl || 'https://cdn-icons-gif.flaticon.com/18497/18497932.gif';
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]').forEach(el => el.href = faviconUrl);
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) ogImage.content = faviconUrl;
    
    const storeName = document.getElementById('store-name');
    if (storeName) storeName.textContent = name;

    const logoImg = document.getElementById('app-logo');
    const logoIcon = document.getElementById('app-logo-icon');
    if (logoImg && logoIcon) {
        if (logoUrl) {
            logoImg.src = logoUrl;
            logoImg.classList.remove('hidden');
            logoIcon.classList.add('hidden');
        } else {
            logoImg.classList.add('hidden');
            logoIcon.classList.remove('hidden');
        }
    }

    // Loader Branding
    const loaderName = document.getElementById('loader-store-name');
    if (loaderName) loaderName.textContent = name;

    const loaderLogo = document.getElementById('loader-logo');
    const loaderIcon = document.getElementById('loader-icon');
    if (loaderLogo && loaderIcon) {
        if (logoUrl) {
            loaderLogo.src = logoUrl;
            loaderLogo.classList.remove('hidden');
            loaderIcon.classList.add('hidden');
        } else {
            loaderLogo.classList.add('hidden');
            loaderIcon.classList.remove('hidden');
        }
    }
}

// ==================== DATA FETCH ====================
async function fetchCategories() {
    const { data } = await supabaseClient.from('categories')
        .select('*')
        .eq('tenant_id', state.tenantId)
        .order('id');
    if (data) state.categories = data;
}

async function fetchProducts() {
    const { data } = await supabaseClient.from('products')
        .select('*')
        .eq('tenant_id', state.tenantId)
        .order('id');
    if (data) state.products = data;
}

async function fetchSettings() {
    const { data } = await supabaseClient.from('system_settings')
        .select('*')
        .eq('tenant_id', state.tenantId);
    if (data) {
        data.forEach(s => (state.settings[s.key] = s.value));
        const bankName = document.getElementById('bank-name');
        const bankAcc  = document.getElementById('bank-acc');
        if (bankName) bankName.textContent = state.settings.bank_name || 'Kasikorn Bank';
        if (bankAcc)  bankAcc.textContent  = state.settings.bank_account_no || '123-4-56789-0';
    }
}

// ==================== VIEW ROUTING ====================
function setView(viewName) {
    // runtime expiry guard — re-check ทุกครั้งที่เปลี่ยน view (ยกเว้น super admin portal)
    if (viewName !== 'super_admin_portal' && state.tenantConfig && isTenantExpired(state.tenantConfig)) {
        showStoreExpired(state.tenantConfig.name, state.tenantConfig.expires_at);
        return;
    }
    state.view = viewName;
    renderUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAdminView() {
    if (!state.isAdmin) return toast('เฉพาะแอดมินเท่านั้น!', 'error');
    state.view = state.view.startsWith('admin_') ? 'home' : 'admin_products';
    renderUI();
}

function toggleSuperAdminView() {
    if (!state.isSuperAdmin) return toast('เฉพาะซูเปอร์แอดมินเท่านั้น!', 'error');
    state.view = state.view === 'super_admin_portal' ? 'home' : 'super_admin_portal';
    renderUI();
}

// ==================== MAIN RENDER ====================
function renderUI() {
    const main     = document.getElementById('main-content');
    const sidebar  = document.getElementById('sidebar-nav');
    const desktopCart = document.getElementById('desktop-cart-panel');
    const bottomNav   = document.getElementById('bottom-nav');

    const userLinks = [
        { view: 'home',    icon: 'home',         label: 'เมนู' },
        { view: 'orders',  icon: 'receipt_long',  label: 'ออเดอร์' },
        { view: 'profile', icon: 'person',        label: 'โปรไฟล์' }
    ];
    const adminLinks = [
        { view: 'admin_products',       icon: 'inventory_2',      label: 'รายการเมนู' },
        { view: 'admin_categories',     icon: 'category',         label: 'หมวดหมู่' },
        { view: 'admin_orders',         icon: 'monitoring',       label: 'คำสั่งซื้อ' },
        { view: 'admin_users',          icon: 'group_add',        label: 'สมาชิก' },
        { view: 'admin_store_settings', icon: 'storefront',       label: 'ร้านค้า' },
        { view: 'admin_telegram',       icon: 'send',             label: 'Telegram' },
        { view: 'admin_plan',           icon: 'workspace_premium',label: 'แผนบริการ' },
        { view: 'admin_settings',       icon: 'settings_suggest', label: 'ชำระเงิน' }
    ];

    const isAdmin = state.view.startsWith('admin_');
    const activeLinks = isAdmin ? adminLinks : userLinks;

    // ---- Sidebar ----
    sidebar.innerHTML = activeLinks.map(link => `
        <button onclick="setView('${link.view}')" class="sidebar-link w-full text-left ${state.view === link.view ? 'active' : ''}">
            <span class="material-symbols-outlined ${state.view === link.view ? 'filled' : ''}">${link.icon}</span>
            <span>${link.label}</span>
        </button>
    `).join('');

    // ---- Desktop cart visibility ----
    if (desktopCart) {
        if (isAdmin) {
            desktopCart.classList.add('lg:hidden');
            main.style.marginRight = '';
        } else {
            desktopCart.classList.remove('lg:hidden');
            main.style.marginRight = '';
        }
    }

    // ---- Bottom Nav ----
    const cartCount = state.cart.reduce((a, i) => a + i.quantity, 0);

    if (bottomNav) {
        if (isAdmin) {
            const adminMobLinks = [...adminLinks, { view: 'home', icon: 'logout', label: 'ออก' }];
            bottomNav.className = 'fixed bottom-0 left-0 w-full flex justify-start items-center px-4 pb-3 pt-3 glass rounded-t-3xl z-50 lg:hidden shadow-2xl border-t border-outline-variant/10 overflow-x-auto hide-scrollbar gap-1';
            bottomNav.innerHTML = adminMobLinks.map(link => `
                <button onclick="${link.view === 'home' ? 'toggleAdminView()' : `setView('${link.view}')`}"
                    class="nav-link min-w-[64px] ${state.view === link.view ? 'active' : ''}">
                    <span class="material-symbols-outlined text-[22px] ${state.view === link.view ? 'filled' : ''}">${link.icon}</span>
                    <span class="font-bold whitespace-nowrap text-[9px]">${link.label}</span>
                </button>
            `).join('');
        } else {
            bottomNav.className = 'fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-3 pt-3 glass rounded-t-3xl z-50 lg:hidden shadow-2xl border-t border-outline-variant/10';
            bottomNav.innerHTML = `
                <button onclick="setView('home')" class="nav-link ${state.view === 'home' ? 'active' : ''}">
                    <span class="material-symbols-outlined ${state.view === 'home' ? 'filled' : ''}">home</span>
                    <span class="font-semibold text-[10px] mt-0.5">เมนู</span>
                </button>
                <button onclick="setView('orders')" class="nav-link ${state.view === 'orders' ? 'active' : ''}">
                    <span class="material-symbols-outlined ${state.view === 'orders' ? 'filled' : ''}">receipt_long</span>
                    <span class="font-semibold text-[10px] mt-0.5">ออเดอร์</span>
                </button>
                <button onclick="toggleMobileCart()" class="relative interactive" style="margin-top:-20px">
                    <div class="cart-fab">
                        <span class="material-symbols-outlined text-[26px]" style="color:var(--on-primary)">shopping_basket</span>
                    </div>
                    ${cartCount > 0 ? `<span class="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-error text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-surface">${cartCount}</span>` : ''}
                </button>
                <button onclick="setView('profile')" class="nav-link ${state.view === 'profile' ? 'active' : ''}">
                    <span class="material-symbols-outlined ${state.view === 'profile' ? 'filled' : ''}">person</span>
                    <span class="font-semibold text-[10px] mt-0.5">โปรไฟล์</span>
                </button>
                <button onclick="shareStore()" class="nav-link">
                    <span class="material-symbols-outlined" style="color:#18c461;">share</span>
                    <span class="font-semibold text-[10px] mt-0.5" style="color:#18c461;">แชร์</span>
                </button>
            `;
        }
    }

    document.getElementById('cart-count-desktop').textContent = cartCount;
    renderCart();

    main.innerHTML = '';
    main.className = `flex-1 lg:ml-64 px-4 sm:px-6 lg:px-8 py-6 w-full animate-fade-in ${!isAdmin ? 'lg:mr-[28rem]' : ''}`;

    switch (state.view) {
        case 'home':                  renderHome(main);              break;
        case 'orders':                renderOrders(main);            break;
        case 'profile':               renderProfile(main);           break;
        case 'admin_products':        renderAdminProducts(main);     break;
        case 'admin_categories':      renderAdminCategories(main);   break;
        case 'admin_orders':          renderAdminOrders(main);       break;
        case 'admin_settings':        renderAdminSettings(main);     break;
        case 'admin_users':           renderAdminUsers(main);        break;
        case 'admin_store_settings':  renderAdminStoreSettings(main);break;
        case 'admin_telegram':        renderAdminTelegram(main);     break;
        case 'admin_plan':            renderAdminPlan(main);         break;
        case 'super_admin_portal':    renderSuperAdminPortal(main);  break;
    }
}

// ==================== HOME VIEW ====================
function renderHome(container) {
    const filtered = state.products.filter(p => {
        const matchCat = !state.currentCategory || Number(p.category_id) === Number(state.currentCategory);
        const matchQ   = p.name.toLowerCase().includes(state.searchQuery.toLowerCase());
        return matchCat && matchQ && p.is_available;
    });

    container.innerHTML = `
        <div class="pb-28">
            <!-- Hero -->
            <div class="mb-10 relative">
                <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4 border" style="background:linear-gradient(135deg,rgba(230,199,156,.28) 0%,rgba(205,223,160,.20) 100%);color:var(--plum-dark);border-color:rgba(230,199,156,.50);">
                    <span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background:var(--mint)"></span>
                    เปิดให้บริการ · พรีเมียม
                </div>
                <h2 class="text-4xl sm:text-5xl lg:text-6xl font-black mb-3 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">
                    เลือกสรร<br><span class="text-gradient">เมนูอร่อย</span> ที่คัดมาเพื่อคุณ
                </h2>
                <p class="font-medium text-sm max-w-md" style="color:var(--plum);">
                    เลือกวัตถุดิบพรีเมียม ปรุงอย่างพิถีพิถัน — ส่งตรงถึงมือคุณ
                </p>
            </div>

            <!-- Category Filter -->
            <div class="flex gap-2.5 mb-8 overflow-x-auto hide-scrollbar pb-2 -mx-4 px-4">
                <button onclick="changeCategory(0)"
                    class="px-5 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap border shrink-0 ${Number(state.currentCategory) === 0
                        ? 'border-transparent' : 'border-transparent'}"
                    style="${Number(state.currentCategory) === 0
                        ? 'background:linear-gradient(160deg,#f0d5b0 0%,var(--sand) 45%,var(--sand-dark) 100%);color:var(--on-primary);box-shadow:var(--shadow-3d);border-color:rgba(201,164,112,.50);'
                        : 'background:linear-gradient(160deg,rgba(255,255,255,.90) 0%,rgba(244,239,233,.85) 100%);color:var(--plum);box-shadow:var(--shadow-sm);border-color:rgba(255,255,255,.80);'}">
                    ทั้งหมด
                </button>
                ${state.categories.map(c => `
                    <button onclick="changeCategory(${c.id})"
                        class="px-5 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap flex items-center gap-2 border shrink-0"
                        style="${Number(state.currentCategory) === Number(c.id)
                            ? 'background:linear-gradient(160deg,#f0d5b0 0%,var(--sand) 45%,var(--sand-dark) 100%);color:var(--on-primary);box-shadow:var(--shadow-3d);border-color:rgba(201,164,112,.50);'
                            : 'background:linear-gradient(160deg,rgba(255,255,255,.90) 0%,rgba(244,239,233,.85) 100%);color:var(--plum);box-shadow:var(--shadow-sm);border-color:rgba(255,255,255,.80);'}">
                        ${c.icon?.startsWith('http')
                            ? `<img src="${c.icon}" class="w-4 h-4 object-cover rounded">`
                            : c.icon?.length <= 2
                                ? `<span class="text-base">${c.icon}</span>`
                                : `<span class="material-symbols-outlined text-[18px] ${Number(state.currentCategory) === Number(c.id) ? 'filled' : ''}">${c.icon || 'restaurant'}</span>`}
                        ${c.name}
                    </button>
                `).join('')}
            </div>

            <!-- Products Grid -->
            <div class="responsive-grid stagger-children">
                ${filtered.length ? filtered.map(p => renderProductCard(p)).join('') : `
                    <div class="col-span-full py-32 text-center opacity-40">
                        <div class="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5" style="background:var(--surface-container);">
                            <span class="material-symbols-outlined text-5xl">search_off</span>
                        </div>
                        <p class="font-bold" style="color:var(--plum);">ไม่พบรายการ</p>
                    </div>`}
            </div>
        </div>
    `;
}

function renderProductCard(p) {
    return `
        <div class="card p-0 flex flex-col overflow-hidden" style="padding-top:0">
            <!-- Image -->
            <div class="relative h-52 overflow-hidden rounded-t-xl bg-surface-container-low">
                <img src="${p.image_url}" alt="${p.name}" loading="lazy"
                    class="w-full h-full object-cover transition-transform duration-700 hover:scale-110">
                <div class="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"></div>

                <!-- Share btn -->
                <button onclick="shareProduct(${p.id})"
                    class="absolute top-3 right-3 w-9 h-9 rounded-xl bg-white/90 backdrop-blur-sm flex items-center justify-center text-on-surface hover:bg-primary hover:text-white transition-all shadow-md border border-white/50">
                    <span class="material-symbols-outlined text-[18px]">share</span>
                </button>

                <!-- Category pill -->
                ${p.category_id ? `
                    <div class="absolute bottom-3 left-3">
                        <span class="pill bg-black/50 text-white backdrop-blur-sm" style="letter-spacing:0.04em;">
                            ${state.categories.find(c => c.id === p.category_id)?.name || ''}
                        </span>
                    </div>` : ''}
            </div>

            <!-- Content -->
            <div class="flex flex-col flex-1 p-5">
                <h4 class="font-black text-lg mb-1 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;color:var(--plum-dark);">${p.name}</h4>
                <p class="text-sm font-medium line-clamp-2 mb-4 leading-relaxed flex-1" style="color:var(--plum);">${p.description || ''}</p>

                <!-- Special request input -->
                <div class="flex items-center rounded-xl px-3.5 py-2.5 gap-2 mb-4 transition-all" style="background:linear-gradient(180deg,rgba(237,230,222,.82) 0%,rgba(244,239,233,.90) 100%);border:1px solid rgba(184,168,152,.45);">
                    <span class="material-symbols-outlined text-[16px]" style="color:var(--plum-light);">edit_note</span>
                    <input type="text" id="note-${p.id}" placeholder="คำขอพิเศษ..." class="bg-transparent border-none outline-none text-sm flex-1 font-medium p-0" style="box-shadow:none;padding:0;border-radius:0;color:var(--on-surface);">
                </div>

                <!-- ราคา + Add -->
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider mb-0.5" style="color:var(--plum-light);">ราคา</p>
                        <p class="text-2xl font-black" style="font-family:'LINE Seed Sans TH',sans-serif;color:var(--plum-dark);">${p.price.toFixed(0)} บ.</p>
                    </div>
                    <button onclick="addToCart(${p.id}, document.getElementById('note-${p.id}').value)"
                        class="btn-primary w-12 h-12 rounded-2xl flex items-center justify-center p-0" style="min-width:3rem;">
                        <span class="material-symbols-outlined text-[22px]">add</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ==================== CART ====================
function renderCart() {
    const container = document.getElementById('cart-items-container');
    const summary   = document.getElementById('cart-summary');
    if (!container) return;

    if (state.cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 opacity-40">
                <div class="w-20 h-20 rounded-2xl flex items-center justify-center mb-4" style="background:var(--surface-container);">
                    <span class="material-symbols-outlined text-4xl">shopping_basket</span>
                </div>
                <p class="font-bold text-sm" style="color:var(--plum);">Your basket is empty</p>
            </div>`;
        if (summary) summary.classList.add('hidden');
        return;
    }

    if (summary) summary.classList.remove('hidden');
    container.innerHTML = state.cart.map(item => `
        <div class="cart-item mb-3">
            <div class="flex gap-3">
                <div class="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-surface-container">
                    <img src="${item.image_url}" class="w-full h-full object-cover">
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start gap-2 mb-1">
                        <p class="font-bold text-sm leading-snug text-on-surface truncate">${item.name}</p>
                        <span class="font-black text-sm text-primary shrink-0">${(item.price * item.quantity).toFixed(0)} บ.</span>
                    </div>
                    ${item.note ? `<p class="text-[10px] text-primary font-bold bg-primary/8 px-2 py-0.5 rounded-full mb-2 w-fit">🗒 ${item.note}</p>` : ''}
                    <div class="flex items-center gap-2">
                        <div class="flex items-center bg-surface-container rounded-lg overflow-hidden">
                            <button onclick="updateQuantity(${item.id}, -1, '${(item.note || '').replace(/'/g, "\\'")}')"
                                class="w-8 h-8 flex items-center justify-center hover:bg-surface-container-high transition-colors text-on-surface-variant">
                                <span class="material-symbols-outlined text-[16px]">remove</span>
                            </button>
                            <span class="font-black text-sm w-7 text-center">${item.quantity}</span>
                            <button onclick="updateQuantity(${item.id}, 1, '${(item.note || '').replace(/'/g, "\\'")}')"
                                class="w-8 h-8 flex items-center justify-center hover:bg-surface-container-high transition-colors text-on-surface-variant">
                                <span class="material-symbols-outlined text-[16px]">add</span>
                            </button>
                        </div>
                        <button onclick="removeFromCart(${item.id}, '${(item.note || '').replace(/'/g, "\\'")}')"
                            class="w-8 h-8 flex items-center justify-center text-on-surface-variant/40 hover:text-error transition-colors rounded-lg hover:bg-error/8">
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    const total = state.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    document.getElementById('cart-total-desktop').textContent = `${total.toLocaleString('th-TH',{minimumFractionDigits:2})} บ.`;
}

function addToCart(pid, note = '') {
    const p = state.products.find(x => x.id === pid);
    if (!p) return;
    const key = `${pid}_${note}`;
    const existing = state.cart.find(x => `${x.id}_${x.note || ''}` === key);
    if (existing) existing.quantity++;
    else state.cart.push({ ...p, quantity: 1, note });
    saveCart();
    renderUI();
    toast(`เพิ่ม ${p.name} แล้ว`, 'success');
}

function updateQuantity(pid, delta, note = '') {
    const key = `${pid}_${note}`;
    const item = state.cart.find(x => `${x.id}_${x.note || ''}` === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) removeFromCart(pid, note);
    else { saveCart(); renderUI(); }
}

function removeFromCart(id, note = '') {
    state.cart = state.cart.filter(x => `${x.id}_${x.note || ''}` !== `${id}_${note}`);
    saveCart();
    renderUI();
}

function saveCart() {
    localStorage.setItem('culinary_cart', JSON.stringify(state.cart));
}

// ==================== MOBILE CART ====================
function toggleMobileCart() {
    const cart = document.getElementById('desktop-cart-panel');
    if (!cart) return;
    const isOpen = cart.classList.contains('mobile-cart-open');
    if (isOpen) {
        // ปิด: คืน hidden กลับ (แสดงใน lg เท่านั้นผ่าน lg:flex)
        cart.classList.remove('mobile-cart-open');
        cart.classList.add('hidden');
        cart.style.cssText = '';
    } else {
        // เปิด: ลบ hidden แล้ว set fullscreen สำหรับ mobile
        cart.classList.remove('hidden');
        cart.classList.add('mobile-cart-open');
        cart.style.cssText = [
            'display:flex',
            'flex-direction:column',
            'position:fixed',
            'inset:0',
            'width:100%',
            'height:100dvh',
            'z-index:1000',
            'padding:4.5rem 1.25rem 6rem',
            'background:linear-gradient(180deg,rgba(244,239,233,.98) 0%,rgba(237,230,222,.97) 100%)',
            'backdrop-filter:blur(32px)',
        ].join(';');
    }
}

// ==================== ORDER SUBMIT ====================
async function submitOrder() {
    if (state.cart.length === 0) return toast('ตะกร้ายังว่างอยู่!', 'error');
    if (isTenantExpired(state.tenantConfig)) {
        showStoreExpired(state.tenantConfig?.name, state.tenantConfig?.expires_at);
        return;
    }
    if (state._orderSubmitting) return; // guard — ป้องกันกดซ้ำ
    state._orderSubmitting = true;

    const btn   = document.getElementById('submit-order-btn');
    const icon  = document.getElementById('submit-order-icon');
    const label = document.getElementById('submit-order-label');

    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.8';
        btn.style.cursor  = 'not-allowed';
        if (icon)  icon.textContent  = 'hourglass_top';
        if (label) label.textContent = 'กำลังส่งคำสั่ง...';
        // pulse animation
        btn.style.animation = 'pulse 1s ease-in-out infinite';
    }

    try {
        const total = state.cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const { data: order, error } = await supabaseClient.from('orders').insert({
            tenant_id: state.tenantId,
            user_id: state.user.userId,
            total_amount: total,
            status: 'pending',
            bank_account: `${state.settings.bank_name} ${state.settings.bank_account_no}`,
            promptpay_qr: state.settings.promptpay_id
        }).select().single();
        if (error) throw error;

        const items = state.cart.map(i => ({
            order_id: order.id,
            tenant_id: state.tenantId,
            product_id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            note: i.note || null
        }));
        const { error: itemErr } = await supabaseClient.from('order_items').insert(items);
        if (itemErr) throw itemErr;

        // success state ก่อน reset
        if (btn) {
            btn.style.animation = '';
            btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
            if (icon)  icon.textContent  = 'check_circle';
            if (label) label.textContent = 'ส่งคำสั่งแล้ว!';
        }

        state.cart = [];
        saveCart();
        toast('สั่งอาหารสำเร็จแล้ว!', 'success');
        logAudit('order_placed', { order_id: order.id, total, items_count: items.length });
        notifyTelegram(`🔔 *New Order!*\nOrder: #${order.id}\nCustomer: ${state.user.displayName}\nTotal: ${total.toFixed(2)} บ.`);

        await new Promise(r => setTimeout(r, 600)); // ให้ user เห็น success state สั้น ๆ
        showPaymentModal(order);
        setView('orders');
    } catch (e) {
        console.error(e);
        toast('สั่งอาหารไม่สำเร็จ กรุณาลองใหม่', 'error');
        // reset ปุ่มกลับเป็นปกติเมื่อ error
        if (btn) {
            btn.disabled = false;
            btn.style.opacity   = '';
            btn.style.cursor    = '';
            btn.style.animation = '';
            btn.style.background = '';
            if (icon)  icon.textContent  = 'check_circle';
            if (label) label.textContent = 'สั่งอาหารเลย';
        }
    } finally {
        state._orderSubmitting = false;
    }
}

// ==================== ORDERS VIEW ====================
async function renderOrders(container) {
    showSpinner(true);
    const { data: orders } = await supabaseClient.from('orders')
        .select('*, order_items(*)')
        .eq('user_id', state.user.userId)
        .order('created_at', { ascending: false });
    showSpinner(false);

    const statusConfig = {
        pending:   { label: 'รอชำระเงิน', cls: 'status-pending',   icon: 'hourglass_top' },
        paid:      { label: 'ชำระแล้ว',    cls: 'status-paid',      icon: 'check_circle' },
        completed: { label: 'สำเร็จ', cls: 'status-completed', icon: 'done_all' },
        cancelled: { label: 'ยกเลิก',       cls: 'status-cancelled', icon: 'cancel' }
    };

    container.innerHTML = `
        <div class="pb-28">
            <h2 class="text-4xl font-black mb-8 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">ประวัติคำสั่งซื้อ</h2>
            <div class="space-y-5 stagger-children">
                ${orders?.length ? orders.map(ord => {
                    const cfg = statusConfig[ord.status] || statusConfig.cancelled;
                    return `
                    <div class="card p-0 overflow-hidden">
                        <!-- Order Header -->
                        <div class="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                    <span class="material-symbols-outlined text-primary text-[20px] filled">receipt_long</span>
                                </div>
                                <div>
                                    <p class="font-black text-base" style="font-family:'LINE Seed Sans TH',sans-serif;">ออเดอร์ #${ord.id}</p>
                                    <p class="text-xs text-on-surface-variant">${formatDate(ord.created_at)} · ${formatTime(ord.created_at)}</p>
                                </div>
                            </div>
                            <span class="status-badge ${cfg.cls}">
                                <span class="dot bg-current"></span>
                                ${cfg.label}
                            </span>
                        </div>
                        <!-- Items -->
                        <div class="px-6 py-4 space-y-3">
                            ${ord.order_items.map(item => `
                                <div class="flex justify-between items-center">
                                    <div class="flex items-center gap-3">
                                        <span class="w-7 h-7 bg-surface-container rounded-lg flex items-center justify-center text-xs font-black text-on-surface-variant shrink-0">${item.quantity}×</span>
                                        <div>
                                            <p class="font-semibold text-sm">${item.name}</p>
                                            ${item.note ? `<p class="text-[10px] text-primary font-bold">🗒 ${item.note}</p>` : ''}
                                        </div>
                                    </div>
                                    <span class="font-bold text-sm">${(item.price * item.quantity).toFixed(0)} บ.</span>
                                </div>
                            `).join('')}
                        </div>
                        <!-- Footer -->
                        <div class="flex items-center justify-between px-6 py-4 bg-surface-container-low/50 border-t border-outline-variant/10">
                            <div>
                                <p class="text-xs text-on-surface-variant font-medium">ยอดรวม</p>
                                <p class="text-xl font-black text-primary" style="font-family:'LINE Seed Sans TH',sans-serif;">${parseFloat(ord.total_amount).toFixed(2)} บ.</p>
                            </div>
                            ${ord.status === 'pending' ? `
                                <button onclick='showPaymentModal(${JSON.stringify(ord)})' class="btn-primary py-2.5 px-5 text-sm">
                                    <span class="material-symbols-outlined text-[18px]">qr_code_2</span>
                                    ชำระเงิน
                                </button>` : ''}
                        </div>
                    </div>`;
                }).join('') : `
                    <div class="py-32 text-center opacity-40">
                        <div class="w-20 h-20 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <span class="material-symbols-outlined text-5xl">receipt_long</span>
                        </div>
                        <p class="font-bold text-on-surface-variant">ยังไม่มีคำสั่งซื้อ</p>
                    </div>`}
            </div>
        </div>
    `;
}

// ==================== PROFILE VIEW ====================
function renderProfile(container) {
    container.innerHTML = `
        <div class="pb-28 max-w-lg mx-auto">
            <h2 class="text-4xl font-black mb-6" style="font-family:'LINE Seed Sans TH',sans-serif;">โปรไฟล์</h2>
            <div class="card overflow-hidden p-0">
                <!-- Banner -->
                <div class="h-24 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent relative bg-dot-pattern"></div>

                <div class="px-6 pb-6 -mt-12">
                    <!-- Avatar -->
                    <div class="relative w-24 h-24 mb-4">
                        <div class="w-24 h-24 rounded-2xl overflow-hidden border-4 border-white shadow-xl">
                            <img src="${state.user.pictureUrl}" class="w-full h-full object-cover">
                        </div>
                        <span class="absolute -bottom-1 -right-1 w-6 h-6 bg-secondary rounded-full border-2 border-white shadow"></span>
                    </div>

                    <h3 class="text-2xl font-black mb-0.5" style="font-family:'LINE Seed Sans TH',sans-serif;">${state.user.displayName}</h3>
                    <p class="text-xs text-on-surface-variant font-medium mb-5">${state.user.email || 'ไม่มีอีเมล'}</p>

                    <!-- Stats -->
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-primary/8 rounded-2xl p-4 text-center border border-primary/12">
                            <div class="flex items-center justify-center gap-1.5 mb-1">
                                <span class="material-symbols-outlined text-primary text-[18px] filled">stars</span>
                                <span class="text-2xl font-black text-primary" style="font-family:'LINE Seed Sans TH',sans-serif;">${state.user.points ?? 0}</span>
                            </div>
                            <p class="text-[10px] font-bold text-primary/70 uppercase tracking-wider">Points</p>
                        </div>
                        <div class="bg-surface-container-low rounded-2xl p-4 text-center border border-outline-variant/20">
                            <div class="flex items-center justify-center gap-1.5 mb-1">
                                <span class="material-symbols-outlined text-on-surface-variant text-[18px]">receipt_long</span>
                                <span class="text-2xl font-black" style="font-family:'LINE Seed Sans TH',sans-serif;">${state.orders?.length || 0}</span>
                            </div>
                            <p class="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">ออเดอร์</p>
                        </div>
                    </div>

                    <!-- Info -->
                    ${state.user.phone ? `
                    <div class="flex items-center gap-3 px-4 py-3 bg-surface-container-low rounded-xl mb-2 border border-outline-variant/15">
                        <span class="material-symbols-outlined text-on-surface-variant text-[18px]">phone_iphone</span>
                        <span class="text-sm font-medium">${state.user.phone}</span>
                    </div>` : ''}
                    ${state.user.birthday ? `
                    <div class="flex items-center gap-3 px-4 py-3 bg-surface-container-low rounded-xl mb-5 border border-outline-variant/15">
                        <span class="material-symbols-outlined text-on-surface-variant text-[18px]">cake</span>
                        <span class="text-sm font-medium">${formatDate(state.user.birthday)}</span>
                    </div>` : '<div class="mb-5"></div>'}

                    <!-- Actions -->
                    <div class="space-y-3">
                        <button onclick="shareStore()"
                            class="w-full flex items-center justify-center gap-2 py-3 px-5 bg-gradient-to-r from-[#18c461] to-[#12a14e] text-white shadow-lg shadow-[#18c461]/30 rounded-xl font-bold text-sm hover:opacity-90 active:scale-98 transition-all">
                            <span class="material-symbols-outlined text-[18px]">share</span>
                            แนะนำร้านให้เพื่อน (ส่งเข้าแชท)
                        </button>
                        <button onclick="showRegisterModal(false)"
                            class="w-full flex items-center justify-center gap-2 py-3 px-5 bg-primary/10 text-primary rounded-xl font-bold text-sm hover:bg-primary/15 active:scale-98 transition-all border border-primary/12">
                            <span class="material-symbols-outlined text-[18px]">edit_square</span>
                            แก้ไขโปรไฟล์
                        </button>
                        <button onclick="liff.logout(); window.location.reload();"
                            class="w-full flex items-center justify-center gap-2 py-3 px-5 bg-error/8 text-error rounded-xl font-bold text-sm hover:bg-error/14 active:scale-98 transition-all border border-error/12">
                            <span class="material-symbols-outlined text-[18px]">logout</span>
                            ออกจากระบบ
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== ADMIN: PRODUCTS ====================
async function renderAdminProducts(container) {
    showSpinner(true);
    const { data: prods } = await supabaseClient.from('products').select('*, categories(name)').order('id');
    if (prods) state.products = prods;
    showSpinner(false);

    container.innerHTML = `
        <div class="pb-28">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h2 class="text-4xl font-black leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">Menu Management</h2>
                    <p class="text-sm text-on-surface-variant mt-1">${prods?.length || 0} รายการทั้งหมด</p>
                </div>
                <button onclick="showProductEditModal()" class="btn-primary py-3 px-6 text-sm shrink-0">
                    <span class="material-symbols-outlined text-[20px]">add</span> Add Item
                </button>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 stagger-children">
                ${(prods || []).map(p => `
                    <div class="card p-4 flex gap-4 group">
                        <div class="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-surface-container">
                            <img src="${p.image_url}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1.5">
                                <span class="pill bg-primary/10 text-primary border border-primary/15">${p.categories?.name || '–'}</span>
                                <span class="pill ${p.is_available ? 'bg-secondary/10 text-secondary border border-secondary/15' : 'bg-error/10 text-error border border-error/15'}">${p.is_available ? 'Available' : 'Sold Out'}</span>
                            </div>
                            <h4 class="font-black text-base truncate mb-0.5" style="font-family:'LINE Seed Sans TH',sans-serif;">${p.name}</h4>
                            <p class="text-xs text-on-surface-variant line-clamp-1 mb-3">${p.description || ''}</p>
                            <div class="flex items-center justify-between">
                                <span class="font-black text-lg text-primary" style="font-family:'LINE Seed Sans TH',sans-serif;">${parseFloat(p.price).toFixed(0)} บ.</span>
                                <div class="flex gap-2">
                                    <button onclick="editProduct(${p.id})" class="icon-btn icon-btn-primary">
                                        <span class="material-symbols-outlined text-[18px]">edit</span>
                                    </button>
                                    <button onclick="deleteProduct(${p.id})" class="icon-btn icon-btn-danger">
                                        <span class="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ==================== ADMIN: CATEGORIES ====================
async function renderAdminCategories(container) {
    const { data: cats } = await supabaseClient.from('categories').select('*').order('id');
    if (cats) state.categories = cats;
    container.innerHTML = `
        <div class="pb-28">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h2 class="text-4xl font-black leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">หมวดหมู่</h2>
                    <p class="text-sm text-on-surface-variant mt-1">${cats?.length || 0} หมวดหมู่</p>
                </div>
                <button onclick="addCategory()" class="btn-primary py-3 px-6 text-sm shrink-0">
                    <span class="material-symbols-outlined text-[20px]">add</span> Add Category
                </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
                ${(cats || []).map(c => `
                    <div class="card p-4 flex items-center gap-4 group">
                        <div class="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shrink-0 group-hover:bg-primary group-hover:text-white transition-all">
                            ${c.icon?.startsWith('http') ? `<img src="${c.icon}" class="w-full h-full object-cover rounded-2xl">` : c.icon?.length <= 2 ? `<span class="text-2xl">${c.icon}</span>` : `<span class="material-symbols-outlined text-2xl filled">${c.icon || 'category'}</span>`}
                        </div>
                        <div class="flex-1 min-w-0">
                            <h4 class="font-black truncate" style="font-family:'LINE Seed Sans TH',sans-serif;">${c.name}</h4>
                            <p class="text-xs text-on-surface-variant/60 uppercase tracking-wider font-bold">Category</p>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button onclick="editCategory(${c.id})" class="icon-btn icon-btn-primary">
                                <span class="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button onclick="deleteCategory(${c.id})" class="icon-btn icon-btn-danger">
                                <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ==================== ADMIN: ORDERS ====================
async function renderAdminOrders(container) {
    showSpinner(true);
    const page  = state.adminStats.page;
    const size  = state.adminStats.pageSize;
    const start = (page - 1) * size;
    const end   = start + size - 1;

    const { data: ords, count } = await supabaseClient.from('orders')
        .select('*, user_profiles(displayName, pictureUrl), order_items(*)', { count: 'exact' })
        .eq('tenant_id', state.tenantId)
        .order('created_at', { ascending: false }).range(start, end);

    state.adminStats.totalOrders = count || 0;
    const totalPages = Math.ceil(count / size) || 1;
    showSpinner(false);

    const statusConfig = {
        pending:   { label: 'รอชำระเงิน', cls: 'status-pending' },
        paid:      { label: 'ชำระแล้ว',    cls: 'status-paid' },
        completed: { label: 'สำเร็จ', cls: 'status-completed' },
        cancelled: { label: 'ยกเลิก',       cls: 'status-cancelled' }
    };

    container.innerHTML = `
        <div class="pb-28">
            <h2 class="text-4xl font-black mb-8" style="font-family:'LINE Seed Sans TH',sans-serif;">คำสั่งซื้อ</h2>
            <div class="space-y-5 stagger-children">
                ${ords?.length ? ords.map(ord => {
                    const cfg = statusConfig[ord.status] || statusConfig.cancelled;
                    return `
                    <div class="card p-0 overflow-hidden group">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-outline-variant/10">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl overflow-hidden border border-outline-variant/20 shrink-0">
                                    <img src="${ord.user_profiles?.pictureUrl || ''}" class="w-full h-full object-cover">
                                </div>
                                <div>
                                    <p class="font-black text-sm" style="font-family:'LINE Seed Sans TH',sans-serif;">${ord.user_profiles?.displayName || 'ลูกค้า'}</p>
                                    <p class="text-xs text-on-surface-variant">#${ord.id} · ${formatDate(ord.created_at)}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 flex-wrap">
                                <span class="status-badge ${cfg.cls}">
                                    <span class="dot bg-current"></span>${cfg.label}
                                </span>
                                <select onchange="updateOrderStatus(${ord.id}, this.value)"
                                    class="text-xs font-bold rounded-xl py-2 px-3 border border-outline-variant/30 bg-surface-container-low appearance-none cursor-pointer focus:ring-2 focus:ring-primary/20">
                                    <option value="pending" $(ord.status === 'pending' ? 'selected' : '')>⏳ รอชำระเงิน</option>
                                    <option value="paid"      ${ord.status === 'paid'      ? 'selected' : ''}>💰 ชำระแล้ว</option>
                                    <option value="completed" ${ord.status === 'completed' ? 'selected' : ''}>✅ สำเร็จ</option>
                                    <option value="cancelled" ${ord.status === 'cancelled' ? 'selected' : ''}>❌ ยกเลิก</option>
                                </select>
                            </div>
                        </div>
                        <div class="px-5 py-4 space-y-2.5">
                            ${ord.order_items.map(i => `
                                <div class="flex justify-between items-center">
                                    <div class="flex items-center gap-2.5">
                                        <span class="w-7 h-7 bg-surface-container rounded-lg flex items-center justify-center text-[11px] font-black text-on-surface-variant">${i.quantity}×</span>
                                        <div>
                                            <p class="font-semibold text-sm">${i.name}</p>
                                            ${i.note ? `<p class="text-[10px] text-primary font-bold">📝 ${i.note}</p>` : ''}
                                        </div>
                                    </div>
                                    <span class="font-bold text-sm">${(i.price * i.quantity).toFixed(0)} บ.</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="flex items-center justify-between px-5 py-4 bg-surface-container-low/50 border-t border-outline-variant/10">
                            <div>
                                <p class="text-xs text-on-surface-variant">ยอดรวม</p>
                                <p class="text-xl font-black text-primary" style="font-family:'LINE Seed Sans TH',sans-serif;">${parseFloat(ord.total_amount).toFixed(2)} บ.</p>
                            </div>
                            <button onclick='showPaymentModal(${JSON.stringify(ord)})' class="btn-primary py-2.5 px-5 text-sm">
                                <span class="material-symbols-outlined text-[18px]">qr_code_2</span> QR Code
                            </button>
                        </div>
                    </div>`;
                }).join('') : `
                    <div class="py-32 text-center opacity-40">
                        <div class="w-20 h-20 bg-surface-container rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <span class="material-symbols-outlined text-5xl">monitoring</span>
                        </div>
                        <p class="font-bold text-on-surface-variant">ยังไม่มีคำสั่งซื้อ</p>
                    </div>`}
            </div>

            ${totalPages > 1 ? `
            <div class="flex justify-center items-center gap-4 mt-10">
                <button onclick="changePage(${page - 1})" class="icon-btn icon-btn-ghost w-11 h-11 ${page === 1 ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <span class="text-sm font-bold text-on-surface-variant">หน้า ${page} จาก ${totalPages}</span>
                <button onclick="changePage(${page + 1})" class="icon-btn icon-btn-ghost w-11 h-11 ${page >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
            </div>` : ''}
        </div>
    `;
}

// ==================== ADMIN: SETTINGS ====================
function renderAdminSettings(container) {
    container.innerHTML = `
        <div class="pb-28 max-w-lg">
            <h2 class="text-4xl font-black mb-6" style="font-family:'LINE Seed Sans TH',sans-serif;">ตั้งค่าการชำระเงิน</h2>
            <div class="card p-6">
                <div class="space-y-5 mb-6">
                    <div class="flex items-center gap-4 p-4 bg-surface-container-low rounded-2xl border border-outline-variant/15">
                        <div class="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0">
                            <span class="material-symbols-outlined text-[22px] filled">qr_code_2</span>
                        </div>
                        <div>
                            <p class="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-0.5">เบอร์พร้อมเพย์</p>
                            <p class="font-black text-xl" style="font-family:'LINE Seed Sans TH',sans-serif;">${state.settings.promptpay_id || '–'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-4 p-4 bg-surface-container-low rounded-2xl border border-outline-variant/15">
                        <div class="w-12 h-12 bg-surface-container rounded-xl flex items-center justify-center text-on-surface-variant shrink-0">
                            <span class="material-symbols-outlined text-[22px]">account_balance</span>
                        </div>
                        <div>
                            <p class="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-0.5">บัญชีธนาคาร</p>
                            <p class="font-bold text-base">${state.settings.bank_name || '–'}</p>
                            <p class="font-black text-primary" style="font-family:'LINE Seed Sans TH',sans-serif;">${state.settings.bank_account_no || '–'}</p>
                        </div>
                    </div>
                </div>
                <button onclick="showSettingsModal()" class="btn-primary w-full py-4">
                    <span class="material-symbols-outlined text-[20px]">edit</span>
                    แก้ไขการตั้งค่า
                </button>
            </div>
            <p class="text-xs text-on-surface-variant/40 mt-4 flex items-center gap-1.5">
                <span class="material-symbols-outlined text-[14px]">info</span>
                การเปลี่ยนแปลงจะมีผลกับ QR Code ที่ลูกค้าเห็นทันที
            </p>
        </div>
    `;
}

// ==================== ADMIN: USERS ====================
async function renderAdminUsers(container) {
    showSpinner(true);
    const search = (state.userAdminSearch || '').toLowerCase();
    const page   = state.userAdminStats.page;
    const size   = state.userAdminStats.pageSize;
    const start  = (page - 1) * size;
    const end    = start + size - 1;

    let query = supabaseClient.from('user_profiles').select('*', { count: 'exact' }).eq('tenant_id', state.tenantId);
    if (search) query = query.or(`displayName.ilike.%${search}%,phone.ilike.%${search}%,userId.ilike.%${search}%`);
    const { data: users, count } = await query.order('created_at', { ascending: false }).range(start, end);
    state.userAdminStats.totalUsers = count || 0;
    const totalPages = Math.ceil(count / size) || 1;
    showSpinner(false);

    container.innerHTML = `
        <div class="pb-28">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <h2 class="text-4xl font-black leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">สมาชิก</h2>
                    <p class="text-sm text-on-surface-variant mt-1">${count || 0} สมาชิกทั้งหมด</p>
                </div>
                <div class="relative w-full sm:w-72">
                    <input type="text" placeholder="Search name, phone, ID..."
                        class="w-full py-3 pl-10 pr-4 rounded-xl"
                        value="${state.userAdminSearch || ''}"
                        onkeyup="searchAdminUser(this.value)">
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">search</span>
                </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 stagger-children">
                ${(users || []).map(u => `
                    <div class="card p-4 flex gap-4 group">
                        <div class="relative shrink-0">
                            <div class="w-16 h-16 rounded-2xl overflow-hidden border-2 ${u.role === 'admin' ? 'border-primary' : 'border-outline-variant/20'}">
                                <img src="${u.pictureUrl || ''}" class="w-full h-full object-cover">
                            </div>
                            ${u.role === 'admin' ? `<span class="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center border-2 border-white">
                                <span class="material-symbols-outlined text-white text-[10px]">star</span>
                            </span>` : ''}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <h4 class="font-black text-base truncate" style="font-family:'LINE Seed Sans TH',sans-serif;">${u.displayName}</h4>
                                ${u.role === 'admin' ? '<span class="pill bg-primary text-white" style="font-size:0.6rem">Admin</span>' : ''}
                            </div>
                            <div class="flex items-center gap-3 mb-3 flex-wrap">
                                <span class="text-xs text-on-surface-variant">${u.phone || 'No phone'}</span>
                                <span class="flex items-center gap-1 text-xs font-bold text-primary">
                                    <span class="material-symbols-outlined text-[13px] filled">stars</span>${u.points || 0} pts
                                </span>
                            </div>
                            <div class="flex items-center gap-3 flex-wrap">
                                <!-- Points input -->
                                <div class="flex items-center gap-1.5 bg-surface-container-low rounded-xl p-1 border border-outline-variant/15">
                                    <input type="number" value="0" placeholder="±คะแนน" id="pts-${u.userId}"
                                        class="w-16 bg-transparent border-none text-right text-sm font-bold p-0 py-1 px-2 focus:ring-0" style="border-radius:0;box-shadow:none;">
                                    <button onclick="addAdminPoints('${u.userId}')"
                                        class="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-sm shadow-primary/30">
                                        <span class="material-symbols-outlined text-[16px]">add</span>
                                    </button>
                                </div>
                                <!-- Admin toggle -->
                                <div class="flex items-center gap-2">
                                    <span class="text-xs font-medium text-on-surface-variant">แอดมิน</span>
                                    <label class="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" ${u.role === 'admin' ? 'checked' : ''} class="sr-only peer"
                                            onchange="toggleUserRole('${u.userId}', this.checked)">
                                        <div class="w-10 h-6 bg-surface-container rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary shadow-inner"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>

            ${totalPages > 1 ? `
            <div class="flex justify-center items-center gap-4 mt-10">
                <button onclick="changeUserPage(${page - 1})" class="icon-btn icon-btn-ghost w-11 h-11 ${page === 1 ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <span class="text-sm font-bold text-on-surface-variant">หน้า ${page} จาก ${totalPages}</span>
                <button onclick="changeUserPage(${page + 1})" class="icon-btn icon-btn-ghost w-11 h-11 ${page >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
            </div>` : ''}
        </div>
    `;
}

function changeUserPage(p) {
    state.userAdminStats.page = p;
    renderAdminUsers(document.getElementById('main-content'));
}

function searchAdminUser(val) {
    state.userAdminSearch = val;
    state.userAdminStats.page = 1;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => renderAdminUsers(document.getElementById('main-content')), 450);
}

async function toggleUserRole(userId, isAdmin) {
    showSpinner(true);
    const newRole = isAdmin ? 'admin' : 'user';
    const { error } = await supabaseClient.from('user_profiles').update({ role: newRole }).eq('userId', userId).eq('tenant_id', state.tenantId);
    if (!error) {
        toast(`อัปเดตสิทธิ์เป็น ${newRole} แล้ว`, 'success');
        if (userId === state.user.userId) { state.isAdmin = isAdmin; state.user.role = newRole; }
    }
    showSpinner(false);
    renderAdminUsers(document.getElementById('main-content'));
}

async function addAdminPoints(userId) {
    const val = parseInt(document.getElementById(`pts-${userId}`)?.value) || 0;
    if (val === 0) return toast('Enter points amount', 'error');
    showSpinner(true);
    try {
        const { data: user, error: selErr } = await supabaseClient.from('user_profiles')
            .select('points')
            .eq('userId', userId)
            .eq('tenant_id', state.tenantId)
            .single();
        if (selErr) throw selErr;
        
        const newPoints = (user?.points || 0) + val;
        const { error } = await supabaseClient.from('user_profiles')
            .update({ points: newPoints })
            .eq('userId', userId)
            .eq('tenant_id', state.tenantId);
            
        if (error) throw error;
        toast(`อัปเดตคะแนน: ${newPoints} คะแนน`, 'success');
        logAudit('points_added', { target_user: userId, added: val, new_total: newPoints });
        if (state.user?.userId === userId) { 
            state.user.points = newPoints; 
            const headerPts = document.getElementById('user-points');
            if (headerPts) headerPts.textContent = newPoints;
        }
    } catch (e) {
        console.error(e);
        toast('เกิดข้อผิดพลาด', 'error');
    } finally {
        showSpinner(false);
        renderAdminUsers(document.getElementById('main-content'));
    }
}

// ==================== CRUD ====================
function showProductEditModal(id = null) {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = id ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่';
    document.getElementById('edit-type').value = 'product';
    document.getElementById('edit-id').value = id || '';

    const catSelect = document.getElementById('edit-category');
    catSelect.innerHTML = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.remove('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.remove('hidden');
    document.getElementById('label-name').textContent = 'ชื่อรายการ';
    document.getElementById('label-image').textContent = 'URL รูปภาพ';

    if (id) {
        const p = state.products.find(x => x.id == id);
        if (p) {
            document.getElementById('edit-name').value = p.name;
            document.getElementById('edit-price').value = p.price;
            document.getElementById('edit-image').value = p.image_url;
            document.getElementById('edit-desc').value = p.description || '';
            catSelect.value = p.category_id;
            document.getElementById('edit-available').checked = p.is_available;
        }
    } else {
        document.getElementById('edit-form').reset();
        document.getElementById('edit-available').checked = true;
    }

    openModal(modal);
}

function showSettingsModal() {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = 'ตั้งค่าการชำระเงิน';
    document.getElementById('edit-type').value = 'settings';

    document.getElementById('standard-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.remove('hidden');
    document.getElementById('image-field').classList.add('hidden');
    document.getElementById('desc-field').classList.add('hidden');

    document.getElementById('setting-promptpay').value = state.settings.promptpay_id || '';
    document.getElementById('setting-bank').value = state.settings.bank_name || '';
    document.getElementById('setting-acc').value = state.settings.bank_account_no || '';

    openModal(modal);
}

function addCategory() {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = 'เพิ่มหมวดหมู่';
    document.getElementById('edit-type').value = 'category';
    document.getElementById('edit-id').value = '';
    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.add('hidden');
    document.getElementById('label-name').textContent = 'ชื่อหมวดหมู่';
    document.getElementById('label-image').textContent = 'URL รูปภาพ หรือชื่อไอคอน';
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-image').value = 'category';
    openModal(modal);
}

function editCategory(cid) {
    const cat = state.categories.find(c => c.id == cid);
    if (!cat) return;
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').textContent = 'แก้ไขหมวดหมู่';
    document.getElementById('edit-type').value = 'category';
    document.getElementById('edit-id').value = cid;
    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.add('hidden');
    document.getElementById('label-name').textContent = 'ชื่อหมวดหมู่';
    document.getElementById('label-image').textContent = 'URL รูปภาพ หรือชื่อไอคอน';
    document.getElementById('edit-name').value = cat.name;
    document.getElementById('edit-image').value = cat.icon || 'category';
    openModal(modal);
}

async function deleteCategory(cid) {
    const ok = await showConfirm({ title: 'ลบหมวดหมู่นี้?', message: 'สินค้าในหมวดนี้จะถูกตัดการเชื่อมโยง', confirmText: 'ลบ', danger: true });
    if (!ok) return;
    showSpinner(true);
    const { error } = await supabaseClient.from('categories').delete().eq('id', cid);
    if (!error) { toast('ลบหมวดหมู่แล้ว', 'success'); logAudit('category_deleted', { category_id: cid }); await fetchCategories(); renderAdminCategories(document.getElementById('main-content')); }
    showSpinner(false);
}

async function handleEditSubmit(e) {
    e.preventDefault();
    showSpinner(true);
    const type = document.getElementById('edit-type').value;
    try {
        if (type === 'settings') {
            const pp   = document.getElementById('setting-promptpay').value;
            const bank = document.getElementById('setting-bank').value;
            const acc  = document.getElementById('setting-acc').value;
            const updates = [
                { tenant_id: state.tenantId, key: 'promptpay_id',   value: pp,   description: 'PromptPay No.หลัก' },
                { tenant_id: state.tenantId, key: 'bank_name',      value: bank, description: 'ชื่อธนาคาร' },
                { tenant_id: state.tenantId, key: 'bank_account_no',value: acc,  description: 'เลขBank Account' }
            ];
            for (const item of updates) await supabaseClient.from('system_settings').upsert(item);
            if (state.settings.promptpay_id !== pp) {
                await notifyTelegram(`⚠️ เปลี่ยน PromptPay: ${state.settings.promptpay_id} → ${pp} (โดย ${state.user.displayName})`);
            }
            await fetchSettings();
            closeEditModal();
            renderUI();
            logAudit('settings_saved', { keys: updates.map(u => u.key) });
            toast('บันทึกการตั้งค่าแล้ว', 'success');

        } else {
            const id  = document.getElementById('edit-id').value;
            const name = document.getElementById('edit-name').value.trim();
            if (!name) { toast('กรุณากรอกชื่อ', 'error'); return; }
            const imgVal = document.getElementById('edit-image').value.trim();

            if (type === 'category') {
                const payload = { tenant_id: state.tenantId, name, icon: imgVal };
                if (id) await supabaseClient.from('categories').update(payload).eq('id', id).eq('tenant_id', state.tenantId);
                else    await supabaseClient.from('categories').insert(payload);
                logAudit(id ? 'category_updated' : 'category_created', { name, id: id || null });
                const { data: cats } = await supabaseClient.from('categories').select('*').eq('tenant_id', state.tenantId).order('id');
                state.categories = cats;
                renderAdminCategories(document.getElementById('main-content'));

            } else if (type === 'product') {
                const priceVal = parseFloat(document.getElementById('edit-price').value);
                if (isNaN(priceVal)) { toast('กรุณากรอกราคาให้ถูกต้อง', 'error'); return; }

                const payload = {
                    tenant_id: state.tenantId,
                    name,
                    image_url: imgVal,
                    price: priceVal,
                    description: document.getElementById('edit-desc').value.trim(),
                    category_id: parseInt(document.getElementById('edit-category').value),
                    is_available: document.getElementById('edit-available').checked
                };
                if (id) await supabaseClient.from('products').update(payload).eq('id', id).eq('tenant_id', state.tenantId);
                else    await supabaseClient.from('products').insert(payload);
                logAudit(id ? 'product_updated' : 'product_created', { name, price: priceVal, id: id || null });
                await fetchProducts();
                renderAdminProducts(document.getElementById('main-content'));
            }
            closeEditModal();
            toast('บันทึกสำเร็จแล้ว', 'success');
        }
    } catch (err) {
        console.error('Save error:', err);
        toast(`Error: ${err.message || 'กรุณาตรวจสอบข้อมูล'}`, 'error');
    } finally {
        showSpinner(false);
    }
}

function openModal(modal) {
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('opacity-100'));
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

async function editProduct(id) { showProductEditModal(id); }

async function deleteProduct(id) {
    const ok = await showConfirm({ title: 'ลบรายการนี้?', message: 'ไม่สามารถกู้คืนได้หลังจากลบ', confirmText: 'ลบ', danger: true });
    if (!ok) return;
    showSpinner(true);
    const prod = state.products.find(p => p.id == id);
    await supabaseClient.from('products').delete().eq('id', id);
    logAudit('product_deleted', { product_id: id, name: prod?.name });
    await fetchProducts();
    renderUI();
    showSpinner(false);
    toast('ลบรายการแล้ว', 'success');
}

async function updateOrderStatus(orderId, newStatus) {
    showSpinner(true);
    const statusLabel = { pending: 'รอชำระเงิน', paid: 'ชำระแล้ว', completed: 'สำเร็จ', cancelled: 'ยกเลิก' };
    const { error } = await supabaseClient.from('orders').update({ status: newStatus }).eq('id', orderId);
    if (!error) {
        toast(`อัปเดตสถานะออเดอร์ #${orderId} แล้ว`, 'success');
        logAudit('order_status_updated', { order_id: orderId, new_status: newStatus });
        notifyTelegram(`📦 *อัปเดตออเดอร์ #${orderId}*\nสถานะ: ${statusLabel[newStatus] || newStatus}`);
    } else toast('เกิดข้อผิดพลาด', 'error');
    showSpinner(false);
    renderAdminOrders(document.getElementById('main-content'));
}

function changePage(p) { state.adminStats.page = p; renderAdminOrders(document.getElementById('main-content')); }
function changeCategory(id) { state.currentCategory = id; renderUI(); }

// ==================== PDPA ====================
function showPDPA(show) {
    const modal = document.getElementById('pdpa-modal');
    if (show) { modal.classList.remove('hidden'); requestAnimationFrame(() => modal.classList.add('opacity-100')); }
    else { modal.classList.remove('opacity-100'); setTimeout(() => modal.classList.add('hidden'), 500); }
}

async function acceptPDPA() {
    await supabaseClient.from('user_profiles').update({ pdpa_consent: true }).eq('userId', state.user.userId);
    state.user.pdpa_consent = true;
    showPDPA(false);
    if (!state.user.phone || !state.user.birthday) showRegisterModal(true);
}

// ==================== PAYMENT MODAL ====================
function showPaymentModal(order) {
    const modal = document.getElementById('payment-modal');
    document.getElementById('pay-amount').textContent = `${parseFloat(order.total_amount).toFixed(2)} บ.`;
    const pp = (order.promptpay_qr || state.settings.promptpay_id || '').replace(/[-\s]/g, '');
    const amount = parseFloat(order.total_amount).toFixed(2);
    document.getElementById('qr-container').innerHTML = `
        <img src="https://promptpay.io/${pp}/${amount}.png"
            class="w-48 h-48 rounded-2xl border border-outline-variant/15 shadow-inner animate-fade-in"
            alt="PromptPay QR">`;
    openModal(modal);
}

function closePayment() {
    const modal = document.getElementById('payment-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function copyAccount() {
    const acc = document.getElementById('bank-acc')?.textContent;
    if (acc) { navigator.clipboard.writeText(acc); toast('คัดลอกเลขบัญชีแล้ว!', 'success'); }
}

// ==================== REGISTER MODAL ====================
function showRegisterModal(isFirstTime = true) {
    const modal = document.getElementById('register-modal');
    const title = document.getElementById('reg-modal-title');
    const desc  = document.getElementById('reg-modal-desc');
    const cancel = document.getElementById('reg-cancel-btn');

    title.textContent = isFirstTime ? 'สร้างบัญชี' : 'แก้ไขโปรไฟล์';
    desc.textContent  = isFirstTime ? 'กรุณากรอกข้อมูลเพื่อเริ่มใช้งาน' : 'แก้ไขข้อมูลส่วนตัวของคุณ';
    cancel?.classList.toggle('hidden', isFirstTime);

    document.getElementById('reg-name').value     = state.user?.displayName || '';
    document.getElementById('reg-phone').value    = state.user?.phone || '';
    document.getElementById('reg-birthday').value = state.user?.birthday || '';
    document.getElementById('reg-email').value    = state.user?.email || '';

    try {
        const token = liff.getDecodedIDToken();
        if (token?.email) document.getElementById('reg-email').value = token.email;
    } catch (e) { /* ignore */ }

    openModal(modal);
}

function closeRegisterModal() {
    const modal = document.getElementById('register-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 400);
}

async function handleRegistration(e) {
    e.preventDefault();
    showSpinner(true);
    try {
        const payload = {
            displayName: document.getElementById('reg-name').value.trim(),
            phone:    document.getElementById('reg-phone').value.trim(),
            birthday: document.getElementById('reg-birthday').value,
            email:    document.getElementById('reg-email').value.trim()
        };
        const { error } = await supabaseClient.from('user_profiles').update(payload).eq('userId', state.user.userId);
        if (error) throw error;
        state.user = { ...state.user, ...payload };
        toast('บันทึกสำเร็จแล้ว', 'success');
        closeRegisterModal();
        renderUI();
    } catch (err) {
        toast('เกิดข้อผิดพลาด', 'error');
    } finally {
        showSpinner(false);
    }
}

// ==================== SEARCH ====================
function handleSearch(val) {
    state.searchQuery = val;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        if (state.view === 'home') renderHome(document.getElementById('main-content'));
    }, 350);
}

// ==================== CUSTOM DIALOGS ====================
function _createDialogOverlay(innerHtml) {
    const existing = document.getElementById('custom-dialog');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'custom-dialog';
    el.className = 'dialog-overlay';
    el.innerHTML = `<div class="dialog-card">${innerHtml}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    return el;
}
function _closeDialog() {
    const el = document.getElementById('custom-dialog');
    if (!el) return;
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 260);
}

function showConfirm({ title, message = '', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false } = {}) {
    return new Promise(resolve => {
        const icon = danger ? 'warning' : 'help';
        const type = danger ? 'type-danger' : 'type-default';
        const btnCls = danger ? 'dialog-btn-danger' : 'dialog-btn-confirm';
        const overlay = _createDialogOverlay(`
            <div class="dialog-icon-wrap ${type}">
                <span class="material-symbols-outlined filled" style="font-size:30px;">${icon}</span>
            </div>
            <div class="dialog-title">${title}</div>
            ${message ? `<div class="dialog-message">${message}</div>` : ''}
            <div class="dialog-actions">
                <button class="dialog-btn dialog-btn-cancel" id="dlg-cancel">${cancelText}</button>
                <button class="dialog-btn ${btnCls}" id="dlg-ok">${confirmText}</button>
            </div>
        `);
        overlay.querySelector('#dlg-ok').onclick     = () => { _closeDialog(); resolve(true); };
        overlay.querySelector('#dlg-cancel').onclick = () => { _closeDialog(); resolve(false); };
        overlay.addEventListener('click', e => { if (e.target === overlay) { _closeDialog(); resolve(false); } });
    });
}

function showPrompt({ title, message = '', placeholder = '', defaultValue = '', confirmText = 'ตกลง', cancelText = 'ยกเลิก', inputType = 'text' } = {}) {
    return new Promise(resolve => {
        const icon = inputType === 'date' ? 'calendar_month' : 'edit_note';
        const overlay = _createDialogOverlay(`
            <div class="dialog-icon-wrap type-info">
                <span class="material-symbols-outlined filled" style="font-size:30px;">${icon}</span>
            </div>
            <div class="dialog-title">${title}</div>
            ${message ? `<div class="dialog-message">${message}</div>` : ''}
            <input id="dlg-input" class="dialog-input" placeholder="${placeholder}" type="${inputType}" autocomplete="off" />
            <div class="dialog-actions">
                <button class="dialog-btn dialog-btn-cancel" id="dlg-cancel">${cancelText}</button>
                <button class="dialog-btn dialog-btn-confirm" id="dlg-ok">${confirmText}</button>
            </div>
        `);
        const input = overlay.querySelector('#dlg-input');
        // set value after DOM is ready so date input parses correctly
        if (defaultValue) setTimeout(() => { input.value = defaultValue; }, 0);
        setTimeout(() => input.focus(), 80);
        const ok     = () => { const v = input.value.trim(); _closeDialog(); resolve(v !== '' ? v : null); };
        const cancel = () => { _closeDialog(); resolve(null); };
        overlay.querySelector('#dlg-ok').onclick     = ok;
        overlay.querySelector('#dlg-cancel').onclick = cancel;
        overlay.addEventListener('click', e => { if (e.target === overlay) cancel(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
    });
}

function showCodeConfirm({ title, message = '', code, confirmText = 'ลบ', cancelText = 'ยกเลิก' } = {}) {
    return new Promise(resolve => {
        const overlay = _createDialogOverlay(`
            <div class="dialog-icon-wrap type-danger">
                <span class="material-symbols-outlined filled" style="font-size:30px;">delete_forever</span>
            </div>
            <div class="dialog-title">${title}</div>
            ${message ? `<div class="dialog-message">${message}</div>` : ''}
            <div class="dialog-code-badge">${code}</div>
            <div class="dialog-hint">พิมพ์ตัวเลขด้านบนเพื่อยืนยัน</div>
            <input id="dlg-input" class="dialog-input" placeholder="รหัสยืนยัน..." type="text" maxlength="4" autocomplete="off" />
            <div class="dialog-actions">
                <button class="dialog-btn dialog-btn-cancel" id="dlg-cancel">${cancelText}</button>
                <button class="dialog-btn dialog-btn-danger" id="dlg-ok" disabled>${confirmText}</button>
            </div>
        `);
        const input = overlay.querySelector('#dlg-input');
        const btn   = overlay.querySelector('#dlg-ok');
        setTimeout(() => input.focus(), 80);
        input.addEventListener('input', () => {
            const match = input.value.trim() === String(code);
            btn.disabled = !match;
        });
        const ok     = () => { if (btn.disabled) return; _closeDialog(); resolve(true); };
        const cancel = () => { _closeDialog(); resolve(false); };
        btn.onclick = ok;
        overlay.querySelector('#dlg-cancel').onclick = cancel;
        overlay.addEventListener('click', e => { if (e.target === overlay) cancel(); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
    });
}

// ==================== AUDIT LOG ====================
async function logAudit(action, payload = {}, overrideTenantId = null) {
    try {
        await supabaseClient.rpc('write_audit_log', {
            p_tenant_id:  overrideTenantId ?? state.tenantId ?? null,
            p_actor_id:   state.user?.userId ?? null,
            p_actor_role: state.isSuperAdmin ? 'super_admin' : (state.user?.role ?? 'user'),
            p_action:     action,
            p_payload:    payload
        });
    } catch (e) {
        console.warn('logAudit failed:', e);
    }
}

// ==================== SHARE ====================
async function shareProduct(pid) {
    if (!liff.isLoggedIn()) { liff.login(); return; }
    if (!liff.isApiAvailable('shareTargetPicker')) { toast('การแชร์ไม่พร้อมใช้งาน'); return; }

    const p = state.products.find(x => x.id === pid);
    const storeUrl = `https://liff.line.me/${LIFF_ID}?tenant=${state.tenantConfig?.slug || state.tenantId}`;

    try {
        const result = await liff.shareTargetPicker([{
            type: 'flex',
            altText: `ลองชิม ${p.name} ที่ ${state.tenantConfig?.name || 'ร้านของเรา'}!`,
            contents: {
                type: 'bubble', size: 'mega',
                hero: { type: 'image', url: p.image_url, size: 'full', aspectRatio: '20:13', aspectMode: 'cover', action: { type: 'uri', uri: storeUrl } },
                body: {
                    type: 'box', layout: 'vertical',
                    contents: [
                        { type: 'text', text: p.name, weight: 'bold', size: 'xl' },
                        { type: 'text', text: `${parseFloat(p.price).toFixed(2)} บ.`, size: 'xl', color: '#E8571A', weight: 'bold', margin: 'md' },
                        { type: 'text', text: p.description || '', size: 'sm', color: '#6B6660', wrap: true, margin: 'md', maxLines: 3 }
                    ]
                },
                footer: {
                    type: 'box', layout: 'vertical', spacing: 'sm',
                    contents: [{ type: 'button', style: 'primary', color: '#E8571A', action: { type: 'uri', label: 'ดูเมนูนี้', uri: storeUrl } }]
                }
            }
        }]);
        if (result) toast('ส่งเมนูให้เพื่อนแล้ว!', 'success');
    } catch (err) {
        console.error(err);
        toast('การแชร์ล้มเหลว', 'error');
    }
}

// ==================== TELEGRAM ====================
async function notifyTelegram(msg) {
    const token  = state.tenantConfig?.telegram_bot_token;
    const chatId = state.tenantConfig?.telegram_chat_id;
    if (!token || !chatId) return;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description);
        return data;
    } catch (e) {
        console.warn('Telegram notify failed:', e.message);
    }
}

// ==================== REALTIME ====================
function initRealtime() {
    if (!state.isAdmin) return;
    supabaseClient.channel('admin-orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
            toast('ได้รับการอัปเดตออเดอร์!', 'info');
            if (state.view === 'admin_orders') renderAdminOrders(document.getElementById('main-content'));
        }).subscribe();
}



// ==================== PHASE 5: STORE CLOSED / EXPIRED ====================
function showStoreClosed(storeName = 'ร้านค้า') {
    const overlay = document.getElementById('store-closed-overlay');
    const nameEl  = document.getElementById('store-closed-name');
    if (nameEl) nameEl.textContent = storeName;
    if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
}

function showStoreExpired(storeName = 'ร้านค้า', expiresAt = null) {
    const overlay  = document.getElementById('store-expired-overlay');
    const nameEl   = document.getElementById('expired-store-name');
    const dateEl   = document.getElementById('expired-date-text');
    if (nameEl) nameEl.textContent = storeName;
    if (dateEl && expiresAt) {
        const d = new Date(expiresAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
        dateEl.textContent = `แพ็คเกจหมดอายุเมื่อ ${d}`;
    }
    if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
}

function isTenantExpired(tenant) {
    if (!tenant) return true;
    if (tenant.status !== 'active') return true;
    if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) return true;
    return false;
}

// ==================== PHASE 3: STORE SETUP ONBOARDING ====================
function showStoreSetupModal() {
    const modal = document.getElementById('store-setup-modal');
    if (!modal) return;
    // Pre-fill with existing tenant config
    const cfg = state.tenantConfig || {};
    const nameEl = document.getElementById('setup-store-name');
    const descEl = document.getElementById('setup-store-desc');
    const logoEl = document.getElementById('setup-logo-url');
    if (nameEl) nameEl.value = cfg.name || '';
    if (descEl) descEl.value = cfg.description || '';
    if (logoEl) logoEl.value = cfg.logo_url || '';
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('opacity-100'));
}

function closeStoreSetupModal() {
    const modal = document.getElementById('store-setup-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 400);
}

async function handleStoreSetup(e) {
    e.preventDefault();
    showSpinner(true);
    try {
        const name    = document.getElementById('setup-store-name').value.trim();
        const desc    = document.getElementById('setup-store-desc').value.trim();
        const logoUrl = document.getElementById('setup-logo-url').value.trim();
        const pp      = document.getElementById('setup-promptpay')?.value.trim() || '';
        const bank    = document.getElementById('setup-bank-name')?.value.trim() || '';
        const acc     = document.getElementById('setup-bank-acc')?.value.trim() || '';

        // Update tenant record
        const { error: tenantErr } = await supabaseClient
            .from('tenants')
            .update({ name, description: desc, logo_url: logoUrl || null })
            .eq('id', state.tenantId);
        if (tenantErr) throw tenantErr;

        // Upsert payment settings
        const settingsRows = [
            { tenant_id: state.tenantId, key: 'promptpay_id',    value: pp,   description: 'PromptPay No.' },
            { tenant_id: state.tenantId, key: 'bank_name',       value: bank, description: 'ชื่อธนาคาร' },
            { tenant_id: state.tenantId, key: 'bank_account_no', value: acc,  description: 'เลขบัญชี' }
        ];
        for (const row of settingsRows) {
            if (row.value) await supabaseClient.from('system_settings').upsert(row);
        }

        // Refresh state
        state.tenantConfig = { ...state.tenantConfig, name, description: desc, logo_url: logoUrl || null };
        await fetchSettings();
        updateBranding();
        closeStoreSetupModal();
        toast('ตั้งค่าร้านสำเร็จ! 🎉', 'success');
        setView('home');
    } catch (err) {
        console.error('Store setup error:', err);
        toast('เกิดข้อผิดพลาด: ' + (err.message || 'ลองใหม่อีกครั้ง'), 'error');
    } finally {
        showSpinner(false);
    }
}

// ==================== PHASE 4: ADMIN STORE SETTINGS ====================
function renderAdminStoreSettings(container) {
    const cfg = state.tenantConfig || {};
    container.innerHTML = `
        <div class="pb-28 max-w-xl">
            <h2 class="text-4xl font-black mb-2 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">ตั้งค่าร้านค้า</h2>
            <p class="text-sm mb-8" style="color:var(--plum);">ชื่อ โลโก้ และข้อมูลร้านที่ลูกค้าเห็น</p>

            <div class="card p-6 mb-5">
                <div class="flex items-center gap-4 mb-6">
                    <div class="w-16 h-16 rounded-2xl overflow-hidden border-2 border-outline-variant/20 flex-shrink-0 bg-surface-container">
                        ${cfg.logo_url
                            ? `<img src="${cfg.logo_url}" class="w-full h-full object-cover">`
                            : `<span class="material-symbols-outlined text-[32px] text-on-surface-variant flex items-center justify-center w-full h-full">storefront</span>`}
                    </div>
                    <div>
                        <h3 class="font-black text-xl" style="font-family:'LINE Seed Sans TH',sans-serif;">${cfg.name || 'ร้านของคุณ'}</h3>
                        <span class="pill bg-primary/10 text-primary border border-primary/15 mt-1">${cfg.plan || 'free'} plan</span>
                    </div>
                </div>
                <button onclick="showStoreSetupModal()" class="btn-primary w-full py-3.5">
                    <span class="material-symbols-outlined text-[20px]">edit</span>
                    แก้ไขข้อมูลร้าน
                </button>
            </div>

            <div class="card p-6">
                <p class="text-[10px] font-bold uppercase tracking-widest mb-4" style="color:var(--plum-light);">ข้อมูลร้านปัจจุบัน</p>
                <div class="space-y-3">
                    ${[
                        { icon: 'badge',       label: 'ชื่อร้าน',   val: cfg.name || '–' },
                        { icon: 'description', label: 'คำอธิบาย',  val: cfg.description || '–' },
                        { icon: 'link',        label: 'Slug / ID', val: cfg.slug || cfg.id || '–' },
                        { icon: 'image',       label: 'Logo URL',  val: cfg.logo_url ? '✅ มีโลโก้' : '❌ ยังไม่มีโลโก้' }
                    ].map(r => `
                        <div class="flex items-start gap-3 p-3 rounded-xl" style="background:var(--surface-container-low);border:1px solid var(--outline-variant);">
                            <span class="material-symbols-outlined text-[18px] mt-0.5" style="color:var(--plum-light);">${r.icon}</span>
                            <div>
                                <p class="text-[10px] font-bold uppercase tracking-wider" style="color:var(--plum-light);">${r.label}</p>
                                <p class="text-sm font-semibold" style="color:var(--plum-dark);">${r.val}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// ==================== PHASE 4: ADMIN TELEGRAM ====================
function renderAdminTelegram(container) {
    const cfg = state.tenantConfig || {};
    const isConnected = !!(cfg.telegram_bot_token && cfg.telegram_chat_id);

    container.innerHTML = `
        <div class="pb-28 max-w-lg">
            <h2 class="text-4xl font-black mb-2 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">Telegram Notify</h2>
            <p class="text-sm mb-6" style="color:var(--plum);">รับแจ้งเตือนออเดอร์และการเปลี่ยนแปลงสำคัญผ่าน Telegram Bot</p>

            <!-- Status badge -->
            <div class="flex items-center gap-2.5 mb-6 px-4 py-3 rounded-2xl" style="background:${isConnected ? 'rgba(34,197,94,.10)' : 'rgba(239,68,68,.08)'};border:1px solid ${isConnected ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.20)'};">
                <span class="material-symbols-outlined text-[20px] filled" style="color:${isConnected ? '#22c55e' : '#ef4444'};">${isConnected ? 'check_circle' : 'cancel'}</span>
                <span class="font-bold text-sm" style="color:${isConnected ? '#22c55e' : '#ef4444'};">${isConnected ? 'เชื่อมต่อแล้ว — Bot พร้อมส่งแจ้งเตือน' : 'ยังไม่ได้เชื่อมต่อ — กรอก Bot Token และ Chat ID'}</span>
            </div>

            <!-- Setup guide -->
            <div class="card p-5 mb-5">
                <p class="font-bold text-sm mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px]" style="color:var(--plum-light);">help_outline</span>
                    วิธีตั้งค่า (3 ขั้นตอน)
                </p>
                <ol class="space-y-3 text-sm" style="color:var(--on-surface-variant);">
                    <li class="flex gap-3">
                        <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5" style="background:var(--primary);color:#fff;">1</span>
                        <span>เปิด Telegram → ค้นหา <strong>@BotFather</strong> → พิมพ์ <code class="px-1.5 py-0.5 rounded text-xs" style="background:rgba(0,0,0,.08);">/newbot</code> → ตั้งชื่อ Bot → รับ <strong>Bot Token</strong></span>
                    </li>
                    <li class="flex gap-3">
                        <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5" style="background:var(--primary);color:#fff;">2</span>
                        <span>สร้างกลุ่มหรือ Channel ใน Telegram → เชิญ Bot เข้ากลุ่ม → หา <strong>Chat ID</strong> ได้จาก <code class="px-1.5 py-0.5 rounded text-xs" style="background:rgba(0,0,0,.08);">@userinfobot</code> หรือ Telegram API</span>
                    </li>
                    <li class="flex gap-3">
                        <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5" style="background:var(--primary);color:#fff;">3</span>
                        <span>กรอก Token และ Chat ID ด้านล่าง → บันทึก → กดทดสอบ</span>
                    </li>
                </ol>
            </div>

            <!-- Config form -->
            <div class="card p-6">
                <div class="flex items-center gap-3 mb-6">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:rgba(41,182,246,.15);">
                        <span class="material-symbols-outlined text-[22px]" style="color:#29B6F6;">send</span>
                    </div>
                    <p class="font-bold">ตั้งค่า Bot</p>
                </div>

                <form onsubmit="saveTelegramConfig(event)" class="space-y-5">
                    <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest mb-2" style="color:var(--plum-light);">Bot Token</label>
                        <input type="text" id="tg-bot-token" class="w-full" placeholder="123456789:ABCdef-xyz..."
                            value="${cfg.telegram_bot_token || ''}">
                        <p class="text-xs mt-1.5" style="color:var(--plum-light);">รับมาจาก @BotFather หลังสร้าง Bot ใหม่</p>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase tracking-widest mb-2" style="color:var(--plum-light);">Chat ID</label>
                        <input type="text" id="tg-chat-id" class="w-full" placeholder="-1001234567890"
                            value="${cfg.telegram_chat_id || ''}">
                        <p class="text-xs mt-1.5" style="color:var(--plum-light);">ID ของกลุ่ม/Channel ที่เชิญ Bot เข้าแล้ว (มักขึ้นต้นด้วย -100)</p>
                    </div>
                    <button type="submit" class="btn-primary w-full py-4">
                        <span class="material-symbols-outlined text-[20px]">save</span>
                        บันทึกการตั้งค่า
                    </button>
                </form>

                ${isConnected ? `
                    <button onclick="testTelegramNotify()" class="w-full mt-3 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                        style="background:rgba(41,182,246,.12);color:#0288D1;border:1px solid rgba(41,182,246,.25);">
                        <span class="material-symbols-outlined text-[18px]">send</span>
                        ส่งข้อความทดสอบ
                    </button>
                    <button onclick="clearTelegramConfig()" class="w-full mt-2 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                        style="background:rgba(239,68,68,.08);color:#ef4444;border:1px solid rgba(239,68,68,.18);">
                        <span class="material-symbols-outlined text-[18px]">link_off</span>
                        ยกเลิกการเชื่อมต่อ
                    </button>
                ` : ''}
            </div>

            <!-- Events that trigger notification -->
            <div class="card p-5 mt-5">
                <p class="font-bold text-sm mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px]" style="color:var(--plum-light);">notifications_active</span>
                    เหตุการณ์ที่จะแจ้งเตือน
                </p>
                <div class="space-y-2.5">
                    ${[
                        ['🛒', 'มีออเดอร์ใหม่เข้ามา', true],
                        ['📦', 'อัปเดตสถานะออเดอร์ (แอดมิน)', true],
                        ['⚠️', 'แอดมินเปลี่ยนเลข PromptPay', true],
                    ].map(([icon, label, active]) => `
                        <div class="flex items-center gap-3 py-2 px-3 rounded-xl" style="background:rgba(0,0,0,.03);">
                            <span class="text-base">${icon}</span>
                            <span class="text-sm flex-1" style="color:var(--on-surface-variant);">${label}</span>
                            <span class="text-xs font-bold px-2 py-0.5 rounded-full" style="background:${active ? 'rgba(34,197,94,.12)' : 'rgba(0,0,0,.06)'};color:${active ? '#16a34a' : 'var(--plum-light)'};">${active ? 'เปิด' : 'ปิด'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

async function saveTelegramConfig(e) {
    e.preventDefault();
    showSpinner(true);
    try {
        const botToken = document.getElementById('tg-bot-token').value.trim();
        const chatId   = document.getElementById('tg-chat-id').value.trim();
        if (botToken && !chatId) { toast('กรุณากรอก Chat ID ด้วยครับ', 'error'); return; }
        if (!botToken && chatId) { toast('กรุณากรอก Bot Token ด้วยครับ', 'error'); return; }
        const { error } = await supabaseClient
            .from('tenants')
            .update({ telegram_bot_token: botToken || null, telegram_chat_id: chatId || null })
            .eq('id', state.tenantId);
        if (error) throw error;
        state.tenantConfig = { ...state.tenantConfig, telegram_bot_token: botToken || null, telegram_chat_id: chatId || null };
        logAudit('telegram_config_saved', { has_token: !!botToken });
        toast('บันทึกการตั้งค่า Telegram แล้ว', 'success');
        renderAdminTelegram(document.getElementById('main-content'));
    } catch (err) {
        toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
        showSpinner(false);
    }
}

async function clearTelegramConfig() {
    const ok = await showConfirm({ title: 'ยกเลิกการเชื่อมต่อ Telegram?', message: 'Bot Token และ Chat ID จะถูกลบออก ระบบจะหยุดส่งแจ้งเตือน', confirmText: 'ยกเลิกการเชื่อมต่อ', danger: true });
    if (!ok) return;
    showSpinner(true);
    try {
        const { error } = await supabaseClient.from('tenants')
            .update({ telegram_bot_token: null, telegram_chat_id: null })
            .eq('id', state.tenantId);
        if (error) throw error;
        state.tenantConfig = { ...state.tenantConfig, telegram_bot_token: null, telegram_chat_id: null };
        toast('ยกเลิกการเชื่อมต่อ Telegram แล้ว', 'info');
        renderAdminTelegram(document.getElementById('main-content'));
    } catch (err) {
        toast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
        showSpinner(false);
    }
}

async function testTelegramNotify() {
    toast('กำลังส่งข้อความทดสอบ...', 'info');
    const result = await notifyTelegram(
        `✅ *ทดสอบการแจ้งเตือน*\n🏪 ร้าน: ${state.tenantConfig?.name || 'ร้านค้า'}\n🕐 เวลา: ${formatDateTime(new Date().toISOString())}\n\nระบบแจ้งเตือน Telegram เชื่อมต่อสำเร็จแล้ว!`
    );
    if (result?.ok) {
        toast('ส่งข้อความสำเร็จ! ตรวจสอบ Telegram ของคุณ', 'success');
    } else {
        toast('ส่งไม่สำเร็จ ตรวจสอบ Bot Token และ Chat ID อีกครั้ง', 'error');
    }
}

// ==================== PHASE 4: ADMIN PLAN ====================
function renderAdminPlan(container) {
    const cfg = state.tenantConfig || {};
    const planColors = { free: '#78586f', starter: '#7b9ea8', pro: '#c9a470', enterprise: '#4e3448' };
    const planBg    = { free: 'rgba(120,88,111,.10)', starter: 'rgba(123,158,168,.12)', pro: 'rgba(230,199,156,.20)', enterprise: 'rgba(78,52,72,.12)' };
    const plan = cfg.plan || 'free';
    const expiresAt = cfg.expires_at ? formatDate(cfg.expires_at) : 'ไม่มีวันหมดอายุ';
    const isExpired = cfg.expires_at ? new Date(cfg.expires_at) < new Date() : false;

    const planFeatures = {
        free:       ['สินค้าสูงสุด 10 รายการ', 'Admin 1 คน', 'Telegram Notify ❌', 'Custom Logo ❌'],
        starter:    ['สินค้าสูงสุด 50 รายการ', 'Admin 3 คน', 'Telegram Notify ✅', 'Custom Logo ✅'],
        pro:        ['สินค้าไม่จำกัด', 'Admin ไม่จำกัด', 'Telegram Notify ✅', 'Custom Logo ✅', 'Priority Support ✅'],
        enterprise: ['ทุกอย่างใน Pro', 'White-label ✅', 'Custom Domain ✅', 'Dedicated Support ✅']
    };

    container.innerHTML = `
        <div class="pb-28 max-w-lg">
            <h2 class="text-4xl font-black mb-2 leading-tight" style="font-family:'LINE Seed Sans TH',sans-serif;">แผนบริการ</h2>
            <p class="text-sm mb-8" style="color:var(--plum);">ข้อมูลการสมัครใช้งานร้านของคุณ</p>

            <div class="card p-6 mb-5">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl flex items-center justify-center"
                            style="background:${planBg[plan] || planBg.free};border:1px solid rgba(0,0,0,.08);">
                            <span class="material-symbols-outlined text-[24px] filled" style="color:${planColors[plan] || planColors.free};">workspace_premium</span>
                        </div>
                        <div>
                            <p class="text-[10px] font-bold uppercase tracking-widest" style="color:var(--plum-light);">แผนปัจจุบัน</p>
                            <p class="text-2xl font-black capitalize" style="font-family:'LINE Seed Sans TH',sans-serif;color:${planColors[plan] || planColors.free};">${plan}</p>
                        </div>
                    </div>
                    <span class="status-badge ${cfg.status === 'active' ? 'status-completed' : 'status-cancelled'}">
                        <span class="dot bg-current"></span>
                        ${cfg.status === 'active' ? 'ใช้งานอยู่' : cfg.status || 'ไม่ใช้งาน'}
                    </span>
                </div>

                <div class="space-y-2.5 mt-4">
                    ${[
                        { icon: 'calendar_today', label: 'วันที่เริ่มใช้', val: cfg.created_at ? formatDate(cfg.created_at) : '–' },
                        { icon: 'event',          label: 'วันหมดอายุ',   val: expiresAt, warn: isExpired },
                        { icon: 'fingerprint',    label: 'รหัสร้านค้า',    val: cfg.id || '–' },
                        { icon: 'link',           label: 'Slug',         val: cfg.slug || '–' }
                    ].map(r => `
                        <div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--surface-container-low);border:1px solid var(--outline-variant);">
                            <span class="material-symbols-outlined text-[16px]" style="color:${r.warn ? 'var(--error)' : 'var(--plum-light)'};">${r.icon}</span>
                            <div class="flex-1 flex items-center justify-between">
                                <p class="text-xs font-medium" style="color:var(--plum-light);">${r.label}</p>
                                <p class="text-sm font-bold" style="color:${r.warn ? 'var(--error)' : 'var(--plum-dark)'};">${r.val}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="card p-6">
                <p class="text-[10px] font-bold uppercase tracking-widest mb-4" style="color:var(--plum-light);">สิทธิ์การใช้งาน</p>
                <ul class="space-y-2.5">
                    ${(planFeatures[plan] || planFeatures.free).map(f => `
                        <li class="flex items-center gap-2.5 text-sm font-medium" style="color:var(--plum-dark);">
                            <span class="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style="background:var(--surface-container);">
                                <span class="material-symbols-outlined text-[13px]">${f.includes('❌') ? 'close' : 'check'}</span>
                            </span>
                            ${f.replace('✅','').replace('❌','').trim()}
                        </li>
                    `).join('')}
                </ul>
                <p class="text-xs mt-5 text-center" style="color:var(--plum-light);">ต้องการอัปเกรดแผน? ติดต่อผู้ดูแลระบบ</p>
            </div>
        </div>
    `;
}

function closePlanModal() {
    const modal = document.getElementById('plan-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 400);
}

// ==================== AUDIT LOG STATE ====================
const _audit = { page: 0, pageSize: 25, total: 0, actionFilter: null, roleFilter: null };

// ==================== SUPER ADMIN PORTAL ====================
async function renderSuperAdminPortal(container) {
    container.innerHTML = `<div class="flex justify-center py-10"><div class="spinner border-primary w-8 h-8"></div></div>`;
    try {
        const [{ data: tenants, error: tErr }, { data: invites, error: iErr }] = await Promise.all([
            supabaseClient.rpc('sa_get_tenants', { p_user_id: state.user.userId }),
            supabaseClient.rpc('sa_get_invites', { p_user_id: state.user.userId }),
        ]);

        if (tErr) throw tErr;
        if (iErr) throw iErr;

        const activeStores = tenants?.filter(t => t.status === 'active').length || 0;
        const availInvites = invites?.filter(i => !i.used_at).length || 0;

        container.innerHTML = `
            <div class="sa-portal">

                <!-- Top bar -->
                <div class="sa-topbar">
                    <div>
                        <div class="sa-badge-role mb-2">
                            <span class="material-symbols-outlined" style="font-size:13px;">shield</span>
                            Super Admin Console
                        </div>
                        <h1>ระบบจัดการ SaaS</h1>
                        <p>จัดการร้านค้า ลิงก์เชิญ และ Audit Logs ทั้งหมดในระบบ</p>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <p style="color:rgba(200,185,255,.40);font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.2rem;">เข้าสู่ระบบในนาม</p>
                        <p style="color:#e0d8f8;font-weight:800;font-size:.85rem;">${state.user?.displayName || 'ซูเปอร์แอดมิน'}</p>
                    </div>
                </div>

                <!-- Stat row -->
                <div class="sa-stat-row">
                    <div class="sa-stat">
                        <div class="sa-stat-num">${tenants?.length || 0}</div>
                        <div class="sa-stat-label">ร้านค้าทั้งหมด</div>
                    </div>
                    <div class="sa-stat">
                        <div class="sa-stat-num" style="color:#7ee8a0;">${activeStores}</div>
                        <div class="sa-stat-label">ร้านเปิดใช้งาน</div>
                    </div>
                    <div class="sa-stat">
                        <div class="sa-stat-num" style="color:#6ee0c0;">${availInvites}</div>
                        <div class="sa-stat-label">Invite คงเหลือ</div>
                    </div>
                </div>

                <!-- Stores + Invites -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

                    <!-- Stores -->
                    <div class="sa-card">
                        <div class="sa-card-title">
                            <span class="material-symbols-outlined" style="font-size:18px;color:#c4a8ff;">storefront</span>
                            ร้านค้าทั้งหมด
                            <span class="count">${tenants?.length || 0}</span>
                        </div>
                        <div style="max-height:56vh;overflow-y:auto;padding-right:4px;">
                            ${tenants?.map(t => `
                                <div class="sa-row-item">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;">
                                        <div style="display:flex;align-items:center;gap:.75rem;min-width:0;">
                                            <div style="width:42px;height:42px;border-radius:.65rem;background:rgba(255,255,255,.07);border:1px solid rgba(160,130,220,.18);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                                                ${t.logo_url
                                                    ? `<img src="${t.logo_url}" style="width:100%;height:100%;object-fit:cover;">`
                                                    : `<span class="material-symbols-outlined" style="font-size:20px;color:rgba(160,130,220,.55);">store</span>`}
                                            </div>
                                            <div style="min-width:0;">
                                                <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
                                                    <span class="sa-store-name">${t.name}</span>
                                                    <span class="sa-store-slug">${t.slug}</span>
                                                </div>
                                                <div style="display:flex;align-items:center;gap:.4rem;margin-top:.35rem;flex-wrap:wrap;">
                                                    <span class="${t.status === 'active' ? 'sa-pill-active' : 'sa-pill-inactive'}">${t.status}</span>
                                                    <span class="sa-pill-plan">${t.plan}</span>
                                                    ${t.expires_at ? `<span class="sa-expire-text">หมดอายุ ${new Date(t.expires_at).toLocaleDateString('th-TH')}</span>` : ''}
                                                </div>
                                            </div>
                                        </div>
                                        <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0;">
                                            <button onclick="updateTenantExpirySA('${t.id}', '${t.expires_at || ''}')" class="sa-icon-btn edit" title="แก้ไขวันหมดอายุ">
                                                <span class="material-symbols-outlined" style="font-size:17px;">calendar_month</span>
                                            </button>
                                            <button onclick="deleteTenantSA('${t.id}', '${(t.name || '').replace(/'/g, "\\'")}')" class="sa-icon-btn danger" title="ลบร้านค้า">
                                                <span class="material-symbols-outlined" style="font-size:17px;">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `).join('') || '<p style="text-align:center;color:rgba(160,130,220,.40);font-size:.85rem;padding:2rem 0;">ไม่พบร้านค้า</p>'}
                        </div>
                    </div>

                    <!-- Invite Links -->
                    <div class="sa-card">
                        <div class="sa-card-title" style="justify-content:space-between;">
                            <div style="display:flex;align-items:center;gap:.6rem;">
                                <span class="material-symbols-outlined" style="font-size:18px;color:#c4a8ff;">link</span>
                                Invite Links
                                <span class="count">${invites?.length || 0}</span>
                            </div>
                            <button onclick="createInviteSA()" class="sa-btn">
                                <span class="material-symbols-outlined" style="font-size:16px;">add</span> สร้างลิงก์
                            </button>
                        </div>
                        <div style="max-height:56vh;overflow-y:auto;padding-right:4px;">
                            ${invites?.map(i => `
                                <div class="sa-row-item">
                                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.6rem;">
                                        <div style="min-width:0;flex:1;">
                                            <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
                                                <span class="${i.used_at ? 'sa-pill-used' : 'sa-pill-avail'}">${i.used_at ? 'ใช้แล้ว' : 'ใช้ได้'}</span>
                                                <span class="sa-pill-plan">${i.plan}</span>
                                                <span class="sa-expire-text">หมด ${new Date(i.expires_at).toLocaleDateString('th-TH')}</span>
                                            </div>
                                            <p class="sa-link-label">🔗 ลิงก์เชิญเจ้าของร้าน</p>
                                            <div class="sa-link-box">
                                                <span class="sa-mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">liff.line.me/${LIFF_ID}?invite=${i.token}</span>
                                                <button onclick="navigator.clipboard.writeText('https://liff.line.me/${LIFF_ID}?invite=${i.token}'); toast('Copied!', 'success')" style="background:none;border:none;cursor:pointer;padding:0;color:rgba(160,130,220,.70);flex-shrink:0;" title="Copy">
                                                    <span class="material-symbols-outlined" style="font-size:15px;">content_copy</span>
                                                </button>
                                            </div>
                                            ${i.preset_slug ? `
                                            <p class="sa-link-label">🛍️ ลิงก์ร้านค้า (ลูกค้า)</p>
                                            <div class="sa-link-box" style="border-color:rgba(80,200,160,.18);">
                                                <span class="sa-mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(80,220,170,.65);">liff.line.me/${LIFF_ID}?tenant=${i.preset_slug}</span>
                                                <button onclick="navigator.clipboard.writeText('https://liff.line.me/${LIFF_ID}?tenant=${i.preset_slug}'); toast('Copied!', 'success')" style="background:none;border:none;cursor:pointer;padding:0;color:rgba(80,200,160,.70);flex-shrink:0;" title="Copy">
                                                    <span class="material-symbols-outlined" style="font-size:15px;">content_copy</span>
                                                </button>
                                            </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                    ${!i.used_at ? `
                                        <div style="display:flex;justify-content:flex-end;gap:.5rem;">
                                            <button onclick="extendInviteSA('${i.id}')" class="sa-icon-btn extend" title="+30 วัน" style="width:auto;padding:0 .65rem;gap:.3rem;font-size:.72rem;font-weight:700;">
                                                <span class="material-symbols-outlined" style="font-size:14px;">more_time</span>
                                                <span style="font-size:.72rem;">+30 วัน</span>
                                            </button>
                                            <button onclick="deleteInviteSA('${i.id}')" class="sa-icon-btn danger" title="ลบลิงก์" style="width:auto;padding:0 .65rem;gap:.3rem;font-size:.72rem;font-weight:700;">
                                                <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
                                                <span style="font-size:.72rem;">ลบ</span>
                                            </button>
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('') || '<p style="text-align:center;color:rgba(160,130,220,.40);font-size:.85rem;padding:2rem 0;">ไม่มี Invite Link</p>'}
                        </div>
                    </div>
                </div>

                <!-- Audit Logs (lazy loaded) -->
                <div id="sa-audit-section"></div>

            </div>
        `;
        // Load audit logs after main portal renders (non-blocking)
        _audit.page = 0; _audit.actionFilter = null; _audit.roleFilter = null;
        loadAuditLogs();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<p class="text-center text-error mt-10">Error loading portal</p>`;
    }
}

// ==================== AUDIT LOG HELPERS ====================
function _auditActionMeta(action) {
    const map = {
        order_placed:          { label: 'ออเดอร์ใหม่',         color: '#4ade80', bg: 'rgba(74,222,128,.12)' },
        order_status_updated:  { label: 'อัปเดตออเดอร์',       color: '#60a5fa', bg: 'rgba(96,165,250,.12)' },
        product_created:       { label: 'เพิ่มสินค้า',         color: '#34d399', bg: 'rgba(52,211,153,.12)' },
        product_updated:       { label: 'แก้ไขสินค้า',         color: '#67e8f9', bg: 'rgba(103,232,249,.12)' },
        product_deleted:       { label: 'ลบสินค้า',            color: '#f87171', bg: 'rgba(248,113,113,.12)' },
        category_created:      { label: 'เพิ่มหมวดหมู่',       color: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
        category_updated:      { label: 'แก้ไขหมวดหมู่',      color: '#c4b5fd', bg: 'rgba(196,181,253,.12)' },
        category_deleted:      { label: 'ลบหมวดหมู่',         color: '#f87171', bg: 'rgba(248,113,113,.12)' },
        settings_saved:        { label: 'บันทึกตั้งค่า',       color: '#fbbf24', bg: 'rgba(251,191,36,.12)'  },
        points_added:          { label: 'เพิ่มคะแนน',          color: '#e879f9', bg: 'rgba(232,121,249,.12)' },
        telegram_config_saved: { label: 'ตั้งค่า Telegram',    color: '#38bdf8', bg: 'rgba(56,189,248,.12)'  },
        sa_invite_created:     { label: 'SA: สร้าง Invite',    color: '#fb923c', bg: 'rgba(251,146,60,.12)'  },
        sa_invite_extended:    { label: 'SA: ขยายเวลา Invite', color: '#fb923c', bg: 'rgba(251,146,60,.12)'  },
        sa_invite_deleted:     { label: 'SA: ลบ Invite',       color: '#f87171', bg: 'rgba(248,113,113,.12)' },
        sa_tenant_expiry_updated: { label: 'SA: แก้วันหมดอายุ', color: '#fb923c', bg: 'rgba(251,146,60,.12)'},
        sa_tenant_deleted:     { label: 'SA: ลบร้านค้า',       color: '#f87171', bg: 'rgba(248,113,113,.12)' },
    };
    return map[action] || { label: action, color: 'rgba(200,185,255,.70)', bg: 'rgba(200,185,255,.08)' };
}

function _humanizePayload(action, payload) {
    if (!payload || !Object.keys(payload).length) return '–';
    try {
        switch (action) {
            case 'order_placed':         return `#${payload.order_id} · ${payload.items_count} รายการ · ${Number(payload.total).toFixed(0)}฿`;
            case 'order_status_updated': return `#${payload.order_id} → ${payload.new_status}`;
            case 'product_created':
            case 'product_updated':      return `${payload.name}${payload.price ? ' · ' + payload.price + '฿' : ''}`;
            case 'product_deleted':      return payload.name || `id:${payload.product_id}`;
            case 'category_created':
            case 'category_updated':     return payload.name;
            case 'category_deleted':     return `id:${payload.category_id}`;
            case 'points_added':         return `+${payload.added} → รวม ${payload.new_total} คะแนน`;
            case 'settings_saved':       return payload.keys?.join(', ');
            case 'telegram_config_saved':return payload.has_token ? 'เชื่อมต่อ Bot' : 'ยกเลิก Bot';
            case 'sa_invite_created':    return payload.slug ? `slug: ${payload.slug}` : 'auto slug';
            case 'sa_invite_extended':   return `+${payload.added_days} วัน`;
            case 'sa_tenant_expiry_updated': return `→ ${payload.new_expiry}`;
            case 'sa_tenant_deleted':    return payload.name;
            default:                     return JSON.stringify(payload).slice(0, 80);
        }
    } catch { return '–'; }
}

async function loadAuditLogs(page = _audit.page) {
    _audit.page = page;
    const section = document.getElementById('sa-audit-section');
    if (!section) return;

    section.innerHTML = `
        <div class="sa-card">
            <div class="sa-card-title">
                <span class="material-symbols-outlined" style="font-size:18px;color:#c4a8ff;">history</span>
                Audit Logs
            </div>
            <div style="display:flex;justify-content:center;padding:2.5rem 0;">
                <div class="spinner" style="width:28px;height:28px;border-color:rgba(160,130,220,.25);border-top-color:#a078c8;"></div>
            </div>
        </div>`;

    const { data: logs, error } = await supabaseClient.rpc('sa_get_audit_logs', {
        p_user_id:       state.user.userId,
        p_limit:         _audit.pageSize,
        p_offset:        _audit.page * _audit.pageSize,
        p_action_filter: _audit.actionFilter || null,
        p_role_filter:   _audit.roleFilter   || null,
    });

    if (error) { section.innerHTML = `<p style="color:#f87171;text-align:center;padding:2rem;">โหลด Audit Logs ไม่สำเร็จ: ${error.message}</p>`; return; }

    const total      = logs?.[0]?.total_count ? Number(logs[0].total_count) : 0;
    _audit.total     = total;
    const totalPages = Math.max(1, Math.ceil(total / _audit.pageSize));
    const start      = _audit.page * _audit.pageSize + 1;
    const end        = Math.min(start + _audit.pageSize - 1, total);

    const ACTION_OPTIONS = [
        'order_placed','order_status_updated',
        'product_created','product_updated','product_deleted',
        'category_created','category_updated','category_deleted',
        'settings_saved','points_added','telegram_config_saved',
        'sa_invite_created','sa_invite_extended','sa_invite_deleted',
        'sa_tenant_expiry_updated','sa_tenant_deleted',
    ];

    section.innerHTML = `
        <div class="sa-card">
            <!-- Header -->
            <div class="sa-card-title" style="flex-wrap:wrap;gap:.75rem;">
                <div style="display:flex;align-items:center;gap:.6rem;">
                    <span class="material-symbols-outlined" style="font-size:18px;color:#c4a8ff;">history</span>
                    Audit Logs
                    <span class="count">${total.toLocaleString()} รายการ</span>
                </div>
                <button onclick="showDeleteAuditModal()" style="margin-left:auto;display:flex;align-items:center;gap:.4rem;padding:.4rem .85rem;border-radius:8px;border:1px solid rgba(248,113,113,.3);background:rgba(248,113,113,.08);color:#f87171;font-size:.75rem;font-weight:700;cursor:pointer;transition:all .18s;" onmouseover="this.style.background='rgba(248,113,113,.18)'" onmouseout="this.style.background='rgba(248,113,113,.08)'">
                    <span class="material-symbols-outlined" style="font-size:15px;">delete_sweep</span>
                    ล้าง Log
                </button>
            </div>

            <!-- Filter bar -->
            <div style="display:flex;gap:.6rem;flex-wrap:wrap;padding:.75rem 1.25rem 0;align-items:center;">
                <select onchange="_audit.actionFilter=this.value||null;loadAuditLogs(0)"
                    style="background:rgba(255,255,255,.05);border:1px solid rgba(160,130,220,.2);border-radius:8px;padding:.4rem .7rem;color:#d0c8e8;font-size:.78rem;outline:none;cursor:pointer;">
                    <option value="">ทุก Action</option>
                    ${ACTION_OPTIONS.map(a => `<option value="${a}" ${_audit.actionFilter===a?'selected':''}>${_auditActionMeta(a).label}</option>`).join('')}
                </select>
                <select onchange="_audit.roleFilter=this.value||null;loadAuditLogs(0)"
                    style="background:rgba(255,255,255,.05);border:1px solid rgba(160,130,220,.2);border-radius:8px;padding:.4rem .7rem;color:#d0c8e8;font-size:.78rem;outline:none;cursor:pointer;">
                    <option value="">ทุก Role</option>
                    <option value="user"        ${_audit.roleFilter==='user'?'selected':''}>User</option>
                    <option value="admin"       ${_audit.roleFilter==='admin'?'selected':''}>Admin</option>
                    <option value="super_admin" ${_audit.roleFilter==='super_admin'?'selected':''}>Super Admin</option>
                </select>
                ${(_audit.actionFilter||_audit.roleFilter) ? `
                    <button onclick="_audit.actionFilter=null;_audit.roleFilter=null;loadAuditLogs(0)"
                        style="padding:.35rem .7rem;border-radius:8px;border:1px solid rgba(160,130,220,.2);background:none;color:rgba(200,185,255,.55);font-size:.75rem;cursor:pointer;">
                        ✕ ล้าง Filter
                    </button>` : ''}
                <span style="margin-left:auto;font-size:.72rem;color:rgba(200,185,255,.40);">
                    ${total > 0 ? `${start}–${end} จาก ${total.toLocaleString()}` : ''}
                </span>
            </div>

            <!-- Table -->
            <div style="overflow-x:auto;margin-top:.75rem;">
                <table class="sa-table">
                    <thead>
                        <tr>
                            <th style="width:145px;">เวลา</th>
                            <th>Action</th>
                            <th>บทบาท</th>
                            <th>ข้อมูล</th>
                            <th style="width:110px;">Tenant</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs?.length ? logs.map(l => {
                            const meta = _auditActionMeta(l.action);
                            return `<tr>
                                <td class="td-time" style="white-space:nowrap;">${new Date(l.created_at).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                                <td>
                                    <span style="display:inline-flex;align-items:center;padding:.2rem .6rem;border-radius:6px;font-size:.72rem;font-weight:700;background:${meta.bg};color:${meta.color};white-space:nowrap;">
                                        ${meta.label}
                                    </span>
                                </td>
                                <td style="font-size:.73rem;color:rgba(200,185,255,.55);">${l.actor_role}</td>
                                <td style="font-size:.78rem;color:rgba(220,210,240,.75);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${JSON.stringify(l.payload||{})}">${_humanizePayload(l.action, l.payload)}</td>
                                <td class="td-mono" style="font-size:.68rem;color:rgba(160,130,220,.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;" title="${l.tenant_id||''}">${l.tenant_id ? l.tenant_id.slice(0,12)+'…' : '–'}</td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="5" style="text-align:center;color:rgba(160,130,220,.35);padding:2.5rem 0;font-size:.85rem;">ไม่มีข้อมูล${_audit.actionFilter||_audit.roleFilter?' (ลอง filter อื่น)':''}</td></tr>`}
                    </tbody>
                </table>
            </div>

            <!-- Pagination -->
            ${totalPages > 1 ? `
            <div style="display:flex;align-items:center;justify-content:center;gap:.5rem;padding:1rem 1.25rem .75rem;flex-wrap:wrap;">
                <button onclick="loadAuditLogs(0)" ${_audit.page===0?'disabled':''} style="padding:.35rem .65rem;border-radius:8px;border:1px solid rgba(160,130,220,.2);background:none;color:${_audit.page===0?'rgba(160,130,220,.25)':'rgba(200,185,255,.7)'};cursor:${_audit.page===0?'default':'pointer'};font-size:.78rem;">«</button>
                <button onclick="loadAuditLogs(${_audit.page-1})" ${_audit.page===0?'disabled':''} style="padding:.35rem .65rem;border-radius:8px;border:1px solid rgba(160,130,220,.2);background:none;color:${_audit.page===0?'rgba(160,130,220,.25)':'rgba(200,185,255,.7)'};cursor:${_audit.page===0?'default':'pointer'};font-size:.78rem;">‹</button>
                ${Array.from({length:Math.min(totalPages,7)}, (_,i) => {
                    let p = i;
                    if (totalPages > 7) {
                        const half = 3;
                        p = Math.min(Math.max(_audit.page - half + i, 0), totalPages - 7 + i);
                    }
                    return `<button onclick="loadAuditLogs(${p})" style="padding:.35rem .65rem;border-radius:8px;border:1px solid rgba(160,130,220,${p===_audit.page?.4:.15});background:${p===_audit.page?'rgba(160,130,220,.2)':'none'};color:${p===_audit.page?'#c4a8ff':'rgba(200,185,255,.55)'};cursor:pointer;font-size:.78rem;font-weight:${p===_audit.page?700:400};">${p+1}</button>`;
                }).join('')}
                <button onclick="loadAuditLogs(${_audit.page+1})" ${_audit.page>=totalPages-1?'disabled':''} style="padding:.35rem .65rem;border-radius:8px;border:1px solid rgba(160,130,220,.2);background:none;color:${_audit.page>=totalPages-1?'rgba(160,130,220,.25)':'rgba(200,185,255,.7)'};cursor:${_audit.page>=totalPages-1?'default':'pointer'};font-size:.78rem;">›</button>
                <button onclick="loadAuditLogs(${totalPages-1})" ${_audit.page>=totalPages-1?'disabled':''} style="padding:.35rem .65rem;border-radius:8px;border:1px solid rgba(160,130,220,.2);background:none;color:${_audit.page>=totalPages-1?'rgba(160,130,220,.25)':'rgba(200,185,255,.7)'};cursor:${_audit.page>=totalPages-1?'default':'pointer'};font-size:.78rem;">»</button>
                <span style="font-size:.72rem;color:rgba(200,185,255,.35);margin-left:.25rem;">หน้า ${_audit.page+1} / ${totalPages}</span>
            </div>` : ''}
        </div>`;
}

async function showDeleteAuditModal() {
    const overlay = _createDialogOverlay(`
        <div class="dialog-icon-wrap type-danger">
            <span class="material-symbols-outlined filled" style="font-size:30px;">delete_sweep</span>
        </div>
        <div class="dialog-title">ล้าง Audit Logs</div>
        <div class="dialog-message">เลือกช่วงเวลาที่ต้องการลบ Log ที่เก่ากว่า</div>
        <div style="display:flex;flex-direction:column;gap:.5rem;width:100%;">
            ${[
                [30,  'ลบ Log เก่ากว่า 30 วัน'],
                [60,  'ลบ Log เก่ากว่า 60 วัน'],
                [90,  'ลบ Log เก่ากว่า 90 วัน'],
                [180, 'ลบ Log เก่ากว่า 180 วัน'],
            ].map(([days, label]) => `
                <button onclick="_deleteAuditByDays(${days})"
                    style="padding:.7rem 1rem;border-radius:12px;border:1px solid rgba(248,113,113,.22);background:rgba(248,113,113,.07);color:#fca5a5;font-size:.88rem;font-weight:600;cursor:pointer;text-align:left;transition:background .15s;"
                    onmouseover="this.style.background='rgba(248,113,113,.16)'"
                    onmouseout="this.style.background='rgba(248,113,113,.07)'">
                    <span style="margin-right:.5rem;">🗑️</span>${label}
                </button>
            `).join('')}
        </div>
        <button class="dialog-btn dialog-btn-cancel" style="width:100%;margin-top:.25rem;" onclick="_closeDialog()">ยกเลิก</button>
    `);
}

async function _deleteAuditByDays(days) {
    _closeDialog();
    const ok = await showConfirm({
        title: `ลบ Log เก่ากว่า ${days} วัน?`,
        message: 'Log ที่ลบไปแล้วจะไม่สามารถกู้คืนได้',
        confirmText: 'ลบ Log', danger: true
    });
    if (!ok) return;
    showSpinner(true);
    try {
        const { data: count, error } = await supabaseClient.rpc('sa_delete_audit_logs', {
            p_user_id: state.user.userId,
            p_older_than_days: days,
        });
        if (error) throw error;
        toast(`ลบ Log ทั้งหมด ${count ?? 0} รายการแล้ว`, 'success');
        loadAuditLogs(0);
    } catch (e) {
        toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
    } finally {
        showSpinner(false);
    }
}

async function createInviteSA() {
    const slug = await showPrompt({
        title: 'สร้างลิงก์เชิญร้านค้า',
        message: 'ระบุ Slug เช่น "mycafe" (a-z, 0-9, ขีดกลาง)<br>ถ้าไม่ระบุ ระบบจะสุ่มให้',
        placeholder: 'เช่น my-cafe (ไม่บังคับ)',
        confirmText: 'สร้างลิงก์',
    });
    if (slug !== null && slug.trim() !== '' && !/^[a-z0-9-]+$/.test(slug)) {
        toast('Slug ต้องเป็นภาษาอังกฤษตัวเล็ก ตัวเลข และขีดกลางเท่านั้น', 'error');
        return;
    }
    const ok = await showConfirm({ title: `ยืนยันสร้างลิงก์ Invite 30 วัน${slug ? ' สำหรับร้าน ' + slug : ''}?`, confirmText: 'สร้างลิงก์' });
    if (!ok) return;
    try {
        const { error } = await supabaseClient.rpc('sa_create_invite', {
            p_user_id: state.user.userId,
            p_plan: 'premium',
            p_expires_in_days: 30,
            p_slug: slug ? slug.trim() : null,
            p_name: slug ? slug.trim().toUpperCase() : null
        });
        if (error) throw error;
        toast('สร้างลิงก์เชิญแล้ว', 'success');
        logAudit('sa_invite_created', { slug: slug || null }, null);
        renderSuperAdminPortal(document.getElementById('main-content'));
    } catch (e) {
        console.error(e);
        toast(`Error: ${e.message}`, 'error');
    }
}

async function updateTenantExpirySA(tenantId, currentExpiry) {
    const defaultDate = currentExpiry ? currentExpiry.split('T')[0] : new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
    const newDate = await showPrompt({
        title: 'ตั้งวันหมดอายุใหม่',
        message: 'เลือกวันที่ต้องการให้ร้านค้าหมดอายุ',
        defaultValue: defaultDate,
        confirmText: 'บันทึก',
        inputType: 'date',
    });
    if (!newDate) return;
    
    try {
        const { error } = await supabaseClient.rpc('sa_update_tenant_expiry', {
            p_user_id: state.user.userId,
            p_tenant_id: tenantId,
            p_expires_at: new Date(newDate).toISOString()
        });
        if (error) throw error;
        toast('อัปเดตวันหมดอายุแล้ว', 'success');
        logAudit('sa_tenant_expiry_updated', { tenant_id: tenantId, new_expiry: newDate }, tenantId);
        renderSuperAdminPortal(document.getElementById('main-content'));
    } catch (e) {
        console.error(e);
        toast(`Error: ${e.message}`, 'error');
    }
}


async function extendInviteSA(tokenId) {
    const ok = await showConfirm({ title: 'ขยายเวลา Invite 30 วัน?', confirmText: 'ขยายเวลา' });
    if (!ok) return;
    try {
        const { error } = await supabaseClient.rpc('sa_extend_invite', {
            p_user_id: state.user.userId,
            p_token_id: tokenId,
            p_add_days: 30
        });
        if (error) throw error;
        toast('ขยายเวลาลิงก์แล้ว', 'success');
        logAudit('sa_invite_extended', { token_id: tokenId, added_days: 30 }, null);
        renderSuperAdminPortal(document.getElementById('main-content'));
    } catch (e) {
        toast('ขยายเวลาไม่สำเร็จ: ' + e.message, 'error');
    }
}

async function deleteInviteSA(tokenId) {
    const ok = await showConfirm({ title: 'ลบ Invite Link นี้?', message: 'หากลบไปแล้ว ร้านค้าจะไม่สามารถใช้ลิงก์เปิดร้านได้อีก', confirmText: 'ลบลิงก์', danger: true });
    if (!ok) return;
    try {
        const { error } = await supabaseClient.rpc('sa_delete_invite', {
            p_user_id: state.user.userId,
            p_token_id: tokenId
        });
        if (error) throw error;
        toast('ลบ Invite Link เรียบร้อยแล้ว', 'success');
        logAudit('sa_invite_deleted', { token_id: tokenId }, null);
        renderSuperAdminPortal(document.getElementById('main-content'));
    } catch (e) {
        toast('เกิดข้อผิดพลาดในการลบลิงก์: ' + e.message, 'error');
    }
}

async function deleteTenantSA(tenantId, name) {
    const code = Math.floor(1000 + Math.random() * 9000);
    const confirmed = await showCodeConfirm({
        title: `ลบร้าน "${name}"?`,
        message: 'การลบจะเป็นการถาวร ข้อมูลทั้งหมดจะหายไป ไม่สามารถกู้คืนได้',
        code,
        confirmText: 'ลบร้านค้า',
    });
    if (!confirmed) return toast('ยกเลิกการลบร้านค้า', 'info');
    
    try {
        const { error } = await supabaseClient.rpc('sa_delete_tenant', {
            p_user_id: state.user.userId,
            p_tenant_id: tenantId
        });
        if (error) throw error;
        toast('ลบร้านค้าเรียบร้อยแล้ว', 'success');
        logAudit('sa_tenant_deleted', { tenant_id: tenantId, name }, null);
        renderSuperAdminPortal(document.getElementById('main-content'));
    } catch (e) {
        toast('เกิดข้อผิดพลาดในการลบ: ' + e.message, 'error');
    }
}

async function shareStore() {
    if (!liff.isApiAvailable('shareTargetPicker')) {
        return toast('อุปกรณ์นี้ไม่รองรับฟังก์ชันแชร์', 'error');
    }
    try {
        const storeName = state.tenantConfig?.name || 'SaaS Food Delivery';
        const storeDesc = state.tenantConfig?.description || 'สัมผัสประสบการณ์อาหารพรีเมียม สั่งเลยผ่าน LINE';
        const storeLogo = state.tenantConfig?.logo_url || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';
        const storeUrl = `https://liff.line.me/${LIFF_ID}?tenant=${state.tenantConfig?.slug || state.tenantId}`;
        
        const res = await liff.shareTargetPicker([
            {
                type: "flex",
                altText: `คุณได้รับคำเชิญให้สั่งอาหารจากร้าน ${storeName}`,
                contents: {
                    type: "bubble",
                    hero: {
                        type: "image",
                        url: storeLogo,
                        size: "full",
                        aspectRatio: "20:13",
                        aspectMode: "cover"
                    },
                    body: {
                        type: "box",
                        layout: "vertical",
                        contents: [
                            { type: "text", text: storeName, weight: "bold", size: "xl" },
                            { type: "text", text: storeDesc, size: "sm", color: "#aaaaaa", wrap: true }
                        ]
                    },
                    footer: {
                        type: "box",
                        layout: "vertical",
                        spacing: "sm",
                        contents: [
                            {
                                type: "button",
                                style: "primary",
                                height: "sm",
                                color: "#E8571A",
                                action: {
                                    type: "uri",
                                    label: "เข้าสู่ร้านค้า",
                                    uri: storeUrl
                                }
                            }
                        ]
                    }
                }
            }
        ]);
        if (res) {
            toast('แชร์ร้านค้าเรียบร้อยแล้ว', 'success');
        }
    } catch (e) {
        console.error('Share error', e);
        toast('ไม่สามารถแชร์ได้', 'error');
    }
}

// ==================== BOOT ====================
window.addEventListener('load', () => {
    initApp();
});