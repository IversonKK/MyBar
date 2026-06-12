// 圖片載入失敗時的處理函式 (給予預設的酒杯 SVG 剪影)
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
let guestFavorites = []; // 儲存目前客人的最愛列表
let allDrinks = []; // 儲存所有酒單資訊供對照圖片
let currentName = localStorage.getItem('bar_guest_name');
let globalServerOrders = []; // 用來暫存伺服器的所有訂單，以計算即時榜單
let globalFilteredDrinks = []; // 用來暫存目前符合篩選條件的酒款，供隨機推薦使用
let knownGuestCounts = {}; // 用於記錄成就推播
let isLeaderboardFirstLoad = true; // 避免首次載入時觸發大量成就動畫

// 完整的 30 個 DiceBear v9 可用風格
const uniqueDicebearStyles = [
    'adventurer', 'adventurer-neutral', 'avataaars', 'avataaars-neutral', 
    'big-ears', 'big-ears-neutral', 'big-smile', 'bottts', 'bottts-neutral', 
    'croodles', 'croodles-neutral', 'dylan', 'fun-emoji', 'glass', 'icons', 
    'identicon', 'initials', 'lorelei', 'lorelei-neutral', 'micah', 'miniavs', 
    'notionists', 'notionists-neutral', 'open-peeps', 'personas', 'pixel-art', 
    'pixel-art-neutral', 'rings', 'shapes', 'thumbs'
];

let myAvatarStyle = localStorage.getItem('bar_guest_avatar_style');
let globalAvatars = {}; // 儲存所有客人的大頭貼風格
let globalRatings = {};
let myRatings = {};
let globalCampaign = { active: false, text: '', tag: '活動', style: 'gold' };
let achievementsUnlocked = {};
let isAchievementsFirstLoad = true;

// 根據名字產生固定的隨機風格，避免每次刷新頭像都變動
function getRandomStyleForName(name) {
    if (!name) return 'adventurer-neutral';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % uniqueDicebearStyles.length;
    return uniqueDicebearStyles[index];
}

function getAvatarUrl(guestName) {
    const style = globalAvatars[guestName] || (guestName === currentName && myAvatarStyle ? myAvatarStyle : getRandomStyleForName(guestName));
    if (style && style.startsWith('data:image/')) {
        return style; // It's a custom Base64 avatar
    }
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(guestName)}`;
}

// 智慧配方解析器：自動從材料中推算 ABV、酸度與酒感
function estimateDrinkProfile(drink) {
    if (!drink.description) return drink;

    const lines = drink.description.split(/\n/);
    let ingredientsLine = lines.find(l => l.trim().startsWith('材料：') || l.trim().startsWith('材料:'));
    if (!ingredientsLine) return drink; // 找不到材料就使用原數據

    const itemsRaw = ingredientsLine.replace(/材料[：:]/, '').split(/[、，,。]/).map(i => i.trim()).filter(i => i);
    
    let totalVolume = 0;
    let totalAlcohol = 0;
    let totalSourPoints = 0;

    // 常見材料屬性字典 (關鍵字匹配)
    const ingredientDB = [
        { keywords: ['無酒精', 'non-alcoholic', 'non alcoholic', 'zero proof'], abv: 0, sour: 0 }, // 防呆
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
        { keywords: ['酒', 'liquor', 'spirit', '酒精'], abv: 15, sour: 0 }, // 🔥 終極保底：只要名稱有「酒」，且沒被上面抓到，至少給 15%
        { keywords: ['檸檬汁', 'lemon juice', '萊姆汁', 'lime juice', '金桔', '柚子', '桔'], abv: 0, sour: 10 },
        { keywords: ['葡萄柚', 'grapefruit', '百香果'], abv: 0, sour: 6 },
        { keywords: ['柳橙', 'orange juice', '鳳梨', 'pineapple', '蔓越莓', 'cranberry', '蘋果汁', 'apple juice', '番茄汁', '葡萄', '果汁'], abv: 0, sour: 3 },
        { keywords: ['糖漿', 'syrup', '糖', 'sugar', '蜂蜜', 'honey', '紅石榴', 'grenadine', '焦糖'], abv: 0, sour: -5 }, // 糖會中和酸度
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
        let finalVolume = totalVolume * 1.20; // 模擬 20% 融水稀釋
        drink.abv = Math.round((totalAlcohol / finalVolume) * 100); // 覆寫濃度
        
        drink.strong = drink.abv < 5 ? 1 : drink.abv < 12 ? 2 : drink.abv < 20 ? 3 : drink.abv < 30 ? 4 : 5; // 覆寫酒感
        
        let avgSour = totalSourPoints / totalVolume;
        drink.sour = avgSour <= 0 ? 1 : avgSour <= 1.5 ? 2 : avgSour <= 3.0 ? 3 : avgSour <= 5.0 ? 4 : 5; // 覆寫酸度
    }
    return drink;
}

// 全域 Toast 提示函式
let toastTimeout;
function showToast(msg, type = false) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    if (type === true || type === 'error') {
        toast.style.background = '#e74c3c';
    } else if (type === 'warning') {
        toast.style.background = '#f39c12';
    } else {
        toast.style.background = '#27ae60';
    }
    toast.style.display = 'block';
    clearTimeout(toastTimeout); // 清除上一個計時器，防止快速閃爍時被提早關閉
    toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// 更新主標題顯示專屬稱呼與特效
function updateMainTitle() {
    const titleEl = document.getElementById('main-title');
    if (currentName) {
        const avatarUrl = getAvatarUrl(currentName);
        titleEl.innerHTML = `🍸 Iverson Bar<br><div style="display: flex; align-items: center; justify-content: center; margin-top: 10px; font-size: 0.6em; color: #aaa; font-weight: normal; letter-spacing: 1px;"><img src="${avatarUrl}" class="avatar title-avatar" alt="avatar" style="cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'" onclick="openAvatarModal()" title="點擊預覽與更換風格！"> 歡迎回來，<span class="greeting-name" style="margin-left: 5px; font-size: 1.2em;">${currentName}</span>！</div>`;
    } else {
        titleEl.innerHTML = `🍸 Iverson Bar`;
    }
}

if (currentName) {
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('achievements-container').style.display = 'block';
}
updateMainTitle();

// 初始化載入評分與活動資料
fetch('/api/ratings')
    .then(res => res.json())
    .then(data => {
        globalRatings = data;
        syncMyRatings();
        loadHistory();
        initAchievementsState();
    })
    .catch(err => {
        console.error("Error loading ratings:", err);
        initAchievementsState();
    });

fetch('/api/campaign')
    .then(res => res.json())
    .then(data => {
        globalCampaign = data;
        updateCampaignBanner(globalCampaign);
    })
    .catch(err => {
        console.error("Error loading campaign:", err);
    });

const avatarStyleNames = {
    'adventurer': '冒險家',
    'adventurer-neutral': '中性冒險',
    'avataaars': '經典人像',
    'avataaars-neutral': '中性經典',
    'big-ears': '大耳朵',
    'big-ears-neutral': '中性大耳',
    'big-smile': '大笑臉',
    'bottts': '彩色機器',
    'bottts-neutral': '復古機器',
    'croodles': '隨性塗鴉',
    'croodles-neutral': '中性塗鴉',
    'dylan': '嘻哈男孩',
    'fun-emoji': '表情符號',
    'glass': '毛玻璃',
    'icons': '趣味圖標',
    'identicon': '幾何色塊',
    'initials': '姓名縮寫',
    'lorelei': '蘿蕾萊',
    'lorelei-neutral': '水彩插畫',
    'micah': '潮流米卡',
    'miniavs': '迷你人像',
    'notionists': '隨筆手繪',
    'notionists-neutral': '簡約線條',
    'open-peeps': '黑白線條',
    'personas': '角色插畫',
    'pixel-art': '像素藝術',
    'pixel-art-neutral': '復古像素',
    'rings': '繽紛年輪',
    'shapes': '幾何圖形',
    'thumbs': '藝術指紋'
};

function openAvatarModal() {
    if (!currentName) return;
    const grid = document.getElementById('avatar-grid');
    
    let customAvatarHtml = '';
    if (myAvatarStyle && myAvatarStyle.startsWith('data:image/')) {
        customAvatarHtml = `
            <div class="avatar-option selected" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; border-color: #ffd700; box-shadow: 0 0 10px rgba(255, 215, 0, 0.4);">
                <img src="${myAvatarStyle}" alt="Custom" style="width: 80px; height: 80px; border: 2px solid #ffd700;">
                <span style="color: #ffd700; font-weight: bold; font-size: 1em; margin-top: 5px;">👑 您專屬的自訂頭像</span>
            </div>
        `;
    }

    grid.innerHTML = customAvatarHtml + uniqueDicebearStyles.map(style => {
        const previewUrl = `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(currentName)}`;
        const isSelected = (!myAvatarStyle.startsWith('data:image/') && style === myAvatarStyle);
        return `
            <div class="avatar-option ${isSelected ? 'selected' : ''}" onclick="selectAvatarStyle('${style}')">
                <img src="${previewUrl}" alt="${style}">
                <span>${avatarStyleNames[style] || style}</span>
            </div>
        `;
    }).join('');
    
    const modalOverlay = document.getElementById('avatar-modal-overlay');
    
    // 初始化狀態 (全透明)
    modalOverlay.style.opacity = '0';
    modalOverlay.style.transition = 'none';
    modalOverlay.style.zIndex = '99999'; // 確保黑底遮罩層級最高
    
    modalOverlay.classList.add('visible');
    
    // 鎖定背景捲動
    document.body.style.overflow = 'hidden';
    
    // 強制觸發瀏覽器重繪 (Reflow)
    void modalOverlay.offsetWidth;
    
    // 加上淡入動畫
    modalOverlay.style.transition = 'opacity 0.4s ease';
    modalOverlay.style.opacity = '1';
}

function closeAvatarModal() {
    const modalOverlay = document.getElementById('avatar-modal-overlay');
    
    // 加上淡出動畫
    modalOverlay.style.transition = 'opacity 0.4s ease';
    modalOverlay.style.opacity = '0';
    
    // 延遲等待動畫播完再隱藏
    setTimeout(() => {
        modalOverlay.classList.remove('visible');
        modalOverlay.style.opacity = '';
        modalOverlay.style.transition = '';
        // 恢復背景捲動
        document.body.style.overflow = '';
    }, 400);
}

function selectAvatarStyle(style) {
    myAvatarStyle = style;
    localStorage.setItem('bar_guest_avatar_style', myAvatarStyle);
    globalAvatars[currentName] = myAvatarStyle;
    updateMainTitle();
    renderLeaderboard();
    socket.emit('update-avatar', { guest: currentName, style: myAvatarStyle });
    showToast('🔄 已更換為「' + (avatarStyleNames[style] || style) + '」風格！');
    closeAvatarModal();
}

// 處理客人自訂大頭貼上傳
function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const targetSize = 256; // 將頭像統一縮放為 256x256

            // 計算置中裁切的起始座標
            const size = Math.min(img.width, img.height);
            const startX = (img.width - size) / 2;
            const startY = (img.height - size) / 2;

            canvas.width = targetSize;
            canvas.height = targetSize;

            // 將圖片畫入 Canvas (置中裁切並縮放)
            ctx.drawImage(img, startX, startY, size, size, 0, 0, targetSize, targetSize);

            // 轉換為 Base64 (強制轉為 JPEG 並壓縮品質 0.8，節省空間)
            const base64String = canvas.toDataURL('image/jpeg', 0.8);

            // --- 更新所有相關狀態 ---
            myAvatarStyle = base64String;
            localStorage.setItem('bar_guest_avatar_style', myAvatarStyle);
            globalAvatars[currentName] = myAvatarStyle;
            
            updateMainTitle();
            renderLeaderboard();
            
            socket.emit('update-avatar', { guest: currentName, style: myAvatarStyle });
            
            showToast('✅ 自訂頭像上傳成功！');
            closeAvatarModal();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 將描述文字轉換為點列式 HTML
function formatDescription(desc) {
    if (!desc) return "";
    const parts = desc.split(/\n/);
    let ingredientsHtml = "";

    parts.forEach(p => {
        let text = p.trim();
        if (!text) return;

        if (text.startsWith("材料：") || text.startsWith("材料:")) {
            // 有時候作法會不小心被逗號或句號連在材料後面，我們把它們全部打散來嚴格審查
            const items = text.replace(/材料[：:]/, "").split(/[、，,。]/).map(i => i.trim()).filter(i => i);
            ingredientsHtml = `<ul class="ingredient-tags">` + 
                items.map(i => {
                    // 1. 拔除所有數字、測量單位與模糊量詞
                    let cleanItem = i.replace(/((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*(ml|oz|dash|滴|份|cc|c\.c\.|g|克|片|塊|吧匙|tsp)/gi, '').trim();
                    cleanItem = cleanItem.replace(/\d+/g, '').trim();
                    cleanItem = cleanItem.replace(/(適量|少許|微量|半顆|半個|一顆|一片)/g, '').trim();
                    
                    // 2. 清除可能殘留的開頭結尾多餘標點符號
                    cleanItem = cleanItem.replace(/^[^\w\u4e00-\u9fa5]+|[^\w\u4e00-\u9fa5]+$/g, '').trim();
                    
                    // 3. 【智慧判斷黑名單】：只要包含動作、杯子或非食材字眼，直接封殺淘汰！
                    // 針對巧克力與可可特殊處理：如果包含「酒」字（如香甜酒、利口酒），則放行不殺！
                    const isNotIngredient = /杯|技法|作法|方法|裝飾|攪拌|搖盪|倒入|shake|stir|冰塊|過濾|裝點|加入|至滿|均勻|冰鎮|洗出|濾掉|碎冰|搖|勻|後|然後|接着|混合|擠|點燃|表面|就算|也要|名為|醉漢|紳士|的|了|是|我|你|他|將|把|就|讓|在|以|這|那|嗎|呢|吧|啊|點火|火烤|燃燒|蛋|苦精|皮|橙花水|片|糖漿|檸檬汁|萊姆汁|砂糖|角|金莎|糖漬櫻桃/i.test(cleanItem) || (/(巧克力|可可)/i.test(cleanItem) && !/酒/i.test(cleanItem));
                    
                    // 4. 防呆：材料名稱中文字數通常很短，中文字超過 8 個絕對是誤闖的步驟句子
                    const chineseLength = (cleanItem.match(/[\u4e00-\u9fa5]/g) || []).length;
                    if (!cleanItem || isNotIngredient || chineseLength > 8) return ''; 
                    
                    return `<li class="ingredient-tag">${cleanItem}</li>`;
                }).join('') + 
                `</ul>`;
        }
    });
    return ingredientsHtml;
}

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
            // 已在 formatDescription 中處理，故事中跳過
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

// 全域用來記錄各個故事容器的 scroll animation frame ID，避免重複觸發與衝突
let activeStoryScrolls = new Map();

// requestAnimationFrame 實現的垂直平滑自動捲動
function startStoryScroll(container) {
    if (!container) return;
    
    // 若該容器已有播放中的動畫，先取消它
    if (activeStoryScrolls.has(container)) {
        cancelAnimationFrame(activeStoryScrolls.get(container));
    }
    
    container.scrollTop = 0;
    
    let scrollSpeed = 0.4; // 每幀移動的像素，越小越平滑/慢
    let delayCounter = 0;
    let currentScrollY = 0; // 用於累積浮點數滾動距離，解決部分瀏覽器 scrollTop 只接受整數導致無法滾動的問題
    
    function scrollStep() {
        if (!container.isConnected) {
            activeStoryScrolls.delete(container);
            return;
        }
        
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        
        // 如果容器還沒打開或高度是 0，稍候再試
        if (clientHeight === 0) {
            const frameId = requestAnimationFrame(scrollStep);
            activeStoryScrolls.set(container, frameId);
            return;
        }
        
        // 當使用者滑鼠停留在容器上 (.paused) 時，暫停捲動
        if (container.classList.contains('paused')) {
            const frameId = requestAnimationFrame(scrollStep);
            activeStoryScrolls.set(container, frameId);
            return;
        }
        
        // 初始停頓時間 (大約 1.5 秒，每秒約 60 幀)
        if (delayCounter < 90) {
            delayCounter++;
            const frameId = requestAnimationFrame(scrollStep);
            activeStoryScrolls.set(container, frameId);
            return;
        }
        
        // 此時佈局已完全展開並穩定，若內容高度小於等於容器顯示高度，不需要捲動
        if (scrollHeight <= clientHeight) {
            activeStoryScrolls.delete(container);
            return;
        }
        
        currentScrollY += scrollSpeed;
        container.scrollTop = currentScrollY;
        
        // 到達底部時 (減 1 像素防止某些縮放比例下的微小差距)
        if (container.scrollTop + clientHeight >= scrollHeight - 1) {
            // 在底部停留約 2.5 秒 (150 幀) 後再回到頂部
            if (delayCounter < 240) {
                delayCounter++;
            } else {
                currentScrollY = 0;
                container.scrollTop = 0;
                delayCounter = 0; // 重置計數器，使其在頂部重新停頓
            }
        }
        
        const frameId = requestAnimationFrame(scrollStep);
        activeStoryScrolls.set(container, frameId);
    }
    
    const frameId = requestAnimationFrame(scrollStep);
    activeStoryScrolls.set(container, frameId);
}

// 切換展開與收折故事
function toggleCardStory(btn, drinkId, event) {
    if (event) event.stopPropagation();
    
    const collapsible = document.getElementById(`story-collapsible-${drinkId}`);
    if (!collapsible) return;
    
    const isShowing = collapsible.classList.contains('show');
    
    if (isShowing) {
        collapsible.classList.remove('show');
        btn.classList.remove('active');
        btn.innerHTML = '📖 查看故事';
    } else {
        collapsible.classList.add('show');
        btn.classList.add('active');
        btn.innerHTML = '📖 隱藏故事';
    }
}

// 根據數值生成優雅的標籤膠囊 (Pill Tags)
function getFlavorIcons(d) {
    let html = '<div class="profile-tags-wrapper">';
    
    const getLevelText = (val) => {
        if (val <= 2) return '輕';
        if (val === 3) return '中';
        return '重';
    };

    if (d.sour) {
        html += `<span class="profile-tag tag-sour">
                    <span style="font-size: 1.1em;">🍋</span> 酸度 <strong>${getLevelText(d.sour)}</strong>
                 </span>`;
    }
    if (d.strong) {
        html += `<span class="profile-tag tag-strong">
                    <span style="font-size: 1.1em;">🔥</span> 酒感 <strong>${getLevelText(d.strong)}</strong>
                 </span>`;
    }
    
    const abvText = (d.abv && d.abv > 0) ? `${d.abv}%` : '0%';
    html += `<span class="profile-tag tag-abv">
                <span style="font-size: 1.1em;">💧</span> ABV <strong>${abvText}</strong>
             </span>`;
             
    html += '</div>';
    return html;
}

// 自動輪播渲染邏輯
function renderCarousel() {
    let featured = [];
    
    // 1. 固定加入：琴通寧 (如果未售罄)
    const ginTonic = allDrinks.find(d => 
        !d.isSoldOut && 
        (d.name === '琴通寧  Gin Tonic' || d.name.toLowerCase().includes('gin tonic'))
    );
    if (ginTonic) {
        featured.push(ginTonic);
    }
    
    // 2. 固定加入：來一杯shot (特製卡片)
    const customShot = {
        name: "來一杯shot",
        tags: ["其他", "無氣泡"],
        description: "來杯經典 Shot！開啟你的微醺之夜 🥃",
        isSoldOut: false,
        id: "custom-shot"
    };
    featured.push(customShot);
    
    // 隨機從某個分類中挑選一款尚未被加入的酒款
    function getCategoryDrink(categoryTag, currentList) {
        const pool = allDrinks.filter(d => 
            !d.isSoldOut && 
            (d.tags || []).includes(categoryTag) && 
            !currentList.some(item => item.name === d.name)
        );
        if (pool.length === 0) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    }
    
    // 3. 基酒各跑一種：琴酒、威士忌、伏特加、蘭姆酒、龍舌蘭、白蘭地、其他
    const bases = ['琴酒', '威士忌', '伏特加', '蘭姆酒', '龍舌蘭', '白蘭地', '其他'];
    bases.forEach(base => {
        const drink = getCategoryDrink(base, featured);
        if (drink) featured.push(drink);
    });
    
    // 4. 氣泡/無氣泡各跑一種 (若原本列表內該屬性未被代表，則隨機挑選一個)
    const styles = ['有氣泡', '無氣泡'];
    styles.forEach(style => {
        const alreadyHasStyle = featured.some(d => (d.tags || []).includes(style));
        if (!alreadyHasStyle) {
            const drink = getCategoryDrink(style, featured);
            if (drink) featured.push(drink);
        }
    });
    
    // 防呆：確保至少有 6 杯才能完成無縫輪播 (若品項極少，隨機抓未售罄的湊數)
    const available = allDrinks.filter(d => !d.isSoldOut);
    while (featured.length < 6 && featured.length < available.length) {
        const randomDrink = available[Math.floor(Math.random() * available.length)];
        if (!featured.some(item => item.name === randomDrink.name)) {
            featured.push(randomDrink);
        }
    }
    
    if (featured.length === 0) return;

    // 複製一份陣列，達成首尾相連的無限無縫捲動
    const displayDrinks = [...featured, ...featured]; 
    const track = document.getElementById('carousel-track');
    
    track.innerHTML = displayDrinks.map(d => {
        const safeName = d.name.replace(/'/g, "\\'");
        const encodedName = encodeURIComponent(d.name);
        return `
        <div class="carousel-item" onclick="scrollToDrink('${safeName}')" title="點擊查看這杯酒！">
            <div class="carousel-img-wrap">
                <img src="/images/${encodedName}.jpg" class="carousel-blur-bg" onerror="handleImgError(this, '/images/${encodedName}.png')" style="aspect-ratio: 1 / 1; object-fit: cover; width: 100%;" loading="lazy" decoding="async">
                <img src="/images/${encodedName}.jpg" onerror="handleImgError(this, '/images/${encodedName}.png')" style="aspect-ratio: 1 / 1; object-fit: cover; width: 100%;" loading="lazy" decoding="async">
                <div class="carousel-name-overlay">${d.name}</div>
            </div>
        </div>`;
    }).join('');

    // 初始化或重置滾動位置，確保自轉與手動無縫對齊
    initCarouselSwipe(true);
}

// 語音搜尋初始化與邏輯
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; // 單次辨識
    recognition.interimResults = false;
    recognition.lang = 'cmn-Hant-TW'; // 設定為台灣中文
    
    recognition.onstart = function() {
        const voiceBtns = document.querySelectorAll('.voice-search-btn');
        voiceBtns.forEach(btn => {
            if (btn) {
                btn.classList.add('mic-recording');
                btn.innerText = '🔴';
            }
        });
        showToast('🎙️ 請說出想搜尋的酒名或材料...', false);
    };
    
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = transcript.replace(/[。，,.]/g, ''); // 移除句號結尾
            showToast(`辨識結果: ${transcript.replace(/[。，,.]/g, '')}`, false);
            applyFilters(); // 觸發搜尋過濾
        }
    };
    
    recognition.onerror = function(event) {
        if (event.error === 'not-allowed') showToast('⚠️ 請允許麥克風權限才能使用語音搜尋', true);
        else if (event.error === 'no-speech') showToast('⚠️ 沒有聽到聲音，請再試一次', true);
        else showToast('⚠️ 語音辨識發生錯誤', true);
    };
    
    recognition.onend = function() {
        const voiceBtns = document.querySelectorAll('.voice-search-btn');
        voiceBtns.forEach(btn => {
            if (btn) {
                btn.classList.remove('mic-recording');
                btn.innerText = '🎙️';
            }
        });
    };
} else {
    setTimeout(() => {
        const btns = document.querySelectorAll('.voice-search-btn');
        btns.forEach(btn => { if (btn) btn.style.display = 'none'; }); // 若舊版瀏覽器或 iOS Line 內建瀏覽器不支援時自動隱藏按鈕
    }, 100);
}

function startVoiceSearch() {
    if (!recognition) {
        showToast('⚠️ 您的瀏覽器不支援語音搜尋', true);
        return;
    }
    try { recognition.start(); } catch (e) { recognition.stop(); }
}

// 切換進階篩選面板 (桌面版與平板)
function toggleAdvancedFilters() {
    if (window.innerWidth <= 768) {
        openFilterSheet();
        return;
    }
    const panel = document.getElementById('advanced-filters');
    const btn = document.getElementById('toggle-filter-btn');
    panel.classList.toggle('expanded');
    if (panel.classList.contains('expanded')) {
        btn.classList.add('active');
        btn.innerHTML = '收合 ▲';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '篩選 ▼';
    }
}

// 開啟底部篩選抽屜 (手機版)
function openFilterSheet() {
    const overlay = document.getElementById('filter-sheet-overlay');
    const panel = document.getElementById('advanced-filters');
    overlay.classList.add('visible');
    
    // 強制觸發瀏覽器重繪 (Reflow) 以確保動畫能正常執行
    void panel.offsetWidth;
    
    panel.classList.add('expanded');
    document.body.style.overflow = 'hidden';
}

// 關閉底部篩選抽屜 (手機版)
function closeFilterSheet() {
    const overlay = document.getElementById('filter-sheet-overlay');
    const panel = document.getElementById('advanced-filters');
    overlay.classList.remove('visible');
    panel.classList.remove('expanded');
    document.body.style.overflow = '';
}


// 自動計算歷史總點單量最高的前 3 名酒款
function getTop3Drinks() {
    const drinkCounts = {};
    globalServerOrders.forEach(o => {
        if (o.status === 'completed') { // 只計算真正出杯完成的
            drinkCounts[o.drink] = (drinkCounts[o.drink] || 0) + 1;
        }
    });
    return Object.entries(drinkCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(item => item[0]);
}

// 自動生成隨機稱呼
function generateRandomName() {
    const adjectives = ['微醺的', '開心的', '神秘的', '浪漫的', '孤獨的', '熱情的', '慵懶的', '優雅的', '狂野的', '隨性的', '瀟灑的', '迷人的'];
    const nouns = ['貓咪', '酒客', '紳士', '淑女', '旅人', '夜貓子', '品酒師', '探險家', '吟遊詩人', '藝術家', '過客', '精靈'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    
    const nameInput = document.getElementById('guest-name');
    if (nameInput) {
        nameInput.value = `${randomAdj}${randomNoun}`;
    }
}

// --- 新增：深色/淺色主題切換邏輯 ---
let currentTheme = localStorage.getItem('bar_theme') || 'dark';

function applyTheme() {
    const btn = document.getElementById('theme-toggle-btn');
    if (currentTheme === 'light') {
        document.body.classList.add('light-mode');
        if (btn) {
            btn.innerHTML = '☀️ 淺色模式';
            btn.style.background = '#f39c12';
            btn.style.color = '#fff';
            btn.style.borderColor = '#f39c12';
        }
    } else {
        document.body.classList.remove('light-mode');
        if (btn) {
            btn.innerHTML = '🌙 深色模式';
            btn.style.background = 'transparent';
            btn.style.color = '#ccc';
            btn.style.borderColor = '#888';
        }
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('bar_theme', currentTheme);
    applyTheme();
}

function saveNameAndConfirmAge() {
    const nameElement = document.getElementById('guest-name');
    if (!nameElement) return;
    
    const name = nameElement.value.trim();
    const ageCheckbox = document.getElementById('age-checkbox');
    const isChangingName = document.getElementById('welcome-content').classList.contains('changing-name');
    
    if (!myAvatarStyle) { // 如果還沒設定風格，幫他隨機設定一個
        myAvatarStyle = getRandomStyleForName(name);
    }
    
    if (!name) {
        showToast('⚠️ 請輸入您的稱呼！', true);
        return;
    }
    if (!isChangingName && ageCheckbox && !ageCheckbox.checked) {
        showToast('⚠️ 請勾選「我已年滿 18 歲」！', true);
        return;
    }

    localStorage.setItem('bar_guest_name', name);
    currentName = name;
    sessionStorage.setItem('bar_age_verified', 'true');
        
    if (globalAvatars[currentName]) {
        myAvatarStyle = globalAvatars[currentName];
        localStorage.setItem('bar_guest_avatar_style', myAvatarStyle);
    } else {
        socket.emit('update-avatar', { guest: currentName, style: myAvatarStyle });
    }

    const welcomeContent = document.getElementById('welcome-content');
    if (!isChangingName) {
        welcomeContent.classList.add('shatter-out'); // 首次進入觸發玻璃碎裂退場動畫
    }

    setTimeout(() => { 
        const ws = document.getElementById('welcome-screen');
        ws.classList.remove('visible'); 
        welcomeContent.classList.remove('shatter-out');
        welcomeContent.classList.remove('changing-name'); // 關閉視窗時清除修改狀態
        
        // 隱藏清除資料區塊
        document.getElementById('danger-zone-section').style.display = 'none';
        
        // 延遲等待淡出動畫結束後，徹底隱藏元素避免阻擋點擊
        setTimeout(() => { ws.style.display = 'none'; }, 400);
    }, isChangingName ? 0 : 600);

    if (!isChangingName) triggerWelcomeGoldDust(); // 首次進入觸發金粉

    // --- 新增：切換名字時，先立即清空舊的狀態並強制重繪 UI ---
    guestFavorites = [];
    renderFavorites();
    applyFilters(); // 強制重繪酒單，這會立刻清除上一位客人的愛心與「已點過」標籤

    loadFavorites(); 
    loadHistory(); 
    updateMainTitle(); 
    updateFAB();
}

function changeName() {
    document.getElementById('guest-name').value = currentName || '';
    
    // 切換為「修改名字」模式，隱藏年齡警告相關區塊
    document.getElementById('welcome-content').classList.add('changing-name');
    document.getElementById('age-warning-section').style.display = 'none';
    document.getElementById('age-checkbox-section').style.display = 'none';
    document.getElementById('btn-age-no').style.display = 'none';
    document.getElementById('btn-cancel-change').style.display = 'block';
    document.getElementById('btn-start-order').innerText = '儲存修改';
    
    // 顯示主題切換按鈕
    document.getElementById('theme-toggle-section').style.display = 'flex';
    
    // 顯示清除資料區塊
    document.getElementById('danger-zone-section').style.display = 'flex';

    const welcomeScreen = document.getElementById('welcome-screen');
    welcomeScreen.style.display = ''; // 解除隱藏
    void welcomeScreen.offsetWidth;   // 強制瀏覽器重繪 (Reflow)
    welcomeScreen.classList.add('visible'); // 觸發淡入動畫
}

function cancelChangeName() {
    const welcomeScreen = document.getElementById('welcome-screen');
    welcomeScreen.classList.remove('visible');
    document.getElementById('welcome-content').classList.remove('changing-name'); // 關閉視窗時清除修改狀態
    
    // 隱藏清除資料區塊
    document.getElementById('danger-zone-section').style.display = 'none';
    
    // 延遲等待淡出動畫結束後徹底隱藏
    setTimeout(() => {
        welcomeScreen.style.display = 'none';
    }, 400);
}

function rejectAge() {
    document.getElementById('age-warning-msg').style.display = 'block';
    document.getElementById('btn-start-order').disabled = true;
    document.getElementById('btn-age-no').disabled = true;
    setTimeout(() => { window.location.href = "https://www.google.com"; }, 2000);
}

fetch(`/api/drinks?t=${Date.now()}`).then(r => r.json()).then(drinks => {
    allDrinks = drinks.map(estimateDrinkProfile); // 獲取資料時，強制經過解析器重新計算數值
    loadHistory(); // 確保資料載入後再重繪紀錄表，解決圖片遺失問題
    loadFavorites(); // 載入最愛列表
    renderCarousel(); // 初始渲染頂部自動輪播
    applyFilters();
    updateFAB();
});

function applyFilters() {
    const searchInput = document.getElementById('search-input');
    let searchText = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) {
        clearBtn.style.display = searchText.length > 0 ? 'flex' : 'none';
    }

    const sortValue = document.querySelector('input[name="sort"]:checked').value;

    // 獲取選中的標籤陣列，加上 .trim() 確保字串匹配無誤
    const selectedBases = Array.from(document.querySelectorAll('#filter-base .tag-checkbox:checked')).map(cb => cb.value.trim());
    const selectedStyles = Array.from(document.querySelectorAll('#filter-style .tag-checkbox:checked')).map(cb => cb.value.trim());
    const selectedSpecials = Array.from(document.querySelectorAll('#filter-special .tag-checkbox:checked')).map(cb => cb.value.trim());
    const selectedFlavors = Array.from(document.querySelectorAll('#filter-flavor .tag-checkbox:checked')).map(cb => cb.value.trim());

    // --- 同步更新頂部基酒頁籤的選中狀態 ---
    const tabs = document.querySelectorAll('.category-tab');
    if (tabs.length > 0) {
        tabs.forEach(tab => tab.classList.remove('active'));
        if (selectedBases.length === 1) {
            const activeTab = Array.from(tabs).find(tab => tab.dataset.value === selectedBases[0]);
            if (activeTab) {
                activeTab.classList.add('active');
            } else {
                document.querySelector('.category-tab[data-value="all"]')?.classList.add('active');
            }
        } else {
            document.querySelector('.category-tab[data-value="all"]')?.classList.add('active');
        }
    }

    const historyFilterValue = document.querySelector('input[name="history-filter"]:checked').value;
    // 讀取「顯示已售罄」開關的狀態
    const showSoldOut = document.getElementById('show-sold-out-toggle')?.checked || false;

    // 改由全域伺服器訂單取得目前使用者已點過的酒名清單，供紀錄篩選使用
    const myOrderedNames = globalServerOrders.filter(o => o.guest === currentName).map(o => o.drink);
    
    // 計算今日點過的酒名清單
    const todayStr = new Date().toDateString();
    const myOrderedNamesToday = globalServerOrders.filter(o => {
        if (o.guest !== currentName || !o.id) return false;
        const ts = parseInt(o.id.split('-')[0]);
        return !isNaN(ts) && new Date(ts).toDateString() === todayStr;
    }).map(o => o.drink);

    const hasAvailableDrinks = allDrinks.some(d => !d.isSoldOut);
    const carouselSec = document.getElementById('carousel-section');
    
    if (carouselSec) {
        if (!hasAvailableDrinks) {
            carouselSec.style.display = 'none';
        } else {
            carouselSec.style.display = 'block';
        }
    }
    
    // --- 動態更新隨機按鈕文字與樣式 ---
    const mobileRandomBtn = document.getElementById('mobile-random-btn');
    const desktopRandomBtn = document.getElementById('random-btn');
    const hasFilterTags = selectedBases.length > 0 || selectedStyles.length > 0 || selectedSpecials.length > 0 || selectedFlavors.length > 0 || historyFilterValue !== 'all' || searchText !== '';
    
    if (hasFilterTags) {
        if(mobileRandomBtn) {
            mobileRandomBtn.innerHTML = '🎰 從篩選結果中為您抽一杯';
            mobileRandomBtn.style.background = 'linear-gradient(135deg, #f39c12, #e67e22)';
            mobileRandomBtn.style.boxShadow = '0 6px 20px rgba(243, 156, 18, 0.4)';
        }
        if(desktopRandomBtn) {
            desktopRandomBtn.innerHTML = '🎲 篩選隨機';
            desktopRandomBtn.style.background = '#f39c12';
        }
    } else {
        if(mobileRandomBtn) {
            mobileRandomBtn.innerHTML = '🎰 幫我隨機抽一杯';
            mobileRandomBtn.style.background = 'linear-gradient(135deg, #8e44ad, #9b59b6)';
            mobileRandomBtn.style.boxShadow = '0 6px 20px rgba(142, 68, 173, 0.5)';
        }
        if(desktopRandomBtn) {
            desktopRandomBtn.innerHTML = '🎲 隨機';
            desktopRandomBtn.style.background = '#8e44ad';
        }
    }

    const top3Drinks = getTop3Drinks(); // 取得自動熱門 Top 3

    const filteredDrinks = allDrinks.filter(d => {
        // 讓已下架的酒款一律顯示（不再隱藏），後續由 sort 排序置底，且卡片與按鈕為灰色不可點擊狀態
        // if (!showSoldOut && d.isSoldOut) return false;

        // 安全檢查：確保欄位存在，避免程式崩潰
        const drinkName = d.name || "";
        const drinkDesc = d.description || "";
        const drinkTags = (d.tags || []).map(t => t.trim());

        // 動態將「自動前三名」的酒款暫時加入熱門標籤，以便搜尋與篩選
        if (top3Drinks.includes(drinkName) && !drinkTags.includes('熱門推薦')) {
            drinkTags.push('熱門推薦');
        }

        // 搜尋過濾
        const matchesSearch = drinkName.toLowerCase().includes(searchText) || drinkDesc.toLowerCase().includes(searchText);
        
        // 基酒過濾 (組內取 OR：選琴酒或威士忌都行)
        const matchesBase = selectedBases.length === 0 || selectedBases.some(tag => drinkTags.includes(tag));
        
        // 類型過濾 (組內取 OR)
        const matchesStyle = selectedStyles.length === 0 || selectedStyles.some(tag => drinkTags.includes(tag));

        // 特色過濾 (組內取 OR)
        const matchesSpecial = selectedSpecials.length === 0 || selectedSpecials.some(tag => drinkTags.includes(tag));

        // 風味過濾 (組內取 AND，例如：同時勾選偏酸且酒感重)
        const matchesFlavor = selectedFlavors.every(flavor => {
            if (flavor === '偏酸') return d.sour >= 4;
            if (flavor === '酸度中') return d.sour === 3;
            if (flavor === '偏甜') return d.sour > 0 && d.sour <= 2;
            if (flavor === '酒感重') return d.strong >= 4;
            if (flavor === '酒感中') return d.strong === 3;
            if (flavor === '清爽') return d.strong > 0 && d.strong <= 2;
            return true;
        });

        // 點餐紀錄過濾
        let matchesHistory = true;
        const isOrdered = myOrderedNames.includes(drinkName);
        const isOrderedToday = myOrderedNamesToday.includes(drinkName);
        
        if (historyFilterValue === 'ordered') matchesHistory = isOrdered;
        if (historyFilterValue === 'ordered-today') matchesHistory = isOrderedToday;
        if (historyFilterValue === 'unordered') matchesHistory = !isOrdered;

        // 不同群組間取 AND
        return matchesSearch && matchesBase && matchesStyle && matchesSpecial && matchesFlavor && matchesHistory;
    });

    // 執行排序邏輯
    filteredDrinks.sort((a, b) => {
        // 1. 最優先條件：已下架 (Sold Out) 強制排到最下面
        const aSoldOut = a.isSoldOut ? 1 : 0;
        const bSoldOut = b.isSoldOut ? 1 : 0;
        if (aSoldOut !== bSoldOut) return aSoldOut - bSoldOut;

        // 2. 當上架/下架狀態相同時，依照使用者選擇的排序條件
        if (sortValue === 'default') {
            // 優先把「我的最愛」排在最前面
            const aIsFav = guestFavorites.includes(a.name) ? 1 : 0;
            const bIsFav = guestFavorites.includes(b.name) ? 1 : 0;
            if (aIsFav !== bIsFav) return bIsFav - aIsFav;

            const aIsHot = (a.tags || []).includes('熱門推薦') || top3Drinks.includes(a.name) ? 1 : 0;
            const bIsHot = (b.tags || []).includes('熱門推薦') || top3Drinks.includes(b.name) ? 1 : 0;
            return bIsHot - aIsHot; // 1 (熱門) 優先於 0 (非熱門)
        } else if (sortValue === 'abv-desc') {
            return (b.abv || 0) - (a.abv || 0);
        } else if (sortValue === 'abv-asc') {
            return (a.abv || 0) - (b.abv || 0);
        }
        return 0;
    });

    globalFilteredDrinks = filteredDrinks;
    renderMenu(filteredDrinks);
}

// 計算字串相似度 (Levenshtein Distance)
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

function renderMenu(drinksToRender) {
    const menu = document.getElementById('menu');
    const searchInput = document.getElementById('search-input');
    let searchText = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    if (drinksToRender.length === 0) {
        let suggestionHtml = '';
        
        // 如果有輸入搜尋文字，進行防呆拼寫檢查
        if (searchText.length >= 2) {
            let closestDrink = null;
            let minDistance = Infinity;
            
            allDrinks.forEach(d => {
                const dist = levenshteinDistance(searchText, d.name.toLowerCase());
                if (dist < minDistance) {
                    minDistance = dist;
                    closestDrink = d.name;
                }
            });
            
            // 設定容錯門檻：最多容許 3 個字元拼寫錯誤
            if (closestDrink && minDistance <= 3 && minDistance < Math.max(searchText.length, closestDrink.length)) {
                suggestionHtml = `<div style="margin-top: 20px; font-size: 1.1em; color: #aaa;">您是不是想找：<br><a href="#" onclick="const si=document.getElementById('search-input'); if(si){si.value='${closestDrink}'; applyFilters();} return false;" style="color: #f39c12; font-weight: bold; text-decoration: underline; font-size: 1.2em; display: inline-block; margin-top: 10px; background: #222; padding: 8px 15px; border-radius: 8px; border: 1px solid #f39c12;">🔍 ${closestDrink}</a></div>`;
            }
        }

        menu.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 50px 20px; background: #1a1a1a; border-radius: 12px; margin-top: 20px; border: 1px dashed #444;"><p style="font-size: 1.2em; color: #888; margin: 0;">找不到符合條件的酒... 😢</p>${suggestionHtml}</div>`;
        return;
    }

    const myOrderedNames = globalServerOrders.filter(o => o.guest === currentName).map(o => o.drink);
    const top3Drinks = getTop3Drinks();

    menu.innerHTML = drinksToRender.map(d => {
        const encodedName = encodeURIComponent(d.name);
        const localPath = `/images/${encodedName}.jpg`;
        const localPathPng = `/images/${encodedName}.png`;
        const safeName = d.name.replace(/'/g, "\\'");
        const isOrdered = myOrderedNames.includes(d.name);
        const isFavorited = guestFavorites.includes(d.name);
        const isHot = (d.tags || []).includes('熱門推薦') || top3Drinks.includes(d.name);
        
        const parsed = parseDrinkDescription(d.description);
        const hasStory = !!parsed.story;

        const ratingData = globalRatings[d.name] || { avg: 0, count: 0, list: [] };
        let ratingStatsHtml = '';
        if (ratingData.count > 0) {
            ratingStatsHtml = `
                <div class="card-rating-summary" onclick="toggleReviews('${d.id}', event)">
                    <span>⭐ ${ratingData.avg} (${ratingData.count} 評分)</span>
                    <span style="margin-left: auto; font-size: 0.9em; font-weight: normal; color: #aaa;">查看評論 ▼</span>
                </div>
            `;
        }
        
        let reviewsHtml = '';
        if (ratingData.list && ratingData.list.length > 0) {
            reviewsHtml = ratingData.list.map(r => {
                const starsStr = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
                return `
                    <div class="card-review-item">
                        <div class="card-review-header">
                            <span class="card-review-user">${r.guest}</span>
                            <span style="color: #f39c12; font-size: 0.85em;">${starsStr}</span>
                        </div>
                        <div class="card-review-comment">${r.comment || '無評論內容'}</div>
                    </div>
                `;
            }).join('');
        }
        
        const reviewsCollapsibleHtml = `
            <div class="reviews-collapsible" id="reviews-collapsible-${d.id}" style="display: none;" onclick="event.stopPropagation();">
                ${reviewsHtml || '<div style="color: #666; font-size: 0.9em; text-align: center;">暫無詳細評論</div>'}
            </div>
        `;

        return `
        <div class="card ${d.isSoldOut ? 'sold-out' : ''}" id="drink-card-${d.id}" onclick="this.classList.remove('card-highlighted')">
            <div class="img-container">
                <img src="${localPath}" onerror="handleImgError(this, '${localPathPng}')" class="drink-img" onclick="openImageModal(this.src); event.stopPropagation();" title="點擊放大圖片" style="aspect-ratio: 1 / 1; object-fit: cover; width: 100%; border-radius: 12px 12px 0 0; ${d.isSoldOut ? 'filter: grayscale(1); opacity: 0.7;' : ''}" loading="lazy" decoding="async">
                ${d.isSoldOut ? '<div class="card-sold-out-overlay">SOLD OUT</div>' : ''}
                <div class="badge-stack-left">
                    ${isHot ? `<div class="hot-badge" style="transition: transform 0.3s ease, filter 0.3s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.filter='brightness(1.15)'" onmouseout="this.style.transform='translateY(0)'; this.style.filter='brightness(1)'">👑 熱門</div>` : ''}
                    ${isOrdered ? `<div class="ordered-badge-img" style="transition: transform 0.3s ease, filter 0.3s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.filter='brightness(1.15)'" onmouseout="this.style.transform='translateY(0)'; this.style.filter='brightness(1)'">✔️ 已點過</div>` : ''}
                </div>
                
                <button class="favorite-btn ${isFavorited ? 'active' : ''}" 
                        onclick="toggleFavorite('${safeName}', event)"
                        title="${isFavorited ? '移除最愛' : '加入最愛'}"
                        style="transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); ${d.isSoldOut ? 'display: none;' : ''}"
                        onmouseover="this.style.transform='scale(1.25)'"
                        onmouseout="this.style.transform='scale(1)'">
                    ${isFavorited ? '❤️' : '♡'}
                </button>
            </div>
            <div class="card-content">
                <h3>${d.name} ${d.isSoldOut ? '<span style="color:#e74c3c; font-size:0.65em; vertical-align:middle; margin-left:5px;">(Sold Out)</span>' : ''}</h3>
                
                ${getFlavorIcons(d)}
                
                ${ratingStatsHtml}

                <div class="description-area" onclick="event.stopPropagation();">${formatDescription(d.description)}</div>
                
                ${hasStory ? `
                <div class="story-toggle-btn" onclick="toggleCardStory(this, '${d.id}', event)">📖 查看故事</div>
                <div class="story-collapsible" id="story-collapsible-${d.id}" onclick="event.stopPropagation();">
                    <div class="story-text-container" onmouseenter="this.classList.add('paused')" onmouseleave="this.classList.remove('paused')">
                        <div class="story-text">“ ${parsed.story} ”</div>
                    </div>
                </div>
                ` : ''}

                ${reviewsCollapsibleHtml}

                <div class="card-action-area">
                    ${d.isSoldOut 
                    ? `<button disabled style="flex-grow: 1; background: #333; color: #777; cursor: not-allowed; border: 1px solid #444; border-radius: 8px;" onclick="event.stopPropagation();">🚫 目前已售罄</button>`
                    : `<button class="btn-order-anim" onclick="event.stopPropagation(); order('${safeName}', this)" style="flex-grow: 1; border-radius: 8px;">點這杯</button>`}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function loadFavorites() {
    if (!currentName) {
        guestFavorites = [];
        renderFavorites();
        return;
    }
    socket.emit('get-favorites', currentName);
}

function toggleFavorite(drinkName, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!currentName) {
        showToast('⚠️ 請先輸入您的稱呼才能收藏喔！', 'warning');
        return;
    }

    let btn = null;
    if (e && e.target) {
        btn = e.target.closest('.favorite-btn');
        if (btn) {
            // 點擊瞬間加上「快速心跳」的放大特效
            btn.style.transition = 'transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            btn.style.transform = 'scale(1.6)';
        }
    }

    const index = guestFavorites.indexOf(drinkName);
    if (index > -1) {
        guestFavorites.splice(index, 1); 
        if (btn) {
            btn.innerHTML = '♡';
            btn.classList.remove('active');
        }
    } else {
        guestFavorites.push(drinkName); 
        if (btn) {
            btn.innerHTML = '❤️';
            btn.classList.add('active');
        }
    }
    socket.emit('toggle-favorite', { guest: currentName, drink: drinkName });

    // 延遲 200 毫秒才重繪畫面，讓心跳放大動畫能完整呈現
    setTimeout(() => {
        applyFilters(); 
        renderFavorites(); 
    }, 200);
}

function renderFavorites() {
    const favContainer = document.getElementById('favorites-container');
    const favList = document.getElementById('favorites-list');
    
    // 移除自動排序，完全尊重客人的自訂拖曳順序
    favList.innerHTML = guestFavorites.map(favDrinkName => {
        const drinkInfo = allDrinks.find(d => d.name === favDrinkName);
        const safeName = favDrinkName.replace(/'/g, "\\'"); 
        const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
        let imgSrc = '';
        let imgSrcPng = '';
        if (drinkInfo) {
            const encodedName = encodeURIComponent(drinkInfo.name);
            imgSrc = `/images/${encodedName}.jpg`;
            imgSrcPng = `/images/${encodedName}.png`;
        }
        return `
            <div class="favorite-item" data-name="${safeName}" ${isSoldOut ? `style="opacity: 0.5; filter: grayscale(1); cursor: grab;" onclick="showToast('⚠️ 抱歉，【${safeName}】目前已售罄！', true)"` : `style="cursor: grab;" onclick="scrollToDrink('${safeName}')"`} title="${isSoldOut ? '已售罄 (長按可拖曳)' : '點擊查看 / 長按可拖曳排序'}">
                <div style="position: relative; display: inline-flex;">
                    <img src="${imgSrc}" onerror="handleImgError(this, '${imgSrcPng}')" alt="${favDrinkName}" style="aspect-ratio: 1 / 1; object-fit: cover; border-radius: 8px;" loading="lazy" decoding="async">
                    ${isSoldOut ? '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); font-size: 0.65em; font-weight: 900; color: #fff; background: rgba(231, 76, 60, 0.85); padding: 2px 4px; border: 1.5px solid #fff; border-radius: 4px; pointer-events: none; z-index: 5; box-shadow: 0 2px 5px rgba(0,0,0,0.5); white-space: nowrap;">SOLD OUT</div>' : ''}
                </div>
                <span>${favDrinkName} ${isSoldOut ? '<span style="color:red; font-size:0.8em"><br>(售罄)</span>' : ''}</span>
            </div>
        `;
    }).join('');
    favContainer.style.display = guestFavorites.length > 0 ? 'block' : 'none';
}

function switchLeaderboard(type) {
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.lb-content').forEach(c => c.classList.remove('active'));
    if (type === 'today') {
        document.querySelectorAll('.lb-tab')[0].classList.add('active');
        document.getElementById('leaderboard-today').classList.add('active');
    } else {
        document.querySelectorAll('.lb-tab')[1].classList.add('active');
        document.getElementById('leaderboard-alltime').classList.add('active');
    }
}

function toggleLeaderboard() {
    const wrapper = document.getElementById('leaderboard-content');
    const iconWrap = document.getElementById('leaderboard-expand-icon');
    wrapper.classList.toggle('expanded');
    
    if (wrapper.classList.contains('expanded')) {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '收合';
        if(iconWrap) iconWrap.classList.add('expanded-state');
    } else {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '展開';
        if(iconWrap) iconWrap.classList.remove('expanded-state');
    }
}

function toggleHistory() {
    const wrapper = document.getElementById('history-content');
    const iconWrap = document.getElementById('history-expand-icon');
    wrapper.classList.toggle('expanded');
    
    if (wrapper.classList.contains('expanded')) {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '收合';
        if(iconWrap) iconWrap.classList.add('expanded-state');
    } else {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '展開';
        if(iconWrap) iconWrap.classList.remove('expanded-state');
    }
}

function openHistory() {
    const historySection = document.getElementById('history');
    if (!historySection) return;
    
    // Ensure expanded
    const wrapper = document.getElementById('history-content');
    const iconWrap = document.getElementById('history-expand-icon');
    if (wrapper && !wrapper.classList.contains('expanded')) {
        wrapper.classList.add('expanded');
        if (iconWrap) {
            iconWrap.querySelector('.expand-text').innerText = '收合';
            iconWrap.classList.add('expanded-state');
        }
    }
    
    customSmoothScrollToElement(historySection, 800);
}

function openFavorites() {
    const favSection = document.getElementById('favorites-container');
    if (!favSection || favSection.style.display === 'none') {
        showToast('您還沒有收藏任何最愛喔！', 'warning');
        return;
    }
    
    const wrapper = document.getElementById('favorites-content');
    const iconWrap = document.getElementById('favorites-expand-icon');
    if (wrapper && !wrapper.classList.contains('expanded')) {
        wrapper.classList.add('expanded');
        if (iconWrap) {
            iconWrap.querySelector('.expand-text').innerText = '收合';
            iconWrap.classList.add('expanded-state');
        }
    }
    
    customSmoothScrollToElement(favSection, 800);
}


function toggleFavorites() {
    const wrapper = document.getElementById('favorites-content');
    const iconWrap = document.getElementById('favorites-expand-icon');
    wrapper.classList.toggle('expanded');
    
    if (wrapper.classList.contains('expanded')) {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '收合';
        if(iconWrap) iconWrap.classList.add('expanded-state');
    } else {
        if(iconWrap) iconWrap.querySelector('.expand-text').innerText = '展開';
        if(iconWrap) iconWrap.classList.remove('expanded-state');
    }
}

window.toggleTimeDetails = function(iconSpan) {
    const wrapper = iconSpan.parentElement.nextElementSibling;
    if (wrapper.style.display === 'none') {
        wrapper.style.display = 'block';
        iconSpan.innerText = '▲ 收合';
    } else {
        wrapper.style.display = 'none';
        iconSpan.innerText = '▼ 詳細時間';
    }
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const dateFilterSelect = document.getElementById('history-date-filter');
    const todayStr = new Date().toLocaleDateString('zh-TW');
    
    let selectedDate = 'all';
    if (dateFilterSelect) {
        if (dateFilterSelect.options.length === 0) {
            selectedDate = todayStr;
        } else {
            selectedDate = dateFilterSelect.value;
        }
    }

    const statusMap = { 
        'pending': ['#888', '⌛ 待接單'], 
        'making': ['#f39c12', '👨‍🍳 製作中'], 
        'completed': ['#27ae60', '✅ 已完成'], 
        'rejected': ['#e74c3c', '🚫 已退單']
    };

    let myOrders = globalServerOrders.filter(o => o.guest === currentName);
    myOrders.sort((a, b) => parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0]));

    const uniqueDates = new Set();
    uniqueDates.add(todayStr); 
    myOrders.forEach(o => {
        const ts = parseInt(o.id.split('-')[0]);
        if (!isNaN(ts)) uniqueDates.add(new Date(ts).toLocaleDateString('zh-TW'));
    });

    if (dateFilterSelect) {
        let optionsHtml = `<option value="all">📅 所有紀錄</option>`;
        Array.from(uniqueDates).forEach(dateStr => {
            const label = dateStr === todayStr ? `📅 今日 (${dateStr})` : dateStr;
            optionsHtml += `<option value="${dateStr}" ${selectedDate === dateStr ? 'selected' : ''}>${label}</option>`;
        });
        dateFilterSelect.innerHTML = optionsHtml;
    }

    if (selectedDate !== 'all') {
        myOrders = myOrders.filter(o => {
            const ts = parseInt(o.id.split('-')[0]);
            return !isNaN(ts) && new Date(ts).toLocaleDateString('zh-TW') === selectedDate;
        });
    }

    if (myOrders.length === 0) {
        list.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">暫無點餐紀錄</p>';
        return;
    }

    let listHtml = `<div class="history-cards-container">`;

    listHtml += myOrders.map(o => {
        const [color, text] = statusMap[o.status || 'pending'];
        const canCancel = (!o.status || o.status === 'pending');
        const isCompletedOrRejected = (o.status === 'completed' || o.status === 'rejected');
        const targetId = o.id;
        
        const drinkInfo = allDrinks.find(d => d.name === o.drink);
        const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
        const safeDrinkName = o.drink.replace(/'/g, "\\'");
        
        let imgSrc = '';
        let imgSrcPng = '';
        if (drinkInfo) {
            const encodedName = encodeURIComponent(drinkInfo.name);
            imgSrc = `/images/${encodedName}.jpg`;
            imgSrcPng = `/images/${encodedName}.png`;
        }
        
        const ts = parseInt(o.id.split('-')[0]);
        const dateDisplay = !isNaN(ts) ? new Date(ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';

        // 卡片式設計的 HTML 結構
        // 計算排隊資訊（待處理/製作中的訂單）
        let queueHtml = '';
        if (o.status === 'pending' || o.status === 'making') {
            const queueInfo = getQueueInfoForOrder(o);
            if (queueInfo) {
                queueHtml = buildQueueHtml(queueInfo);
            }
        }

        // 評分資訊（已完成訂單）
        let rateHtml = '';
        if (o.status === 'completed') {
            const r = myRatings[o.id];
            if (r) {
                const starsStr = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
                rateHtml = `
                    <div class="history-rating-display" style="margin-top: 8px; font-size: 0.9em; display: flex; align-items: center; gap: 6px;">
                        <span class="history-rating-stars" style="color: #f39c12; font-weight: bold;">${starsStr}</span>
                        ${r.comment ? `<span class="history-rating-comment" style="color: #aaa; font-style: italic;">"${r.comment}"</span>` : ''}
                    </div>
                `;
            } else {
                rateHtml = `
                    <button class="history-btn-rate" onclick="event.stopPropagation(); openRatingModal('${o.id}', '${safeDrinkName}')" style="background: #f39c12; color: #000; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 8px; transition: 0.2s;">⭐ 評分</button>
                `;
            }
        }

        return `
            <div class="history-card ${o.status || 'pending'}" id="history-order-${o.id}">
                
                <div class="history-card-img-wrapper">
                    <img src="${imgSrc}" onerror="handleImgError(this, '${imgSrcPng}')" onclick="openImageModal(this.src)" style="${isSoldOut ? 'filter: grayscale(1); opacity: 0.7;' : ''}" loading="lazy">
                    ${isSoldOut ? '<div class="history-sold-out-tag">SOLD OUT</div>' : ''}
                    ${canCancel ? `<button class="history-btn-cancel-overlay" onclick="event.stopPropagation(); cancelOrder('${targetId}', this)" title="取消此訂單">✕</button>` : ''}
                </div>

                <div class="history-card-content">
                    <div class="history-card-header">
                        <span class="history-drink-name">${o.drink}</span>
                        <div class="history-header-actions">
                            <span class="history-status-tag" style="background: ${color}; color: #000;">${text}</span>
                            <button class="history-btn-reorder" onclick="event.stopPropagation(); scrollToDrink('${safeDrinkName}')" ${isSoldOut ? 'disabled title="目前售罄"' : ''}>👀 去看看</button>
                        </div>
                    </div>

                    <div class="history-time-info">
                        <div><span class="time-icon">📅</span> ${dateDisplay} <span onclick="toggleTimeDetails(this)" style="cursor:pointer; font-size: 0.8em; color: #888; margin-left: 5px;">▼ 詳細時間</span></div>
                        <div class="time-details-wrapper" style="display: none; margin-top: 5px; padding-left: 10px; border-left: 2px solid #333;">
                            <div><span class="time-icon">📝</span> 點餐: ${o.time}</div>
                            ${o.makingTime ? `<div><span class="time-icon">👨‍🍳</span> 製作: ${o.makingTime}</div>` : ''}
                            ${o.completedTime ? `<div><span class="time-icon">🍸</span> 完成: ${o.completedTime}</div>` : ''}
                        </div>
                    </div>

                    ${o.notes ? `<div class="history-notes-box">💬 備註: ${o.notes}</div>` : ''}
                    ${queueHtml}
                    ${rateHtml}
                </div>
            </div>
        `;
    }).join('');
    listHtml += `</div>`;
    list.innerHTML = listHtml;
}

let currentOnConfirmCallback = null;
let currentOnCancelCallback = null;
function handleCustomConfirmYes() { if (currentOnConfirmCallback) currentOnConfirmCallback(); closeCustomConfirm(); }
function handleCustomConfirmNo() { if (currentOnCancelCallback) currentOnCancelCallback(); closeCustomConfirm(); }

function showCustomConfirm(message, onConfirm, onCancel, yesText = '確定', noText = '取消') {
    const overlay = document.getElementById('custom-confirm-overlay');
    const msgElement = document.getElementById('custom-confirm-message');
    msgElement.innerText = message;
    document.getElementById('confirm-yes').innerText = yesText;
    document.getElementById('confirm-no').innerText = noText;
    overlay.classList.add('visible');
    currentOnConfirmCallback = onConfirm;
    currentOnCancelCallback = onCancel;
}

function closeCustomConfirm() {
    document.getElementById('custom-confirm-overlay').classList.remove('visible');
    currentOnConfirmCallback = null;
    currentOnCancelCallback = null;
}

function toggleGuestOrders(btnElement, guestName, isTodayOnly = true) {
    const container = btnElement.parentElement;
    const detailsDiv = container.querySelector('.lb-details');
    const icon = btnElement.querySelector('.expand-icon');
    if (detailsDiv.style.display === 'none') {
        document.querySelectorAll('.lb-details').forEach(el => { el.style.display = 'none'; });
        document.querySelectorAll('.expand-icon').forEach(el => { el.innerText = '▼'; });
        document.querySelectorAll('.lb-item').forEach(el => { el.style.borderBottomLeftRadius = '8px'; el.style.borderBottomRightRadius = '8px'; });
        const guestOrders = globalServerOrders.filter(o => {
            if (!o.id) return false;
            const ts = parseInt(o.id.split('-')[0]);
            const isToday = new Date(ts).toDateString() === new Date().toDateString();
            const matchTime = isTodayOnly ? isToday : true;
            return o.guest === guestName && matchTime && o.status === 'completed';
        });
        guestOrders.sort((a, b) => parseInt(b.id.split('-')[0]) - parseInt(a.id.split('-')[0]));
        detailsDiv.innerHTML = guestOrders.map(o => {
            const safeName = o.drink.replace(/'/g, "\\'"); 
            const drinkInfo = allDrinks.find(d => d.name === o.drink);
            const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
            const ts = parseInt(o.id.split('-')[0]);
            const dateStr = new Date(ts).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
            const timeDisplay = isTodayOnly ? o.time : `${dateStr} ${o.time}`;
            const encodedName = encodeURIComponent(o.drink);
            const imgSrc = `/images/${encodedName}.jpg`;
            const imgSrcPng = `/images/${encodedName}.png`;
            if (isSoldOut) {
                return `<div class="guest-order-item" style="opacity: 0.5; cursor: pointer; padding: 10px; background: #222; border-radius: 6px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;" title="已售罄" onclick="showToast('⚠️ 抱歉，【${safeName}】目前已售罄！', true)">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="position: relative; display: inline-flex;">
                                    <img src="${imgSrc}" onerror="handleImgError(this, '${imgSrcPng}')" style="width: 40px; height: 40px; border-radius: 6px; object-fit: contain; background: #000; filter: grayscale(1);">
                                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-15deg); font-size: 0.65em; font-weight: 900; color: #fff; background: rgba(231, 76, 60, 0.85); padding: 2px 4px; border: 1.5px solid #fff; border-radius: 4px; pointer-events: none; z-index: 5; box-shadow: 0 2px 5px rgba(0,0,0,0.5); white-space: nowrap;">SOLD OUT</div>
                                </div>
                                <span>${o.drink} <span style="font-size: 0.7em; color: #e74c3c; margin-left: 5px;">(已售罄)</span></span>
                            </div>
                            <small style="color:#888;">${timeDisplay}</small>
                        </div>`;
            } else {
                return `<div class="guest-order-item" onclick="scrollToDrink('${safeName}')" style="cursor: pointer; padding: 10px; background: #222; border-radius: 6px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #444; transition: 0.2s;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='#222'" title="點擊查看這杯酒！">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <img src="${imgSrc}" onerror="handleImgError(this, '${imgSrcPng}')" style="width: 40px; height: 40px; border-radius: 6px; object-fit: contain; background: #000;">
                                <span>${o.drink} <span class="btn-reorder">👀 去看看</span></span>
                            </div>
                            <small style="color:#888;">${timeDisplay}</small>
                        </div>`;
            }
        }).join('');
        detailsDiv.style.display = 'block';
        icon.innerText = '▲';
        btnElement.style.borderBottomLeftRadius = '0';
        btnElement.style.borderBottomRightRadius = '0';
    } else {
        detailsDiv.style.display = 'none';
        icon.innerText = '▼';
        btnElement.style.borderBottomLeftRadius = '8px';
        btnElement.style.borderBottomRightRadius = '8px';
    }
}

let pendingOrderDrink = null;
let pendingOrderBtn = null;
let orderCooldown = 0; // 新增：點餐防呆冷卻計時器

function promptForNotes(name, btn) {
    pendingOrderDrink = name;
    pendingOrderBtn = btn;
    document.getElementById('order-notes-input').value = ''; 
    document.getElementById('notes-modal-overlay').classList.add('visible');
    
    const modalOverlay = document.getElementById('notes-modal-overlay');
    
    // 初始化狀態 (全透明)
    modalOverlay.style.opacity = '0';
    modalOverlay.style.transition = 'none';
    modalOverlay.style.zIndex = '99999'; // 確保黑底遮罩層級最高
    
    modalOverlay.classList.add('visible');
    
    // 鎖定背景捲動
    document.body.style.overflow = 'hidden';
    
    // 為了相容 iOS Safari 必須在使用者點擊的當下（同步）觸發 focus，否則虛擬鍵盤不會彈出
    document.getElementById('order-notes-input').focus();
    
    // 強制觸發瀏覽器重繪 (Reflow)
    void modalOverlay.offsetWidth;
    
    // 加上淡入動畫
    modalOverlay.style.transition = 'opacity 0.4s ease';
    modalOverlay.style.opacity = '1';
}
function closeNotesModal() {
    document.getElementById('notes-modal-overlay').classList.remove('visible');
    // 恢復背景捲動
    document.body.style.overflow = '';
    pendingOrderDrink = null;
    pendingOrderBtn = null;
    const modalOverlay = document.getElementById('notes-modal-overlay');
    
    // 加上淡出動畫
    modalOverlay.style.transition = 'opacity 0.4s ease';
    modalOverlay.style.opacity = '0';
    
    // 延遲等待動畫播完再隱藏與清空資料
    setTimeout(() => {
        modalOverlay.classList.remove('visible');
        modalOverlay.style.opacity = '';
        modalOverlay.style.transition = '';
        // 恢復背景捲動
        document.body.style.overflow = '';
        pendingOrderDrink = null;
        pendingOrderBtn = null;
    }, 400);
}
function appendQuickNote(text) {
    const input = document.getElementById('order-notes-input');
    if (!input) return;
    let val = input.value.trim();
    
    // 定義互斥對組
    const mutuallyExclusive = [
        ['去冰', '少冰'],
        ['加濃', '薄一點']
    ];
    
    // 將現有的備註以逗號拆分成陣列
    let parts = val ? val.split(/[，,]/).map(p => p.trim()).filter(p => p) : [];
    
    // 檢查新加入的選項是否有互斥項，若有則將其從現有清單中移除
    mutuallyExclusive.forEach(pair => {
        if (pair.includes(text)) {
            const opposite = pair.find(item => item !== text);
            parts = parts.filter(p => p !== opposite);
        }
    });
    
    // 避免重複添加相同標籤
    if (!parts.includes(text)) {
        const testVal = [...parts, text].join('，');
        if (testVal.length > 30) {
            showToast('⚠️ 備註字數已達 30 字上限！', 'warning');
            return;
        }
        parts.push(text);
    }
    
    input.value = parts.join('，');
    input.focus();
}
function submitOrderWithNotes() {
    if (orderCooldown > 0) return; // 雙重防呆，防止因手機卡頓導致的連點送單
    
    const notes = document.getElementById('order-notes-input').value.trim();
    const name = pendingOrderDrink;
    const btn = pendingOrderBtn;
    closeNotesModal();
    if (name) finalizeOrder(name, btn, notes);
}
function finalizeOrder(name, btn, notes) {
    // 立即啟動 15 秒防呆冷卻
    orderCooldown = 15;
    const timer = setInterval(() => {
        orderCooldown--;
        if (orderCooldown <= 0) {
            clearInterval(timer);
        }
    }, 1000);

    const orderId = Date.now() + '-' + Math.floor(Math.random() * 1000);
    if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
    const orderData = { id: orderId, guest: currentName, drink: name, time: new Date().toLocaleTimeString(), notes: notes ? notes.trim() : '', status: 'pending' };
    socket.emit('new-order', orderData);
    showToast('✅ 訂單送出成功！'); 
    // 手機端點餐成功震動回饋
    if ("vibrate" in navigator) { navigator.vibrate(50); }
    triggerSmallConfetti(); // 替換為單次的小型碎紙花特效，避免每次點餐都放長達 5 秒的煙火太過干擾
    requestNotificationPermission();
    globalServerOrders.push(orderData);
    renderLeaderboard();
    checkMilestone();
    loadHistory();
    updateFAB();
    
    // 延遲 0.8 秒結束轉圈圈，顯示打勾變色的成功狀態
    setTimeout(() => {
        if (btn) { 
            btn.classList.remove('btn-loading'); 
            btn.style.transition = 'all 0.3s ease'; // 加上平滑漸變動畫
            btn.style.backgroundColor = '#27ae60'; // 變成成功的綠色
            btn.style.borderColor = '#2ecc71';
            btn.style.color = '#fff';
            btn.innerHTML = '✔️ 點餐成功';
        }
        
        // 再延遲 1.2 秒才重繪畫面，讓客人能看清楚成功的按鈕狀態
        setTimeout(() => {
            applyFilters(); 
        }, 1200);
    }, 800);
}

function order(name, btn) {
    // 檢查是否已下架售罄
    const drink = allDrinks.find(d => d.name === name);
    if (drink && drink.isSoldOut) {
        showToast(`⚠️ 抱歉，【${name}】目前已下架售罄囉！`, true);
        return;
    }

    // 檢查冷卻時間
    if (orderCooldown > 0) {
        showToast(`⏳ 吧台正在接收訂單，請等待 ${orderCooldown} 秒後再點下一杯喔！`, 'warning');
        return;
    }
    
    const myOrderedNames = globalServerOrders.filter(o => o.guest === currentName).map(o => o.drink);
    if (myOrderedNames.includes(name)) {
        showCustomConfirm(`您之前已經點過這杯「${name}」囉！要不要換換口味嘗試其他經典調酒呢？`, () => { promptForNotes(name, btn); }, () => {}, '就是要喝', '再想一下');
        return; 
    }
    promptForNotes(name, btn);
}

function scrollToDrink(drinkName, keepFilters = false) {
    if (drinkName === '來一杯shot') {
        showToast('🥃 來一杯 Shot！正在為您隨機抽選今晚的特調...');
        recommendRandomDrink(); // 觸發老虎機抽籤
        return;
    }
    
    if (!keepFilters) {
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';
        
        document.querySelectorAll('.tag-checkbox').forEach(cb => cb.checked = false);
        document.querySelector('input[name="sort"][value="default"]').checked = true;
        document.querySelector('input[name="history-filter"][value="all"]').checked = true; 
        applyFilters(); 
        
        const panel = document.getElementById('advanced-filters');
        if (panel.classList.contains('expanded')) { 
            if(window.innerWidth <= 768) {
                closeFilterSheet();
            } else {
                toggleAdvancedFilters(); 
            }
        }
    }
    
    setTimeout(() => {
        const drink = allDrinks.find(d => d.name === drinkName);
        if (drink) {
            const card = document.getElementById(`drink-card-${drink.id}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.remove('card-highlighted');
                void card.offsetWidth; 
                card.classList.add('card-highlighted');
                setTimeout(() => { card.classList.remove('card-highlighted'); }, 6000);
            }
        }
    }, 100);
}

let isRouletteRunning = false;
let recentlyDrawnDrinks = {}; // 紀錄最近抽中的酒款與時間

// 🔊 搖桿拉動金屬機械聲
function playLeverSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(130, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.15);
        
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(90, ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        
        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

let isLeverInitialized = false;
let slotMachineReady = false;
let slotMachineTargetData = null;

function setupSlotLever() {
    if (isLeverInitialized) return;
    const lever = document.getElementById('slot-lever');
    if (!lever) return;
    const arm = lever.querySelector('.lever-arm');
    if (!arm) return;

    let isDragging = false;
    let startY = 0;
    let deltaY = 0;

    lever.addEventListener('pointerdown', (e) => {
        if (!slotMachineReady) return;
        isDragging = true;
        startY = e.clientY;
        deltaY = 0;
        lever.releasePointerCapture(e.pointerId);
        arm.style.transition = 'none';
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        deltaY = e.clientY - startY;
        deltaY = Math.max(0, Math.min(65, deltaY));
        const angle = (deltaY / 65) * 135;
        arm.style.transform = `rotate(${angle}deg)`;
    });

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        arm.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        
        if (deltaY >= 35) {
            triggerLeverPull();
        } else {
            arm.style.transform = '';
        }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    lever.addEventListener('click', (e) => {
        if (!slotMachineReady || isDragging) return;
        triggerLeverPull();
    });

    isLeverInitialized = true;
}

function triggerLeverPull() {
    if (!slotMachineReady) return;
    slotMachineReady = false;
    
    const lever = document.getElementById('slot-lever');
    if (lever) lever.classList.remove('ready-to-pull');

    playLeverSound();

    const arm = lever ? lever.querySelector('.lever-arm') : null;
    if (arm) {
        arm.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        arm.style.transform = 'rotate(135deg)';
    }

    if ("vibrate" in navigator) { navigator.vibrate(35); }

    setTimeout(() => {
        if (arm) {
            arm.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            arm.style.transform = 'rotate(0deg)';
        }
        
        if (slotMachineTargetData) {
            startSlotMachineSpin(slotMachineTargetData);
        }
    }, 250);
}

function recommendRandomDrink() {
    if (isRouletteRunning) return; // 避免動畫期間重複點擊

    const now = Date.now();
    const cooldownMs = 5 * 60 * 1000; // 5 分鐘冷卻時間
    
    // 清除已過期的冷卻紀錄，釋放記憶體
    for (const name in recentlyDrawnDrinks) {
        if (now - recentlyDrawnDrinks[name] > cooldownMs) delete recentlyDrawnDrinks[name];
    }

    // --- 新增：偵測客人是否有啟用篩選條件 (排除預設的全部與預設排序) ---
    const activeCheckboxes = Array.from(document.querySelectorAll('.tag-checkbox:checked')).filter(cb => cb.value !== 'all' && cb.value !== 'default');
    
    // 檢查桌面版或手機版搜尋框是否有值
    const searchInput = document.getElementById('search-input');
    const searchVal = searchInput && searchInput.value.trim() !== '';
    
    const hasFilters = activeCheckboxes.length > 0 || searchVal;
    
    // 若有篩選，則只從篩選後的酒款中抽籤；若無，則從全部酒款抽
    const poolToDraw = hasFilters ? globalFilteredDrinks : allDrinks;

    // 從目標獎池中抓出「尚未售罄」的酒款
    const allAvailableDrinks = poolToDraw.filter(d => !d.isSoldOut);
    if (allAvailableDrinks.length === 0) {
        showToast(hasFilters ? '⚠️ 抱歉，符合您口味偏好的酒款已售罄或不存在！請放寬篩選條件。' : '⚠️ 抱歉，目前所有酒款皆已售罄！', true);
        return;
    }

    // 濾除最近 5 分鐘內已經抽中過的酒，作為真正會抽出的獎池
    let validDrinksForDraw = allAvailableDrinks.filter(d => !recentlyDrawnDrinks[d.name]);
    
    // 防呆：如果客人狂抽，把所有可用的酒都抽進冷卻池了，就自動重置冷卻池
    if (validDrinksForDraw.length === 0) {
        recentlyDrawnDrinks = {};
        validDrinksForDraw = allAvailableDrinks;
    }
    
    isRouletteRunning = true;
    
    // 如果是在手機版的篩選抽屜裡點擊，則自動收合抽屜以便看老虎機動畫
    if(window.innerWidth <= 768) {
        closeFilterSheet();
    }
    
    // --- 給予即時的按鈕視覺回饋 ---
    const randBtns = [document.getElementById('random-btn'), document.getElementById('mobile-random-btn')];
    randBtns.forEach(btn => {
        if (btn) {
            // 暫存原本的文字以便恢復
            btn.dataset.originalText = btn.innerText;
            btn.innerText = '⏳ 準備中';
            btn.style.background = '#7f8c8d'; // 變成代表等待中的灰色
            btn.disabled = true; // 暫時鎖定按鈕
        }
    });
    // ----------------------------
    
    // --- 顯示老虎機模態視窗 ---
    const slotOverlay = document.getElementById('slot-machine-overlay');
    const slotText = document.getElementById('slot-machine-text');
    const slotContent = document.getElementById('slot-machine-content');
    
    // 在老虎機畫面上方加入動態提示文字
    let slotHint = document.getElementById('slot-machine-hint');
    if (!slotHint && slotContent) {
        slotHint = document.createElement('div');
        slotHint.id = 'slot-machine-hint';
        slotHint.style.cssText = 'color: #3498db; font-size: 0.9em; margin-bottom: 10px; font-weight: bold; background: rgba(52, 152, 219, 0.1); padding: 5px; border-radius: 5px; border: 1px dashed #3498db;';
        slotContent.insertBefore(slotHint, slotContent.children[1]); // 插入在標題和輪盤之間
    }
    
    if (slotHint) {
        slotHint.innerText = hasFilters ? '🎯 正在從您篩選的結果中抽取...' : '🎲 正在從吧台所有酒款中抽取...';
    }
    
    // 預先準備好老虎機專用的圖片元素並隱藏它
    let slotImg = document.getElementById('slot-machine-img');
    if (!slotImg && slotContent) {
        slotImg = document.createElement('img');
        slotImg.id = 'slot-machine-img';
        slotImg.style.cssText = 'width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: none; margin-left: auto; margin-right: auto;';
        slotContent.insertBefore(slotImg, slotText.parentNode); 
    }
    if (slotImg) {
        slotImg.style.display = 'none';
        slotImg.style.transform = '';
        slotImg.style.border = '';
        slotImg.style.boxShadow = '';
    }

    if (slotText) {
        slotText.innerText = "👉 請拉下右側搖桿！";
        slotText.style.transition = '';
        slotText.style.transform = '';
        slotText.style.color = '#fff';
        slotText.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
        slotText.style.opacity = '1';
        slotText.style.fontSize = '1.6em';
    }

    // 建立加權抽籤池：普通酒款 1 張籤，我的最愛酒款 3 張籤 (機率提升 3 倍)
    let lotteryPool = [];
    validDrinksForDraw.forEach(d => {
        lotteryPool.push(d); // 基本的 1 票
        if (guestFavorites.includes(d.name)) {
            lotteryPool.push(d, d); // 最愛額外加 2 票，總共 3 票
        }
    });

    // 先抽出最終結果
    const finalDrink = lotteryPool[Math.floor(Math.random() * lotteryPool.length)];
    recentlyDrawnDrinks[finalDrink.name] = now; // 記錄抽中時間，讓這杯酒進入 5 分鐘冷卻
    
    // 初始化搖桿事件與狀態
    setupSlotLever();
    const lever = document.getElementById('slot-lever');
    if (lever) {
        lever.classList.add('ready-to-pull');
    }
    
    // 儲存抽籤目標資料，等待拉桿觸發
    slotMachineTargetData = {
        finalDrink,
        allAvailableDrinks,
        hasFilters,
        randBtns,
        slotOverlay,
        slotText,
        slotContent,
        slotImg
    };
    
    slotMachineReady = true;

    if (slotOverlay) {
        slotOverlay.style.visibility = 'visible';
        slotOverlay.style.opacity = '1';
        if (slotContent) slotContent.style.transform = 'scale(1)';
    }
}

function startSlotMachineSpin(data) {
    const { finalDrink, allAvailableDrinks, hasFilters, randBtns, slotOverlay, slotText, slotContent, slotImg } = data;
    
    let spins = 0;
    const maxSpins = 25; // 增加跳動次數讓老虎機轉久一點
    let delay = 40; // 初始速度加快，營造瘋狂轉動感
    
    function spinRoulette() {
        if (spins < maxSpins) {
            // 動畫過場用 allAvailableDrinks，讓視覺上看起來還是在所有酒款中轉動
            const tempDrink = allAvailableDrinks[Math.floor(Math.random() * allAvailableDrinks.length)];
            const encodedName = encodeURIComponent(tempDrink.name);
            
            // 更新老虎機畫面與圖片
            if (slotText) {
                slotText.innerText = tempDrink.name;
                // 加上快速上下震動，製造吃角子老虎轉動殘影效果
                const offset = (spins % 2 === 0) ? '-12px' : '12px';
                slotText.style.transform = `translateY(${offset})`;
                slotText.style.color = '#ccc';
                slotText.style.textShadow = 'none';
                slotText.style.opacity = '0.7';
                
                // 動畫期間暫時縮小字體以確保在同一行
                slotText.style.fontSize = '1.5em';
            }
            if (slotImg) {
                slotImg.src = `/images/${encodedName}.jpg`;
                slotImg.style.display = 'block';
                // 圖片也跟著微幅震動
                const imgOffset = (spins % 2 === 0) ? '-4px' : '4px';
                slotImg.style.transform = `translateY(${imgOffset})`;
                slotImg.style.opacity = '0.7';
            }
            
            if (typeof playTickSound === 'function') playTickSound();
            spins++;
            delay += 12; // 每次跳動增加延遲，模擬越來越慢的煞車感
            setTimeout(spinRoulette, delay);
        } else {
            // 動畫結束，顯示最終大獎
            if (typeof playCelebrateSound === 'function') playCelebrateSound();
            const encodedFinalName = encodeURIComponent(finalDrink.name);
            
            if (slotText) {
                slotText.innerText = finalDrink.name;
                // 加上「開獎」的放大彈跳與金色發光特效
                slotText.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                slotText.style.transform = 'translateY(0) scale(1.1)';
                slotText.style.color = '#f1c40f';
                slotText.style.textShadow = '0 0 20px rgba(241, 196, 15, 0.9)';
                slotText.style.opacity = '1';
                
                // 動畫結束後恢復字體大小，長字串會由 CSS 自動折行處理
                slotText.style.fontSize = '1.8em';
            }
            if (slotImg) {
                slotImg.src = `/images/${encodedFinalName}.jpg`;
                slotImg.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                slotImg.style.transform = 'translateY(0) scale(1.2)';
                slotImg.style.opacity = '1';
                slotImg.style.border = '2px solid #f1c40f';
                slotImg.style.boxShadow = '0 0 15px rgba(241, 196, 15, 0.6)';
            }
            
            if ("vibrate" in navigator) { navigator.vibrate([100, 50, 100]); } // 抽中時給予特殊震動回饋
            triggerConfetti(); // 抽出結果的瞬間發射紙花特效
            
            // 停留 0.7 秒讓客人看清楚開獎結果，然後關閉老虎機並導航
            setTimeout(() => {
                if (slotOverlay) {
                    slotOverlay.style.opacity = '0';
                    if (slotContent) slotContent.style.transform = 'scale(0.8)';
                    setTimeout(() => { 
                        slotOverlay.style.visibility = 'hidden'; 
                        // 重置樣式以備下次使用
                        if(slotImg) slotImg.style.display = 'none';
                    }, 300);
                }
                
                isRouletteRunning = false;
                // 恢復按鈕狀態，但樣式交給 applyFilters 重新計算
                randBtns.forEach(btn => {
                    if (btn) {
                        btn.disabled = false;
                    }
                });
                applyFilters(); // 強制觸發一次過濾以恢復按鈕的動態文字
                
                const prefix = hasFilters ? '🎯 根據您的口味偏好，推薦您：' : '🎲 吧台為您推薦：';
                showToast(`${prefix}【${finalDrink.name}】！`);
                scrollToDrink(finalDrink.name, true);
            }, 700);
        }
    }
    
    spinRoulette(); // 啟動輪盤
}

function cancelOrder(orderId, btn) {
    showCustomConfirm('確定要取消這杯酒嗎？', () => {
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        socket.emit('delete-order', orderId);
        globalServerOrders = globalServerOrders.filter(o => o.id !== orderId);
        showToast('❌ 已取消訂單', true); 
        
        // 延遲 0.6 秒讓取消按鈕的轉圈圈跑一下，再將它從清單中移除
        setTimeout(() => {
            renderLeaderboard(); checkMilestone(); applyFilters(); 
            if (btn) { btn.classList.remove('btn-loading'); const orderElement = document.getElementById(`history-order-${orderId}`); if (orderElement) orderElement.remove(); }
            loadHistory(); 
            updateFAB();
        }, 600);
    }, () => {}, '確定取消', '保留訂單');
}

function forceRemove(orderId) { 
    showCustomConfirm('確定要刪除這筆點餐紀錄嗎？', () => {
        socket.emit('delete-order', orderId); 
        
        // 立即更新前端畫面，給予即時的滑出消失回饋
        globalServerOrders = globalServerOrders.filter(o => o.id !== orderId);
        const orderElement = document.getElementById(`history-order-${orderId}`);
        if (orderElement) {
            orderElement.style.transition = 'all 0.3s ease';
            orderElement.style.opacity = '0';
            orderElement.style.transform = 'translateX(30px)'; // 向右滑出
            setTimeout(() => {
                orderElement.remove();
                renderLeaderboard(); checkMilestone(); loadHistory(); applyFilters();
            }, 300);
        }
        
        showToast('🗑️ 已刪除該筆紀錄');
    }, () => {}, '刪除紀錄', '保留');
}

function clearAllMyHistory(e) {
    if (e) e.stopPropagation();
    showCustomConfirm('確定要永久清空您的所有點餐紀錄嗎？這將無法復原！', () => {
        const myOrders = globalServerOrders.filter(o => o.guest === currentName);
        myOrders.forEach(o => socket.emit('delete-order', o.id));
        showToast('🗑️ 已清空點餐紀錄');
    }, () => {}, '全部清空', '取消');
}

function clearAllMyFavorites(e) {
    if (e) e.stopPropagation();
    if (!currentName) return;
    showCustomConfirm('確定要清空您的所有最愛清單嗎？', () => {
        guestFavorites = [];
        applyFilters(); 
        renderFavorites(); 
        showToast('🗑️ 已清空最愛清單');
        socket.emit('clear-favorites', currentName);
    }, () => {}, '全部清空', '保留清單');
}

function showOrderToast(guest, drink) {
    if (guest === currentName) return; 
    const container = document.getElementById('order-toast-container');
    const toast = document.createElement('div');
    toast.className = 'order-toast';
    const drinkInfo = allDrinks.find(d => d.name === drink);
    const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
    const avatarUrl = getAvatarUrl(guest);
    
    // Add Reorder button logic to broadcast toast
    const safeDrinkName = drink.replace(/'/g, "\\'");
    let actionHtml = '';
    
    if (isSoldOut) {
        actionHtml = `<span style="font-size: 0.7em; color: #e74c3c; margin-left: 5px;">(已售罄)</span>`;
        toast.style.cursor = 'not-allowed';
    } else {
        // Stop propagation so clicking the button doesn't trigger the toast's main onClick (scrollToDrink)
        actionHtml = `<button class="btn-reorder" style="margin-left: 10px;" onclick="event.stopPropagation(); scrollToDrink('${safeDrinkName}')">👀 去看看</button>`;
        toast.onclick = () => { toast.style.display = 'none'; scrollToDrink(drink); };
    }
    
    toast.innerHTML = `📢 <img src="${avatarUrl}" class="avatar" style="width: 22px; height: 22px; margin-right: 4px;"> <span class="guest-name">${guest}</span> 剛點了 <span class="drink-name">${drink}</span> ${actionHtml}`;
    
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode === container) container.removeChild(toast); }, 4000);
}

function showMilestoneToast(guest, count) {
    const container = document.getElementById('order-toast-container');
    const toast = document.createElement('div');
    toast.className = 'order-toast';
    toast.style.borderLeftColor = '#e74c3c';
    toast.style.backgroundColor = 'rgba(192, 57, 43, 0.95)'; 
    toast.innerHTML = `🏆 狂賀！<span class="guest-name" style="color: #fff">${guest}</span> 達成了 <span class="drink-name" style="color: #f1c40f">當日 ${count} 杯</span> 成就！🎉`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode === container) container.removeChild(toast); }, 6000); 
}

function triggerConfetti() {
    if (typeof confetti !== 'function') return;
    var duration = 3 * 1000;
    var end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, zIndex: 10000, colors: ['#f39c12', '#e74c3c', '#27ae60', '#3498db'] });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, zIndex: 10000, colors: ['#f39c12', '#e74c3c', '#27ae60', '#3498db'] });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

// --- 新增：單次小型彩色碎紙花特效 (適合一般點餐慶祝) ---
function triggerSmallConfetti() {
    if (typeof confetti !== 'function') return;
    confetti({
        particleCount: 100,      // 碎紙花數量
        spread: 70,              // 噴發廣度
        origin: { y: 0.6 },      // 從畫面稍微偏下方的位置往上噴發
        zIndex: 100000,          // 確保蓋過所有黑幕與視窗
        colors: ['#f39c12', '#e74c3c', '#27ae60', '#3498db', '#f1c40f', '#9b59b6']
    });
}

function triggerFireworks() {
    if (typeof confetti !== 'function') return;
    var duration = 5 * 1000;
    var animationEnd = Date.now() + duration;
    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };
    function randomInRange(min, max) { return Math.random() * (max - min) + min; }
    var interval = setInterval(function() {
        var timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) { return clearInterval(interval); }
        var particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

/* === 專屬進場特效：灑落金粉 === */
function triggerWelcomeGoldDust() {
    if (typeof confetti !== 'function') return;
    var duration = 3.5 * 1000; // 3.5秒的進場特效
    var animationEnd = Date.now() + duration;
    // 專屬金色系、較小的顆粒(scalar)與較輕的重力(gravity)模擬金粉飄落
    var defaults = { startVelocity: 15, spread: 360, ticks: 80, zIndex: 100000, colors: ['#ffd700', '#f39c12', '#f1c40f', '#ffffff'], gravity: 0.5, scalar: 0.6 };
    
    function randomInRange(min, max) { return Math.random() * (max - min) + min; }
    
    var interval = setInterval(function() {
        var timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) { return clearInterval(interval); }
        var particleCount = 30 * (timeLeft / duration);
        // 讓金粉從畫面頂端 (y: 0 附近) 隨機灑落
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0, 1), y: Math.random() - 0.2 } }));
    }, 250);
}

function renderLeaderboard() {
    const todayCounts = {};
    const allTimeCounts = {};
    let hasData = false;

    const expandedToday = Array.from(document.querySelectorAll('#today-leaderboard-list .lb-details[style*="display: block"]')).map(el => el.parentElement.dataset.guest);
    const expandedAllTime = Array.from(document.querySelectorAll('#alltime-leaderboard-list .lb-details[style*="display: block"]')).map(el => el.parentElement.dataset.guest);

    globalServerOrders.forEach(o => {
        if (!o.id || o.status !== 'completed') return;
        const ts = parseInt(o.id.split('-')[0]);
        hasData = true;
        allTimeCounts[o.guest] = (allTimeCounts[o.guest] || 0) + 1;
        if (new Date(ts).toDateString() === new Date().toDateString()) {
            todayCounts[o.guest] = (todayCounts[o.guest] || 0) + 1;
        }
    });
    
    if (!hasData) {
        document.getElementById('leaderboard-container').style.display = 'none';
        return;
    }
    
    document.getElementById('leaderboard-container').style.display = 'block';
    const rankMedals = ['🥇', '🥈', '🥉'];

    const todaySorted = Object.entries(todayCounts).sort((a, b) => b[1] - a[1]);
    const allTimeSorted = Object.entries(allTimeCounts).sort((a, b) => b[1] - a[1]);

    document.getElementById('today-leaderboard-list').innerHTML = todaySorted.length > 0 ? todaySorted.map((item, index) => {
        const rankStr = index < 3 ? rankMedals[index] : `${index + 1}.`;
        const avatarUrl = getAvatarUrl(item[0]);
        const safeName = item[0].replace(/'/g, "\\'");
        const fireEffect = index === 0 ? '<span class="fire-effect" onclick="event.stopPropagation(); triggerFireworks();" title="點擊放煙火！">🔥</span>' : '';
        return `<div class="lb-item-container" data-guest="${safeName}" style="margin-bottom: 8px;">
                    <div class="lb-item" onclick="toggleGuestOrders(this, '${safeName}', true)" style="cursor: pointer; transition: 0.2s;" title="點擊展開/收合戰績">
                        <span class="lb-rank">${rankStr}</span>
                        <span class="lb-name" style="display: flex; align-items: center;"><img src="${avatarUrl}" class="avatar" style="margin-right: 8px;">${item[0]}${fireEffect}</span>
                        <span class="lb-count">${item[1]} 杯 <span class="expand-icon" style="color:#aaa; font-size:0.7em; margin-left:5px; vertical-align:middle;">▼</span></span>
                    </div>
                    <div class="lb-details" style="display:none; padding: 10px; background: #1a1a1a; border-radius: 0 0 8px 8px; border: 1px solid #444; border-top: none; margin-top: -3px;"></div>
                </div>`;
    }).join('') : '<div style="text-align:center; color:#888; padding: 10px;">今日尚未有完賽紀錄</div>';

    document.getElementById('alltime-leaderboard-list').innerHTML = allTimeSorted.map((item, index) => {
        const rankStr = index < 3 ? rankMedals[index] : `${index + 1}.`;
        const avatarUrl = getAvatarUrl(item[0]);
        const safeName = item[0].replace(/'/g, "\\'");
        const fireEffect = index === 0 ? '<span class="fire-effect">🔥</span>' : '';
        return `<div class="lb-item-container" data-guest="${safeName}" style="margin-bottom: 8px;">
                    <div class="lb-item" onclick="toggleGuestOrders(this, '${safeName}', false)" style="cursor: pointer; transition: 0.2s;" title="點擊展開/收合歷史戰績">
                        <span class="lb-rank">${rankStr}</span>
                        <span class="lb-name" style="display: flex; align-items: center;"><img src="${avatarUrl}" class="avatar" style="margin-right: 8px;">${item[0]}${fireEffect}</span>
                        <span class="lb-count">${item[1]} 杯 <span class="expand-icon" style="color:#aaa; font-size:0.7em; margin-left:5px; vertical-align:middle;">▼</span></span>
                    </div>
                    <div class="lb-details" style="display:none; padding: 10px; background: #1a1a1a; border-radius: 0 0 8px 8px; border: 1px solid #444; border-top: none; margin-top: -3px;"></div>
                </div>`;
    }).join('');

    expandedToday.forEach(name => {
        document.querySelectorAll('#today-leaderboard-list .lb-item-container').forEach(container => {
            if (container.dataset.guest === name) toggleGuestOrders(container.querySelector('.lb-item'), name, true);
        });
    });
    expandedAllTime.forEach(name => {
        document.querySelectorAll('#alltime-leaderboard-list .lb-item-container').forEach(container => {
            if (container.dataset.guest === name) toggleGuestOrders(container.querySelector('.lb-item'), name, false);
        });
    });
}

function checkMilestone() {
    const counts = {};
    globalServerOrders.forEach(o => {
        if (!o.id) return;
        const ts = parseInt(o.id.split('-')[0]);
        if (new Date(ts).toDateString() === new Date().toDateString() && o.status === 'completed') {
            counts[o.guest] = (counts[o.guest] || 0) + 1;
        }
    });
    for (const [name, count] of Object.entries(counts)) {
        const prevCount = knownGuestCounts[name] || 0;
        if (!isLeaderboardFirstLoad) {
            if (count === 5 && prevCount < 5) {
                triggerConfetti();
                showMilestoneToast(name, 5);
            } else if (count === 10 && prevCount < 10) {
                triggerFireworks();
                showMilestoneToast(name, 10);
            }
        }
        knownGuestCounts[name] = count;
    }
    isLeaderboardFirstLoad = false;
}

function openImageModal(src) {
    const modalOverlay = document.getElementById('image-modal-overlay');
    const modalImage = document.getElementById('modal-image');
    const closeBtn = document.getElementById('image-modal-close-btn');

    // 確保背景狀態乾淨，以便正常顯示
    modalOverlay.style.opacity = '0';
    modalOverlay.style.transition = 'none';

    // 設定彈出動畫的初始狀態 (縮小 50% + 全透明)
    modalImage.style.transition = 'none';
    modalImage.style.transform = 'scale(0.5)';
    modalImage.style.opacity = '0';
    if (closeBtn) {
        closeBtn.style.transition = 'none';
        closeBtn.style.transform = 'scale(0.5)';
        closeBtn.style.opacity = '0';
    }

    // 鎖定背景捲動
    document.body.style.overflow = 'hidden';

    modalImage.src = src;
    modalOverlay.classList.add('visible');
    
    // 強制觸發瀏覽器重繪 (Reflow)，讓瀏覽器套用初始狀態
    void modalImage.offsetWidth;
    void modalOverlay.offsetWidth;

    // 背景與毛玻璃效果漸變淡入
    modalOverlay.style.transition = 'opacity 0.5s ease';
    modalOverlay.style.opacity = '1';

    // 加上帶有「回彈感」的 Pop-up 彈出動畫過渡效果
    modalImage.style.transition = 'transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.5s ease-out';
    modalImage.style.transform = 'scale(1)';
    modalImage.style.opacity = '1';
    if (closeBtn) {
        // 稍微延遲 0.1 秒，讓按鈕跟隨在圖片之後彈出，增加層次感
        closeBtn.style.transition = 'transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.1s, opacity 0.5s ease-out 0.1s, background 0.2s';
        closeBtn.style.transform = 'scale(1)';
        closeBtn.style.opacity = '1';
    }

    // 確保點擊圖片本身或背景都能關閉大圖
    modalImage.onclick = closeImageModal;
    modalOverlay.onclick = closeImageModal;
}

function closeImageModal() {
    const modalOverlay = document.getElementById('image-modal-overlay');
    const modalImage = document.getElementById('modal-image');
    const closeBtn = document.getElementById('image-modal-close-btn');
    
    // 關閉時加上縮小並淡出的動畫
    modalImage.style.transition = 'transform 0.5s ease-in, opacity 0.5s ease-in';
    modalImage.style.transform = 'scale(0.8)';
    modalImage.style.opacity = '0';
    if (closeBtn) {
        closeBtn.style.transition = 'transform 0.4s ease-in, opacity 0.4s ease-in';
        closeBtn.style.transform = 'scale(0.8)';
        closeBtn.style.opacity = '0';
    }

    // 背景也加上淡出動畫
    modalOverlay.style.transition = 'opacity 0.5s ease';
    modalOverlay.style.opacity = '0';
    
    // 延遲 500 毫秒才真正拔除 visible class 並清空圖片
    setTimeout(() => {
        modalOverlay.classList.remove('visible');
        modalOverlay.style.opacity = '';
        modalOverlay.style.transition = '';
        // 恢復背景捲動
        document.body.style.overflow = '';
        if (!modalOverlay.classList.contains('visible')) {
            modalImage.src = '';
        }
    }, 500);
}

// 將所有 Socket 監聽移出至獨立檔案的尾端
socket.on('sync-orders', (serverOrders) => {
    globalServerOrders = serverOrders;
    renderLeaderboard();
    checkMilestone();
    loadHistory();
    applyFilters();
    updateFAB();
    if (typeof checkAchievements === 'function') checkAchievements();
});

socket.on('order-error', (msg) => {
    showToast(msg, true);
    // 重設點餐按鈕狀態
    applyFilters();
});

socket.on('rating-error', (msg) => {
    showToast(`⚠️ ${msg}`, true);
});

socket.on('order-status-updated', (data) => {
    const globalIndex = globalServerOrders.findIndex(o => o.id === data.id);
    let oldStatus = 'pending';

    if (globalIndex !== -1) {
        oldStatus = globalServerOrders[globalIndex].status;
        globalServerOrders[globalIndex] = data;
    } else {
        globalServerOrders.push(data);
    }

    // 當客人的訂單被吧台退回時，彈出紅色的專屬推播通知
    if (data.guest === currentName && data.status === 'rejected' && oldStatus !== 'rejected') {
        showToast(`🚫 抱歉，您的【${data.drink}】訂單已被吧台退回！`, true);
        sendSystemNotification('🍸 Iverson Bar', `抱歉，您的【${data.drink}】訂單已被吧台退回！`, true);
    }

    // 當客人的訂單開始製作時，彈出橘黃色的專屬推播通知
    if (data.guest === currentName && data.status === 'making' && oldStatus !== 'making') {
        showToast(`👨‍🍳 吧台正在為您製作【${data.drink}】！`, 'warning');
        sendSystemNotification('🍸 Iverson Bar', `吧台正在為您製作【${data.drink}】！`, false);
    }

    // 當客人的訂單完成(出餐)時，彈出綠色的專屬推播通知
    if (data.guest === currentName && data.status === 'completed' && oldStatus !== 'completed') {
        showToast(`🍸 您的【${data.drink}】已經完成囉！`, false);
        sendSystemNotification('🍸 Iverson Bar', `您的【${data.drink}】已經完成囉！`, true);
    }

    renderLeaderboard();
    checkMilestone();
    updateHistoryOrderUI(data);
    applyFilters();
    updateFAB();
    if (typeof checkAchievements === 'function') checkAchievements();
});

socket.on('sync-campaign', (campaign) => {
    globalCampaign = campaign;
    updateCampaignBanner(campaign);
});

socket.on('campaign-updated', (campaign) => {
    globalCampaign = campaign;
    updateCampaignBanner(campaign);
});

socket.on('rating-updated', (data) => {
    globalRatings[data.drinkName] = data.stats;
    if (data.entry && data.entry.guest === currentName) {
        myRatings[data.entry.orderId] = {
            stars: data.entry.stars,
            comment: data.entry.comment,
            ts: data.entry.ts
        };
    }
    loadHistory();
    applyFilters();
    if (typeof checkAchievements === 'function') checkAchievements();
});

socket.on('admin-notification', (orderData) => {
    showOrderToast(orderData.guest, orderData.drink);
});

socket.on('order-deleted', (orderId) => {
    globalServerOrders = globalServerOrders.filter(o => o.id !== orderId);
    renderLeaderboard();
    checkMilestone();
    loadHistory();
    applyFilters();
    updateFAB();
});

let soldOutUpdateTimer = null;
let recentlyUpdatedDrinks = [];

socket.on('drink-sold-out-updated', (data) => {
    const drink = allDrinks.find(d => d.id === data.id);
    if (drink) {
        if (Boolean(drink.isSoldOut) !== Boolean(data.isSoldOut)) {
            recentlyUpdatedDrinks.push({ name: drink.name, isSoldOut: data.isSoldOut, id: drink.id });
        }
        drink.isSoldOut = data.isSoldOut;
        
        // 使用 setTimeout 防抖 (Debounce)，避免整批下架時造成大量重複渲染與通知洗版
        clearTimeout(soldOutUpdateTimer);
        soldOutUpdateTimer = setTimeout(() => {
            applyFilters();
            renderFavorites(); // 讓最愛清單也即時更新售罄狀態 (反灰)
            renderCarousel();  // 讓頂部自動輪播圖移除已售罄的酒
            
            const soldOuts = recentlyUpdatedDrinks.filter(d => d.isSoldOut).map(d => d.name);
            const restocks = recentlyUpdatedDrinks.filter(d => !d.isSoldOut).map(d => d.name);
            
            if (soldOuts.length > 0) {
                const msg = soldOuts.length > 3 ? `${soldOuts.slice(0, 3).join('、')}...等 ${soldOuts.length} 款酒` : restocks.join('、');
                showToast(`📢 吧台公告：【${msg}】已售罄！`, true); // true 代表紅色警告背景
            } else if (restocks.length > 0) {
                const msg = restocks.length > 3 ? `${restocks.slice(0, 3).join('、')}...等 ${restocks.length} 款酒` : restocks.join('、');
                showToast(`✨ 吧台公告：【${msg}】補貨上架囉！`);
            }
            
            // 針對剛更新狀態的酒款，在畫面上加上閃爍特效以吸引客人注意
            recentlyUpdatedDrinks.forEach(d => {
                const card = document.getElementById(`drink-card-${d.id}`);
                if (card) {
                    card.classList.remove('card-highlighted');
                    void card.offsetWidth; // 觸發重繪
                    card.classList.add('card-highlighted');
                    setTimeout(() => card.classList.remove('card-highlighted'), 6000);
                }
            });

            recentlyUpdatedDrinks = [];
        }, 300);
    }
});

socket.on('recipes-updated', () => {
    showToast('🔄 吧台已更新酒單與配方，畫面即將同步...');
    setTimeout(() => { window.location.reload(); }, 1500);
});

socket.on('sync-favorites', (favs) => {
    guestFavorites = favs || [];
    renderFavorites();
    applyFilters();
});

socket.on('favorites-updated', (updatedGuest) => {
    if (updatedGuest === currentName) {
        socket.emit('get-favorites', currentName);
    }
});

socket.on('sync-avatars', (avatars) => {
    globalAvatars = avatars;
    if (currentName) {
        if (avatars[currentName]) {
            myAvatarStyle = avatars[currentName];
            localStorage.setItem('bar_guest_avatar_style', myAvatarStyle);
        } else {
            socket.emit('update-avatar', { guest: currentName, style: myAvatarStyle });
        }
        updateMainTitle();
    }
    renderLeaderboard();
});

// 新增：網路斷線/連線提示，避免在酒吧收訊不良時客人不知情
socket.on('disconnect', () => {
    showToast('⚠️ 網路連線已中斷，正在嘗試重新連線...', true);
    document.body.style.filter = 'grayscale(0.5)'; // 畫面稍微變灰提示
});

socket.on('connect', () => {
    document.body.style.filter = '';
    showToast('🟢 系統連線成功！');
    
    // 斷線重連時，主動向伺ervidor要求最新的最愛清單，確保跨裝置同步
    if (currentName) {
        loadFavorites();
    }
});

// 確保手機從背景切回前景時主動更新資料
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // 主動更新最愛清單等資料
        if (currentName && socket.connected) {
            loadFavorites();
        }
    }
});

// 回到頂部邏輯
const backToTopBtn = document.getElementById('back-to-top');
if (backToTopBtn) {
    // 初始化動畫屬性：設定全透明、不可點擊，並稍微往下沉
    backToTopBtn.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    backToTopBtn.style.transition = 'opacity 0.4s ease, transform 0.4s ease, filter 0.3s ease';
    backToTopBtn.style.opacity = '0';
    backToTopBtn.style.pointerEvents = 'none';
    backToTopBtn.style.transform = 'translateY(20px)';
    backToTopBtn.style.display = 'flex'; // 保持渲染在畫面上以支援過渡動畫

    // --- 加上滑鼠 Hover 特效 ---
    backToTopBtn.addEventListener('mouseenter', () => {
        if (backToTopBtn.style.opacity === '1') {
            backToTopBtn.style.transform = 'translateY(-6px)'; // 往上浮起
            backToTopBtn.style.filter = 'brightness(1.2)'; // 亮度提升 20%
        }
    });
    
    backToTopBtn.addEventListener('mouseleave', () => {
        if (backToTopBtn.style.opacity === '1') {
            backToTopBtn.style.transform = 'translateY(0)'; // 恢復原位
            backToTopBtn.style.filter = 'brightness(1)'; // 恢復亮度
        }
    });
}

let isScrolling = false;
window.addEventListener('scroll', () => {
    // 使用 requestAnimationFrame 進行滾動事件節流，優化手機滑動效能
    if (!isScrolling) {
        window.requestAnimationFrame(() => {
            if (window.pageYOffset > 400) {
                if (backToTopBtn) {
                    backToTopBtn.style.opacity = '1';
                    backToTopBtn.style.pointerEvents = 'auto';
                    backToTopBtn.style.transform = 'translateY(0)';
                    // 若滑鼠正停留在按鈕上，保持上浮狀態，不要硬壓回 0
                    if (!backToTopBtn.matches(':hover')) {
                        backToTopBtn.style.transform = 'translateY(0)';
                    }
                }
            } else {
                if (backToTopBtn) {
                    backToTopBtn.style.opacity = '0';
                    backToTopBtn.style.pointerEvents = 'none';
                    backToTopBtn.style.transform = 'translateY(20px)';
                    backToTopBtn.style.filter = 'brightness(1)'; // 隱藏時重置亮度
                }
            }
            isScrolling = false;
        });
        isScrolling = true;
    }
});

// 自訂平滑捲動至指定元素的函式 (可自由控制秒數)
function customSmoothScrollToElement(element, duration = 800) {
    // 取得目標元素距離網頁頂端的絕對位置，並稍微預留 20px 緩衝留白
    const targetPosition = element.getBoundingClientRect().top + window.pageYOffset - 20;
    const startPosition = window.pageYOffset;
    const distance = targetPosition - startPosition;
    let startTime = null;

    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);
        
        // 使用 easeOutQuart 緩動函數，呈現自然且滑順的煞車感
        const easeProgress = 1 - Math.pow(1 - progress, 4); 
        
        window.scrollTo(0, startPosition + distance * easeProgress);

        if (timeElapsed < duration) {
            window.requestAnimationFrame(animation);
        }
    }
    
    window.requestAnimationFrame(animation);
}

function scrollToTop() {
    // 設定捲動回頂部的總時間 (毫秒)。數值越小越快，越大越慢。
    const duration = 500; // 預設 500 毫秒 (0.5秒)。如果您覺得太快可以改成 800，覺得太慢可以改成 300
    const startPosition = window.pageYOffset;
    let startTime = null;

    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);
        
        // 使用 easeOutQuart 緩動函數，讓滑動呈現「先快後慢」的自然煞車感
        const easeProgress = 1 - Math.pow(1 - progress, 4); 
        
        window.scrollTo(0, startPosition * (1 - easeProgress));

        if (timeElapsed < duration) {
            window.requestAnimationFrame(animation);
        }
    }
    
    window.requestAnimationFrame(animation);
}

// UI 局部更新輔助函式
function updateHistoryOrderUI(orderData) {
    const orderElement = document.getElementById(`history-order-${orderData.id}`);
    if (!orderElement) {
        loadHistory();
        return;
    }
    orderElement.classList.remove('status-updated-flash-pending', 'status-updated-flash-making', 'status-updated-flash-completed', 'status-updated-flash-rejected');
    void orderElement.offsetWidth; 

    const flashClassMap = {
        'pending': 'status-updated-flash-pending',
        'making': 'status-updated-flash-making',
        'completed': 'status-updated-flash-completed',
        'rejected': 'status-updated-flash-rejected'
    };
    orderElement.classList.add(flashClassMap[orderData.status || 'pending']);

    const statusMap = {
        'pending': ['#888', '⌛ 待接單'],
        'making': ['#f39c12', '👨‍🍳 製作中'],
        'completed': ['#27ae60', '✅ 已完成'],
        'rejected': ['#e74c3c', '🚫 已退單']
    };
    const [color, text] = statusMap[orderData.status || 'pending'];
    
    // 定義各狀態對應的整行半透明背景顏色，並應用漸變更新
    const rowBgMap = {
        'pending': 'transparent',
        'making': 'rgba(243, 156, 18, 0.1)',
        'completed': 'rgba(39, 174, 96, 0.05)',
        'rejected': 'rgba(231, 76, 60, 0.1)'
    };
    orderElement.style.transition = 'background-color 0.4s ease';
    orderElement.style.backgroundColor = rowBgMap[orderData.status || 'pending'];

    const canCancel = (!orderData.status || orderData.status === 'pending');

    const statusTag = orderElement.querySelector('.history-status-tag');
    if (statusTag) {
        statusTag.style.background = color;
        statusTag.innerText = text;
    }

        // 即時連動：如果訂單狀態變更為退單，或是酒款剛好售罄，則動態加上灰階濾鏡
        const imgElement = orderElement.querySelector('img');
        if (imgElement) {
            const drinkInfo = allDrinks.find(d => d.name === orderData.drink);
            const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
            if (isSoldOut || orderData.status === 'rejected') {
                // 訂單被退回或售罄時給予強烈震動提示
                if ("vibrate" in navigator) { navigator.vibrate([100, 50, 100]); }
                imgElement.style.filter = 'grayscale(1)';
                imgElement.style.opacity = '0.7';
            } else {
                imgElement.style.filter = '';
                imgElement.style.opacity = '';
            }
        }

    const timeDetailsCell = orderElement.querySelector('.history-time-info');
    if (timeDetailsCell) {
        const wrapper = timeDetailsCell.querySelector('.time-details-wrapper');
        const isExpanded = wrapper && wrapper.style.display === 'block';

        const ts = parseInt(orderData.id.split('-')[0]);
        const dateDisplay = !isNaN(ts) ? new Date(ts).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '';
        let newTimeDetailsHTML = ``;
        newTimeDetailsHTML += `<div><span class="time-icon">📅</span> ${dateDisplay} <span onclick="toggleTimeDetails(this)" style="cursor:pointer; font-size: 0.8em; color: #888; margin-left: 5px;">${isExpanded ? '▲ 收合' : '▼ 詳細時間'}</span></div>`;
        newTimeDetailsHTML += `<div class="time-details-wrapper" style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 5px; padding-left: 10px; border-left: 2px solid #333;">`;
        newTimeDetailsHTML += `<div><span class="time-icon">📝</span> 點餐: ${orderData.time}</div>`;
        if (orderData.makingTime) newTimeDetailsHTML += `<div><span class="time-icon">👨‍🍳</span> 製作: ${orderData.makingTime}</div>`;
        if (orderData.completedTime) newTimeDetailsHTML += `<div><span class="time-icon">🍸</span> 完成: ${orderData.completedTime}</div>`;
        newTimeDetailsHTML += `</div>`;
        timeDetailsCell.innerHTML = newTimeDetailsHTML;
    }

    const cancelBtnCell = orderElement.querySelector('.history-card-actions'); 
    if (cancelBtnCell) {
        const safeDrinkName = orderData.drink.replace(/'/g, "\\'");
        const drinkInfo = allDrinks.find(d => d.name === orderData.drink);
        const isSoldOut = drinkInfo && drinkInfo.isSoldOut;
        let cellHtml = ``;
        if (canCancel) {
            cellHtml += `<button class="history-btn-cancel" onclick="cancelOrder('${orderData.id}', this)">✖ 取消</button>`;
        }
        cellHtml += `<button class="history-btn-reorder" onclick="event.stopPropagation(); scrollToDrink('${safeDrinkName}')" ${isSoldOut ? 'disabled title="目前售罄"' : ''}>👀 去看看</button>`;
        cancelBtnCell.innerHTML = cellHtml;
    }
}

// --- 年齡確認邏輯 ---
function checkAgeVerification() {
    // 使用 sessionStorage，這樣客人關掉瀏覽器後下次重開還是會確認，符合安全規範
    const isVerified = sessionStorage.getItem('bar_age_verified'); 
    if (!isVerified) {
        // 如果沒有驗證過，重新顯示合併後的歡迎畫面要求勾選年齡
        const welcomeScreen = document.getElementById('welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = ''; // 覆蓋掉 inline 的 display: none
            welcomeScreen.classList.add('visible');
            
            // 自動帶入客人之前填過的名字，讓他們只要打勾就好
            const nameInput = document.getElementById('guest-name');
            if (nameInput && currentName) nameInput.value = currentName;
                
            // 初次進店的年齡確認畫面，不顯示主題切換與音樂按鈕
            const themeSection = document.getElementById('theme-toggle-section');
            if (themeSection) themeSection.style.display = 'none';
        }
    }
}


// 清除搜尋框內容
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
        applyFilters(); // 重新觸發過濾，顯示全部酒款
        searchInput.focus(); // 保持焦點
        document.getElementById('clear-search-btn').style.display = 'none'; // 隱藏按鈕
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initStarrySky(); // 啟動星空特效
    
    // 綁定輸入框事件以觸發清除按鈕顯示/隱藏
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    if (searchInput && clearBtn) {
        searchInput.addEventListener('input', function() {
            clearBtn.style.display = this.value.trim().length > 0 ? 'flex' : 'none';
        });
    }
    
    // 動態注入淺色模式 (Light Mode) 的專屬 CSS 覆寫樣式
    const lightModeStyle = document.createElement('style');
    lightModeStyle.innerHTML = `
        /* === 淺色模式全面色彩覆寫 === */
        body.light-mode { background: #f4f7f6; color: #334155; }
        body.light-mode #main-title { color: #d35400; text-shadow: none; }
        
        /* 歡迎視窗與各種 Modal */
        body.light-mode #welcome-content, body.light-mode .modal-content, body.light-mode #notes-modal-content, body.light-mode #custom-confirm-content, body.light-mode #avatar-modal-content {
            background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 10px 40px rgba(0,0,0,0.1); color: #1e293b;
        }
        body.light-mode #welcome-content p, body.light-mode #welcome-content span { color: #64748b !important; }
        
        /* 酒款卡片 */
        body.light-mode .card { background: #ffffff; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        body.light-mode .card-content h3 { color: #0f172a; text-shadow: none; }
        body.light-mode .description-area { color: #475569; }
        
        /* 材料標籤 */
        body.light-mode .ingredient-tag { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
        
        /* 數值膠囊 (酸度/酒感/ABV) */
        body.light-mode .profile-tag { background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        body.light-mode .tag-sour { background: #f0fdf4; border-color: #bbf7d0; }
        body.light-mode .tag-sour strong { color: #166534; text-shadow: none; }
        body.light-mode .tag-strong { background: #fef2f2; border-color: #fecaca; }
        body.light-mode .tag-strong strong { color: #991b1b; text-shadow: none; }
        body.light-mode .tag-abv { background: #eff6ff; border-color: #bfdbfe; }
        body.light-mode .tag-abv strong { color: #1e3a8a; text-shadow: none; }
        
        /* 卡片上的按鈕與徽章 */
        body.light-mode .favorite-btn { background: rgba(255, 255, 255, 0.9); color: #94a3b8; box-shadow: 0 2px 6px rgba(0,0,0,0.1); }
        body.light-mode .favorite-btn:hover { background: #ffffff; color: #ef4444; }
        body.light-mode .favorite-btn.active { color: #ef4444; }
        body.light-mode .hot-badge { background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2); border: none; }
        
        /* 歷史紀錄與排行榜區塊 */
        body.light-mode #history, body.light-mode #favorites-container, body.light-mode #leaderboard-container { background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 4px 15px rgba(0,0,0,0.03); }
        body.light-mode #history-header h3, body.light-mode #favorites-header h3, body.light-mode .lb-title { color: #d35400; }
        body.light-mode .history-table tr { background-color: #ffffff !important; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
        body.light-mode .history-table tr:hover { background-color: #f8fafc !important; }
        body.light-mode .history-table th { color: #d35400; border-bottom-color: #cbd5e1; }
        body.light-mode .favorite-item { background: #f8fafc !important; color: #1e293b !important; border: 1px solid #e2e8f0 !important; }
        body.light-mode .lb-item { background: #ffffff !important; color: #1e293b !important; border: 1px solid #e2e8f0 !important; }
        body.light-mode .lb-details { background: #f8fafc !important; border: 1px solid #e2e8f0 !important; border-top: none !important; }
        body.light-mode .guest-order-item { background: #ffffff !important; border: 1px solid #e2e8f0 !important; color: #334155 !important; }
        
        /* 篩選與搜尋 */
        body.light-mode .search-box { background: #ffffff !important; color: #1e293b !important; border: 1px solid #cbd5e1 !important; }
        body.light-mode .search-box::placeholder { color: #94a3b8; }
        body.light-mode .tag-btn { background: #ffffff; color: #475569; border-color: #cbd5e1; }
        body.light-mode .tag-checkbox:checked + .tag-btn { background: #d35400; color: #ffffff; border-color: #d35400; }
        body.light-mode #filter-container { background: rgba(255, 255, 255, 0.95) !important; border-color: #e2e8f0 !important; box-shadow: 0 4px 15px rgba(0,0,0,0.05) !important; }
        
        /* 頂部與底部導航 */
        body.light-mode #settings-btn, body.light-mode #menu-toggle-btn { background: rgba(255,255,255,0.95) !important; color: #475569 !important; border: 1px solid #cbd5e1 !important; box-shadow: 0 4px 10px rgba(0,0,0,0.05) !important; }
        body.light-mode .bottom-nav { background: rgba(255, 255, 255, 0.98); border-top: 1px solid #e2e8f0; box-shadow: 0 -2px 10px rgba(0,0,0,0.03); }
        body.light-mode .bottom-nav .nav-item { color: #94a3b8; }
        body.light-mode .bottom-nav .nav-item.active { color: #d35400; }
        
        /* 手機版篩選抽屜 */
        body.light-mode #advanced-filters { background: #ffffff; border-top: 1px solid #e2e8f0; }
        body.light-mode .filter-sheet-header span { color: #d35400 !important; }
        body.light-mode .filter-sheet-close { color: #d35400; border-color: #d35400; background: transparent; }
        body.light-mode .filter-header-search-wrap { border-bottom-color: #e2e8f0; }
        
        /* 其他表單輸入框 */
        body.light-mode input, body.light-mode select { background: #ffffff !important; color: #1e293b !important; border: 1px solid #cbd5e1 !important; }
        body.light-mode .avatar-option { background: #ffffff; border-color: #e2e8f0; }
        body.light-mode .avatar-option:hover { background: #f1f5f9; }
        body.light-mode .avatar-option.selected { background: #fff7ed; border-color: #ea580c; box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.2); }
        body.light-mode .avatar-option span { color: #475569; }
        body.light-mode #theme-toggle-section { background: #f8fafc !important; border-color: #e2e8f0 !important; }
        
        /* 老虎機 */
        body.light-mode #slot-machine-content { background: #ffffff !important; border-color: #8e44ad !important; }
        body.light-mode #slot-machine-text { color: #1e293b !important; text-shadow: none; }
        body.light-mode #slot-machine-hint { background: #f0fdf4 !important; border-color: #bbf7d0 !important; color: #166534 !important; }
        
        /* 吐司推播 */
        body.light-mode #toast, body.light-mode .order-toast { background: #ffffff; color: #1e293b; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-left: 4px solid #3498db; }
        
        /* FAB */
        body.light-mode .fab-badge { border-color: #ffffff; }
        
        /* 歷史紀錄手機版卡片設計 (淺色模式覆寫) */
        body.light-mode .history-card { background: #ffffff; border-color: #e2e8f0; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        body.light-mode .history-drink-name { color: #1e293b; }
        body.light-mode .history-time-info div { color: #64748b; }
        body.light-mode .history-notes-box { background: #fffbeb; border-color: #fed7aa; color: #b45309; }
        body.light-mode .history-btn-cancel { background: #fef2f2; color: #ef4444; border-color: #fecaca; }
        body.light-mode .history-btn-cancel:hover { background: #fee2e2; }
    `;
    document.head.appendChild(lightModeStyle);

    applyTheme(); // 網頁載入時套用記憶的主題

    // 啟動時檢查：如果已經有名字(跳過歡迎畫面)，則檢查是否為重開瀏覽器需重新驗證年齡
    if (currentName) checkAgeVerification();

    const modalOverlay = document.getElementById('image-modal-overlay');
    if (modalOverlay) {
        // 加上毛玻璃模糊效果，並稍微調淡背景色讓模糊更明顯
        modalOverlay.style.backdropFilter = 'blur(10px)';
        modalOverlay.style.webkitBackdropFilter = 'blur(10px)';
        modalOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
        modalOverlay.style.zIndex = '99999'; // 確保黑底遮罩層級最高，蓋過上方標題與底部導航

        modalOverlay.addEventListener('click', closeImageModal);

        // 動態在右上角加入 [X] 關閉按鈕
        if (!document.getElementById('image-modal-close-btn')) {
            const closeBtn = document.createElement('div');
            closeBtn.id = 'image-modal-close-btn';
            closeBtn.innerHTML = '✖';
            closeBtn.style.cssText = 'position: absolute; top: 20px; right: 20px; font-size: 32px; color: #fff; background: rgba(0,0,0,0.6); width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100000; border: 1px solid #777; transition: background 0.2s;';
            closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(231, 76, 60, 0.8)';
            closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(0,0,0,0.6)';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件傳遞到下層背景
                closeImageModal();
            });
            modalOverlay.appendChild(closeBtn);
        }

        // 支援按下 ESC 鍵關閉大圖
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) {
                closeImageModal();
            }
        });
    }

    const uploadInput = document.getElementById('avatar-upload-input');
    if (uploadInput) {
        uploadInput.addEventListener('change', handleAvatarUpload);
    }

    // 綁定「顯示已售罄」開關的事件
    const soldOutToggle = document.getElementById('show-sold-out-toggle');
    if (soldOutToggle) {
        soldOutToggle.addEventListener('change', applyFilters);
    }
    
    // 讓所有 Modal 都支援點擊背景黑幕關閉 (提升手機單手操作體驗)
    const notesOverlay = document.getElementById('notes-modal-overlay');
    if (notesOverlay) {
        notesOverlay.addEventListener('click', (e) => {
            if (e.target === notesOverlay) closeNotesModal();
        });
    }
    const avatarOverlay = document.getElementById('avatar-modal-overlay');
    if (avatarOverlay) {
        avatarOverlay.addEventListener('click', (e) => {
            if (e.target === avatarOverlay) closeAvatarModal();
        });
    }
    const customConfirmOverlay = document.getElementById('custom-confirm-overlay');
    if (customConfirmOverlay) {
        customConfirmOverlay.addEventListener('click', (e) => {
            if (e.target === customConfirmOverlay) closeCustomConfirm();
        });
    }

    // --- 初始化我的最愛拖曳排序功能 ---
    const favList = document.getElementById('favorites-list');
    if (favList && typeof Sortable !== 'undefined') {
        new Sortable(favList, {
            animation: 150,
            delay: 150, // 手機端長按 150ms 才能拖曳，避免與上下滑動及點擊發生衝突
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            ghostClass: 'sortable-ghost-fav',
            onEnd: function () {
                const items = Array.from(favList.querySelectorAll('.favorite-item'));
                const newFavorites = items.map(item => item.dataset.name);
                guestFavorites = newFavorites; // 更新本地端陣列
                
                // 同步至伺服器
                socket.emit('reorder-favorites', { guest: currentName, favorites: guestFavorites });
                showToast('🔄 最愛順序已更新！');
            }
        });

        // 注入拖曳時的專屬 CSS 特效
        const favStyle = document.createElement('style');
        favStyle.innerHTML = `
            .favorite-item { transition: transform 0.2s ease, box-shadow 0.2s ease; }
            .favorite-item:active { cursor: grabbing !important; transform: scale(0.95); }
            .sortable-ghost-fav { opacity: 0.4; transform: scale(0.9); background: rgba(243, 156, 18, 0.15) !important; border: 2px dashed #f39c12 !important; border-radius: 12px; }
        `;
        document.head.appendChild(favStyle);
    }

    initCarouselSwipe(); // 初始化輪播區滑動與拖曳控制
    initCategoryTabs(); // 初始化基酒分類頁籤事件

    if (window.innerWidth > 768) {
        // --- 自動將「搜尋與篩選區塊」固定在畫面最上方，並隨捲動隱藏/顯示 ---
        const filterContainer = document.getElementById('filter-container');
        if (filterContainer) {
            filterContainer.style.position = 'sticky';
            filterContainer.style.top = '0px';
            filterContainer.style.zIndex = '9900'; 
            filterContainer.style.backgroundColor = 'rgba(15, 15, 15, 0.85)'; 
            filterContainer.style.backdropFilter = 'blur(15px)'; 
            filterContainer.style.webkitBackdropFilter = 'blur(15px)'; 
            filterContainer.style.boxShadow = '0 6px 15px rgba(0, 0, 0, 0.7)'; 
            filterContainer.style.paddingTop = '10px'; // 加上下間距，確保黏在頂部時不至於太擁擠
            filterContainer.style.paddingBottom = '10px';
            filterContainer.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; // 改用 transform 實現 GPU 硬體加速，滑動更滑順

            let lastScrollY = window.scrollY;
            window.addEventListener('scroll', () => {
                window.requestAnimationFrame(() => {
                    const currentScrollY = window.scrollY;
                    // 動態抓取高度，這樣即使展開了進階篩選面板也能完美隱藏
                    const headerHeight = filterContainer.offsetHeight; 

                    // 當往下捲動且超過一定距離 (150px) 時隱藏 (將 top 設為負數推到畫面外)
                    if (currentScrollY > lastScrollY && currentScrollY > 150) {
                        filterContainer.style.transform = `translateY(-${headerHeight + 20}px)`; // 使用 translateY 隱藏
                        
                        // 額外優化：往下滑動時，若手機小鍵盤開啟中，自動取消聚焦收起鍵盤
                        const searchInput = document.getElementById('search-input');
                        if (searchInput && document.activeElement === searchInput) {
                            searchInput.blur();
                        }
                    } 
                    // 當往上捲動時恢復顯示 (下拉出現)
                    else if (currentScrollY < lastScrollY) {
                        filterContainer.style.transform = 'translateY(0px)';
                    }
                    
                    // 避免 iOS 手機版「橡皮筋回彈」特性產生的負值干擾判斷
                    lastScrollY = currentScrollY <= 0 ? 0 : currentScrollY; 
                });
            }, { passive: true });
        }
    }
});

function updateBottomNav(activeId) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${activeId}`).classList.add('active');
}

function updateFAB() {
    if (!currentName) return;
    
    const todayStr = new Date().toLocaleDateString('zh-TW');
    
    // 只計算「今日且尚未完成與未退單」的訂單
    const myActiveOrders = globalServerOrders.filter(o => {
        if (o.guest !== currentName) return false;
        if (o.status !== 'pending' && o.status !== 'making') return false;
        const ts = parseInt(o.id.split('-')[0]);
        if (isNaN(ts)) return false;
        return new Date(ts).toLocaleDateString('zh-TW') === todayStr;
    });
    
    const fab = document.getElementById('active-orders-fab');
    const badge = document.getElementById('active-orders-badge');
    const backToTopBtn = document.getElementById('back-to-top');
    
    if (fab && badge) {
        if (myActiveOrders.length > 0) {
            badge.innerText = myActiveOrders.length;
            fab.style.display = 'flex';
            if (backToTopBtn) {
                backToTopBtn.style.display = 'none';
            }
        } else {
            fab.style.display = 'none';
            if (backToTopBtn) {
                backToTopBtn.style.display = 'flex';
                // 主動發送滾動事件，使 back-to-top 依據目前捲動位置來決定透明度與可點擊性
                window.dispatchEvent(new Event('scroll'));
            }
        }
    }
}

// 捲動至搜尋框位置並自動 focus 搜尋欄位
window.scrollToSearchBox = function() {
    const filterContainer = document.getElementById('filter-container');
    const searchInput = document.getElementById('search-input');
    if (filterContainer) {
        customSmoothScrollToElement(filterContainer, 600);
    }
    if (searchInput) {
        setTimeout(() => {
            searchInput.focus();
        }, 600);
    }
};

// --- 星空背景特效 ---
function initStarrySky() {
    const canvas = document.getElementById('starry-sky');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width, height;
    let stars = [];

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        initStars();
    }

    function initStars() {
        stars = [];
        // 手機螢幕寬度較小，進一步降低星星密度以節省效能與電量
        const isMobile = window.innerWidth <= 768;
        const density = isMobile ? 6000 : 2500; 
        const numStars = Math.floor((width * height) / density); 
        for (let i = 0; i < numStars; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: Math.random() * 1.5 + 0.3, // 隨機大小
                alpha: Math.random(), // 初始透明度
                dAlpha: (Math.random() * 0.02) + 0.005, // 閃爍的速度
                speedY: (Math.random() * 0.3) + 0.1 // 微微往上飄的速度
            });
        }
    }

    function draw() {
        // 當使用者將網頁切到背景時，停止繪製以節省手機電量
        if (document.hidden) {
            requestAnimationFrame(draw);
            return; 
        }
        ctx.clearRect(0, 0, width, height); // 清空畫布
        // 動態判斷目前的主題，淺色模式下星星變成深藍灰色，深色模式下則是純白色
        const rgb = currentTheme === 'light' ? '52, 73, 94' : '255, 255, 255'; 
        stars.forEach(star => {
            // 閃爍效果
            star.alpha += star.dAlpha;
            if (star.alpha <= 0.1 || star.alpha >= 1) star.dAlpha = -star.dAlpha;
            
            // 向上飄動效果
            star.y -= star.speedY; 
            if (star.y < 0) {
                star.y = height; // 如果飄到畫面頂端外，就從最下面重生
                star.x = Math.random() * width;
            }

            // 畫出星星
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
            ctx.fill();
        });
        requestAnimationFrame(draw); // 持續循環動畫
    }

    window.addEventListener('resize', resize);
    resize();
    draw();
}

// --- 輪播區滑動與拖曳控制 ---
let carouselAutoScrollTimer = null;
let carouselIsInteracting = false;
let carouselResumeTimeout = null;
let carouselScrollPosition = 0; // 高精度浮點數滾動位置追蹤器，避免瀏覽器整數四捨五入導致靜止

function startCarouselAutoScroll() {
    if (carouselAutoScrollTimer) {
        cancelAnimationFrame(carouselAutoScrollTimer);
        carouselAutoScrollTimer = null;
    }
    
    const slider = document.querySelector('.carousel-wrapper');
    const track = document.getElementById('carousel-track');
    if (!slider || !track) return;
    
    let lastTime = performance.now();
    const speed = 45; // 每秒滾動的像素數
    
    function step(now) {
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        
        if (!carouselIsInteracting) {
            // 自動輪播時關閉 Snap 貼合以求極致平順
            if (slider.style.scrollSnapType !== 'none') {
                slider.style.scrollSnapType = 'none';
            }
            carouselScrollPosition += speed * delta;
            slider.scrollLeft = carouselScrollPosition;
        } else {
            // 手動操作時同步浮點數計數器，防止手動後位置跳躍
            carouselScrollPosition = slider.scrollLeft;
        }
        
        carouselAutoScrollTimer = requestAnimationFrame(step);
    }
    
    carouselAutoScrollTimer = requestAnimationFrame(step);
}

function initCarouselSwipe(resetPositionOnly = false) {
    const slider = document.querySelector('.carousel-wrapper');
    const track = document.getElementById('carousel-track');
    if (!slider || !track) return;

    // 計算半寬度 (單組酒款的總寬度)
    const halfWidth = track.scrollWidth / 2;
    
    // 如果僅重置位置 (例如 renderCarousel 渲染後觸發)
    if (resetPositionOnly) {
        if (halfWidth > 0) {
            slider.style.scrollBehavior = 'auto';
            slider.scrollLeft = halfWidth;
            carouselScrollPosition = halfWidth;
        }
        if (!carouselIsInteracting) {
            startCarouselAutoScroll();
        }
        return;
    }
    
    // 避免重複綁定事件監聽器
    if (slider.dataset.carouselInitialized === 'true') {
        if (halfWidth > 0) {
            slider.style.scrollBehavior = 'auto';
            slider.scrollLeft = halfWidth;
            carouselScrollPosition = halfWidth;
        }
        if (!carouselIsInteracting) {
            startCarouselAutoScroll();
        }
        return;
    }
    
    slider.dataset.carouselInitialized = 'true';
    
    // 設定初始滾動位置至中間 (讓左右滑動皆有無限空間)
    if (halfWidth > 0) {
        slider.style.scrollBehavior = 'auto';
        slider.scrollLeft = halfWidth;
        carouselScrollPosition = halfWidth;
    }
    
    // --- 左右滑動按鈕 (電腦版) ---
    const section = document.getElementById('carousel-section');
    if (section && !document.querySelector('.carousel-nav-btn')) {
        section.style.position = 'relative'; // 確保絕對定位的按鈕不會跑版

        // 動態注入按鈕的專屬 CSS 樣式
        const style = document.createElement('style');
        style.innerHTML = `
            .carousel-nav-btn {
                position: absolute; top: 50%; transform: translateY(-50%);
                z-index: 100; background: rgba(0, 0, 0, 0.6); color: #fff;
                border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 50%;
                width: 44px; height: 44px; font-size: 20px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(5px); transition: all 0.3s ease;
                opacity: 0; pointer-events: none; /* 預設隱藏 */
            }
            #carousel-section:hover .carousel-nav-btn {
                opacity: 1; pointer-events: auto; /* 滑鼠移入時顯示 */
            }
            .carousel-nav-btn:hover {
                background: rgba(231, 76, 60, 0.9);
                transform: translateY(-50%) scale(1.15);
                box-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
            }
            .carousel-nav-btn.prev { left: 10px; }
            .carousel-nav-btn.next { right: 10px; }
            @media (max-width: 768px) { .carousel-nav-btn { display: none !important; } }
        `;
        document.head.appendChild(style);

        // 建立左右按鈕
        const prevBtn = document.createElement('button');
        prevBtn.className = 'carousel-nav-btn prev';
        prevBtn.innerHTML = '&#10094;'; // < 符號
        prevBtn.title = '向左滑動';
        prevBtn.onclick = (e) => { 
            e.stopPropagation(); 
            triggerManualInteraction();
            slider.style.scrollBehavior = 'smooth';
            slider.scrollBy({ left: -300 });
            resetResumeTimer();
        };

        const nextBtn = document.createElement('button');
        nextBtn.className = 'carousel-nav-btn next';
        nextBtn.innerHTML = '&#10095;'; // > 符號
        nextBtn.title = '向右滑動';
        nextBtn.onclick = (e) => { 
            e.stopPropagation(); 
            triggerManualInteraction();
            slider.style.scrollBehavior = 'smooth';
            slider.scrollBy({ left: 300 });
            resetResumeTimer();
        };

        section.appendChild(prevBtn);
        section.appendChild(nextBtn);
    }
    
    // 開始手動操作
    function triggerManualInteraction() {
        carouselIsInteracting = true;
        if (carouselResumeTimeout) {
            clearTimeout(carouselResumeTimeout);
            carouselResumeTimeout = null;
        }
        slider.style.scrollSnapType = 'x mandatory'; // 啟用 Snap 貼合
        carouselScrollPosition = slider.scrollLeft; // 確保數值同步
    }
    
    // 手動操作結束，計時重啟自動輪播
    function resetResumeTimer() {
        if (carouselResumeTimeout) {
            clearTimeout(carouselResumeTimeout);
        }
        carouselResumeTimeout = setTimeout(() => {
            carouselIsInteracting = false;
            slider.style.scrollSnapType = 'none'; // 關閉 Snap
            slider.style.scrollBehavior = 'auto'; // 改回 auto 以利自轉
            carouselScrollPosition = slider.scrollLeft; // 重啟前最後同步一次
            startCarouselAutoScroll();
        }, 500);
    }

    // --- 滑鼠與指標懸停事件 (支援電腦與平板) ---
    const handleEnter = () => {
        triggerManualInteraction();
    };
    const handleLeave = () => {
        resetResumeTimer();
    };

    slider.addEventListener('mouseenter', handleEnter);
    slider.addEventListener('mouseleave', handleLeave);
    slider.addEventListener('pointerenter', handleEnter);
    slider.addEventListener('pointerleave', handleLeave);

    // --- 觸控事件 (手機端) ---
    slider.addEventListener('touchstart', () => {
        triggerManualInteraction();
        slider.style.scrollBehavior = 'auto'; // 觸控時確保零延遲，提升手感
    }, { passive: true });

    slider.addEventListener('touchend', () => {
        resetResumeTimer();
    });
    
    slider.addEventListener('touchcancel', () => {
        resetResumeTimer();
    });

    // --- 滾動事件：無縫邊界回彈 ---
    slider.addEventListener('scroll', () => {
        const dynHalfWidth = track.scrollWidth / 2;
        if (dynHalfWidth <= 0) return;
        
        // 當滾動位置超過 [0.5 * dynHalfWidth, 1.5 * dynHalfWidth] 的區間時，進行無縫換位
        if (slider.scrollLeft >= dynHalfWidth * 1.5) {
            const prevBehavior = slider.style.scrollBehavior;
            slider.style.scrollBehavior = 'auto';
            slider.scrollLeft -= dynHalfWidth;
            slider.style.scrollBehavior = prevBehavior;
            carouselScrollPosition -= dynHalfWidth; // 同步追蹤器
        } else if (slider.scrollLeft <= dynHalfWidth * 0.5) {
            const prevBehavior = slider.style.scrollBehavior;
            slider.style.scrollBehavior = 'auto';
            slider.scrollLeft += dynHalfWidth;
            slider.style.scrollBehavior = prevBehavior;
            carouselScrollPosition += dynHalfWidth; // 同步追蹤器
        } else if (carouselIsInteracting) {
            // 如果是在手動滑動中，隨時更新浮點追蹤器
            carouselScrollPosition = slider.scrollLeft;
        }
    });

    // 啟動自轉
    startCarouselAutoScroll();
}

// --- 初始化基酒分類頁籤事件 ---
function initCategoryTabs() {
    const tabs = document.querySelectorAll('.category-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const value = tab.dataset.value;
            
            // 找出所有基酒的 checkbox
            const baseCheckboxes = Array.from(document.querySelectorAll('#filter-base .tag-checkbox'));
            
            // 取消勾選所有基酒
            baseCheckboxes.forEach(cb => {
                cb.checked = false;
            });
            
            if (value !== 'all') {
                // 找到對應值的 checkbox 並勾選
                const targetCheckbox = baseCheckboxes.find(cb => cb.value === value);
                if (targetCheckbox) {
                    targetCheckbox.checked = true;
                }
            }
            
            // 執行系統原生篩選與重繪
            applyFilters();
            
            // 自動橫向滑動使選中的頁籤置中，提升操作手感
            tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
    });
}

// =====================================================
// 🔔 系統推播通知 & Service Worker
// =====================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered successfully!', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

let notificationPermissionRequested = false;

async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    if (notificationPermissionRequested) return false;
    notificationPermissionRequested = true;
    
    const perm = await Notification.requestPermission();
    return perm === 'granted';
}

function sendSystemNotification(title, body, isImportant = false) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    
    const options = {
        body: body,
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍸</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍸</text></svg>",
        tag: 'bar-order-update',
        renotify: true,
        vibrate: isImportant ? [200, 100, 200, 100, 200] : [200, 100, 200]
    };
    
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            options: options
        });
    } else {
        new Notification(title, options);
    }
}

function updateCampaignBanner(campaign) {
    const banner = document.getElementById('campaign-banner');
    const tag = document.getElementById('campaign-banner-tag');
    const text = document.getElementById('campaign-banner-text');
    if (!banner) return;
    
    if (campaign && campaign.active) {
        banner.className = `campaign-banner ${campaign.style || 'gold'}`;
        if (tag) tag.textContent = campaign.tag || '活動';
        if (text) text.textContent = campaign.text || '';
    } else {
        banner.className = 'campaign-banner hidden';
    }
}

// =====================================================
// ⭐ 評分系統
// =====================================================
let pendingRatingOrderId = null;
let pendingRatingDrink = null;
let selectedStars = 0;
const ratingLabels = ['', '😞 有點失望', '😐 還好啦', '🙂 不錯喔！', '😊 很好喝！', '🤩 完美！必喝！'];

function syncMyRatings() {
    myRatings = {};
    if (!globalRatings) return;
    Object.keys(globalRatings).forEach(drinkName => {
        const stats = globalRatings[drinkName];
        if (stats && stats.list) {
            stats.list.forEach(entry => {
                if (entry.guest === currentName) {
                    myRatings[entry.orderId] = {
                        stars: entry.stars,
                        comment: entry.comment,
                        ts: entry.ts
                    };
                }
            });
        }
    });
}

function openRatingModal(orderId, drinkName) {
    pendingRatingOrderId = orderId;
    pendingRatingDrink = drinkName;
    selectedStars = 0;
    
    document.getElementById('rating-modal-drink').textContent = drinkName;
    document.getElementById('rating-comment-input').value = '';
    document.getElementById('rating-label-text').textContent = '';
    const submitBtn = document.getElementById('rating-submit-btn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.4';
    
    // Reset stars
    document.querySelectorAll('.star-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById('rating-modal-overlay').classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeRatingModal() {
    document.getElementById('rating-modal-overlay').classList.remove('visible');
    document.body.style.overflow = '';
}

function selectStar(n) {
    selectedStars = n;
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach((s, idx) => {
        s.classList.toggle('active', idx < n);
    });
    document.getElementById('rating-label-text').textContent = ratingLabels[n] || '';
    const submitBtn = document.getElementById('rating-submit-btn');
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
}

function submitRating() {
    if (selectedStars < 1 || selectedStars > 5) return;
    const comment = document.getElementById('rating-comment-input').value.trim();
    
    socket.emit('submit-rating', {
        drinkName: pendingRatingDrink,
        guest: currentName,
        stars: selectedStars,
        comment: comment,
        orderId: pendingRatingOrderId
    });
    
    // Optimistic update
    myRatings[pendingRatingOrderId] = {
        stars: selectedStars,
        comment: comment,
        ts: Date.now()
    };
    
    closeRatingModal();
    loadHistory();
    applyFilters();
    showToast('⭐ 評分送出成功！');
}

function toggleReviews(drinkId, event) {
    if (event) event.stopPropagation();
    const collapsible = document.getElementById(`reviews-collapsible-${drinkId}`);
    if (collapsible) {
        const isHidden = collapsible.style.display === 'none';
        collapsible.style.display = isHidden ? 'block' : 'none';
    }
}

// =====================================================
// 🏆 成就系統 (Achievements Engine)
// =====================================================
const badgesDefinition = [
    {
        id: 'pioneer',
        name: '開路先鋒',
        desc: '今天第一個成功下單的人',
        icon: '🏆',
        color: 'linear-gradient(135deg, #ffd700 0%, #ffa500 100%)',
        check: (myTodayOrders, myTodayRatings) => {
            const todayStr = new Date().toDateString();
            const allTodayOrders = globalServerOrders.filter(o => {
                if (!o.id || o.status !== 'completed') return false;
                const ts = parseInt(o.id.split('-')[0]);
                return !isNaN(ts) && new Date(ts).toDateString() === todayStr;
            });
            if (allTodayOrders.length === 0) return false;
            allTodayOrders.sort((a, b) => parseInt(a.id.split('-')[0]) - parseInt(b.id.split('-')[0]));
            return allTodayOrders[0].guest === currentName;
        }
    },
    {
        id: 'first_step',
        name: '微醺起步',
        desc: '今天點了第一杯酒',
        icon: '🍺',
        color: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 1
    },
    {
        id: 'double_drink',
        name: '成雙成對',
        desc: '今天點了 2 杯酒',
        icon: '🍻',
        color: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 2
    },
    {
        id: 'triple_drink',
        name: '三生有幸',
        desc: '今天點了 3 杯酒',
        icon: '🎉',
        color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 3
    },
    {
        id: 'five_drinks',
        name: '五福臨門',
        desc: '今天點了 5 杯酒',
        icon: '🍹',
        color: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 5
    },
    {
        id: 'seven_drinks',
        name: '七星高照',
        desc: '今天點了 7 杯酒',
        icon: '🌟',
        color: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 7
    },
    {
        id: 'ask_for_shot',
        name: '主動找酒保要一杯SHOT',
        desc: '點了「來一杯shot」特調',
        icon: '🥃',
        color: 'linear-gradient(135deg, #ed213a 0%, #93291e 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.some(o => o.drink === '來一杯shot')
    },
    {
        id: 'lightweight',
        name: '小酌怡情',
        desc: '點過酒精濃度 (ABV) < 5% 的低感調酒',
        icon: '🥤',
        color: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.some(o => {
            const d = allDrinks.find(item => item.name === o.drink);
            return d && d.abv < 5;
        })
    },
    {
        id: 'heavyweight',
        name: '烈酒狂熱',
        desc: '點過酒精濃度 (ABV) >= 20% 的高濃度調酒',
        icon: '🔥',
        color: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.some(o => {
            const d = allDrinks.find(item => item.name === o.drink);
            return d && d.abv >= 20;
        })
    },
    {
        id: 'luxury',
        name: '輕奢名流',
        desc: '點過包含「香檳」或「氣泡」的酒款',
        icon: '🥂',
        color: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.some(o => {
            const d = allDrinks.find(item => item.name === o.drink);
            if (!d) return false;
            const text = (d.tags || []).join(' ') + ' ' + (d.description || '');
            return text.includes('香檳') || text.includes('氣泡');
        })
    },
    {
        id: 'favorite_fan',
        name: '忠實收藏家',
        desc: '將至少一款酒加入最愛清單',
        icon: '❤️',
        color: 'linear-gradient(135deg, #ff758c 0%, #ff7eb3 100%)',
        check: (myTodayOrders, myTodayRatings) => guestFavorites.length >= 1
    },
    {
        id: 'critic',
        name: '金舌頭評委',
        desc: '今晚給予 3 次或以上的出杯評分',
        icon: '📝',
        color: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayRatings.length >= 3
    },
    {
        id: 'perfectionist',
        name: '完美的挑剔者',
        desc: '評分給予滿分 5 顆星',
        icon: '✨',
        color: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayRatings.some(r => r.stars === 5)
    },
    {
        id: 'speed_drinker',
        name: '極速狂飆',
        desc: '一小時內累計下單並喝了 3 杯或以上',
        icon: '⚡',
        color: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
        check: (myTodayOrders, myTodayRatings) => {
            if (myTodayOrders.length < 3) return false;
            const timestamps = myTodayOrders
                .map(o => parseInt(o.id.split('-')[0]))
                .filter(ts => !isNaN(ts))
                .sort((a, b) => a - b);
            for (let i = 0; i < timestamps.length; i++) {
                for (let j = i + 2; j < timestamps.length; j++) {
                    if (timestamps[j] - timestamps[i] <= 60 * 60 * 1000) {
                        return true;
                    }
                }
            }
            return false;
        }
    },
    {
        id: 'abyss_lord',
        name: '深淵領主',
        desc: '點過 2 杯或以上酒精濃度 (ABV) >= 30% 的特濃調酒',
        icon: '☠️',
        color: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        check: (myTodayOrders, myTodayRatings) => {
            const heavyDrinks = myTodayOrders.filter(o => {
                const d = allDrinks.find(item => item.name === o.drink);
                return d && d.abv >= 30;
            });
            return heavyDrinks.length >= 2;
        }
    },
    {
        id: 'legendary_drinker',
        name: '傳奇酒豪',
        desc: '今晚累計點餐達 9 杯或以上',
        icon: '🔱',
        color: 'linear-gradient(135deg, #8a2387 0%, #e94057 50%, #f27121 100%)',
        check: (myTodayOrders, myTodayRatings) => myTodayOrders.length >= 9
    }
];

function initAchievementsState() {
    if (!currentName) return;
    const stored = localStorage.getItem(`bar_achievements_${currentName}`);
    if (stored) {
        try {
            achievementsUnlocked = JSON.parse(stored);
        } catch(e) {
            achievementsUnlocked = {};
        }
    } else {
        achievementsUnlocked = {};
    }
    renderAchievementsGrid();
}

function checkAchievements() {
    if (!currentName) return;
    const todayStr = new Date().toDateString();
    
    // 篩選今日 completed 訂單
    const myTodayOrders = globalServerOrders.filter(o => {
        if (o.guest !== currentName || o.status !== 'completed' || !o.id) return false;
        const ts = parseInt(o.id.split('-')[0]);
        return !isNaN(ts) && new Date(ts).toDateString() === todayStr;
    });
    
    // 篩選今日評分
    const myTodayRatings = [];
    Object.keys(myRatings).forEach(orderId => {
        const r = myRatings[orderId];
        if (r && r.ts && new Date(r.ts).toDateString() === todayStr) {
            myTodayRatings.push(r);
        }
    });
    
    let unlockedNew = false;
    badgesDefinition.forEach(badge => {
        if (achievementsUnlocked[badge.id]) return;
        
        if (badge.check(myTodayOrders, myTodayRatings)) {
            achievementsUnlocked[badge.id] = { unlockedAt: Date.now() };
            unlockedNew = true;
            
            if (!isAchievementsFirstLoad) {
                // Show confetti and toast
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                }
                showToast(`🏆 恭喜解鎖徽章：【${badge.name}】！`);
            }
        }
    });
    
    if (unlockedNew) {
        localStorage.setItem(`bar_achievements_${currentName}`, JSON.stringify(achievementsUnlocked));
        renderAchievementsGrid();
    }
    isAchievementsFirstLoad = false;
}

function renderAchievementsGrid() {
    const list = document.getElementById('achievements-list');
    const unlockedCountEl = document.getElementById('achievements-unlocked-count');
    const totalCountEl = document.getElementById('achievements-total-count');
    const percentEl = document.getElementById('achievements-percent');
    if (!list) return;
    
    let unlockedCount = 0;
    let html = '';
    
    badgesDefinition.forEach(badge => {
        const isUnlocked = !!achievementsUnlocked[badge.id];
        if (isUnlocked) unlockedCount++;
        
        const cardClass = isUnlocked ? 'achievement-card unlocked' : 'achievement-card';
        const statusText = isUnlocked ? '✅ 已解鎖' : '🔒 未解鎖';
        const cardStyle = isUnlocked ? `background: ${badge.color}; color: #fff;` : '';
        
        html += `
            <div class="${cardClass}" style="${cardStyle}">
                <div class="achievement-icon" style="font-size: 2em; margin-bottom: 5px;">${badge.icon}</div>
                <div class="achievement-name" style="font-weight: bold; font-size: 1.05em; margin-bottom: 2px;">${badge.name}</div>
                <div class="achievement-desc" style="font-size: 0.85em; opacity: 0.9; margin-bottom: 5px;">${badge.desc}</div>
                <div class="achievement-status-tag" style="font-size: 0.8em; margin-top: auto; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,0.15);">${statusText}</div>
            </div>
        `;
    });
    
    list.innerHTML = html;
    if (unlockedCountEl) unlockedCountEl.textContent = unlockedCount;
    if (totalCountEl) totalCountEl.textContent = badgesDefinition.length;
    if (percentEl) {
        const pct = Math.round((unlockedCount / badgesDefinition.length) * 100);
        percentEl.textContent = pct;
    }
}

function toggleAchievements() {
    const content = document.getElementById('achievements-content');
    const arrow = document.querySelector('#achievements-expand-icon .expand-arrow');
    const text = document.querySelector('#achievements-expand-icon .expand-text');
    if (content) {
        content.classList.toggle('expanded');
        const isExpanded = content.classList.contains('expanded');
        if (arrow) arrow.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
        if (text) text.textContent = isExpanded ? '收合' : '展開';
    }
}

// =====================================================
// 📊 排隊順位與隊列資訊
// =====================================================
function getQueueInfoForOrder(myOrder) {
    const todayStr = new Date().toDateString();
    const activeOrders = globalServerOrders.filter(o => {
        if (o.status !== 'pending' && o.status !== 'making') return false;
        const ts = parseInt(o.id.split('-')[0]);
        if (isNaN(ts)) return false;
        return new Date(ts).toDateString() === todayStr;
    }).sort((a, b) => parseInt(a.id.split('-')[0]) - parseInt(b.id.split('-')[0]));

    const myIndex = activeOrders.findIndex(o => o.id === myOrder.id);
    if (myIndex === -1) return null;

    const before = activeOrders.slice(0, myIndex);
    return { before, myIndex, total: activeOrders.length };
}

function buildQueueHtml(queueInfo) {
    if (!queueInfo || queueInfo.before.length === 0) {
        return `
            <div class="queue-info-box queue-first" style="background: rgba(39, 174, 96, 0.1); border: 1px dashed #27ae60; padding: 10px; border-radius: 8px; margin-top: 8px; font-size: 0.9em; color: #2ecc71; font-weight: bold; display: flex; align-items: center; gap: 6px;">
                <span>🥂</span>
                <span>您是當前第一順位！吧台正在用心準備中...</span>
            </div>
        `;
    }

    const beforeOrders = queueInfo.before;
    const avatarHtml = beforeOrders.slice(0, 3).map(o => {
        const avatarUrl = getAvatarUrl(o.guest);
        return `<img src="${avatarUrl}" class="queue-person-avatar" style="width: 20px; height: 20px; border-radius: 50%; border: 1px solid #ffb703; margin-left: -5px;" title="${o.guest} 的 ${o.drink}">`;
    }).join('');

    const countText = beforeOrders.length;
    const overflowText = beforeOrders.length > 3 ? `+${beforeOrders.length - 3}` : '';

    return `
        <div class="queue-info-box" style="background: rgba(243, 156, 18, 0.08); border: 1px dashed #f39c12; padding: 10px; border-radius: 8px; margin-top: 8px; font-size: 0.88em; color: #ffb703; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span>⏳ 前面還有 <strong>${countText}</strong> 杯在排隊</span>
            <div class="queue-avatars-list" style="display: flex; align-items: center; padding-left: 5px;">
                ${avatarHtml}
                ${overflowText ? `<span style="font-size: 0.75em; color: #aaa; margin-left: 5px;">${overflowText}</span>` : ''}
            </div>
        </div>
    `;
}

// =====================================================
// 🔊 老虎機音效合成器
// =====================================================
function playTickSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1500, ctx.currentTime);
        gain.gain.setValueAtTime(0.015, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
    } catch(e) {}
}

function playCelebrateSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const playNote = (freq, time, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.12, time + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(time);
            osc.stop(time + duration);
        };
        const now = ctx.currentTime;
        playNote(523.25, now, 0.15); // C5
        playNote(659.25, now + 0.08, 0.15); // E5
        playNote(783.99, now + 0.16, 0.15); // G5
        playNote(1046.50, now + 0.24, 0.4); // C6
    } catch(e) {}
}