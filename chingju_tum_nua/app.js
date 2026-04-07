// --- CONFIGURATION ---
const LIFF_ID = "2009729405-sA2o7q10";
const SUPABASE_URL = "https://syxljjsddktvbbvkaviu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5eGxqanNkZGt0dmJidmthdml1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NTI2MDksImV4cCI6MjA5MTEyODYwOX0.INkJfiSXt7amnMhvA6Xf2o_jb-PpTkTeyGEIxT6rWZU";


const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);


let state = {
    user: null,
    cart: JSON.parse(localStorage.getItem('culinary_cart')) || [],
    view: 'home',
    categories: [],
    products: [],
    currentCategory: 0,
    loading: true,
    orders: [],
    isAdmin: false,
    searchQuery: '',
    settings: {}, // System settings like PromptPay
    adminStats: {
        totalOrders: 0,
        page: 1,
        pageSize: 5
    },
    userAdminStats: {
        totalUsers: 0,
        page: 1,
        pageSize: 50
    },
    userAdminSearch: ''
};


function formatDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear() + 543;
    return `${day} ${month} ${year}`;
}

// --- CORE FUNCTIONS ---
async function initApp() {
    let loadingProgress = 0;
    const progressBar = document.getElementById("progress-bar");
    const progressPercentage = document.getElementById("progress-percentage");
    const loader = document.getElementById("global-loader");

    const updateProgress = (target) => {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                loadingProgress += Math.random() * 5 + 2;
                if (loadingProgress >= target) {
                    loadingProgress = target;
                    clearInterval(interval);
                    resolve();
                }
                if (progressBar) progressBar.style.width = `${loadingProgress}%`;
                if (progressPercentage) progressPercentage.textContent = `${Math.floor(loadingProgress)}%`;
            }, 30);
        });
    };

    try {
        await updateProgress(20);
        await liff.init({ liffId: LIFF_ID, withLoginOnExternalBrowser: true });
        await liff.ready;
        
        await updateProgress(40);
        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }

        // Friendship Check
        try {
            const friendship = await liff.getFriendship();
            if (!friendship.friendFlag) {
                if (typeof liff.requestFriendship === 'function') await liff.requestFriendship();
            }
        } catch (err) {}

        await updateProgress(60);
        const profile = await liff.getProfile();
        await syncUserProfile(profile);
        
        await updateProgress(80);
        await Promise.all([
            fetchCategories(),
            fetchProducts(),
            fetchSettings()
        ]);

        await updateProgress(100);
        renderUI();

        // Deep Link Handle
        const urlParams = new URL(window.location.href).searchParams;
        const productId = urlParams.get('productId');
        if (productId) {
            setTimeout(() => {
                const el = document.getElementById(`note-${productId}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-primary', 'animate-pulse');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'animate-pulse'), 3000);
                }
            }, 500);
        }
        initRealtime();
        
        setTimeout(() => {
            if (loader) {
                loader.classList.add('opacity-0');
                setTimeout(() => loader.style.display = 'none', 500);
            }
        }, 500);
        
    } catch (error) {
        console.error("App init error:", error);
        if (loader) loader.style.display = 'none';
    }
}

async function syncUserProfile(liffProfile) {
    try {
        const { data: profile, error: fetchError } = await supabaseClient
            .from('user_profiles')
            .select('*')
            .eq('userId', liffProfile.userId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!profile) {
            const { data: newProfile, error: insertError } = await supabaseClient
                .from('user_profiles')
                .insert({
                    userId: liffProfile.userId,
                    displayName: liffProfile.displayName,
                    pictureUrl: liffProfile.pictureUrl,
                    statusMessage: liffProfile.statusMessage,
                    role: 'user',
                    pdpa_consent: false,
                    points: 0
                })
                .select()
                .single();

            if (insertError) throw insertError;
            state.user = newProfile;
        } else {
            state.user = profile;
        }

        if (!state.user) throw new Error("User profile not found after sync.");


        if (state.user.pdpa_consent && (!state.user.phone || !state.user.birthday)) {
            showRegisterModal(true);
        }

        state.isAdmin = state.user.role === 'admin';
        document.getElementById('user-pfp').src = state.user.pictureUrl || 'https://cdn-icons-gif.flaticon.com/8121/8121295.gif';
        document.getElementById('user-points').textContent = state.user.points || 0;

        const adminBtn = document.getElementById('admin-switch');
        if (state.isAdmin && adminBtn) {
            adminBtn.classList.remove('hidden');
            adminBtn.classList.add('lg:flex');
            adminBtn.style.display = 'flex';
        }

        if (!state.user.pdpa_consent) showPDPA(true);

    } catch (e) {
        console.error("Sync failed:", e);
        toast("ไม่สามารถซิงค์ข้อมูลโปรไฟล์ได้");
    }
}


async function fetchCategories() {
    const { data } = await supabaseClient.from('categories').select('*').order('id');
    if (data) state.categories = data;
}

async function fetchProducts() {
    const { data } = await supabaseClient.from('products').select('*').order('id');
    if (data) state.products = data;
}

async function fetchSettings() {
    const { data } = await supabaseClient.from('system_settings').select('*');
    if (data) {
        data.forEach(s => state.settings[s.key] = s.value);

        const bankName = document.getElementById('bank-name');
        const bankAcc = document.getElementById('bank-acc');
        if (bankName) bankName.textContent = state.settings.bank_name || 'ธนาคารกสิกรไทย';
        if (bankAcc) bankAcc.textContent = state.settings.bank_account_no || '123-4-56789-0';
    }
}


function setView(viewName) {
    state.view = viewName;
    renderUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAdminView() {
    if (!state.isAdmin) return toast("สิทธิ์ผู้ดูแลระบบเท่านั้น!");
    state.view = state.view.startsWith('admin_') ? 'home' : 'admin_products';
    renderUI();
}


function renderUI() {
    const main = document.getElementById('main-content');
    const sidebar = document.getElementById('sidebar-nav');

    const userLinks = [
        { view: 'home', icon: 'home', label: 'เมนูยอดนิยม' },
        { view: 'orders', icon: 'receipt_long', label: 'รายการสั่งของฉัน' },
        { view: 'profile', icon: 'person', label: 'บัญชีของฉัน' }
    ];
    const adminLinks = [
        { view: 'admin_products', icon: 'inventory_2', label: 'จัดการเมนูอาหาร' },
        { view: 'admin_categories', icon: 'category', label: 'จัดการหมวดหมู่' },
        { view: 'admin_orders', icon: 'monitoring', label: 'แดชบอร์ดคำสั่งซื้อ' },
        { view: 'admin_users', icon: 'group_add', label: 'จัดการสิทธิ์แอดมิน' },
        { view: 'admin_settings', icon: 'settings_suggest', label: 'ตั้งค่าระบบชำระเงิน' }
    ];

    const activeLinks = state.view.startsWith('admin_') ? adminLinks : userLinks;
    sidebar.innerHTML = activeLinks.map(link => `
        <button onclick="setView('${link.view}')" class="sidebar-link w-full text-left ${state.view === link.view ? 'active' : ''}">
            <span class="material-symbols-outlined ${state.view === link.view ? 'filled' : ''}">${link.icon}</span>
            <span>${link.label}</span>
        </button>
    `).join('');

    const cartTotalItems = state.cart.reduce((acc, item) => acc + item.quantity, 0);
    const desktopCart = document.getElementById('desktop-cart-panel');


    if (desktopCart) {
        if (state.view.startsWith('admin_')) {
            desktopCart.classList.add('lg:hidden');
            main.classList.remove('lg:mr-[26rem]', 'max-w-[1400px]');
            main.classList.add('max-w-none');
            main.classList.replace('lg:px-12', 'lg:px-20');
        } else {
            desktopCart.classList.remove('lg:hidden');
            main.classList.add('lg:mr-[26rem]', 'max-w-[1400px]');
            main.classList.remove('max-w-none');
            main.classList.replace('lg:px-20', 'lg:px-12');
        }
    }


    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) {
        if (state.view.startsWith('admin_')) {

            const adminMobLinks = [
                ...adminLinks,
                { view: 'home', icon: 'logout', label: 'ออก' }
            ];
            bottomNav.classList.replace('justify-around', 'justify-start');
            bottomNav.classList.add('overflow-x-auto', 'hide-scrollbar');
            bottomNav.style.paddingLeft = '1.5rem';
            bottomNav.style.paddingRight = '1.5rem';
            bottomNav.innerHTML = adminMobLinks.map(link => `
                <button onclick="${link.view === 'home' ? 'toggleAdminView()' : `setView('${link.view}')`}" 
                    class="nav-link min-w-[70px] ${state.view === link.view ? 'active' : ''}">
                    <span class="material-symbols-outlined ${state.view === link.view ? 'filled' : ''}">${link.icon}</span>
                    <span class="font-bold whitespace-nowrap text-[9px] mt-1">${link.label.replace('จัดการ', '')}</span>
                </button>
            `).join('');
        } else {
            // User Mode: Standard navigation with prominent cart action
            bottomNav.classList.replace('justify-start', 'justify-around');
            bottomNav.classList.remove('overflow-x-auto', 'hide-scrollbar');
            bottomNav.style.paddingLeft = '';
            bottomNav.style.paddingRight = '';
            bottomNav.innerHTML = `
                <button onclick="setView('home')" class="nav-link ${state.view === 'home' ? 'active' : ''}">
                    <span class="material-symbols-outlined">home</span>
                    <span class="font-bold tracking-wider mt-1 text-[10px]">หน้าหลัก</span>
                </button>
                <button onclick="toggleMobileCart()" class="relative -mt-10 w-16 h-16 bg-primary rounded-full shadow-lg shadow-primary/40 border-4 border-white flex items-center justify-center text-on-primary active:scale-95 transition-all">
                    <span class="material-symbols-outlined">shopping_basket</span>
                    <span class="absolute -top-1 -right-1 w-6 h-6 bg-error text-on-error text-[11px] font-bold flex items-center justify-center rounded-full border-2 border-white" id="cart-count-mobile-badge">${cartTotalItems}</span>
                </button>
                <button onclick="setView('orders')" class="nav-link ${state.view === 'orders' ? 'active' : ''}">
                    <span class="material-symbols-outlined">receipt_long</span>
                    <span class="font-bold tracking-wider mt-1 text-[10px]">รายการสั่ง</span>
                </button>
                <button onclick="setView('profile')" class="nav-link ${state.view === 'profile' ? 'active' : ''}">
                    <span class="material-symbols-outlined">person</span>
                    <span class="font-bold tracking-wider mt-1 text-[10px]">โปรไฟล์</span>
                </button>
            `;
        }
    }

    document.getElementById('cart-count-desktop').textContent = cartTotalItems;
    renderCart();

    main.innerHTML = '';
    switch (state.view) {
        case 'home': renderHome(main); break;
        case 'orders': renderOrders(main); break;
        case 'profile': renderProfile(main); break;
        case 'admin_products': renderAdminProducts(main); break;
        case 'admin_categories': renderAdminCategories(main); break;
        case 'admin_orders': renderAdminOrders(main); break;
        case 'admin_settings': renderAdminSettings(main); break;
        case 'admin_users': renderAdminUsers(main); break;
    }
}

async function renderAdminUsers(container) {
    showLoading(true);
    const search = (state.userAdminSearch || '').toLowerCase();
    const page = state.userAdminStats.page;
    const size = state.userAdminStats.pageSize;
    const start = (page - 1) * size;
    const end = start + size - 1;

    let query = supabaseClient.from('user_profiles').select('*', { count: 'exact' });

    if (search) {
        query = query.or(`displayName.ilike.%${search}%,phone.ilike.%${search}%,userId.ilike.%${search}%`);
    }

    const { data: users, count } = await query.order('created_at', { ascending: false }).range(start, end);
    state.userAdminStats.totalUsers = count || 0;
    const totalPages = Math.ceil(count / size) || 1;

    container.innerHTML = `
        <div class="animate-fade-in pb-20 px-4 sm:px-0">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                <div>
                     <h2 class="text-4xl font-black mb-2">จัดการสมาชิก</h2>
                     <p class="text-outline-variant font-medium">พบสมาชิกทั้งหมด ${count || 0} ราย</p>
                </div>
                <div class="relative w-full md:w-96 group">
                    <input type="text" placeholder="ค้นหาชื่อ, เบอร์โทร, User ID..." 
                           class="w-full bg-white border border-outline-variant/30 rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                           value="${state.userAdminSearch || ''}" onkeyup="searchAdminUser(this.value)">
                    <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline-variant group-focus-within:text-primary transition-colors">person_search</span>
                </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                ${(users || []).map(u => `
                    <div class="bg-white p-6 rounded-[2.5rem] shadow-sm border ${u.role === 'admin' ? 'border-primary/40 bg-primary/[0.01]' : 'border-outline-variant/10'} flex flex-col sm:flex-row sm:items-center justify-between group gap-6">
                        <div class="flex items-center gap-5">
                            <div class="relative flex-shrink-0">
                                <img src="${u.pictureUrl || 'https://via.placeholder.com/150'}" class="w-16 h-16 rounded-full border-2 ${u.role === 'admin' ? 'border-primary' : 'border-primary/20'} shadow-md">
                                <span class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${u.role === 'admin' ? 'bg-primary' : 'bg-outline-variant'} border-4 border-white"></span>
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <h4 class="font-black text-lg truncate text-on-surface">${u.displayName}</h4>
                                    ${u.role === 'admin' ? '<span class="bg-primary text-on-primary text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-widest">Admin</span>' : ''}
                                </div>
                                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                                     <span class="flex items-center gap-1 text-[11px] font-bold text-outline-variant"><span class="material-symbols-outlined text-[14px]">phone</span> ${u.phone || 'ไม่ระบุ'}</span>
                                     <span class="text-primary font-black text-xs">• ${u.points || 0} แต้ม</span>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-row sm:flex-col items-center sm:items-end gap-3 shrink-0 justify-between sm:justify-center border-t sm:border-t-0 pt-4 sm:pt-0 border-outline-variant/5">
                             <div class="flex flex-col items-end gap-1">
                                <span class="text-[9px] font-black text-primary uppercase tracking-widest mb-1 opacity-50">เติมแต้ม (+/-)</span>
                                <div class="flex items-center gap-1 group/pts bg-surface-container rounded-xl p-1 border border-primary/20">
                                    <input type="number" value="0" class="w-16 h-8 bg-transparent border-none text-right font-black text-primary p-0 pr-1 focus:ring-0" id="pts-${u.userId}" placeholder="0">
                                    <button onclick="addAdminPoints('${u.userId}')" class="w-8 h-8 rounded-lg bg-primary text-on-primary flex items-center justify-center shadow-sm hover:scale-110 active:scale-95 transition-all">
                                        <span class="material-symbols-outlined text-[16px] filled">add_task</span>
                                    </button>
                                </div>
                             </div>
                             <div class="flex items-center gap-2 scale-90">
                                <span class="text-[10px] font-black text-outline-variant mr-1">สิทธิ์แอดมิน</span>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" ${u.role === 'admin' ? 'checked' : ''} class="sr-only peer" onchange="toggleUserRole('${u.userId}', this.checked)">
                                    <div class="w-11 h-6 bg-surface-container rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                             </div>
                        </div>
                    </div>
                `).join('')}
            </div>

            ${totalPages > 1 ? `
            <div class="flex flex-row justify-center items-center gap-4 mt-12 pb-10">
                <button onclick="changeUserPage(${page - 1})" class="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all ${page === 1 ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined">chevron_left</span>
                </button>
                <div class="flex items-center gap-3 bg-white px-8 py-3 rounded-full shadow-sm border border-outline-variant/10">
                    <span class="text-xs font-black text-outline-variant uppercase tracking-widest">หน้า</span>
                    <span class="text-xl font-black text-primary">${page}</span>
                    <span class="text-xs font-black text-outline-variant uppercase tracking-widest">จาก ${totalPages}</span>
                </div>
                <button onclick="changeUserPage(${page + 1})" class="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all ${page >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined">chevron_right</span>
                </button>
            </div>
            ` : ''}
        </div>
    `;
    showLoading(false);
}

function changeUserPage(p) {
    state.userAdminStats.page = p;
    renderAdminUsers(document.getElementById('main-content'));
}

let searchDebounceTimer = null;

function searchAdminUser(val) {
    state.userAdminSearch = val;
    state.userAdminStats.page = 1;
    
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        renderAdminUsers(document.getElementById('main-content'));
    }, 500);
}

async function toggleUserRole(userId, isAdmin) {
    showLoading(true);
    const newRole = isAdmin ? 'admin' : 'user';
    const { error } = await supabaseClient.from('user_profiles').update({ role: newRole }).eq('userId', userId);
    if (!error) {
        toast(`อัปเดตสิทธิ์ของ ${userId.substring(0, 8)}... เป็น ${newRole}`);
        if (userId === state.user.userId) {
            state.isAdmin = isAdmin;
            state.user.role = newRole;
        }
    }
    renderAdminUsers(document.getElementById('main-content'));
}

async function adjustPoints(userId, amount) {
    showLoading(true);
    const { data: user } = await supabaseClient.from('user_profiles').select('points').eq('userId', userId).single();
    const newPoints = (user?.points || 0) + amount;
    const { error } = await supabaseClient.from('user_profiles').update({ points: newPoints }).eq('userId', userId);
    if (!error) {
        toast(`อัปเดตแต้มปัจจุบันเป็น ${newPoints} แต้ม`);
        if (state.user && userId === state.user.userId) state.user.points = newPoints;
    }
    renderAdminUsers(document.getElementById('main-content'));
    showLoading(false);
}

function renderHome(container) {
    const filteredProducts = state.products.filter(p => {
        const matchCategory = Number(state.currentCategory) === 0 || Number(p.category_id) === Number(state.currentCategory);
        const matchSearch = p.name.toLowerCase().includes(state.searchQuery.toLowerCase());
        return matchCategory && matchSearch;
    });

    container.innerHTML = `
        <div class="animate-fade-in">
            <h2 class="text-4xl font-black mb-12 tracking-tight">เปิดประสบการณ์ <br><span class="text-primary italic">อาหารสุดพิเศษ</span></h2>
            
            <div class="flex gap-4 mb-12 overflow-x-auto hide-scrollbar pb-2">
                <button onclick="changeCategory(0)" class="px-8 py-3 rounded-full ${Number(state.currentCategory) === 0 ? 'bg-primary text-on-primary' : 'bg-white'} font-bold shadow-sm transition-all whitespace-nowrap">ทั้งหมด</button>
                ${state.categories.map(c => `
                    <button onclick="changeCategory(${c.id})" class="px-8 py-3 rounded-full ${Number(state.currentCategory) === Number(c.id) ? 'bg-primary text-on-primary' : 'bg-white'} font-bold shadow-sm transition-all whitespace-nowrap flex items-center gap-2">
                        ${c.icon?.startsWith('http') ? `<img src="${c.icon}" class="w-5 h-5 object-cover rounded-md">` : (c.icon?.length <= 2 ? `<span class="text-xl">${c.icon}</span>` : `<span class="material-symbols-outlined text-[20px] ${Number(state.currentCategory) === Number(c.id) ? 'filled' : ''}">${c.icon || 'restaurant'}</span>`)}
                        ${c.name}
                    </button>
                `).join('')}
            </div>

            <div class="responsive-grid mb-12">
                ${filteredProducts.length ? filteredProducts.map(p => `
                    <div class="card p-8 flex flex-col pt-40 relative mt-24 group">
                        <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full shadow-2xl overflow-hidden group-hover:scale-105 transition-transform duration-500 bg-white p-1">
                             <div class="w-full h-full rounded-full overflow-hidden">
                                <img src="${p.image_url}" class="w-full h-full object-cover" loading="lazy">
                             </div>
                        </div>
                        <button onclick="shareProduct(${p.id})" class="absolute top-4 right-4 w-10 h-10 bg-white shadow-xl rounded-full flex items-center justify-center text-primary hover:scale-110 active:scale-95 transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 z-10 border border-primary/10">
                            <span class="material-symbols-outlined text-[20px]">share</span>
                        </button>
                        <div class="text-center flex-1 flex flex-col">
                            <h4 class="text-xl font-bold mb-2 group-hover:text-primary transition-colors">${p.name}</h4>
                            <p class="text-sm text-outline-variant mb-8 line-clamp-2 leading-relaxed">${p.description}</p>
                            <div class="mt-4 px-2 space-y-4">
                                <div class="flex items-center bg-surface-container-low rounded-2xl px-4 py-3 border border-outline-variant/5 focus-within:border-primary/30 transition-all group/note">
                                    <span class="material-symbols-outlined text-[18px] opacity-40 mr-2 group-focus-within/note:text-primary group-focus-within/note:opacity-100 transition-all">edit_note</span>
                                    <input type="text" id="note-${p.id}" placeholder="หมายเหตุ (เช่น หวานน้อย, ไม่ผัก...)" class="bg-transparent border-none outline-none text-[13px] w-full font-medium placeholder:text-outline-variant/50">
                                </div>
                                <div class="flex items-center justify-between pt-4 border-t border-outline-variant/10">
                                    <span class="text-2xl font-black text-primary">${p.price.toFixed(2)} บ.</span>
                                    <button onclick="addToCart(${p.id}, document.getElementById('note-${p.id}').value)" class="w-14 h-14 bg-primary-container rounded-full flex items-center justify-center text-on-primary-container shadow-[0_10px_20px_-5px_rgba(254,179,0,0.5)] active:scale-90 transition-all hover:bg-primary hover:text-on-primary">
                                        <span class="material-symbols-outlined font-black">shopping_basket</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('') : `<div class="col-span-full py-32 text-center opacity-30"><span class="material-symbols-outlined text-[64px]">search_off</span><p class="font-bold mt-4">ไม่พบรายการสำรับที่คุณค้นหา</p></div>`}
            </div>
        </div>
    `;
}


function renderCart() {
    const container = document.getElementById('cart-items-container');
    const summary = document.getElementById('cart-summary');

    if (state.cart.length === 0) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center opacity-40 py-20"><span class="material-symbols-outlined text-[64px] mb-4">shopping_cart</span><p class="font-bold">ตะกร้าของคุณยังว่างอยู่</p></div>`;
        summary.classList.add('hidden');
        return;
    }

    summary.classList.remove('hidden');
    container.innerHTML = state.cart.map(item => `
        <div class="flex gap-5 p-4 bg-white/40 rounded-[2rem] border border-outline-variant/10 group">
            <img src="${item.image_url}" class="w-20 h-20 rounded-2xl object-cover shadow-sm">
            <div class="flex-1 flex flex-col justify-center">
                <div class="flex justify-between items-start mb-1">
                    <div class="flex flex-col">
                        <span class="font-bold text-on-surface leading-tight">${item.name}</span>
                        ${item.note ? `<span class="text-[10px] text-primary font-bold italic mt-0.5">📝 ${item.note}</span>` : ''}
                    </div>
                    <span class="font-bold text-primary">${(item.price * item.quantity).toFixed(2)} บ.</span>
                </div>
                <div class="flex items-center gap-4 mt-3">
                    <div class="flex items-center bg-surface-container-low rounded-full px-3 py-1 gap-4">
                        <button onclick="updateQuantity(${item.id}, -1, '${item.note || ""}')" class="w-6 h-6 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-[16px]">remove</span></button>
                        <span class="font-black text-sm w-4 text-center">${item.quantity}</span>
                        <button onclick="updateQuantity(${item.id}, 1, '${item.note || ""}')" class="w-6 h-6 flex items-center justify-center hover:text-primary"><span class="material-symbols-outlined text-[16px]">add</span></button>
                    </div>
                    <button onclick="removeFromCart(${item.id}, '${item.note || ""}')" class="text-error/30 hover:text-error transition-colors"><span class="material-symbols-outlined text-[20px]">delete</span></button>
                </div>
            </div>
        </div>
    `).join('');

    const total = state.cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    document.getElementById('cart-total-desktop').textContent = `${total.toFixed(2)} บ.`;
}

function addToCart(pid, note = "") {
    const p = state.products.find(x => x.id === pid);
    const cartKey = `${pid}_${note}`;
    const existing = state.cart.find(x => `${x.id}_${x.note || ""}` === cartKey);
    
    if (existing) {
        existing.quantity++;
    } else {
        state.cart.push({ ...p, quantity: 1, note: note });
    }
    
    saveCart();
    renderUI();
    toast(`เพิ่ม ${p.name} ลงตะกร้าแล้ว`);
}

function updateQuantity(pid, delta, note = "") {
    const item = state.cart.find(x => `${x.id}_${x.note || ""}` === `${pid}_${note}`);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) removeFromCart(pid, note);
    saveCart();
    renderUI();
}

function removeFromCart(id, note = "") {
    state.cart = state.cart.filter(x => !(`${x.id}_${x.note || ""}` === `${id}_${note}`));
    saveCart();
    renderUI();
}

function saveCart() {
    localStorage.setItem('culinary_cart', JSON.stringify(state.cart));
}

async function shareProduct(pid) {
    if (!liff.isLoggedIn()) {
        liff.login();
        return;
    }

    if (!liff.isApiAvailable('shareTargetPicker')) {
        toast("คุณสมบัติการแชร์ไม่พร้อมใช้งานบนเบราว์เซอร์นี้");
        return;
    }

    const p = state.products.find(x => x.id === pid);
    const liffUrl = `https://liff.line.me/${LIFF_ID}`;

    const flexJson = {
        "type": "bubble",
        "size": "mega",
        "hero": {
            "type": "image",
            "url": p.image_url,
            "size": "full",
            "aspectRatio": "20:13",
            "aspectMode": "cover",
            "action": {
                "type": "uri",
                "uri": liffUrl
            }
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": p.name,
                    "weight": "bold",
                    "size": "xl",
                    "color": "#1a1a1a"
                },
                {
                    "type": "box",
                    "layout": "baseline",
                    "margin": "md",
                    "contents": [
                        {
                            "type": "text",
                            "text": `${p.price.toFixed(2)} บาท`,
                            "size": "xl",
                            "color": "#feb300",
                            "weight": "bold",
                            "flex": 0
                        },
                    ]
                },
                {
                    "type": "text",
                    "text": p.description,
                    "size": "sm",
                    "color": "#656565",
                    "wrap": true,
                    "margin": "lg",
                    "maxLines": 3
                }
            ]
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                {
                    "type": "button",
                    "style": "primary",
                    "height": "sm",
                    "color": "#feb300",
                    "action": {
                        "type": "uri",
                        "label": "ลิ้มลองเมนูนี้",
                        "uri": liffUrl
                    }
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {
                           "type": "text",
                           "text": "Culinary by iton5",
                           "size": "xs",
                           "color": "#aaaaaa",
                           "align": "center",
                           "margin": "md"
                        }
                    ],
                    "margin": "md"
                }
            ],
            "flex": 0
        },
        "styles": {
            "footer": {
                "separator": true
            }
        }
    };

    try {
        const result = await liff.shareTargetPicker([
            {
                "type": "flex",
                "altText": `ลองชิม ${p.name} ที่ Culinary by iton5 สิ!`,
                "contents": flexJson
            }
        ]);
        if (result) {
            toast("ส่งเมนูให้เพื่อนเรียบร้อย!");
        }
    } catch (error) {
        console.error(error);
        toast("การแชร์ล้มเหลว");
    }
}


async function submitOrder() {
    if (state.cart.length === 0) return;
    showLoading(true);
    try {
        const total = state.cart.reduce((s, i) => s + (i.price * i.quantity), 0);
        const { data: order, error } = await supabaseClient.from('orders').insert({
            user_id: state.user.userId,
            total_amount: total,
            status: 'pending',
            bank_account: `${state.settings.bank_name} ${state.settings.bank_account_no}`,
            promptpay_qr: state.settings.promptpay_id
        }).select().single();

        if (error) throw error;

        const orderItems = state.cart.map(i => ({
            order_id: order.id,
            product_id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            note: i.note || null
        }));

        const { error: itemsError } = await supabaseClient.from('order_items').insert(orderItems);
        if (itemsError) throw itemsError;

        state.cart = [];
        saveCart();
        toast("สั่งสินค้าเรียบร้อยแล้ว!");

        await notifyTelegram(`🔔 *รายการสั่งใหม่!*\nออเดอร์: #${order.id}\nลูกค้า: ${state.user.displayName}\nยอดรวม: ${total.toFixed(2)} บ.`);

        showPaymentModal(order);
        setView('orders');
    } catch (e) {
        console.error(e);
        toast("การสั่งซื้อล้มเหลว");
    } finally {
        showLoading(false);
    }
}

async function renderOrders(container) {
    showLoading(true);
    const { data: orders } = await supabaseClient.from('orders')
        .select('*, order_items(*)')
        .eq('user_id', state.user.userId)
        .order('created_at', { ascending: false });

    container.innerHTML = `
        <div class="animate-fade-in">
            <h2 class="text-3xl font-black mb-8">ประวัติการสั่งซื้อ</h2>
            <div class="space-y-6">
                ${orders?.length ? orders.map(ord => `
                    <div class="bg-white p-8 rounded-[2rem] shadow-sm border border-outline-variant/10">
                        <div class="flex justify-between items-start mb-6">
                            <div>
                                <h4 class="font-black text-xl mb-1">เลขที่ออเดอร์ #${ord.id}</h4>
                                <p class="text-xs text-outline-variant uppercase font-bold tracking-widest">${formatDate(ord.created_at)}</p>
                            </div>
                             <div class="flex flex-col items-end gap-1">
                                <span class="px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${ord.status === 'pending' ? 'bg-tertiary-container text-on-tertiary-container border-2 border-tertiary' :
            ord.status === 'paid' ? 'bg-primary/20 text-primary border-2 border-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)]' :
                ord.status === 'completed' ? 'bg-green-500/10 text-green-700 border-2 border-green-500' :
                    'bg-surface-container text-outline-variant border-2 border-outline-variant/20'
        }">
                                    <span class="w-2 h-2 rounded-full ${ord.status === 'pending' ? 'bg-tertiary animate-pulse' : ord.status === 'paid' ? 'bg-primary animate-pulse' : ord.status === 'completed' ? 'bg-green-500' : 'bg-current'}"></span>
                                    ${ord.status === 'pending' ? 'รอดำเนินการ' : ord.status === 'paid' ? 'ชำระเงินแล้ว' : ord.status === 'completed' ? 'ส่งเรียบร้อย' : 'ยกเลิก'}
                                </span>
                             </div>
                        </div>
                        <div class="space-y-3 mb-6">
                            ${ord.order_items.map(item => `
                                <div class="flex justify-between items-start text-sm">
                                    <div class="flex flex-col">
                                        <span class="text-on-surface-variant font-medium">${item.quantity}x ${item.name}</span>
                                        ${item.note ? `<span class="text-[10px] text-primary font-bold italic mt-0.5">📝 ${item.note}</span>` : ''}
                                    </div>
                                    <span class="font-bold">${(item.price * item.quantity).toFixed(2)} บ.</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="pt-6 border-t border-outline-variant/10 flex justify-between items-center">
                            <span class="text-lg font-black text-primary">ยอดสุทธิ: ${ord.total_amount.toFixed(2)} บ.</span>
                            ${ord.status === 'pending' ? `<button onclick='showPaymentModal(${JSON.stringify(ord)})' class="bg-primary text-on-primary px-6 py-2 rounded-full font-bold text-sm">ชำระเงิน</button>` : ''}
                        </div>
                    </div>
                `).join('') : `<div class="py-20 text-center opacity-30"><p class="font-bold text-lg">ยังไม่มีประวัติการสั่งซื้อ</p></div>`}
            </div>
        </div>
    `;
    showLoading(false);
}

function renderProfile(container) {
    container.innerHTML = `
        <div class="animate-fade-in max-w-2xl mx-auto py-12 px-6">
            <div class="bg-white p-12 rounded-[3.5rem] shadow-2xl shadow-primary/5 text-center border border-outline-variant/10 relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-32 bg-primary/5 -z-10"></div>
                
                <div class="relative w-40 h-40 mx-auto mb-8">
                    <div class="w-full h-full rounded-full p-2 border-4 border-white shadow-2xl">
                         <img src="${state.user.pictureUrl}" class="w-full h-full rounded-full object-cover">
                    </div>
                    <div class="absolute bottom-2 right-2 w-8 h-8 bg-white rounded-full flex items-center justify-center border shadow-lg">
                         <div class="w-4 h-4 bg-[#00c22d] rounded-full animate-pulse shadow-[0_0_10px_rgba(0,194,45,0.5)]"></div>
                    </div>
                </div>
                
                <h2 class="text-4xl font-black mb-1 text-on-surface">${state.user.displayName}</h2>
                <div class="flex items-center justify-center gap-2 mb-10">
                    <span class="w-2 h-2 rounded-full bg-[#00c22d]"></span>
                    <p class="text-outline-variant text-[10px] uppercase font-black tracking-[0.2em]">สมาชิกสำรับพรีเมียม</p>
                </div>
                
                <div class="bg-surface-container-low p-8 rounded-[2.5rem] mb-12 border border-outline-variant/5">
                    <p class="text-[11px] uppercase font-black text-primary tracking-widest mb-3">แต้มสะสมปัจจุบัน</p>
                    <div class="flex items-center justify-center gap-3">
                         <span class="material-symbols-outlined text-primary text-3xl filled">loyalty</span>
                         <h4 class="text-5xl font-black text-on-surface">${state.user.points}</h4>
                    </div>
                </div>

                <div class="space-y-6">
                    <button onclick="showRegisterModal(false)" class="w-full bg-primary/10 text-primary py-5 rounded-2xl font-black text-sm hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3">
                        <span class="material-symbols-outlined">edit_square</span>
                        แก้ไขข้อมูลโปรไฟล์
                    </button>
                    <button onclick="liff.logout(); window.location.reload();" class="w-full bg-[#fa3e3e] text-white py-5 rounded-2xl font-black text-sm shadow-xl shadow-error/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3">
                        <span class="material-symbols-outlined">logout</span>
                        ออกจากระบบ
                    </button>
                    <p class="text-[10px] text-outline-variant font-medium opacity-50">ขอบคุณที่เป็นส่วนหนึ่งของ Culinary by iton5</p>
                </div>
            </div>
        </div>
    `;
}

// --- ADMIN VIEWS ---
async function updateOrderStatus(orderId, newStatus) {
    showLoading(true);
    try {
        const { error } = await supabaseClient.from('orders').update({ status: newStatus }).eq('id', orderId);
        if (error) throw error;
        toast(`อัปเดตสถานะออเดอร์ #${orderId} แล้ว`);
        renderAdminOrders(document.getElementById('main-content'));
    } catch (e) {
        toast("เกิดข้อผิดพลาดในการอัปเดตสถานะ");
    } finally {
        showLoading(false);
    }
}

async function renderAdminProducts(container) {
    const { data: prods } = await supabaseClient.from('products').select('*, categories(name)').order('id');
    container.innerHTML = `
        <div class="animate-fade-in pb-20">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <h2 class="text-3xl font-black">จัดการเมนูอาหาร</h2>
                <button onclick="showProductEditModal()" class="w-full md:w-auto btn-primary py-3 px-8 flex items-center justify-center gap-2">
                    <span class="material-symbols-outlined text-[20px]">add</span> เพิ่มเมนูใหม่
                </button>
            </div>
            
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-8 px-4 sm:px-0">
                ${(prods || []).map(p => `
                    <div class="bg-white p-6 rounded-[3rem] shadow-sm border border-outline-variant/10 flex flex-col sm:flex-row gap-8 group hover:shadow-xl transition-all duration-500 overflow-hidden relative">
                        <!-- Product Info Overlay Controls -->
                        <div class="absolute right-6 top-6 flex flex-col gap-2 opacity-100 sm:translate-x-12 sm:opacity-0 sm:group-hover:translate-x-0 sm:group-hover:opacity-100 transition-all duration-300 z-20">
                            <button onclick="editProduct(${p.id})" class="w-12 h-12 bg-white rounded-full flex items-center justify-center text-primary shadow-xl border border-primary/20 hover:bg-primary hover:text-white hover:scale-110 active:scale-95 transition-all">
                                <span class="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button onclick="deleteProduct(${p.id})" class="w-12 h-12 bg-white rounded-full flex items-center justify-center text-error shadow-xl border border-error/20 hover:bg-error hover:text-white hover:scale-110 active:scale-95 transition-all">
                                <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>

                        <!-- Image Section -->
                        <div class="w-full sm:w-48 h-48 rounded-[2rem] overflow-hidden flex-shrink-0 relative">
                             <img src="${p.image_url}" class="w-full h-full object-cover group-hover:scale-110 transition-all duration-1000">
                        </div>

                        <!-- Content Section -->
                        <div class="flex-1 flex flex-col justify-center py-2">
                             <div class="flex items-center gap-3 mb-3">
                                 <span class="px-3 py-1 bg-surface-container rounded-full text-[10px] font-black uppercase text-primary tracking-widest">${p.categories?.name || 'ทั่วไป'}</span>
                                 ${p.is_available ? '<span class="px-3 py-1 bg-secondary/10 text-secondary rounded-full text-[10px] font-black uppercase tracking-widest">พร้อมเสิร์ฟ</span>' : '<span class="px-3 py-1 bg-error/10 text-error rounded-full text-[10px] font-black uppercase tracking-widest">สินค้าหมด</span>'}
                             </div>
                             <h4 class="text-2xl font-black mb-2 text-on-surface line-clamp-1">${p.name}</h4>
                             <p class="text-sm text-outline-variant mb-6 line-clamp-2 leading-relaxed">${p.description}</p>
                             <div class="mt-auto flex items-baseline gap-2">
                                 <span class="text-xs font-bold text-outline-variant">ราคาเริ่มต้นที่</span>
                                 <h5 class="text-3xl font-black text-primary">${p.price.toFixed(2)} บ.</h5>
                             </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${!(prods?.length) ? `<div class="py-32 text-center opacity-30"><p class="font-bold text-xl">ยังไม่มีข้อมูลสินค้า</p></div>` : ''}
        </div>
    `;
}

async function renderAdminCategories(container) {
    const { data: cats } = await supabaseClient.from('categories').select('*').order('id');
    container.innerHTML = `
        <div class="animate-fade-in">
            <div class="flex justify-between items-center mb-8">
                <h2 class="text-3xl font-black">จัดการหมวดหมู่</h2>
                <button onclick="addCategory()" class="btn-primary py-2 px-6 flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px]">add</span> เพิ่มหมวดหมู่
                </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-8">
                ${(cats || []).map(c => `
                     <div class="bg-white p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/10 flex items-center gap-6 group hover:shadow-xl transition-all duration-500">
                         <div class="w-16 h-16 bg-surface-container rounded-2xl overflow-hidden flex items-center justify-center text-primary flex-shrink-0 shadow-inner">
                            ${c.icon?.startsWith('http') ? `<img src="${c.icon}" class="w-full h-full object-cover">` : (c.icon?.length <= 2 ? `<span class="text-3xl">${c.icon}</span>` : `<span class="material-symbols-outlined filled text-3xl font-light">${c.icon || 'category'}</span>`)}
                         </div>
                         
                         <div class="flex-1 min-w-0">
                             <h4 class="font-black text-lg text-on-surface truncate pr-2" title="${c.name}">${c.name}</h4>
                             <p class="text-[10px] text-outline-variant font-black uppercase tracking-widest mt-1">หมวดหมู่</p>
                         </div>

                         <div class="flex flex-col gap-2 shrink-0">
                            <button onclick="editCategory(${c.id})" class="w-12 h-12 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-2xl transition-all flex items-center justify-center shadow-sm">
                                <span class="material-symbols-outlined text-[20px]">edit</span>
                            </button>
                            <button onclick="deleteCategory(${c.id})" class="w-12 h-12 bg-error/10 text-error hover:bg-error hover:text-white rounded-2xl transition-all flex items-center justify-center shadow-sm">
                                <span class="material-symbols-outlined text-[20px]">delete</span>
                            </button>
                         </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function renderAdminOrders(container) {
    showLoading(true);
    const page = state.adminStats.page;
    const size = state.adminStats.pageSize;
    const start = (page - 1) * size;
    const end = start + size - 1;

    const { data: ords, count } = await supabaseClient.from('orders')
        .select('*, user_profiles(displayName, pictureUrl), order_items(*)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(start, end);

    state.adminStats.totalOrders = count || 0;
    const totalPages = Math.ceil(count / size);

    container.innerHTML = `
        <div class="animate-fade-in">
            <h2 class="text-3xl font-black mb-8">แดชบอร์ดคำสั่งซื้อ</h2>
            <div class="space-y-6 mb-8">
                ${ords?.length ? ords.map(ord => `
                    <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-outline-variant/10">
                        <div class="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                            <div class="flex items-center gap-4">
                                <img src="${ord.user_profiles?.pictureUrl}" class="w-12 h-12 rounded-full border-2 border-primary/20">
                                <div>
                                    <h4 class="font-black text-xl mb-0.5">${ord.user_profiles?.displayName || 'ลูกค้าทั่วไป'}</h4>
                                    <p class="text-[10px] text-outline-variant uppercase font-black tracking-widest">ออเดอร์ #${ord.id} • ${formatDate(ord.created_at)}</p>
                                </div>
                            </div>
                             <div class="flex flex-col items-end gap-2">
                                <div class="flex items-center gap-2 mb-2">
                                    <span class="w-3 h-3 rounded-full ${ord.status === 'pending' ? 'bg-tertiary animate-pulse' : ord.status === 'paid' ? 'bg-primary animate-pulse' : ord.status === 'completed' ? 'bg-green-500' : 'bg-outline-variant'}"></span>
                                    <span class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">สถานะ: ${ord.status}</span>
                                </div>
                                <select onchange="updateOrderStatus(${ord.id}, this.value)" 
                                    class="bg-surface-container-low border-2 rounded-2xl py-3 px-6 font-black text-xs appearance-none focus:ring-2 focus:ring-primary/20 transition-all outline-none ${ord.status === 'pending' ? 'border-tertiary text-tertiary' : ord.status === 'paid' ? 'border-primary text-primary' : ord.status === 'completed' ? 'border-green-500 text-green-600' : 'border-outline-variant/30 text-outline-variant'
        }">
                                    <option value="pending" ${ord.status === 'pending' ? 'selected' : ''}>⏳ รอดำเนินการ</option>
                                    <option value="paid" ${ord.status === 'paid' ? 'selected' : ''}>💰 ชำระแล้ว</option>
                                    <option value="completed" ${ord.status === 'completed' ? 'selected' : ''}>✅ ส่งเรียบร้อย</option>
                                    <option value="cancelled" ${ord.status === 'cancelled' ? 'selected' : ''}>❌ ยกเลิก</option>
                                </select>
                             </div>
                        </div>
                        <div class="space-y-3 mb-8">
                            ${ord.order_items.map(i => `
                                <div class="flex justify-between text-sm border-b border-outline-variant/5 pb-2">
                                    <div class="flex flex-col">
                                        <span class="font-bold text-on-surface">${i.quantity}x ${i.name}</span>
                                        ${i.note ? `<span class="text-[11px] text-primary font-black bg-primary/5 px-2 py-1 rounded-lg mt-1 w-fit">หมายเหตุ: ${i.note}</span>` : ''}
                                    </div>
                                    <span class="font-black">${(i.price * i.quantity).toFixed(2)} บ.</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="flex flex-col sm:flex-row justify-between items-center gap-4 mt-8 pt-8 border-t border-outline-variant/10">
                            <div class="text-2xl font-black text-primary">
                                <span class="text-xs text-outline-variant uppercase mr-2 font-black">ยอดรวม</span><span>${ord.total_amount.toFixed(2)} บ.</span>
                            </div>
                            <button onclick='showPaymentModal(${JSON.stringify(ord)})' class="btn-primary py-3 px-8 flex items-center justify-center gap-2 w-full sm:w-auto shadow-lg shadow-primary/20">
                                <span class="material-symbols-outlined text-[20px]">qr_code_2</span> แสดง QR ให้ลูกค้าสแกน
                            </button>
                        </div>
                    </div>
                `).join('') : `<div class="py-32 text-center opacity-30"><p class="font-black text-xl">ยังไม่มีคำสั่งซื้อ</p></div>`}
            </div>
            <div class="flex flex-col sm:flex-row justify-center items-center gap-4 mt-12 mb-32">
                <button onclick="changePage(${page - 1})" class="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all ${page === 1 ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined">chevron_left</span>
                </button>
                <div class="flex items-center gap-3 bg-white px-8 py-3 rounded-full shadow-sm border border-outline-variant/10">
                    <span class="text-xs font-black text-outline-variant uppercase tracking-widest">หน้า</span>
                    <span class="text-xl font-black text-primary">${page}</span>
                    <span class="text-xs font-black text-outline-variant uppercase tracking-widest">จาก ${totalPages}</span>
                </div>
                <button onclick="changePage(${page + 1})" class="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all ${page >= totalPages ? 'opacity-30 pointer-events-none' : ''}">
                    <span class="material-symbols-outlined">chevron_right</span>
                </button>
            </div>
        </div>
    `;
    showLoading(false);
}

function renderAdminSettings(container) {
    container.innerHTML = `
        <div class="animate-fade-in">
            <h2 class="text-3xl font-black mb-8">ตั้งค่าระบบชำระเงิน</h2>
            <div class="bg-white p-12 rounded-[3rem] shadow-sm border border-outline-variant/10 max-w-2xl">
                <div class="space-y-8">
                    <div>
                        <label class="block text-xs font-black uppercase tracking-widest text-outline-variant mb-3">เบอร์พร้อมเพย์ที่ใช้งานอยู่</label>
                        <p class="text-2xl font-black text-primary">${state.settings.promptpay_id || '0123456789'}</p>
                    </div>
                    <div>
                        <label class="block text-xs font-black uppercase tracking-widest text-outline-variant mb-3">ธนาคารและเลขบัญชี</label>
                        <p class="text-lg font-bold">${state.settings.bank_name || 'ธนาคารกสิกรไทย'} - ${state.settings.bank_account_no || '123-4-56789-0'}</p>
                    </div>
                    <button onclick="showSettingsModal()" class="w-full btn-primary py-5">แก้ไขการตั้งค่า</button>
                </div>
            </div>
        </div>
    `;
}

// --- CRUD LOGIC ---
function showProductEditModal(id = null) {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').innerText = id ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่';
    document.getElementById('edit-type').value = 'product';
    document.getElementById('edit-id').value = id || '';

    const catSelect = document.getElementById('edit-category');
    catSelect.innerHTML = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.remove('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.remove('hidden');

    if (id) {
        const p = state.products.find(x => x.id === id);
        document.getElementById('edit-name').value = p.name;
        document.getElementById('edit-price').value = p.price;
        document.getElementById('edit-image').value = p.image_url;
        document.getElementById('edit-desc').value = p.description;
        catSelect.value = p.category_id;
        document.getElementById('edit-available').checked = p.is_available;
    } else {
        document.getElementById('edit-form').reset();
        document.getElementById('edit-available').checked = true;
    }

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}

function showSettingsModal() {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').innerText = 'ตั้งค่าข้อมูลการชำระเงิน';
    document.getElementById('edit-type').value = 'settings';

    document.getElementById('standard-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.remove('hidden');
    document.getElementById('image-field').classList.add('hidden');
    document.getElementById('desc-field').classList.add('hidden');

    document.getElementById('setting-promptpay').value = state.settings.promptpay_id || '';
    document.getElementById('setting-bank').value = state.settings.bank_name || '';
    document.getElementById('setting-acc').value = state.settings.bank_account_no || '';

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}

async function handleEditSubmit(e) {
    e.preventDefault();
    showLoading(true);
    const type = document.getElementById('edit-type').value;

    try {
        if (type === 'settings') {
            const pp = document.getElementById('setting-promptpay').value;
            const bank = document.getElementById('setting-bank').value;
            const acc = document.getElementById('setting-acc').value;

            const updates = [
                { key: 'promptpay_id', value: pp, description: 'เบอร์พร้อมเพย์หลัก' },
                { key: 'bank_name', value: bank, description: 'ชื่อธนาคาร' },
                { key: 'bank_account_no', value: acc, description: 'เลขบัญชีธนาคาร' }
            ];

            for (const item of updates) {
                await supabaseClient.from('system_settings').upsert(item);
            }

            if (state.settings.promptpay_id !== pp) {
                await notifyTelegram(`⚠️ *แจ้งเตือนการเปลี่ยนเลข PromptPay!*\nเปลี่ยนจาก: ${state.settings.promptpay_id}\nเป็น: ${pp}\nโดยแอดมิน: ${state.user.displayName}`);
            }

            await fetchSettings();
            closeEditModal();
            renderUI();
            toast("อัปเดตการตั้งค่าสำเร็จ");
        } else {

            const id = document.getElementById('edit-id').value;
            const name = document.getElementById('edit-name').value;
            const img_val = document.getElementById('edit-image').value;

            if (type === 'category') {
                const payload = { name, icon: img_val };
                if (id) {
                    await supabaseClient.from('categories').update(payload).eq('id', id);
                } else {
                    await supabaseClient.from('categories').insert(payload);
                }
                const { data: cats } = await supabaseClient.from('categories').select('*').order('id');
                state.categories = cats;
                renderAdminCategories(document.getElementById('main-content'));
            } else if (type === 'product') {
                const payload = {
                    name: name,
                    image_url: img_val,
                    price: parseFloat(document.getElementById('edit-price').value),
                    description: document.getElementById('edit-desc').value,
                    category_id: parseInt(document.getElementById('edit-category').value),
                    is_available: document.getElementById('edit-available').checked
                };
                if (id) {
                    const { error } = await supabaseClient.from('products').update(payload).eq('id', id);
                    if (error) throw error;
                } else {
                    const { error } = await supabaseClient.from('products').insert(payload);
                    if (error) throw error;
                }
                await fetchProducts();
                renderAdminProducts(document.getElementById('main-content'));
            }
            closeEditModal();
            toast("บันทึกข้อมูลเรียบร้อยแล้ว");
        }
    } catch (err) {
        console.error("Save error:", err);
        toast(`เกิดข้อผิดพลาด: ${err.message || 'ห้ามเว้นว่างข้อมูลที่จำเป็น'}`);
    } finally {
        showLoading(false);
    }
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// --- UTILS ---
function showLoading(show) {
    document.getElementById('global-loader').style.display = show ? 'flex' : 'none';
    if (show) setTimeout(() => document.getElementById('global-loader').style.opacity = '1', 10);
}

function toast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = "bg-on-surface text-surface py-4 px-10 rounded-[2rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] animate-fade-in font-black text-sm text-center min-w-[280px] border border-outline-variant/30 backdrop-blur-md pointer-events-auto";
    t.innerHTML = `
        <div class="flex items-center justify-center gap-3">
            <span class="material-symbols-outlined text-primary text-[20px] filled">notifications</span>
            <span>${msg}</span>
        </div>
    `;
    container.appendChild(t);
    setTimeout(() => {
        t.classList.add('animate-fade-out');
        setTimeout(() => t.remove(), 500);
    }, 4000);
}

function showPDPA(show) {
    const modal = document.getElementById('pdpa-modal');
    if (show) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('opacity-100'), 10);
    } else {
        modal.classList.remove('opacity-100');
        setTimeout(() => modal.classList.add('hidden'), 500);
    }
}

async function acceptPDPA() {
    await supabaseClient.from('user_profiles').update({ pdpa_consent: true }).eq('userId', state.user.userId);
    state.user.pdpa_consent = true;
    showPDPA(false);
}

function showPaymentModal(order) {
    const modal = document.getElementById('payment-modal');
    document.getElementById('pay-amount').textContent = `${order.total_amount.toFixed(2)} บ.`;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);

    // Generate Dynamic PromptPay QR via promptpay.io
    const qrContainer = document.getElementById('qr-container');
    const pp = (order.promptpay_qr || state.settings.promptpay_id || '0123456789').replace(/-/g, '').replace(/\s/g, '');
    const amount = order.total_amount.toFixed(2);

    qrContainer.innerHTML = `<img src="https://promptpay.io/${pp}/${amount}.png" 
                                 class="w-48 h-48 rounded-2xl shadow-inner border border-outline-variant/10 animate-fade-in" 
                                 alt="PromptPay QR Code">`;
}

function closePayment() {
    const modal = document.getElementById('payment-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function copyAccount() {
    const acc = document.getElementById('bank-acc').textContent;
    navigator.clipboard.writeText(acc);
    toast("คัดลอกเลขบัญชีแล้ว!");
}

function handleSearch(val) {
    state.searchQuery = val;
    
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        if (state.view === 'home') renderHome(document.getElementById('main-content'));
    }, 500);
}

async function notifyTelegram(msg) {
    try {
        await supabaseClient.functions.invoke('telegram-notify', { body: { message: msg } });
    } catch (e) { console.log(e); }
}

function initRealtime() {
    if (state.isAdmin) {
        supabaseClient.channel('orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
            toast("มีออเดอร์ใหม่หรือมีการอัปเดต!");
            if (state.view === 'admin_orders') renderAdminOrders(document.getElementById('main-content'));
        }).subscribe();
    }
}

async function editProduct(id) { showProductEditModal(id); }
async function deleteProduct(id) { if (confirm("ยืนยันการลบเมนูนี้?")) { await supabaseClient.from('products').delete().eq('id', id); await fetchProducts(); renderUI(); } }
function addCategory() {
    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-modal-title').innerText = 'เพิ่มหมวดหมู่';
    document.getElementById('edit-type').value = 'category';
    document.getElementById('edit-id').value = '';
    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('label-image').innerText = 'ไอคอน (Material Icon Name)';
    document.getElementById('desc-field').classList.add('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}
function changePage(p) { state.adminStats.page = p; renderAdminOrders(document.getElementById('main-content')); }
function changeCategory(id) { state.currentCategory = id; renderUI(); }

function toggleMobileCart() {
    const cart = document.getElementById('desktop-cart-panel');
    if (window.innerWidth < 1024) {
        if (cart.classList.contains('hidden')) {
            cart.classList.remove('hidden');
            cart.classList.add('fixed', 'inset-0', 'w-full', 'h-full', 'z-[1000]', 'mt-0');
            cart.style.top = '0';
            cart.style.height = '100dvh'; // Dynamic viewport height for mobile
        } else {
            cart.classList.add('hidden');
            cart.classList.remove('fixed', 'inset-0', 'w-full', 'h-full', 'z-[2000]', 'mt-0');
            cart.style.top = '';
            cart.style.height = '';
        }
    }
}


function renderCartExtras() {
    const container = document.getElementById('desktop-cart-panel');
    if (container && !container.querySelector('.mobile-cart-close')) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mobile-cart-close lg:hidden absolute top-6 right-6 w-10 h-10 bg-surface-container rounded-full flex items-center justify-center';
        closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
        closeBtn.onclick = toggleMobileCart;
        container.prepend(closeBtn);
    }
}

function addCategory() {
    state.currentEditItem = null;
    document.getElementById('edit-modal-title').textContent = 'เพิ่มหมวดหมู่ใหม่';
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-type').value = 'category';
    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.add('hidden');
    document.getElementById('label-name').textContent = 'ชื่อหมวดหมู่';
    document.getElementById('label-image').textContent = 'URL รูปภาพ หรือ ชื่อไอคอน (Material Symbols)';
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-image').value = 'category';
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}

function editCategory(cid) {
    const cat = state.categories.find(c => c.id === cid);
    if (!cat) return;
    state.currentEditItem = cat;
    document.getElementById('edit-modal-title').textContent = 'แก้ไขหมวดหมู่';
    document.getElementById('edit-id').value = cid;
    document.getElementById('edit-type').value = 'category';
    document.getElementById('standard-fields').classList.remove('hidden');
    document.getElementById('product-only-fields').classList.add('hidden');
    document.getElementById('settings-fields').classList.add('hidden');
    document.getElementById('image-field').classList.remove('hidden');
    document.getElementById('desc-field').classList.add('hidden');
    document.getElementById('label-name').textContent = 'ชื่อหมวดหมู่';
    document.getElementById('label-image').textContent = 'URL รูปภาพ หรือ ชื่อไอคอน (Material Symbols)';
    document.getElementById('edit-name').value = cat.name;
    document.getElementById('edit-image').value = cat.icon || 'category';
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}

async function deleteCategory(cid) {
    if (!confirm("ยืนยันการลบหมวดหมู่นี้? (สินค้าในหมวดหมู่จะไม่ถูกลบแต่จะไม่มีหมวดหมู่)")) return;
    showLoading(true);
    const { error } = await supabaseClient.from('categories').delete().eq('id', cid);
    if (!error) {
        toast("ลบหมวดหมู่เรียบร้อยแล้ว");
        await fetchCategories();
        renderAdminCategories(document.getElementById('main-content'));
    }
    showLoading(false);
}

async function addAdminPoints(userId) {
    const val = parseInt(document.getElementById(`pts-${userId}`).value) || 0;
    if (val === 0) return toast("กรุณาระบุแต้มที่ต้องการเพิ่ม");
    
    showLoading(true);
    try {
        const { data: user } = await supabaseClient.from('user_profiles').select('points').eq('userId', userId).single();
        const newVal = (user?.points || 0) + val;
        
        const { error } = await supabaseClient.from('user_profiles').update({ points: newVal }).eq('userId', userId);
        if (error) throw error;
        
        toast(`${val > 0 ? 'เพิ่ม' : 'ลด'}แต้มสำเร็จ! แต้มใหม่คือ ${newVal} แต้ม`);
        if (state.user && userId === state.user.userId) state.user.points = newVal;
    } catch (e) {
        toast("เกิดข้อผิดพลาดในการปรับแต้ม");
    } finally {
        renderAdminUsers(document.getElementById('main-content'));
        showLoading(false);
    }
}

function showRegisterModal(isFirstTime = true) {
    const modal = document.getElementById('register-modal');
    const title = document.getElementById('reg-modal-title');
    const desc = document.getElementById('reg-modal-desc');
    const cancelBtn = document.getElementById('reg-cancel-btn');

    if (isFirstTime) {
        title.textContent = 'ลงทะเบียนสมาชิก';
        desc.textContent = 'ยินดีต้อนรับ! กรุณากรอกข้อมูลเพื่อเริ่มใช้งาน';
        cancelBtn.classList.add('hidden');
    } else {
        title.textContent = 'แก้ไขโปรไฟล์';
        desc.textContent = 'อัปเดตข้อมูลส่วนตัวของคุณ';
        cancelBtn.classList.remove('hidden');
    }

    document.getElementById('reg-name').value = state.user.displayName || '';
    document.getElementById('reg-phone').value = state.user.phone || '';
    document.getElementById('reg-birthday').value = state.user.birthday || '';
    document.getElementById('reg-email').value = state.user.email || liff.getDecodedIDToken().email || '';

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('opacity-100'), 10);
}

function closeRegisterModal() {
    const modal = document.getElementById('register-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => modal.classList.add('hidden'), 500);
}

async function handleRegistration(e) {
    e.preventDefault();
    showLoading(true);
    try {
        const payload = {
            displayName: document.getElementById('reg-name').value,
            phone: document.getElementById('reg-phone').value,
            birthday: document.getElementById('reg-birthday').value,
            email: document.getElementById('reg-email').value
        };

        const { error } = await supabaseClient.from('user_profiles').update(payload).eq('userId', state.user.userId);
        if (error) throw error;

        state.user = { ...state.user, ...payload };
        toast("บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว");
        closeRegisterModal();
        renderUI();
    } catch (err) {
        console.error(err);
        toast("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
        showLoading(false);
    }
}


window.addEventListener('load', () => {
    initApp();
    renderCartExtras();
});
