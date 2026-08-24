// 圖片載入失敗時的處理函式 (預設 SVG 剪影)
function handleImgError(img, fallbackPng) {
    if (!img.dataset.retried && fallbackPng) {
        img.dataset.retried = true;
        img.src = fallbackPng;
    } else {
        img.onerror = null;
        img.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nIzQ0NCc+PHBhdGggZD0nTTIxIDNIM3YybDggOHY3SDd2MmgxMHYtMmgtNHYtN2w4LThWM3onLz48L3N2Zz4=";
    }
}

const socket = io();
let allDrinks = [];
let globalServerOrders = []; // 用來暫存伺服器的訂單，確保配方載入時能重繪
let globalAvatars = {};
let globalCampaign = { active: false, text: '', tag: '活動', style: 'gold' };
const localHiddenOrders = new Set(); // 紀錄本機端自動隱藏的訂單
const finishedTimes = {}; // 紀錄訂單完成/退單的時間，供 10 分鐘自動清理使用
let isSidebarHidden = true; // 控制側邊欄狀態

// --- 防止 iPad 螢幕自動休眠 (Screen Wake Lock API) ---
let wakeLock = null;
let wakeLockRequested = false;

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('螢幕已鎖定常亮');
            wakeLockRequested = true;
            wakeLock.addEventListener('release', () => {
                console.log('螢幕常亮已解除');
                wakeLockRequested = false;
            });
        }
    } catch (err) {
        console.log(`Wake Lock 錯誤: ${err.name}, ${err.message}`);
    }
}

document.addEventListener('visibilitychange', () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
    }
});

// 當使用者第一次在畫面上進行任何操作時，嘗試鎖定螢幕
document.addEventListener('click', () => {
    if (!wakeLockRequested) {
        requestWakeLock();
    }
}, { once: true });
// -----------------------------------------------------------

function getAvatarUrl(guestName) {
    const style = globalAvatars[guestName] || 'adventurer';
    if (style && style.startsWith('data:image/')) {
        return style; 
    }
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(guestName)}`;
}

let titleFlashInterval = null;
let titleFlashCount = 0;
let originalTitle = "Bar Management POS";
let bgFlashTimeout = null;

function stopTitleFlash() {
    if (titleFlashInterval) {
        clearInterval(titleFlashInterval);
        titleFlashInterval = null;
        document.title = originalTitle;
    }
}
window.addEventListener('focus', stopTitleFlash);
document.addEventListener('click', stopTitleFlash);

function playNotification(customFlashText = '🔔 新通知！') {
    if ("vibrate" in navigator) { navigator.vibrate([500, 200, 500, 200, 500]); }
    
    // 背景紅色心跳閃爍特效
    if (bgFlashTimeout) clearTimeout(bgFlashTimeout);
    const badge = document.getElementById('pending-count');

    document.body.style.transition = 'none';
    document.body.style.backgroundColor = 'rgba(231, 76, 60, 0.4)';
    if (badge && badge.style.display !== 'none') {
        badge.style.transition = 'transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        badge.style.transform = 'scale(1.5)';
    }
    void document.body.offsetWidth;
    document.body.style.transition = 'background-color 0.3s ease-out';
    document.body.style.backgroundColor = '';
    if (badge) setTimeout(() => badge.style.transform = '', 150);

    // 標題閃爍
    if (titleFlashInterval) clearInterval(titleFlashInterval);
    titleFlashCount = 0;
    titleFlashInterval = setInterval(() => {
        titleFlashCount++;
        document.title = (titleFlashCount % 2 === 1) ? customFlashText : originalTitle;
    }, 500);
}

// 智慧配方解析器
function estimateDrinkProfile(drink) {
    if (!drink.description) return drink;
    const lines = drink.description.split(/\n/);
    let ingredientsLine = lines.find(l => l.trim().startsWith('材料：') || l.trim().startsWith('材料:'));
    if (!ingredientsLine) return drink;

    const itemsRaw = ingredientsLine.replace(/材料[：:]/, '').split(/[、，,。]/).map(i => i.trim()).filter(i => i);
    let totalVolume = 0;
    let totalAlcohol = 0;
    let totalSourPoints = 0;

    const ingredientDB = [
        { keywords: ['無酒精', 'non-alcoholic', 'non alcoholic', 'zero proof'], abv: 0, sour: 0 },
        { keywords: ['生命之水', 'absinthe', '艾碧斯', '151'], abv: 70, sour: 0 },
        { keywords: ['綠夏特留斯', 'green chartreuse'], abv: 55, sour: 0 },
        { keywords: ['黃夏特留斯', 'yellow chartreuse', '夏特留斯', 'chartreuse'], abv: 43, sour: 0 },
        { keywords: ['伏特加', 'vodka', '琴酒', 'gin', '蘭姆酒', 'rum', '龍舌蘭', 'tequila', '威士忌', 'whiskey', 'whisky', '白蘭地', 'brandy', '波本', 'bourbon', '干邑', 'cognac', '高粱', '卡夏莎', '卡夏沙', 'cachaça', 'cachaca', '梅斯卡爾', 'mezcal', '皮斯可', 'pisco', '君度', 'cointreau', '三秒膠', 'triple sec', 'tripe sec', '柑曼怡', 'grand marnier', '班尼狄克汀', '班尼迪克丁', 'd.o.m', 'benedictine', '苦精', 'bitters'], abv: 40, sour: 0 },
        { keywords: ['野格', 'jägermeister', 'jagermeister'], abv: 35, sour: 0 },
        { keywords: ['黑櫻桃酒', '瑪拉斯奇諾', 'maraschino'], abv: 32, sour: 0 },
        { keywords: ['杏仁酒', '杏仁利口酒', 'amaretto', '迪薩諾羅', 'disaronno'], abv: 28, sour: 0 },
        { keywords: ['金巴利', 'campari', '皮姆', '皮姆一號', 'pimm'], abv: 25, sour: 0 },
        { keywords: ['藍柑橘', '藍橙皮', 'blue curacao', 'curaçao', '蜜瓜酒', '香瓜', 'midori', '咖啡酒', '咖啡利口酒', '卡魯哇', 'kahlúa', 'kahlua', 'mr. black', '榛果酒', 'frangelico', '巧克力酒', '可可酒', 'chocolate liqueur', 'cacao', '莫札特', 'mozart', 'godiva', '利口酒', 'liqueur', '香甜酒', '接骨木花', '紫羅蘭', '櫻桃酒'], abv: 20, sour: 0 },
        { keywords: ['百利甜酒', '百利甜', 'baileys', '愛爾蘭奶酒', 'irish cream', '水蜜桃酒', '蜜桃', 'peach schnapps', '草莓酒'], abv: 17, sour: 0 },
        { keywords: ['黑醋栗', 'cassis', '威末', 'vermouth', '苦艾酒', '波特酒', 'port', '雪莉酒', 'sherry', '清酒', 'sake', '燒酎', 'shochu', '紅酒', '白酒', 'wine', '香檳', 'champagne', '氣泡酒', '梅酒', '果酒', '甜酒'], abv: 15, sour: 0 },
        { keywords: ['阿佩羅', '艾普羅', 'aperol'], abv: 11, sour: 0 },
        { keywords: ['啤酒', 'beer', '黑啤', 'stout', 'ale', '蘋果酒', 'cider'], abv: 5, sour: 0 },
        { keywords: ['酒', 'liquor', 'spirit', '酒精'], abv: 15, sour: 0 },
        { keywords: ['檸檬汁', 'lemon juice', '萊姆汁', 'lime juice', '金桔', '柚子', '桔'], abv: 0, sour: 10 },
        { keywords: ['葡萄柚', 'grapefruit', '百香果'], abv: 0, sour: 6 },
        { keywords: ['柳橙', 'orange juice', '鳳梨', 'pineapple', '蔓越莓', 'cranberry', '蘋果汁', 'apple juice', '番茄汁', '葡萄', '果汁'], abv: 0, sour: 3 },
        { keywords: ['糖漿', 'syrup', '糖', 'sugar', '蜂蜜', 'honey', '紅石榴', 'grenadine', '焦糖'], abv: 0, sour: -5 },
        { keywords: ['可樂', 'cola', '雪碧', 'sprite', '薑汁汽水', 'ginger ale', '通寧水', 'tonic', '蘇打', 'soda', '氣泡水', 'sparkling', '牛奶', 'milk', '鮮奶油', 'cream', '椰奶', 'coconut', '茶', 'tea', '咖啡', 'coffee', '水', 'water', '蛋白', 'egg white', '氣泡'], abv: 0, sour: 0 }
    ];

    let hasValidVolume = false;
    itemsRaw.forEach(item => {
        let volume = 0;
        let match = item.match(/((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*(ml|oz|dash|滴|份|cc|c\.c\.)/i);
        if (match) {
            hasValidVolume = true;
            let numStr = match[1].trim();
            let unit = match[2].toLowerCase();
            if (numStr.includes('/')) {
                let parts = numStr.split(' ');
                if (parts.length === 2) {
                    volume = parseFloat(parts[0]) + (parseFloat(parts[1].split('/')[0]) / parseFloat(parts[1].split('/')[1]));
                } else {
                    volume = parseFloat(numStr.split('/')[0]) / parseFloat(numStr.split('/')[1]);
                }
            } else { volume = parseFloat(numStr); }
            if (unit === 'oz') volume *= 30;
            else if (unit === 'dash' || unit === '滴') volume = 1;
            else if (unit === '份') volume *= 30;
        } else if (item.includes('汁') || item.includes('汽水') || item.includes('水') || item.includes('酒')) { volume = 30; } 
        else if (item.includes('糖')) { volume = 10; }

        let itemName = item.toLowerCase();
        let matchedAttr = { abv: 0, sour: 0 };
        for (let dbItem of ingredientDB) {
            if (dbItem.keywords.some(kw => itemName.includes(kw))) { matchedAttr = dbItem; break; }
        }
        if (!itemName.includes('苦精') && !itemName.includes('bitters')) totalVolume += volume;
        totalAlcohol += volume * (matchedAttr.abv / 100);
        totalSourPoints += volume * matchedAttr.sour;
    });

    if (hasValidVolume && totalVolume > 0) {
        let finalVolume = totalVolume * 1.20; 
        drink.abv = Math.round((totalAlcohol / finalVolume) * 100); 
        drink.strong = drink.abv < 5 ? 1 : drink.abv < 12 ? 2 : drink.abv < 20 ? 3 : drink.abv < 30 ? 4 : 5; 
        let avgSour = totalSourPoints / totalVolume;
        drink.sour = avgSour <= 0 ? 1 : avgSour <= 1.5 ? 2 : avgSour <= 3.0 ? 3 : avgSour <= 5.0 ? 4 : 5; 
    }
    return drink;
}

// Sidebar Toggle Logic
function toggleSidebar() {
    isSidebarHidden = !isSidebarHidden;
    const sidebar = document.getElementById('inventory-sidebar');
    const toggleBtn = document.getElementById('btn-toggle-inv');
    
    if (isSidebarHidden) {
        sidebar.classList.add('hidden');
        if(toggleBtn) toggleBtn.classList.remove('btn-primary');
    } else {
        sidebar.classList.remove('hidden');
        if(toggleBtn) toggleBtn.classList.add('btn-primary');
        
        // 自動聚焦搜尋框 (等待側邊欄 300ms 動畫展開完成)
        const searchInput = document.getElementById('inventory-search-input');
        if (searchInput) {
            setTimeout(() => {
                searchInput.focus();
                searchInput.select(); // 選取文字方便直接輸入新搜尋
            }, 300);
        }
    }
}

function updateCountsAndTitle() {
    let pendingCount = 0;
    let makingCount = 0;
    let completedCount = 0;
    
    globalServerOrders.forEach(order => {
        if (order.hiddenFromDashboard || localHiddenOrders.has(order.id)) return;
        if (order.status === 'pending' || !order.status) pendingCount++;
        else if (order.status === 'making') makingCount++;
        else if (order.status === 'completed' || order.status === 'rejected') completedCount++;
    });

    const badge = document.getElementById('pending-count');
    if (badge) {
        badge.innerText = pendingCount;
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
    
    const countPending = document.getElementById('count-pending');
    if (countPending) countPending.innerText = pendingCount;
    
    const countMaking = document.getElementById('count-making');
    if (countMaking) countMaking.innerText = makingCount;
    
    const countCompleted = document.getElementById('count-completed');
    if (countCompleted) countCompleted.innerText = completedCount;

    const baseTitle = "Bar POS";
    const newTitle = pendingCount > 0 ? `(${pendingCount}) ${baseTitle}` : baseTitle;
    if (!titleFlashInterval) {
        document.title = newTitle;
        originalTitle = newTitle;
    } else {
        originalTitle = newTitle;
    }
}

fetch(`/api/drinks?t=${Date.now()}`).then(r => r.json()).then(drinks => {
    allDrinks = drinks.map(estimateDrinkProfile);
    renderInventory();
    if (globalServerOrders.length > 0) renderAllOrders();
    initKanbanSortable(); 
});

socket.on('recipes-updated', () => {
    fetch(`/api/drinks?t=${Date.now()}`).then(r => r.json()).then(drinks => {
        allDrinks = drinks.map(estimateDrinkProfile);
        renderInventory();
        if (globalServerOrders.length > 0) {
            document.getElementById('list-pending').innerHTML = '';
            document.getElementById('list-making').innerHTML = '';
            document.getElementById('list-completed').innerHTML = '';
            renderAllOrders();
        }
        showToast('配方庫已成功更新！');
    });
});

socket.on('sync-sold-out', (soldOutNames) => {
    allDrinks.forEach(d => {
        d.isSoldOut = soldOutNames.includes(d.name);
    });
    renderInventory();
});

socket.on('drink-sold-out-updated', (data) => {
    const drink = allDrinks.find(d => d.id === data.id);
    if (drink) {
        drink.isSoldOut = data.isSoldOut;
        renderInventory();
    }
});

socket.on('admin-broadcast', (msg) => {
    showToast(msg);
});

let globalGuestTitles = {};

socket.on('sync-guest-titles', (titles) => {
    globalGuestTitles = titles || {};
    renderAllOrders();
});

function getGuestTitleBadgeHtml(guestName) {
    const title = globalGuestTitles[guestName];
    if (!title || !title.text) return '';
    return `<span class="title-badge-pill ${title.style || ''}">${title.text}</span>`;
}

let missingIngredients = [];
let isStockCollapsed = false;

const defaultStockIngredients = [
    '薄荷', '鮮奶油', '鮮奶', '檸檬汁', '萊姆汁', '蔓越莓汁', '葡萄柚汁', '鳳梨汁', '柳橙汁',
    '蛋白', '可樂', '通寧水', '蘇打水', '健力士黑啤酒', '琴酒', '伏特加', '威士忌', '蘭姆酒',
    '龍舌蘭', '白蘭地', '君度橙酒', '金巴利', '杏仁香甜酒', '咖啡香甜酒', '奶酒', '蜜多麗蜜瓜香甜酒',
    '野格', '夏特留斯', '苦艾酒', '白薄荷香甜酒', '黑櫻桃酒', '紅石榴糖漿', '純糖漿', '橄欖'
];

socket.on('sync-missing-ingredients', (data) => {
    missingIngredients = data || [];
    renderIngredientStockManager();
    renderInventory(false);
});

function toggleIngredientStockCollapse() {
    isStockCollapsed = !isStockCollapsed;
    const container = document.getElementById('ingredient-stock-container');
    if (container) {
        container.style.display = isStockCollapsed ? 'none' : 'flex';
    }
}

function renderIngredientStockManager() {
    const container = document.getElementById('ingredient-stock-container');
    if (!container) return;

    if (isStockCollapsed) {
        container.style.display = 'none';
        return;
    } else {
        container.style.display = 'flex';
    }

    container.innerHTML = defaultStockIngredients.map(item => {
        const isMissing = missingIngredients.includes(item);
        return `
            <div class="ingredient-stock-pill ${isMissing ? 'missing' : 'available'}" onclick="toggleMissingIngredient('${item}')" title="${isMissing ? '點擊恢復有貨' : '點擊標記缺貨'}">
                ${isMissing ? '❌ ' + item : '✅ ' + item}
            </div>
        `;
    }).join('');
}

function toggleMissingIngredient(item) {
    socket.emit('toggle-missing-ingredient', item);
}

// 常缺貨快捷鍵配置
const quickToggleKeywords = ['牛奶', '薄荷', '生啤', '可樂', '通寧水', '氣泡水'];

function renderQuickToggles() {
    const container = document.getElementById('quick-toggle-buttons');
    if (!container) return;

    container.innerHTML = quickToggleKeywords.map(keyword => {
        const targetDrinks = allDrinks.filter(d => d.name.includes(keyword) || (d.description && d.description.includes(keyword)));
        if (targetDrinks.length === 0) return '';
        const allSoldOut = targetDrinks.every(d => d.isSoldOut);
        return `<button class="quick-toggle-btn ${allSoldOut ? 'sold-out' : ''}" onclick="toggleSoldOutByKeyword('${keyword}')">
            ${keyword} ${allSoldOut ? '🚫' : ''}
        </button>`;
    }).join('');
}

function renderInventory(fullRender = true) {
    if (fullRender) {
        renderIngredientStockManager();
    }
    const list = document.getElementById('inv-list');
    const searchInput = document.getElementById('inventory-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    const drinksToRender = searchTerm ? allDrinks.filter(d => {
        const nameMatch = d.name.toLowerCase().includes(searchTerm);
        const descMatch = d.description && d.description.toLowerCase().includes(searchTerm);
        const tagsMatch = d.tags && d.tags.join(',').toLowerCase().includes(searchTerm);
        return nameMatch || descMatch || tagsMatch;
    }) : allDrinks;

    list.innerHTML = drinksToRender.map(d => {
        const safeName = d.name.replace(/'/g, "\\'"); 
        const encodedName = encodeURIComponent(d.name);
        const t = Date.now(); 
        const localPath = `/images/${encodedName}.jpg?t=${t}`;
        const localPathPng = `/images/${encodedName}.png?t=${t}`;

        // 檢查是否含有缺貨原料
        const desc = (d.description || '').toLowerCase();
        const tagsStr = (d.tags || []).join(' ').toLowerCase();
        const missingFound = missingIngredients.filter(ing => desc.includes(ing.toLowerCase()) || tagsStr.includes(ing.toLowerCase()));
        const isMissingIng = missingFound.length > 0;
        
        return `
        <div class="inv-item ${d.isSoldOut || isMissingIng ? 'sold-out' : ''}">
            <img src="${localPath}" onerror="handleImgError(this, '${localPathPng}')" onclick="openImageModal(this.src)">
            <div class="inv-item-info">
                <div class="inv-item-name" title="${d.name}">${d.name}</div>
                <div class="inv-item-meta">
                    <div class="inv-item-status">${d.isSoldOut ? '🚫 已下架' : isMissingIng ? `⚠️ 缺 ${missingFound.join(', ')}` : '✅ 供應中'}</div>
                    ${isMissingIng ? `<div class="inv-missing-tag">缺 ${missingFound.join(', ')}</div>` : ''}
                </div>
            </div>
            <div class="inv-item-actions">
                <button class="inv-action-btn toggle-btn" onclick="toggleSoldOut(${d.id})">
                    ${d.isSoldOut ? '上架' : '下架'}
                </button>
                <button class="inv-action-btn" onclick="openEditRecipeModal('${safeName}')">✏️ 編輯</button>
            </div>
        </div>
        `;
    }).join('');
}

function toggleSoldOut(id) { socket.emit('toggle-sold-out', id); }

function toggleSoldOutByKeyword(keyword) {
    const targetDrinks = allDrinks.filter(d => d.name.includes(keyword) || (d.description && d.description.includes(keyword)));
    if (targetDrinks.length === 0) return;
    
    const allSoldOut = targetDrinks.every(d => d.isSoldOut);
    const makeSoldOut = !allSoldOut; 
    const actionText = makeSoldOut ? '下架' : '上架';
    
    if (targetDrinks.length > 2 && !confirm(`確定要將包含「${keyword}」的 ${targetDrinks.length} 款酒全部設為「${actionText}」嗎？`)) return;
    
    targetDrinks.forEach(d => {
        if (Boolean(d.isSoldOut) !== makeSoldOut) socket.emit('toggle-sold-out', d.id);
    });
    showToast(`✅ 已將「${keyword}」相關酒款設為 ${actionText}！`);
}



function updateCampaignStatusBadge() {
    const btn = document.getElementById('btn-campaign-settings');
    if (!btn) return;
    if (globalCampaign && globalCampaign.active) {
        btn.innerHTML = `📢 活動中: ${globalCampaign.tag || '活動'}`;
        btn.style.background = '#27ae60';
        btn.style.borderColor = '#27ae60';
    } else {
        btn.innerHTML = `📢 活動設定`;
        btn.style.background = '#e67e22';
        btn.style.borderColor = '#e67e22';
    }
}

// 接收活動更新
socket.on('campaign-updated', (data) => {
    globalCampaign = data;
    updateCampaignStatusBadge();
});
socket.on('sync-campaign', (data) => {
    globalCampaign = data;
    updateCampaignStatusBadge();
});

// 初始化載入活動資料

fetch('/api/campaign').then(r => r.json()).then(data => {
    globalCampaign = data;
    updateCampaignStatusBadge();
}).catch(() => {});

function reloadRecipes() {
    socket.emit('reload-recipes');
    showToast('正在通知伺服器重載配方...');
}

socket.on('sync-orders', (serverOrders) => {
    globalServerOrders = serverOrders;
    renderAllOrders();
    checkAndRenderAdjustList();
});

function renderAllOrders() {
    const listPending = document.getElementById('list-pending');
    const listMaking = document.getElementById('list-making');
    const listCompleted = document.getElementById('list-completed');
    
    const currentOrderIds = globalServerOrders
        .filter(o => !o.hiddenFromDashboard && !localHiddenOrders.has(o.id))
        .map(o => 'order-' + o.id);

    // Remove deleted or hidden orders
    document.querySelectorAll('.order-card').forEach(el => {
        if (!currentOrderIds.includes(el.id)) el.remove();
    });

    // Render or update existing
    globalServerOrders.forEach(order => {
        if (order.hiddenFromDashboard || localHiddenOrders.has(order.id)) return;
        const el = document.getElementById('order-' + order.id);
        const targetList = getListByStatus(order.status);
        
        if (!el) {
            renderOrder(order);
        } else {
            const currentStatus = order.status || 'pending';
            if (!el.classList.contains(`status-${currentStatus}`)) {
                updateOrderUIOnly(el, currentStatus); 
                if (el.parentElement !== targetList) {
                    targetList.appendChild(el);
                }
            }
        }
    });

    reorderColumnDOM(listPending);
    reorderColumnDOM(listMaking);
    reorderColumnDOM(listCompleted);
    
    updateCountsAndTitle();
    checkOvertime();
    renderBatchSummaryBar();
}

function getListByStatus(status) {
    if (status === 'making') return document.getElementById('list-making');
    if (status === 'completed' || status === 'rejected') return document.getElementById('list-completed');
    return document.getElementById('list-pending'); 
}

socket.on('admin-notification', (data) => {
    globalServerOrders.push(data);
    renderOrder(data);
    reorderColumnDOM(document.getElementById('list-pending'));
    updateCountsAndTitle();
    playNotification(`🔔 ${data.guest} 點了 ${data.drink}`); 
});

socket.on('order-deleted', (orderId) => {
    const el = document.getElementById('order-' + orderId);
    if (el) {
        el.remove();
    }
    globalServerOrders = globalServerOrders.filter(o => o.id !== orderId);
    updateCountsAndTitle();
    checkAndRenderAdjustList();
});

// 解析描述中的材料、杯型、技法、裝飾與故事
function parseDrinkDescription(desc) {
    const result = {
        story: '',
        glass: '',
        technique: '',
        garnish: ''
    };
    if (!desc) return result;

    const lines = desc.split(/\r?\n/).map(line => line.trim()).filter(line => line);
    const storyLines = [];

    lines.forEach(line => {
        if (line.startsWith('材料：') || line.startsWith('材料:')) {
            // 已在材料部分呈現，此處跳過
        } else if (line.startsWith('杯型：') || line.startsWith('杯型:')) {
            result.glass = line.replace(/^杯型[：:]/, '').trim();
        } else if (line.startsWith('技法：') || line.startsWith('技法:')) {
            result.technique = line.replace(/^技法[：:]/, '').trim();
        } else if (line.startsWith('裝飾：') || line.startsWith('裝飾:')) {
            result.garnish = line.replace(/^裝飾[：:]/, '').trim();
        } else {
            // 其他皆視為故事的一部分
            storyLines.push(line);
        }
    });

    result.story = storyLines.join('\n');
    return result;
}

function classifyIngredient(item) {
    const itemLower = item.toLowerCase();
    
    // 1. Check for Syrup / Lemon / Lime juices / Sweeteners
    const sweetSourKeywords = [
        '糖', 'sugar', '蜂蜜', 'honey', '紅石榴', 'grenadine', '焦糖', 'syrup', '楓糖', '黑糖', '冬瓜糖', '椰糖', 
        '檸檬汁', 'lemon juice', '萊姆汁', 'lime juice', '金桔汁', '柚子汁', '果汁', 'juice', '酸柑汁', '檸檬原汁', '萊姆原汁'
    ];
    
    // 2. Check for Alcohol
    const alcoholKeywords = [
        '酒', 'spirit', 'liquor', '151', '艾碧斯', 'absinthe', '夏特留斯', 'chartreuse', '伏特加', 'vodka', '琴酒', 'gin', 
        '蘭姆酒', 'rum', '龍舌蘭', 'tequila', '威士忌', 'whiskey', 'whisky', '白蘭地', 'brandy', '波本', 'bourbon', 
        '干邑', 'cognac', '高粱', '卡夏莎', 'cachaça', 'cachaca', '梅斯卡爾', 'mezcal', '皮斯可', 'pisco', '君度', 'cointreau', 
        '三秒膠', 'triple sec', 'tripe sec', '柑曼怡', 'grand marnier', '班尼狄克汀', '班尼迪克丁', 'd.o.m', 'benedictine', 
        '苦精', 'bitters', '野格', 'jägermeister', 'jagermeister', '瑪拉斯奇諾', 'maraschino', '杏仁酒', '利口酒', 'amaretto', 
        '迪薩諾羅', 'disaronno', '金巴利', 'campari', '皮姆', 'pimm', '藍柑橘', '藍橙皮', 'blue curacao', 'curaçao', 
        'midori', '卡魯哇', 'kahlúa', 'kahlua', 'mr. black', 'frangelico', '百利甜', 'baileys', 'cassis', 'vermouth', 
        '苦艾酒', '波特酒', 'port', '雪莉酒', 'sherry', '清酒', 'sake', '燒酎', 'shochu', '紅酒', '白酒', 'wine', '香檳', 
        'champagne', '氣泡酒', '梅酒', '果酒', '甜酒', '阿佩羅', '艾普羅', 'aperol', '啤酒', 'beer', 'stout', 'ale', 'cider',
        '琴汁', '香甜酒', '利口酒', '高梁', '紹興', '威末', '金巴莉'
    ];

    const isAlcohol = alcoholKeywords.some(kw => itemLower.includes(kw));
    if (isAlcohol) {
        return 'alcohol';
    }

    const isSweetSour = sweetSourKeywords.some(kw => itemLower.includes(kw));
    if (isSweetSour) {
        return 'sweetSour';
    }

    return 'other';
}

// 格式化酒保畫面的配方顯示 (以結構化方式呈現材料、杯型、技法、裝飾，並將故事淡化置底以降低干擾)
function formatDashboardRecipe(desc) {
    if (!desc) return "";
    const parsed = parseDrinkDescription(desc);
    let html = "";

    // 1. 渲染材料為分門別類的膠囊標籤
    const lines = desc.split(/\r?\n/).map(line => line.trim()).filter(line => line);
    const materialsLine = lines.find(line => line.startsWith('材料：') || line.startsWith('材料:'));
    if (materialsLine) {
        const items = materialsLine.replace(/材料[：:]/, "").split(/[、，,。]/).map(i => i.trim()).filter(i => i);
        
        const alcohols = [];
        const sweetSours = [];
        const others = [];

        items.forEach(item => {
            const cat = classifyIngredient(item);
            if (cat === 'alcohol') alcohols.push(item);
            else if (cat === 'sweetSour') sweetSours.push(item);
            else others.push(item);
        });

        let ingredientsHtml = '<div style="display: flex; flex-direction: column; gap: 8px;">';

        if (alcohols.length > 0) {
            ingredientsHtml += `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 0.8em; color: #a5c7f7; font-weight: bold;">🍾 酒類：</span>
                    <ul class="ingredient-tags">
                        ${alcohols.map(i => `<li class="ingredient-tag tag-alcohol" style="background: rgba(52, 152, 219, 0.15); color: #5dade2; border-color: rgba(52, 152, 219, 0.4);">${i}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (sweetSours.length > 0) {
            ingredientsHtml += `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 0.8em; color: #f8c471; font-weight: bold;">🍯 糖漿/酸汁：</span>
                    <ul class="ingredient-tags">
                        ${sweetSours.map(i => `<li class="ingredient-tag tag-sweetsour" style="background: rgba(230, 126, 34, 0.15); color: #f5b041; border-color: rgba(230, 126, 34, 0.4);">${i}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        if (others.length > 0) {
            ingredientsHtml += `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 0.8em; color: #a9dfbf; font-weight: bold;">🍋 副材料：</span>
                    <ul class="ingredient-tags">
                        ${others.map(i => `<li class="ingredient-tag tag-other" style="background: rgba(46, 204, 113, 0.15); color: #52be80; border-color: rgba(46, 204, 113, 0.4);">${i}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        ingredientsHtml += '</div>';
        html += `<div style="margin-bottom: 10px;">${ingredientsHtml}</div>`;
    }

    // 2. 渲染製作細節 (杯型、技法、裝飾)
    let specsHtml = "";
    if (parsed.glass) {
        specsHtml += `<div class="recipe-spec-item" style="display:flex; align-items:center; gap:4px;"><strong>🍸 杯型：</strong>${parsed.glass}</div>`;
    }
    if (parsed.technique) {
        specsHtml += `<div class="recipe-spec-item" style="display:flex; align-items:center; gap:4px;"><strong>🥄 技法：</strong>${parsed.technique}</div>`;
    }
    if (parsed.garnish) {
        specsHtml += `<div class="recipe-spec-item" style="display:flex; align-items:center; gap:4px;"><strong>🍒 裝飾：</strong>${parsed.garnish}</div>`;
    }
    
    if (specsHtml) {
        html += `<div class="recipe-specs-container" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; font-size: 0.9em; color: #ddd; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">${specsHtml}</div>`;
    }

    return html;
}

function renderOrder(data) {
    if (data.hiddenFromDashboard || localHiddenOrders.has(data.id)) return;
    const targetList = getListByStatus(data.status);
    if (document.getElementById('order-' + data.id)) return;

    const div = document.createElement('div');
    div.className = 'order-card';
    div.id = 'order-' + data.id; 
    
    if (data.status === 'pending' || !data.status) div.classList.add('status-pending');
    if (data.status === 'making') div.classList.add('status-making');
    if (data.status === 'completed') div.classList.add('status-completed');
    if (data.status === 'rejected') div.classList.add('status-rejected');

    // Add flash animation based on status
    const flashClassMap = {
        'pending': 'status-updated-flash-pending',
        'making': 'status-updated-flash-making',
        'completed': 'status-updated-flash-completed',
        'rejected': 'status-updated-flash-rejected'
    };
    div.classList.add(flashClassMap[data.status || 'pending']);
    
    const drinkInfo = allDrinks.find(d => d.name === data.drink);
    const encodedName = encodeURIComponent(data.drink);
    const t = Date.now();
    const imgSrc = `/images/${encodedName}.jpg?t=${t}`;
    const imgSrcPng = `/images/${encodedName}.png?t=${t}`;
    const avatarUrl = getAvatarUrl(data.guest);
    const safeGuest = data.guest.replace(/'/g, "\\'");
    const shortId = data.id.split('-')[0].slice(-5); // Use last 5 digits of timestamp for ID
    
    // Timer bar HTML (Only visible in making/overtime states via CSS)
    const timerBarHtml = `
        <div class="timer-wrapper">
            <div class="overtime-warning" id="warning-${data.id}">⚠️ 超時</div>
        </div>
    `;
    
    const titleBadge = getGuestTitleBadgeHtml(data.guest);

    div.innerHTML = `
        <div class="card-header">
            <div class="card-guest" onclick="showGuestHistory('${safeGuest}')" title="查看 ${data.guest} 的紀錄">
                <img src="${avatarUrl}" alt="Avatar">
                ${data.guest} ${titleBadge}
            </div>
            <div class="card-id-time">
                <span class="card-order-id">#${shortId}</span>
                <span class="card-time">${data.time}</span>
            </div>
        </div>
        
        <div class="card-body" style="display: flex; flex-direction: column; gap: 8px; align-items: stretch;">
            <div class="card-main-info" style="display: flex; gap: 12px; align-items: center;">
                <div class="card-img-wrap" style="width: 80px; height: 80px; flex-shrink: 0; position: relative;">
                    <img src="${imgSrc}" onerror="handleImgError(this, '${imgSrcPng}')" class="card-img" onclick="openImageModal(this.src)" style="width: 100%; height: 100%; border-radius: 8px; object-fit: contain; background: #000; border: 1px solid #333; cursor: zoom-in;">
                    ${drinkInfo && drinkInfo.isSoldOut ? '<div class="sold-out-overlay">售罄</div>' : ''}
                </div>
                <div class="card-title-details" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                    <div class="card-drink-name" title="${data.drink}" style="font-size: 1.4em; font-weight: 900; color: #fff; margin: 0; line-height: 1.2;">${data.drink}</div>
                    ${data.notes ? `<div class="card-notes" style="align-self: flex-start;">💬 ${data.notes}</div>` : ''}
                </div>
            </div>
            ${drinkInfo && drinkInfo.description ? `<div class="card-recipe" style="margin-top: 4px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px; font-size: 0.9em; font-family: -apple-system, sans-serif;">${formatDashboardRecipe(drinkInfo.description)}</div>` : ''}
        </div>
        
        ${timerBarHtml}
        
        <div class="card-actions">
            <button class="btn-reject-quick" onclick="updateStatus('${data.id}', 'rejected', this)" title="快速退單">✖</button>
            <button class="btn-pending" onclick="updateStatus('${data.id}', 'pending', this)">⏳ 待處理</button>
            <button class="btn-make" onclick="updateStatus('${data.id}', 'making', this)">👨‍🍳 製作中</button>
            <button class="btn-serve" onclick="updateStatus('${data.id}', 'completed', this)">✅ 已完成</button>
        </div>
    `;
    targetList.appendChild(div);
}

function updateOrderUIOnly(card, newStatus) {
    card.classList.remove('status-updated-flash-pending', 'status-updated-flash-making', 'status-updated-flash-completed', 'status-updated-flash-rejected');
    void card.offsetWidth; 
    
    const flashClassMap = {
        'pending': 'status-updated-flash-pending',
        'making': 'status-updated-flash-making',
        'completed': 'status-updated-flash-completed',
        'rejected': 'status-updated-flash-rejected'
    };
    card.classList.add(flashClassMap[newStatus]);
    card.classList.remove('status-pending', 'status-making', 'status-completed', 'status-rejected');
    card.classList.add('status-' + newStatus);
}


function reorderColumnDOM(columnElement) {
    if (!columnElement) return;
    const ordersDOM = Array.from(columnElement.querySelectorAll('.order-card'));
    
    const orderDataMap = {};
    const oldestTimeByDrink = {};

    ordersDOM.forEach(el => {
        const id = el.id.replace('order-', '');
        const data = globalServerOrders.find(o => o.id === id) || { status: 'completed', id: id, drink: '' };
        orderDataMap[id] = data;

        if (data.status === 'pending' || data.status === 'making') {
            const time = parseInt(data.id.split('-')[0]) || Infinity;
            if (!oldestTimeByDrink[data.drink] || time < oldestTimeByDrink[data.drink]) {
                oldestTimeByDrink[data.drink] = time;
            }
        }
    });

    ordersDOM.sort((a, b) => {
        const idA = a.id.replace('order-', '');
        const idB = b.id.replace('order-', '');
        const dataA = orderDataMap[idA];
        const dataB = orderDataMap[idB];
        
        // 如果狀態是待接單或製作中，同品項的排在一起
        if (dataA.status === 'pending' || dataA.status === 'making') {
            const groupTimeA = oldestTimeByDrink[dataA.drink];
            const groupTimeB = oldestTimeByDrink[dataB.drink];

            if (groupTimeA !== groupTimeB) {
                return groupTimeA - groupTimeB; 
            }
        }
        
        const aTime = parseInt(dataA.id.split('-')[0]) || 0;
        const bTime = parseInt(dataB.id.split('-')[0]) || 0;
        return aTime - bTime; // 舊的在上面
    });
    
    ordersDOM.forEach(order => columnElement.appendChild(order));
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function updateStatus(orderId, newStatus, btn) {
    socket.emit('update-status', { id: orderId, status: newStatus });
    
    const card = document.getElementById('order-' + orderId);
    if (!card) return;

    updateOrderUIOnly(card, newStatus);

    if (newStatus === 'pending') {
        showToast('已撤銷，回到待接單');
    } else if (newStatus === 'making') {
        // 如果是剛移入製作中，紀錄開始時間
        const orderData = globalServerOrders.find(o => o.id === orderId);
        if (orderData && !orderData.makingStartTime) {
            orderData.makingStartTime = Date.now();
        }
    } else if (newStatus === 'completed') {
        showToast('訂單已送達！');
    } else if (newStatus === 'rejected') {
        showToast('已退回訂單');
    }
    
    const orderIndex = globalServerOrders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) globalServerOrders[orderIndex].status = newStatus;

    // 將卡片搬移到對應的欄位
    const targetList = getListByStatus(newStatus);
    if (card.parentElement !== targetList) {
        targetList.appendChild(card);
    }

    checkOvertime(); 

    setTimeout(() => {
        reorderColumnDOM(targetList);
        updateCountsAndTitle();
        renderBatchSummaryBar();
    }, 300);
}

// Kanban Drag and Drop logic
function initKanbanSortable() {
    const lists = [
        document.getElementById('list-pending'),
        document.getElementById('list-making'),
        document.getElementById('list-completed')
    ];

    lists.forEach(list => {
        if (!list) return;
        new Sortable(list, {
            group: 'kanban', 
            handle: '.drag-handle',
            filter: 'button, .card-img, .card-guest', 
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: function (evt) {
                const itemEl = evt.item; 
                const toList = evt.to;   
                
                const orderId = itemEl.id.replace('order-', '');
                const newStatus = toList.dataset.status;
                
                const orderData = globalServerOrders.find(o => o.id === orderId);
                if (!orderData) return;

                const oldStatus = orderData.status || 'pending';
                
                if (newStatus && newStatus !== oldStatus) {
                    updateStatus(orderId, newStatus, itemEl);
                }
            },
            onSort: function(evt) {
                const itemEl = evt.item; 
                const toList = evt.to;
                const fromList = evt.from;
                const newStatus = toList.dataset.status;

                // 如果是在同一個列表內拖曳，觸發重排序邏輯，而不呼叫 onEnd 中的狀態切換
                if (fromList === toList && newStatus !== 'completed') {
                    const newOrderIds = Array.from(toList.querySelectorAll('.order-card')).map(el => el.id.replace('order-', ''));
                    socket.emit('reorder-orders-partial', {status: newStatus, ids: newOrderIds});
                }
            }
        });
    });
}

socket.on('sync-avatars', (avatars) => {
    globalAvatars = avatars;
    if (globalServerOrders.length > 0) renderAllOrders(); 
});

function clearFinished() {
    socket.emit('clear-finished-from-dashboard', () => {
        showToast('✅ 伺服器已確認清理！不會再跑出來了');
    });
}

function resetAllHistory() {
    if (confirm('⚠️ 警告：這將會永久刪除所有訂單與「歷史排行榜」資料！\n這項操作無法復原，確定要重置系統嗎？')) {
        const password = prompt('請輸入刪除確認碼 (輸入 0000 即可清空)：');
        if (password === '0000') {
            const allIds = globalServerOrders.map(o => o.id);
            allIds.forEach(id => socket.emit('delete-order', id));
            showToast('✅ 系統資料與歷史排行榜已全數清空！');
        } else if (password !== null) {
            alert('確認碼錯誤，已取消操作。');
        }
    }
}

function openImageModal(src) {
    const modalOverlay = document.getElementById('image-modal-overlay');
    const modalImage = document.getElementById('modal-image');
    
    modalOverlay.style.opacity = '0';
    modalOverlay.style.transition = 'none';

    modalImage.style.transition = 'none';
    modalImage.style.transform = 'scale(0.5)';
    modalImage.style.opacity = '0';

    modalImage.src = src;
    modalOverlay.classList.add('visible');
    
    void modalImage.offsetWidth;
    void modalOverlay.offsetWidth;

    modalOverlay.style.transition = 'opacity 0.3s ease';
    modalOverlay.style.opacity = '1';

    modalImage.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out';
    modalImage.style.transform = 'scale(1)';
    modalImage.style.opacity = '1';

    modalImage.onclick = closeImageModal;
    modalOverlay.onclick = closeImageModal;
}
function closeImageModal() {
    const modalOverlay = document.getElementById('image-modal-overlay');
    const modalImage = document.getElementById('modal-image');

    modalImage.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-in';
    modalImage.style.transform = 'scale(0.8)';
    modalImage.style.opacity = '0';
    
    modalOverlay.style.transition = 'opacity 0.3s ease';
    modalOverlay.style.opacity = '0';
    
    setTimeout(() => {
        modalOverlay.classList.remove('visible');
        modalOverlay.style.opacity = '';
        modalOverlay.style.transition = '';
        if (!modalOverlay.classList.contains('visible')) {
            modalImage.src = '';
        }
    }, 300);
}

// --- 每日出杯統計邏輯 ---
function showTodayStats() {
    const overlay = document.getElementById('stats-modal-overlay');
    const body = document.getElementById('stats-modal-body');
    
    const todayStr = new Date().toDateString();
    let totalCups = 0;
    const drinkStats = {};

    globalServerOrders.forEach(o => {
        if (o.status !== 'completed' || !o.id) return;
        const ts = parseInt(o.id.split('-')[0]);
        if (new Date(ts).toDateString() === todayStr) {
            totalCups++;
            drinkStats[o.drink] = (drinkStats[o.drink] || 0) + 1;
        }
    });

    if (totalCups === 0) {
        body.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">今日尚無完成的訂單紀錄 🥲</p>';
    } else {
        const sortedDrinks = Object.entries(drinkStats).sort((a, b) => b[1] - a[1]);
        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(155, 89, 182, 0.15); border: 1px solid rgba(155, 89, 182, 0.4); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <span style="font-size: 1.1em; font-weight: bold; color: #e0e0e0;">總出杯量：</span>
                <span style="font-size: 1.8em; font-weight: bold; color: #9b59b6;">${totalCups} <span style="font-size: 0.5em; color: #aaa; font-weight: normal;">杯</span></span>
            </div>
            <h3 style="color: #f39c12; margin-bottom: 12px; font-size: 1.05em;">🍹 各品項銷售排行</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
        `;

        sortedDrinks.forEach(([drink, count], index) => {
            const medals = ['🥇', '🥈', '🥉'];
            const rank = index < 3 ? medals[index] : `<span style="display:inline-block; width: 22px; text-align:center; color:#888;">${index+1}.</span>`;
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #222; padding: 10px 15px; border-radius: 6px; border: 1px solid #333;">
                    <div style="font-size: 1.05em; color: #fff;">${rank} <span style="margin-left: 5px;">${drink}</span></div>
                    <div style="font-weight: bold; color: #3498db; font-size: 1.1em;">${count} <span style="font-size: 0.7em; color: #888; font-weight: normal;">杯</span></div>
                </div>
            `;
        });
        html += `</div>`;
        body.innerHTML = html;
    }

    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
}

function closeStatsModal() {
    const overlay = document.getElementById('stats-modal-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.visibility = 'hidden'; }, 300);
}

function exportTodayStats() {
    const todayStr = new Date().toDateString();
    let totalCups = 0;
    const drinkStats = {};
    globalServerOrders.forEach(o => {
        if (o.status !== 'completed' || !o.id) return;
        const ts = parseInt(o.id.split('-')[0]);
        if (new Date(ts).toDateString() === todayStr) {
            totalCups++;
            drinkStats[o.drink] = (drinkStats[o.drink] || 0) + 1;
        }
    });
    if (totalCups === 0) { showToast('⚠️ 今日尚無資料可匯出'); return; }

    const sortedDrinks = Object.entries(drinkStats).sort((a, b) => b[1] - a[1]);
    const dateText = new Date().toLocaleDateString('zh-TW');
    let text = `📅 【${dateText}】 營業統計\n`;
    text += `━━━━━━━━━━━━━━\n`;
    text += `✅ 總出杯量：${totalCups} 杯\n`;
    text += `━━━━━━━━━━━━━━\n`;
    text += `🍹 銷售明細：\n`;
    sortedDrinks.forEach(([drink, count]) => { text += `• ${drink}: ${count} 杯\n`; });
    text += `━━━━━━━━━━━━━━\n`;

    navigator.clipboard.writeText(text).then(() => {
        showToast('✅ 報表已複製到剪貼簿！可直接貼上至 Line 回報');
    }).catch(() => { showToast('⚠️ 複製失敗，請手動圈選文字'); });
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('inventory-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderInventory(false));
    }

    // 讓所有 Modal 都支援點擊背景黑幕關閉
    const overlays = ['.modal-overlay'];
    overlays.forEach(selector => {
        const els = document.querySelectorAll(selector);
        els.forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el) {
                    if (el.id === 'edit-recipe-modal-overlay') closeEditRecipeModal();
                    else if (el.id === 'stats-modal-overlay') closeStatsModal();
                    else if (el.id === 'guest-history-modal-overlay') closeGuestHistoryModal();
                    else if (el.id === 'adjust-leaderboard-modal-overlay') closeAdjustLeaderboardModal();
                    else if (el.id === 'campaign-modal-overlay') closeCampaignModal();
                }
            });
        });
    });
});

function checkOvertime() {
    const thresholdInput = document.getElementById('overtime-threshold');
    if (!thresholdInput) return;
    const thresholdMins = parseInt(thresholdInput.value) || 15;
    const thresholdMs = thresholdMins * 60 * 1000;
    const now = Date.now();
    const autoHideMs = 10 * 60 * 1000; // 10分鐘自動隱藏

    globalServerOrders.forEach(order => {
        // --- 10 分鐘自動清理已結束訂單 ---
        if (order.status === 'completed' || order.status === 'rejected') {
            if (!finishedTimes[order.id]) {
                finishedTimes[order.id] = now; 
            } else if (now - finishedTimes[order.id] >= autoHideMs) {
                if (!localHiddenOrders.has(order.id)) {
                    localHiddenOrders.add(order.id);
                    const el = document.getElementById('order-' + order.id);
                    if (el) {
                        el.style.transition = '0.3s';
                        el.style.transform = 'scale(0.9)';
                        el.style.opacity = '0';
                        setTimeout(() => { el.remove(); updateCountsAndTitle(); }, 300);
                    }
                }
            }
        } else {
            delete finishedTimes[order.id];
            localHiddenOrders.delete(order.id);
        }

        const orderEl = document.getElementById('order-' + order.id);
        if (!orderEl) return;

        if (order.status === 'pending' || order.status === 'making') {
            const orderTime = parseInt(order.id.split('-')[0]);
            const elapsedMs = now - orderTime;
            let warningText = orderEl.querySelector('.overtime-warning');

            if (elapsedMs >= thresholdMs) {
                orderEl.classList.add('status-overtime');
                const elapsedMins = Math.floor(elapsedMs / 60000);
                if (warningText) warningText.innerText = `⚠️ 等待 ${elapsedMins} 分`;
            } else {
                orderEl.classList.remove('status-overtime');
            }
        } else {
            orderEl.classList.remove('status-overtime');
        }
    });
}

setInterval(checkOvertime, 1000); // 縮短更新頻率以讓進度條平滑

function openEditRecipeModal(drinkName = '') {
    const modal = document.getElementById('edit-recipe-modal-overlay');
    const title = document.getElementById('edit-modal-title');
    const nameInput = document.getElementById('edit-recipe-name');
    const abvInput = document.getElementById('edit-recipe-abv');
    const strongInput = document.getElementById('edit-recipe-strong');
    const sourInput = document.getElementById('edit-recipe-sour');
    const tagsInput = document.getElementById('edit-recipe-tags');
    const descInput = document.getElementById('edit-recipe-description');
    const imageInput = document.getElementById('edit-recipe-image');
    const previewContainer = document.getElementById('edit-image-preview-container');
    const quickSelect = document.getElementById('quick-ingredient-select');
    const quickAmount = document.getElementById('quick-ingredient-amount');
    
    if (imageInput) imageInput.value = ''; 
    if (previewContainer) {
        previewContainer.style.display = 'none';
        document.getElementById('edit-image-preview').src = '';
    }
    if (quickSelect) quickSelect.value = '';
    if (quickAmount) quickAmount.value = '';

    const hiddenEditPreset = document.getElementById('selected-edit-preset-image');
    if (hiddenEditPreset) hiddenEditPreset.value = '';
    document.querySelectorAll('.edit-preset-img-option').forEach(el => {
        el.style.borderColor = 'transparent';
        el.style.boxShadow = 'none';
    });
    
    // Reset new image tab UI
    const hiddenExisting = document.getElementById('selected-edit-existing-image');
    if (hiddenExisting) hiddenExisting.value = '';
    const existingPreview = document.getElementById('existing-img-selected-preview');
    if (existingPreview) existingPreview.style.display = 'none';
    const searchInput = document.getElementById('existing-img-search');
    if (searchInput) searchInput.value = '';
    switchImgTab('upload'); // 預設回到「上傳」tab
    loadExistingImages();   // 非同步載入既有圖片清單

    if (drinkName) {
        title.innerText = '✏️ 編輯酒單配方';
        const drink = allDrinks.find(d => d.name === drinkName);
        nameInput.value = drink.name;
        nameInput.readOnly = true; 
        nameInput.style.opacity = '0.5';
        abvInput.value = drink.abv || 0;
        strongInput.value = drink.strong || 1;
        sourInput.value = drink.sour || 1;
        tagsInput.value = (drink.tags || []).join(', ');
        descInput.value = drink.description || '';
    } else {
        title.innerText = '➕ 新增酒單配方';
        nameInput.value = '';
        nameInput.readOnly = false;
        nameInput.style.opacity = '1';
        abvInput.value = '';
        strongInput.value = '';
        sourInput.value = '';
        tagsInput.value = '';
        descInput.value = '';
    }

    modal.classList.add('visible');
}

function closeEditRecipeModal() {
    const modal = document.getElementById('edit-recipe-modal-overlay');
    modal.classList.remove('visible');
}

function previewCroppedImage(event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('edit-image-preview-container');
    const previewImg = document.getElementById('edit-image-preview');

    if (file) {
        const hiddenEditPreset = document.getElementById('selected-edit-preset-image');
        if (hiddenEditPreset) hiddenEditPreset.value = '';
        document.querySelectorAll('.edit-preset-img-option').forEach(el => {
            el.style.borderColor = 'transparent';
            el.style.boxShadow = 'none';
        });

        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = Math.min(img.width, img.height);
                const startX = (img.width - size) / 2;
                const startY = (img.height - size) / 2;
                const targetSize = Math.min(size, 800);
                canvas.width = targetSize;
                canvas.height = targetSize;
                ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);
                
                previewImg.src = canvas.toDataURL('image/jpeg', 0.85);
                previewContainer.style.display = 'block'; 
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        previewContainer.style.display = 'none';
    }
}

function saveRecipe() {
    const name = document.getElementById('edit-recipe-name').value.trim();
    if (!name) { showToast('⚠️ 酒名不能為空！'); return; }

    const tagsRaw = document.getElementById('edit-recipe-tags').value;
    const tags = tagsRaw.split(/[,、，]/).map(t => t.trim()).filter(t => t);

    const recipeData = {
        name: name,
        abv: parseFloat(document.getElementById('edit-recipe-abv').value) || 0,
        strong: parseInt(document.getElementById('edit-recipe-strong').value) || 1,
        sour: parseInt(document.getElementById('edit-recipe-sour').value) || 1,
        tags: tags,
        description: document.getElementById('edit-recipe-description').value
    };

    const imageInput = document.getElementById('edit-recipe-image');
    const file = imageInput ? imageInput.files[0] : null;
    const presetImage = document.getElementById('selected-edit-preset-image')?.value || '';
    const existingImage = document.getElementById('selected-edit-existing-image')?.value || '';
    recipeData.presetImage = presetImage;
    recipeData.existingImage = existingImage;

    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const size = Math.min(img.width, img.height);
                const startX = (img.width - size) / 2;
                const startY = (img.height - size) / 2;
                
                const targetSize = Math.min(size, 800);
                canvas.width = targetSize;
                canvas.height = targetSize;
                
                ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);
                
                recipeData.imageData = canvas.toDataURL('image/jpeg', 0.85);
                recipeData.imageExtension = 'jpg';
                
                socket.emit('save-recipe', recipeData);
                closeEditRecipeModal();
                showToast(`正在儲存 ${name} 的配方與圖片...`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        socket.emit('save-recipe', recipeData);
        closeEditRecipeModal();
        const imgMsg = existingImage ? `（套用既有圖：${existingImage}）` : '';
        showToast(`正在儲存 ${name} 的配方...${imgMsg}`);
    }
}

function insertIngredientToDesc() {
    const select = document.getElementById('quick-ingredient-select');
    const amount = document.getElementById('quick-ingredient-amount');
    const textarea = document.getElementById('edit-recipe-description');

    if (!select.value) {
        showToast('⚠️ 請先選擇要插入的材料！');
        return;
    }

    const insertText = select.value + (amount.value.trim() ? ' ' + amount.value.trim() : '');
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const textBefore = textarea.value.substring(0, startPos);
    const textAfter = textarea.value.substring(endPos, textarea.value.length);

    let prefix = '';
    if (textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n') && !textBefore.endsWith('：') && !textBefore.endsWith(':') && !textBefore.endsWith('、') && !textBefore.endsWith('，')) {
        prefix = ', ';
    }

    textarea.value = textBefore + prefix + insertText + textAfter;
    textarea.selectionStart = textarea.selectionEnd = startPos + prefix.length + insertText.length;
    textarea.focus(); 
    amount.value = '';
}

function updateClock() {
    const clockEl = document.getElementById('digital-clock');
    if (!clockEl) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clockEl.innerText = `${hh}:${mm}:${ss}`;
}
setInterval(updateClock, 1000);
updateClock(); 

function showGuestHistory(guestName) {
    const modal = document.getElementById('guest-history-modal-overlay');
    
    const guestOrders = globalServerOrders.filter(o => o.guest === guestName).sort((a, b) => parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0]));
    const avatarUrl = getAvatarUrl(guestName);
    document.getElementById('guest-history-title').innerHTML = `<img src="${avatarUrl}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 12px; border: 1px solid #555; background: #000;"> ${guestName} 的點餐紀錄`;

    const listContainer = document.getElementById('guest-history-list');
    if (guestOrders.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #888; margin: 20px 0;">目前查無紀錄</p>';
    } else {
        const drinkCounts = {};
        guestOrders.forEach(o => {
            if (o.status === 'completed') { 
                drinkCounts[o.drink] = (drinkCounts[o.drink] || 0) + 1;
            }
        });
        const top3 = Object.entries(drinkCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        let top3Html = '';
        if (top3.length > 0) {
            const medals = ['🥇', '🥈', '🥉'];
            top3Html = `<div style="background: rgba(243, 156, 18, 0.1); border: 1px solid rgba(243, 156, 18, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 15px;">
                <div style="font-size: 0.9em; color: #f39c12; margin-bottom: 8px; font-weight: bold;">🏆 常點的 Top 3：</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${top3.map((item, index) => {
                        const encodedNameTop3 = encodeURIComponent(item[0]);
                        const imgSrcTop3 = `/images/${encodedNameTop3}.jpg?t=${Date.now()}`;
                        return `<span style="background: #111; border: 1px solid #333; padding: 6px 12px; border-radius: 20px; font-size: 0.9em; color: #fff; cursor: pointer; transition: 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.5);" onmouseover="this.style.background='rgba(243,156,18,0.2)'; this.style.borderColor='#f39c12';" onmouseout="this.style.background='#111'; this.style.borderColor='#333';" onclick="openImageModal('${imgSrcTop3}')">${medals[index]} ${item[0]} <span style="color:#f39c12; font-weight:bold; margin-left:6px;">${item[1]}杯</span></span>`;
                    }).join('')}
                </div>
            </div>`;
        }

        const statusMap = { 'pending': ['#888', '⌛ 待接單'], 'making': ['#3498db', '👨‍🍳 製作中'], 'completed': ['#27ae60', '✅ 已出餐'], 'rejected': ['#e74c3c', '🚫 已退單'] };
        
        listContainer.innerHTML = top3Html + `<div style="display: flex; flex-direction: column; gap: 10px;">` + guestOrders.map(o => {
            const ts = parseInt(o.id.split('-')[0]);
            const dateDisplay = !isNaN(ts) ? new Date(ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';
            const [color, text] = statusMap[o.status || 'pending'];
            const encodedName = encodeURIComponent(o.drink);
            const imgSrc = `/images/${encodedName}.jpg?t=${Date.now()}`;
            return `
                <div style="background: #111; border: 1px solid #333; border-left: 4px solid ${color}; border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#1a1a1a'" onmouseout="this.style.background='#111'">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <img src="${imgSrc}" onclick="openImageModal('${imgSrc}')" style="width: 48px; height: 48px; border-radius: 6px; object-fit: contain; background: #000; cursor: zoom-in;">
                        <div>
                            <div style="font-weight: bold; font-size: 1.1em; color: #fff; margin-bottom: 4px;">${o.drink}</div>
                            <div style="font-size: 0.85em; color: #888; font-family: monospace;">📅 ${dateDisplay} ${o.time}</div>
                            ${o.notes ? `<div style="font-size: 0.85em; color: #f39c12; margin-top: 4px;">⚠️ ${o.notes}</div>` : ''}
                        </div>
                    </div>
                    <div style="color: ${color}; font-weight: bold; font-size: 0.9em;">${text}</div>
                </div>
            `;
        }).join('') + `</div>`;
    }

    modal.classList.add('visible');
}

function closeGuestHistoryModal() {
    const modal = document.getElementById('guest-history-modal-overlay');
    if (modal) modal.classList.remove('visible');
}

// ==================== 調整歷史榜單相關功能 ====================
function openAdjustLeaderboardModal() {
    const modal = document.getElementById('adjust-leaderboard-modal-overlay');
    if (!modal) return;

    // Reset Inputs
    document.getElementById('manual-guest-name').value = '';
    document.getElementById('manual-custom-drink-name').value = '';
    document.getElementById('adjust-search-input').value = '';
    const dateFilter = document.getElementById('adjust-date-filter');
    if (dateFilter) dateFilter.innerHTML = ''; // Clear to trigger default date selection
    
    // Set default date input to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('manual-order-date');
    if (dateInput) {
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
    
    // Populate Drink Select
    const select = document.getElementById('manual-drink-select');
    if (select) {
        let optionsHtml = `<option value="">-- 請選擇飲品 --</option>`;
        
        // 酒單上沒有的自訂特調 (放到最上面)
        optionsHtml += `<optgroup label="✨ 自訂特調">`;
        optionsHtml += `<option value="來一杯shot">來一杯shot</option>`;
        optionsHtml += `<option value="custom-fosen">佛森特調 (自訂特調)</option>`;
        optionsHtml += `<option value="custom-other">其他自訂飲品...</option>`;
        optionsHtml += `</optgroup>`;

        // 酒單上的飲品 (排除已在自訂特調中的項目)
        if (allDrinks && allDrinks.length > 0) {
            optionsHtml += `<optgroup label="📋 酒單上飲品">`;
            allDrinks.forEach(d => {
                if (d.name === '來一杯shot') return; // 已移至自訂特調區塊
                optionsHtml += `<option value="${d.name}">${d.name}</option>`;
            });
            optionsHtml += `</optgroup>`;
        }
        
        select.innerHTML = optionsHtml;
        select.value = '';
    }
    
    // Hide custom input wrap
    const customWrap = document.getElementById('manual-custom-drink-wrap');
    if (customWrap) customWrap.style.display = 'none';

    // Populate Guests Checkboxes List
    const container = document.getElementById('guest-checkboxes-container');
    if (container) {
        const guests = [...new Set(globalServerOrders.map(o => o.guest))].filter(g => g).sort((a, b) => a.localeCompare(b, 'zh-hant'));
        container.innerHTML = guests.map(g => `
            <div style="display: flex; align-items: center; gap: 6px;">
                <input type="checkbox" value="${g}" id="guest-cb-${g}" style="cursor: pointer; width: 16px; height: 16px;">
                <label for="guest-cb-${g}" style="color: #ccc; font-size: 0.9em; cursor: pointer; user-select: none;">${g}</label>
            </div>
        `).join('');
    }

    renderAdjustHistoryList();
    modal.classList.add('visible');
}

// --- 調整榜單輔助函式 ---
function addTypedGuestToSelection() {
    const nameInput = document.getElementById('manual-guest-name');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) return;

    const container = document.getElementById('guest-checkboxes-container');
    if (!container) return;

    const existingCheckboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const found = existingCheckboxes.find(cb => cb.value.toLowerCase() === name.toLowerCase());

    if (found) {
        found.checked = true;
        found.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '6px';
        div.innerHTML = `
            <input type="checkbox" value="${name}" id="guest-cb-${name}" checked style="cursor: pointer; width: 16px; height: 16px;">
            <label for="guest-cb-${name}" style="color: #ffd700; font-size: 0.9em; cursor: pointer; user-select: none;">${name} (新)</label>
        `;
        container.insertBefore(div, container.firstChild);
        container.scrollTop = 0;
    }
    nameInput.value = '';
}

function selectAllGuests() {
    const container = document.getElementById('guest-checkboxes-container');
    if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    }
}

function clearAllGuests() {
    const container = document.getElementById('guest-checkboxes-container');
    if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    }
}

function closeAdjustLeaderboardModal() {
    const modal = document.getElementById('adjust-leaderboard-modal-overlay');
    if (modal) modal.classList.remove('visible');
}



function openCampaignModal() {
    const modal = document.getElementById('campaign-modal-overlay');
    if (!modal) return;
    document.getElementById('campaign-active').checked = !!globalCampaign.active;
    document.getElementById('campaign-tag-input').value = globalCampaign.tag || '';
    document.getElementById('campaign-text-input').value = globalCampaign.text || '';
    document.getElementById('campaign-style-select').value = globalCampaign.style || 'gold';
    modal.classList.add('visible');
}

function closeCampaignModal() {
    const modal = document.getElementById('campaign-modal-overlay');
    if (modal) modal.classList.remove('visible');
}

function submitCampaignSettings() {
    const active = document.getElementById('campaign-active').checked;
    const tag = document.getElementById('campaign-tag-input').value.trim();
    const text = document.getElementById('campaign-text-input').value.trim();
    const style = document.getElementById('campaign-style-select').value;

    if (active && !text) {
        showToast('⚠️ 啟用活動時，活動內容說明不可為空！', true);
        return;
    }

    socket.emit('update-campaign', { active, tag, text, style });
    closeCampaignModal();
    showToast('📢 活動設定已更新並同步至所有客戶端！');
}

function handleManualDrinkSelectChange() {
    const select = document.getElementById('manual-drink-select');
    const customWrap = document.getElementById('manual-custom-drink-wrap');
    const customInput = document.getElementById('manual-custom-drink-name');
    if (!select || !customWrap || !customInput) return;

    if (select.value === 'custom-fosen') {
        customWrap.style.display = 'block';
        customInput.value = '佛森特調';
    } else if (select.value === 'custom-other') {
        customWrap.style.display = 'block';
        customInput.value = '';
        customInput.focus();
    } else {
        customWrap.style.display = 'none';
        customInput.value = '';
    }
}

window.selectPresetImage = function(element) {
    const hiddenInput = document.getElementById('selected-preset-image');
    const presetName = element.getAttribute('data-preset');
    if (!hiddenInput) return;

    if (hiddenInput.value === presetName) {
        // 取消選取
        element.style.borderColor = 'transparent';
        element.style.boxShadow = 'none';
        hiddenInput.value = '';
    } else {
        // 選取
        document.querySelectorAll('.preset-img-option').forEach(el => {
            el.style.borderColor = 'transparent';
            el.style.boxShadow = 'none';
        });
        element.style.borderColor = '#f39c12';
        element.style.boxShadow = '0 0 8px rgba(243, 156, 18, 0.6)';
        hiddenInput.value = presetName;
    }
};

window.selectEditPresetImage = function(element) {
    const hiddenInput = document.getElementById('selected-edit-preset-image');
    const presetName = element.getAttribute('data-preset');
    if (!hiddenInput) return;

    if (hiddenInput.value === presetName) {
        element.style.borderColor = 'transparent';
        element.style.boxShadow = 'none';
        hiddenInput.value = '';
    } else {
        document.querySelectorAll('.edit-preset-img-option').forEach(el => {
            el.style.borderColor = 'transparent';
            el.style.boxShadow = 'none';
        });
        element.style.borderColor = '#f39c12';
        element.style.boxShadow = '0 0 8px rgba(243, 156, 18, 0.6)';
        hiddenInput.value = presetName;
        
        // Clear file input when preset is selected
        const fileInput = document.getElementById('edit-recipe-image');
        if (fileInput) fileInput.value = '';
        const previewContainer = document.getElementById('edit-image-preview-container');
        if (previewContainer) {
            previewContainer.style.display = 'none';
            document.getElementById('edit-image-preview').src = '';
        }
    }
};

// ==================== 圖片選擇功能 ====================

let _allExistingImages = []; // 快取圖片清單

function switchImgTab(tab) {
    const uploadPanel = document.getElementById('img-tab-panel-upload');
    const existingPanel = document.getElementById('img-tab-panel-existing');
    const uploadBtn = document.getElementById('img-tab-upload');
    const existingBtn = document.getElementById('img-tab-existing');
    if (!uploadPanel || !existingPanel) return;

    if (tab === 'upload') {
        uploadPanel.style.display = 'block';
        existingPanel.style.display = 'none';
        if (uploadBtn) { uploadBtn.style.background = '#333'; uploadBtn.style.color = '#f39c12'; }
        if (existingBtn) { existingBtn.style.background = '#222'; existingBtn.style.color = '#888'; }
    } else {
        uploadPanel.style.display = 'none';
        existingPanel.style.display = 'block';
        if (uploadBtn) { uploadBtn.style.background = '#222'; uploadBtn.style.color = '#888'; }
        if (existingBtn) { existingBtn.style.background = '#333'; existingBtn.style.color = '#f39c12'; }
        renderExistingImageGrid(_allExistingImages);
    }
}

function loadExistingImages() {
    fetch(`/api/images?t=${Date.now()}`)
        .then(r => r.json())
        .then(files => {
            _allExistingImages = files;
        })
        .catch(() => { _allExistingImages = []; });
}

function renderExistingImageGrid(files) {
    const grid = document.getElementById('existing-img-grid');
    if (!grid) return;
    const searchTerm = (document.getElementById('existing-img-search')?.value || '').toLowerCase();
    const filtered = files.filter(f => f.toLowerCase().includes(searchTerm));
    const selectedVal = document.getElementById('selected-edit-existing-image')?.value || '';

    if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#555; padding:20px; font-size:0.85em;">找不到符合的圖片 🔍</div>`;
        return;
    }

    grid.innerHTML = filtered.map(filename => {
        const encodedName = encodeURIComponent(filename);
        const isSelected = selectedVal === filename;
        const label = filename.replace(/\.[^.]+$/, ''); // 去副檔名
        return `
            <div onclick="selectExistingImage('${filename.replace(/'/g, "\\'")}')"
                data-filename="${filename}"
                title="${label}"
                style="cursor:pointer; border-radius:6px; overflow:hidden; border:2px solid ${isSelected ? '#f39c12' : 'transparent'};
                       box-shadow:${isSelected ? '0 0 8px rgba(243,156,18,0.6)' : 'none'};
                       transition:border-color 0.2s, box-shadow 0.2s; background:#000; aspect-ratio:1; display:flex; flex-direction:column; align-items:center;">
                <img src="/images/${encodedName}?t=${Date.now()}" loading="lazy"
                    style="width:100%; height:100%; object-fit:contain;"
                    onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nIzQ0NCc+PHBhdGggZD0nTTIxIDNIM3YybDggOHY3SDd2MmgxMHYtMmgtNHYtN2w4LThWM3onLz48L3N2Zz4='">
            </div>
        `;
    }).join('');
}

function filterExistingImages() {
    renderExistingImageGrid(_allExistingImages);
}

function selectExistingImage(filename) {
    const hiddenInput = document.getElementById('selected-edit-existing-image');
    if (!hiddenInput) return;

    if (hiddenInput.value === filename) {
        // 取消選取
        hiddenInput.value = '';
        const preview = document.getElementById('existing-img-selected-preview');
        if (preview) preview.style.display = 'none';
    } else {
        hiddenInput.value = filename;

        // 顯示選取預覽
        const preview = document.getElementById('existing-img-selected-preview');
        const thumb = document.getElementById('existing-img-selected-thumb');
        const nameEl = document.getElementById('existing-img-selected-name');
        if (preview && thumb && nameEl) {
            thumb.src = `/images/${encodeURIComponent(filename)}?t=${Date.now()}`;
            nameEl.textContent = `✅ 已選：${filename.replace(/\.[^.]+$/, '')}`;
            preview.style.display = 'flex';
        }

        // 清除上傳檔案
        const fileInput = document.getElementById('edit-recipe-image');
        if (fileInput) fileInput.value = '';
        const previewContainer = document.getElementById('edit-image-preview-container');
        if (previewContainer) {
            previewContainer.style.display = 'none';
            const imgEl = document.getElementById('edit-image-preview');
            if (imgEl) imgEl.src = '';
        }
    }
    renderExistingImageGrid(_allExistingImages);
}

function clearExistingImageSelection() {
    const hiddenInput = document.getElementById('selected-edit-existing-image');
    if (hiddenInput) hiddenInput.value = '';
    const preview = document.getElementById('existing-img-selected-preview');
    if (preview) preview.style.display = 'none';
    const searchInput = document.getElementById('existing-img-search');
    if (searchInput) searchInput.value = '';
    renderExistingImageGrid(_allExistingImages);
}

function submitManualCompletedOrder() {
    const nameInput = document.getElementById('manual-guest-name');
    const typedName = nameInput ? nameInput.value.trim() : '';
    
    const container = document.getElementById('guest-checkboxes-container');
    const checkedGuests = container ? Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value) : [];
    
    if (typedName && !checkedGuests.includes(typedName)) {
        checkedGuests.push(typedName);
    }
    
    if (checkedGuests.length === 0) {
        alert('⚠️ 請輸入或勾選客人！');
        return;
    }

    const drinkVal = document.getElementById('manual-drink-select').value;
    if (!drinkVal) {
        alert('⚠️ 請選擇要新增的飲品！');
        return;
    }

    let finalDrinkName = '';
    const presetImage = document.getElementById('selected-preset-image')?.value || '';

    if (drinkVal === 'custom-fosen' || drinkVal === 'custom-other') {
        const customName = document.getElementById('manual-custom-drink-name').value.trim();
        if (!customName) {
            alert('⚠️ 請輸入自訂飲品名稱！');
            return;
        }
        finalDrinkName = customName;
    } else {
        finalDrinkName = drinkVal;
    }

    const dateInput = document.getElementById('manual-order-date');
    const selectedDate = dateInput ? dateInput.value : '';
    
    let timestamp = Date.now();
    let isToday = true;
    if (selectedDate) {
        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
        isToday = (selectedDate === todayStr);
        
        const parts = selectedDate.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            const d = new Date();
            d.setFullYear(year, month, day);
            timestamp = d.getTime();
        }
    }

    // Emit event to add completed order for all selected/entered guests
    checkedGuests.forEach(guest => {
        socket.emit('add-manual-completed-order', {
            guest: guest,
            drink: finalDrinkName,
            time: new Date().toLocaleTimeString(),
            notes: '手動補單',
            status: 'completed',
            presetImage: presetImage,
            timestamp: timestamp,
            hiddenFromDashboard: !isToday
        });
    });

    showToast(`✅ 成功新增 ${checkedGuests.join(', ')} 的已完成調酒：${finalDrinkName}`);

    // Clear fields
    if (nameInput) nameInput.value = '';
    document.getElementById('manual-custom-drink-name').value = '';
    document.getElementById('manual-drink-select').value = '';
    document.getElementById('manual-custom-drink-wrap').style.display = 'none';
    
    // Uncheck checkboxes
    if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    }
    
    const hiddenInput = document.getElementById('selected-preset-image');
    if (hiddenInput) hiddenInput.value = '';
    document.querySelectorAll('.preset-img-option').forEach(el => {
        el.style.borderColor = 'transparent';
        el.style.boxShadow = 'none';
    });
}

function renderAdjustHistoryList() {
    const container = document.getElementById('adjust-history-list');
    if (!container) return;

    const searchTerm = document.getElementById('adjust-search-input').value.trim().toLowerCase();
    
    const todayStr = new Date().toLocaleDateString('zh-TW');
    const dateFilter = document.getElementById('adjust-date-filter');
    let selectedDate = 'all';

    // Filter out historical completed/rejected orders
    let historyOrders = globalServerOrders.filter(o => o.status === 'completed' || o.status === 'rejected');

    // Aggregate unique dates from all completed/rejected orders
    const uniqueDates = new Set();
    uniqueDates.add(todayStr);
    historyOrders.forEach(o => {
        const ts = parseInt(o.id.split('-')[0]);
        if (!isNaN(ts)) {
            uniqueDates.add(new Date(ts).toLocaleDateString('zh-TW'));
        }
    });

    // Populate or update the date selector dropdown
    if (dateFilter) {
        if (dateFilter.options.length > 0) {
            selectedDate = dateFilter.value;
        } else {
            // Default to today
            selectedDate = todayStr;
        }

        let optionsHtml = `<option value="all" ${selectedDate === 'all' ? 'selected' : ''}>📅 所有日期</option>`;
        Array.from(uniqueDates).forEach(dStr => {
            const label = dStr === todayStr ? `📅 今日 (${dStr})` : dStr;
            optionsHtml += `<option value="${dStr}" ${selectedDate === dStr ? 'selected' : ''}>${label}</option>`;
        });
        dateFilter.innerHTML = optionsHtml;
        selectedDate = dateFilter.value;
    }
    
    // Sort: newest first
    historyOrders.sort((a, b) => parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0]));

    // Filter by selected date
    if (selectedDate !== 'all') {
        historyOrders = historyOrders.filter(o => {
            const ts = parseInt(o.id.split('-')[0]);
            return !isNaN(ts) && new Date(ts).toLocaleDateString('zh-TW') === selectedDate;
        });
    }

    if (searchTerm) {
        historyOrders = historyOrders.filter(o => 
            o.guest.toLowerCase().includes(searchTerm) || 
            o.drink.toLowerCase().includes(searchTerm)
        );
    }

    if (historyOrders.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">無符合條件的歷史紀錄 🔍</p>';
        return;
    }

    const statusColors = {
        'completed': ['#27ae60', '已出餐'],
        'rejected': ['#e74c3c', '已退單']
    };

    container.innerHTML = historyOrders.map(o => {
        const ts = parseInt(o.id.split('-')[0]);
        const dateStr = !isNaN(ts) ? new Date(ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';
        const [color, statusText] = statusColors[o.status] || ['#888', o.status];
        const shortId = o.id.split('-')[0].slice(-5);
        const avatarUrl = getAvatarUrl(o.guest);
        const encodedDrink = encodeURIComponent(o.drink);
        const drinkImgJpg = `/images/${encodedDrink}.jpg`;
        const drinkImgPng = `/images/${encodedDrink}.png`;
        
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; background: #222; border: 1px solid #333; padding: 10px; border-radius: 8px; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                    <img src="${avatarUrl}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: #222; border: 1px solid #555; flex-shrink: 0;">
                    <img src="${drinkImgJpg}" onerror="handleImgError(this, '${drinkImgPng}')" onclick="openImageModal(this.src); event.stopPropagation();" title="點擊放大" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: #111; border: 1px solid #444; cursor: pointer; flex-shrink: 0; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.15)'; this.style.boxShadow='0 0 8px rgba(243,156,18,0.5)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-weight: bold; color: #fff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                            ${o.guest} ➔ <span style="color: #f39c12;">${o.drink}</span>
                        </div>
                        <div style="font-size: 0.8em; color: #888;">
                            #${shortId} | 📅 ${dateStr} ${o.time}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.8em; font-weight: bold; padding: 3px 6px; border-radius: 4px; background: ${color}20; color: ${color}; border: 1px solid ${color}40;">
                        ${statusText}
                    </span>
                    <button onclick="deleteHistoryOrder('${o.id}')" class="pos-btn btn-danger" style="padding: 5px 8px; font-size: 0.8em; border-radius: 4px;">✖ 刪除</button>
                </div>
            </div>
        `;
    }).join('');
}

function deleteHistoryOrder(orderId) {
    if (confirm('⚠️ 確定要刪除這筆歷史紀錄嗎？\n這會從資料庫中移除，並重新計算排行榜與統計數據！')) {
        socket.emit('delete-order', orderId);
        showToast('✅ 正在刪除該筆歷史紀錄...');
    }
}

function checkAndRenderAdjustList() {
    const modal = document.getElementById('adjust-leaderboard-modal-overlay');
    if (modal && modal.classList.contains('visible')) {
        renderAdjustHistoryList();
    }
}

// =====================================================
// 🔥 POS 同酒款批量製作匯總欄 (Batch Making Aggregator) Engine
// =====================================================
let selectedBatchDrink = null;

function renderBatchSummaryBar() {
    const bar = document.getElementById('batch-summary-bar');
    const pillsContainer = document.getElementById('batch-pills-container');
    const actionsContainer = document.getElementById('batch-actions-container');

    if (!bar || !pillsContainer || !actionsContainer) return;

    const activeOrders = globalServerOrders.filter(o => 
        !o.hiddenFromDashboard && 
        !localHiddenOrders.has(o.id) && 
        (o.status === 'pending' || o.status === 'making' || !o.status)
    );

    const drinkCounts = {};
    activeOrders.forEach(o => {
        drinkCounts[o.drink] = (drinkCounts[o.drink] || 0) + 1;
    });

    const entries = Object.entries(drinkCounts).filter(([_, count]) => count >= 1).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        bar.style.display = 'none';
        selectedBatchDrink = null;
        clearBatchCardHighlights();
        return;
    }

    bar.style.display = 'flex';

    pillsContainer.innerHTML = entries.map(([drink, count]) => {
        const isActive = selectedBatchDrink === drink;
        const safeDrink = drink.replace(/'/g, "\\'");
        return `
            <div class="batch-pill ${isActive ? 'active' : ''}" onclick="toggleBatchHighlight('${safeDrink}')" title="點擊高亮 ${drink} 所有卡片">
                <span>🍹 ${drink}</span>
                <span class="batch-pill-count">${count}</span>
            </div>
        `;
    }).join('');

    if (selectedBatchDrink && drinkCounts[selectedBatchDrink]) {
        const count = drinkCounts[selectedBatchDrink];
        const safeDrink = selectedBatchDrink.replace(/'/g, "\\'");
        actionsContainer.style.display = 'flex';
        actionsContainer.innerHTML = `
            <span style="font-size: 0.85em; color: #aaa;">⚡ 批次處理：</span>
            <button class="batch-action-btn btn-make" onclick="batchUpdateStatus('${safeDrink}', 'making')">👨‍🍳 開做 (${count}杯)</button>
            <button class="batch-action-btn btn-serve" onclick="batchUpdateStatus('${safeDrink}', 'completed')">✅ 全出餐 (${count}杯)</button>
            <button class="batch-action-btn btn-cancel" onclick="clearBatchHighlight()">✖ 取消</button>
        `;
    } else {
        selectedBatchDrink = null;
        actionsContainer.style.display = 'none';
        actionsContainer.innerHTML = '';
        clearBatchCardHighlights();
    }
}

function toggleBatchHighlight(drinkName) {
    if (selectedBatchDrink === drinkName) {
        clearBatchHighlight();
        return;
    }
    selectedBatchDrink = drinkName;
    renderBatchSummaryBar();
    applyBatchCardHighlights(drinkName);
}

function clearBatchHighlight() {
    selectedBatchDrink = null;
    clearBatchCardHighlights();
    renderBatchSummaryBar();
}

function clearBatchCardHighlights() {
    document.querySelectorAll('.order-card.batch-highlighted').forEach(card => {
        card.classList.remove('batch-highlighted');
    });
}

function applyBatchCardHighlights(drinkName) {
    clearBatchCardHighlights();
    let firstCard = null;

    globalServerOrders.forEach(o => {
        if (o.drink === drinkName && (o.status === 'pending' || o.status === 'making' || !o.status)) {
            const card = document.getElementById('order-' + o.id);
            if (card) {
                card.classList.add('batch-highlighted');
                if (!firstCard) firstCard = card;
            }
        }
    });

    if (firstCard) {
        firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function batchUpdateStatus(drinkName, newStatus) {
    const targetOrders = globalServerOrders.filter(o => 
        o.drink === drinkName && 
        !o.hiddenFromDashboard && 
        !localHiddenOrders.has(o.id) && 
        (o.status === 'pending' || o.status === 'making' || !o.status)
    );

    if (targetOrders.length === 0) return;

    targetOrders.forEach(o => {
        updateStatus(o.id, newStatus, null);
    });

    showToast(`⚡ 已將 ${targetOrders.length} 杯【${drinkName}】批次設為 ${newStatus === 'making' ? '製作中' : '已完成出餐'}！`);
    clearBatchHighlight();
}

// 📱 緊湊卡片檢視模式 Engine
let isCompactView = localStorage.getItem('bar_pos_compact_view') === 'true';

function applyCompactViewUI() {
    const container = document.getElementById('kanban-container');
    const btn = document.getElementById('btn-toggle-compact');
    if (container) {
        if (isCompactView) {
            container.classList.add('compact-mode');
        } else {
            container.classList.remove('compact-mode');
        }
    }
    if (btn) {
        btn.innerHTML = isCompactView ? '📖 展開卡片' : '📱 緊湊卡片';
    }
}

function toggleCompactCardView() {
    isCompactView = !isCompactView;
    localStorage.setItem('bar_pos_compact_view', isCompactView);
    applyCompactViewUI();
    showToast(isCompactView ? '📱 已切換至「緊湊卡片模式」！' : '📖 已切換至「詳細展開模式」！');
}

// 頁面載入時套用緊湊設定
document.addEventListener('DOMContentLoaded', () => {
    applyCompactViewUI();
});
setTimeout(applyCompactViewUI, 200);

// ⚙️ 吧台工具箱 (Compact Header Toolbox) Engine
function toggleToolboxMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('pos-toolbox-menu');
    if (menu) {
        menu.classList.toggle('visible');
    }
}

function closeToolboxMenu() {
    const menu = document.getElementById('pos-toolbox-menu');
    if (menu) {
        menu.classList.remove('visible');
    }
}

window.addEventListener('click', (e) => {
    const container = document.querySelector('.toolbox-dropdown-container');
    if (container && !container.contains(e.target)) {
        closeToolboxMenu();
    }
});
