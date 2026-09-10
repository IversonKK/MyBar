const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const xlsx = require('xlsx');
const readline = require('readline');

// 輔助函式：文字提示與使用者互動輸入 (Promise)
function askConfirmation(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// 輔助函式：解析現有調酒 description 欄位
function parseDescription(desc) {
    let materials = '', method = '', cup = '', garnish = '';
    const descLines = (desc || '').split('\n');
    let storyLines = [];

    descLines.forEach(line => {
        const trimmed = line.trim();
        if (/^材料[：:]/.test(trimmed)) materials = trimmed.replace(/^材料[：:]\s*/, '').trim();
        else if (/^技法[：:]/.test(trimmed)) method = trimmed.replace(/^技法[：:]\s*/, '').trim();
        else if (/^杯型[：:]/.test(trimmed)) cup = trimmed.replace(/^杯型[：:]\s*/, '').trim();
        else if (/^裝飾[：:]/.test(trimmed)) garnish = trimmed.replace(/^裝飾[：:]\s*/, '').trim();
        else if (trimmed) storyLines.push(trimmed);
    });

    return {
        materials: materials || '無',
        method: method || '無',
        cup: cup || '無',
        garnish: garnish || '無',
        story: storyLines.join('\n') || '無'
    };
}


// 輔助函式：發送 HTTP/HTTPS GET 請求獲取文字
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    redirectUrl = new URL(redirectUrl, url).href;
                }
                return fetchHtml(redirectUrl).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP 請求失敗，狀態碼: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// 輔助函式：下載圖片並儲存至本機
function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://mixology.com.tw/'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    redirectUrl = new URL(redirectUrl, url).href;
                }
                return downloadImage(redirectUrl, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`下載圖片失敗，狀態碼: ${res.statusCode}`));
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close(() => resolve(destPath));
            });
        }).on('error', reject);
    });
}

// 解析 HTML 內容抽取酒譜資訊
function parseMixologyHtml(html, sourceUrl) {
    // 1. 中英文名稱
    const cNameMatch = html.match(/id=["']CT1_RecipeCName["'][^>]*>([^<]+)<\/span>/i);
    const eNameMatch = html.match(/id=["']CT1_RecipeEName["'][^>]*>([^<]+)<\/span>/i);
    const cName = cNameMatch ? cNameMatch[1].trim() : '';
    const eName = eNameMatch ? eNameMatch[1].trim() : '';

    if (!cName && !eName) {
        throw new Error('無法在此頁面找到調酒名稱，請確認網址或 rid 是否正確！');
    }

    // 2. 圖片路徑
    let imgSrc = '';
    const imgMatch = html.match(/id=["']CT1_RecipeImage["'][^>]*src=["']([^"']+)["']/i);
    if (imgMatch) {
        imgSrc = imgMatch[1].trim();
    } else {
        const ogImgMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
        if (ogImgMatch) imgSrc = ogImgMatch[1].trim();
    }

    if (imgSrc) {
        if (imgSrc.startsWith('~')) imgSrc = imgSrc.substring(1);
        if (!imgSrc.startsWith('http')) {
            imgSrc = 'https://mixology.com.tw/' + imgSrc.replace(/^\//, '');
        }
    }

    // 3. 材料與用量
    const ingredients = [];
    const tableMatch = html.match(/<table[^>]*class=["'][^"']*recipe_detail_ingred[^"']*["'][\s\S]*?<\/table>/gi);
    if (tableMatch) {
        for (const tbl of tableMatch) {
            const rowRegex = /<tr>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>/gi;
            let m;
            while ((m = rowRegex.exec(tbl)) !== null) {
                const item = m[1].replace(/&nbsp;?/gi, ' ').trim();
                const amount = m[2].replace(/&nbsp;?/gi, ' ').trim();
                if (item && !item.includes('◆') && !item.includes('作法')) {
                    ingredients.push(`${item} ${amount}`.trim());
                }
            }
        }
    }

    // 4. 杯型、技法、裝飾與純故事文字 (注意：完全濾除作法步驟)
    let garnish = '';
    let cup = '';
    let method = '';
    let extractedStory = '';

    // 檢查網頁上的介紹區塊 (#CT1_RecipeIntro)
    const introMatch = html.match(/id=["']CT1_RecipeIntro["'][^>]*>([\s\S]*?)<\/span>/i);
    if (introMatch) {
        const rawIntro = introMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;?/gi, ' ').trim();
        if (rawIntro && !rawIntro.includes('作法') && !rawIntro.includes('步驟') && rawIntro.length >= 10) {
            extractedStory = rawIntro;
        }
    }

    const contentMatch = html.match(/class=["']recipe_detail_content["'][^>]*>[\s\S]*?<div style=["'][^"']*float:\s*left;?["']>([\s\S]*?)<\/div>/i);
    let stepsText = '';
    if (contentMatch) {
        const rawContent = contentMatch[1].replace(/<br\s*\/?>/gi, '\n');
        const lines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(l => {
            if (l.startsWith('裝飾物：') || l.startsWith('裝飾：')) {
                garnish = l.replace(/^裝飾物?[：:]\s*/, '').trim();
            } else if (l.startsWith('杯型：')) {
                cup = l.replace(/^杯型[：:]\s*/, '').trim();
            } else if (l.startsWith('技法：')) {
                method = l.replace(/^技法[：:]\s*/, '').trim();
            } else {
                stepsText += l + ' ';
            }
        });
    }

    // 從頁面上的分類標籤輔助提取杯型與技法 (如 Cocktail Glass, Hurricane Glass, Shake, Longdrink 等)
    const catMatches = [...html.matchAll(/<a[^>]*href=["']\.\/Recipe\.aspx\?cid=\d+["'][^>]*>\s*([^<]+?)\s*<\/a>/gi)].map(m => m[1].trim());
    
    if (!cup) {
        // 優先從文字辨識具體杯型（避免分類標籤過於籠統）
        if (stepsText.includes('颶風杯')) cup = '古巴颶風杯 (Hurricane Glass)';
        else if (stepsText.includes('馬丁尼杯')) cup = '冰鎮馬丁尼杯';
        else if (stepsText.includes('高球杯')) cup = '高球杯 (Highball Glass)';
        else if (stepsText.includes('可林杯')) cup = '可林杯 (Collins Glass)';
        else if (stepsText.includes('長飲杯')) cup = '冰鎮長飲杯';
        else if (stepsText.includes('古典杯') || stepsText.includes('威士忌杯')) cup = '古典杯 (Old Fashioned Glass)';
        else {
            const foundCup = catMatches.find(c => /glass|saucer|mug|cup/i.test(c));
            if (foundCup) {
                if (/hurricane/i.test(foundCup)) cup = '古巴颶風杯 (Hurricane Glass)';
                else if (/martini/i.test(foundCup)) cup = '馬丁尼杯 (Martini Glass)';
                else if (/highball/i.test(foundCup)) cup = '高球杯 (Highball Glass)';
                else if (/collins/i.test(foundCup)) cup = '可林杯 (Collins Glass)';
                else if (/cocktail/i.test(foundCup)) cup = '雞尾酒杯 (Cocktail Glass)';
                else if (/old fashioned/i.test(foundCup)) cup = '古典杯 (Old Fashioned Glass)';
                else cup = foundCup;
            } else {
                cup = '長飲杯';
            }
        }
    }

    if (!method) {
        const foundMethod = catMatches.find(c => /shake|stir|build|blend|roll/i.test(c));
        if (foundMethod) {
            if (/shake/i.test(foundMethod)) method = '搖盪法 (Shake)';
            else if (/stir/i.test(foundMethod)) method = '攪拌法 (Stir)';
            else if (/build/i.test(foundMethod)) method = '直調法 (Build)';
            else if (/blend/i.test(foundMethod)) method = '霜凍/攪拌機 (Blend)';
            else method = foundMethod;
        } else {
            if (stepsText.includes('雪克杯') || stepsText.includes('搖盪')) method = '搖盪法 (Shake)';
            else if (stepsText.includes('攪拌')) method = '攪拌法 (Stir)';
            else method = '直調法 (Build)';
        }
    }

    // 5. 標籤與屬性推估
    const tags = new Set();
    const fullText = (cName + ' ' + eName + ' ' + ingredients.join(' ') + ' ' + catMatches.join(' ')).toLowerCase();

    // 基酒標籤
    if (fullText.includes('琴酒') || fullText.includes('gin')) tags.add('琴酒');
    if (fullText.includes('伏特加') || fullText.includes('vodka')) tags.add('伏特加');
    if (fullText.includes('蘭姆酒') || fullText.includes('rum')) tags.add('蘭姆酒');
    if (fullText.includes('龍舌蘭') || fullText.includes('tequila')) tags.add('龍舌蘭');
    if (fullText.includes('威士忌') || fullText.includes('whiskey') || fullText.includes('whisky')) tags.add('威士忌');
    if (fullText.includes('白蘭地') || fullText.includes('brandy')) tags.add('白蘭地');

    // 氣泡特徵
    if (fullText.includes('蘇打') || fullText.includes('雪碧') || fullText.includes('七喜') || fullText.includes('可樂') || fullText.includes('通寧') || fullText.includes('氣泡') || fullText.includes('fizz')) {
        tags.add('有氣泡');
    } else {
        tags.add('無氣泡');
    }

    // 風味/類型標籤
    if (fullText.includes('檸檬') || fullText.includes('萊姆') || fullText.includes('酸') || fullText.includes('sour') || fullText.includes('雪碧')) {
        tags.add('酸甜');
    }
    if (fullText.includes('longdrink') || fullText.includes('長飲') || cup.includes('長飲') || cup.includes('高球') || cup.includes('颶風')) {
        tags.add('長飲');
    }
    tags.add('經典');

    // ABV 濃度與酒感推估
    let abv = 16;
    let strong = 3;
    let sour = 3;

    if (fullText.includes('雪碧') || fullText.includes('蘇打') || fullText.includes('通寧')) {
        abv = 16;
        strong = 2;
    } else if (tags.has('無氣泡') && (tags.has('琴酒') || tags.has('伏特加') || tags.has('威士忌'))) {
        abv = 28;
        strong = 4;
    }

    return {
        cName,
        eName,
        fullName: eName ? `${cName}  ${eName}` : cName,
        imgSrc,
        ingredients,
        method,
        cup,
        garnish,
        extractedStory,
        tags: Array.from(tags),
        abv,
        strong,
        sour,
        sourceUrl
    };
}

// 智慧故事生成器：依酒款類型自動查詢經典背景或創作迷人故事
function resolveDrinkStory(data, userCustomStory) {
    if (userCustomStory && userCustomStory.trim()) {
        return userCustomStory.trim();
    }

    // 1. 查詢經典故事庫 (stories.json)
    try {
        const storiesPath = path.join(__dirname, 'stories.json');
        if (fs.existsSync(storiesPath)) {
            const storiesDb = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
            const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
            const normFull = normalize(data.fullName);
            const normC = normalize(data.cName);
            const normE = normalize(data.eName);

            for (const [key, story] of Object.entries(storiesDb)) {
                const normKey = normalize(key);
                if (normKey === normFull || normKey === normC || (normE && normKey === normE)) {
                    if (story && story.length > 5) return story;
                }
            }
        }
    } catch (e) {}

    // 2. 若網頁自身有合格的故事介紹（非作法步驟）
    if (data.extractedStory && data.extractedStory.length >= 10) {
        return data.extractedStory;
    }

    // 3. 創新調酒 / 現代酒款：根據配方與視覺自創專屬故事
    const ingNames = data.ingredients.map(i => i.split(' ')[0]).filter(Boolean);
    const ingText = ingNames.slice(0, 3).join('與');
    const hasGin = data.tags.includes('琴酒');
    const hasVodka = data.tags.includes('伏特加');
    const hasRum = data.tags.includes('蘭姆酒');
    const hasWhisky = data.tags.includes('威士忌');
    const hasBrandy = data.tags.includes('白蘭地');
    const hasTequila = data.tags.includes('龍舌蘭');
    const isSparkling = data.tags.includes('有氣泡');
    const isSourSweet = data.tags.includes('酸甜');

    let spiritDesc = '特選基酒';
    if (hasGin && hasVodka) spiritDesc = '琴酒草本與伏特加俐落的雙基酒骨架';
    else if (hasGin) spiritDesc = '琴酒淡雅的草本杜松子芳香';
    else if (hasVodka) spiritDesc = '伏特加純淨洗鍊的酒體';
    else if (hasRum) spiritDesc = '蘭姆酒溫潤熱情的甘蔗香氣';
    else if (hasWhisky) spiritDesc = '威士忌醇厚深邃的木質尾韻';
    else if (hasBrandy) spiritDesc = '白蘭地優雅細膩的果香層次';
    else if (hasTequila) spiritDesc = '龍舌蘭奔放明亮的風土草本感';

    let vibeDesc = isSparkling 
        ? (isSourSweet ? '沁涼氣泡交織出明亮愉悅的酸甜果香' : '清爽暢快的氣泡躍動感') 
        : (isSourSweet ? '柔順細膩的酸甜平衡' : '純粹深沉的微醺層次');

    return `以【${data.cName}】為名創作，巧妙運用${spiritDesc}，襯托${ingText}。入口迎來${vibeDesc}，在舌尖綻放優雅豐富的風味曲線，為吧台夜色添上一抹令人流連的專屬微醺記憶。`;
}

// 同步回 menu_database.xlsx
function syncToExcel(recipeDatabase) {
    const excelPath = path.join(__dirname, 'menu_database.xlsx');
    const rows = [];
    for (const [name, info] of Object.entries(recipeDatabase)) {
        const parsed = parseDescription(info.description);
        rows.push({
            '酒名 (必須與圖片同名)': name,
            '濃度 (%)': info.abv || 15,
            '酒感 (1-5)': info.strong || 3,
            '酸度 (1-5)': info.sour || 3,
            '標籤 (用逗號隔開)': (info.tags || []).join(', '),
            '材料': parsed.materials === '無' ? '' : parsed.materials,
            '技法': parsed.method === '無' ? '' : parsed.method,
            '杯型': parsed.cup === '無' ? '' : parsed.cup,
            '裝飾': parsed.garnish === '無' ? '' : parsed.garnish,
            '故事與敘述': parsed.story === '無' ? '' : parsed.story
        });
    }

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '酒單配方');
    xlsx.writeFile(wb, excelPath);
    console.log('📄 已同步更新至 menu_database.xlsx');
}

// 主執行流程
async function importDrinkFromMixology(input, customStory, options = {}) {
    let url = input.trim();
    if (!url.startsWith('http')) {
        url = `https://mixology.com.tw/RecipeContent.aspx?rid=${encodeURIComponent(url)}`;
    }

    console.log(`🌐 正在擷取酒譜頁面: ${url}`);
    const html = await fetchHtml(url);
    const data = parseMixologyHtml(html, url);

    // 取得/生成背景故事 (絕對不放流水作法步驟)
    const story = resolveDrinkStory(data, customStory);

    console.log(`\n================================================================================`);
    console.log(`🍹 成功解析調酒: ${data.fullName}`);
    console.log(`   中文名稱: ${data.cName}`);
    console.log(`   英文名稱: ${data.eName}`);
    console.log(`   材料清單: ${data.ingredients.join(', ')}`);
    console.log(`   杯型設定: ${data.cup}`);
    console.log(`   技法設定: ${data.method}`);
    if (data.garnish) console.log(`   杯飾設定: ${data.garnish}`);
    console.log(`   標籤標記: ${data.tags.join(', ')}`);
    console.log(`   濃度/酒感: ${data.abv}% / 酒感 ${data.strong} / 酸度 ${data.sour}`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📖 調酒故事與背景:`);
    console.log(`   ${story}`);
    console.log(`================================================================================\n`);

    // 組裝新資料的 description 欄位
    let descParts = [];
    if (data.ingredients.length > 0) descParts.push(`材料：${data.ingredients.join(', ')}`);
    if (data.method) descParts.push(`技法：${data.method}`);
    if (data.cup) descParts.push(`杯型：${data.cup}`);
    if (data.garnish) descParts.push(`裝飾：${data.garnish}`);
    descParts.push(story.trim());
    const finalDescription = descParts.join('\n');

    // 讀取現有 recipe.json
    const recipePath = path.join(__dirname, 'recipe.json');
    let recipeDb = {};
    if (fs.existsSync(recipePath)) {
        try {
            recipeDb = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
        } catch (e) {
            console.error('讀取 recipe.json 失敗:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 防呆機制：比對是否已存在同名或相似名稱的調酒
    // ─────────────────────────────────────────────────────────────
    const normalizeName = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    const normNewFull = normalizeName(data.fullName);
    const normNewC = normalizeName(data.cName);
    const normNewE = normalizeName(data.eName);

    let existingKey = null;
    let existingData = null;

    for (const [key, item] of Object.entries(recipeDb)) {
        const normExisting = normalizeName(key);
        if (normExisting === normNewFull ||
            (normNewC.length >= 2 && normExisting === normNewC) ||
            (normNewC.length >= 2 && normExisting.startsWith(normNewC)) ||
            (normNewE.length >= 3 && normExisting.includes(normNewE)) ||
            (normExisting.length >= 2 && normNewFull.startsWith(normExisting))) {
            existingKey = key;
            existingData = item;
            break;
        }
    }

    if (existingData && !options.force) {
        const oldParsed = parseDescription(existingData.description);
        const newMaterials = data.ingredients.join(', ') || '無';
        const newMethod = data.method || '無';
        const newCup = data.cup || '無';
        const newGarnish = data.garnish || '無';

        console.log(`╔════════════════════════════════════════════════════════════════════════════════════╗`);
        console.log(`║ ⚠️  防呆提醒：系統內已存在相同的調酒資料！                                         ║`);
        console.log(`╚════════════════════════════════════════════════════════════════════════════════════╝`);
        console.log(`\n【📋 現有資料 (系統內庫存)】:`);
        console.log(`   • 酒名：${existingKey}`);
        console.log(`   • 濃度 / 酒感 / 酸度：${existingData.abv || 15}% / 酒感 ${existingData.strong || 3} / 酸度 ${existingData.sour || 3}`);
        console.log(`   • 標籤：${(existingData.tags || []).join(', ')}`);
        console.log(`   • 材料：${oldParsed.materials}`);
        console.log(`   • 技法：${oldParsed.method}`);
        console.log(`   • 杯型：${oldParsed.cup}`);
        console.log(`   • 裝飾：${oldParsed.garnish}`);
        console.log(`   • 故事：${oldParsed.story.replace(/\n/g, ' ')}`);

        console.log(`\n────────────────────────────────────────────────────────────────────────────────────`);
        console.log(`【🆕 欲匯入資料 (來自 Mixology 網站)】:`);
        console.log(`   • 酒名：${data.fullName}`);
        console.log(`   • 濃度 / 酒感 / 酸度：${data.abv}% / 酒感 ${data.strong} / 酸度 ${data.sour}`);
        console.log(`   • 標籤：${data.tags.join(', ')}`);
        console.log(`   • 材料：${newMaterials}`);
        console.log(`   • 技法：${newMethod}`);
        console.log(`   • 杯型：${newCup}`);
        console.log(`   • 裝飾：${newGarnish}`);
        console.log(`   • 故事：${story.replace(/\n/g, ' ')}`);
        console.log(`====================================================================================\n`);

        const answer = await askConfirmation(`❓ 請問是否要覆蓋現有資料並重新匯入？(輸入 y 確定覆蓋 / 直接按 Enter 取消) [y/N]: `);
        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(`\n🛑 已取消匯入操作！保留現有調酒資料，未做任何修改與檔案寫入。\n`);
            return { status: 'cancelled', drink: existingKey };
        }
        console.log(`\n🔄 使用者已確認覆蓋，繼續進行配方與圖片更新流程...\n`);
    }

    // 確定要匯入/覆蓋：
    // 若原舊酒名與新全名不同，先刪除舊鍵，避免重複多出條目
    if (existingKey && existingKey !== data.fullName) {
        delete recipeDb[existingKey];
        // 同步清理舊圖檔（若檔名不同）
        const oldImgPath = path.join(__dirname, 'public', 'images', `${existingKey}.jpg`);
        if (fs.existsSync(oldImgPath)) {
            try { fs.unlinkSync(oldImgPath); } catch (e) {}
        }
    }

    // 下載圖片 (僅儲存單一標準圖檔，絕不產生多餘別名)
    const imagesDir = path.join(__dirname, 'public', 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const primaryImageName = `${data.fullName}.jpg`;
    const primaryImagePath = path.join(imagesDir, primaryImageName);

    if (data.imgSrc) {
        console.log(`📸 正在下載調酒圖片: ${data.imgSrc}`);
        try {
            await downloadImage(data.imgSrc, primaryImagePath);
            console.log(`✅ 圖片下載成功: ${primaryImageName}`);
        } catch (imgErr) {
            console.warn(`⚠️ 圖片下載失敗，將不影響配方寫入: ${imgErr.message}`);
        }
    }

    // 寫入 recipe.json
    recipeDb[data.fullName] = {
        abv: data.abv,
        strong: data.strong,
        sour: data.sour,
        tags: data.tags,
        description: finalDescription
    };

    fs.writeFileSync(recipePath, JSON.stringify(recipeDb, null, 4), 'utf8');
    console.log(`📝 已成功將【${data.fullName}】寫入 recipe.json 配方庫！`);

    // 同步到 Excel
    try {
        syncToExcel(recipeDb);
    } catch (excelErr) {
        console.warn(`⚠️ 同步 Excel 失敗: ${excelErr.message}`);
    }

    // 嘗試向本地伺服器發送熱重載通知
    try {
        const postData = JSON.stringify({});
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/reload-drinks',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 2000
        }, (res) => {
            if (res.statusCode === 200) {
                console.log(`⚡ 伺服器酒單已即時熱更新！客人與後台可直接點餐，無需手動重啟。`);
            }
        });
        req.on('error', () => {
            console.log(`💡 提示：目前本機 Node.js 伺服器未運行，下次啟動時會自動載入這款新調酒。`);
        });
        req.write(postData);
        req.end();
    } catch (e) {}

    console.log(`\n🎉 全部完成！【${data.fullName}】已成功加入 MyBar 系統！`);
    return { status: 'success', drink: data.fullName };
}

// 支援命令列直接執行
if (require.main === module) {
    const args = process.argv.slice(2);
    const force = args.includes('--force') || args.includes('-y') || args.includes('/y');
    const cleanArgs = args.filter(a => !a.startsWith('-') && !a.startsWith('/'));
    const target = cleanArgs[0] || 'https://mixology.com.tw/RecipeContent.aspx?rid=M012';
    const customStory = cleanArgs[1] || null;

    importDrinkFromMixology(target, customStory, { force }).catch(err => {
        console.error('❌ 執行失敗:', err.message);
        process.exit(1);
    });
}

module.exports = { importDrinkFromMixology };
