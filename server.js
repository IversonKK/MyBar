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

const ordersPath = path.join(__dirname, 'orders.json');
const completedOrdersLogPath = path.join(__dirname, 'completed_orders.json'); // 新增已完成訂單的檔案路徑
const favoritesPath = path.join(__dirname, 'favorites.json');
const avatarsPath = path.join(__dirname, 'avatars.json');

function loadOrdersData() {
    try {
        if (fs.existsSync(ordersPath)) {
            const rawData = fs.readFileSync(ordersPath, 'utf8');
            orders = JSON.parse(rawData);
            console.log(`成功讀取 orders.json，共載入 ${orders.length} 筆進行中的訂單。`);
        }
        // 同時載入已完成的訂單紀錄，用於排行榜和歷史紀錄
        if (fs.existsSync(completedOrdersLogPath)) {
            const completedRawData = fs.readFileSync(completedOrdersLogPath, 'utf8');
            const completedOrders = JSON.parse(completedRawData);
            // 將已完成的訂單合併到主訂單列表中，以便客戶端正確顯示歷史
            orders = orders.concat(completedOrders);
            console.log(`成功載入 ${completedOrders.length} 筆已完成的歷史訂單。`);
        }
    } catch (err) {
        console.error("讀取訂單資料失敗:", err.message);
    }
}

function saveOrdersData() {
    try {
        // 只儲存未完成的訂單到 orders.json
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

function loadDrinksData() {
    // 記住目前的售罄狀態，避免重載配方後被洗掉
    const oldSoldOutNames = allDrinks.filter(d => d.isSoldOut).map(d => d.name);
    allDrinks = [];
    
    // 1. 讀取獨立的 recipe.json 檔案
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

    // 2. 指定圖片所在的資料夾路徑
    const imagesDir = path.join(__dirname, 'public', 'images');

    try {
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        
        // 3. 掃描資料夾內的所有檔案
        const files = fs.readdirSync(imagesDir);
        let idCounter = 1;
        
        files.forEach(file => {
            if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
                const rawDrinkName = file.replace(/\.(jpg|png)$/i, '');
                let recipeKey = rawDrinkName;
                
                // --- 智慧模糊比對：讓圖片檔名與 recipe.json 完美配對 ---
                if (!recipeDatabase[recipeKey]) {
                    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
                    const normRaw = normalize(rawDrinkName);
                    const knownKeys = Object.keys(recipeDatabase);
                    
                    // 1. 完全忽略符號與大小寫
                    let match = knownKeys.find(k => normalize(k) === normRaw);
                    
                    // 2. 互相包含比對 (容錯)
                    if (!match && normRaw.length >= 2) {
                        match = knownKeys.find(k => normalize(k).includes(normRaw) || normRaw.includes(normalize(k)));
                    }
                    if (match) recipeKey = match;
                }

                const isMissingRecipe = !recipeDatabase[recipeKey];
                // 4. 從 recipeDatabase 尋找配方，若找不到則套用預設值
                const recipeInfo = recipeDatabase[recipeKey] || {
                    abv: 15,
                    strong: 3,
                    sour: 3,
                    tags: ["其他"],
                    description: "材料：配方待補充。杯型：待確認。裝飾：無。"
                };
                
                allDrinks.push({
                    id: idCounter++,
                    name: rawDrinkName, // 保持原本的圖片名稱作為前端抓圖依據
                    abv: recipeInfo.abv,
                    strong: recipeInfo.strong,
                    sour: recipeInfo.sour,
                    tags: recipeInfo.tags,
                    description: recipeInfo.description,
                    isSoldOut: oldSoldOutNames.includes(rawDrinkName), // 恢復先前的售罄狀態
                    comingSoon: isMissingRecipe // 新增標記判斷是否缺少配方
                });
            }
        });
        console.log(`掃描完成！成功載入了 ${allDrinks.length} 款調酒資料。`);
    } catch (err) {
        console.error("讀取圖片資料夾失敗，請確認路徑是否正確:", err);
    }
}

// 啟動時自動載入一次
loadDrinksData();
loadOrdersData();
loadFavoritesData();
loadAvatarsData();

// 提供 API 給前端抓取酒單
app.get('/api/drinks', (req, res) => {
    res.json(allDrinks);
});

// 處理所有 Socket.io 連線與事件
io.on('connection', (socket) => {
    socket.emit('sync-orders', orders);
    socket.emit('sync-avatars', avatarsDatabase);

    socket.on('new-order', (orderData) => {
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
                appendToCompletedLog(order); // 當訂單完成或拒絕時，寫入永久紀錄檔
            }
            saveOrdersData(); // 只儲存進行中的訂單
            io.emit('order-status-updated', order);
        }
    });

    socket.on('delete-order', (orderId) => {
        orders = orders.filter(o => o.id !== orderId);
        saveOrdersData();
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

    // 永久清除特定客人的紀錄
    socket.on('clear-guest-history', (guestName) => {
        orders = orders.filter(o => o.guest !== guestName);
        saveOrdersData();
        io.emit('sync-orders', orders);
    });

    // 將已結束的訂單從酒保畫面隱藏 (但保留給客人看)
    socket.on('clear-finished-from-dashboard', (callback) => {
        orders.forEach(o => {
            if (o.status === 'completed' || o.status === 'rejected') {
                o.hiddenFromDashboard = true;
            }
        });
        saveOrdersData();
        io.emit('sync-orders', orders);
        if (typeof callback === 'function') callback(); // 告訴前端已確實存檔
    });

    socket.on('toggle-sold-out', (id) => {
        const drink = allDrinks.find(d => d.id === id);
        if (drink) {
            drink.isSoldOut = !drink.isSoldOut;
            io.emit('drink-sold-out-updated', { id, isSoldOut: drink.isSoldOut });
        }
    });

    // 監聽重新載入配方的請求
    socket.on('reload-recipes', () => {
        console.log('收到重載配方請求，正在重新讀取 recipe.json...');
        loadDrinksData();
        io.emit('recipes-updated'); // 廣播給所有客戶端重新抓取酒單
    });

    // --- 儲存或更新配方 ---
    socket.on('save-recipe', (recipeData) => {
        const recipePath = path.join(__dirname, 'recipe.json');
        try {
            let currentRecipes = {};
            
            // 1. 如果檔案已經存在，先讀取現有的配方庫
            if (fs.existsSync(recipePath)) {
                const rawData = fs.readFileSync(recipePath, 'utf8');
                currentRecipes = JSON.parse(rawData);
            }

            // 2. 更新或新增該酒名的配方內容
            currentRecipes[recipeData.name] = {
                abv: recipeData.abv,
                strong: recipeData.strong,
                sour: recipeData.sour,
                tags: recipeData.tags,
                description: recipeData.description
            };

            // 如果前端有傳送圖片資料，則還原存入 images 資料夾
            if (recipeData.imageData) {
                const base64Data = recipeData.imageData.replace(/^data:image\/\w+;base64,/, "");
                const ext = recipeData.imageExtension === 'png' ? 'png' : 'jpg';
                const imagePath = path.join(__dirname, 'public', 'images', `${recipeData.name}.${ext}`);
                fs.writeFileSync(imagePath, base64Data, 'base64');
                console.log(`成功儲存圖片: ${recipeData.name}.${ext}`);
            }

            // 3. 將更新後的物件轉回 JSON 字串，寫入檔案
            fs.writeFileSync(recipePath, JSON.stringify(currentRecipes, null, 4), 'utf8');
            console.log(`成功儲存配方並寫入檔案: ${recipeData.name}`);

            // 4. 呼叫載入函式，更新記憶體中的酒單陣列
            loadDrinksData(); 

            // 5. 廣播給所有連線的裝置 (包含酒保與客人)，通知他們重新抓取最新酒單
            io.emit('recipes-updated'); 
            
        } catch (err) {
            console.error("寫入 recipe.json 失敗:", err);
        }
    });

    // --- 客戶端最愛與頭像的同步邏輯 ---
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器已啟動: http://localhost:${PORT}`);
});