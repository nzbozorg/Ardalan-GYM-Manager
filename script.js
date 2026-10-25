// === تنظیمات اولیه ===
let members = [];
let membersMap = new Map();
let currentMemberId = null;
let APP_VERSION = '1.3.0';
let currentReportData = { members: [], transactions: [] };
let currentGenderFilter = 'all';
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000/api' : '/api';
let isLoggedIn = false;
const persianDateFormatter = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
});
const persianDateShort = new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: '2-digit', day: '2-digit'
});
let rates = {
    single: 0, '12': 0, '16': 0, '20': 0, '26': 0,
    cardio: 0, plan: 0,
    'water-small': 0, 'water-large': 0,
    buffetItems: []
};

// === تنظیمات کش ===
const CACHE_KEY = 'members_cache';
const CACHE_TIME_KEY = 'members_cache_time';
const CACHE_TTL = 5 * 60 * 1000;
const RATES_CACHE_KEY = 'rates_cache';

// === توابع کش ===
function getCachedMembers() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        const cacheTime = localStorage.getItem(CACHE_TIME_KEY);
        if (cached && cacheTime && Date.now() - parseInt(cacheTime) < CACHE_TTL) {
            return JSON.parse(cached);
        }
    } catch (e) {}
    return null;
}

function setCachedMembers(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
    } catch (e) {}
}

function invalidateCache() {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIME_KEY);
}

function getCachedRates() {
    try {
        const cached = localStorage.getItem(RATES_CACHE_KEY);
        if (cached) return JSON.parse(cached);
    } catch (e) {}
    return null;
}

function setCachedRates(data) {
    try {
        localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
}

// ========================================
// ✅ توابع کمکی برای Reload هوشمند (بدون لود کل اعضا)
// ========================================

// فقط تراکنش‌ها و اطلاعات یک عضو را reload می‌کند
async function refreshMemberData(memberId) {
    const member = membersMap.get(memberId);
    if (!member) return;

    try {
        // ✅ ابتدا اطلاعات به‌روز عضو را بگیر (برای sessions و غیره)
        const memberResponse = await fetch(`${API_BASE}/members/${memberId}`);
        const memberResult = await memberResponse.json();

        // سپس تراکنش‌های این عضو رو بگیر
        const transResponse = await fetch(`${API_BASE}/members/${memberId}/transactions`);
        const transResult = await transResponse.json();

        if (memberResult.success && transResult.success) {
            // آپدیت اطلاعات پایه عضو
            const updatedMember = memberResult.data;
            member.sessions = updatedMember.sessions;
            member.debt = updatedMember.debt || 0;
            member.name = updatedMember.name;
            member.phone = updatedMember.phone;
            member.gender = updatedMember.gender;
            member.height = updatedMember.height;
            member.weight = updatedMember.weight;
            member.expire_at = updatedMember.expire_at || null;
            member.last_checkin = updatedMember.last_checkin || null;
            member.daysRemaining = updatedMember.daysRemaining;
            member.isExpired = updatedMember.isExpired;
            member.checkedInToday = updatedMember.checkedInToday || false;

            // آپدیت تراکنش‌ها
            member.transactions = transResult.data;
            member.debt = transResult.debt || member.debt;

            // اگر روی این عضو هستی، جزئیات را رندر کن
            if (currentMemberId === memberId) {
                renderHistory(member);
                updateMemberStats(member);
            }

            // فقط یک ردیف در جدول اصلی را آپدیت کن
            updateMemberRow(member);
        }
    } catch (err) {
        console.error('خطا در refreshMemberData:', err);
    }
}

// آپدیت stats نمایشی بدون reload کل صفحه
function updateMemberStats(member) {
    const detailDebt = document.getElementById('detail-debt');
    if (detailDebt) {
        detailDebt.innerText = (member.debt || 0).toLocaleString() + ' تومان';
        const debtBox = detailDebt.closest('.stat-box') || detailDebt.parentElement;
        debtBox.classList.remove('debt-box', 'income-box', 'transactions-box', 'sessions-box', 'warning', 'danger');
        if (member.debt > 0) {
            debtBox.classList.add('debt-box');
        }
    }

    const detailTotalPaid = document.getElementById('detail-total-paid');
    if (detailTotalPaid) {
        detailTotalPaid.innerText = getMemberTotalSpent(member).toLocaleString() + ' تومان';
        const paidBox = detailTotalPaid.closest('.stat-box') || detailTotalPaid.parentElement;
        paidBox.classList.remove('debt-box', 'income-box', 'transactions-box', 'sessions-box', 'warning', 'danger');
        paidBox.classList.add('income-box');
    }

    const detailTransCount = document.getElementById('detail-trans-count');
    if (detailTransCount) {
        const totalTrans = member.transactions
            ? member.transactions.filter(t => t.type !== 'checkin').length
            : 0;
        detailTransCount.innerText = totalTrans;
    }

    const detailSessions = document.getElementById('detail-sessions');
    if (detailSessions) {
        detailSessions.innerText = member.sessions >= 0 ? `${member.sessions} جلسه` : `${member.sessions}`;
        const sessionsBox = detailSessions.closest('.stat-box') || detailSessions.parentElement;
        sessionsBox.classList.remove('sessions-box', 'warning', 'danger', 'debt-box', 'income-box', 'transactions-box');
        sessionsBox.classList.add('sessions-box');
        if (member.sessions <= 0) {
            sessionsBox.classList.add('danger');
        } else if (member.sessions < 3) {
            sessionsBox.classList.add('warning');
        }
    }

    // --- شهریه: آپدیت لحظه‌ای بدون رفرش ---
    const subEl = document.getElementById('detail-subscription');
    const subSub = document.getElementById('detail-subscription-sub');
    const subBox = document.getElementById('subscription-box');
    if (subEl && subBox) {
        const days = member.expire_at ? getDaysRemainingClient(member.expire_at) : null;
        if (days === null) {
            subEl.innerText = 'بدون اشتراک';
            subEl.style.color = '#94a3b8';
            if(subSub) subSub.innerText = 'هنوز شهریه پرداخت نشده';
            subBox.style.background = '#f8fafc';
            subBox.style.border = '1px solid #e2e8f0';
        } else if (days === 0) {
            subEl.innerText = '⛔ منقضی شده';
            subEl.style.color = '#dc2626';
            if(subSub) subSub.innerText = 'شهریه تمام شده - جلسات باطل شد';
            subBox.style.background = '#fef2f2';
            subBox.style.border = '1px solid #fca5a5';
        } else if (days <= 5) {
            subEl.innerText = `${days} روز باقی‌مانده ⏳`;
            subEl.style.color = '#d97706';
            if(subSub) {
                const expDate = new Date(member.expire_at).toLocaleDateString('fa-IR');
                subSub.innerText = `تا ${expDate}`;
            }
            subBox.style.background = '#fffbeb';
            subBox.style.border = '1px solid #fde68a';
        } else {
            subEl.innerText = `${days} روز باقی‌مانده ✅`;
            subEl.style.color = '#16a34a';
            if(subSub) {
                const expDate = new Date(member.expire_at).toLocaleDateString('fa-IR');
                subSub.innerText = `تا ${expDate}`;
            }
            subBox.style.background = '#f0fdf4';
            subBox.style.border = '1px solid #86efac';
        }
    }
}

// فقط یک ردیف در جدول اصلی را آپدیت می‌کند
function updateMemberRow(member) {
    const tbody = document.getElementById('members-table-body');
    if (!tbody) return;

    const existingRow = tbody.querySelector(`tr[data-member-id="${member.id}"]`);
    if (!existingRow) return;

    // کلاس ردیف را آپدیت کن
    existingRow.className = '';
    if (member.sessions <= 0) existingRow.className = 'row-danger';
    else if (member.sessions < 3) existingRow.className = 'row-warning';

    // ستون جلسات را آپدیت کن
    const cells = existingRow.querySelectorAll('td');
    if (cells.length >= 4) {
        const sessionDisplay = member.sessions >= 0
            ? `<span class="badge sessions">${member.sessions} جلسه</span>`
            : `<span class="badge debt">${Math.abs(member.sessions)} جلسه</span>`;
        cells[3].innerHTML = sessionDisplay;
    }
}

// ========================================
// === راه‌اندازی اولیه ===
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    updateDate();
    setupKeyboardShortcuts();
    setupSidebarNavigation();
    setupGenderFilter();
    loadSavedSortPreferences();
    setupLoginForm();
    setupLogoutButton();
    setupChangePasswordForm();
    loadRates();
});

// === بررسی وضعیت لاگین ===
async function checkLoginStatus() {
    const session = sessionStorage.getItem('gym_session');
    if (session === 'active') {
        isLoggedIn = true;
        document.getElementById('login-view').classList.remove('active');
        document.getElementById('main-panel').classList.add('active');

        // صبر کن تا اعضا لود بشن
        await loadMembers();

        // ✅ بازیابی صفحه قبلی بعد از رفرش
        const savedView = sessionStorage.getItem('current_view');
        const savedMemberId = sessionStorage.getItem('current_member_id');

        if (savedView === 'view-member-detail' && savedMemberId) {
            const memberId = parseInt(savedMemberId);
            if (membersMap.has(memberId)) {
                openMemberDetail(memberId);
            } else {
                showView('view-dashboard', 'داشبورد', true);
            }
        } else if (savedView && savedView !== 'view-dashboard') {
            showView(savedView, '', true);
        } else {
            showView('view-dashboard', 'داشبورد', true);
        }
    } else {
        isLoggedIn = false;
        document.getElementById('login-view').classList.add('active');
        document.getElementById('main-panel').classList.remove('active');
    }
}

// === تنظیم فرم لاگین ===
function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            try {
                const response = await fetch(`${API_BASE}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const result = await response.json();
                if (result.success) {
                    isLoggedIn = true;
                    sessionStorage.setItem('gym_session', 'active');
                    document.getElementById('login-password').value = '';
                    errorEl.innerText = '';
                    document.getElementById('login-view').classList.remove('active');
                    document.getElementById('main-panel').classList.add('active');
                    await loadMembers();
                    showNotification('✅ ورود موفقیت‌آمیز بود', 'success');
                } else {
                    errorEl.innerText = '❌ رمز عبور اشتباه است';
                    showNotification('❌ رمز عبور اشتباه است', 'error');
                }
            } catch (err) {
                errorEl.innerText = '❌ خطا در اتصال به سرور';
                showNotification('❌ به سرور متصل نیست', 'error');
            }
        });
    }
}

// === تنظیم دکمه خروج ===
function setupLogoutButton() {
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('gym_session');
            sessionStorage.removeItem('current_view');
            sessionStorage.removeItem('current_member_id');
            isLoggedIn = false;
            document.getElementById('login-view').classList.add('active');
            document.getElementById('main-panel').classList.remove('active');
            document.getElementById('login-password').value = '';
            showNotification('✅ با موفقیت خارج شدید', 'info');
        });
    }
}

// === تنظیم فرم تغییر رمز ===
function setupChangePasswordForm() {
    const passwordForm = document.getElementById('change-password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            if (newPassword !== confirmPassword) {
                showNotification('❌ رمز عبور جدید و تکرار آن مطابقت ندارند', 'error');
                return;
            }
            if (newPassword.length < 4) {
                showNotification('❌ رمز عبور باید حداقل ۴ کاراکتر باشد', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword, newPassword })
                });
                const result = await response.json();
                if (result.success) {
                    showNotification('✅ رمز عبور با موفقیت تغییر کرد', 'success');
                    document.getElementById('current-password').value = '';
                    document.getElementById('new-password').value = '';
                    document.getElementById('confirm-password').value = '';
                    setTimeout(() => {
                        sessionStorage.removeItem('gym_session');
                        sessionStorage.removeItem('current_view');
                        sessionStorage.removeItem('current_member_id');
                        isLoggedIn = false;
                        document.getElementById('login-view').classList.add('active');
                        document.getElementById('main-panel').classList.remove('active');
                        showNotification('🔐 لطفاً با رمز جدید وارد شوید', 'info');
                    }, 2000);
                } else {
                    showNotification('❌ ' + (result.message || 'خطا در تغییر رمز'), 'error');
                }
            } catch (err) {
                showNotification('❌ خطا در اتصال به سرور', 'error');
            }
        });
    }
}

// === بارگذاری نرخ‌ها ===
async function loadRates() {
    const cached = getCachedRates();
    if (cached) {
        rates = cached;
        renderRatesPage();
    }
    try {
        const response = await fetch(`${API_BASE}/rates`);
        const result = await response.json();
        if (result.success) {
            rates = result.data;
            setCachedRates(rates);
            renderRatesPage();
        }
    } catch (err) {
        console.error('خطا در بارگذاری نرخ‌ها:', err);
    }
}

// === ذخیره نرخ ===
async function saveRate(type) {
    const value = document.getElementById(`rate-${type}`)?.value;
    if (!value || value <= 0) {
        showNotification('❌ مبلغ معتبر وارد کنید', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/rates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, value: parseInt(value) })
        });
        const result = await response.json();
        if (result.success) {
            rates[type] = parseInt(value);
            setCachedRates(rates);
            showNotification('✅ نرخ ذخیره شد', 'success');
            updateSessionPrices();
            updateBuffetPrices();
        } else {
            showNotification('❌ خطا در ذخیره نرخ', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

async function saveAllRates() {
    const status = document.getElementById('rates-save-status');
    const fields = ['single','12','16','20','26','cardio','plan','water-small','water-large'];
    const data = {};
    for (const f of fields) {
        const val = document.getElementById(`rate-${f}`)?.value;
        const num = parseInt(val);
        if (val === '' || isNaN(num) || num < 0) {
            showNotification(`❌ مبلغ ${f} نامعتبر است (نمی‌تواند منفی باشد)`, 'error');
            if(status) status.innerText = '❌ مقدار نامعتبر';
            return;
        }
        data[f] = num;
    }
    try {
        if(status) status.innerText = '⏳ در حال ذخیره...';
        const res = await fetch(`${API_BASE}/rates/bulk`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            // update local rates
            for (const [k,v] of Object.entries(data)) rates[k]=v;
            setCachedRates(rates);
            updateSessionPrices();
            updateBuffetPrices();
            if(status) status.innerText = '✅ همه نرخ‌ها ذخیره شد';
            showNotification('✅ همه نرخ‌ها ذخیره شد','success');
            setTimeout(()=>{if(status) status.innerText='';},2500);
        } else {
            if(status) status.innerText = '❌ خطا';
            showNotification('❌ '+(result.message||'خطا'),'error');
        }
    } catch(e){
        if(status) status.innerText = '❌ خطا در اتصال';
        showNotification('❌ خطا در اتصال','error');
    }
}

// === رندر صفحه نرخ‌ها ===
function renderRatesPage() {
    const rateFields = ['single', '12', '16', '20', '26', 'cardio', 'plan', 'water-small', 'water-large'];
    rateFields.forEach(field => {
        const input = document.getElementById(`rate-${field}`);
        if (input) input.value = rates[field] || '';
    });
    renderBuffetItems();
    updateSessionPrices();
    updateBuffetPrices();
}

// === رندر آیتم‌های بوفه ===
function renderBuffetItems() {
    const list = document.getElementById('buffet-items-list');
    const customOptions = document.getElementById('buffet-custom-options');
    if (!list || !customOptions) return;

    list.innerHTML = '';
    customOptions.innerHTML = '';

    if (rates.buffetItems && rates.buffetItems.length > 0) {
        rates.buffetItems.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'buffet-item-row';
            div.innerHTML = `
                <span>${item.name}</span>
                <span>${parseInt(item.price).toLocaleString()} تومان</span>
                <button class="btn-delete-buffet" onclick="deleteBuffetItem(${index})">🗑</button>
            `;
            list.appendChild(div);

            const btn = document.createElement('button');
            btn.className = 'buffet-option';
            btn.onclick = () => selectBuffetItem(`buffet-${index}`);
            btn.innerHTML = `
                <span class="option-icon">🍔</span>
                <span class="option-name">${item.name}</span>
                <span class="option-price">${parseInt(item.price).toLocaleString()} تومان</span>
            `;
            customOptions.appendChild(btn);
        });
    }
}

function showAddBuffetItem() {
    document.getElementById('add-buffet-item-modal').classList.add('active');
}

async function addBuffetItem() {
    const name = document.getElementById('new-buffet-item-name').value.trim();
    const price = document.getElementById('new-buffet-item-price').value.trim();
    if (!name || !price || price <= 0) {
        showNotification('❌ نام و مبلغ معتبر وارد کنید', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/rates/buffet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, price: parseInt(price) })
        });
        const result = await response.json();
        if (result.success) {
            rates.buffetItems.push({ name, price: parseInt(price) });
            setCachedRates(rates);
            showNotification('✅ آیتم اضافه شد', 'success');
            document.getElementById('new-buffet-item-name').value = '';
            document.getElementById('new-buffet-item-price').value = '';
            closeModal('add-buffet-item-modal');
            renderBuffetItems();
            updateBuffetPrices();
        } else {
            showNotification('❌ خطا در افزودن آیتم', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

async function deleteBuffetItem(index) {
    if (!confirm('آیا مطمئن هستید؟')) return;
    try {
        const response = await fetch(`${API_BASE}/rates/buffet/${index}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            rates.buffetItems.splice(index, 1);
            setCachedRates(rates);
            showNotification('✅ آیتم حذف شد', 'success');
            renderBuffetItems();
            updateBuffetPrices();
        } else {
            showNotification('❌ خطا در حذف آیتم', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

function updateSessionPrices() {
    const packages = ['single', '12', '16', '20', '26'];
    packages.forEach(pkg => {
        const el = document.getElementById(`session-price-${pkg}`);
        if (el) el.innerText = (rates[pkg] || 0).toLocaleString() + ' تومان';
    });
}

function updateBuffetPrices() {
    const waterSmall = document.getElementById('buffet-price-water-small');
    const waterLarge = document.getElementById('buffet-price-water-large');
    if (waterSmall) waterSmall.innerText = (rates['water-small'] || 0).toLocaleString() + ' تومان';
    if (waterLarge) waterLarge.innerText = (rates['water-large'] || 0).toLocaleString() + ' تومان';
}

function loadSavedSortPreferences() {
    const dashboardSort = localStorage.getItem('sort-dashboard');
    const reportMembersSort = localStorage.getItem('sort-report-members');
    const reportTransactionsSort = localStorage.getItem('sort-report-transactions');

    if (dashboardSort) {
        const sortSelect = document.getElementById('sort-members');
        if (sortSelect) sortSelect.value = dashboardSort;
    }
    if (reportMembersSort) {
        const sortSelect = document.getElementById('sort-report-members');
        if (sortSelect) sortSelect.value = reportMembersSort;
    }
    if (reportTransactionsSort) {
        const sortSelect = document.getElementById('sort-report-transactions');
        if (sortSelect) sortSelect.value = reportTransactionsSort;
    }
}

function saveSortPreference(type, value) {
    localStorage.setItem(`sort-${type}`, value);
}

function setupGenderFilter() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGenderFilter = btn.dataset.gender;
            renderDashboard();
        });
    });
}

function setupSidebarNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            let title = '';
            if (viewId === 'view-dashboard') title = 'داشبورد';
            else if (viewId === 'view-add-member') title = 'عضو جدید';
            else if (viewId === 'view-rates') {
                title = 'نرخ‌ها';
                loadRates();
            } else if (viewId === 'view-monthly-report') {
                title = 'گزارش ماهانه';
                showMonthlyReport();
                return;
            } else if (viewId === 'view-settings') {
                title = 'تنظیمات';
            }
            showView(viewId, title);
        });
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!isLoggedIn) return;

        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            showView('view-add-member', 'افزودن عضو');
        }
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            invalidateCache();
            loadMembers();
        }
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
        if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            showMonthlyReport();
        }
        if (e.key === 'Escape') {
            const activeModal = document.querySelector('.modal.active');
            const activeView = document.querySelector('.view.active');
            if (activeModal) {
                activeModal.classList.remove('active');
            } else if (activeView && activeView.id !== 'view-dashboard') {
                showView('view-dashboard', 'داشبورد');
            }
        }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            const form = e.target.closest('form');
            if (form && form.querySelector('button[type="submit"]')) {
                e.preventDefault();
                form.querySelector('button[type="submit"]').click();
            }
        }
    });
}

function updateDate() {
    const now = new Date();
    const weekday = now.toLocaleDateString('fa-IR', { weekday: 'long' });
    const year = now.toLocaleDateString('fa-IR', { year: 'numeric' });
    const month = now.toLocaleDateString('fa-IR', { month: 'long' });
    const day = now.toLocaleDateString('fa-IR', { day: 'numeric' });
    const el = document.getElementById('date-display');
    if (el) el.innerText = `${weekday}، ${day} ${month} ${year}`;
}

// === بارگذاری تراکنش‌های یک عضو ===
async function loadMemberTransactions(memberId) {
    try {
        const response = await fetch(`${API_BASE}/members/${memberId}/transactions`);
        const result = await response.json();
        if (result.success) {
            const member = membersMap.get(memberId);
            if (member) {
                member.transactions = result.data;
                member.debt = result.debt || 0;
            }
            return result.data;
        }
    } catch (err) {
        console.error('خطا در بارگذاری تراکنش‌ها:', err);
    }
    return [];
}

async function loadMembers() {
    const cached = getCachedMembers();
    if (cached && cached.length > 0) {
        members = cached;
        membersMap.clear();
        members.forEach(m => {
            // Ensure expire_at exists
            if (m.expire_at) m.expire_at = m.expire_at;
            membersMap.set(m.id, m);
        });
        renderDashboard();
        updateFileStatus('🟢 متصل (از کش)');
    } else {
        updateFileStatus('🟡 در حال اتصال به سرور...');
    }

    try {
        const response = await fetch(`${API_BASE}/members`);
        const result = await response.json();
        if (result.success) {
            members = result.data.map(m => ({ ...m, transactions: [] }));
            membersMap.clear();
            members.forEach(m => {
            // Ensure expire_at exists
            if (m.expire_at) m.expire_at = m.expire_at;
            membersMap.set(m.id, m);
        });
            setCachedMembers(members);
            updateFileStatus('🟢 متصل به سرور');
            renderDashboard();
        } else {
            throw new Error('خطا در دریافت داده');
        }
    } catch (err) {
        console.error('خطا در بارگذاری:', err);
        if (!cached) {
            updateFileStatus('🔴 قطع از سرور');
            showNotification('❌ به سرور متصل نیست. server.js را اجرا کنید.', 'error');
        }
    }
}

async function saveMember(member) {
    try {
        const response = await fetch(`${API_BASE}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(member)
        });
        const result = await response.json();
        if (result.success) invalidateCache();
        return result.success;
    } catch (err) {
        console.error('خطا در ذخیره:', err);
        return false;
    }
}

async function updateMember(id, data) {
    try {
        const response = await fetch(`${API_BASE}/members/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) invalidateCache();
        return result.success;
    } catch (err) {
        console.error('خطا در بروزرسانی:', err);
        return false;
    }
}

async function deleteMemberFromServer(id) {
    try {
        const response = await fetch(`${API_BASE}/members/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) invalidateCache();
        return result.success;
    } catch (err) {
        console.error('خطا در حذف:', err);
        return false;
    }
}

function updateFileStatus(text) {
    const statusEl = document.getElementById('file-status');
    if (statusEl) {
        statusEl.innerHTML = text;
        statusEl.className = 'file-status';
        if (text.includes('🟢')) statusEl.classList.add('connected');
        else if (text.includes('🔴')) statusEl.classList.add('disconnected');
        else statusEl.classList.add('connecting');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span class="notif-message">${message}</span>`;
    document.body.appendChild(notification);
    setTimeout(() => { notification.classList.add('show'); }, 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 3000);
    }, 3000);
}

function showView(viewId, title = '', isRestoring = false) {
    if (!isLoggedIn) return;

    // ✅ ذخیره صفحه فعلی در sessionStorage (برای بازیابی بعد از رفرش)
    if (!isRestoring) {
        sessionStorage.setItem('current_view', viewId);
        // اگر از صفحه جزئیات عضو خارج می‌شویم، عضو فعلی را پاک کن
        if (viewId !== 'view-member-detail') {
            sessionStorage.removeItem('current_member_id');
        }
    }

    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const viewEl = document.getElementById(viewId);
    if (viewEl) viewEl.classList.add('active');
    updateHeader(viewId, title);
    updateSidebarActive(viewId);

    if (viewId === 'view-dashboard') renderDashboard();
}

function updateSidebarActive(viewId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === viewId) item.classList.add('active');
    });
}

function updateHeader(viewId, title) {
    const headerTitle = document.getElementById('header-title');
    if (!headerTitle) return;
    if (title) {
        headerTitle.innerText = title;
    } else if (viewId === 'view-dashboard') headerTitle.innerText = 'داشبورد';
    else if (viewId === 'view-add-member') headerTitle.innerText = 'عضو جدید';
    else if (viewId === 'view-rates') headerTitle.innerText = 'نرخ‌ها';
    else if (viewId === 'view-member-detail') headerTitle.innerText = 'جزئیات عضو';
    else if (viewId === 'view-monthly-report') headerTitle.innerText = 'گزارش ماهانه';
    else if (viewId === 'view-member-report-detail') headerTitle.innerText = 'جزئیات گزارش';
    else if (viewId === 'view-settings') headerTitle.innerText = 'تنظیمات';
}

// === فرم افزودن عضو ===
document.getElementById('add-member-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-name').value.trim();
    const phone = document.getElementById('new-phone').value.trim();
    const gender = document.querySelector('input[name="gender"]:checked')?.value || 'male';
    const height = document.getElementById('new-height').value.trim();
    const weight = document.getElementById('new-weight').value.trim();

    if (!name) {
        showNotification('❌ نام عضو را وارد کنید', 'error');
        return;
    }
    if (!phone || !/^09\d{9}$/.test(phone)) {
        showNotification('❌ شماره تلفن معتبر وارد کنید (مثال: 09123456789)', 'error');
        return;
    }

    const exists = members.some(m => m.phone === phone);
    if (exists) {
        showNotification('❌ این شماره تلفن قبلاً ثبت شده است', 'error');
        return;
    }

    if (height) {
        const heightNum = parseInt(height);
        if (isNaN(heightNum) || heightNum < 0 || heightNum > 250) {
            showNotification('❌ قد باید بین 0 تا 250 سانتی‌متر باشد', 'error');
            return;
        }
    }
    if (weight) {
        const weightNum = parseInt(weight);
        if (isNaN(weightNum) || weightNum < 0 || weightNum > 250) {
            showNotification('❌ وزن باید بین 0 تا 250 کیلوگرم باشد', 'error');
            return;
        }
    }

    const newMember = {
        id: Date.now(),
        name, phone, gender,
        height: height || '-',
        weight: weight || '-',
        sessions: 0,
        createdAt: new Date().toISOString()
    };

    const success = await saveMember(newMember);
    if (success) {
        await loadMembers();
        document.getElementById('new-name').value = '';
        document.getElementById('new-phone').value = '';
        document.getElementById('new-height').value = '';
        document.getElementById('new-weight').value = '';
        const maleRadio = document.querySelector('input[name="gender"][value="male"]');
        if (maleRadio) maleRadio.checked = true;
        showNotification('✅ عضو با موفقیت اضافه شد', 'success');
        showView('view-dashboard', 'داشبورد');
    } else {
        showNotification('❌ خطا در ذخیره عضو', 'error');
    }
});

function getMemberTotalSpent(member) {
    if (!member.transactions) return 0;
    return member.transactions
        .filter(t => t.status === 'paid' && t.type !== 'checkin')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
}

function getMemberTotalSessions(member) {
    if (!member.transactions) return 0;
    return member.transactions.filter(t => t.type === 'checkin').length;
}

function getDaysRemainingClient(expire_at){
    if(!expire_at) return null;
    const diff = new Date(expire_at) - new Date();
    if(diff<=0) return 0;
    return Math.ceil(diff/(1000*60*60*24));
}
function getSubscriptionBadge(member){
    if(!member.expire_at) return '<span style="color:#94a3b8;font-size:11px">—</span>';
    const days = getDaysRemainingClient(member.expire_at);
    if(days===0) return '<span class="badge" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5">⏰ منقضی</span>';
    if(days<=5) return `<span class="badge" style="background:#fef9c3;color:#a16207;border:1px solid #fde047">${days} روز ⏳</span>`;
    return `<span class="badge" style="background:#dcfce7;color:#15803d;border:1px solid #86efac">${days} روز ✅</span>`;
}
function renderDashboard(filterText = '') {
    const tbody = document.getElementById('members-table-body');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();
    const sortType = document.getElementById('sort-members')?.value || 'newest';

    let filteredMembers = members.filter(m => {
        if (currentGenderFilter !== 'all' && m.gender !== currentGenderFilter) return false;
        return m.name.includes(filterText) || m.phone.includes(filterText);
    });

    filteredMembers.sort((a, b) => {
        switch (sortType) {
            case 'newest': return b.id - a.id;
            case 'oldest': return a.id - b.id;
            case 'name': return a.name.localeCompare(b.name, 'fa');
            case 'sessions': return (b.sessions || 0) - (a.sessions || 0);
            default: return 0;
        }
    });

    filteredMembers.forEach(member => {
        let rowClass = '';
        // Check expired subscription
        const daysRem = getDaysRemainingClient(member.expire_at);
        const isExpired = daysRem === 0;
        if (isExpired && member.sessions > 0) {
            // visually show as expired
            rowClass = 'row-danger';
        } else if (member.sessions <= 0) {
            rowClass = 'row-danger';
        } else if (member.sessions < 3) {
            rowClass = 'row-warning';
        }

        const row = document.createElement('tr');
        row.setAttribute('data-member-id', member.id);
        if (rowClass) row.className = rowClass;

        let sessionDisplay = member.sessions >= 0
            ? `<span class="badge sessions">${member.sessions} جلسه</span>`
            : `<span class="badge debt">${Math.abs(member.sessions)} جلسه</span>`;

        let genderBadge = member.gender === 'male'
            ? `<span class="gender-badge male">👨 آقا</span>`
            : `<span class="gender-badge female">👩 خانم</span>`;

        const subBadge = getSubscriptionBadge(member);
        const checkedInToday = member.checkedInToday === true;
        const canCheckin = (member.sessions > 0 && !isExpired && !checkedInToday);
        let checkinBtn;
        if (checkedInToday) {
            checkinBtn = `<span class="badge" style="background:#e2e8f0;color:#64748b;border:1px solid #cbd5e1;font-size:11px">✅ ثبت شد</span>`;
        } else if (canCheckin) {
            checkinBtn = `<button class="btn-checkin-row" onclick="quickCheckIn(${member.id}, event)" title="ثبت حضور سریع">✅ حضور</button>`;
        } else {
            checkinBtn = (member.sessions <=0 ? `<span style="color:#94a3b8;font-size:11px">—</span>` : (isExpired ? `<span class="badge" style="background:#fee2e2;color:#b91c1c;font-size:10px">منقضی</span>` : `<span style="color:#94a3b8;font-size:11px">—</span>`));
        }

        // Button on the right side of name (first column) - gray after click if no sessions
        const nameCell = `
            <div class="member-cell" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span class="member-name" onclick="openMemberDetail(${member.id})" style="cursor:pointer">${member.name}</span>
                <span onclick="event.stopPropagation()">${checkinBtn}</span>
            </div>`;
        row.innerHTML = `
            <td>${nameCell}</td>
            <td dir="ltr" class="phone-cell" onclick="openMemberDetail(${member.id})" style="cursor:pointer">${member.phone}</td>
            <td onclick="openMemberDetail(${member.id})" style="cursor:pointer">${genderBadge}</td>
            <td onclick="openMemberDetail(${member.id})" style="cursor:pointer">${sessionDisplay}</td>
            <td onclick="openMemberDetail(${member.id})" style="cursor:pointer">${subBadge}</td>
            <td onclick="openMemberDetail(${member.id})" style="cursor:pointer">${persianDateShort.format(new Date(member.createdAt))}</td>
            <td onclick="openMemberDetail(${member.id})" style="cursor:pointer;text-align:center;color:#94a3b8;font-size:11px">مشاهده 👁️</td>
        `;
        fragment.appendChild(row);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
    updateFilterCounts();
}

function updateFilterCounts() {
    const totalCount = members.length;
    const maleCount = members.filter(m => m.gender === 'male').length;
    const femaleCount = members.filter(m => m.gender === 'female').length;

    const countAll = document.getElementById('count-all');
    const countMale = document.getElementById('count-male');
    const countFemale = document.getElementById('count-female');

    if (countAll) countAll.innerText = `(${totalCount})`;
    if (countMale) countMale.innerText = `(${maleCount})`;
    if (countFemale) countFemale.innerText = `(${femaleCount})`;
}

function searchMembers() {
    const text = document.getElementById('search-input')?.value || '';
    renderDashboard(text);
}

// === جزئیات عضو ===
async function openMemberDetail(id) {
    currentMemberId = id;

    // ✅ ذخیره عضو فعلی در sessionStorage برای بازیابی بعد از رفرش
    sessionStorage.setItem('current_member_id', id);
    sessionStorage.setItem('current_view', 'view-member-detail');

    const member = membersMap.get(id);
    if (!member) return;

    const detailName = document.getElementById('detail-name');
    if (detailName) detailName.innerText = member.name;

    const detailPhone = document.getElementById('detail-phone');
    if (detailPhone) detailPhone.innerText = member.phone;

    const detailSessions = document.getElementById('detail-sessions');
    if (detailSessions) {
        detailSessions.innerText = member.sessions >= 0 ? `${member.sessions} جلسه` : `${member.sessions}`;
        const sessionsBox = detailSessions.closest('.stat-box') || detailSessions.parentElement;
        sessionsBox.classList.remove('sessions-box', 'warning', 'danger', 'debt-box', 'income-box', 'transactions-box');
        sessionsBox.classList.add('sessions-box');
        if (member.sessions <= 0) {
            sessionsBox.classList.add('danger');
        } else if (member.sessions < 3) {
            sessionsBox.classList.add('warning');
        }
    }

    const detailBodyInfo = document.getElementById('detail-body-info');
    if (detailBodyInfo) {
        detailBodyInfo.innerHTML = `قد: ${member.height} | وزن: ${member.weight} | جنسیت: ${member.gender === 'male' ? 'آقا' : 'خانم'}`;
    }

    // --- شهریه ماهانه: نمایش روزهای باقی‌مانده ---
    const subEl = document.getElementById('detail-subscription');
    const subSub = document.getElementById('detail-subscription-sub');
    const subBox = document.getElementById('subscription-box');
    if (subEl && subBox) {
        const days = member.expire_at ? getDaysRemainingClient(member.expire_at) : null;
        if (days === null) {
            subEl.innerText = 'بدون اشتراک';
            subEl.style.color = '#94a3b8';
            if(subSub) subSub.innerText = 'هنوز شهریه پرداخت نشده';
            subBox.style.background = '#f8fafc';
            subBox.style.border = '1px solid #e2e8f0';
        } else if (days === 0) {
            subEl.innerText = '⛔ منقضی شده';
            subEl.style.color = '#dc2626';
            if(subSub) subSub.innerText = 'شهریه تمام شده - جلسات باطل شد';
            subBox.style.background = '#fef2f2';
            subBox.style.border = '1px solid #fca5a5';
        } else if (days <= 5) {
            subEl.innerText = `${days} روز باقی‌مانده ⏳`;
            subEl.style.color = '#d97706';
            if(subSub) {
                const expDate = new Date(member.expire_at).toLocaleDateString('fa-IR');
                subSub.innerText = `تا ${expDate}`;
            }
            subBox.style.background = '#fffbeb';
            subBox.style.border = '1px solid #fde68a';
        } else {
            subEl.innerText = `${days} روز باقی‌مانده ✅`;
            subEl.style.color = '#16a34a';
            if(subSub) {
                const expDate = new Date(member.expire_at).toLocaleDateString('fa-IR');
                subSub.innerText = `تا ${expDate}`;
            }
            subBox.style.background = '#f0fdf4';
            subBox.style.border = '1px solid #86efac';
        }
    }

    const historyList = document.getElementById('transaction-history');
    if (historyList) {
        historyList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-light)">⏳ در حال بارگذاری تاریخچه...</div>';
    }

    showView('view-member-detail', member.name);

    if (!member.transactions || member.transactions.length === 0) {
        await loadMemberTransactions(id);
    }

    const debt = member.transactions
        ? member.transactions.filter(t => t.status === 'pending').reduce((sum, t) => sum + (t.amount || 0), 0)
        : 0;

    const detailDebt = document.getElementById('detail-debt');
    if (detailDebt) {
        detailDebt.innerText = debt.toLocaleString() + ' تومان';
        const debtBox = detailDebt.closest('.stat-box') || detailDebt.parentElement;
        debtBox.classList.remove('debt-box', 'income-box', 'transactions-box', 'sessions-box', 'warning', 'danger');
        if (debt > 0) {
            debtBox.classList.add('debt-box');
        }
    }

    const totalPaid = getMemberTotalSpent(member);
    const detailTotalPaid = document.getElementById('detail-total-paid');
    if (detailTotalPaid) {
        detailTotalPaid.innerText = totalPaid.toLocaleString() + ' تومان';
        const paidBox = detailTotalPaid.closest('.stat-box') || detailTotalPaid.parentElement;
        paidBox.classList.remove('debt-box', 'income-box', 'transactions-box', 'sessions-box', 'warning', 'danger');
        paidBox.classList.add('income-box');
    }

    const totalTrans = member.transactions
        ? member.transactions.filter(t => t.type !== 'checkin').length
        : 0;

    const detailTransCount = document.getElementById('detail-trans-count');
    if (detailTransCount) {
        detailTransCount.innerText = totalTrans;
        const transBox = detailTransCount.closest('.stat-box') || detailTransCount.parentElement;
        transBox.classList.remove('debt-box', 'income-box', 'transactions-box', 'sessions-box', 'warning', 'danger');
        transBox.classList.add('transactions-box');
    }

    renderHistory(member);
}

// === تاریخچه تراکنش‌ها ===
function renderHistory(member) {
    const historyList = document.getElementById('transaction-history');
    if (!historyList) return;

    historyList.innerHTML = '';

    if (!member.transactions || member.transactions.length === 0) {
        historyList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-light)">هیچ تاریخچه‌ای وجود ندارد</div>';
        return;
    }

    const recentTransactions = [...member.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    recentTransactions.forEach(t => {
        const div = document.createElement('div');
        const isPending = t.status === 'pending';
        const isCheckin = t.type === 'checkin';
        div.className = `history-item type-${t.type} ${isPending ? 'pending' : 'paid'}`;
        const date = persianDateFormatter.format(new Date(t.date));

        let desc = '', amountClass = '';
        switch (t.type) {
            case 'water-small': desc = 'آب کوچک'; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
            case 'water-large': desc = 'آب بزرگ'; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
            case 'buffet': desc = `بوفه: ${t.itemName || 'آیتم'}`; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
            case 'session': desc = `خرید ${t.count || 1} جلسه`; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
            case 'payment': desc = `پرداخت وجه ${t.purpose ? '(' + t.purpose + ')' : ''}`; amountClass = 'color: var(--success)'; break;
            case 'checkin': desc = 'ثبت حضور'; break;
            case 'cardio': desc = 'هوازی'; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
            case 'plan': desc = 'برنامه تمرینی و غذایی'; amountClass = isPending ? 'color: var(--danger)' : 'color: var(--success)'; break;
        }

        const statusBadge = isPending
            ? '<span class="status-badge pending">⏳ در انتظار پرداخت</span>'
            : (isCheckin ? '' : '<span class="status-badge paid">✅ پرداخت شده</span>');

        let amountDisplay = '';
        if (!isCheckin) {
            amountDisplay = `<span class="history-amount" style="${amountClass}">${(t.amount || 0).toLocaleString()} تومان</span>`;
        }

        let confirmBtn = '';
        if (isPending) {
            confirmBtn = `
                <button class="btn-confirm-transaction" onclick="confirmTransaction(${t.id}, ${member.id})"
                    style="background:#dcfce7; color:var(--success); border:1px solid var(--success);
                           padding:0.4rem 0.8rem; border-radius:8px; cursor:pointer; font-size:0.85rem;
                           transition:all 0.2s; font-weight:600;"
                    onmouseover="this.style.background='var(--success)'; this.style.color='white';"
                    onmouseout="this.style.background='#dcfce7'; this.style.color='var(--success)';">
                    ✅ تایید
                </button>
            `;
        }

        const actionButtons = `
            <div class="history-actions" style="display:flex; align-items:center; gap:0.5rem;">
                ${amountDisplay}
                ${confirmBtn}
                <button class="btn-delete-transaction" onclick="deleteTransaction(${t.id}, ${member.id})"
                    style="background:#fee2e2; color:var(--danger); border:1px solid var(--danger);
                           padding:0.4rem 0.8rem; border-radius:8px; cursor:pointer; font-size:0.85rem;
                           transition:all 0.2s; font-weight:600;"
                    onmouseover="this.style.background='var(--danger)'; this.style.color='white';"
                    onmouseout="this.style.background='#fee2e2'; this.style.color='var(--danger)';">
                    🗑 حذف
                </button>
            </div>
        `;

        div.innerHTML = `
            <div class="history-content">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="history-desc">${desc}</span>
                    ${statusBadge}
                </div>
                <span class="history-date">${date}</span>
            </div>
            ${actionButtons}
        `;
        historyList.appendChild(div);
    });
}

// === تایید تراکنش (✅ با refreshMemberData) ===
async function confirmTransaction(transactionId, memberId) {
    if (!confirm('✅ آیا از تایید پرداخت این تراکنش مطمئن هستید؟\n\nپس از تایید، مبلغ به کل پرداختی‌ها اضافه می‌شود.')) return;

    try {
        const response = await fetch(`${API_BASE}/transactions/${transactionId}/confirm`, { method: 'PUT' });
        const result = await response.json();
        if (result.success) {
            showNotification('✅ تراکنش تایید شد و به کل پرداختی‌ها اضافه شد', 'success');
            // ✅ فقط این عضو را reload کن
            await refreshMemberData(memberId);
        } else {
            showNotification('❌ ' + (result.message || 'خطا در تایید تراکنش'), 'error');
        }
    } catch (err) {
        console.error('خطا در تایید تراکنش:', err);
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

// === حذف تراکنش (✅ با refreshMemberData) ===
async function deleteTransaction(transactionId, memberId) {
    if (!confirm('⚠️ آیا از حذف این تراکنش مطمئن هستید؟')) return;

    try {
        const response = await fetch(`${API_BASE}/transactions/${transactionId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) {
            showNotification('✅ تراکنش با موفقیت حذف شد', 'success');
            // ✅ فقط این عضو را reload کن
            await refreshMemberData(memberId);
        } else {
            showNotification('❌ ' + (result.message || 'خطا در حذف تراکنش'), 'error');
        }
    } catch (err) {
        console.error('خطا در حذف تراکنش:', err);
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

// === ویرایش اطلاعات عضو ===
function showEditMemberModal() {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    document.getElementById('edit-member-id').value = member.id;
    document.getElementById('edit-name').value = member.name;
    document.getElementById('edit-phone').value = member.phone;
    document.getElementById('edit-height').value = member.height === '-' ? '' : member.height;
    document.getElementById('edit-weight').value = member.weight === '-' ? '' : member.weight;
    document.getElementById('edit-sessions').value = member.sessions;
    // Calculate days remaining for edit
    const days = member.expire_at ? getDaysRemainingClient(member.expire_at) : '';
    document.getElementById('edit-expire-days').value = days !== null && days !== '' ? days : '';

    const genderRadio = document.querySelector(`input[name="edit-gender"][value="${member.gender}"]`);
    if (genderRadio) genderRadio.checked = true;

    document.getElementById('edit-member-modal').classList.add('active');
}

async function saveEditedMember() {
    const id = parseInt(document.getElementById('edit-member-id').value);
    const name = document.getElementById('edit-name').value.trim();
    const phone = document.getElementById('edit-phone').value.trim();
    const gender = document.querySelector('input[name="edit-gender"]:checked')?.value || 'male';
    const height = document.getElementById('edit-height').value.trim();
    const weight = document.getElementById('edit-weight').value.trim();

    if (!name) {
        showNotification('❌ نام عضو را وارد کنید', 'error');
        return;
    }
    if (!phone || !/^09\d{9}$/.test(phone)) {
        showNotification('❌ شماره تلفن معتبر وارد کنید', 'error');
        return;
    }

    const exists = members.some(m => m.phone === phone && m.id !== id);
    if (exists) {
        showNotification('❌ این شماره تلفن قبلاً برای عضو دیگری ثبت شده است', 'error');
        return;
    }

    if (height) {
        const heightNum = parseInt(height);
        if (isNaN(heightNum) || heightNum < 0 || heightNum > 250) {
            showNotification('❌ قد باید بین 0 تا 250 سانتی‌متر باشد', 'error');
            return;
        }
    }
    if (weight) {
        const weightNum = parseInt(weight);
        if (isNaN(weightNum) || weightNum < 0 || weightNum > 250) {
            showNotification('❌ وزن باید بین 0 تا 250 کیلوگرم باشد', 'error');
            return;
        }
    }

    const currentMember = membersMap.get(id);
    if (!currentMember) {
        showNotification('❌ عضو یافت نشد', 'error');
        return;
    }

    // Validate sessions
    const editSessionsVal = document.getElementById('edit-sessions').value.trim();
    let newSessions = currentMember.sessions;
    if (editSessionsVal !== '') {
        const sNum = parseInt(editSessionsVal);
        if (isNaN(sNum) || sNum < 0) {
            showNotification('❌ تعداد جلسات نمی‌تواند منفی باشد', 'error');
            return;
        }
        newSessions = sNum;
    }
    // Validate expire days
    const editDaysVal = document.getElementById('edit-expire-days').value.trim();
    let newExpireAt = currentMember.expire_at || null;
    if (editDaysVal !== '') {
        const dNum = parseInt(editDaysVal);
        if (isNaN(dNum) || dNum < 0) {
            showNotification('❌ روزهای باقی‌مانده نمی‌تواند منفی باشد', 'error');
            return;
        }
        if (dNum === 0) {
            // Expire now - create past date
            newExpireAt = new Date(Date.now() - 1000).toISOString();
        } else {
            const nd = new Date();
            nd.setDate(nd.getDate() + dNum);
            newExpireAt = nd.toISOString();
        }
    } else if (editDaysVal === '' && !currentMember.expire_at) {
        newExpireAt = null;
    }

    const updatedData = {
        name, phone, gender,
        height: height || '-',
        weight: weight || '-',
        sessions: newSessions,
        debt: currentMember.debt || 0,
        expire_at: newExpireAt
    };

    try {
        const success = await updateMember(id, updatedData);
        if (success) {
            showNotification('✅ اطلاعات عضو با موفقیت بروزرسانی شد', 'success');
            closeModal('edit-member-modal');

            // آپدیت اطلاعات در membersMap
            currentMember.name = name;
            currentMember.phone = phone;
            currentMember.gender = gender;
            currentMember.height = height || '-';
            currentMember.weight = weight || '-';
            currentMember.sessions = newSessions;
            currentMember.expire_at = newExpireAt;

            // آپدیت ردیف و جزئیات
            updateMemberRow(currentMember);
            if (currentMemberId === id) {
                openMemberDetail(id);
            }
        } else {
            showNotification('❌ خطا در بروزرسانی اطلاعات', 'error');
        }
    } catch (err) {
        console.error('خطا در بروزرسانی:', err);
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

function showBuffetModal() {
    updateBuffetPrices();
    document.getElementById('buffet-modal').classList.add('active');
}

function showSessionModal() {
    updateSessionPrices();
    document.getElementById('session-modal').classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// === انتخاب آیتم بوفه (✅ با refreshMemberData) ===
async function selectBuffetItem(itemType) {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    let amount = 0, itemName = '', transType = itemType;
    if (itemType === 'water-small') {
        amount = rates['water-small'] || 0;
        itemName = 'آب کوچک';
    } else if (itemType === 'water-large') {
        amount = rates['water-large'] || 0;
        itemName = 'آب بزرگ';
    } else if (itemType.startsWith('buffet-')) {
        const index = parseInt(itemType.split('-')[1]);
        const item = rates.buffetItems[index];
        if (item) {
            amount = item.price;
            itemName = item.name;
            transType = 'buffet';
        }
    }

    if (amount <= 0) {
        showNotification('❌ نرخ این آیتم تنظیم نشده است', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                member_id: member.id,
                type: transType,
                amount: amount,
                itemName: itemName,
                date: new Date().toISOString(),
                status: 'pending'
            })
        });
        const result = await response.json();
        if (result.success) {
            showNotification(`✅ ${itemName} به عنوان بدهی ثبت شد`, 'success');
            closeModal('buffet-modal');
            // ✅ فقط این عضو را reload کن
            await refreshMemberData(currentMemberId);
        } else {
            showNotification('❌ خطا در ذخیره تراکنش', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

// === انتخاب پکیج جلسه (✅ با refreshMemberData) ===
async function selectSessionPackage(packageType) {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    const sessionCounts = { 'single': 1, '12': 12, '16': 16, '20': 20, '26': 26 };
    const count = sessionCounts[packageType] || 1;
    const amount = rates[packageType] || 0;

    if (amount <= 0) {
        showNotification('❌ نرخ این پکیج تنظیم نشده است', 'error');
        return;
    }

    try {
        const transResponse = await fetch(`${API_BASE}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                member_id: member.id,
                type: 'session',
                amount: amount,
                count: count,
                date: new Date().toISOString(),
                status: 'pending'
            })
        });
        const transResult = await transResponse.json();
        if (transResult.success) {
            showNotification(`✅ ${count} جلسه به عنوان بدهی ثبت شد`, 'success');
            closeModal('session-modal');
            // ✅ فقط این عضو را reload کن
            await refreshMemberData(currentMemberId);
        } else {
            showNotification('❌ خطا در ذخیره', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

// === افزودن خدمت (✅ با refreshMemberData) ===
async function addService(serviceType) {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    const rates_map = {
        'cardio': rates.cardio || 0,
        'plan': rates.plan || 0
    };
    const amount = rates_map[serviceType];
    if (amount <= 0) {
        showNotification('❌ نرخ این خدمت تنظیم نشده است', 'error');
        return;
    }

    const names = { 'cardio': 'هوازی', 'plan': 'برنامه تمرینی و غذایی' };

    try {
        const response = await fetch(`${API_BASE}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                member_id: member.id,
                type: serviceType,
                amount: amount,
                date: new Date().toISOString(),
                status: 'pending'
            })
        });
        const result = await response.json();
        if (result.success) {
            showNotification(`✅ ${names[serviceType]} به عنوان بدهی ثبت شد`, 'success');
            // ✅ فقط این عضو را reload کن
            await refreshMemberData(currentMemberId);
        } else {
            showNotification('❌ خطا در ذخیره تراکنش', 'error');
        }
    } catch (err) {
        showNotification('❌ خطا در اتصال به سرور', 'error');
    }
}

// === ثبت حضور (✅ با refreshMemberData) ===
async function checkInMember() {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    if (!member.transactions || member.transactions.length === 0) {
        await loadMemberTransactions(member.id);
    }

    const today = new Date().toISOString().split('T')[0];
    const alreadyCheckedIn = member.transactions.some(t => {
        const tDate = t.date.split('T')[0];
        return t.type === 'checkin' && tDate === today;
    });

    if (alreadyCheckedIn) {
        showNotification('⚠️ این عضو امروز قبلاً حضور ثبت کرده است!', 'warning');
        return;
    }

    if (member.sessions > 0) {
        try {
            const transResponse = await fetch(`${API_BASE}/transactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    member_id: member.id,
                    type: 'checkin',
                    amount: 0,
                    date: new Date().toISOString(),
                    status: 'paid'
                })
            });

            const updateResponse = await fetch(`${API_BASE}/members/${member.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: member.name,
                    phone: member.phone,
                    gender: member.gender,
                    height: member.height,
                    weight: member.weight,
                    sessions: member.sessions - 1,
                    debt: member.debt
                })
            });

            const transResult = await transResponse.json();
            const updateResult = await updateResponse.json();

            if (transResult.success && updateResult.success) {
                // آپدیت محلی
                member.sessions = member.sessions - 1;
                showNotification('✅ حضور ثبت شد. یک جلسه کسر شد.', 'success');
                // ✅ فقط این عضو را reload کن
                await refreshMemberData(currentMemberId);
            } else {
                showNotification('❌ خطا در ذخیره', 'error');
            }
        } catch (err) {
            showNotification('❌ خطا در اتصال به سرور', 'error');
        }
    } else {
        showNotification('⚠️ عضو جلسه ندارد.', 'warning');
    }
}

async function quickCheckIn(memberId, event) {
    if(event) event.stopPropagation();
    const member = membersMap.get(memberId);
    if (!member) return;
    
    // Prevent double click
    const btn = event ? event.target : null;
    if(btn) { btn.disabled = true; btn.innerText = '⏳'; }
    
    try {
        if (!member.transactions || member.transactions.length === 0) {
            await loadMemberTransactions(member.id);
        }
        const today = new Date().toISOString().split('T')[0];
        const alreadyCheckedIn = member.transactions.some(t => {
            const tDate = t.date.split('T')[0];
            return t.type === 'checkin' && tDate === today;
        });
        if (alreadyCheckedIn) {
            showNotification('⚠️ این عضو امروز قبلاً حضور ثبت کرده!', 'warning');
            if(btn) { btn.disabled=false; btn.innerText='✅ حضور'; }
            return;
        }
        // Check expiry
        const daysRem = getDaysRemainingClient(member.expire_at);
        if (daysRem === 0) {
            showNotification('⏰ شهریه این عضو منقضی شده! اول شهریه را تمدید کنید.', 'warning');
            if(btn) { btn.disabled=false; btn.innerText='✅ حضور'; }
            return;
        }
        if (member.sessions <= 0) {
            showNotification('⚠️ جلسه ندارد', 'warning');
            if(btn) { btn.disabled=false; btn.innerText='✅ حضور'; }
            return;
        }
        const nowISO = new Date().toISOString();
        const transRes = await fetch(`${API_BASE}/transactions`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ member_id: member.id, type: 'checkin', amount:0, date: nowISO, status:'paid'})
        });
        const updRes = await fetch(`${API_BASE}/members/${member.id}`, {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ name: member.name, phone: member.phone, gender: member.gender, height: member.height, weight: member.weight, sessions: member.sessions-1, debt: member.debt, expire_at: member.expire_at, last_checkin: nowISO })
        });
        const tr = await transRes.json();
        const ur = await updRes.json();
        if(tr.success && ur.success){
            member.sessions -= 1;
            member.last_checkin = nowISO;
            member.checkedInToday = true;
            showNotification(`✅ حضور ${member.name} ثبت شد`, 'success');
            // Update row inline - gray out button
            const row = document.querySelector(`tr[data-member-id="${member.id}"]`);
            if(row){
                const badge = row.querySelector('.badge.sessions, .badge.debt');
                if(badge){ badge.innerText = `${member.sessions} جلسه`; }
                if(member.sessions <=0){
                    row.className='row-danger';
                } else if(member.sessions <3){
                    row.className='row-warning';
                }
                if(btn){
                    // Gray and disable after click
                    btn.disabled = true;
                    btn.style.background = '#e2e8f0';
                    btn.style.color = '#64748b';
                    btn.style.cursor = 'not-allowed';
                    btn.innerText = '✅ ثبت شد';
                    btn.title = 'امروز ثبت شد';
                    // Also check if no sessions left, keep disabled
                    if(member.sessions<=0){
                        btn.innerText = '—';
                        btn.disabled = true;
                    }
                }
                // Also update subscription badge if needed
                const subCell = row.cells[4];
                if(subCell){
                    subCell.innerHTML = getSubscriptionBadge(member);
                }
            }
            // If detail is open, refresh it
            if(currentMemberId === memberId) await refreshMemberData(memberId);
        } else {
            showNotification('❌ خطا','error');
            if(btn) { btn.disabled=false; btn.innerText='✅ حضور'; }
        }
    } catch(e){
        showNotification('❌ خطا','error');
        if(btn) { btn.disabled=false; btn.innerText='✅ حضور'; }
    }
}

// ========================================
// === بک‌آپ و بازیابی ===
// ========================================
async function createBackup() {
    const btn = document.getElementById('btn-backup');
    const status = document.getElementById('backup-status');
    const originalText = btn ? btn.innerHTML : '';
    
    try {
        if (btn) {
            btn.innerHTML = '⏳ در حال تهیه بک‌آپ...';
            btn.disabled = true;
        }
        if (status) status.innerHTML = '⏳ لطفاً صبر کنید...';
        
        // اول یک کپی روی دیسک بساز (پوشه backups)
        try {
            await fetch(`${API_BASE}/backup/create-copy`, { method: 'POST' });
        } catch(e) { /* اگر خطا داد مهم نیست، دانلود اصلی را انجام بده */ }
        
        // بعد فایل را دانلود کن
        const response = await fetch(`${API_BASE}/backup`);
        
        if (!response.ok) throw new Error('خطا در دریافت بک‌آپ');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `backup-ardalan-${today}.sqlite`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
        if (status) status.innerHTML = '✅ بک‌آپ با موفقیت دانلود شد! آن را در فلش نگهداری کنید.';
        showNotification('✅ فایل پشتیبان دانلود شد', 'success');
        
        // همچنین یک کپی در localStorage info نمایش بده
        setTimeout(() => { if(status) status.innerHTML = ''; }, 4000);
        
    } catch (err) {
        console.error(err);
        if (status) status.innerHTML = '❌ خطا در تهیه بک‌آپ';
        showNotification('❌ خطا در تهیه بک‌آپ', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

async function restoreBackup(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (!confirm(`⚠️ هشدار: بازگردانی پشتیبان باعث جایگزینی تمام اطلاعات فعلی با اطلاعات فایل "${file.name}" می‌شود.\n\nآیا مطمئن هستید؟\n(پیشنهاد: اول یک بک‌آپ از وضعیت فعلی بگیرید)`)) {
        input.value = '';
        return;
    }
    
    const status = document.getElementById('backup-status');
    
    try {
        if (status) status.innerHTML = '⏳ در حال بازگردانی...';
        
        // برای آفلاین: فایل را به سرور آپلود کن و جایگزین کن
        // چون better-sqlite3 قفل است، باید از طریق API انجام شود
        // فعلاً ساده: به کاربر بگو فایل را دستی جایگزین کند
        showNotification('ℹ️ برای بازگردانی: برنامه را ببندید، فایل ' + file.name + ' را به database.sqlite تغییر نام دهید و در پوشه برنامه جایگزین کنید، سپس برنامه را دوباره اجرا کنید.', 'info');
        if (status) status.innerHTML = 'ℹ️ راهنما نمایش داده شد - فایل باید دستی جایگزین شود';
        
        // تلاش برای آپلود خودکار (اگر سرور endpoint داشته باشد)
        const formData = new FormData();
        formData.append('backup', file);
        
        // فعلاً فقط راهنمای دستی - چون جایگزینی دیتابیس باز نیاز به ری‌استارت دارد
        // در نسخه بعدی endpoint /api/backup/restore اضافه خواهد شد
        
    } catch (err) {
        console.error(err);
        showNotification('❌ خطا در بازگردانی', 'error');
        if (status) status.innerHTML = '❌ خطا';
    }
    input.value = '';
}

async function checkForUpdate() {
    const status = document.getElementById('update-status');
    const detail = document.getElementById('update-detail');
    const btn = document.getElementById('btn-check-update');
    if (!status) return;
    const current = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1.3.0';
    const curEl = document.getElementById('current-version-display');
    if(curEl) curEl.innerText = current;
    status.innerHTML = '⏳ در حال بررسی...';
    if (detail) { detail.style.display='none'; detail.innerText=''; }
    if (btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/update/check`);
        const data = await res.json();
        if (data.success && data.latest) {
            const latest = data.latest.replace('v','');
            const isNewer = latest !== current && latest > current;
            if (isNewer) {
                status.innerHTML = `🎉 نسخه جدید موجود: <b style="color:#16a34a">${data.latest}</b> (شما: ${current})`;
                if (detail) {
                    detail.style.display='block';
                    detail.innerText = (data.body || '').slice(0,800) || 'توضیحات موجود نیست';
                }
                showNotification(`🎉 آپدیت جدید ${data.latest} موجود است!`, 'success');
            } else {
                status.innerHTML = `✅ شما بروز هستید (نسخه ${current})`;
                showNotification('✅ برنامه بروز است', 'success');
            }
        } else {
            status.innerHTML = `ℹ️ ${data.message || 'مخزن هنوز ریلیزی ندارد'}<br><small><a href="https://github.com/nzbozorg/Ardalan-GYM-Manager" target="_blank" style="color:#2563eb">مشاهده در گیت‌هاب</a></small>`;
        }
    } catch(e) {
        status.innerHTML = '❌ عدم اتصال (آفلاین هستید)<br><small>برای آپدیت به <a href="https://github.com/nzbozorg/Ardalan-GYM-Manager" target="_blank" style="color:#2563eb">گیت‌هاب</a> سر بزنید</small>';
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function previewCleanup() {
    const preview = document.getElementById('cleanup-preview');
    const list = document.getElementById('cleanup-list');
    if (preview) preview.innerText = '⏳ در حال بررسی...';
    try {
        const res = await fetch(`${API_BASE}/members/cleanup/preview`);
        const data = await res.json();
        if (data.success) {
            if (data.count === 0) {
                if(preview) preview.innerHTML = '✅ هیچ عضو غیرفعالی یافت نشد (همه در 60 روز اخیر فعال بودند)';
                if(list) list.innerHTML = '';
            } else {
                if(preview) preview.innerHTML = `⚠️ <b>${data.count} عضو</b> غیرفعال (بیش از 60 روز) یافت شد:`;
                if(list) list.innerHTML = data.data.map(m => `<div style="padding:4px 0;border-bottom:1px dashed #f1f5f9;display:flex;justify-content:space-between"><span>${m.name} (${m.phone})</span><span style="color:#94a3b8">${m.daysSinceJoin} روز پیش</span></div>`).join('');
            }
        }
    } catch(e){ if(preview) preview.innerText='❌ خطا';}
}

async function runCleanup() {
    if (!confirm('آیا مطمئن هستید؟\nاعضای غیرفعال (2 ماه بدون مراجعه) برای همیشه حذف می‌شوند.')) return;
    try {
        const res = await fetch(`${API_BASE}/members/cleanup/inactive`, {method:'POST'});
        const data = await res.json();
        if (data.success) {
            showNotification(data.message, data.deleted>0?'success':'info');
            await previewCleanup();
            await loadMembers();
            renderDashboard();
        }
    } catch(e){ showNotification('❌ خطا','error');}
}

async function deleteMember() {
    const member = membersMap.get(currentMemberId);
    if (!member) return;

    if (confirm(`⚠️ آیا مطمئن هستید؟\nعضو "${member.name}" به طور کامل حذف می‌شود.`)) {
        const success = await deleteMemberFromServer(member.id);
        if (success) {
            // پاک کردن اطلاعات صفحه فعلی از sessionStorage
            sessionStorage.removeItem('current_view');
            sessionStorage.removeItem('current_member_id');
            await loadMembers();
            showNotification('✅ عضو با موفقیت حذف شد', 'success');
            showView('view-dashboard', 'داشبورد');
        } else {
            showNotification('❌ خطا در حذف عضو', 'error');
        }
    }
}

function exportToExcel() {
    if (members.length === 0) {
        showNotification('❌ هیچ داده‌ای برای خروجی وجود ندارد', 'error');
        return;
    }

    let csvContent = '\ufeff';
    csvContent += 'نام عضو,شماره تلفن,جنسیت,قد,وزن,جلسات,تاریخ عضویت\n';

    members.forEach(member => {
        const row = [
            `"${member.name}"`,
            `"${member.phone}"`,
            `"${member.gender === 'male' ? 'آقا' : 'خانم'}"`,
            `"${member.height || '-'}"`,
            `"${member.weight || '-'}"`,
            member.sessions,
            persianDateShort.format(new Date(member.createdAt))
        ].join(',');
        csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `گزارش_اعضا_${persianDateShort.format(new Date()).replace(/\//g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('✅ خروجی اکسل با موفقیت دانلود شد', 'success');
}

async function showMonthlyReport() {
    const now = new Date();
    try {
        const response = await fetch(`${API_BASE}/reports/monthly`);
        const result = await response.json();
        if (!result.success) {
            showNotification('❌ خطا در دریافت گزارش ماهانه', 'error');
            return;
        }

        const transactions = result.data;
        let buffetTotal = 0;
        let gymTotal = 0;
        let transactionCount = 0;
        const reportTransactions = [];
        const memberReports = [];
        const memberMap = new Map();

        transactions.forEach(t => {
            const memberId = t.member_id;
            if (!memberMap.has(memberId)) {
                memberMap.set(memberId, {
                    id: memberId,
                    name: t.name,
                    phone: t.phone,
                    gender: t.gender,
                    sessions: 0,
                    payments: 0,
                    transactions: []
                });
            }
            const member = memberMap.get(memberId);

            if (t.type === 'payment') {
                gymTotal += t.amount;
                member.payments += t.amount;
                transactionCount++;
                reportTransactions.push({
                    member: t.name, memberId: memberId,
                    amount: t.amount, purpose: t.purpose || 'پرداخت',
                    date: t.date, type: 'payment'
                });
            } else if (t.type === 'checkin') {
                member.sessions++;
            } else if (t.type === 'session') {
                gymTotal += t.amount;
                member.payments += t.amount;
                transactionCount++;
                reportTransactions.push({
                    member: t.name, memberId: memberId,
                    amount: t.amount, purpose: `خرید ${t.count} جلسه`,
                    date: t.date, type: 'session'
                });
            } else if (['water-small', 'water-large', 'buffet'].includes(t.type)) {
                buffetTotal += t.amount;
                member.payments += t.amount;
                transactionCount++;
                let purpose = '';
                if (t.type === 'water-small') purpose = 'آب کوچک';
                else if (t.type === 'water-large') purpose = 'آب بزرگ';
                else purpose = `بوفه: ${t.itemName || 'آیتم'}`;
                reportTransactions.push({
                    member: t.name, memberId: memberId,
                    amount: t.amount, purpose: purpose,
                    date: t.date, type: t.type
                });
            } else if (['cardio', 'plan'].includes(t.type)) {
                gymTotal += t.amount;
                member.payments += t.amount;
                transactionCount++;
                const purpose = t.type === 'cardio' ? 'هوازی' : 'برنامه تمرینی و غذایی';
                reportTransactions.push({
                    member: t.name, memberId: memberId,
                    amount: t.amount, purpose: purpose,
                    date: t.date, type: t.type
                });
            }

            member.transactions.push({
                type: t.type, amount: t.amount,
                purpose: t.purpose || '', date: t.date,
                count: t.count, itemName: t.itemName
            });
        });

        memberMap.forEach(member => {
            if (member.sessions > 0 || member.payments > 0) {
                memberReports.push(member);
            }
        });

        const grandTotal = buffetTotal + gymTotal;
        currentReportData = { members: memberReports, transactions: reportTransactions };

        const reportMonthEl = document.getElementById('report-month');
        if (reportMonthEl) {
            reportMonthEl.innerText = `گزارش ${now.toLocaleDateString('fa-IR', { month: 'long', year: 'numeric' })}`;
        }

        const reportBuffetEl = document.getElementById('report-buffet-total');
        if (reportBuffetEl) reportBuffetEl.innerText = buffetTotal.toLocaleString();

        const reportGymEl = document.getElementById('report-gym-total');
        if (reportGymEl) reportGymEl.innerText = gymTotal.toLocaleString();

        const reportTotalEl = document.getElementById('report-total');
        if (reportTotalEl) reportTotalEl.innerText = grandTotal.toLocaleString();

        const reportCountEl = document.getElementById('report-count');
        if (reportCountEl) reportCountEl.innerText = transactionCount;

        renderReportMembers();
        renderReportTransactions();
        showView('view-monthly-report', 'گزارش ماهانه');
    } catch (err) {
        console.error('خطا در گزارش ماهانه:', err);
        showNotification('❌ خطا در دریافت گزارش ماهانه', 'error');
    }
}

function renderReportMembers() {
    const tbody = document.getElementById('report-members-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const sortType = document.getElementById('sort-report-members')?.value || 'sessions-desc';

    let sortedMembers = [...currentReportData.members];
    sortedMembers.sort((a, b) => {
        switch (sortType) {
            case 'sessions-desc': return b.sessions - a.sessions;
            case 'sessions-asc': return a.sessions - b.sessions;
            case 'name': return a.name.localeCompare(b.name, 'fa');
            case 'payment-desc': return b.payments - a.payments;
            case 'payment-asc': return a.payments - b.payments;
            default: return 0;
        }
    });

    sortedMembers.forEach(m => {
        const row = document.createElement('tr');
        row.onclick = () => showMemberReportDetail(m);
        row.style.cursor = 'pointer';
        row.innerHTML = `
            <td>${m.name}</td>
            <td dir="ltr">${m.phone}</td>
            <td><span class="badge sessions">${m.sessions} جلسه</span></td>
            <td>${m.payments > 0 ? m.payments.toLocaleString() + ' تومان' : '-'}</td>
        `;
        tbody.appendChild(row);
    });

    if (sortedMembers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-light)"> هیچ فعالیتی در این ماه ثبت نشده است.</td></tr>`;
    }
}

function renderReportTransactions() {
    const tbody = document.getElementById('report-transactions-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const sortType = document.getElementById('sort-report-transactions')?.value || 'newest';

    let sortedTransactions = [...currentReportData.transactions];
    sortedTransactions.sort((a, b) => {
        switch (sortType) {
            case 'newest': return new Date(b.date) - new Date(a.date);
            case 'oldest': return new Date(a.date) - new Date(b.date);
            case 'amount-asc': return a.amount - b.amount;
            case 'amount-desc': return b.amount - a.amount;
            case 'name': return a.member.localeCompare(b.member, 'fa');
            default: return 0;
        }
    });

    sortedTransactions.forEach(r => {
        const row = document.createElement('tr');
        const date = persianDateFormatter.format(new Date(r.date));
        row.innerHTML = `
            <td>${r.member}</td>
            <td>${r.purpose}</td>
            <td>${date}</td>
            <td style="color:var(--success)">${r.amount.toLocaleString()} تومان</td>
        `;
        tbody.appendChild(row);
    });

    if (sortedTransactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-light)"> هیچ پرداختی در این ماه ثبت نشده است.</td></tr>`;
    }
}

function showMemberReportDetail(memberData) {
    const nameEl = document.getElementById('report-member-name');
    if (nameEl) nameEl.innerText = memberData.name;

    const phoneEl = document.getElementById('report-member-phone');
    if (phoneEl) phoneEl.innerText = memberData.phone;

    const sessionsEl = document.getElementById('report-member-sessions');
    if (sessionsEl) sessionsEl.innerText = memberData.sessions;

    const paymentEl = document.getElementById('report-member-payment');
    if (paymentEl) paymentEl.innerText = memberData.payments.toLocaleString() + ' تومان';

    const tbody = document.getElementById('report-member-transactions-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!memberData.transactions || memberData.transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-light)">هیچ تراکنشی در این ماه ثبت نشده است.</td></tr>';
        showView('view-member-report-detail', memberData.name);
        return;
    }

    memberData.transactions
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(t => {
            const row = document.createElement('tr');
            const date = persianDateFormatter.format(new Date(t.date));
            let desc = '';
            switch (t.type) {
                case 'water-small': desc = 'آب کوچک'; break;
                case 'water-large': desc = 'آب بزرگ'; break;
                case 'buffet': desc = `بوفه: ${t.itemName || ''}`; break;
                case 'session': desc = `خرید ${t.count || 1} جلسه`; break;
                case 'payment': desc = `پرداخت وجه ${t.purpose ? '(' + t.purpose + ')' : ''}`; break;
                case 'checkin': desc = 'ثبت حضور'; break;
                case 'cardio': desc = 'هوازی'; break;
                case 'plan': desc = 'برنامه تمرینی و غذایی'; break;
            }
            row.innerHTML = `<td>${desc}</td><td>${date}</td><td>${t.amount.toLocaleString()}</td>`;
            tbody.appendChild(row);
        });

    showView('view-member-report-detail', memberData.name);
}

document.getElementById('btn-excel-export')?.addEventListener('click', exportToExcel);