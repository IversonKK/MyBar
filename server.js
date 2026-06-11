const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 設定 public 為靜態資料夾
app.use(express.static(path.join(__dirname, 'public')));

let allDrinks = [];
let recipeDatabase = {};
let orders = [];
let favoritesDatabase = {};
let avatarsDatabase = {};
let tunnelUrl = ''; // 儲存 cloudflared 隧道網址
let ratingsDatabase = {}; // { drinkName: [{ guest, stars, comment, orderId, ts }] }
let campaignDatabase = { active: false, text: '', tag: '活動', style: 'gold' };

const defaultAvatarStyles = [
    "adventurer", "avataaars", "big-ears", "big-smile", "bottts", "croodles",
    "fun-emoji", "icons", "identicon", "initials", "lorelei", "micah",
    "miniavs", "open-peeps", "personas", "pixel-art", "rings", "shapes", "thumbs"
];

const ordersPath = path.join(__dirname, 'orders.json');
const completedOrdersLogPath = path.join(__dirname, 'completed_orders.json');
const favoritesPath = path.join(__dirname, 'favorites.json');
const avatarsPath = path.join(__dirname, 'avatars.json');
const ratingsPath = path.join(__dirname, 'ratings.json');
const campaignPath = path.join(__dirname, 'campaign.json');

function loadOrdersData() {
    try {
        if (fs.existsSync(ordersPath)) {
            const rawData = fs.readFileSync(ordersPath, 'utf8');
            orders = JSON.parse(rawData);
            console.log(`成功讀取 orders.json，共載入 ${orders.length} 筆進行中的訂單。`);
        }
        if (fs.existsSync(completedOrdersLogPath)) {
            const completedRawData = fs.readFileSync(completedOrdersLogPath, 'utf8');
            const completedOrders = JSON.parse(completedRawData);
            orders = orders.concat(completedOrders);
            console.log(`成功載入 ${completedOrders.length} 筆已完成的歷史訂單。`);
        }
    } catch (err) {
        console.error("讀取訂單資料失敗:", err.message);
    }
}

function saveOrdersData() {
    try {
        const pendingOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'rejected');
        fs.writeFileSync(ordersPath, JSON.stringify(pendingOrders, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 orders.json 失敗:", err);
    }
}

function appendToCompletedLog(order) {
    try {
        let completedOrders = [];
        if (fs.existsSync(completedOrdersLogPath)) {
            const rawData = fs.readFileSync(completedOrdersLogPath, 'utf8');
            if(rawData) completedOrders = JSON.parse(rawData);
        }
        completedOrders.push(order);
        fs.writeFileSync(completedOrdersLogPath, JSON.stringify(completedOrders, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 completed_orders.json 失敗:", err);
    }
}

function loadFavoritesData() {
    try {
        if (fs.existsSync(favoritesPath)) {
            favoritesDatabase = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
            console.log("成功讀取 favorites.json！");
        }
    } catch (err) {
        console.error("讀取 favorites.json 失敗:", err.message);
    }
}

function saveFavoritesData() {
    try {
        fs.writeFileSync(favoritesPath, JSON.stringify(favoritesDatabase, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 favorites.json 失敗:", err);
    }
}

function loadAvatarsData() {
    try {
        if (fs.existsSync(avatarsPath)) {
            avatarsDatabase = JSON.parse(fs.readFileSync(avatarsPath, 'utf8'));
            console.log("成功讀取 avatars.json！");
        }
    } catch (err) {
        console.error("讀取 avatars.json 失敗:", err.message);
    }
}

function saveAvatarsData() {
    try {
        fs.writeFileSync(avatarsPath, JSON.stringify(avatarsDatabase, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 avatars.json 失敗:", err);
    }
}

function loadRatingsData() {
    try {
        if (fs.existsSync(ratingsPath)) {
            ratingsDatabase = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
            console.log("成功讀取 ratings.json！");
        }
    } catch (err) {
        console.error("讀取 ratings.json 失敗:", err.message);
    }
}

function saveRatingsData() {
    try {
        fs.writeFileSync(ratingsPath, JSON.stringify(ratingsDatabase, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 ratings.json 失敗:", err);
    }
}

function loadCampaignData() {
    try {
        if (fs.existsSync(campaignPath)) {
            campaignDatabase = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
            console.log("成功讀取 campaign.json！");
        }
    } catch (err) {
        console.error("讀取 campaign.json 失敗:", err.message);
    }
}

function saveCampaignData() {
    try {
        fs.writeFileSync(campaignPath, JSON.stringify(campaignDatabase, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 campaign.json 失敗:", err);
    }
}

// 計算一款酒的評分統計
function calcRatingStats(drinkName) {
    const list = ratingsDatabase[drinkName] || [];
    if (list.length === 0) return { avg: 0, count: 0, list: [] };
    const avg = list.reduce((s, r) => s + r.stars, 0) / list.length;
    return { avg: Math.round(avg * 10) / 10, count: list.length, list };
}

function saveCompletedOrdersData() {
    try {
        const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'rejected');
        fs.writeFileSync(completedOrdersLogPath, JSON.stringify(completedOrders, null, 4), 'utf8');
        console.log(`成功儲存 completed_orders.json，共計 ${completedOrders.length} 筆。`);
    } catch (err) {
        console.error("寫入 completed_orders.json 失敗:", err);
    }
}

function loadDrinksData() {
    const oldSoldOutNames = allDrinks.filter(d => d.isSoldOut).map(d => d.name);
    allDrinks = [];
    
    const recipePath = path.join(__dirname, 'recipe.json');
    try {
        if (fs.existsSync(recipePath)) {
            const rawData = fs.readFileSync(recipePath, 'utf8');
            recipeDatabase = JSON.parse(rawData);
            console.log("成功讀取 recipe.json 配方庫！");
        }
    } catch (err) {
        console.error("讀取 recipe.json 失敗，將使用預設配方:", err.message);
    }

    const imagesDir = path.join(__dirname, 'public', 'images');

    try {
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        
        const files = fs.readdirSync(imagesDir);
        let idCounter = 1;
        
        const processedNames = new Set();
        files.forEach(file => {
            if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
                const rawDrinkName = file.replace(/\.(jpg|png)$/i, '');
                if (processedNames.has(rawDrinkName)) return;
                processedNames.add(rawDrinkName);
                let recipeKey = rawDrinkName;
                
                if (!recipeDatabase[recipeKey]) {
                    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
                    const normRaw = normalize(rawDrinkName);
                    const knownKeys = Object.keys(recipeDatabase);
                    
                    let match = knownKeys.find(k => normalize(k) === normRaw);
                    
                    if (!match && normRaw.length >= 2) {
                        match = knownKeys.find(k => normalize(k).includes(normRaw) || normRaw.includes(normalize(k)));
                    }
                    if (match) recipeKey = match;
                }

                const isMissingRecipe = !recipeDatabase[recipeKey];
                const recipeInfo = recipeDatabase[recipeKey] || {
                    abv: 15,
                    strong: 3,
                    sour: 3,
                    tags: ["其他"],
                    description: "材料：配方待補充。杯型：待確認。裝飾：無。"
                };
                
                allDrinks.push({
                    id: idCounter++,
                    name: rawDrinkName,
                    abv: recipeInfo.abv,
                    strong: recipeInfo.strong,
                    sour: recipeInfo.sour,
                    tags: recipeInfo.tags,
                    description: recipeInfo.description,
                    isSoldOut: oldSoldOutNames.includes(rawDrinkName),
                    comingSoon: isMissingRecipe
                });
            }
        });
        console.log(`掃描完成！成功載入了 ${allDrinks.length} 款調酒資料。`);
    } catch (err) {
        console.error("讀取圖片資料夾失敗，請確認路徑是否正確:", err);
    }
}

loadDrinksData();
loadOrdersData();
loadFavoritesData();
loadAvatarsData();
loadRatingsData();
loadCampaignData();

app.get('/api/drinks', (req, res) => {
    res.json(allDrinks);
});

// Cloudflared 隧道 URL API
app.get('/api/tunnel-url', (req, res) => {
    res.json({ url: tunnelUrl });
});

app.use(express.json());
app.post('/api/tunnel-url', (req, res) => {
    const { url } = req.body;
    if (url && url.startsWith('https://')) {
        tunnelUrl = url;
        console.log(`✅ 已記錄隧道網址: ${url}`);
        res.json({ ok: true });
    } else {
        res.status(400).json({ error: 'invalid url' });
    }
});

// 評分統計 API
app.get('/api/ratings', (req, res) => {
    const stats = {};
    Object.keys(ratingsDatabase).forEach(drinkName => {
        stats[drinkName] = calcRatingStats(drinkName);
    });
    res.json(stats);
});

app.get('/api/campaign', (req, res) => {
    res.json(campaignDatabase);
});

app.get('/api/music', (req, res) => {
    const musicDir = path.join(__dirname, 'public', 'music');
    fs.readdir(musicDir, (err, files) => {
        if (err) {
            console.error("讀取音樂資料夾失敗:", err);
            return res.status(500).json({ error: "無法讀取音樂資料夾" });
        }
        const musicFiles = files.filter(file => file.toLowerCase().endsWith('.mp3'));
        res.json(musicFiles);
    });
});

io.on('connection', (socket) => {
    socket.emit('sync-orders', orders);
    socket.emit('sync-avatars', avatarsDatabase);
    socket.emit('sync-campaign', campaignDatabase);

    socket.on('new-order', (orderData) => {
        if (!avatarsDatabase[orderData.guest]) {
            const randomStyle = defaultAvatarStyles[Math.floor(Math.random() * defaultAvatarStyles.length)];
            avatarsDatabase[orderData.guest] = randomStyle;
            saveAvatarsData();
            io.emit('sync-avatars', avatarsDatabase);
        }
        orders.push(orderData);
        saveOrdersData();
        io.emit('admin-notification', orderData);
        socket.broadcast.emit('sync-orders', orders);
    });

    socket.on('update-status', (data) => {
        const order = orders.find(o => o.id === data.id);
        if (order) {
            order.status = data.status;
            if (data.status === 'making') order.makingTime = new Date().toLocaleTimeString();
            if (data.status === 'completed' || data.status === 'rejected') {
                order.completedTime = new Date().toLocaleTimeString();
                appendToCompletedLog(order);
            }
            saveOrdersData();
            io.emit('order-status-updated', order);
        }
    });

    socket.on('delete-order', (orderId) => {
        orders = orders.filter(o => o.id !== orderId);
        saveOrdersData();
        saveCompletedOrdersData();
        io.emit('order-deleted', orderId);
    });

    socket.on('reorder-orders', (newIds) => {
        orders.sort((a, b) => {
            const indexA = newIds.indexOf(a.id);
            const indexB = newIds.indexOf(b.id);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
        saveOrdersData();
        socket.broadcast.emit('sync-orders', orders);
    });

    socket.on('clear-guest-history', (guestName) => {
        orders = orders.filter(o => o.guest !== guestName);
        saveOrdersData();
        saveCompletedOrdersData();
        io.emit('sync-orders', orders);
    });

    socket.on('clear-finished-from-dashboard', (callback) => {
        orders.forEach(o => {
            if (o.status === 'completed' || o.status === 'rejected') {
                o.hiddenFromDashboard = true;
            }
        });
        saveOrdersData();
        io.emit('sync-orders', orders);
        if (typeof callback === 'function') callback();
    });

    socket.on('toggle-sold-out', (id) => {
        const drink = allDrinks.find(d => d.id === id);
        if (drink) {
            drink.isSoldOut = !drink.isSoldOut;
            io.emit('drink-sold-out-updated', { id, isSoldOut: drink.isSoldOut });
        }
    });

    socket.on('reload-recipes', () => {
        console.log('收到重載配方請求，正在重新讀取 recipe.json...');
        loadDrinksData();
        io.emit('recipes-updated');
    });

    socket.on('save-recipe', (recipeData) => {
        const recipePath = path.join(__dirname, 'recipe.json');
        try {
            let currentRecipes = {};
            
            if (fs.existsSync(recipePath)) {
                const rawData = fs.readFileSync(recipePath, 'utf8');
                currentRecipes = JSON.parse(rawData);
            }

            currentRecipes[recipeData.name] = {
                abv: recipeData.abv,
                strong: recipeData.strong,
                sour: recipeData.sour,
                tags: recipeData.tags,
                description: recipeData.description
            };

            if (recipeData.imageData) {
                const base64Data = recipeData.imageData.replace(/^data:image\/\w+;base64,/, "");
                const ext = recipeData.imageExtension === 'png' ? 'png' : 'jpg';
                const imagePath = path.join(__dirname, 'public', 'images', `${recipeData.name}.${ext}`);
                fs.writeFileSync(imagePath, base64Data, 'base64');
                console.log(`成功儲存圖片: ${recipeData.name}.${ext}`);
            }

            fs.writeFileSync(recipePath, JSON.stringify(currentRecipes, null, 4), 'utf8');
            console.log(`成功儲存配方並寫入檔案: ${recipeData.name}`);

            loadDrinksData(); 

            io.emit('recipes-updated'); 
            
        } catch (err) {
            console.error("寫入 recipe.json 失敗:", err);
        }
    });

    socket.on('update-avatar', (data) => {
        avatarsDatabase[data.guest] = data.style;
        saveAvatarsData();
        io.emit('sync-avatars', avatarsDatabase);
    });

    socket.on('get-favorites', (guestName) => {
        socket.emit('sync-favorites', favoritesDatabase[guestName] || []);
    });

    socket.on('toggle-favorite', (data) => {
        const { guest, drink } = data;
        if (!favoritesDatabase[guest]) favoritesDatabase[guest] = [];
        
        const index = favoritesDatabase[guest].indexOf(drink);
        if (index > -1) {
            favoritesDatabase[guest].splice(index, 1);
        } else {
            favoritesDatabase[guest].push(drink);
        }
        saveFavoritesData();
        io.emit('favorites-updated', guest);
    });

    socket.on('clear-favorites', (guest) => {
        favoritesDatabase[guest] = [];
        saveFavoritesData();
        io.emit('favorites-updated', guest);
    });

    // 評分系統
    socket.on('submit-rating', (data) => {
        const { drinkName, guest, stars, comment, orderId } = data;
        if (!drinkName || !guest || !stars || stars < 1 || stars > 5) return;

        if (!ratingsDatabase[drinkName]) ratingsDatabase[drinkName] = [];

        // 防止同一筆訂單重複評分
        const alreadyRated = ratingsDatabase[drinkName].some(r => r.orderId === orderId);
        if (alreadyRated) {
            socket.emit('rating-error', '您已經評分過這杯酒了！');
            return;
        }

        const entry = {
            guest,
            stars: parseInt(stars),
            comment: (comment || '').trim().slice(0, 100),
            orderId,
            ts: Date.now()
        };
        ratingsDatabase[drinkName].push(entry);
        saveRatingsData();

        const stats = calcRatingStats(drinkName);
        io.emit('rating-updated', { drinkName, stats, entry });
        console.log(`⭐ ${guest} 給「${drinkName}」評了 ${stars} 顆星`);
    });

    socket.on('add-manual-completed-order', (data) => {
        const orderId = Date.now() + '-' + Math.floor(Math.random() * 1000);
        const newOrder = {
            id: orderId,
            guest: data.guest,
            drink: data.drink,
            time: data.time || new Date().toLocaleTimeString(),
            notes: data.notes || '手動新增',
            status: 'completed',
            completedTime: new Date().toLocaleTimeString()
        };

        // 如果選擇了預設配圖，將檔案複製到 images/ 之下
        if (data.presetImage) {
            const presetPath = path.join(__dirname, 'public', 'images', 'presets', data.presetImage);
            const ext = path.extname(data.presetImage) || '.png';
            const targetPath = path.join(__dirname, 'public', 'images', `${data.drink}${ext}`);
            try {
                if (fs.existsSync(presetPath)) {
                    fs.copyFileSync(presetPath, targetPath);
                    console.log(`成功複製預設圖片 ${data.presetImage} 至: ${targetPath}`);
                    
                    // 重新掃描圖片與配方庫以讓自訂飲品在選單中擁有這張配圖
                    loadDrinksData();
                    io.emit('recipes-updated');
                }
            } catch (err) {
                console.error("複製預設圖片失敗:", err);
            }
        }

        orders.push(newOrder);
        appendToCompletedLog(newOrder);
        io.emit('sync-orders', orders);
    });

    socket.on('update-campaign', (data) => {
        campaignDatabase = {
            active: !!data.active,
            text: (data.text || '').trim().slice(0, 100),
            tag: (data.tag || '活動').trim().slice(0, 10),
            style: data.style || 'gold'
        };
        saveCampaignData();
        io.emit('campaign-updated', campaignDatabase);
        console.log(`📢 活動更新: ${campaignDatabase.active ? '啟用' : '停用'} - ${campaignDatabase.text}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器已啟動: http://localhost:${PORT}`);
});