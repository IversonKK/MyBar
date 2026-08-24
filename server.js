const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 智慧圖片相容處理：若請求 .jpg 且檔案不存在，但對應的 .png / .svg / .jpeg 存在時自動無縫傳送，避免 404 Console 報錯
app.get('/images/:filename', (req, res, next) => {
    const imagesDir = path.join(__dirname, 'public', 'images');
    const requestedFile = req.params.filename;
    const requestedPath = path.join(imagesDir, requestedFile);

    if (fs.existsSync(requestedPath)) {
        return next(); // 檔案存在，直接交給 express.static 處理
    }

    // 嘗試找尋其他副檔名相容檔案
    const ext = path.extname(requestedFile);
    const baseName = path.basename(requestedFile, ext);
    const candidateExts = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];

    for (const altExt of candidateExts) {
        if (altExt.toLowerCase() === ext.toLowerCase()) continue;
        const altPath = path.join(imagesDir, baseName + altExt);
        if (fs.existsSync(altPath)) {
            return res.sendFile(altPath);
        }
    }

    next();
});

// 設定 public 為靜態資料夾
app.use(express.static(path.join(__dirname, 'public')));

let allDrinks = [];
let recipeDatabase = {};
let orders = [];
let favoritesDatabase = {};
let avatarsDatabase = {};
let tunnelUrl = ''; // 儲存 cloudflared 隧道網址
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
const campaignPath = path.join(__dirname, 'campaign.json');
const soldOutPath = path.join(__dirname, 'soldout.json');
const missingIngredientsPath = path.join(__dirname, 'missing_ingredients.json');
const titlesPath = path.join(__dirname, 'titles.json');

let soldOutDrinks = []; // 儲存已下架的調酒名稱清單
let missingIngredients = []; // 儲存缺料原料名稱清單 (例如: ['薄荷', '鮮奶油'])
let guestTitlesDatabase = {}; // 儲存顧客尊榮稱號 (例如: { '小明': { id: 'legendary_drinker', text: '👑 傳奇酒豪', style: 'legendary' } })

function loadSoldOutData() {
    try {
        if (fs.existsSync(soldOutPath)) {
            soldOutDrinks = JSON.parse(fs.readFileSync(soldOutPath, 'utf8'));
            console.log(`成功讀取 soldout.json，共載入 ${soldOutDrinks.length} 筆已下架調酒資料。`);
        }
    } catch (err) {
        console.error("讀取 soldout.json 失敗:", err.message);
    }
}

function saveSoldOutData() {
    try {
        fs.writeFileSync(soldOutPath, JSON.stringify(soldOutDrinks, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 soldout.json 失敗:", err);
    }
}

function loadMissingIngredientsData() {
    try {
        if (fs.existsSync(missingIngredientsPath)) {
            missingIngredients = JSON.parse(fs.readFileSync(missingIngredientsPath, 'utf8'));
            console.log(`成功讀取 missing_ingredients.json，目前缺料 ${missingIngredients.length} 項。`);
        }
    } catch (err) {
        console.error("讀取 missing_ingredients.json 失敗:", err.message);
    }
}

function saveMissingIngredientsData() {
    try {
        fs.writeFileSync(missingIngredientsPath, JSON.stringify(missingIngredients, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 missing_ingredients.json 失敗:", err);
    }
}

function loadTitlesData() {
    try {
        if (fs.existsSync(titlesPath)) {
            guestTitlesDatabase = JSON.parse(fs.readFileSync(titlesPath, 'utf8'));
            console.log(`成功讀取 titles.json，共載入 ${Object.keys(guestTitlesDatabase).length} 筆頭銜資料。`);
        }
    } catch (err) {
        console.error("讀取 titles.json 失敗:", err.message);
    }
}

function saveTitlesData() {
    try {
        fs.writeFileSync(titlesPath, JSON.stringify(guestTitlesDatabase, null, 4), 'utf8');
    } catch (err) {
        console.error("寫入 titles.json 失敗:", err);
    }
}

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

function saveCompletedOrdersData() {
    try {
        const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'rejected');
        fs.writeFileSync(completedOrdersLogPath, JSON.stringify(completedOrders, null, 4), 'utf8');
        console.log(`成功儲存 completed_orders.json，共計 ${completedOrders.length} 筆。`);
    } catch (err) {
        console.error("寫入 completed_orders.json 失敗:", err);
    }
}

function syncToExcel(recipeDatabase) {
    const excelPath = path.join(__dirname, 'menu_database.xlsx');
    const rows = [];
    for (const [name, info] of Object.entries(recipeDatabase)) {
        let materials = "", method = "", cup = "", garnish = "", story = "";
        const descLines = (info.description || "").split('\n');
        let storyLines = [];

        descLines.forEach(line => {
            if (line.startsWith('材料：') || line.startsWith('材料:')) materials = line.replace(/材料[：:]/, '');
            else if (line.startsWith('技法：') || line.startsWith('技法:')) method = line.replace(/技法[：:]/, '');
            else if (line.startsWith('杯型：') || line.startsWith('杯型:')) cup = line.replace(/杯型[：:]/, '');
            else if (line.startsWith('裝飾：') || line.startsWith('裝飾:')) garnish = line.replace(/裝飾[：:]/, '');
            else storyLines.push(line);
        });

        rows.push({
            "酒名 (必須與圖片同名)": name,
            "濃度 (%)": info.abv || 15,
            "酒感 (1-5)": info.strong || 3,
            "酸度 (1-5)": info.sour || 3,
            "標籤 (用逗號隔開)": (info.tags || []).join(', '),
            "材料": materials,
            "技法": method,
            "杯型": cup,
            "裝飾": garnish,
            "故事與敘述": storyLines.join('\n')
        });
    }
    try {
        const ws = xlsx.utils.json_to_sheet(rows);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "酒單配方");
        xlsx.writeFile(wb, excelPath);
        console.log("🎉 已同步更新 menu_database.xlsx！");
    } catch (err) {
        console.error("同步至 Excel 失敗:", err.message);
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
        const imageDrinkFiles = new Map(); // name -> ext
        files.forEach(file => {
            if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
                const ext = file.substring(file.lastIndexOf('.') + 1);
                const rawDrinkName = file.replace(/\.(jpg|png)$/i, '');
                if (!imageDrinkFiles.has(rawDrinkName)) {
                    imageDrinkFiles.set(rawDrinkName, ext);
                }
            }
        });

        // 收集所有在 recipeDatabase 中的名稱，以及所有在 imagesDir 中有圖檔的名稱
        const allDrinkNames = new Set();
        Object.keys(recipeDatabase).forEach(name => allDrinkNames.add(name));
        imageDrinkFiles.forEach((ext, name) => allDrinkNames.add(name));

        let idCounter = 1;
        allDrinkNames.forEach(rawDrinkName => {
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
                isSoldOut: soldOutDrinks.includes(rawDrinkName) || oldSoldOutNames.includes(rawDrinkName),
                comingSoon: isMissingRecipe
            });
        });
        console.log(`掃描完成！成功載入了 ${allDrinks.length} 款調酒資料。`);
    } catch (err) {
        console.error("讀取圖片資料夾或配方庫失敗:", err);
    }
}

loadSoldOutData();
loadMissingIngredientsData();
loadTitlesData();
loadDrinksData();
loadOrdersData();
loadFavoritesData();
loadAvatarsData();
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

app.get('/api/campaign', (req, res) => {
    res.json(campaignDatabase);
});

// 列出已有酒品圖片 API
app.get('/api/images', (req, res) => {
    const imagesDir = path.join(__dirname, 'public', 'images');
    fs.readdir(imagesDir, (err, files) => {
        if (err) return res.status(500).json({ error: '無法讀取圖片資料夾' });
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        res.json(imageFiles);
    });
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
    socket.emit('sync-sold-out', soldOutDrinks);
    socket.emit('sync-missing-ingredients', missingIngredients);
    socket.emit('sync-guest-titles', guestTitlesDatabase);

    socket.on('new-order', (orderData) => {
        // 伺服器端防呆：檢查該調酒是否已下架/售罄
        const targetDrink = allDrinks.find(d => d.name === orderData.drink);
        if (targetDrink && targetDrink.isSoldOut) {
            socket.emit('order-error', `⚠️ 抱歉，【${orderData.drink}】目前已下架售罄囉！`);
            return;
        }

        // 限制備註最大字數為 30 字
        orderData.notes = (orderData.notes || '').trim().slice(0, 30);

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
            
            // 更新並儲存到 soldout.json
            if (drink.isSoldOut) {
                if (!soldOutDrinks.includes(drink.name)) {
                    soldOutDrinks.push(drink.name);
                }
            } else {
                soldOutDrinks = soldOutDrinks.filter(name => name !== drink.name);
            }
            saveSoldOutData();
            
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
            } else if (recipeData.presetImage) {
                const presetPath = path.join(__dirname, 'public', 'images', 'presets', recipeData.presetImage);
                const ext = path.extname(recipeData.presetImage) || '.png';
                const targetPath = path.join(__dirname, 'public', 'images', `${recipeData.name}${ext}`);
                try {
                    if (fs.existsSync(presetPath)) {
                        fs.copyFileSync(presetPath, targetPath);
                        console.log(`成功複製預設圖片 ${recipeData.presetImage} 至: ${targetPath}`);
                    }
                } catch (err) {
                    console.error("複製預設圖片失敗:", err);
                }
            } else if (recipeData.existingImage) {
                // 從已有的酒品圖片複製
                const sourcePath = path.join(__dirname, 'public', 'images', recipeData.existingImage);
                const ext = path.extname(recipeData.existingImage) || '.jpg';
                const targetPath = path.join(__dirname, 'public', 'images', `${recipeData.name}${ext}`);
                try {
                    if (fs.existsSync(sourcePath)) {
                        // 如果來源與目標不同，才複製
                        if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
                            fs.copyFileSync(sourcePath, targetPath);
                            console.log(`成功複製既有圖片 ${recipeData.existingImage} 至: ${targetPath}`);
                        }
                    }
                } catch (err) {
                    console.error("複製既有圖片失敗:", err);
                }
            }

            fs.writeFileSync(recipePath, JSON.stringify(currentRecipes, null, 4), 'utf8');
            console.log(`成功儲存配方並寫入檔案: ${recipeData.name}`);

            syncToExcel(currentRecipes);

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



    socket.on('add-manual-completed-order', (data) => {
        const ts = data.timestamp || Date.now();
        const orderId = ts + '-' + Math.floor(Math.random() * 1000);
        const newOrder = {
            id: orderId,
            guest: data.guest,
            drink: data.drink,
            time: data.time || new Date().toLocaleTimeString(),
            notes: data.notes || '手動新增',
            status: 'completed',
            completedTime: new Date().toLocaleTimeString(),
            hiddenFromDashboard: data.hiddenFromDashboard || false
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

    socket.on('toggle-missing-ingredient', (ingredient) => {
        if (!ingredient || typeof ingredient !== 'string') return;
        const name = ingredient.trim();
        if (missingIngredients.includes(name)) {
            missingIngredients = missingIngredients.filter(i => i !== name);
        } else {
            missingIngredients.push(name);
        }
        saveMissingIngredientsData();
        io.emit('sync-missing-ingredients', missingIngredients);
        console.log(`📦 缺料變更: ${name} (${missingIngredients.includes(name) ? '缺貨' : '有貨'})`);
    });

    socket.on('update-guest-title', (data) => {
        if (!data || !data.guest) return;
        guestTitlesDatabase[data.guest] = data.title || null;
        saveTitlesData();
        io.emit('sync-guest-titles', guestTitlesDatabase);
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